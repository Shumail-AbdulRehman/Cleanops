import type { AuditLog } from '@prisma/client';
import type { Customer } from '@paddle/paddle-node-sdk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('../prisma/prisma.js', () => ({ prisma: {} }));
import { ensureBillingCustomer } from './billingCustomer.service.js';
import { BillingProviderError, BILLING_PROVIDER_TIMEOUT_MS, createBillingProvider, type BillingProviderClient,
    type BillingProviderFailureClass } from './billingProvider.js';
import { readBillingReservation } from './billingReservations.service.js';

const actor = { id: 1, companyId: 42, role: 'ADMIN' as const };
const now = new Date('2026-11-09T12:00:00Z');
const customerId = 'ctm_00000000000000000000000001';
const otherId = 'ctm_00000000000000000000000002';
const customer = (change: Partial<Customer> = {}): Customer => ({ id: customerId, email: 'Owner@example.invalid', name: 'Owner',
    status: 'active', createdAt: '2026-11-08T12:00:00Z', updatedAt: now.toISOString(), customData: null, locale: 'en',
    marketingConsent: false, importMeta: null, ...change });
const failure = (classification: BillingProviderFailureClass, providerCode: string | null = null, id: string | null = null) =>
    new BillingProviderError('customers.create', { classification, providerCode, customerId: id });

// Transactions serialize only after FOR UPDATE. Rollback restores persisted
// state, so tests exercise the real facts service and atomic mirror/link/facts.
function fixture() {
    const rows: AuditLog[] = [];
    const company = { id: 42, billingCustomerId: null as string | null, billingSubscriptionId: null as string | null,
        isActive: true, operationalStatus: 'ACTIVE' };
    const owner = { id: 1, email: 'owner@example.invalid', name: 'Owner', emailVerifiedAt: null as Date | null, company };
    type Mirror = { id: string; companyId: number | null; status: string; email?: string; name?: string | null;
        paddleUpdatedAt?: Date; lastEventAt?: Date; paddleCreatedAt?: Date };
    const mirrors: Mirror[] = [];
    const canonical: { id: number; billingCustomerId: string }[] = [];
    const events: string[] = [];
    type Where = Record<string, unknown>;
    function matching(where: Where) {
        return rows.filter(row => Object.entries(where).every(([key, value]) => {
            if (key === 'action' && typeof value === 'object') return (value as { in: string[] }).in.includes(row.action);
            if (key === 'newValue') return (row.newValue as { reservationId?: number } | null)?.reservationId === (value as { equals: number }).equals;
            return row[key as keyof AuditLog] === value;
        })).sort((a, b) => b.id - a.id);
    }
    const auditLog = {
        findFirst: vi.fn(async ({ where }: { where: Where }) => structuredClone(matching(where)[0] ?? null)),
        findMany: vi.fn(async ({ where }: { where: Where }) => structuredClone(matching(where))),
        create: vi.fn(async ({ data }: { data: Omit<AuditLog, 'id' | 'createdAt'> }) => {
            events.push(data.action);
            const row = { ...data, id: Math.max(0, ...rows.map(row => row.id)) + 1, createdAt: now };
            rows.push(row); return structuredClone(row);
        }),
    };
    const manager = { findFirst: vi.fn(async () => structuredClone(owner)) };
    const paddleCustomer = {
        findUnique: vi.fn(async ({ where }: { where: { id?: string; companyId?: number } }) =>
            structuredClone(mirrors.find(row => Object.entries(where).every(([key, value]) => row[key as keyof Mirror] === value)) ?? null)),
        upsert: vi.fn(async ({ where, create, update }: { where: { id: string }; create: Mirror; update: Partial<Mirror> }) => {
            events.push('mirror');
            const existing = mirrors.find(row => row.id === where.id);
            if (existing) Object.assign(existing, update);
            else mirrors.push(structuredClone(create));
        }),
    };
    const companyDb = {
        findUnique: vi.fn(async ({ where }: { where: { billingCustomerId: string } }) =>
            structuredClone([company, ...canonical].find(row => row.billingCustomerId === where.billingCustomerId) ?? null)),
        update: vi.fn(async ({ data }: { data: Partial<typeof company> }) => { events.push('link'); Object.assign(company, data); }),
    };
    let queue = Promise.resolve();
    const raw = vi.fn();
    const dbObject = { auditLog, manager, paddleCustomer, company: companyDb, paddleTransaction: {},
        $transaction: vi.fn(async (run: (tx: unknown) => Promise<unknown>) => {
            let release: (() => void) | undefined;
            let snapshot: { rows: AuditLog[]; company: typeof company; mirrors: Mirror[] } | undefined;
            const tx = { auditLog, manager, paddleCustomer, company: companyDb, paddleTransaction: {},
                $queryRaw: async (strings: TemplateStringsArray, id: number) => {
                    raw(strings, id);
                    if (release) return [{ id }]; // PostgreSQL row locks are reentrant in one transaction.
                    const prior = queue;
                    queue = new Promise<void>(resolve => { release = resolve; });
                    await prior;
                    events.push('lock');
                    snapshot = structuredClone({ rows, company, mirrors });
                    return [{ id }];
                },
            };
            try { return await run(tx); }
            catch (error) {
                if (snapshot) {
                    rows.splice(0, rows.length, ...snapshot.rows);
                    mirrors.splice(0, mirrors.length, ...snapshot.mirrors);
                    Object.assign(company, snapshot.company);
                }
                throw error;
            } finally { release?.(); events.push('release'); }
        }),
    };
    const provider = { customers: {
        create: vi.fn(async (_body: unknown) => { events.push('provider'); return customer(); }),
        list: vi.fn(async (_query: unknown) => ({ data: [customer()], hasMore: false })),
    } };
    const deps = { db: dbObject as unknown as NonNullable<Parameters<typeof ensureBillingCustomer>[1]>['db'], provider, now: () => now };
    const run = () => ensureBillingCustomer(actor, deps);
    const state = () => readBillingReservation(company, 'CUSTOMER_CREATE', deps);
    const conflict = () => provider.customers.create.mockRejectedValueOnce(failure('CUSTOMER_EXISTS', 'customer_already_exists', otherId));
    const actions = () => rows.map(row => row.action);
    return { rows, company, owner, mirrors, canonical, auditLog, manager, paddleCustomer, companyDb, raw, dbObject,
        provider, deps, run, state, conflict, actions, events };
}
let f: ReturnType<typeof fixture>;
beforeEach(() => { f = fixture(); vi.stubEnv('PADDLE_ENVIRONMENT', 'sandbox'); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });

