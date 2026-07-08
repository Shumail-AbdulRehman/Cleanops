import { describe, expect, it, vi } from 'vitest';
import type { OperatorPrincipal } from '../operatorIdentity.service.js';
import type { PlanCode } from '../subscription.service.js';
import { getGrowthMetrics } from './growthMetrics.js';

const actor: OperatorPrincipal = { kind: 'PLATFORM_OPERATOR', issuer: 'test-issuer', subject: 'test-operator' };
const asOf = new Date('2026-11-19T12:00:00Z');

function company(id: number, plan: PlanCode, staff = 0, createdAt = '2026-11-01T00:00:00Z') {
    return {
        id, plan, name: `Company ${id}`, createdAt: new Date(createdAt),
        operationalStatus: 'ACTIVE', suspendedAt: null as Date | null,
        billingSubscriptionId: null as string | null,
        paddleSubscriptions: [] as { id: string; status: string; scheduledChangeAction: string | null }[],
        _count: { staff, managers: 1, locations: 1 },
        privateField: 'PRIVATE',
    };
}

function subscription(id: string, status: string, scheduledChangeAction: string | null = null) {
    return { id, status, scheduledChangeAction };
}

function harness(companies: ReturnType<typeof company>[] = [], worked: number[] = []) {
    const findMany = vi.fn()
        .mockResolvedValueOnce(companies)
        .mockResolvedValueOnce(worked.map(id => ({ id })));
    const $transaction = vi.fn(async (run: (tx: { company: { findMany: typeof findMany } }) => Promise<unknown>) =>
        run({ company: { findMany } }));
    return { db: { $transaction } as unknown as Parameters<typeof getGrowthMetrics>[1], $transaction, findMany };
}

