import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Subscription, Transaction } from '@paddle/paddle-node-sdk';
import type { AuditLog, Company, PaddleCustomer, PaddleSubscription, PaddleTransaction } from '@prisma/client';
import { confirmBillingCheckout } from './billingConfirm.service.js';
import { createOperationalLogger } from '../utils/operationalLog.js';
import { ApiError } from '../utils/ApiError.js';
import { BillingProviderError } from './billingProvider.js';

// Every database/provider operation is injected. Importing a real client here
// would fail immediately, even with the required unreachable DATABASE_URL.
vi.mock('../prisma/prisma.js', () => ({ prisma: {} }));

const now = new Date('2026-11-10T12:00:00Z');
const actor = { id: 1, companyId: 42, role: 'ADMIN' as const };
const customerId = 'ctm_00000000000000000000000001';
const otherCustomer = 'ctm_00000000000000000000000002';
const transactionId = 'txn_00000000000000000000000001';
const otherTransaction = 'txn_00000000000000000000000002';
const subscriptionId = 'sub_00000000000000000000000001';
const otherSubscription = 'sub_00000000000000000000000002';
const priceId = 'pri_00000000000000000000000001';
const proPriceId = 'pri_00000000000000000000000002';
const foreignPrice = 'pri_00000000000000000000000003';
const productId = 'pro_00000000000000000000000001';
const selection = { plan: 'STARTER', interval: 'month', priceId };
const at = (offset: number) => new Date(+now + offset).toISOString();
type SubscriptionData = ConstructorParameters<typeof Subscription>[0];
type TransactionData = ConstructorParameters<typeof Transaction>[0];

const price: SubscriptionData['items'][number]['price'] = {
  id: priceId, product_id: productId, description: 'Fixture price', type: 'standard',
  billing_cycle: { interval: 'month', frequency: 1 }, trial_period: null, tax_mode: 'account_setting',
  unit_price: { amount: '1234', currency_code: 'USD' }, unit_price_overrides: [], quantity: { minimum: 1, maximum: 1 },
  status: 'active', created_at: at(-60_000), updated_at: at(0),
};
function subscriptionData(change: Partial<SubscriptionData> = {}): SubscriptionData {
  return {
    id: subscriptionId, customer_id: customerId, address_id: 'add_fixture', status: 'active', currency_code: 'USD',
    created_at: at(-60_000), updated_at: at(0), collection_mode: 'automatic', management_urls: null,
    current_billing_period: { starts_at: at(-3_600_000), ends_at: at(3_600_000) },
    billing_cycle: { interval: 'month', frequency: 1 },
    items: [{ status: 'active', quantity: 1, recurring: true, created_at: at(-60_000), updated_at: at(0), price,
      product: { id: productId, name: 'Fixture product', tax_category: 'standard', status: 'active', created_at: at(-60_000), updated_at: at(0) } }],
    ...change,
  };
}
function transactionData(change: Partial<TransactionData> = {}): TransactionData {
  return { id: transactionId, customer_id: customerId, subscription_id: subscriptionId, status: 'completed',
    currency_code: 'USD', origin: 'web', collection_mode: 'automatic', payments: [],
    created_at: at(-60_000), updated_at: at(0), custom_data: { checkoutReservationId: 10 },
    items: [{ quantity: 1, price }], ...change };
}
function audit(id: number, action: string, newValue: unknown, change: Partial<AuditLog> = {}): AuditLog {
  return { id, action, companyId: 42, entityType: 'BILLING_OPERATION', entityId: 42,
    actorType: 'ADMIN', actorId: 1, newValue: newValue as AuditLog['newValue'], oldValue: null, reason: null, createdAt: now, ...change };
}

