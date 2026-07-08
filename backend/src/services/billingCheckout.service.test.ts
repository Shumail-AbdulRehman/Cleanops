import type { AuditLog } from '@prisma/client';
import type { Customer, Price, Product, Transaction } from '@paddle/paddle-node-sdk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('../prisma/prisma.js', () => ({ prisma: {} }));
import { createBillingCheckout } from './billingCheckout.service.js';
import { BILLING_PROVIDER_TIMEOUT_MS, BillingProviderError, createBillingProvider,
    type BillingProviderClient, type BillingProviderFailureClass } from './billingProvider.js';
import { readBillingReservation } from './billingReservations.service.js';

const actor = { id: 1, companyId: 42, role: 'ADMIN' as const };
const now = new Date('2026-11-10T12:00:00Z');
const customerId = 'ctm_00000000000000000000000001';
const otherCustomerId = 'ctm_00000000000000000000000002';
const firstId = 'txn_00000000000000000000000001';
const secondId = 'txn_00000000000000000000000002';
const starter = { plan: 'STARTER', interval: 'month' } as const;
const pro = { plan: 'PRO', interval: 'year' } as const;
const entries = [
    { ...starter, priceId: 'pri_00000000000000000000000001' },
    { ...pro, priceId: 'pri_00000000000000000000000002' },
    { plan: 'STARTER', interval: 'year', priceId: 'pri_00000000000000000000000003' },
];
const transaction = (change: Partial<Transaction> = {}) => ({ id: firstId, customerId, status: 'draft', subscriptionId: null,
    customData: null, ...change } as Transaction);
const failure = (classification: BillingProviderFailureClass, providerCode: string | null = null) =>
    new BillingProviderError('transactions.create', { classification, providerCode, customerId: null });

