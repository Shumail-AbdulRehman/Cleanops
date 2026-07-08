import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getPaddleCatalog } from '../../config/paddle.js';
import { getBillingCatalog } from '../billingCatalog.service.js';
import type { OperatorPrincipal } from '../operatorIdentity.service.js';
import { getPlatformOverview } from './overview.js';
import { lastDays, lastTwelveMonths } from './rules.js';

vi.mock('../../prisma/prisma.js', () => ({ prisma: {} }));
vi.mock('../../config/paddle.js', () => ({ getPaddleCatalog: vi.fn() }));
vi.mock('../billingCatalog.service.js', () => ({ getBillingCatalog: { getPublicCatalog: vi.fn() } }));

const actor: OperatorPrincipal = { kind: 'PLATFORM_OPERATOR', issuer: 'https://identity.example.invalid/', subject: 'fixture' };
const asOf = new Date('2026-11-19T12:00:00Z');
const webhook = new Date('2026-11-18T10:00:00Z');
const day = '2026-11-19';
const usd = (amount: number) => ({ amount, currency: 'USD' });
const starterPrice = { priceId: 'starter-fixture', plan: 'STARTER', interval: 'month' } as const;
const proPrice = { priceId: 'pro-fixture', plan: 'PRO', interval: 'month' } as const;

function harness() {
    const subscriptions = [
        { id: 'active', status: 'active', priceId: proPrice.priceId, paddleCreatedAt: new Date('2026-10-20T00:00:00Z') },
        { id: 'overdue', status: 'past_due', priceId: starterPrice.priceId, paddleCreatedAt: new Date('2026-11-08T00:00:00Z') },
    ].map(row => ({ ...row, canceledAt: null, scheduledChangeAction: null }));
    const companies = [
        { id: 1, name: 'Active fixture', plan: 'PRO', operationalStatus: 'ACTIVE', suspendedAt: null, staff: 24 },
        { id: 2, name: 'Suspended fixture', plan: 'STARTER', operationalStatus: 'SUSPENDED', suspendedAt: webhook, staff: 1 },
    ].map(({ staff, ...row }, index) => ({
        ...row, createdAt: subscriptions[index]!.paddleCreatedAt,
        billingSubscriptionId: subscriptions[index]!.id, paddleSubscriptions: [subscriptions[index]!],
        _count: { staff, managers: 1, locations: 1 }, privateField: 'private fixture',
    }));
    const findCompanies = vi.fn(async () => companies);
    const tx = {
        company: { findMany: vi.fn(async (query: { where?: object }) => query.where ? [{ id: 1 }] : companies) },
        $queryRaw: vi.fn(async () => [{ '?column?': 1 }]),
        paddleWebhookEvent: { aggregate: vi.fn(async () => ({ _max: { occurredAt: webhook, processedAt: asOf } })) },
        verificationWorkerHeartbeat: { aggregate: vi.fn(async () => ({ _max: { lastSeenAt: asOf } })) },
    };
    const readUsage = vi.fn<(...args: unknown[]) => Promise<unknown[]>>()
        .mockResolvedValueOnce([{ companyId: 1, day, count: 2n }])
        .mockResolvedValueOnce([{ day, count: 1n }])
        .mockResolvedValueOnce([{ state: 'PASSED', count: 3n }]);
    const readPayments = vi.fn(async () => [{ lastEventAt: webhook, total: '1500', currencyCode: 'USD' }]);
    const transaction = vi.fn(async (read: (client: typeof tx) => Promise<unknown>) => read(tx));
    const db = {
        company: { findMany: findCompanies },
        paddleSubscription: { findMany: vi.fn(async () => subscriptions) },
        paddleTransaction: { findMany: readPayments },
        $queryRaw: readUsage,
        $transaction: transaction,
    } as unknown as NonNullable<Parameters<typeof getPlatformOverview>[1]>;
    return { db, findCompanies, readPayments, readUsage, transaction, tx };
}

beforeEach(() => {
    vi.resetAllMocks();
    vi.stubEnv('PHOTO_CHECKS_OWNER_OVERRIDE', undefined);
    const prices = [starterPrice, proPrice];
    vi.mocked(getPaddleCatalog).mockReturnValue(prices);
    vi.mocked(getBillingCatalog.getPublicCatalog).mockResolvedValue(prices.map(({ plan, interval }) => ({
        plan, interval, amount: '2000', currencyCode: 'USD',
    })));
});

afterEach(() => vi.unstubAllEnvs());