// Stateful transaction fixture runs the real reservation reader, fulfilment and
// lifecycle/access policy together, without SQL or provider clients.
function table<T extends { id: string }>(defaults: Partial<T> = {}) {
  const rows = new Map<string, T>();
  const defined = (data: Partial<T>) => Object.fromEntries(Object.entries(data).filter(([, value]) => value !== undefined));
  const matches = (row: T, where: Partial<T>) => Object.entries(where).every(([key, value]) => row[key as keyof T] === value);
  const findUnique = vi.fn(async ({ where }: { where: { id: string } }) => structuredClone(rows.get(where.id) ?? null));
  const update = vi.fn(async ({ where, data }: { where: { id: string }; data: Partial<T> }) => {
    const current = rows.get(where.id);
    if (!current) throw new Error('Missing fixture row');
    const row = { ...current, ...defined(data) } as T; rows.set(where.id, row); return structuredClone(row);
  });
  return { rows, findUnique, update,
    findFirst: vi.fn(async ({ where }: { where: Partial<T> }) => structuredClone([...rows.values()].find(row => matches(row, where)) ?? null)),
    findUniqueOrThrow: vi.fn(async (args: { where: { id: string } }) => {
      const found = await findUnique(args); if (!found) throw new Error('Missing fixture row'); return found;
    }),
    upsert: vi.fn(async ({ where, create, update: change }: { where: { id: string }; create: Partial<T>; update: Partial<T> }) => {
      const current = rows.get(where.id);
      const row = { ...defaults, ...current, ...defined(current ? change : create) } as T;
      rows.set(where.id, row); return structuredClone(row);
    }),
    updateMany: vi.fn(async ({ where, data }: { where: Partial<T>; data: Partial<T> }) => {
      let count = 0;
      for (const row of rows.values()) if (matches(row, where)) { await update({ where: { id: row.id }, data }); count++; }
      return { count };
    }),
    findMany: vi.fn(async ({ where }: { where: Partial<T> }) => structuredClone([...rows.values()].filter(row => matches(row, where)))
      .sort((a, b) => +((b as T & { lastEventAt?: Date }).lastEventAt ?? 0) - +((a as T & { lastEventAt?: Date }).lastEventAt ?? 0))),
  };
}
function fixture() {
  const company = { id: 42, name: 'Fixture', plan: 'STARTER', isActive: true, operationalStatus: 'ACTIVE',
    billingCustomerId: customerId, billingSubscriptionId: null, subscriptionStatus: 'CANCELLED' } as Company;
  const owner = { id: 1, emailVerifiedAt: now, company };
  const rows = [audit(10, 'CHECKOUT_RESERVED', selection), audit(11, 'CHECKOUT_READY', { reservationId: 10, transactionId, customerId })];
  type AuditQuery = { where: { id?: number; companyId?: number; entityId?: number; entityType?: string;
    action?: string | { in: string[] }; newValue?: { path: string[]; equals: number } }; orderBy?: { id: string } };
  const matching = ({ where, orderBy }: AuditQuery) => rows.filter(row => Object.entries(where).every(([key, value]) => {
    if (key === 'action') return typeof value === 'string' ? row.action === value : (value as { in: string[] }).in.includes(row.action);
    if (key === 'newValue') return (row.newValue as { reservationId?: number } | null)?.reservationId === (value as { equals: number }).equals;
    return row[key as keyof AuditLog] === value;
  })).sort((a, b) => orderBy?.id === 'desc' ? b.id - a.id : a.id - b.id);
  const customer = table<PaddleCustomer>({ companyId: null });
  customer.rows.set(customerId, { id: customerId, companyId: 42, status: 'active' } as PaddleCustomer);
  const subscription = table<PaddleSubscription>({ companyId: null, scheduledChangeAction: null, scheduledChangeAt: null,
    currentBillingPeriodStart: null, currentBillingPeriodEnd: null, canceledAt: null, pausedAt: null });
  const transaction = table<PaddleTransaction>({ companyId: null });
  const dbObject = {
    manager: {
      findFirst: vi.fn(async ({ where }: { where: { id: number; companyId: number; role: string; isActive: boolean } }) =>
        where.id === owner.id && where.companyId === company.id && where.role === 'ADMIN' && where.isActive ? structuredClone(owner) : null),
      count: vi.fn(async () => 1),
    },
    company: {
      findUnique: vi.fn(async ({ where }: { where: { id: number } }) => where.id === company.id ? structuredClone(company) : null),
      findUniqueOrThrow: vi.fn(async () => structuredClone(company)),
      findFirst: vi.fn(async ({ where }: { where: { billingCustomerId: string } }) =>
        where.billingCustomerId === company.billingCustomerId ? { id: company.id } : null),
      update: vi.fn(async ({ data }: { data: Partial<Company> }) => { Object.assign(company, data); return structuredClone(company); }),
    },
    auditLog: {
      findFirst: vi.fn(async (query: AuditQuery) => structuredClone(matching(query)[0] ?? null)),
      findMany: vi.fn(async (query: AuditQuery) => structuredClone(matching(query))),
      create: vi.fn(() => { throw new Error('Confirmation must not append reservation facts'); }),
    },
    paddleCustomer: customer, paddleSubscription: subscription, paddleTransaction: transaction,
    paddleWebhookEvent: { create: vi.fn(() => { throw new Error('Server reads must not synthesize webhooks'); }) },
    location: { count: vi.fn(async () => 0) }, staff: { count: vi.fn(async () => 0) },
    $queryRaw: vi.fn(async (_sql: TemplateStringsArray, ..._values: unknown[]) => []),
  };
  const db = { ...dbObject, $transaction: vi.fn(async (run: (tx: typeof dbObject) => Promise<unknown>) => {
    const before = structuredClone({ company, customers: customer.rows, subscriptions: subscription.rows, transactions: transaction.rows });
    try { return await run(dbObject); } catch (error) {
      Object.assign(company, before.company);
      for (const [live, saved] of [[customer.rows, before.customers], [subscription.rows, before.subscriptions], [transaction.rows, before.transactions]] as const) {
        live.clear(); for (const [id, row] of saved) (live as Map<string, object>).set(id, row);
      }
      throw error;
    }
  }) };
  const provider = { transactions: { get: vi.fn(async () => new Transaction(transactionData())) },
    subscriptions: { get: vi.fn(async () => new Subscription(subscriptionData())) } };
  const logs: string[] = [];
  type Deps = NonNullable<Parameters<typeof confirmBillingCheckout>[1]>;
  const deps: Deps = { db: db as unknown as Deps['db'], provider: provider as unknown as Deps['provider'],
    now: () => now, log: createOperationalLogger(line => logs.push(line)) };
  return { company, owner, rows, db, provider, subscription, customer, transaction, logs,
    confirm: (who: Parameters<typeof confirmBillingCheckout>[0] = actor) => confirmBillingCheckout(who, deps),
    setTransaction: (change: Partial<TransactionData>) => provider.transactions.get.mockResolvedValue(new Transaction(transactionData(change))),
    setSubscription: (change: Partial<SubscriptionData>) => provider.subscriptions.get.mockResolvedValue(new Subscription(subscriptionData(change))),
  };
}
let f: ReturnType<typeof fixture>;
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(now);
  vi.stubEnv('PADDLE_ENVIRONMENT', 'sandbox');
  vi.stubEnv('PADDLE_PRICE_CATALOG_JSON', JSON.stringify([selection, { plan: 'PRO', interval: 'month', priceId: proPriceId }]));
  f = fixture();
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });

function grantsNothing() {
  expect(f.subscription.upsert).not.toHaveBeenCalled();
  expect(f.db.company.update).not.toHaveBeenCalled();
  expect(f.company.billingSubscriptionId).toBeNull();
}

describe('company-scoped READY selection and authorization', () => {
  it.each([{ role: 'MANAGER' as const }, { role: 'STAFF' as const }, { id: 9 }, { companyId: 9 }])('refuses non-owner identity %j before Paddle', async change => {
    await expect(f.confirm({ ...actor, ...change })).rejects.toMatchObject({ statusCode: 403 });
    expect(f.provider.transactions.get).not.toHaveBeenCalled(); grantsNothing();
  });
  it('rechecks owner identity even if a database returns a foreign owner', async () => {
    f.db.manager.findFirst.mockResolvedValue({ ...f.owner, id: 9 });
    await expect(f.confirm()).rejects.toMatchObject({ statusCode: 403 }); grantsNothing();
  });
  it('returns NO_CHECKOUT without a reservation', async () => {
    f.rows.length = 0;
    expect(await f.confirm()).toMatchObject({ outcome: 'NO_CHECKOUT', lifecycle: { company: { id: 42 }, workspaceAccessAllowed: false } });
    expect(f.provider.transactions.get).not.toHaveBeenCalled(); grantsNothing();
  });
  it('ignores a newer foreign company reservation and reads only the current transaction', async () => {
    f.rows.push(audit(20, 'CHECKOUT_RESERVED', selection, { companyId: 99, entityId: 99 }),
      audit(21, 'CHECKOUT_READY', { reservationId: 20, transactionId: otherTransaction, customerId: otherCustomer }, { companyId: 99, entityId: 99 }));
    expect((await f.confirm()).outcome).toBe('ACTIVE');
    expect(f.provider.transactions.get).toHaveBeenCalledExactlyOnceWith(transactionId);
    expect(f.db.auditLog.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ companyId: 42, entityId: 42, entityType: 'BILLING_OPERATION' }) }));
  });
  it('uses the newest valid READY, never an older saved checkout', async () => {
    f.rows.push(audit(20, 'CHECKOUT_RESERVED', selection), audit(21, 'CHECKOUT_READY', { reservationId: 20, transactionId: otherTransaction, customerId }));
    f.setTransaction({ id: otherTransaction, custom_data: { checkoutReservationId: 20 } });
    expect((await f.confirm()).outcome).toBe('ACTIVE');
    expect(f.provider.transactions.get).toHaveBeenCalledExactlyOnceWith(otherTransaction);
  });
  it('does not fall back to an older READY when a newer hold is still open', async () => {
    f.rows.push(audit(20, 'CHECKOUT_RESERVED', selection));
    expect((await f.confirm()).outcome).toBe('PROCESSING');
    expect(f.provider.transactions.get).not.toHaveBeenCalled(); grantsNothing();
  });
  it.each([
    { companyId: 99 }, { entityId: 99 }, { entityType: 'OTHER' },
    { newValue: { reservationId: 9, transactionId, customerId } },
    { newValue: { reservationId: 10, transactionId, customerId: otherCustomer } },
    { newValue: { reservationId: 10, transactionId: 'txn_bad', customerId } },
    { newValue: null },
  ])('malformed or foreign READY grants nothing: %j', async change => {
    Object.assign(f.rows[1], change);
    expect((await f.confirm()).outcome).toBe('PROCESSING');
    expect(f.provider.transactions.get).not.toHaveBeenCalled(); expect(f.logs).toHaveLength(1); grantsNothing();
  });
  it.each([{ companyId: 99 }, { customerId: otherCustomer }])('a foreign transaction mirror is not an absent mirror: %j', async change => {
    f.transaction.rows.set(transactionId, { id: transactionId, companyId: 42, customerId, ...change } as PaddleTransaction);
    expect((await f.confirm()).outcome).toBe('PROCESSING');
    expect(f.provider.transactions.get).not.toHaveBeenCalled(); grantsNothing();
  });
  it.each(['CHECKOUT_FAILED', 'CHECKOUT_CANCELED'])('honors the closing fact %s', async action => {
    f.rows.push(audit(12, action, { reservationId: 10, transactionId, code: 'REJECTED' }));
    expect((await f.confirm()).outcome).toBe(action === 'CHECKOUT_FAILED' ? 'NO_CHECKOUT' : 'NOT_PAID');
    expect(f.provider.transactions.get).not.toHaveBeenCalled(); grantsNothing();
  });
  it('an unconfigured saved selection cannot call Paddle', async () => {
    f.rows[0].newValue = { ...selection, priceId: foreignPrice };
    expect((await f.confirm()).outcome).toBe('PROCESSING'); expect(f.provider.transactions.get).not.toHaveBeenCalled(); grantsNothing();
  });
});

