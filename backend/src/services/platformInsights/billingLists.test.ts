import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { OperatorPrincipal } from '../operatorIdentity.service.js';
import { listPlatformPayments, listPlatformSubscriptions } from './billingLists.js';

const { getPublicCatalog } = vi.hoisted(() => ({ getPublicCatalog: vi.fn() }));
vi.mock('../billingCatalog.service.js', () => ({ getBillingCatalog: { getPublicCatalog } }));

const operator: OperatorPrincipal = { kind: 'PLATFORM_OPERATOR', issuer: 'fixture', subject: 'operator' };
const asOf = new Date('2026-11-19T12:00:00Z');
const paidStatuses = ['completed', 'paid', 'past_due'];
const priceId = 'pri_' + 'p'.repeat(26);
const subscriptionId = (id: number) => 'sub_' + String(id).padStart(26, '0');
const transactionId = (id: number) => 'txn_' + String(id).padStart(26, '0');
const usd = (amount: number) => ({ amount, currency: 'USD' });

const company = (id: number, linked = true) => ({
    id, name: 'Company ' + id, plan: 'PRO', billingSubscriptionId: linked ? subscriptionId(id) : null,
    managers: [{ name: 'Owner ' + id, email: id + '@example.test', privateField: 'hidden' }],
});
const subscription = (id: number, overrides: Record<string, unknown> = {}) => ({
    id: subscriptionId(id), status: 'active', priceId, scheduledChangeAction: null,
    scheduledChangeAt: null, currentBillingPeriodEnd: null, canceledAt: null, ...overrides,
});

function subscriptionsDb(companies: ReturnType<typeof company>[], mirrors: ReturnType<typeof subscription>[]) {
    const db = {
        company: { findMany: vi.fn(({ where } = {}) => where
            ? companies.filter(({ id }) => where.id.in.includes(id))
            : companies) },
        paddleSubscription: { findMany: vi.fn(({ where }) => mirrors.filter(({ id }) => where.id.in.includes(id))) },
    };
    return { db, list: (raw?: unknown) =>
        listPlatformSubscriptions(operator, raw, db as unknown as Parameters<typeof listPlatformSubscriptions>[2], asOf) };
}

const transaction = (id: number, date: string, overrides: Record<string, unknown> = {}) => ({
    id: transactionId(id), company: { id: 1, name: 'Company 1', privateField: 'hidden' },
    status: 'completed', total: '2500', currencyCode: 'USD', invoiceNumber: 'invoice-' + id,
    paddleCreatedAt: new Date(date), createdAt: new Date(asOf), ...overrides,
});

function paymentsDb(rows: ReturnType<typeof transaction>[]) {
    const db = { paddleTransaction: { findMany: vi.fn(({ where }) => {
        const { gte, lte } = where.OR[0].paddleCreatedAt;
        return rows.filter(row => {
            const date = row.paddleCreatedAt ?? row.createdAt;
            return row.company && where.status.in.includes(row.status) && (!gte || date >= gte) && date <= lte;
        });
    }) } };
    return { db, list: (raw?: unknown) =>
        listPlatformPayments(operator, raw, db as unknown as Parameters<typeof listPlatformPayments>[2], asOf) };
}

beforeEach(() => {
    vi.stubEnv('PADDLE_ENVIRONMENT', 'sandbox');
    vi.stubEnv('PADDLE_PRICE_CATALOG_JSON', JSON.stringify([{ plan: 'PRO', interval: 'year', priceId }]));
    getPublicCatalog.mockReset().mockResolvedValue([{ plan: 'PRO', interval: 'year', amount: '12000', currencyCode: 'USD' }]);
});

afterEach(() => vi.unstubAllEnvs());

describe('billing list boundaries', () => {
    it('rejects non-operators before parsing, reading Prisma or opening the catalog', async () => {
        const actor = { kind: 'TENANT' } as unknown as OperatorPrincipal;
        await expect(listPlatformSubscriptions(actor, { bad: true }, {} as never)).rejects.toMatchObject({ statusCode: 403 });
        await expect(listPlatformPayments(actor, { bad: true }, {} as never)).rejects.toMatchObject({ statusCode: 403 });
        expect(getPublicCatalog).not.toHaveBeenCalled();
    });

    it('rejects unknown query keys and values or malformed cursors before reading Prisma', async () => {
        const { db: subscriptions, list: listSubscriptions } = subscriptionsDb([], []);
        const { db: payments, list: listPayments } = paymentsDb([]);
        for (const query of [{ status: 'NONE' }, { extra: 'x' }, { after: '2147483648' }]) {
            await expect(listSubscriptions(query)).rejects.toMatchObject({ statusCode: 400 });
        }
        for (const query of [{ range: 'week' }, { status: 'PAID' }, { after: '2026-02-30T00:00:00.000Z|txn' }]) {
            await expect(listPayments(query)).rejects.toMatchObject({ statusCode: 400 });
        }
        expect(subscriptions.company.findMany).not.toHaveBeenCalled();
        expect(payments.paddleTransaction.findMany).not.toHaveBeenCalled();
    });
});