describe('platform overview', () => {
    it('returns exactly the overview fields and merges calendar months, attention and diagnostics', async () => {
        const { db } = harness();
        expect(await getPlatformOverview(actor, db, asOf)).toEqual({
            asOf: asOf.toISOString(),
            figures: {
                companies: 2, newThisMonth: 1, paying: 2, payingShare: 1, mrr: usd(20), mrrChange: 0,
                pastDue: [{ companyId: 2, name: 'Suspended fixture', monthly: usd(20) }], activeStaff: 25,
            },
            attention: {
                items: [
                    { companyId: 2, name: 'Suspended fixture', kind: 'PAST_DUE', plan: 'STARTER', date: null },
                    { companyId: 2, name: 'Suspended fixture', kind: 'SUSPENDED', plan: 'STARTER', date: webhook.toISOString() },
                ],
                mrrAtRisk: usd(20),
            },
            upgrades: [{ companyId: 1, name: 'Active fixture', plan: 'PRO', staff: 24, staffLimit: 25 }],
            plans: [
                { plan: 'STARTER', paying: 1, mrr: usd(0) },
                { plan: 'PRO', paying: 1, mrr: usd(20) },
                { plan: 'ADVANCED', paying: 0, mrr: usd(0) },
            ],
            companiesByPlan: [
                { plan: 'STARTER', companies: 1, averageStaff: 1, largestStaff: 1 },
                { plan: 'PRO', companies: 1, averageStaff: 24, largestStaff: 24 },
                { plan: 'ADVANCED', companies: 0, averageStaff: null, largestStaff: null },
            ],
            months: lastTwelveMonths(asOf).map(month => ({
                ...month,
                signups: { STARTER: Number(month.month === '2026-11'), PRO: Number(month.month === '2026-10'), ADVANCED: 0 },
                mrrEstimate: usd(month.partial ? 40 : month.month === '2026-10' ? 20 : 0),
                collected: usd(month.partial ? 15 : 0),
            })),
            funnel: { signedUp: 2, checkedOut: 2, paying: 2, workedThisWeek: 1 },
            statusCounts: { ACTIVE: 1, PAST_DUE: 1, SCHEDULED_CANCEL: 0, CANCELLED: 0, NONE: 0 },
            tasksPerDay: lastDays(asOf, 84).map(date => ({ day: date, count: date === day ? 2 : 0 })),
            checkinsPerDay: lastDays(asOf, 14).map(date => ({ day: date, count: date === day ? 1 : 0 })),
            photos: { passed: 3, retake: 0, manager: 0, cleaning: 0 },
            busiest: [{ companyId: 1, name: 'Active fixture', tasks: 2 }],
            system: { database: 'OK', lastWebhookAt: webhook.toISOString(), photoChecks: false },
        });
    });

    it('starts other reads while usage is pending and nulls only the failed usage fields', async () => {
        const full = await getPlatformOverview(actor, harness().db, asOf);
        const h = harness();
        let rejectUsage!: (error: Error) => void;
        const usage = new Promise<never>((_resolve, reject) => { rejectUsage = reject; });
        h.readUsage.mockReset().mockReturnValue(usage);
        const result = getPlatformOverview(actor, h.db, asOf);
        expect(h.findCompanies).toHaveBeenCalled();
        expect(h.tx.company.findMany).toHaveBeenCalled();
        expect(h.tx.$queryRaw).toHaveBeenCalled();
        rejectUsage(new Error('usage unavailable'));
        expect(await result).toEqual({ ...full, tasksPerDay: null, checkinsPerDay: null, photos: null, busiest: null });
    });

    it('preserves every non-money metric when the catalog fails', async () => {
        const full = await getPlatformOverview(actor, harness().db, asOf);
        vi.mocked(getBillingCatalog.getPublicCatalog).mockRejectedValue(new Error('catalog unavailable'));
        expect(await getPlatformOverview(actor, harness().db, asOf)).toEqual({
            ...full,
            figures: {
                ...full.figures, mrr: null, mrrChange: null,
                pastDue: full.figures.pastDue!.map(row => ({ ...row, monthly: null })),
            },
            attention: { ...full.attention, mrrAtRisk: null },
            plans: full.plans!.map(plan => ({ ...plan, mrr: null })),
            months: full.months.map(month => ({ ...month, mrrEstimate: null, collected: null })),
        });
    });

    it('keeps billing months and attention when growth fails', async () => {
        const full = await getPlatformOverview(actor, harness().db, asOf);
        const h = harness();
        h.tx.company.findMany.mockRejectedValue(new Error('growth unavailable'));
        expect(await getPlatformOverview(actor, h.db, asOf)).toEqual({
            ...full,
            figures: { ...full.figures, companies: null, newThisMonth: null, activeStaff: null },
            attention: { ...full.attention, items: full.attention.items!.filter(row => row.kind !== 'SUSPENDED') },
            upgrades: null,
            companiesByPlan: null,
            months: full.months.map(month => ({ ...month, signups: null })),
            funnel: null,
        });
    });

    it('keeps signups and current billing figures when monthly billing reads fail', async () => {
        const full = await getPlatformOverview(actor, harness().db, asOf);
        const h = harness();
        h.readPayments.mockRejectedValue(new Error('payment history unavailable'));
        expect(await getPlatformOverview(actor, h.db, asOf)).toEqual({
            ...full, months: full.months.map(month => ({ ...month, mrrEstimate: null, collected: null })),
        });
    });

    it.each([['true', true], ['false', false], ['TRUE', false], [undefined, false]] as const)(
        'reflects the photo owner switch %s even when diagnostics are unavailable',
        async (value, photoChecks) => {
            const h = harness();
            vi.stubEnv('PHOTO_CHECKS_OWNER_OVERRIDE', value);
            h.tx.$queryRaw.mockRejectedValue(new Error('diagnostics unavailable'));
            const result = await getPlatformOverview(actor, h.db, asOf);
            expect(result.system).toEqual({ database: 'UNAVAILABLE', lastWebhookAt: null, photoChecks });
            expect(result.figures.companies).toBe(2);
        },
    );

    it.each([null, { role: 'ADMIN' }, { ...actor, subject: ' ' }])('refuses %j before reading', async principal => {
        const h = harness();
        await expect(getPlatformOverview(principal as OperatorPrincipal, h.db, asOf)).rejects.toMatchObject({ statusCode: 403 });
        expect(h.findCompanies).not.toHaveBeenCalled();
        expect(h.readUsage).not.toHaveBeenCalled();
        expect(h.transaction).not.toHaveBeenCalled();
        expect(getBillingCatalog.getPublicCatalog).not.toHaveBeenCalled();
    });
});