// The real reservation/customer/catalog helpers run against this shared fake.
// Transactions serialize on FOR UPDATE and roll back local writes, but never
// roll back remote provider effects. This models a lost cancellation response.
function fixture() {
    const rows: AuditLog[] = [];
    const company = { id: 42, billingCustomerId: customerId as string | null, billingSubscriptionId: null as string | null,
        isActive: true, operationalStatus: 'ACTIVE' };
    const owner = { id: 1, email: 'owner@example.invalid', name: 'Owner', emailVerifiedAt: null as Date | null, company };
    type CustomerMirror = { id: string; companyId: number | null; status: string };
    const customers: CustomerMirror[] = [{ id: customerId, companyId: 42, status: 'active' }];
    const mirrors: { id: string; companyId: number; customerId: string; status: string; subscriptionId?: string | null }[] = [];
    const remote = new Map<string, Transaction>();
    const events: string[] = [];
    type Where = Record<string, unknown>;
    const matching = (where: Where) => rows.filter(row => Object.entries(where).every(([key, value]) => {
        if (key === 'action' && typeof value === 'object') return (value as { in: string[] }).in.includes(row.action);
        if (key === 'newValue') return (row.newValue as { reservationId?: number } | null)?.reservationId === (value as { equals: number }).equals;
        return row[key as keyof AuditLog] === value;
    })).sort((a, b) => b.id - a.id);
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
            structuredClone(customers.find(row => Object.entries(where).every(([key, value]) => row[key as keyof CustomerMirror] === value)) ?? null)),
        upsert: vi.fn(async ({ create }: { create: CustomerMirror }) => { customers.push(create); }),
    };
    const paddleTransaction = { findFirst: vi.fn(async ({ where }: { where: { id: string } }) =>
        structuredClone(mirrors.find(row => row.id === where.id) ?? null)) };
    const companyDb = {
        findUnique: vi.fn(async ({ where }: { where: { billingCustomerId: string } }) => company.billingCustomerId === where.billingCustomerId ? company : null),
        update: vi.fn(async ({ data }: { data: Partial<typeof company> }) => { Object.assign(company, data); }),
    };
    let queue = Promise.resolve();
    const raw = vi.fn();
    const dbObject = { manager, auditLog, paddleCustomer, paddleTransaction, company: companyDb,
        $transaction: vi.fn(async (run: (tx: unknown) => Promise<unknown>, _options?: unknown) => {
            let release: (() => void) | undefined;
            let snapshot: { rows: AuditLog[]; company: typeof company; customers: CustomerMirror[] } | undefined;
            const tx = { manager, auditLog, paddleCustomer, paddleTransaction, company: companyDb,
                $queryRaw: async (strings: TemplateStringsArray, id: number) => {
                    raw(strings, id);
                    if (release) return [{ id }];
                    const prior = queue;
                    queue = new Promise<void>(resolve => { release = resolve; });
                    await prior;
                    events.push('lock'); snapshot = structuredClone({ rows, company, customers });
                    return [{ id }];
                },
            };
            try { return await run(tx); }
            catch (error) {
                if (snapshot) {
                    rows.splice(0, rows.length, ...snapshot.rows);
                    customers.splice(0, customers.length, ...snapshot.customers);
                    Object.assign(company, snapshot.company);
                }
                throw error;
            } finally { release?.(); events.push('release'); }
        }),
    };
    let sequence = 0;
    const provider = {
        prices: { get: vi.fn(async (id: string) => ({ id, productId: 'pro_product', status: 'active', trialPeriod: null,
            billingCycle: { interval: entries.find(entry => entry.priceId === id)!.interval, frequency: 1 },
            unitPrice: { amount: '1000', currencyCode: 'USD' } } as Price)) },
        products: { get: vi.fn(async () => ({ id: 'pro_product', status: 'active' } as Product)) },
        customers: {
            create: vi.fn(async (_body: unknown) => ({ id: customerId, status: 'active', email: owner.email,
                createdAt: now.toISOString(), updatedAt: now.toISOString() } as Customer)),
            list: vi.fn(async () => ({ data: [] as Customer[], hasMore: false })),
        },
        transactions: {
            create: vi.fn(async (body: unknown) => {
                events.push('create');
                const id = `txn_${String(++sequence).padStart(26, '0')}`;
                const draft = transaction({ id, customData: (body as { customData: Transaction['customData'] }).customData });
                remote.set(id, draft); return structuredClone(draft);
            }),
            get: vi.fn(async (id: string) => { events.push('get'); return structuredClone(remote.get(id)!); }),
            update: vi.fn(async (id: string, _body: unknown) => {
                events.push('cancel'); const canceled = transaction({ ...remote.get(id), status: 'canceled' });
                remote.set(id, canceled); return structuredClone(canceled);
            }),
            list: vi.fn(async () => ({ data: [] as Transaction[], hasMore: false })),
        },
    };
    const deps = { db: dbObject as unknown as NonNullable<Parameters<typeof createBillingCheckout>[2]>['db'], provider, now: () => now };
    const run = (input: unknown = starter) => createBillingCheckout(actor, input, deps);
    const state = () => readBillingReservation(company, 'CHECKOUT', deps);
    const actions = () => rows.map(row => row.action);
    return { rows, company, owner, customers, mirrors, remote, events, manager, auditLog, raw, dbObject, provider, deps, run, state, actions };
}
let f: ReturnType<typeof fixture>;
beforeEach(() => {
    f = fixture();
    vi.stubEnv('PADDLE_ENVIRONMENT', 'sandbox');
    vi.stubEnv('PADDLE_BILLING_ENABLED', 'true');
    vi.stubEnv('PADDLE_API_KEY', 'test-only-credential-'.repeat(3));
    vi.stubEnv('PADDLE_PRICE_CATALOG_JSON', JSON.stringify(entries));
    vi.stubEnv('PADDLE_CHECKOUT_URL', 'https://checkout.example.invalid/pay');
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });

describe('prepare and reuse', () => {
    it('reserves before creating and returns all flags without granting access', async () => {
        expect(await f.run()).toEqual({ transactionId: firstId, reused: false, replaced: false });
        expect(f.provider.transactions.create).toHaveBeenCalledExactlyOnceWith({ collectionMode: 'automatic', customerId,
            items: [{ priceId: entries[0].priceId, quantity: 1 }],
            customData: { checkoutReservationId: 1 } });
        expect(f.provider.transactions.create.mock.calls[0][0]).not.toHaveProperty('status');
        // An inline checkout opens by transaction ID. A checkout URL needs a Paddle-approved domain.
        expect(f.provider.transactions.create.mock.calls[0][0]).not.toHaveProperty('checkout');
        expect(f.events.indexOf('CHECKOUT_RESERVED')).toBeLessThan(f.events.indexOf('create'));
        expect(f.events.indexOf('release', f.events.indexOf('CHECKOUT_RESERVED'))).toBeLessThan(f.events.indexOf('create'));
        expect(f.rows[1].newValue).toEqual({ reservationId: 1, transactionId: firstId, customerId });
        expect(f.actions()).toEqual(['CHECKOUT_RESERVED', 'CHECKOUT_READY']);
        expect(f.company.billingSubscriptionId).toBeNull();
        expect(f.mirrors).toEqual([]);
        expect(f.raw.mock.calls.every(call => call[0].join('?') === 'SELECT id FROM "Company" WHERE id=? FOR UPDATE' && call[1] === 42)).toBe(true);
    });
    it.each(['draft', 'ready'] as const)('reuses the same %s draft without another provider write', async status => {
        await f.run(); f.remote.set(firstId, transaction({ status, customData: { checkoutReservationId: 1 } }));
        const before = structuredClone(f.rows);
        expect(await f.run()).toEqual({ transactionId: firstId, reused: true, replaced: false });
        expect(f.rows).toEqual(before);
        expect(f.provider.transactions.create).toHaveBeenCalledTimes(1);
        expect(f.provider.transactions.update).not.toHaveBeenCalled();
    });
    it('delegates a missing customer to the shared customer service', async () => {
        f.company.billingCustomerId = null; f.customers.length = 0;
        expect(await f.run()).toMatchObject({ transactionId: firstId });
        expect(f.actions()).toEqual(['CUSTOMER_CREATE_RESERVED', 'CUSTOMER_CREATE_READY', 'CHECKOUT_RESERVED', 'CHECKOUT_READY']);
        expect(f.provider.customers.create).toHaveBeenCalledExactlyOnceWith({ email: f.owner.email, name: f.owner.name,
            customData: { companyId: 42, customerReservationId: 1 } });
        expect(f.provider.transactions.create.mock.calls[0][0]).toMatchObject({ customData: { checkoutReservationId: 3 } });
    });
    it('two concurrent prepares share one draft reservation', async () => {
        const results = await Promise.allSettled([f.run(), f.run()]);
        expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
        expect(results.find(result => result.status === 'rejected')).toMatchObject({ reason: { statusCode: 409, errors: [{ code: 'IN_PROGRESS' }] } });
        expect(f.provider.transactions.create).toHaveBeenCalledTimes(1);
        expect(f.actions()).toEqual(['CHECKOUT_RESERVED', 'CHECKOUT_READY']);
        expect(await f.run()).toMatchObject({ transactionId: firstId, reused: true });
    });
});

