import type { AuditLog } from '@prisma/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('../prisma/prisma.js', () => ({ prisma: {} }));
import {
  BILLING_RESERVATION_GRACE_MS, customerReconciliationPending, inspectBillingCheckout,
  readBillingReservation, recordBillingReservationFact, reserveBillingOperation,
  type BillingReservationClient, type BillingReservationFact, type BillingReservationOperation,
} from './billingReservations.service.js';

const now = new Date('2026-11-09T12:00:00Z');
const actor = { id: 1, companyId: 42, role: 'ADMIN' as const };
const priceId = 'pri_00000000000000000000000001';
const customerId = 'ctm_00000000000000000000000001';
const transactionId = 'txn_00000000000000000000000001';
const otherTransactionId = 'txn_00000000000000000000000002';
const selection = { plan: 'STARTER' as const, interval: 'month' as const, priceId };
const operations = ['CUSTOMER_CREATE', 'CHECKOUT'] as const;
const closingActions = ['CUSTOMER_CREATE_READY', 'CUSTOMER_CREATE_FAILED', 'CHECKOUT_READY', 'CHECKOUT_FAILED', 'CHECKOUT_CANCELED'] as const;

function row(id: number, action: string, newValue: unknown = null, change: Partial<AuditLog> = {}): AuditLog {
  return { id, companyId: 42, actorType: 'ADMIN', actorId: 1, entityType: 'BILLING_OPERATION', entityId: 42,
    action, oldValue: null, newValue: newValue as AuditLog['newValue'], reason: null, createdAt: now, ...change };
}
function payload(action: string, reservationId = 10) {
  if (action.endsWith('_FAILED')) return { reservationId, code: 'REJECTED' };
  if (action === 'CUSTOMER_CREATE_READY') return { reservationId, customerId };
  if (action === 'CHECKOUT_CANCELED') return { reservationId, transactionId };
  return { reservationId, transactionId, customerId };
}