describe('company-scoped customer creation', () => {
    it('reuses a linked customer without creating a reservation or calling Paddle', async () => {
        f.company.billingCustomerId = customerId;
        f.mirrors.push({ id: customerId, companyId: 42, status: 'active' });
        expect(await f.run()).toBe(customerId);
        expect(f.rows).toEqual([]);
        expect(f.provider.customers.create).not.toHaveBeenCalled();
        expect(f.provider.customers.list).not.toHaveBeenCalled();
        expect(f.raw.mock.calls[0][0].join('?')).toBe('SELECT id FROM "Company" WHERE id=? FOR UPDATE');
        expect(f.raw.mock.calls[0][1]).toBe(42);
    });
    it.each([null, 99])('refuses reuse of a missing or foreign mirror (%s)', async companyId => {
        f.company.billingCustomerId = customerId;
        if (companyId !== null) f.mirrors.push({ id: customerId, companyId, status: 'active' });
        await expect(f.run()).rejects.toMatchObject({ statusCode: 503 });
        expect(f.rows).toEqual([]);
        expect(f.provider.customers.create).not.toHaveBeenCalled();
    });
    it('commits a reservation before sending company and reservation custom data, then links atomically', async () => {
        expect(await f.run()).toBe(customerId);
        expect(f.provider.customers.create).toHaveBeenCalledExactlyOnceWith({ email: 'owner@example.invalid', name: 'Owner',
            customData: { companyId: 42, customerReservationId: 1 } });
        expect(f.events.indexOf('CUSTOMER_CREATE_RESERVED')).toBeLessThan(f.events.indexOf('provider'));
        expect(f.events.indexOf('release')).toBeLessThan(f.events.indexOf('provider'));
        expect(f.events.slice(f.events.indexOf('mirror'), f.events.indexOf('mirror') + 3)).toEqual(['mirror', 'link', 'CUSTOMER_CREATE_READY']);
        expect(f.company.billingCustomerId).toBe(customerId);
        expect(f.company.billingSubscriptionId).toBeNull();
        expect(f.mirrors).toEqual([{ id: customerId, companyId: 42, email: customer().email, name: 'Owner', status: 'active',
            paddleUpdatedAt: now, lastEventAt: now, paddleCreatedAt: new Date(customer().createdAt) }]);
        expect(f.rows[1].newValue).toEqual({ reservationId: 1, customerId });
        expect(await f.state()).toMatchObject({ kind: 'closed', fact: { action: 'CUSTOMER_CREATE_READY' } });
        expect(await f.run()).toBe(customerId);
        expect(f.provider.customers.create).toHaveBeenCalledTimes(1);
    });
    it.each(['REJECTED', 'RATE_LIMITED'] as const)('%s records a failure and permits a fresh retry', async classification => {
        const code = classification === 'REJECTED' ? 'invalid_email' : 'too_many_requests';
        f.provider.customers.create.mockRejectedValueOnce(failure(classification, code));
        await expect(f.run()).rejects.toMatchObject({ statusCode: 503 });
        expect(f.rows[1].newValue).toEqual({ reservationId: 1, code });
        expect(await f.state()).toMatchObject({ kind: 'closed', fact: { action: 'CUSTOMER_CREATE_FAILED' } });
        expect(await f.run()).toBe(customerId);
        expect(f.actions()).toEqual(['CUSTOMER_CREATE_RESERVED', 'CUSTOMER_CREATE_FAILED', 'CUSTOMER_CREATE_RESERVED', 'CUSTOMER_CREATE_READY']);
        expect(f.provider.customers.create.mock.calls[1][0]).toMatchObject({ customData: { customerReservationId: 3 } });
    });
    it('uses a safe classification when rejection has no provider code', async () => {
        f.provider.customers.create.mockRejectedValueOnce(failure('REJECTED'));
        await expect(f.run()).rejects.toMatchObject({ statusCode: 503 });
        expect(f.rows[1].newValue).toEqual({ reservationId: 1, code: 'REJECTED' });
    });
    it.each([
        { id: 'ctm_bad' }, { status: 'archived' as const }, { email: 'other@example.invalid' },
        { createdAt: 'bad-date' }, { updatedAt: 'bad-date' },
    ])('invalid create response %j stays reserved', async change => {
        f.provider.customers.create.mockResolvedValueOnce(customer(change));
        await expect(f.run()).rejects.toMatchObject({ statusCode: 503 });
        expect(f.actions()).toEqual(['CUSTOMER_CREATE_RESERVED']);
        expect(f.mirrors).toEqual([]);
        expect(f.company.billingCustomerId).toBeNull();
    });
    it('does not create twice for concurrent requests sharing a company', async () => {
        let finish!: (value: Customer) => void, started!: () => void;
        const entered = new Promise<void>(resolve => { started = resolve; });
        f.provider.customers.create.mockImplementationOnce(() => { started(); return new Promise(resolve => { finish = resolve; }); });
        const first = f.run();
        await entered;
        await expect(f.run()).rejects.toMatchObject({ statusCode: 409, errors: [{ code: 'IN_PROGRESS' }] });
        expect(f.provider.customers.create).toHaveBeenCalledTimes(1);
        finish(customer());
        expect(await first).toBe(customerId);
        expect(f.actions()).toEqual(['CUSTOMER_CREATE_RESERVED', 'CUSTOMER_CREATE_READY']);
    });
});