describe('replacement', () => {
    it.each(['draft', 'ready'] as const)('cancels %s with status alone before reserving and creating the new plan', async status => {
        await f.run(); f.remote.set(firstId, transaction({ status }));
        expect(await f.run(pro)).toEqual({ transactionId: secondId, reused: false, replaced: true });
        expect(f.provider.transactions.get).toHaveBeenCalledExactlyOnceWith(firstId);
        expect(f.provider.transactions.update).toHaveBeenCalledExactlyOnceWith(firstId, { status: 'canceled' });
        expect(f.actions()).toEqual(['CHECKOUT_RESERVED', 'CHECKOUT_READY', 'CHECKOUT_CANCELED', 'CHECKOUT_RESERVED', 'CHECKOUT_READY']);
        expect(f.rows[2].newValue).toEqual({ reservationId: 1, transactionId: firstId });
        expect(f.rows[3].newValue).toEqual(entries[1]);
        expect(f.events.slice(f.events.indexOf('cancel')).filter(event => !['lock', 'release'].includes(event)))
            .toEqual(['cancel', 'CHECKOUT_CANCELED', 'CHECKOUT_RESERVED', 'create', 'CHECKOUT_READY']);
        expect(f.provider.transactions.create.mock.calls[1][0]).toMatchObject({ items: [{ priceId: entries[1].priceId, quantity: 1 }],
            customData: { checkoutReservationId: 4 } });
    });
    it('replaces an interval change on the same plan', async () => {
        await f.run(); expect(await f.run({ ...starter, interval: 'year' })).toMatchObject({ replaced: true });
        expect(f.provider.transactions.update).toHaveBeenCalledTimes(1);
    });
    it('does not repeat cancellation when Paddle already proves the old draft canceled', async () => {
        await f.run(); f.remote.set(firstId, transaction({ status: 'canceled' }));
        expect(await f.run(pro)).toMatchObject({ transactionId: secondId, replaced: true });
        expect(f.provider.transactions.update).not.toHaveBeenCalled();
        expect(f.actions()[2]).toBe('CHECKOUT_CANCELED');
    });
    it.each(['paid', 'billed', 'completed'] as const)('a provider %s draft blocks any new purchase', async status => {
        await f.run(); f.remote.set(firstId, transaction({ status })); const before = structuredClone(f.rows);
        await expect(f.run(pro)).rejects.toMatchObject({ statusCode: 409, errors: [{ code: 'CHECKOUT_PAID' }] });
        expect(f.rows).toEqual(before); expect(f.provider.transactions.update).not.toHaveBeenCalled();
        expect(f.provider.transactions.create).toHaveBeenCalledTimes(1);
    });
    it.each(['paid', 'billed', 'completed'])('a mirrored %s draft is blocked before a provider read', async status => {
        await f.run(); f.mirrors.push({ id: firstId, companyId: 42, customerId, status });
        await expect(f.run(pro)).rejects.toMatchObject({ statusCode: 409, errors: [{ code: 'CHECKOUT_PAID' }] });
        expect(f.provider.transactions.get).not.toHaveBeenCalled(); expect(f.provider.transactions.create).toHaveBeenCalledTimes(1);
    });
    it('also refuses to reuse a checkout that has been paid', async () => {
        await f.run(); f.remote.set(firstId, transaction({ status: 'paid' }));
        await expect(f.run()).rejects.toMatchObject({ statusCode: 409, errors: [{ code: 'CHECKOUT_PAID' }] });
    });
    it.each([failure('UNCERTAIN'), failure('REJECTED'), new Error('private provider detail')])('an unsuccessful cancel changes no local facts: %#', async error => {
        await f.run(); const before = structuredClone(f.rows);
        f.provider.transactions.update.mockRejectedValueOnce(error);
        await expect(f.run(pro)).rejects.toMatchObject({ statusCode: 503 });
        expect(f.rows).toEqual(before); expect(f.remote.get(firstId)?.status).toBe('draft');
        expect(f.provider.transactions.create).toHaveBeenCalledTimes(1);
    });
    it('a lost cancel response cannot create another draft, and a later proven cancellation permits retry', async () => {
        await f.run(); const before = structuredClone(f.rows);
        f.provider.transactions.update.mockImplementationOnce(async id => {
            f.remote.set(id, transaction({ status: 'canceled' })); throw failure('UNCERTAIN');
        });
        await expect(f.run(pro)).rejects.toMatchObject({ statusCode: 503 });
        expect(f.rows).toEqual(before); expect(f.provider.transactions.create).toHaveBeenCalledTimes(1);
        expect(await f.run(pro)).toMatchObject({ transactionId: secondId, replaced: true });
        expect(f.provider.transactions.update).toHaveBeenCalledTimes(1);
    });
    it('a payment that wins the cancellation race blocks replacement', async () => {
        await f.run(); f.provider.transactions.update.mockResolvedValueOnce(transaction({ status: 'paid' }));
        await expect(f.run(pro)).rejects.toMatchObject({ statusCode: 409, errors: [{ code: 'CHECKOUT_PAID' }] });
        expect(f.actions()).toEqual(['CHECKOUT_RESERVED', 'CHECKOUT_READY']);
        expect(f.provider.transactions.create).toHaveBeenCalledTimes(1);
    });
    it('concurrent replacements serialize cancellation and create just one replacement', async () => {
        await f.run();
        let finish!: (value: Transaction) => void, started!: () => void;
        const entered = new Promise<void>(resolve => { started = resolve; });
        let finishCreate!: (value: Transaction) => void, creating!: () => void;
        const createEntered = new Promise<void>(resolve => { creating = resolve; });
        f.provider.transactions.create.mockImplementationOnce(() => { creating(); return new Promise(resolve => { finishCreate = resolve; }); });
        f.provider.transactions.update.mockImplementationOnce(async id => {
            started(); const canceled = await new Promise<Transaction>(resolve => { finish = resolve; });
            f.remote.set(id, canceled); return canceled;
        });
        const first = f.run(pro); await entered;
        const second = f.run({ ...starter, interval: 'year' });
        const rejected = expect(second).rejects.toMatchObject({ statusCode: 409, errors: [{ code: 'IN_PROGRESS' }] });
        finish(transaction({ status: 'canceled' }));
        await createEntered; await rejected;
        finishCreate(transaction({ id: secondId, customData: { checkoutReservationId: 4 } }));
        expect(await first).toEqual({ transactionId: secondId, reused: false, replaced: true });
        expect(f.provider.transactions.update).toHaveBeenCalledTimes(1);
        expect(f.provider.transactions.create).toHaveBeenCalledTimes(2);
        expect(f.remote.get(firstId)?.status).toBe('canceled');
        expect(f.actions().filter(action => action === 'CHECKOUT_CANCELED')).toHaveLength(1);
    });
});