describe('transaction verification and statuses', () => {
  it.each(['draft', 'ready', 'canceled'] as const)('%s is NOT_PAID even with a subscription ID', async status => {
    f.setTransaction({ status });
    expect((await f.confirm()).outcome).toBe('NOT_PAID'); expect(f.provider.subscriptions.get).not.toHaveBeenCalled(); grantsNothing();
  });
  it.each(['paid', 'billed', 'completed'] as const)('%s without a subscription is PROCESSING', async status => {
    f.setTransaction({ status, subscription_id: null });
    expect((await f.confirm()).outcome).toBe('PROCESSING'); expect(f.provider.subscriptions.get).not.toHaveBeenCalled(); grantsNothing();
  });
  it.each(['paid', 'billed', 'completed'] as const)('%s with an active verified subscription activates', async status => {
    f.setTransaction({ status });
    expect(await f.confirm()).toMatchObject({ outcome: 'ACTIVE', lifecycle: { workspaceAccessAllowed: true } });
    expect(f.provider.subscriptions.get).toHaveBeenCalledExactlyOnceWith(subscriptionId);
  });
  it.each(['past_due', 'unknown'] as const)('%s is PROCESSING and cannot fulfil', async status => {
    f.setTransaction({ status: status as TransactionData['status'] });
    expect((await f.confirm()).outcome).toBe('PROCESSING'); expect(f.provider.subscriptions.get).not.toHaveBeenCalled(); grantsNothing();
  });
  const mismatches: [string, Partial<TransactionData>, string][] = [
    ['transaction ID', { id: otherTransaction }, 'TRANSACTION_ID_MISMATCH'],
    ['foreign customer', { customer_id: otherCustomer }, 'TRANSACTION_CUSTOMER_MISMATCH'],
    ['missing customer', { customer_id: null }, 'TRANSACTION_CUSTOMER_MISMATCH'],
    ['foreign reservation', { custom_data: { checkoutReservationId: 99 } }, 'TRANSACTION_RESERVATION_MISMATCH'],
    ['string reservation', { custom_data: { checkoutReservationId: '10' } }, 'TRANSACTION_RESERVATION_MISMATCH'],
    ['missing metadata', { custom_data: null }, 'TRANSACTION_RESERVATION_MISMATCH'],
    ['foreign company metadata', { custom_data: { checkoutReservationId: 10, companyId: 99 } }, 'TRANSACTION_RESERVATION_MISMATCH'],
    ['no items', { items: [] }, 'TRANSACTION_ITEMS_MISMATCH'],
    ['multiple items', { items: [{ quantity: 1, price }, { quantity: 1, price }] }, 'TRANSACTION_ITEMS_MISMATCH'],
    ['quantity two', { items: [{ quantity: 2, price }] }, 'TRANSACTION_ITEMS_MISMATCH'],
    ['quantity zero', { items: [{ quantity: 0, price }] }, 'TRANSACTION_ITEMS_MISMATCH'],
    ['no price', { items: [{ quantity: 1, price: null }] }, 'TRANSACTION_PRICE_MISMATCH'],
    ['unconfigured price', { items: [{ quantity: 1, price: { ...price, id: foreignPrice } }] }, 'TRANSACTION_PRICE_MISMATCH'],
    ['different configured price', { items: [{ quantity: 1, price: { ...price, id: proPriceId } }] }, 'TRANSACTION_PRICE_MISMATCH'],
    ['invalid subscription ID', { subscription_id: 'sub_bad' }, 'SUBSCRIPTION_ID_MISMATCH'],
  ];
  it.each(mismatches)('%s returns PROCESSING and logs only a code', async (_label, change, code) => {
    f.setTransaction(change);
    expect(await f.confirm()).toMatchObject({ outcome: 'PROCESSING', lifecycle: { workspaceAccessAllowed: false } });
    expect(f.provider.subscriptions.get).not.toHaveBeenCalled(); grantsNothing();
    expect(f.logs.map(line => JSON.parse(line))).toEqual([{ event: 'BILLING_CONFIRM_MISMATCH', providerCode: code, companyId: 42, reservationId: 10 }]);
  });
  it('accepts matching optional company metadata', async () => {
    f.setTransaction({ custom_data: { checkoutReservationId: 10, companyId: 42 } });
    expect((await f.confirm()).outcome).toBe('ACTIVE');
  });
});