// Shared, stateful fake: transactions only serialize when the implementation
// executes FOR UPDATE, so omitting/moving that lock makes concurrency tests fail.
function database() {
  const rows: AuditLog[] = [];
  const company = { id: 42, isActive: true, operationalStatus: 'ACTIVE', billingCustomerId: customerId as string | null,
    billingSubscriptionId: null as string | null };
  const owner = { id: 1, emailVerifiedAt: now as Date | null, company };
  type Mirror = { id: string; companyId: number | null; customerId: string | null; subscriptionId: string | null; status: string };
  let mirror: Mirror | null = null;
  const events: string[] = [];
  const locks = new Map<number, Promise<void>>();
  type Where = { id?: number; companyId?: number; entityId?: number; entityType?: string;
    action?: string | { in: string[] }; newValue?: { path: string[]; equals: number } };
  function matching({ where, orderBy }: { where: Where; orderBy?: { id: string } }) {
    return rows.filter(item => Object.entries(where).every(([key, value]) => {
      if (key === 'action') return typeof value === 'string' ? item.action === value : (value as { in: string[] }).in.includes(item.action);
      if (key === 'newValue') return (item.newValue as { reservationId?: number } | null)?.reservationId === (value as { equals: number }).equals;
      return item[key as keyof AuditLog] === value;
    })).sort((a, b) => orderBy?.id === 'desc' ? b.id - a.id : a.id - b.id);
  }
  const auditLog = {
    findFirst: vi.fn(async (args: Parameters<typeof matching>[0]) => {
      events.push('read'); return structuredClone(matching(args)[0] ?? null);
    }),
    findMany: vi.fn(async (args: Parameters<typeof matching>[0]) => structuredClone(matching(args))),
    create: vi.fn(async ({ data }: { data: Partial<AuditLog> }) => {
      events.push('append');
      const created = row(Math.max(0, ...rows.map(item => item.id)) + 1, data.action!, data.newValue, data);
      rows.push(created); return structuredClone(created);
    }),
    update: vi.fn(() => { throw new Error('Audit facts are append-only'); }),
    delete: vi.fn(() => { throw new Error('Audit facts are append-only'); }),
    updateMany: vi.fn(() => { throw new Error('Audit facts are append-only'); }),
    deleteMany: vi.fn(() => { throw new Error('Audit facts are append-only'); }),
  };
  const manager = { findFirst: vi.fn(async () => { events.push('owner'); return owner; }) };
  const paddleTransaction = { findFirst: vi.fn(async () => mirror) };
  const raw = vi.fn();
  const dbObject = {
    auditLog, manager, paddleTransaction,
    $transaction: vi.fn(async (run: (tx: BillingReservationClient) => Promise<unknown>) => {
      let release: (() => void) | undefined;
      const tx = { auditLog, manager, paddleTransaction, $queryRaw: async (strings: TemplateStringsArray, companyId: number) => {
        raw(strings, companyId);
        const previous = locks.get(companyId) ?? Promise.resolve();
        const current = new Promise<void>(resolve => { release = resolve; });
        locks.set(companyId, previous.then(() => current));
        await previous;
        events.push('lock');
        return [{ id: companyId }];
      } };
      try { return await run(tx as unknown as BillingReservationClient); }
      finally { events.push('release'); release?.(); }
    }),
  };
  const deps = { db: dbObject as unknown as NonNullable<Parameters<typeof readBillingReservation>[2]>['db'], now: () => now };
  return { rows, company, owner, auditLog, manager, paddleTransaction, events, raw, dbObject, deps,
    mirror(value: Partial<Mirror> | null = {}) { mirror = value === null ? null : { id: transactionId, companyId: 42, customerId, subscriptionId: null, status: 'draft', ...value }; },
    reserve(operation: BillingReservationOperation, age = 0) {
      const reserved = row(10, `${operation}_RESERVED`, operation === 'CHECKOUT' ? selection : null, { createdAt: new Date(+now - age) });
      rows.push(reserved); return reserved;
    },
    close(action: typeof closingActions[number], change: Partial<AuditLog> = {}) {
      const closed = row(11, action, payload(action), change); rows.push(closed); return closed;
    },
  };
}
let f: ReturnType<typeof database>;
beforeEach(() => {
  f = database();
  vi.stubEnv('PADDLE_ENVIRONMENT', 'sandbox');
  vi.stubEnv('PADDLE_PRICE_CATALOG_JSON', JSON.stringify([selection]));
});
afterEach(() => vi.unstubAllEnvs());

