import type { Prisma } from '@prisma/client';
import { prisma } from '../../prisma/prisma.js';
import { ApiError } from '../../utils/ApiError.js';
import type { OperatorPrincipal } from '../operatorIdentity.service.js';
import { PLAN_DEFINITIONS, type PlanCode } from '../subscription.service.js';
import type { PlatformOverviewResponse } from './contract.js';
import { isCloseToPlanLimit, isPaying, karachiDay, lastTwelveMonths, planLimits, subscriptionState } from './rules.js';

type Overview = PlatformOverviewResponse;
type Db = Pick<typeof prisma, '$transaction'>;

export type GrowthMetrics = Pick<Overview, 'companiesByPlan' | 'funnel' | 'upgrades'> & {
    figures: Pick<Overview['figures'], 'companies' | 'newThisMonth' | 'activeStaff'>;
    attention: Pick<Overview['attention'], 'items'>;
    months: Pick<Overview['months'][number], 'month' | 'partial' | 'signups'>[];
};

const companySelect = {
    id: true, name: true, plan: true, createdAt: true, operationalStatus: true, suspendedAt: true,
    billingSubscriptionId: true,
    paddleSubscriptions: { select: { id: true, status: true, scheduledChangeAction: true } },
    _count: { select: {
        managers: { where: { isActive: true, role: 'MANAGER' } },
        staff: { where: { isActive: true } },
        locations: { where: { isActive: true } },
    } },
} satisfies Prisma.CompanySelect;

export async function getGrowthMetrics(actor: OperatorPrincipal, db: Db = prisma, asOf = new Date()): Promise<GrowthMetrics> {
    if (!actor || actor.kind !== 'PLATFORM_OPERATOR' || typeof actor.issuer !== 'string' || !actor.issuer.trim() ||
        typeof actor.subject !== 'string' || !actor.subject.trim()) throw new ApiError(403, 'Platform operator required');

    const { companies, worked } = await db.$transaction(async tx => {
        const companies = await tx.company.findMany({ select: companySelect, orderBy: { id: 'asc' } });
        const window = { gte: new Date(asOf.getTime() - 7 * 24 * 60 * 60 * 1000), lte: asOf };
        const worked = await tx.company.findMany({
            where: {
                billingSubscriptionId: { not: null },
                locations: { some: { OR: [
                    { taskInstances: { some: { staffSubmittedAt: window } } },
                    { attendances: { some: { checkInTime: window } } },
                ] } },
            },
            select: { id: true },
        });
        return { companies, worked: new Set(worked.map(company => company.id)) };
    }, { isolationLevel: 'RepeatableRead' });

    const months = lastTwelveMonths(asOf).map(month => ({
        ...month, signups: { STARTER: 0, PRO: 0, ADVANCED: 0 },
    }));
    const monthsByKey = new Map(months.map(month => [month.month, month]));
    const stats = new Map<PlanCode, { companies: number; totalStaff: number; largestStaff: number }>(
        Object.values(PLAN_DEFINITIONS).map(({ code }) => [code, { companies: 0, totalStaff: 0, largestStaff: 0 }]),
    );
    const attention: GrowthMetrics['attention'] = { items: [] };
    const upgrades: GrowthMetrics['upgrades'] = [];
    const funnel = { signedUp: companies.length, checkedOut: 0, paying: 0, workedThisWeek: 0 };
    let newThisMonth = 0;
    let activeStaff = 0;

    for (const company of companies) {
        const { id: companyId, name, plan, _count: { staff } } = company;
        const signupMonth = monthsByKey.get(karachiDay(company.createdAt).slice(0, 7));
        if (signupMonth) {
            signupMonth.signups[plan]++;
            if (signupMonth.partial) newThisMonth++;
        }

        const planStats = stats.get(plan)!;
        planStats.companies++;
        planStats.totalStaff += staff;
        planStats.largestStaff = Math.max(planStats.largestStaff, staff);
        activeStaff += staff;

        if (company.billingSubscriptionId || company.paddleSubscriptions.length > 0) funnel.checkedOut++;
        const subscription = company.paddleSubscriptions.find(row => row.id === company.billingSubscriptionId);
        if (isPaying(subscriptionState(company, subscription))) {
            funnel.paying++;
            if (worked.has(companyId)) funnel.workedThisWeek++;
        }

        if (company.operationalStatus === 'SUSPENDED') {
            attention.items.push({ companyId, name, plan, kind: 'SUSPENDED', date: company.suspendedAt?.toISOString() ?? null });
        }
        if (isCloseToPlanLimit(plan, staff)) {
            upgrades.push({ companyId, name, plan, staff, staffLimit: planLimits(plan).staff });
        }
    }

    upgrades.sort((a, b) => b.staff / b.staffLimit - a.staff / a.staffLimit || a.companyId - b.companyId);
    return {
        figures: { companies: companies.length, newThisMonth, activeStaff },
        companiesByPlan: Array.from(stats, ([plan, { companies, totalStaff, largestStaff }]) => ({
            plan, companies,
            averageStaff: companies ? Math.round(totalStaff / companies) : null,
            largestStaff: companies ? largestStaff : null,
        })),
        months, funnel, attention, upgrades,
    };
}