describe('failure certainty and persistence', () => {
    it.each(['REJECTED', 'RATE_LIMITED'] as const)('%s closes a failed create and permits retry', async classification => {
        f.provider.transactions.create.mockRejectedValueOnce(failure(classification, 'invalid_request'));
        await expect(f.run()).rejects.toMatchObject({ statusCode: 503, message: expect.stringContaining('try again') });
        expect(f.actions()).toEqual(['CHECKOUT_RESERVED', 'CHECKOUT_FAILED']);
        expect(f.rows[1].newValue).toEqual({ reservationId: 1, code: 'invalid_request' });
        expect(await f.run()).toMatchObject({ reused: false });
        expect(f.provider.transactions.create.mock.calls[1][0]).toMatchObject({ customData: { checkoutReservationId: 3 } });
    });
    it('uses the safe classification when a rejection has no code', async () => {
        f.provider.transactions.create.mockRejectedValueOnce(failure('REJECTED'));
        await expect(f.run()).rejects.toMatchObject({ statusCode: 503 });
        expect(f.rows[1].newValue).toEqual({ reservationId: 1, code: 'REJECTED' });
    });
    it.each([failure('UNCERTAIN'), new Error('private token'), { classification: 'REJECTED' }])('unproven failures keep the reservation open: %#', async error => {
        f.provider.transactions.create.mockRejectedValueOnce(error);
        await expect(f.run()).rejects.toMatchObject({ statusCode: 503 });
        expect(f.actions()).toEqual(['CHECKOUT_RESERVED']); expect(await f.state()).toMatchObject({ kind: 'inProgress' });
        await expect(f.run()).rejects.toMatchObject({ statusCode: 409 }); expect(f.provider.transactions.create).toHaveBeenCalledTimes(1);
    });
    it('the real gateway timeout and late create keep the reservation open past grace', async () => {
        vi.useFakeTimers();
        let finish!: (value: Transaction) => void;
        const create = vi.fn(() => new Promise<Transaction>(resolve => { finish = resolve; }));
        const gateway = createBillingProvider({ client: { transactions: { create } } as unknown as BillingProviderClient, log: vi.fn() });
        const deps = { ...f.deps, provider: { ...f.provider, transactions: gateway.transactions } };
        const pending = createBillingCheckout(actor, starter, deps);
        const checked = expect(pending).rejects.toMatchObject({ statusCode: 503 });
        await vi.advanceTimersByTimeAsync(BILLING_PROVIDER_TIMEOUT_MS); await checked;
        finish(transaction()); await vi.advanceTimersByTimeAsync(120_000);
        expect(f.actions()).toEqual(['CHECKOUT_RESERVED']);
        await expect(createBillingCheckout(actor, starter, { ...deps, now: () => new Date(+now + 120_000) }))
            .rejects.toMatchObject({ statusCode: 409, errors: [{ code: 'RECONCILIATION_REQUIRED' }] });
        expect(create).toHaveBeenCalledTimes(1);
    });
    it('a gateway cancellation deadline leaves the old draft and facts unchanged', async () => {
        await f.run(); vi.useFakeTimers(); const before = structuredClone(f.rows);
        const update = vi.fn(() => new Promise<Transaction>(() => {}));
        const gateway = createBillingProvider({ client: { transactions: { get: f.provider.transactions.get, update } } as unknown as BillingProviderClient, log: vi.fn() });
        const pending = createBillingCheckout(actor, pro, { ...f.deps, provider: { ...f.provider, transactions: gateway.transactions } });
        const checked = expect(pending).rejects.toMatchObject({ statusCode: 503 });
        await vi.advanceTimersByTimeAsync(BILLING_PROVIDER_TIMEOUT_MS); await checked;
        expect(f.rows).toEqual(before); expect(f.remote.get(firstId)?.status).toBe('draft');
        expect(f.provider.transactions.create).toHaveBeenCalledTimes(1);
    });
    it.each([{ id: 'txn_bad' }, { customerId: otherCustomerId }, { status: 'ready' as const },
        { customData: { checkoutReservationId: 999 } }, { subscriptionId: 'sub_linked' }])('invalid create response %j remains reserved', async change => {
        f.provider.transactions.create.mockResolvedValueOnce(transaction(change));
        await expect(f.run()).rejects.toMatchObject({ statusCode: 503 });
        expect(f.actions()).toEqual(['CHECKOUT_RESERVED']);
    });
    it('a lost READY write leaves an open hold and cannot be purchased twice', async () => {
        const append = f.auditLog.create.getMockImplementation()!;
        f.auditLog.create.mockImplementation(async args => {
            if (args.data.action === 'CHECKOUT_READY') throw new Error('audit unavailable');
            return append(args);
        });
        await expect(f.run()).rejects.toThrow('audit unavailable');
        expect(f.actions()).toEqual(['CHECKOUT_RESERVED']); await expect(f.run()).rejects.toMatchObject({ statusCode: 409 });
        expect(f.provider.transactions.create).toHaveBeenCalledTimes(1);
    });
    it('a failed cancellation fact rolls back the new reservation and prevents creation', async () => {
        await f.run(); const append = f.auditLog.create.getMockImplementation()!;
        f.auditLog.create.mockImplementation(async args => {
            if (args.data.action === 'CHECKOUT_CANCELED') throw new Error('audit unavailable');
            return append(args);
        });
        await expect(f.run(pro)).rejects.toThrow('audit unavailable');
        expect(f.actions()).toEqual(['CHECKOUT_RESERVED', 'CHECKOUT_READY']);
        expect(f.remote.get(firstId)?.status).toBe('canceled'); expect(f.provider.transactions.create).toHaveBeenCalledTimes(1);
    });
    it('a replacement rejection closes only its new reservation and allows retry', async () => {
        await f.run(); f.provider.transactions.create.mockRejectedValueOnce(failure('REJECTED'));
        await expect(f.run(pro)).rejects.toMatchObject({ statusCode: 503 });
        expect(f.actions()).toEqual(['CHECKOUT_RESERVED', 'CHECKOUT_READY', 'CHECKOUT_CANCELED', 'CHECKOUT_RESERVED', 'CHECKOUT_FAILED']);
        expect(await f.run(pro)).toMatchObject({ reused: false }); expect(f.provider.transactions.update).toHaveBeenCalledTimes(1);
    });
});