describe('reservation facts and correlation', () => {
  it.each(operations)('has no %s reservation before one is written', async operation => {
    expect(await readBillingReservation(f.company, operation, f.deps)).toEqual({ kind: 'none' });
  });
  for (const operation of operations) {
    it.each(closingActions)('%s closes only its own operation (' + operation + ')', async action => {
      f.reserve(operation); f.close(action);
      const own = action.startsWith(`${operation}_`);
      expect(await readBillingReservation(f.company, operation, f.deps)).toMatchObject({ kind: own ? 'closed' : 'inProgress' });
    });
  }
  for (const action of closingActions) {
    const operation = action.startsWith('CUSTOMER_CREATE') ? 'CUSTOMER_CREATE' : 'CHECKOUT';
    it.each([
      { companyId: 99 }, { entityId: 99 }, { entityType: 'OTHER' },
      { newValue: payload(action, 9) }, { id: 9 },
    ])(action + ' ignores foreign, stale or mismatched closing fact %j', async change => {
      f.reserve(operation); f.close(action, change as Partial<AuditLog>);
      expect(await readBillingReservation(f.company, operation, f.deps)).toMatchObject({ kind: 'inProgress' });
    });
    it(action + ' cannot close the latest reservation with a fact for an older one', async () => {
      f.reserve(operation); f.close(action);
      f.rows.push(row(12, `${operation}_RESERVED`, operation === 'CHECKOUT' ? selection : null));
      expect(await readBillingReservation(f.company, operation, f.deps)).toMatchObject({ kind: 'inProgress', reservation: { id: 12 } });
    });
  }
  it.each([null, [], 'not-an-object', { reservationId: '10', transactionId, customerId }])('malformed READY %j stays open', async value => {
    f.reserve('CHECKOUT'); f.close('CHECKOUT_READY', { newValue: value as AuditLog['newValue'] });
    expect(await readBillingReservation(f.company, 'CHECKOUT', f.deps)).toMatchObject({ kind: 'inProgress' });
  });
  it.each(['CUSTOMER_CREATE_FAILED', 'CHECKOUT_FAILED'] as const)('%s needs a safe failure code', async action => {
    const operation = action === 'CUSTOMER_CREATE_FAILED' ? 'CUSTOMER_CREATE' : 'CHECKOUT';
    f.reserve(operation); f.close(action, { newValue: { reservationId: 10, code: 'private provider detail@example.invalid' } });
    expect(await readBillingReservation(f.company, operation, f.deps)).toMatchObject({ kind: 'inProgress' });
  });
  it.each([null, 'ctm_bad', 'ctm_00000000000000000000000002'])('customer READY with customer %s stays open', async savedCustomer => {
    f.reserve('CUSTOMER_CREATE'); f.close('CUSTOMER_CREATE_READY', { newValue: { reservationId: 10, customerId: savedCustomer } });
    expect(await customerReconciliationPending(f.company, f.deps)).toBe(true);
  });
  it('a later cancellation supersedes READY for the exact checkout', async () => {
    f.reserve('CHECKOUT'); f.close('CHECKOUT_READY'); f.close('CHECKOUT_CANCELED', { id: 12 });
    expect(await inspectBillingCheckout(f.company, f.deps)).toEqual({ kind: 'canceled' });
  });
  it('cancellation of a different transaction cannot close the saved draft', async () => {
    f.reserve('CHECKOUT'); f.close('CHECKOUT_READY');
    f.close('CHECKOUT_CANCELED', { id: 12, newValue: { reservationId: 10, transactionId: otherTransactionId } });
    expect(await inspectBillingCheckout(f.company, f.deps)).toMatchObject({ kind: 'resume', selection: { transactionId } });
  });
  it('a foreign canceled mirror cannot close an unprepared checkout', async () => {
    f.reserve('CHECKOUT'); f.close('CHECKOUT_CANCELED'); f.mirror({ companyId: 99 });
    expect(await readBillingReservation(f.company, 'CHECKOUT', f.deps)).toMatchObject({ kind: 'inProgress' });
  });
  it('queries only the exact company, entity, operation and reservation ID', async () => {
    f.reserve('CHECKOUT'); await readBillingReservation(f.company, 'CHECKOUT', f.deps);
    expect(f.auditLog.findFirst).toHaveBeenCalledWith({ where: { companyId: 42, entityId: 42, entityType: 'BILLING_OPERATION', action: 'CHECKOUT_RESERVED' }, orderBy: { id: 'desc' } });
    expect(f.auditLog.findMany).toHaveBeenCalledWith({ where: { companyId: 42, entityId: 42, entityType: 'BILLING_OPERATION', action: { in: ['CHECKOUT_READY', 'CHECKOUT_FAILED', 'CHECKOUT_CANCELED'] }, newValue: { path: ['reservationId'], equals: 10 } }, orderBy: { id: 'desc' } });
  });
  it('defensively rejects a foreign reservation returned by a broken adapter', async () => {
    f.auditLog.findFirst.mockResolvedValueOnce(row(10, 'CHECKOUT_RESERVED', selection, { companyId: 99 }));
    await expect(readBillingReservation(f.company, 'CHECKOUT', f.deps)).rejects.toMatchObject({ statusCode: 409 });
  });
});

