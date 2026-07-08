import type { AuditLog } from '@prisma/client';
import type { Customer, Transaction } from '@paddle/paddle-node-sdk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('../prisma/prisma.js', () => ({ prisma: {} }));
import { reconcileBillingReservations } from './billingReconcile.service.js';
import { createBillingProvider, type BillingProviderClient } from './billingProvider.js';
import { inspectBillingCheckout, readBillingReservation } from './billingReservations.service.js';

const actor = { id: 1, companyId: 42, role: 'ADMIN' as const };
const now = new Date('2026-11-10T12:00:00Z');
const customerId = 'ctm_00000000000000000000000001';
const otherCustomerId = 'ctm_00000000000000000000000002';
const transactionId = 'txn_00000000000000000000000001';
const otherTransactionId = 'txn_00000000000000000000000002';
const priceId = 'pri_00000000000000000000000001';
const customer = (change: Partial<Customer> = {}): Customer => ({ id: customerId, email: 'Owner@example.invalid', name: 'Owner',
    status: 'active', createdAt: '2026-11-08T12:00:00Z', updatedAt: now.toISOString(), customData: null, locale: 'en',
    marketingConsent: false, importMeta: null, ...change });
const transaction = (change: Partial<Transaction> = {}): Transaction => ({ id: transactionId, customerId, status: 'draft',
    subscriptionId: null, customData: { checkoutReservationId: 1 }, items: [{ quantity: 1, price: { id: priceId } }],
    createdAt: now.toISOString(), updatedAt: now.toISOString(), currencyCode: 'USD', details: null, invoiceNumber: null,
    ...change } as Transaction);