describe('listPlatformSubscriptions', () => {
    it('returns only linked companies and groups actual renewal charges by Karachi Monday', async () => {
        const { list } = subscriptionsDb(
            [company(1), company(2), company(3), company(4), company(5), company(6, false)],
            [
                subscription(1, { currentBillingPeriodEnd: new Date('2026-11-22T18:59:59Z') }),
                subscription(2, { currentBillingPeriodEnd: new Date('2026-11-22T19:00:00Z') }),
                subscription(3, { status: 'past_due' }),
                subscription(4, {
                    scheduledChangeAction: 'cancel', scheduledChangeAt: new Date('2026-11-26T00:00:00Z'),
                    currentBillingPeriodEnd: new Date('2026-11-22T19:00:00Z'),
                }),
                subscription(5, { status: 'canceled', canceledAt: new Date('2026-11-18T00:00:00Z') }),
                subscription(6),
            ],
        );
        const response = await list();
        expect(response).toEqual({
            summary: {
                mrrByPlan: expect.arrayContaining([
                    { plan: 'STARTER', mrr: usd(0) }, { plan: 'PRO', mrr: usd(30) }, { plan: 'ADVANCED', mrr: usd(0) },
                ]),
                averagePerPaying: usd(7.5),
                renewals: [
                    { week: '2026-11-16', count: 1, amount: usd(120) },
                    { week: '2026-11-23', count: 1, amount: usd(120) },
                    { week: '2026-11-30', count: 0, amount: usd(0) },
                    { week: '2026-12-07', count: 0, amount: usd(0) },
                ],
                endingSoon: [{ companyId: 4, name: 'Company 4', renewsOrEndsAt: '2026-11-26T00:00:00.000Z' }],
                cancelled: 1,
            },
            statusCounts: { ACTIVE: 2, PAST_DUE: 1, SCHEDULED_CANCEL: 1, CANCELLED: 1, NONE: 1 },
            items: expect.any(Array),
            nextCursor: null,
        });
        expect(response.items.map(row => row.companyId)).toEqual([1, 2, 3, 4, 5]);
        expect(response.items[0]).toEqual({
            companyId: 1, name: 'Company 1', owner: { name: 'Owner 1', email: '1@example.test' },
            plan: 'PRO', interval: 'year', amount: usd(120), status: 'ACTIVE',
            renewsOrEndsAt: '2026-11-22T18:59:59.000Z',
            paddleUrl: 'https://sandbox-vendors.paddle.com/subscriptions-v2/' + subscriptionId(1),
        });
        for (const row of response.items) {
            expect(row.paddleUrl).toBe('https://sandbox-vendors.paddle.com/subscriptions-v2/' + subscriptionId(row.companyId));
        }
        expect((await list({ status: 'PAST_DUE' })).items).toEqual([response.items[2]]);
    });

    it('pages filtered subscriptions with ascending company IDs and leaves global counts stable', async () => {
        const companies = Array.from({ length: 29 }, (_, index) => company(index + 1));
        const mirrors = companies.map(({ id }) => subscription(id, { status: id === 2 ? 'active' : 'past_due' }));
        const { list } = subscriptionsDb(companies, mirrors);
        const first = await list({ status: 'PAST_DUE' });
        expect(first.items).toHaveLength(25);
        expect(first.nextCursor).toBe('26');
        const second = await list({ status: 'PAST_DUE', after: first.nextCursor });
        expect(second.items.map(item => item.companyId)).toEqual([27, 28, 29]);
        expect(second.nextCursor).toBeNull();
        expect(second.summary).toEqual(first.summary);
        expect(second.statusCounts).toEqual(first.statusCounts);
    });

    it('preserves the configured interval and returns unknown amounts when catalog lookup fails', async () => {
        getPublicCatalog.mockRejectedValueOnce(new Error('offline'));
        const { list } = subscriptionsDb([company(1)], [subscription(1)]);
        const response = await list();
        expect(response.items[0]).toMatchObject({ interval: 'year', amount: null });
        expect(response.summary.averagePerPaying).toBeNull();
        expect(response.summary.mrrByPlan.every(plan => plan.mrr === null)).toBe(true);
    });
});