describe('exact-email adoption', () => {
    it.each([
        ['sandbox', null], ['sandbox', now], ['production', now],
    ] as const)('adopts an exact active unlinked match in %s with verification %s', async (environment, verification) => {
        vi.stubEnv('PADDLE_ENVIRONMENT', environment);
        f.owner.emailVerifiedAt = verification;
        f.conflict();
        expect(await f.run()).toBe(customerId);
        expect(f.provider.customers.list).toHaveBeenCalledExactlyOnceWith({ email: 'owner@example.invalid', status: ['active', 'archived'] });
        expect(f.rows[1].newValue).toEqual({ reservationId: 1, customerId, adopted: true });
        expect(f.company.billingCustomerId).toBe(customerId);
    });
    it('attaches an unlinked mirror while preserving newer webhook data', async () => {
        const later = new Date(+now + 1_000);
        f.mirrors.push({ id: customerId, companyId: null, status: 'active', email: 'newer@example.invalid', lastEventAt: later });
        f.conflict();
        expect(await f.run()).toBe(customerId);
        expect(f.mirrors[0]).toMatchObject({ companyId: 42, email: 'newer@example.invalid', lastEventAt: later });
    });
    it.each([
        ['no match', []], ['archived', [customer({ status: 'archived' })]],
        ['different email', [customer({ email: 'someone@example.invalid' })]],
        ['whitespace differs', [customer({ email: ' owner@example.invalid' })]],
        ['invalid ID', [customer({ id: 'ctm_bad' })]],
        ['ambiguous', [customer(), customer({ id: otherId })]],
        ['active and archived', [customer(), customer({ id: otherId, status: 'archived' })]],
    ] as const)('%s records EMAIL_CONFLICT without linking', async (_label, data) => {
        f.conflict();
        f.provider.customers.list.mockResolvedValueOnce({ data: [...data], hasMore: false });
        await expect(f.run()).rejects.toMatchObject({ statusCode: 409, errors: [{ code: 'EMAIL_CONFLICT' }] });
        expect(f.rows[1].newValue).toEqual({ reservationId: 1, code: 'EMAIL_CONFLICT' });
        expect(await f.state()).toMatchObject({ kind: 'closed' });
        expect(f.company.billingCustomerId).toBeNull();
        expect(f.paddleCustomer.upsert).not.toHaveBeenCalled();
    });
    it.each(['mirror', 'canonical', 'company mirror', 'archived mirror'] as const)('refuses an unsafe %s linkage', async kind => {
        if (kind === 'mirror') f.mirrors.push({ id: customerId, companyId: 99, status: 'active' });
        if (kind === 'canonical') f.canonical.push({ id: 99, billingCustomerId: customerId });
        if (kind === 'company mirror') f.mirrors.push({ id: otherId, companyId: 42, status: 'active' });
        if (kind === 'archived mirror') f.mirrors.push({ id: customerId, companyId: null, status: 'archived' });
        const before = structuredClone(f.mirrors);
        f.conflict();
        await expect(f.run()).rejects.toMatchObject({ statusCode: 409, errors: [{ code: 'EMAIL_CONFLICT' }] });
        expect(f.mirrors).toEqual(before);
        expect(f.company.billingCustomerId).toBeNull();
        expect(f.actions()).toEqual(['CUSTOMER_CREATE_RESERVED', 'CUSTOMER_CREATE_FAILED']);
    });
    it('confirms through a list even when the conflict error contains no customer ID', async () => {
        f.provider.customers.create.mockRejectedValueOnce(failure('CUSTOMER_EXISTS', 'customer_already_exists'));
        expect(await f.run()).toBe(customerId);
        expect(f.provider.customers.list).toHaveBeenCalledTimes(1);
    });
    it.each(['email', 'verification', 'company link'] as const)('rechecks %s after the provider call', async kind => {
        vi.stubEnv('PADDLE_ENVIRONMENT', 'production');
        f.owner.emailVerifiedAt = now;
        f.conflict();
        f.provider.customers.list.mockImplementationOnce(async () => {
            if (kind === 'email') f.owner.email = 'changed@example.invalid';
            if (kind === 'verification') f.owner.emailVerifiedAt = null;
            if (kind === 'company link') f.company.billingCustomerId = otherId;
            return { data: [customer()], hasMore: false };
        });
        await expect(f.run()).rejects.toMatchObject({ statusCode: 409, errors: [{ code: 'EMAIL_CONFLICT' }] });
        expect(f.actions()).toEqual(['CUSTOMER_CREATE_RESERVED', 'CUSTOMER_CREATE_FAILED']);
        expect(f.paddleCustomer.upsert).not.toHaveBeenCalled();
    });
});