// The real reservation service runs against a stateful fake. Transactions only
// serialize after FOR UPDATE, and failures roll back mirrors, linkage and facts.
function fixture() {
    const rows: AuditLog[] = [];
    const company = { id: 42, billingCustomerId: null as string | null, billingSubscriptionId: null as string | null,
        isActive: true, operationalStatus: 'ACTIVE' };
    const owner = { id: 1, email: 'owner@example.invalid', emailVerifiedAt: null as Date | null, company };
    type CustomerMirror = { id: string; companyId: number | null; status: string; email?: string; lastEventAt?: Date };
    type TransactionMirror = { id: string; companyId: number | null; customerId: string | null; status: string;
        paddleUpdatedAt: Date; subscriptionId?: string | null; lastEventAt?: Date };
    const customers: CustomerMirror[] = [], transactions: TransactionMirror[] = [];
    const canonical: { id: number; billingCustomerId: string }[] = [];
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
            const row = { ...data, id: Math.max(0, ...rows.map(row => row.id)) + 1, createdAt: now };
            rows.push(row); return structuredClone(row);
        }),
    };
    const manager = { findFirst: vi.fn(async () => structuredClone(owner)) };
    const paddleCustomer = {
        findUnique: vi.fn(async ({ where }: { where: Partial<CustomerMirror> }) =>
            structuredClone(customers.find(row => Object.entries(where).every(([key, value]) => row[key as keyof CustomerMirror] === value)) ?? null)),
        upsert: vi.fn(async ({ where, create, update }: { where: { id: string }; create: CustomerMirror; update: Partial<CustomerMirror> }) => {
            const existing = customers.find(row => row.id === where.id);
            if (existing) Object.assign(existing, update); else customers.push(structuredClone(create));
        }),
    };
    const paddleTransaction = {
        findFirst: vi.fn(async ({ where }: { where: { id: string } }) => structuredClone(transactions.find(row => row.id === where.id) ?? null)),
        upsert: vi.fn(async ({ where, create, update }: { where: { id: string }; create: TransactionMirror; update: Partial<TransactionMirror> }) => {
            const existing = transactions.find(row => row.id === where.id);
            if (existing) Object.assign(existing, update); else transactions.push(structuredClone(create));
        }),
    };
    const companyDb = {
        findUnique: vi.fn(async ({ where }: { where: { billingCustomerId: string } }) =>
            structuredClone([company, ...canonical].find(row => row.billingCustomerId === where.billingCustomerId) ?? null)),
        update: vi.fn(async ({ data }: { data: Partial<typeof company> }) => { Object.assign(company, data); }),
    };
    let queue = Promise.resolve();
    const raw = vi.fn();
    const dbObject = { auditLog, manager, paddleCustomer, paddleTransaction, company: companyDb,
        $transaction: vi.fn(async (run: (tx: unknown) => Promise<unknown>) => {
            let release: (() => void) | undefined;
            let snapshot: { rows: AuditLog[]; company: typeof company; customers: CustomerMirror[]; transactions: TransactionMirror[] } | undefined;
            const tx = { auditLog, manager, paddleCustomer, paddleTransaction, company: companyDb,
                $queryRaw: async (strings: TemplateStringsArray, id: number) => {
                    raw(strings, id);
                    if (release) return [{ id }];
                    const prior = queue; queue = new Promise<void>(resolve => { release = resolve; }); await prior;
                    snapshot = structuredClone({ rows, company, customers, transactions });
                    return [{ id }];
                } };
            try { return await run(tx); }
            catch (error) {
                if (snapshot) {
                    rows.splice(0, rows.length, ...snapshot.rows); customers.splice(0, customers.length, ...snapshot.customers);
                    transactions.splice(0, transactions.length, ...snapshot.transactions); Object.assign(company, snapshot.company);
                }
                throw error;
            } finally { release?.(); }
        }) };
    // Include write spies even though the injected service surface is read-only.
    const provider = {
        customers: { create: vi.fn(), list: vi.fn(async (_query: unknown) => ({ data: [customer()], hasMore: false })) },
        transactions: { create: vi.fn(), update: vi.fn(), list: vi.fn(async (_query: unknown) => ({ data: [transaction()], hasMore: false })) },
    };
    const deps = { db: dbObject as unknown as NonNullable<Parameters<typeof reconcileBillingReservations>[1]>['db'], provider, now: () => now };
    const run = () => reconcileBillingReservations(actor, deps);
    const reserve = (operation: 'CUSTOMER_CREATE' | 'CHECKOUT', age = 120_000, id = 1) => {
        rows.push({ id, companyId: 42, actorType: 'ADMIN', actorId: 1, entityType: 'BILLING_OPERATION', entityId: 42,
            action: `${operation}_RESERVED`, createdAt: new Date(+now - age), oldValue: null, reason: null,
            newValue: operation === 'CHECKOUT' ? { plan: 'STARTER', interval: 'month', priceId } : null });
        if (operation === 'CHECKOUT') { company.billingCustomerId = customerId; customers.push({ id: customerId, companyId: 42, status: 'active' }); }
    };
    const actions = () => rows.map(row => row.action);
    const state = (operation: 'CUSTOMER_CREATE' | 'CHECKOUT') => readBillingReservation(company, operation, deps);
    return { rows, company, owner, customers, transactions, canonical, auditLog, manager, paddleCustomer, paddleTransaction, companyDb,
        raw, dbObject, provider, deps, run, reserve, actions, state };
}
let f: ReturnType<typeof fixture>;
beforeEach(() => {
    f = fixture(); vi.stubEnv('PADDLE_ENVIRONMENT', 'sandbox');
    vi.stubEnv('PADDLE_PRICE_CATALOG_JSON', JSON.stringify([{ plan: 'STARTER', interval: 'month', priceId }]));
});
afterEach(() => {
    expect(f.provider.customers.create).not.toHaveBeenCalled();
    expect(f.provider.transactions.create).not.toHaveBeenCalled();
    expect(f.provider.transactions.update).not.toHaveBeenCalled();
    expect(f.company.billingSubscriptionId).toBeNull();
    vi.unstubAllEnvs();
});