describe('listPlatformPayments', () => {
    it('uses Karachi month boundaries and provider dates with a local-date fallback', async () => {
        vi.stubEnv('PADDLE_ENVIRONMENT', 'production');
        const { db, list } = paymentsDb([
            transaction(1, '2026-10-31T18:59:59Z'),
            transaction(2, '2026-10-31T19:00:00Z'),
            transaction(3, '2026-11-08T19:00:00Z', { status: 'paid' }),
            transaction(4, '2026-11-18T12:00:00Z', {
                status: 'past_due', paddleCreatedAt: null, createdAt: new Date('2026-11-18T12:00:00Z'),
            }),
            transaction(5, '2026-11-18T12:00:00Z', { status: 'draft' }),
            transaction(6, '2026-11-18T12:00:00Z', { company: null }),
        ]);
        const response = await list({ range: 'month' });
        const window = { gte: new Date('2026-10-31T19:00:00Z'), lte: asOf };
        expect(db.paddleTransaction.findMany).toHaveBeenCalledWith(expect.objectContaining({
            where: {
                companyId: { not: null }, status: { in: paidStatuses },
                OR: [{ paddleCreatedAt: window }, { paddleCreatedAt: null, createdAt: window }],
            },
        }));
        expect(response).toEqual({
            summary: {
                weekly: [
                    { week: '2026-09-28', collected: usd(0) },
                    { week: '2026-10-05', collected: usd(0) },
                    { week: '2026-10-12', collected: usd(0) },
                    { week: '2026-10-19', collected: usd(0) },
                    { week: '2026-10-26', collected: usd(25) },
                    { week: '2026-11-02', collected: usd(0) },
                    { week: '2026-11-09', collected: usd(25) },
                    { week: '2026-11-16', collected: usd(0) },
                ],
                paid: 2, pastDue: 1, collected: usd(50), count: 3,
            },
            items: [4, 3, 2].map((id, index) => ({
                id: transactionId(id), companyId: 1, companyName: 'Company 1',
                date: ['2026-11-18T12:00:00.000Z', '2026-11-08T19:00:00.000Z', '2026-10-31T19:00:00.000Z'][index],
                invoice: 'invoice-' + id, amount: usd(25), status: id === 4 ? 'PAST_DUE' : 'PAID',
                paddleUrl: 'https://vendors.paddle.com/transactions-v2/' + transactionId(id),
            })),
            nextCursor: null,
        });
        expect(getPublicCatalog).not.toHaveBeenCalled();
    });

    it('includes the current and previous two Karachi calendar months for three and older dates for all', async () => {
        const { list } = paymentsDb([
            transaction(1, '2026-08-31T18:59:59Z'),
            transaction(2, '2026-08-31T19:00:00Z'),
            transaction(3, '2026-11-19T12:00:01Z'),
        ]);
        expect((await list({ range: 'three' })).items.map(item => item.id)).toEqual([transactionId(2)]);
        expect((await list({ range: 'all' })).items.map(item => item.id)).toEqual([transactionId(2), transactionId(1)]);
    });

    it('uses transaction IDs to page through tied timestamps without changing totals', async () => {
        const { list } = paymentsDb(Array.from({ length: 27 }, (_, index) =>
            transaction(27 - index, '2026-11-18T12:00:00Z')));
        const first = await list();
        expect(first.items.map(item => item.id)).toEqual(Array.from({ length: 25 }, (_, index) => transactionId(index + 1)));
        expect(first.nextCursor).toBeTruthy();
        const second = await list({ after: first.nextCursor });
        expect(second.items.map(item => item.id)).toEqual([transactionId(26), transactionId(27)]);
        expect(second.nextCursor).toBeNull();
        expect(second.summary).toEqual(first.summary);
        expect(second.summary).toMatchObject({ paid: 27, pastDue: 0, collected: usd(675), count: 27 });
    });

    it('reports unavailable amounts and URLs when source fields are missing', async () => {
        vi.stubEnv('PADDLE_ENVIRONMENT', '');
        const { list } = paymentsDb([transaction(1, '2026-11-18T12:00:00Z', { total: null, invoiceNumber: null })]);
        const response = await list();
        expect(response.items[0]).toMatchObject({ amount: null, invoice: null, paddleUrl: null });
        expect(response.summary.collected).toBeNull();
        expect(response.summary.weekly.at(-1)?.collected).toBeNull();
    });
});