describe('120 second grace', () => {
  it('exports the shared grace constant', () => expect(BILLING_RESERVATION_GRACE_MS).toBe(120_000));
  for (const operation of operations) {
    it.each([-1, 0, 119_999, 120_000, 120_001, 86_400_000])(operation + ' age %i never expires a reservation', async age => {
      if (operation === 'CUSTOMER_CREATE') f.company.billingCustomerId = null;
      f.reserve(operation, age);
      expect(await readBillingReservation(f.company, operation, f.deps)).toMatchObject({ kind: age < 120_000 ? 'inProgress' : 'reconcile' });
      await expect(reserveBillingOperation(actor, operation, selection, f.deps)).rejects.toMatchObject({ statusCode: 409,
        errors: [{ code: age < 120_000 ? 'IN_PROGRESS' : 'RECONCILIATION_REQUIRED' }] });
      expect(f.auditLog.create).not.toHaveBeenCalled();
    });
    it(operation + ' with an invalid date needs reconciliation', async () => {
      f.reserve(operation).createdAt = new Date(NaN);
      expect(await readBillingReservation(f.company, operation, f.deps)).toMatchObject({ kind: 'reconcile' });
    });
    it(operation + ' uses the injected clock on every read', async () => {
      f.reserve(operation);
      expect(await readBillingReservation(f.company, operation, { ...f.deps, now: () => new Date(+now + 120_000) })).toMatchObject({ kind: 'reconcile' });
    });
  }
});

describe('checkout resume compatibility', () => {
  beforeEach(() => { f.reserve('CHECKOUT'); f.close('CHECKOUT_READY'); });
  it('resumes an unmirrored legacy READY only for the exact customer and catalog selection', async () => {
    expect(await inspectBillingCheckout(f.company, f.deps)).toEqual({ kind: 'resume', selection: { plan: 'STARTER', interval: 'month', transactionId } });
    expect(await reserveBillingOperation(actor, 'CHECKOUT', selection, f.deps)).toEqual({ ready: { plan: 'STARTER', interval: 'month', transactionId } });
    expect(f.auditLog.create).not.toHaveBeenCalled();
  });
  it.each(['draft', 'ready'])('resumes same-tenant mirrored %s', async status => {
    f.mirror({ status }); expect(await inspectBillingCheckout(f.company, f.deps)).toMatchObject({ kind: 'resume' });
  });
  it.each(['paid', 'billed', 'completed', 'unknown'])('%s stays held rather than allowing a second purchase', async status => {
    f.mirror({ status }); expect(await inspectBillingCheckout(f.company, f.deps)).toEqual({ kind: 'pending' });
    await expect(reserveBillingOperation(actor, 'CHECKOUT', selection, f.deps)).rejects.toMatchObject({ statusCode: 409 });
    expect(f.auditLog.create).not.toHaveBeenCalled();
  });
  it('a same-tenant canceled mirror permits replacement', async () => {
    f.mirror({ status: 'canceled' });
    expect(await inspectBillingCheckout(f.company, f.deps)).toEqual({ kind: 'canceled' });
    expect(await reserveBillingOperation(actor, 'CHECKOUT', selection, f.deps)).toEqual({ reservationId: 12 });
  });
  it.each([{ companyId: 99 }, { customerId: 'ctm_other' }, { id: otherTransactionId }, { companyId: null }])('foreign mirror %j keeps READY open', async change => {
    f.mirror(change); expect(await inspectBillingCheckout(f.company, f.deps)).toEqual({ kind: 'inProgress' });
    await expect(reserveBillingOperation(actor, 'CHECKOUT', selection, f.deps)).rejects.toMatchObject({ statusCode: 409 });
  });
  it.each([
    { reservationId: 10, transactionId: 'txn_bad', customerId },
    { reservationId: 10, transactionId, customerId: 'ctm_other' },
    { reservationId: 10, transactionId },
    { reservationId: 10, transactionId, customerId, confirmedByProvider: true },
  ])('invalid or unmirrored READY %j stays open', async saved => {
    f.rows[1]!.newValue = saved;
    expect(await inspectBillingCheckout(f.company, f.deps)).toEqual({ kind: 'inProgress' });
  });
  it('a legacy READY without a customer ID can resume with an exact tenant mirror', async () => {
    f.rows[1]!.newValue = { reservationId: 10, transactionId }; f.mirror();
    expect(await inspectBillingCheckout(f.company, f.deps)).toMatchObject({ kind: 'resume' });
  });
  it.each([{ plan: 'PRO' }, { interval: 'year' }, { priceId: 'pri_unknown' }])('saved selection mismatch %j stays open', async change => {
    f.rows[0]!.newValue = { ...selection, ...change };
    expect(await inspectBillingCheckout(f.company, f.deps)).toEqual({ kind: 'inProgress' });
  });
  it('a missing canonical customer keeps READY open', async () => {
    f.company.billingCustomerId = null;
    expect(await inspectBillingCheckout(f.company, f.deps)).toEqual({ kind: 'inProgress' });
  });
  it('canonical fulfilled subscription leaves draft policy to subscription access', async () => {
    f.company.billingSubscriptionId = 'sub_canonical'; f.mirror({ subscriptionId: 'sub_canonical', status: 'completed' });
    expect(await inspectBillingCheckout(f.company, f.deps)).toEqual({ kind: 'none' });
    await expect(reserveBillingOperation(actor, 'CHECKOUT', selection, f.deps)).rejects.toMatchObject({ statusCode: 409 });
  });
  it('a mismatched subscription remains pending', async () => {
    f.mirror({ subscriptionId: 'sub_other' });
    expect(await inspectBillingCheckout(f.company, f.deps)).toEqual({ kind: 'pending' });
  });
});