describe('grace, scope and stable outcomes', () => {
    it.each(['CUSTOMER_CREATE', 'CHECKOUT'] as const)('%s inside grace is unchanged, without provider reads', async operation => {
        f.reserve(operation, 119_999); const before = structuredClone(f.rows);
        expect(await f.run()).toBe('IN_PROGRESS'); expect(await f.run()).toBe('IN_PROGRESS');
        expect(f.rows).toEqual(before); expect(f.provider.customers.list).not.toHaveBeenCalled();
        expect(f.provider.transactions.list).not.toHaveBeenCalled(); expect(f.companyDb.update).not.toHaveBeenCalled();
    });
    it('does not reconcile either hold while another is inside grace', async () => {
        f.reserve('CUSTOMER_CREATE'); f.reserve('CHECKOUT', 1_000, 2);
        expect(await f.run()).toBe('IN_PROGRESS'); expect(f.auditLog.create).not.toHaveBeenCalled();
        expect(f.provider.customers.list).not.toHaveBeenCalled();
    });
    it('returns CLEARED repeatedly when no reservation exists', async () => {
        expect(await f.run()).toBe('CLEARED'); expect(await f.run()).toBe('CLEARED');
        expect(f.rows).toEqual([]); expect(f.provider.customers.list).not.toHaveBeenCalled();
        expect(f.provider.transactions.list).not.toHaveBeenCalled();
        expect(f.raw.mock.calls[0][0].join('?')).toBe('SELECT id FROM "Company" WHERE id=? FOR UPDATE');
        expect(f.raw.mock.calls[0][1]).toBe(42);
    });
    it.each(['role', 'missing', 'foreign', 'inactive', 'suspended'] as const)('rejects an unauthorized %s before provider reads', async kind => {
        f.reserve('CUSTOMER_CREATE');
        if (kind === 'missing') f.manager.findFirst.mockResolvedValueOnce(null as unknown as typeof f.owner);
        if (kind === 'foreign') f.company.id = 99;
        if (kind === 'inactive') f.company.isActive = false;
        if (kind === 'suspended') f.company.operationalStatus = 'SUSPENDED';
        await expect(reconcileBillingReservations({ ...actor, role: kind === 'role' ? 'MANAGER' : 'ADMIN' }, f.deps)).rejects.toMatchObject({ statusCode: 403 });
        expect(f.provider.customers.list).not.toHaveBeenCalled(); expect(f.provider.transactions.list).not.toHaveBeenCalled();
        expect(f.auditLog.create).not.toHaveBeenCalled();
    });
    it('ignores another company reservation', async () => {
        f.reserve('CUSTOMER_CREATE'); Object.assign(f.rows[0], { companyId: 99, entityId: 99 });
        expect(await f.run()).toBe('CLEARED'); expect(f.provider.customers.list).not.toHaveBeenCalled();
    });
});