describe('guards and correlation', () => {
    it.each([null, {}, { ...starter, extra: true }, { ...starter, companyId: 99 }, { ...starter, plan: 'starter' },
        { ...starter, interval: 'week' }, [], 'STARTER'])('rejects non-strict input %j before doing work', async input => {
        await expect(f.run(input)).rejects.toMatchObject({ statusCode: 400 });
        expect(f.manager.findFirst).not.toHaveBeenCalled(); expect(f.rows).toEqual([]); expect(f.provider.prices.get).not.toHaveBeenCalled();
    });
    it.each(['not owner', 'missing owner', 'foreign owner', 'foreign company', 'inactive', 'suspended', 'live unverified'] as const)
        ('blocks %s before a provider call', async kind => {
            if (kind === 'missing owner') f.manager.findFirst.mockResolvedValueOnce(null as unknown as typeof f.owner);
            if (kind === 'foreign owner') f.owner.id = 99;
            if (kind === 'foreign company') f.company.id = 99;
            if (kind === 'inactive') f.company.isActive = false;
            if (kind === 'suspended') f.company.operationalStatus = 'SUSPENDED';
            if (kind === 'live unverified') vi.stubEnv('PADDLE_ENVIRONMENT', 'production');
            await expect(createBillingCheckout({ ...actor, role: kind === 'not owner' ? 'MANAGER' : 'ADMIN' }, starter, f.deps))
                .rejects.toMatchObject({ statusCode: 403 });
            expect(f.rows).toEqual([]); expect(f.provider.prices.get).not.toHaveBeenCalled(); expect(f.provider.transactions.create).not.toHaveBeenCalled();
        });
    it('allows a verified live owner', async () => {
        vi.stubEnv('PADDLE_ENVIRONMENT', 'production'); f.owner.emailVerifiedAt = now;
        expect(await f.run()).toMatchObject({ transactionId: firstId });
    });
    it('points a linked subscriber to the portal without another purchase', async () => {
        f.company.billingSubscriptionId = 'sub_linked';
        await expect(f.run()).rejects.toMatchObject({ statusCode: 409, message: expect.stringContaining('portal') });
        expect(f.rows).toEqual([]); expect(f.provider.prices.get).not.toHaveBeenCalled();
    });
    it.each(['disabled', 'bad checkout URL', 'missing credentials'] as const)('blocks %s before any provider call', async kind => {
        if (kind === 'disabled') vi.stubEnv('PADDLE_BILLING_ENABLED', 'false');
        if (kind === 'bad checkout URL') vi.stubEnv('PADDLE_CHECKOUT_URL', 'http://checkout.example.invalid');
        if (kind === 'missing credentials') vi.stubEnv('PADDLE_API_KEY', '');
        await expect(f.run()).rejects.toMatchObject({ statusCode: 503 });
        expect(f.rows).toEqual([]); expect(f.provider.prices.get).not.toHaveBeenCalled();
    });
    it('uses the trial-free catalog guard before canceling or creating', async () => {
        await f.run(); const original = f.provider.prices.get.getMockImplementation()!;
        f.provider.prices.get.mockImplementation(async id => ({ ...await original(id), trialPeriod: { interval: 'day', frequency: 1 } } as Price));
        await expect(f.run(pro)).rejects.toMatchObject({ statusCode: 503, code: 'PRICE_HAS_TRIAL' });
        expect(f.provider.transactions.update).not.toHaveBeenCalled(); expect(f.provider.transactions.create).toHaveBeenCalledTimes(1);
    });
    it('rejects a valid but unavailable selection before making a customer or checkout', async () => {
        await expect(f.run({ plan: 'ADVANCED', interval: 'year' })).rejects.toMatchObject({ statusCode: 400 });
        expect(f.rows).toEqual([]); expect(f.provider.customers.create).not.toHaveBeenCalled();
    });
    it.each(['missing', 'foreign'] as const)('refuses a %s customer mirror', async kind => {
        if (kind === 'missing') f.customers.length = 0; else f.customers[0].companyId = 99;
        await expect(f.run()).rejects.toMatchObject({ statusCode: 503 }); expect(f.provider.transactions.create).not.toHaveBeenCalled();
    });
    it.each([{ customerId: otherCustomerId }, { id: secondId }, { customData: { checkoutReservationId: 999 } },
        { status: 'past_due' as const }, { subscriptionId: 'sub_unlinked' }])('a mismatched or unsafe remote draft %j cannot be canceled', async change => {
        await f.run(); f.provider.transactions.get.mockResolvedValueOnce(transaction(change)); const before = structuredClone(f.rows);
        await expect(f.run(pro)).rejects.toThrow(); expect(f.rows).toEqual(before);
        expect(f.provider.transactions.update).not.toHaveBeenCalled(); expect(f.provider.transactions.create).toHaveBeenCalledTimes(1);
    });
    it.each([{ customerId: otherCustomerId }, { id: secondId }, { status: 'ready' as const },
        { customData: { checkoutReservationId: 999 } }, { subscriptionId: 'sub_unlinked' }])('an invalid cancel acknowledgement %j cannot close the hold', async change => {
        await f.run(); f.provider.transactions.update.mockResolvedValueOnce(transaction({ status: 'canceled', ...change }));
        await expect(f.run(pro)).rejects.toMatchObject({ statusCode: 503 });
        expect(f.actions()).toEqual(['CHECKOUT_RESERVED', 'CHECKOUT_READY']); expect(f.provider.transactions.create).toHaveBeenCalledTimes(1);
    });
    it('an uncertain provider read changes no facts and never cancels', async () => {
        await f.run(); f.provider.transactions.get.mockRejectedValueOnce(failure('UNCERTAIN'));
        await expect(f.run(pro)).rejects.toMatchObject({ statusCode: 503 });
        expect(f.actions()).toEqual(['CHECKOUT_RESERVED', 'CHECKOUT_READY']); expect(f.provider.transactions.update).not.toHaveBeenCalled();
    });
    it('rejects a foreign transaction mirror rather than reusing or replacing it', async () => {
        await f.run(); f.mirrors.push({ id: firstId, companyId: 99, customerId, status: 'draft' });
        await expect(f.run(pro)).rejects.toMatchObject({ statusCode: 409 });
        expect(f.provider.transactions.get).not.toHaveBeenCalled(); expect(f.provider.transactions.create).toHaveBeenCalledTimes(1);
    });
    it.each(['suspension', 'customer link', 'subscription link'] as const)('rechecks %s before recording READY', async kind => {
        const create = f.provider.transactions.create.getMockImplementation()!;
        f.provider.transactions.create.mockImplementation(async body => {
            const result = await create(body);
            if (kind === 'suspension') f.company.operationalStatus = 'SUSPENDED';
            if (kind === 'customer link') f.company.billingCustomerId = otherCustomerId;
            if (kind === 'subscription link') f.company.billingSubscriptionId = 'sub_linked';
            return result;
        });
        await expect(f.run()).rejects.toMatchObject({ statusCode: kind === 'suspension' ? 403 : 409 });
        expect(f.actions()).toEqual(['CHECKOUT_RESERVED']); expect(f.provider.transactions.create).toHaveBeenCalledTimes(1);
    });
});