describe('locked reservation creation', () => {
  for (const operation of operations) {
    it(operation + ' reserves under the parameterized company lock', async () => {
      if (operation === 'CUSTOMER_CREATE') f.company.billingCustomerId = null;
      expect(await reserveBillingOperation(actor, operation, selection, f.deps)).toEqual({ reservationId: 1 });
      expect(f.raw).toHaveBeenCalledWith(['SELECT id FROM "Company" WHERE id=', ' FOR UPDATE'], 42);
      expect(f.events.indexOf('lock')).toBeLessThan(f.events.indexOf('owner'));
      expect(f.events.indexOf('lock')).toBeLessThan(f.events.indexOf('read'));
      expect(f.rows[0]).toMatchObject({ action: `${operation}_RESERVED`, companyId: 42, entityId: 42, entityType: 'BILLING_OPERATION', actorType: 'ADMIN', actorId: 1 });
    });
    it(operation + ' serializes concurrent requests with one reservation and one conflict', async () => {
      if (operation === 'CUSTOMER_CREATE') f.company.billingCustomerId = null;
      const results = await Promise.allSettled([reserveBillingOperation(actor, operation, selection, f.deps), reserveBillingOperation(actor, operation, selection, f.deps)]);
      expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
      expect(results.filter(result => result.status === 'rejected')).toMatchObject([{ reason: { statusCode: 409 } }]);
      expect(f.auditLog.create).toHaveBeenCalledOnce();
      expect(f.events).toEqual(['lock', 'owner', ...(operation === 'CHECKOUT' ? ['read'] : []), 'read', 'append', 'release',
        'lock', 'owner', ...(operation === 'CHECKOUT' ? ['read'] : []), 'read', 'release']);
    });
    it(operation + ' FAILED allows a new reservation while preserving history', async () => {
      f.reserve(operation, 500_000); f.close(`${operation}_FAILED`);
      if (operation === 'CUSTOMER_CREATE') f.company.billingCustomerId = null;
      const history = structuredClone(f.rows);
      expect(await reserveBillingOperation(actor, operation, selection, f.deps)).toEqual({ reservationId: 12 });
      expect(f.rows.slice(0, 2)).toEqual(history);
    });
    it(operation + ' permits only one concurrent retry after FAILED', async () => {
      f.reserve(operation); f.close(`${operation}_FAILED`);
      if (operation === 'CUSTOMER_CREATE') f.company.billingCustomerId = null;
      const results = await Promise.allSettled(Array.from({ length: 4 }, () => reserveBillingOperation(actor, operation, selection, f.deps)));
      expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
      expect(f.auditLog.create).toHaveBeenCalledOnce();
    });
  }
  it('reuses a canonical linked customer under the lock', async () => {
    expect(await reserveBillingOperation(actor, 'CUSTOMER_CREATE', {}, f.deps)).toEqual({ existingCustomerId: customerId });
    expect(f.auditLog.create).not.toHaveBeenCalled();
  });
  it('customer READY closes only while its exact customer remains linked', async () => {
    f.reserve('CUSTOMER_CREATE'); f.close('CUSTOMER_CREATE_READY');
    expect(await customerReconciliationPending(f.company, f.deps)).toBe(false);
    f.company.billingCustomerId = null;
    expect(await customerReconciliationPending(f.company, f.deps)).toBe(true);
  });
  it('CHECKOUT_CANCELED allows a new checkout', async () => {
    f.reserve('CHECKOUT'); f.close('CHECKOUT_CANCELED');
    expect(await reserveBillingOperation(actor, 'CHECKOUT', selection, f.deps)).toEqual({ reservationId: 12 });
  });
  it.each([0, 120_000])('open customer reservation at age %i blocks a checkout', async age => {
    f.reserve('CUSTOMER_CREATE', age);
    await expect(reserveBillingOperation(actor, 'CHECKOUT', selection, f.deps)).rejects.toMatchObject({ statusCode: 409 });
    expect(f.auditLog.create).not.toHaveBeenCalled();
  });
  it('a failed customer reservation permits checkout', async () => {
    f.reserve('CUSTOMER_CREATE'); f.close('CUSTOMER_CREATE_FAILED');
    expect(await customerReconciliationPending(f.company, f.deps)).toBe(false);
    expect(await reserveBillingOperation(actor, 'CHECKOUT', selection, f.deps)).toEqual({ reservationId: 12 });
  });
  it.each(['MANAGER', 'STAFF'] as const)('denies %s', async role => {
    await expect(reserveBillingOperation({ ...actor, role }, 'CHECKOUT', selection, f.deps)).rejects.toMatchObject({ statusCode: 403 });
    expect(f.auditLog.create).not.toHaveBeenCalled();
  });
  it.each([{ isActive: false }, { operationalStatus: 'SUSPENDED' }])('denies restricted company %j under the lock', async change => {
    Object.assign(f.company, change);
    await expect(reserveBillingOperation(actor, 'CHECKOUT', selection, f.deps)).rejects.toMatchObject({ statusCode: 403 });
    expect(f.auditLog.create).not.toHaveBeenCalled();
  });
  it('denies a foreign owner returned by the adapter', async () => {
    f.company.id = 99;
    await expect(reserveBillingOperation(actor, 'CHECKOUT', selection, f.deps)).rejects.toMatchObject({ statusCode: 403 });
  });
  it('requires verified email in production, while sandbox can reserve without it', async () => {
    f.owner.emailVerifiedAt = null; vi.stubEnv('PADDLE_ENVIRONMENT', 'production');
    await expect(reserveBillingOperation(actor, 'CHECKOUT', selection, f.deps)).rejects.toMatchObject({ statusCode: 403 });
    vi.stubEnv('PADDLE_ENVIRONMENT', 'sandbox');
    expect(await reserveBillingOperation(actor, 'CHECKOUT', selection, f.deps)).toEqual({ reservationId: 1 });
  });
});