describe('customer recovery', () => {
    it.each([
        ['sandbox', null], ['production', now],
    ] as const)('adopts a legacy exact-email match in %s with verification %s', async (environment, verified) => {
        f.reserve('CUSTOMER_CREATE'); vi.stubEnv('PADDLE_ENVIRONMENT', environment); f.owner.emailVerifiedAt = verified;
        expect(await f.run()).toBe('CLEARED'); expect(await f.run()).toBe('CLEARED');
        expect(f.provider.customers.list).toHaveBeenCalledExactlyOnceWith({ email: f.owner.email, status: ['active', 'archived'] });
        expect(f.rows[1].newValue).toEqual({ reservationId: 1, customerId, adopted: true });
        expect(f.company.billingCustomerId).toBe(customerId);
        expect(await f.state('CUSTOMER_CREATE')).toMatchObject({ kind: 'closed', fact: { action: 'CUSTOMER_CREATE_READY' } });
    });
    it('recovers the exact reservation custom data without legacy adoption', async () => {
        f.reserve('CUSTOMER_CREATE');
        f.provider.customers.list.mockResolvedValueOnce({ data: [customer({ customData: { companyId: 42, customerReservationId: 1 } })], hasMore: false });
        expect(await f.run()).toBe('CLEARED'); expect(await f.run()).toBe('CLEARED');
        expect(f.rows[1].newValue).toEqual({ reservationId: 1, customerId });
        expect(f.company.billingCustomerId).toBe(customerId);
    });
    it('clears only after an exhaustive empty email listing, then repeats without another read', async () => {
        f.reserve('CUSTOMER_CREATE'); f.provider.customers.list.mockResolvedValueOnce({ data: [], hasMore: false });
        expect(await f.run()).toBe('CLEARED'); expect(await f.run()).toBe('CLEARED');
        expect(f.rows[1].newValue).toEqual({ reservationId: 1, code: 'NOT_FOUND' });
        expect(f.provider.customers.list).toHaveBeenCalledTimes(1); expect(f.company.billingCustomerId).toBeNull();
    });
    it.each([
        { status: 'archived' as const }, { email: 'different@example.invalid' }, { email: ' owner@example.invalid' },
        { id: 'ctm_bad' }, { customData: { companyId: 99, customerReservationId: 1 } },
        { customData: { customerReservationId: 99 } }, { customData: { customerReservationId: '1' } },
    ])('records a stable conflict for %j', async change => {
        f.reserve('CUSTOMER_CREATE'); f.provider.customers.list.mockResolvedValueOnce({ data: [customer(change)], hasMore: false });
        expect(await f.run()).toBe('CONFLICT'); expect(await f.run()).toBe('CONFLICT');
        expect(f.rows[1].newValue).toEqual({ reservationId: 1, code: 'EMAIL_CONFLICT' });
        expect(f.provider.customers.list).toHaveBeenCalledTimes(1); expect(f.company.billingCustomerId).toBeNull();
    });
    it('refuses legacy adoption for an unverified production owner', async () => {
        f.reserve('CUSTOMER_CREATE'); vi.stubEnv('PADDLE_ENVIRONMENT', 'production');
        expect(await f.run()).toBe('CONFLICT'); expect(await f.run()).toBe('CONFLICT');
        expect(f.company.billingCustomerId).toBeNull();
    });
    it.each(['mirror', 'canonical', 'company mirror', 'archived mirror', 'canonical own'] as const)('refuses conflicting %s linkage', async kind => {
        f.reserve('CUSTOMER_CREATE');
        if (kind === 'mirror') f.customers.push({ id: customerId, companyId: 99, status: 'active' });
        if (kind === 'canonical') f.canonical.push({ id: 99, billingCustomerId: customerId });
        if (kind === 'company mirror') f.customers.push({ id: otherCustomerId, companyId: 42, status: 'active' });
        if (kind === 'archived mirror') f.customers.push({ id: customerId, companyId: null, status: 'archived' });
        if (kind === 'canonical own') f.company.billingCustomerId = otherCustomerId;
        const before = structuredClone(f.customers);
        expect(await f.run()).toBe('CONFLICT'); expect(await f.run()).toBe('CONFLICT');
        expect(f.customers).toEqual(before); expect(f.companyDb.update).not.toHaveBeenCalled();
    });
    it('keeps newer webhook customer fields when attaching an unlinked mirror', async () => {
        f.reserve('CUSTOMER_CREATE'); const later = new Date(+now + 1_000);
        f.customers.push({ id: customerId, companyId: null, status: 'active', email: 'newer@example.invalid', lastEventAt: later });
        expect(await f.run()).toBe('CLEARED');
        expect(f.customers[0]).toEqual({ id: customerId, companyId: 42, status: 'active', email: 'newer@example.invalid', lastEventAt: later });
    });
    it.each(['duplicates', 'archived duplicate', 'incomplete', 'failed read', 'invalid date'] as const)('%s stays unresolved without facts', async kind => {
        f.reserve('CUSTOMER_CREATE');
        if (kind === 'duplicates') f.provider.customers.list.mockResolvedValue({ data: [customer(), customer({ id: otherCustomerId })], hasMore: false });
        if (kind === 'archived duplicate') f.provider.customers.list.mockResolvedValue({ data: [customer(), customer({ id: otherCustomerId, status: 'archived' })], hasMore: false });
        if (kind === 'incomplete') f.provider.customers.list.mockResolvedValue({ data: [], hasMore: true });
        if (kind === 'failed read') f.provider.customers.list.mockRejectedValue(new Error('private provider payload'));
        if (kind === 'invalid date') f.provider.customers.list.mockResolvedValue({ data: [customer({ updatedAt: 'invalid' })], hasMore: false });
        expect(await f.run()).toBe('UNRESOLVED'); expect(await f.run()).toBe('UNRESOLVED');
        expect(f.actions()).toEqual(['CUSTOMER_CREATE_RESERVED']); expect(f.paddleCustomer.upsert).not.toHaveBeenCalled();
    });
});