describe('subscription verification, fulfilment and access', () => {
  const item = subscriptionData().items[0];
  it.each<[string, Partial<SubscriptionData>, string]>([
    ['foreign ID', { id: otherSubscription }, 'SUBSCRIPTION_ID_MISMATCH'],
    ['foreign customer', { customer_id: otherCustomer }, 'SUBSCRIPTION_CUSTOMER_MISMATCH'],
    ['no items', { items: [] }, 'SUBSCRIPTION_ITEMS_MISMATCH'],
    ['multiple items', { items: [item, item] }, 'SUBSCRIPTION_ITEMS_MISMATCH'],
    ['quantity two', { items: [{ ...item, quantity: 2 }] }, 'SUBSCRIPTION_ITEMS_MISMATCH'],
    ['nonrecurring item', { items: [{ ...item, recurring: false }] }, 'SUBSCRIPTION_ITEMS_MISMATCH'],
    ['unconfigured price', { items: [{ ...item, price: { ...price, id: foreignPrice } }] }, 'SUBSCRIPTION_PRICE_MISMATCH'],
    ['different configured price', { items: [{ ...item, price: { ...price, id: proPriceId } }] }, 'SUBSCRIPTION_PRICE_MISMATCH'],
  ])('%s grants nothing', async (_label, change, code) => {
    f.setSubscription(change);
    expect((await f.confirm()).outcome).toBe('PROCESSING'); grantsNothing();
    expect(f.logs.map(line => JSON.parse(line))).toEqual([{ event: 'BILLING_CONFIRM_MISMATCH', providerCode: code, companyId: 42, reservationId: 10 }]);
  });
  it('is idempotent and never creates webhook markers or reservation facts', async () => {
    const first = await f.confirm(), second = await f.confirm();
    expect(first).toEqual(second); expect(first.outcome).toBe('ACTIVE');
    expect(f.subscription.rows.size).toBe(1); expect(f.company.billingSubscriptionId).toBe(subscriptionId);
    expect(f.db.paddleWebhookEvent.create).not.toHaveBeenCalled(); expect(f.db.auditLog.create).not.toHaveBeenCalled();
    expect(f.db.$queryRaw.mock.calls.some(call => call[0].join('').includes('FOR UPDATE'))).toBe(true);
  });
  it.each([{ operationalStatus: 'SUSPENDED' as const }, { isActive: false }])('payment preserves administrative restriction %j', async change => {
    Object.assign(f.company, change);
    expect(await f.confirm()).toMatchObject({ outcome: 'PROCESSING', lifecycle: { workspaceAccessAllowed: false, company: change } });
    expect(f.subscription.rows.get(subscriptionId)?.status).toBe('active'); expect(f.company).toMatchObject(change);
  });
  it.each(['canceled', 'paused', 'past_due'] as const)('%s subscription grants no workspace access', async status => {
    f.setSubscription({ status });
    expect(await f.confirm()).toMatchObject({ outcome: 'PROCESSING', lifecycle: { workspaceAccessAllowed: false, subscription: { status } } });
  });
  it.each([
    { current_billing_period: null },
    { current_billing_period: { starts_at: at(-7200_000), ends_at: at(-3600_000) } },
    { current_billing_period: { starts_at: at(3600_000), ends_at: at(7200_000) } },
    { scheduled_change: { action: 'cancel' as const, effective_at: at(-1), resume_at: null } },
  ])('uses effective access windows: %j', async change => {
    f.setSubscription(change);
    expect(await f.confirm()).toMatchObject({ outcome: 'PROCESSING', lifecycle: { workspaceAccessAllowed: false } });
  });
  it('does not let a repeated stale read overwrite newer subscription facts', async () => {
    expect((await f.confirm()).outcome).toBe('ACTIVE');
    const current = f.subscription.rows.get(subscriptionId)!;
    f.subscription.rows.set(subscriptionId, { ...current, status: 'paused', paddleUpdatedAt: new Date(+now + 1000), lastEventAt: new Date(+now + 1000) });
    expect(await f.confirm()).toMatchObject({ outcome: 'PROCESSING', lifecycle: { subscription: { status: 'paused' }, workspaceAccessAllowed: false } });
  });
  it.each(['customer', 'subscription'] as const)('foreign %s mirror ownership is refused by shared fulfilment', async mirror => {
    if (mirror === 'customer') f.customer.rows.set(customerId, { id: customerId, companyId: 99 } as PaddleCustomer);
    else f.subscription.rows.set(subscriptionId, { id: subscriptionId, customerId, companyId: 99 } as PaddleSubscription);
    expect((await f.confirm()).outcome).toBe('PROCESSING'); grantsNothing();
    expect(f.logs[0]).toContain('FULFILLMENT_MISMATCH');
  });
  it('invalid provider version is a mismatch, never access', async () => {
    f.setSubscription({ updated_at: 'invalid' });
    expect((await f.confirm()).outcome).toBe('PROCESSING'); grantsNothing();
  });
  it.each(['replacement', 'customer', 'subscription', 'canceled'] as const)('rechecks %s under lock after provider reads', async change => {
    f.provider.subscriptions.get.mockImplementationOnce(async () => {
      if (change === 'replacement') f.rows.push(audit(20, 'CHECKOUT_RESERVED', selection));
      if (change === 'customer') f.company.billingCustomerId = otherCustomer;
      if (change === 'subscription') f.company.billingSubscriptionId = otherSubscription;
      if (change === 'canceled') f.rows.push(audit(12, 'CHECKOUT_CANCELED', { reservationId: 10, transactionId }));
      return new Subscription(subscriptionData());
    });
    expect((await f.confirm()).outcome).toBe('PROCESSING');
    expect(f.subscription.upsert).not.toHaveBeenCalled(); expect(f.db.company.update).not.toHaveBeenCalled();
    expect(f.logs[0]).toContain('RESERVATION_CHANGED');
  });
  it('rechecks the active owner under lock after provider reads', async () => {
    f.provider.subscriptions.get.mockImplementationOnce(async () => { f.owner.id = 9; return new Subscription(subscriptionData()); });
    await expect(f.confirm()).rejects.toMatchObject({ statusCode: 403 }); grantsNothing();
  });
});

