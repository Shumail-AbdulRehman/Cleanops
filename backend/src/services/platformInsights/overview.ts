import { prisma } from '../../prisma/prisma.js';
import { ApiError } from '../../utils/ApiError.js';
import type { OperatorPrincipal } from '../operatorIdentity.service.js';
import { getPlatformDiagnostics } from '../platformSupport.service.js';
import { photoChecksOwnerOverride } from '../verification-v2/photoChecksOverride.js';
import { getBillingAttention, getBillingMonths, getRecurringRevenue, getSubscriptionStatusCounts } from './billingMetrics.js';
import type { PlatformOverviewResponse } from './contract.js';
import { getGrowthMetrics } from './growthMetrics.js';
import { lastTwelveMonths } from './rules.js';
import { getUsageMetrics } from './usageMetrics.js';

type NullableFields<T> = { [Key in keyof T]: T[Key] | null };
type Overview = PlatformOverviewResponse;
type OverviewRead = NullableFields<Omit<Overview, 'asOf' | 'figures' | 'attention' | 'months' | 'system'>> & {
    asOf: Overview['asOf'];
    figures: NullableFields<Overview['figures']>;
    attention: NullableFields<Overview['attention']>;
    months: (Omit<Overview['months'][number], 'signups'> & { signups: Overview['months'][number]['signups'] | null })[];
    system: Overview['system'];
};

export async function getPlatformOverview(
    actor: OperatorPrincipal, db = prisma, asOf = new Date(),
): Promise<OverviewRead> {
    if (!actor || actor.kind !== 'PLATFORM_OPERATOR' || typeof actor.issuer !== 'string' || !actor.issuer.trim() ||
        typeof actor.subject !== 'string' || !actor.subject.trim()) throw new ApiError(403, 'Platform operator required');

    const [revenue, billingMonths, statusCounts, billingAttention, growth, usage, diagnostics] = await Promise.all([
        getRecurringRevenue(actor, db, asOf).catch(() => null),
        getBillingMonths(actor, db, asOf).catch(() => null),
        getSubscriptionStatusCounts(actor, db).catch(() => null),
        getBillingAttention(actor, db).catch(() => null),
        getGrowthMetrics(actor, db, asOf).catch(() => null),
        getUsageMetrics(actor, db, asOf).catch(() => null),
        getPlatformDiagnostics(actor, db).catch(() => null),
    ]);

    const growthByMonth = new Map(growth?.months.map(row => [row.month, row]));
    const billingByMonth = new Map(billingMonths?.map(row => [row.month, row]));
    return {
        asOf: asOf.toISOString(),
        figures: {
            companies: growth?.figures.companies ?? null,
            newThisMonth: growth?.figures.newThisMonth ?? null,
            paying: revenue?.paying ?? null,
            payingShare: revenue?.payingShare ?? null,
            mrr: revenue?.mrr ?? null,
            mrrChange: revenue?.mrrChange ?? null,
            pastDue: billingAttention?.pastDue ?? null,
            activeStaff: growth?.figures.activeStaff ?? null,
        },
        attention: {
            items: billingAttention || growth ? [...(billingAttention?.items ?? []), ...(growth?.attention.items ?? [])] : null,
            mrrAtRisk: billingAttention?.mrrAtRisk ?? null,
        },
        upgrades: growth?.upgrades ?? null,
        plans: revenue?.plans ?? null,
        companiesByPlan: growth?.companiesByPlan ?? null,
        months: lastTwelveMonths(asOf).map(({ month, partial }) => {
            const billing = billingByMonth.get(month);
            return {
                month,
                partial,
                signups: growthByMonth.get(month)?.signups ?? null,
                mrrEstimate: billing?.mrrEstimate ?? null,
                collected: billing?.collected ?? null,
            };
        }),
        funnel: growth?.funnel ?? null,
        statusCounts,
        tasksPerDay: usage?.tasksPerDay ?? null,
        checkinsPerDay: usage?.checkinsPerDay ?? null,
        photos: usage?.photos ?? null,
        busiest: usage?.busiest ?? null,
        system: {
            database: diagnostics?.database === 'REACHABLE' ? 'OK' : 'UNAVAILABLE',
            lastWebhookAt: diagnostics?.observations?.lastWebhookOccurredAt?.toISOString() ?? null,
            photoChecks: photoChecksOwnerOverride(),
        },
    };
}