describe('checkout recovery', () => {
    it.each(['draft', 'ready', 'paid', 'billed', 'completed'] as const)('%s is mirrored and closes READY with a stable outcome', async status => {
        f.reserve('CHECKOUT'); f.provider.transactions.list.mockResolvedValueOnce({ data: [transaction({ status })], hasMore: false });
        const outcome = ['draft', 'ready'].includes(status) ? 'RESUMABLE' : 'PAID';
        expect(await f.run()).toBe(outcome); expect(await f.run()).toBe(outcome);
        expect(f.provider.transactions.list).toHaveBeenCalledExactlyOnceWith({ customerId: [customerId], orderBy: 'id[ASC]' });
        expect(f.rows[1].newValue).toEqual({ reservationId: 1, transactionId, customerId, confirmedByProvider: true });
        expect(f.transactions[0]).toMatchObject({ id: transactionId, companyId: 42, customerId, status });
        expect(f.companyDb.update).not.toHaveBeenCalled();
        expect(await inspectBillingCheckout(f.company, f.deps)).toMatchObject({ kind: outcome === 'RESUMABLE' ? 'resume' : 'pending' });
    });
    it('closes a canceled draft with CHECKOUT_CANCELED and repeats without provider reads', async () => {
        f.reserve('CHECKOUT'); f.provider.transactions.list.mockResolvedValueOnce({ data: [transaction({ status: 'canceled' })], hasMore: false });
        expect(await f.run()).toBe('CLEARED'); expect(await f.run()).toBe('CLEARED');
        expect(f.actions()).toEqual(['CHECKOUT_RESERVED', 'CHECKOUT_CANCELED']);
        expect(f.rows[1].newValue).toEqual({ reservationId: 1, transactionId });
        expect(f.provider.transactions.list).toHaveBeenCalledTimes(1);
    });
    it.each([[], [transaction({ customData: { checkoutReservationId: 99 } })], [transaction({ customData: { checkoutReservationId: '1' } })]].map(data => ({ data })))
        ('an exhaustive listing without this hold clears it: %#', async ({ data }) => {
            f.reserve('CHECKOUT'); f.provider.transactions.list.mockResolvedValueOnce({ data, hasMore: false });
            expect(await f.run()).toBe('CLEARED'); expect(await f.run()).toBe('CLEARED');
            expect(f.rows[1].newValue).toEqual({ reservationId: 1, code: 'NOT_FOUND' });
            expect(f.provider.transactions.list).toHaveBeenCalledTimes(1);
        });
    it('continues the gateway cursor and finds a match on the final batch', async () => {
        f.reserve('CHECKOUT');
        f.provider.transactions.list.mockResolvedValueOnce({ data: [transaction({ id: otherTransactionId, customData: null })], hasMore: true });
        expect(await f.run()).toBe('RESUMABLE');
        expect(f.provider.transactions.list.mock.calls[1][0]).toEqual({ customerId: [customerId], orderBy: 'id[ASC]', after: otherTransactionId });
    });
    it('continues after an early match to rule out duplicates', async () => {
        f.reserve('CHECKOUT'); f.provider.transactions.list.mockResolvedValueOnce({ data: [transaction()], hasMore: true });
        f.provider.transactions.list.mockResolvedValueOnce({ data: [transaction({ id: otherTransactionId })], hasMore: false });
        expect(await f.run()).toBe('UNRESOLVED'); expect(f.actions()).toEqual(['CHECKOUT_RESERVED']);
    });
    it.each(['empty', 'early match'] as const)('the ten-page cap never clears or resumes (%s)', async kind => {
        f.reserve('CHECKOUT');
        f.provider.transactions.list.mockResolvedValueOnce({ data: [transaction({ customData: kind === 'early match' ? { checkoutReservationId: 1 } : null })], hasMore: true });
        f.provider.transactions.list.mockResolvedValueOnce({ data: [transaction({ id: otherTransactionId, customData: null })], hasMore: true });
        expect(await f.run()).toBe('UNRESOLVED'); expect(f.provider.transactions.list).toHaveBeenCalledTimes(2);
        expect(f.actions()).toEqual(['CHECKOUT_RESERVED']);
    });
    it('uses the real gateway for exactly ten pages before staying unresolved', async () => {
        f.reserve('CHECKOUT'); let page = 0;
        const list = vi.fn(() => ({ hasMore: true, next: vi.fn(async () => {
            page++; return [transaction({ id: `txn_${String(page).padStart(26, '0')}`, customData: null })];
        }) }));
        const gateway = createBillingProvider({ client: { transactions: { list } } as unknown as BillingProviderClient, log: vi.fn() });
        expect(await reconcileBillingReservations(actor, { ...f.deps, provider: gateway })).toBe('UNRESOLVED');
        expect(page).toBe(10); expect(list).toHaveBeenCalledTimes(2);
        expect(list.mock.calls[1]).toEqual([{ customerId: [customerId], orderBy: 'id[ASC]', perPage: 100, after: 'txn_00000000000000000000000005' }]);
        expect(f.actions()).toEqual(['CHECKOUT_RESERVED']);
    });
    it.each(['duplicates', 'repeated row', 'missing cursor', 'first read fails', 'later read fails'] as const)('%s stays unresolved without facts', async kind => {
        f.reserve('CHECKOUT');
        if (kind === 'duplicates') f.provider.transactions.list.mockResolvedValue({ data: [transaction(), transaction({ id: otherTransactionId })], hasMore: false });
        if (kind === 'repeated row') {
            f.provider.transactions.list.mockResolvedValueOnce({ data: [transaction()], hasMore: true });
            f.provider.transactions.list.mockResolvedValueOnce({ data: [transaction()], hasMore: false });
        }
        if (kind === 'missing cursor') f.provider.transactions.list.mockResolvedValue({ data: [], hasMore: true });
        if (kind === 'first read fails') f.provider.transactions.list.mockRejectedValue(new Error('private provider error'));
        if (kind === 'later read fails') {
            f.provider.transactions.list.mockResolvedValueOnce({ data: [transaction()], hasMore: true });
            f.provider.transactions.list.mockRejectedValueOnce(new Error('private provider error'));
        }
        expect(await f.run()).toBe('UNRESOLVED'); expect(f.actions()).toEqual(['CHECKOUT_RESERVED']);
        expect(f.paddleTransaction.upsert).not.toHaveBeenCalled();
    });
    it.each([
        { customerId: otherCustomerId }, { id: 'txn_bad' }, { status: 'past_due' as const },
        { customData: { checkoutReservationId: 1, companyId: 99 } }, { updatedAt: 'invalid' },
        { items: [] }, { items: [{ quantity: 2, price: { id: priceId } }] },
        { items: [{ quantity: 1, price: { id: 'pri_00000000000000000000000002' } }] },
    ])('an unsafe match %j grants nothing and stays open', async change => {
        f.reserve('CHECKOUT'); f.provider.transactions.list.mockResolvedValue({ data: [transaction(change as Partial<Transaction>)], hasMore: false });
        expect(await f.run()).toBe('UNRESOLVED'); expect(await f.run()).toBe('UNRESOLVED');
        expect(f.actions()).toEqual(['CHECKOUT_RESERVED']); expect(f.paddleTransaction.upsert).not.toHaveBeenCalled();
    });
    it.each(['missing customer', 'missing mirror', 'foreign mirror', 'foreign transaction', 'wrong transaction customer', 'bad catalog'] as const)
        ('%s stays unresolved', async kind => {
            f.reserve('CHECKOUT');
            if (kind === 'missing customer') f.company.billingCustomerId = null;
            if (kind === 'missing mirror') f.customers.length = 0;
            if (kind === 'foreign mirror') f.customers[0].companyId = 99;
            if (kind === 'foreign transaction' || kind === 'wrong transaction customer') f.transactions.push({ id: transactionId,
                companyId: kind === 'foreign transaction' ? 99 : 42, customerId: kind === 'wrong transaction customer' ? otherCustomerId : customerId,
                status: 'draft', paddleUpdatedAt: now });
            if (kind === 'bad catalog') vi.stubEnv('PADDLE_PRICE_CATALOG_JSON', '[]');
            expect(await f.run()).toBe('UNRESOLVED'); expect(f.actions()).toEqual(['CHECKOUT_RESERVED']);
        });
    it.each(['completed', 'canceled', 'past_due'] as const)('preserves a newer webhook status %s', async status => {
        f.reserve('CHECKOUT'); const later = new Date(+now + 1_000);
        f.transactions.push({ id: transactionId, companyId: 42, customerId, status, paddleUpdatedAt: later, lastEventAt: later });
        const expected = status === 'completed' ? 'PAID' : status === 'canceled' ? 'CLEARED' : 'UNRESOLVED';
        expect(await f.run()).toBe(expected); expect(await f.run()).toBe(expected);
        expect(f.transactions[0]).toMatchObject({ status, paddleUpdatedAt: later, lastEventAt: later });
    });
});