describe('uncertainty, authorization and atomicity', () => {
    it.each([failure('UNCERTAIN'), new Error('private token and email'), { classification: 'REJECTED' }])('unknown or uncertain failure stays open: %#', async error => {
        f.provider.customers.create.mockRejectedValueOnce(error);
        await expect(f.run()).rejects.toMatchObject({ statusCode: 503, errors: [{ code: 'CUSTOMER_UNRESOLVED' }] });
        expect(f.actions()).toEqual(['CUSTOMER_CREATE_RESERVED']);
        expect(await f.state()).toMatchObject({ kind: 'inProgress' });
        await expect(f.run()).rejects.toMatchObject({ statusCode: 409 });
        expect(f.provider.customers.create).toHaveBeenCalledTimes(1);
        expect(f.provider.customers.list).not.toHaveBeenCalled();
    });
    it.each(['read failed', 'page cap'] as const)('an inconclusive conflict search (%s) stays open', async kind => {
        f.conflict();
        if (kind === 'read failed') f.provider.customers.list.mockRejectedValueOnce(failure('UNCERTAIN'));
        else f.provider.customers.list.mockResolvedValueOnce({ data: [customer()], hasMore: true });
        await expect(f.run()).rejects.toMatchObject({ statusCode: 503 });
        expect(f.actions()).toEqual(['CUSTOMER_CREATE_RESERVED']);
        expect(f.paddleCustomer.upsert).not.toHaveBeenCalled();
    });
    it('a real gateway deadline leaves the reservation open, including after a late success and the grace period', async () => {
        vi.useFakeTimers();
        let finish!: (value: Customer) => void;
        const create = vi.fn(() => new Promise<Customer>(resolve => { finish = resolve; }));
        const gateway = createBillingProvider({ client: { customers: { create } } as unknown as BillingProviderClient, log: vi.fn() });
        const pending = ensureBillingCustomer(actor, { ...f.deps, provider: gateway });
        const checked = expect(pending).rejects.toMatchObject({ statusCode: 503 });
        await vi.advanceTimersByTimeAsync(BILLING_PROVIDER_TIMEOUT_MS);
        await checked;
        finish(customer());
        await vi.advanceTimersByTimeAsync(120_000);
        expect(f.actions()).toEqual(['CUSTOMER_CREATE_RESERVED']);
        expect(f.company.billingCustomerId).toBeNull();
        await expect(ensureBillingCustomer(actor, { ...f.deps, provider: gateway, now: () => new Date(+now + 120_000) }))
            .rejects.toMatchObject({ statusCode: 409, errors: [{ code: 'RECONCILIATION_REQUIRED' }] });
        expect(create).toHaveBeenCalledTimes(1);
    });
    it.each(['not owner', 'missing owner', 'foreign company', 'inactive company', 'suspended company', 'unverified live owner'] as const)
        ('rejects %s before any provider call', async kind => {
            if (kind === 'missing owner') f.manager.findFirst.mockResolvedValueOnce(null as unknown as typeof f.owner);
            if (kind === 'foreign company') f.owner.company.id = 99;
            if (kind === 'inactive company') f.company.isActive = false;
            if (kind === 'suspended company') f.company.operationalStatus = 'SUSPENDED';
            if (kind === 'unverified live owner') vi.stubEnv('PADDLE_ENVIRONMENT', 'production');
            await expect(ensureBillingCustomer({ ...actor, role: kind === 'not owner' ? 'MANAGER' : 'ADMIN' }, f.deps)).rejects.toMatchObject({ statusCode: 403 });
            expect(f.rows).toEqual([]);
            expect(f.provider.customers.create).not.toHaveBeenCalled();
        });
    it.each(['mirror', 'READY'] as const)('%s persistence failure rolls back linkage and leaves the reservation open', async kind => {
        if (kind === 'mirror') f.paddleCustomer.upsert.mockRejectedValueOnce(new Error('database write failed'));
        else {
            const append = f.auditLog.create.getMockImplementation()!;
            f.auditLog.create.mockImplementation(async args => {
                if (args.data.action === 'CUSTOMER_CREATE_READY') throw new Error('audit unavailable');
                return append(args);
            });
        }
        await expect(f.run()).rejects.toThrow();
        expect(f.company.billingCustomerId).toBeNull();
        expect(f.mirrors).toEqual([]);
        expect(f.actions()).toEqual(['CUSTOMER_CREATE_RESERVED']);
        await expect(f.run()).rejects.toMatchObject({ statusCode: 409 });
        expect(f.provider.customers.create).toHaveBeenCalledTimes(1);
    });
    it('does not overwrite a different company linkage created during a successful provider write', async () => {
        f.provider.customers.create.mockImplementationOnce(async () => { f.company.billingCustomerId = otherId; return customer(); });
        await expect(f.run()).rejects.toMatchObject({ statusCode: 503 });
        expect(f.company.billingCustomerId).toBe(otherId);
        expect(f.actions()).toEqual(['CUSTOMER_CREATE_RESERVED']);
    });
    it('rechecks suspension before linking a successful provider write', async () => {
        f.provider.customers.create.mockImplementationOnce(async () => { f.company.operationalStatus = 'SUSPENDED'; return customer(); });
        await expect(f.run()).rejects.toMatchObject({ statusCode: 403 });
        expect(f.company.billingCustomerId).toBeNull();
        expect(f.actions()).toEqual(['CUSTOMER_CREATE_RESERVED']);
    });
});