describe('unavailable reads and safe failures', () => {
  it.each(['transactions', 'subscriptions'] as const)('uncertain %s read returns sanitized 503', async operation => {
    f.provider[operation].get.mockRejectedValueOnce(new Error('sensitive email@example.invalid token payload'));
    await expect(f.confirm()).rejects.toMatchObject({ statusCode: 503, message: 'Billing confirmation is unavailable. Please keep waiting and try again.' });
    grantsNothing(); expect(f.logs.join('')).not.toContain('sensitive');
  });
  it.each(['UNCERTAIN', 'REJECTED', 'RATE_LIMITED'] as const)('gateway %s is not evidence of an unpaid checkout', async classification => {
    f.provider.transactions.get.mockRejectedValueOnce(new BillingProviderError('transactions.get', { classification, providerCode: 'fixture_code', customerId: null }));
    await expect(f.confirm()).rejects.toMatchObject({ statusCode: 503 }); grantsNothing();
  });
  it('propagates database failure rather than reporting success', async () => {
    f.db.$transaction.mockRejectedValueOnce(new Error('fixture database unavailable'));
    await expect(f.confirm()).rejects.toThrow('fixture database unavailable'); grantsNothing();
  });
  it('logs no sensitive custom data on a mismatch', async () => {
    f.setTransaction({ custom_data: { checkoutReservationId: 99, email: 'private@example.invalid', card: 'sensitive-fixture' } });
    const result = await f.confirm();
    expect(result.outcome).toBe('PROCESSING');
    expect(JSON.stringify({ result, logs: f.logs })).not.toMatch(/private@example|sensitive-fixture/); grantsNothing();
  });
  it('never hides unrelated access-reader failures', async () => {
    f.rows.length = 0;
    f.db.company.findUnique.mockRejectedValueOnce(new ApiError(500, 'fixture read failure'));
    await expect(f.confirm()).rejects.toMatchObject({ statusCode: 500 });
  });
});
