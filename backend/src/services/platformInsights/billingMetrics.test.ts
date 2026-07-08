import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getPaddleCatalog } from '../../config/paddle.js';
import { operationalLog } from '../../utils/operationalLog.js';
import { getBillingCatalog } from '../billingCatalog.service.js';
import type { OperatorPrincipal } from '../operatorIdentity.service.js';
import { getBillingAttention, getBillingMonths, getRecurringRevenue, getSubscriptionStatusCounts } from './billingMetrics.js';

vi.mock('../../config/paddle.js', () => ({ getPaddleCatalog: vi.fn() }));
vi.mock('../../prisma/prisma.js', () => ({ prisma: {} }));
vi.mock('../../utils/operationalLog.js', () => ({ operationalLog: vi.fn() }));
vi.mock('../billingCatalog.service.js', () => ({ getBillingCatalog: { getPublicCatalog: vi.fn() } }));

const actor: OperatorPrincipal = { kind: 'PLATFORM_OPERATOR', issuer: 'synthetic-issuer', subject: 'synthetic-operator' };
const asOf = new Date('2026-11-19T12:00:00Z');
const starter = { priceId: 'starter-monthly', plan: 'STARTER', interval: 'month', amount: '2000', currencyCode: 'USD' } as const;
const pro = { priceId: 'pro-yearly', plan: 'PRO', interval: 'year', amount: '72000', currencyCode: 'USD' } as const;
const usd = (amount: number) => ({ amount, currency: 'USD' });

beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(getPaddleCatalog).mockReturnValue([starter, pro].map(({ priceId, plan, interval }) => ({ priceId, plan, interval })));
    vi.mocked(getBillingCatalog.getPublicCatalog).mockResolvedValue([starter, pro].map(
        ({ plan, interval, amount, currencyCode }) => ({ plan, interval, amount, currencyCode }),
    ));
});

function subscription(id: string, status: string, overrides: Partial<{
    priceId: string;
    scheduledChangeAction: string;
    scheduledChangeAt: Date;
    currentBillingPeriodEnd: Date;
    paddleCreatedAt: Date | null;
    canceledAt: Date;
}> = {}) {
    return {
        id, status, priceId: starter.priceId, scheduledChangeAction: null,
        scheduledChangeAt: null, currentBillingPeriodEnd: null,
        paddleCreatedAt: new Date('2026-10-01T00:00:00Z'), canceledAt: null,
        ...overrides,
    };
}

function payment(status: string, time: string, total: string | null, currencyCode = 'USD') {
    return { status, lastEventAt: new Date(time), total, currencyCode };
}

function harness({
    companies = [
        { id: 1, name: 'Active company', plan: 'STARTER', billingSubscriptionId: 'active' },
        { id: 2, name: 'Ending company', plan: 'PRO', billingSubscriptionId: 'ending' },
        { id: 3, name: 'Past-due company', plan: 'STARTER', billingSubscriptionId: 'overdue' },
        { id: 4, name: 'Canceled company', plan: 'STARTER', billingSubscriptionId: 'canceled' },
        { id: 5, name: 'Unlinked company', plan: 'STARTER', billingSubscriptionId: null },
        { id: 6, name: 'Missing mirror company', plan: 'STARTER', billingSubscriptionId: 'missing' },
    ],
    subscriptions = [
        subscription('active', 'active'),
        subscription('ending', 'active', {
            priceId: pro.priceId, scheduledChangeAction: 'cancel',
            scheduledChangeAt: new Date('2026-12-15T10:00:00Z'),
            currentBillingPeriodEnd: new Date('2026-12-14T10:00:00Z'),
            paddleCreatedAt: new Date('2026-11-03T00:00:00Z'),
        }),
        subscription('overdue', 'past_due'),
        subscription('canceled', 'canceled', { canceledAt: new Date('2026-10-27T00:00:00Z') }),
    ],
    transactions = [] as ReturnType<typeof payment>[],
} = {}) {
    const readers = {
        company: { findMany: vi.fn(async () => companies.map(row => ({ ...row, privateField: 'PRIVATE' }))) },
        paddleSubscription: { findMany: vi.fn(async (query: { where?: { id: { in: string[] } } }) =>
            subscriptions.filter(row => !query.where || query.where.id.in.includes(row.id))) },
        paddleTransaction: { findMany: vi.fn(async (query: {
            where: { status: { in: string[] }; lastEventAt: { gte: Date; lte: Date } };
        }) => transactions.filter(row => query.where.status.in.includes(row.status)
            && row.lastEventAt >= query.where.lastEventAt.gte && row.lastEventAt <= query.where.lastEventAt.lte)) },
    };
    return { ...readers, db: readers as unknown as NonNullable<Parameters<typeof getBillingMonths>[1]> };
}