describe('platform growth metrics', () => {
    it.each([null, { kind: 'TENANT', role: 'ADMIN' }, { ...actor, subject: ' ' }])('denies %j before any read', async principal => {
        const { db, $transaction, findMany } = harness();
        await expect(getGrowthMetrics(principal as OperatorPrincipal, db, asOf)).rejects.toMatchObject({ statusCode: 403 });
        expect($transaction).not.toHaveBeenCalled();
        expect(findMany).not.toHaveBeenCalled();
    });

    it('buckets sign-ups by current plan on either side of Karachi midnight and marks only the current month partial', async () => {
        const { db } = harness([
            company(1, 'STARTER', 0, '2026-10-31T18:59:59.999Z'),
            company(2, 'PRO', 0, '2026-10-31T19:00:00.000Z'),
            company(3, 'ADVANCED', 0, '2025-11-30T19:00:00.000Z'),
            company(4, 'STARTER', 0, '2025-11-30T18:59:59.999Z'),
        ]);
        const result = await getGrowthMetrics(actor, db, asOf);
        expect(result.figures.companies).toBe(4);
        expect(result.figures.newThisMonth).toBe(1);
        expect(result.months.map(({ month }) => month)).toEqual([
            '2025-12', '2026-01', '2026-02', '2026-03', '2026-04', '2026-05',
            '2026-06', '2026-07', '2026-08', '2026-09', '2026-10', '2026-11',
        ]);
        expect(result.months[0]).toStrictEqual({ month: '2025-12', partial: false, signups: { STARTER: 0, PRO: 0, ADVANCED: 1 } });
        expect(result.months.at(-2)).toStrictEqual({ month: '2026-10', partial: false, signups: { STARTER: 1, PRO: 0, ADVANCED: 0 } });
        expect(result.months.at(-1)).toStrictEqual({ month: '2026-11', partial: true, signups: { STARTER: 0, PRO: 1, ADVANCED: 0 } });
        expect(result.months.filter(month => month.partial)).toHaveLength(1);
    });

    it('narrows the funnel using historical checkout, current paying state and recent work', async () => {
        const { db, $transaction, findMany } = harness([
            { ...company(1, 'PRO'), billingSubscriptionId: 'a', paddleSubscriptions: [subscription('a', 'active')] },
            { ...company(2, 'PRO'), billingSubscriptionId: 'b', paddleSubscriptions: [subscription('b', 'past_due')] },
            { ...company(3, 'PRO'), billingSubscriptionId: 'c', paddleSubscriptions: [subscription('c', 'active', 'cancel')] },
            { ...company(4, 'STARTER'), billingSubscriptionId: 'd', paddleSubscriptions: [subscription('d', 'canceled'), subscription('old', 'active')] },
            { ...company(5, 'STARTER'), paddleSubscriptions: [subscription('historical', 'canceled')] },
            { ...company(6, 'STARTER'), billingSubscriptionId: 'unmirrored' },
            company(7, 'STARTER'),
        ], [1, 2, 4, 6]);
        const { funnel } = await getGrowthMetrics(actor, db, asOf);
        expect(funnel).toStrictEqual({ signedUp: 7, checkedOut: 6, paying: 3, workedThisWeek: 2 });
        expect($transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: 'RepeatableRead' });
        const window = { gte: new Date('2026-11-12T12:00:00Z'), lte: asOf };
        expect(findMany).toHaveBeenNthCalledWith(2, {
            where: {
                billingSubscriptionId: { not: null },
                locations: { some: { OR: [
                    { taskInstances: { some: { staffSubmittedAt: window } } },
                    { attendances: { some: { checkInTime: window } } },
                ] } },
            },
            select: { id: true },
        });
    });

    it('uses only active counts, rounds plan averages and ranks companies near their staff limit', async () => {
        const { db, findMany } = harness([
            company(1, 'STARTER', 3), company(2, 'PRO', 23), company(3, 'PRO', 26),
            company(4, 'PRO', 22), company(5, 'ADVANCED', 200),
        ]);
        const result = await getGrowthMetrics(actor, db, asOf);
        expect(findMany).toHaveBeenNthCalledWith(1, expect.objectContaining({ select: expect.objectContaining({
            _count: { select: {
                managers: { where: { isActive: true, role: 'MANAGER' } },
                staff: { where: { isActive: true } },
                locations: { where: { isActive: true } },
            } },
        }) }));
        expect(result.figures.activeStaff).toBe(274);
        expect(result.companiesByPlan).toStrictEqual([
            { plan: 'STARTER', companies: 1, averageStaff: 3, largestStaff: 3 },
            { plan: 'PRO', companies: 3, averageStaff: 24, largestStaff: 26 },
            { plan: 'ADVANCED', companies: 1, averageStaff: 200, largestStaff: 200 },
        ]);
        expect(result.companiesByPlan.reduce((total, plan) => total + plan.companies, 0)).toBe(result.figures.companies);
        expect(result.upgrades).toStrictEqual([
            { companyId: 3, name: 'Company 3', plan: 'PRO', staff: 26, staffLimit: 25 },
            { companyId: 2, name: 'Company 2', plan: 'PRO', staff: 23, staffLimit: 25 },
        ]);
    });

    it('returns only contract fields and supplies suspension dates when recorded', async () => {
        const { db } = harness([
            { ...company(1, 'STARTER'), operationalStatus: 'SUSPENDED', suspendedAt: new Date('2026-11-18T05:30:00Z') },
            { ...company(2, 'PRO'), operationalStatus: 'SUSPENDED' },
            company(3, 'ADVANCED'),
        ]);
        const result = await getGrowthMetrics(actor, db, asOf);
        expect(Object.keys(result).sort()).toEqual(['attention', 'companiesByPlan', 'figures', 'funnel', 'months', 'upgrades']);
        expect(result.figures).toStrictEqual({ companies: 3, newThisMonth: 3, activeStaff: 0 });
        expect(result.attention).toStrictEqual({ items: [
            { companyId: 1, name: 'Company 1', kind: 'SUSPENDED', plan: 'STARTER', date: '2026-11-18T05:30:00.000Z' },
            { companyId: 2, name: 'Company 2', kind: 'SUSPENDED', plan: 'PRO', date: null },
        ] });
        expect(JSON.stringify(result)).not.toContain('PRIVATE');
    });

    it('reports zero counts and unavailable staff statistics for an empty platform', async () => {
        const { db } = harness();
        const result = await getGrowthMetrics(actor, db, asOf);
        expect(result.figures).toStrictEqual({ companies: 0, newThisMonth: 0, activeStaff: 0 });
        expect(result.funnel).toStrictEqual({ signedUp: 0, checkedOut: 0, paying: 0, workedThisWeek: 0 });
        expect(result.upgrades).toEqual([]);
        expect(result.attention).toStrictEqual({ items: [] });
        expect(result.companiesByPlan).toStrictEqual(['STARTER', 'PRO', 'ADVANCED'].map(plan => ({
            plan, companies: 0, averageStaff: null, largestStaff: null,
        })));
    });
});