describe('append-only fact writes', () => {
  it.each(closingActions)('writes %s through the audit service with exact scope and payload', async action => {
    const operation = action.startsWith('CUSTOMER_CREATE') ? 'CUSTOMER_CREATE' : 'CHECKOUT';
    f.reserve(operation);
    const fact = { action, ...payload(action) } as BillingReservationFact;
    expect(await recordBillingReservationFact(actor, fact, f.deps)).toMatchObject({ id: 11, action, newValue: payload(action) });
    expect(f.auditLog.create).toHaveBeenCalledWith({ data: { companyId: 42, actorType: 'ADMIN', actorId: 1, entityType: 'BILLING_OPERATION', entityId: 42,
      action, newValue: payload(action), reason: null, oldValue: undefined } });
    expect(await readBillingReservation(f.company, operation, f.deps)).toMatchObject({ kind: 'closed' });
    expect(f.auditLog.update).not.toHaveBeenCalled(); expect(f.auditLog.delete).not.toHaveBeenCalled();
    expect(f.auditLog.updateMany).not.toHaveBeenCalled(); expect(f.auditLog.deleteMany).not.toHaveBeenCalled();
  });
  it.each(closingActions)('repeating %s is idempotent under concurrent fact writes', async action => {
    f.reserve(action.startsWith('CUSTOMER_CREATE') ? 'CUSTOMER_CREATE' : 'CHECKOUT');
    const fact = { action, ...payload(action) } as BillingReservationFact;
    const results = await Promise.all([recordBillingReservationFact(actor, fact, f.deps), recordBillingReservationFact(actor, fact, f.deps)]);
    expect(results[0]).toEqual(results[1]); expect(f.auditLog.create).toHaveBeenCalledOnce();
  });
  it('records adopted READY metadata', async () => {
    f.reserve('CUSTOMER_CREATE');
    await recordBillingReservationFact(actor, { action: 'CUSTOMER_CREATE_READY', reservationId: 10, customerId, adopted: true }, f.deps);
    expect(f.rows[1]!.newValue).toEqual({ reservationId: 10, customerId, adopted: true });
  });
  it('records EMAIL_CONFLICT as a failed customer fact without permitting adoption', async () => {
    f.company.billingCustomerId = null; f.reserve('CUSTOMER_CREATE');
    await recordBillingReservationFact(actor, { action: 'CUSTOMER_CREATE_FAILED', reservationId: 10, code: 'EMAIL_CONFLICT' }, f.deps);
    expect(f.company.billingCustomerId).toBeNull();
    expect(await readBillingReservation(f.company, 'CUSTOMER_CREATE', f.deps)).toMatchObject({ kind: 'closed' });
  });
  it.each(operations)('%s accepts the gateway\'s lowercase safe provider codes', async operation => {
    f.reserve(operation);
    await recordBillingReservationFact(actor, { action: `${operation}_FAILED`, reservationId: 10, code: 'invalid_field' }, f.deps);
    expect(await readBillingReservation(f.company, operation, f.deps)).toMatchObject({ kind: 'closed' });
  });
  it.each(operations)('%s can append a valid READY after a malformed READY', async operation => {
    f.reserve(operation); f.close(`${operation}_READY`, { newValue: { ...payload(`${operation}_READY`), customerId: 'ctm_wrong' } });
    const history = structuredClone(f.rows);
    await recordBillingReservationFact(actor, { action: `${operation}_READY`, ...payload(`${operation}_READY`) } as BillingReservationFact, f.deps);
    expect(f.rows.slice(0, 2)).toEqual(history);
    expect(await readBillingReservation(f.company, operation, f.deps)).toMatchObject({ kind: 'closed', fact: { id: 12 } });
  });
  it.each(operations)('%s does not replay an invalid pre-reservation closing fact', async operation => {
    f.reserve(operation); f.close(`${operation}_FAILED`, { id: 9 });
    await recordBillingReservationFact(actor, { action: `${operation}_FAILED`, reservationId: 10, code: 'REJECTED' }, f.deps);
    expect(await readBillingReservation(f.company, operation, f.deps)).toMatchObject({ kind: 'closed', fact: { id: 11 } });
  });
  it('appends CANCELED after READY without mutating the draft fact', async () => {
    f.reserve('CHECKOUT'); f.close('CHECKOUT_READY'); const history = structuredClone(f.rows);
    await recordBillingReservationFact(actor, { action: 'CHECKOUT_CANCELED', reservationId: 10, transactionId }, f.deps);
    expect(f.rows.slice(0, 2)).toEqual(history);
    expect(await inspectBillingCheckout(f.company, f.deps)).toEqual({ kind: 'canceled' });
  });
  it('rejects a cancellation for another saved transaction', async () => {
    f.reserve('CHECKOUT'); f.close('CHECKOUT_READY');
    await expect(recordBillingReservationFact(actor, { action: 'CHECKOUT_CANCELED', reservationId: 10, transactionId: otherTransactionId }, f.deps)).rejects.toMatchObject({ statusCode: 409 });
    expect(f.auditLog.create).not.toHaveBeenCalled();
  });
  it.each(['CHECKOUT_FAILED', 'CHECKOUT_CANCELED'] as const)('cannot resurrect %s with READY', async action => {
    f.reserve('CHECKOUT'); f.close(action);
    await expect(recordBillingReservationFact(actor, { action: 'CHECKOUT_READY', reservationId: 10, transactionId, customerId }, f.deps)).rejects.toMatchObject({ statusCode: 409 });
    expect(f.auditLog.create).not.toHaveBeenCalled();
  });
  it('cannot rewrite a failure code in an existing fact', async () => {
    f.reserve('CHECKOUT'); f.close('CHECKOUT_FAILED');
    await expect(recordBillingReservationFact(actor, { action: 'CHECKOUT_FAILED', reservationId: 10, code: 'NOT_FOUND' }, f.deps)).rejects.toMatchObject({ statusCode: 409 });
  });
  it.each([
    { action: 'CHECKOUT_FAILED', reservationId: 99, code: 'REJECTED' },
    { action: 'CUSTOMER_CREATE_FAILED', reservationId: 10, code: 'REJECTED' },
    { action: 'CHECKOUT_READY', reservationId: 10, transactionId: 'bad', customerId },
    { action: 'CHECKOUT_FAILED', reservationId: 10, code: 'email@example.invalid' },
  ] as BillingReservationFact[])('rejects invalid, missing or wrong-operation fact %j', async fact => {
    f.reserve('CHECKOUT');
    await expect(recordBillingReservationFact(actor, fact, f.deps)).rejects.toMatchObject({ statusCode: 409 });
    expect(f.auditLog.create).not.toHaveBeenCalled();
  });
  it('denies recording a fact for another company', async () => {
    f.rows.push(row(10, 'CHECKOUT_RESERVED', selection, { companyId: 99, entityId: 99 }));
    await expect(recordBillingReservationFact(actor, { action: 'CHECKOUT_FAILED', reservationId: 10, code: 'REJECTED' }, f.deps)).rejects.toMatchObject({ statusCode: 409 });
    expect(f.auditLog.create).not.toHaveBeenCalled();
  });
  it('composes READY with a caller transaction and takes the same company lock', async () => {
    f.reserve('CHECKOUT'); f.mirror();
    await f.dbObject.$transaction(async tx => {
      await recordBillingReservationFact(actor, { action: 'CHECKOUT_READY', reservationId: 10, transactionId, customerId, confirmedByProvider: true }, { ...f.deps, tx });
    });
    expect(f.dbObject.$transaction).toHaveBeenCalledOnce(); expect(f.raw).toHaveBeenCalledOnce();
    expect(await inspectBillingCheckout(f.company, f.deps)).toMatchObject({ kind: 'resume' });
  });
});