describe('platform billing metrics', () => {
    it.each([null, { role: 'ADMIN' }, { ...actor, issuer: ' ' }, { ...actor, subject: '' }])(
        'rejects invalid principal %j before any database or catalog read',
        async principal => {
            const h = harness();
            for (const metric of [getRecurringRevenue, getBillingMonths, getSubscriptionStatusCounts, getBillingAttention]) {
                await expect(metric(principal as OperatorPrincipal, h.db)).rejects.toMatchObject({ statusCode: 403 });
            }
            expect(h.company.findMany).not.toHaveBeenCalled();
            expect(h.paddleSubscription.findMany).not.toHaveBeenCalled();
            expect(h.paddleTransaction.findMany).not.toHaveBeenCalled();
            expect(getPaddleCatalog).not.toHaveBeenCalled();
            expect(getBillingCatalog.getPublicCatalog).not.toHaveBeenCalled();
        },
    );

    it('counts past due as paying and uses active and scheduled yearly subscriptions for current MRR', async () => {
        const { db } = harness();
        expect(await getRecurringRevenue(actor, db, asOf)).toEqual({
            paying: 3, payingShare: 0.5, mrr: usd(80), mrrChange: 1,
            plans: [
                { plan: 'STARTER', paying: 2, mrr: usd(20) },
                { plan: 'PRO', paying: 1, mrr: usd(60) },
                { plan: 'ADVANCED', paying: 0, mrr: usd(0) },
            ],
        });
        expect(getBillingCatalog.getPublicCatalog).toHaveBeenCalledOnce();
    });

    it('counts all company links in the five states without a catalog dependency', async () => {
        const h = harness();
        expect(await getSubscriptionStatusCounts(actor, h.db)).toEqual({
            ACTIVE: 1, PAST_DUE: 1, SCHEDULED_CANCEL: 1, CANCELLED: 1, NONE: 2,
        });
        expect(h.paddleSubscription.findMany).toHaveBeenCalledWith({
            where: { id: { in: ['active', 'ending', 'overdue', 'canceled', 'missing'] } },
            select: { id: true, status: true, scheduledChangeAction: true },
        });
        expect(getBillingCatalog.getPublicCatalog).not.toHaveBeenCalled();
    });

    it('returns the contract fields for billing attention and sums the monthly values at risk', async () => {
        const { db } = harness();
        expect(await getBillingAttention(actor, db)).toEqual({
            items: [
                { companyId: 2, name: 'Ending company', kind: 'SCHEDULED_CANCEL', plan: 'PRO', date: '2026-12-15T10:00:00.000Z' },
                { companyId: 3, name: 'Past-due company', kind: 'PAST_DUE', plan: 'STARTER', date: null },
            ],
            pastDue: [{ companyId: 3, name: 'Past-due company', monthly: usd(20) }],
            mrrAtRisk: usd(80),
        });
    });

    it('leaves an unknown scheduled cancellation date unavailable', async () => {
        const { db } = harness({ subscriptions: [subscription('ending', 'active', {
            priceId: pro.priceId, scheduledChangeAction: 'cancel',
            currentBillingPeriodEnd: new Date('2026-12-14T10:00:00Z'),
        })] });
        expect(await getBillingAttention(actor, db)).toMatchObject({
            items: [{ kind: 'SCHEDULED_CANCEL', date: null }], mrrAtRisk: usd(60),
        });
    });

    it('estimates MRR through the current instant and excludes subscriptions after their cancellation', async () => {
        const { db } = harness({ subscriptions: [
            subscription('historical', 'canceled', { canceledAt: new Date('2026-10-01T00:00:00Z'), paddleCreatedAt: new Date('2026-09-01T00:00:00Z') }),
            subscription('active', 'active', { paddleCreatedAt: new Date('2026-10-31T19:00:00Z') }),
            subscription('future', 'active', { paddleCreatedAt: new Date('2026-11-20T00:00:00Z') }),
        ] });
        const months = await getBillingMonths(actor, db, asOf);
        expect(months).toHaveLength(12);
        expect(months[0]).toEqual({ month: '2025-12', partial: false, mrrEstimate: usd(0), collected: usd(0) });
        expect(months.slice(-3)).toEqual([
            { month: '2026-09', partial: false, mrrEstimate: usd(20), collected: usd(0) },
            { month: '2026-10', partial: false, mrrEstimate: usd(0), collected: usd(0) },
            { month: '2026-11', partial: true, mrrEstimate: usd(20), collected: usd(0) },
        ]);
    });

    it('collects settled payments by their event time at Karachi month boundaries', async () => {
        const h = harness({ transactions: [
            payment('completed', '2025-11-30T18:59:59.999Z', '99999'),
            payment('completed', '2025-11-30T19:00:00Z', '800'),
            payment('completed', '2026-10-31T18:59:59.999Z', '1200'),
            payment('completed', '2026-10-31T19:00:00Z', '3500'),
            payment('paid', '2026-11-05T00:00:00Z', '2000'),
            payment('billed', '2026-11-06T00:00:00Z', '20000'),
            payment('past_due', '2026-11-07T00:00:00Z', '30000'),
            payment('completed', '2026-11-19T12:00:00.001Z', '40000'),
        ] });
        const months = await getBillingMonths(actor, h.db, asOf);
        expect(months[0]?.collected).toEqual(usd(8));
        expect(months.slice(-2).map(month => month.collected)).toEqual([usd(12), usd(55)]);
        expect(h.paddleTransaction.findMany).toHaveBeenCalledWith({
            where: { status: { in: ['completed', 'paid'] }, lastEventAt: { gte: new Date('2025-11-30T19:00:00Z'), lte: asOf } },
            select: { lastEventAt: true, total: true, currencyCode: true },
        });
    });

    it('keeps the catalog-currency subtotal and logs unavailable foreign collections', async () => {
        const { db } = harness({ transactions: [
            payment('completed', '2026-11-01T00:00:00Z', '5400'),
            payment('completed', '2026-11-02T00:00:00Z', '2000', 'EUR'),
            payment('completed', '2026-10-01T00:00:00Z', '3000', 'EUR'),
        ] });
        const months = await getBillingMonths(actor, db, asOf);
        expect(months.slice(-2).map(month => month.collected)).toEqual([null, usd(54)]);
        expect(operationalLog).toHaveBeenCalledExactlyOnceWith(
            { event: 'PLATFORM_BILLING_CURRENCY_MISMATCH' }, { level: 'warn' },
        );
    });

    it('leaves collections unavailable when configured prices have no common currency', async () => {
        vi.mocked(getBillingCatalog.getPublicCatalog).mockResolvedValue([starter, { ...pro, currencyCode: 'EUR' }]);
        const { db } = harness({ transactions: [payment('paid', '2026-11-01T00:00:00Z', '5400')] });
        const months = await getBillingMonths(actor, db, asOf);
        expect(months.every(month => month.collected === null)).toBe(true);
        expect(operationalLog).toHaveBeenCalledOnce();
    });

    it('preserves counts and returns unavailable money when the catalog fails', async () => {
        vi.mocked(getBillingCatalog.getPublicCatalog).mockRejectedValue(new Error('catalog unavailable'));
        const { db } = harness({ transactions: [payment('completed', '2026-11-01T00:00:00Z', '1000')] });
        const recurring = await getRecurringRevenue(actor, db, asOf);
        expect(recurring).toEqual({
            paying: 3, payingShare: 0.5, mrr: null, mrrChange: null,
            plans: [{ plan: 'STARTER', paying: 2, mrr: null }, { plan: 'PRO', paying: 1, mrr: null }, { plan: 'ADVANCED', paying: 0, mrr: null }],
        });
        const months = await getBillingMonths(actor, db, asOf);
        expect(months).toHaveLength(12);
        expect(months.every(month => month.mrrEstimate === null && month.collected === null)).toBe(true);
        expect(months.at(-1)).toMatchObject({ month: '2026-11', partial: true });
        expect(await getBillingAttention(actor, db)).toMatchObject({
            pastDue: [{ companyId: 3, name: 'Past-due company', monthly: null }], mrrAtRisk: null,
        });
        expect(await getSubscriptionStatusCounts(actor, db)).toEqual({
            ACTIVE: 1, PAST_DUE: 1, SCHEDULED_CANCEL: 1, CANCELLED: 1, NONE: 2,
        });
    });

    it('keeps unknown prices and missing payment totals unavailable', async () => {
        const { db } = harness({
            subscriptions: [subscription('active', 'active', { priceId: 'unknown-price' }),
                subscription('overdue', 'past_due', { priceId: 'unknown-price' })],
            transactions: [payment('completed', '2026-11-01T00:00:00Z', null)],
        });
        expect(await getRecurringRevenue(actor, db, asOf)).toMatchObject({ paying: 2, mrr: null, mrrChange: null });
        expect((await getBillingMonths(actor, db, asOf)).at(-1)).toMatchObject({ mrrEstimate: null, collected: null });
        expect(await getBillingAttention(actor, db)).toMatchObject({ pastDue: [{ monthly: null }], mrrAtRisk: null });
    });

    it('returns known zeroes and leaves ratios unavailable on an empty platform', async () => {
        const { db } = harness({ companies: [], subscriptions: [] });
        expect(await getRecurringRevenue(actor, db, asOf)).toMatchObject({ paying: 0, payingShare: null, mrr: usd(0), mrrChange: null });
        expect(await getBillingAttention(actor, db)).toEqual({ items: [], pastDue: [], mrrAtRisk: usd(0) });
    });
});