describe('concurrency and atomic persistence', () => {
    it.each(['CUSTOMER_CREATE', 'CHECKOUT'] as const)('concurrent reconciliation of %s writes one closing fact', async operation => {
        f.reserve(operation);
        const expected = operation === 'CUSTOMER_CREATE' ? 'CLEARED' : 'RESUMABLE';
        expect(await Promise.all([f.run(), f.run()])).toEqual([expected, expected]);
        expect(f.rows).toHaveLength(2); expect(f.auditLog.create).toHaveBeenCalledTimes(1);
    });
    it.each(['customer mirror', 'customer READY', 'transaction mirror', 'checkout READY'] as const)('%s failure rolls back the entire repair', async kind => {
        const operation = kind.startsWith('customer') ? 'CUSTOMER_CREATE' : 'CHECKOUT'; f.reserve(operation);
        if (kind === 'customer mirror') f.paddleCustomer.upsert.mockRejectedValueOnce(new Error('write failed'));
        if (kind === 'transaction mirror') f.paddleTransaction.upsert.mockRejectedValueOnce(new Error('write failed'));
        if (kind.endsWith('READY')) f.auditLog.create.mockRejectedValueOnce(new Error('write failed'));
        const before = structuredClone({ company: f.company, customers: f.customers });
        await expect(f.run()).rejects.toThrow('write failed');
        expect(f.company).toEqual(before.company); expect(f.customers).toEqual(before.customers); expect(f.transactions).toEqual([]);
        expect(f.actions()).toEqual([`${operation}_RESERVED`]);
        expect(await f.run()).toBe(operation === 'CUSTOMER_CREATE' ? 'CLEARED' : 'RESUMABLE');
    });
    it.each(['email', 'suspension', 'linkage', 'new reservation'] as const)('rechecks %s after the provider read', async kind => {
        f.reserve('CUSTOMER_CREATE'); f.provider.customers.list.mockImplementationOnce(async () => {
            if (kind === 'email') f.owner.email = 'changed@example.invalid';
            if (kind === 'suspension') f.company.operationalStatus = 'SUSPENDED';
            if (kind === 'linkage') f.company.billingCustomerId = otherCustomerId;
            if (kind === 'new reservation') f.reserve('CUSTOMER_CREATE', 0, 2);
            return { data: [customer()], hasMore: false };
        });
        if (kind === 'suspension') await expect(f.run()).rejects.toMatchObject({ statusCode: 403 });
        else expect(await f.run()).toBe(kind === 'new reservation' ? 'IN_PROGRESS' : 'UNRESOLVED');
        expect(f.auditLog.create).not.toHaveBeenCalled(); expect(f.paddleCustomer.upsert).not.toHaveBeenCalled();
    });
    it('checks current verification before legacy adoption', async () => {
        f.reserve('CUSTOMER_CREATE'); vi.stubEnv('PADDLE_ENVIRONMENT', 'production'); f.owner.emailVerifiedAt = now;
        f.provider.customers.list.mockImplementationOnce(async () => { f.owner.emailVerifiedAt = null; return { data: [customer()], hasMore: false }; });
        expect(await f.run()).toBe('CONFLICT'); expect(f.company.billingCustomerId).toBeNull();
    });
});
