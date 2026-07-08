import type { Prisma } from '@prisma/client';
import { fromZonedTime } from 'date-fns-tz';
import { getPaddleCatalog } from '../../config/paddle.js';
import { prisma } from '../../prisma/prisma.js';
import { ApiError } from '../../utils/ApiError.js';
import { operationalLog } from '../../utils/operationalLog.js';
import { getBillingCatalog } from '../billingCatalog.service.js';
import type { OperatorPrincipal } from '../operatorIdentity.service.js';
import { PLAN_DEFINITIONS } from '../subscription.service.js';
import type { Money, PlatformOverviewResponse, StatusCounts } from './contract.js';
import {
    estimatedMrrAtMonthEnd, isPaying, isRecurring, karachiDay, lastTwelveMonths,
    moneyFromMinorUnits, monthlyValue, subscriptionState, sumMoney,
} from './rules.js';

type Db = Pick<typeof prisma, 'company' | 'paddleSubscription' | 'paddleTransaction'>;
type Overview = PlatformOverviewResponse;
type RecurringRevenue = Pick<Overview['figures'], 'paying' | 'payingShare' | 'mrr' | 'mrrChange'>
    & Pick<Overview, 'plans'>;
type BillingMonth = Omit<Overview['months'][number], 'signups'>;
type BillingAttention = Overview['attention'] & Pick<Overview['figures'], 'pastDue'>;

const stateSelect = { id: true, status: true, scheduledChangeAction: true } satisfies Prisma.PaddleSubscriptionSelect;
const historySelect = { priceId: true, paddleCreatedAt: true, canceledAt: true } satisfies Prisma.PaddleSubscriptionSelect;
const settledSelect = { lastEventAt: true, total: true, currencyCode: true } satisfies Prisma.PaddleTransactionSelect;
type SettledTransaction = Prisma.PaddleTransactionGetPayload<{ select: typeof settledSelect }>;
type Catalog = { prices: Map<string, Money | null>; currency?: string };

function requireOperator(actor: OperatorPrincipal) {
    if (!actor || actor.kind !== 'PLATFORM_OPERATOR' || typeof actor.issuer !== 'string' || !actor.issuer.trim() ||
        typeof actor.subject !== 'string' || !actor.subject.trim()) throw new ApiError(403, 'Platform operator required');
}

async function readCatalog(): Promise<Catalog | null> {
    try {
        const configured = getPaddleCatalog();
        const entries = await getBillingCatalog.getPublicCatalog();
        const currency = entries[0]?.currencyCode;
        const prices = new Map(configured.map(({ priceId, plan, interval }) => [
            priceId, monthlyValue(entries.find(entry => entry.plan === plan && entry.interval === interval)),
        ]));
        return { prices, currency: entries.every(entry => entry.currencyCode === currency) ? currency : undefined };
    } catch {
        return null;
    }
}

function monthStart(month: string): Date {
    return fromZonedTime(`${month}-01T00:00:00.000`, 'Asia/Karachi');
}

type HistoryRow = Prisma.PaddleSubscriptionGetPayload<{ select: typeof historySelect }>;

function monthlyHistory(rows: HistoryRow[], catalog: Catalog | null) {
    return rows.map(row => ({
        createdAt: row.paddleCreatedAt,
        canceledAt: row.canceledAt,
        monthly: catalog?.prices.get(row.priceId) ?? null,
    }));
}

export async function getRecurringRevenue(actor: OperatorPrincipal, db: Db = prisma, asOf = new Date()): Promise<RecurringRevenue> {
    requireOperator(actor);
    const [companies, subscriptions, catalog] = await Promise.all([
        db.company.findMany({ select: { billingSubscriptionId: true, plan: true } }),
        db.paddleSubscription.findMany({ select: { ...stateSelect, ...historySelect } }),
        readCatalog(),
    ]);
    const byId = new Map(subscriptions.map(row => [row.id, row]));
    const plans = Object.values(PLAN_DEFINITIONS).map(({ code: plan }) => ({ plan, paying: 0, values: [] as (Money | null)[] }));
    const byPlan = new Map(plans.map(plan => [plan.plan, plan]));
    for (const company of companies) {
        const subscription = byId.get(company.billingSubscriptionId ?? '');
        const state = subscriptionState(company, subscription);
        const plan = byPlan.get(company.plan)!;
        if (isPaying(state)) plan.paying++;
        if (subscription && isRecurring(state)) plan.values.push(catalog?.prices.get(subscription.priceId) ?? null);
    }

    const paying = plans.reduce((total, plan) => total + plan.paying, 0);
    const mrr = sumMoney(plans.flatMap(plan => plan.values), catalog?.currency);
    const lastMonthEnd = new Date(+monthStart(karachiDay(asOf).slice(0, 7)) - 1);
    const previous = estimatedMrrAtMonthEnd(monthlyHistory(subscriptions, catalog), lastMonthEnd, catalog?.currency);
    const mrrChange = mrr && previous && mrr.currency === previous.currency && previous.amount !== 0
        ? (mrr.amount - previous.amount) / previous.amount : null;

    return {
        paying,
        payingShare: companies.length ? paying / companies.length : null,
        mrr,
        mrrChange,
        plans: plans.map(({ plan, paying, values }) => ({ plan, paying, mrr: sumMoney(values, catalog?.currency) })),
    };
}

function monthlyCollections(transactions: SettledTransaction[], currency: string | undefined) {
    const byMonth = new Map<string, { values: (Money | null)[]; foreign: boolean }>();
    let currencyMismatch = false;
    for (const transaction of transactions) {
        const month = karachiDay(transaction.lastEventAt).slice(0, 7);
        const bucket = byMonth.get(month) ?? { values: [], foreign: false };
        if (transaction.currencyCode === currency) {
            bucket.values.push(moneyFromMinorUnits(transaction.total, currency));
        } else {
            bucket.foreign = true;
            currencyMismatch = true;
        }
        byMonth.set(month, bucket);
    }
    if (currencyMismatch) operationalLog({ event: 'PLATFORM_BILLING_CURRENCY_MISMATCH' }, { level: 'warn' });

    return (month: string) => {
        const bucket = byMonth.get(month);
        if (bucket?.foreign && !bucket.values.length) return null;
        return sumMoney(bucket?.values ?? [], currency);
    };
}

export async function getBillingMonths(actor: OperatorPrincipal, db: Db = prisma, asOf = new Date()): Promise<BillingMonth[]> {
    requireOperator(actor);
    const months = lastTwelveMonths(asOf);
    const catalog = await readCatalog();
    if (!catalog) return months.map(month => ({ ...month, mrrEstimate: null, collected: null }));

    const [subscriptions, transactions] = await Promise.all([
        db.paddleSubscription.findMany({ select: historySelect }),
        db.paddleTransaction.findMany({
            where: {
                status: { in: ['completed', 'paid'] },
                lastEventAt: { gte: monthStart(months[0]!.month), lte: asOf },
            },
            select: settledSelect,
        }),
    ]);
    const history = monthlyHistory(subscriptions, catalog);
    const collected = monthlyCollections(transactions, catalog.currency);
    return months.map((month, index) => {
        const end = month.partial ? asOf : new Date(+monthStart(months[index + 1]!.month) - 1);
        return { ...month, mrrEstimate: estimatedMrrAtMonthEnd(history, end, catalog.currency), collected: collected(month.month) };
    });
}

export async function getSubscriptionStatusCounts(actor: OperatorPrincipal, db: Db = prisma): Promise<StatusCounts> {
    requireOperator(actor);
    const companies = await db.company.findMany({ select: { billingSubscriptionId: true } });
    const linkedIds = companies.flatMap(company => company.billingSubscriptionId ?? []);
    const subscriptions = linkedIds.length
        ? await db.paddleSubscription.findMany({ where: { id: { in: linkedIds } }, select: stateSelect })
        : [];
    const byId = new Map(subscriptions.map(row => [row.id, row]));
    const counts: StatusCounts = { ACTIVE: 0, PAST_DUE: 0, SCHEDULED_CANCEL: 0, CANCELLED: 0, NONE: 0 };
    for (const company of companies) {
        counts[subscriptionState(company, byId.get(company.billingSubscriptionId ?? ''))]++;
    }
    return counts;
}

export async function getBillingAttention(actor: OperatorPrincipal, db: Db = prisma): Promise<BillingAttention> {
    requireOperator(actor);
    const [companies, catalog] = await Promise.all([
        db.company.findMany({
            where: { billingSubscriptionId: { not: null } },
            select: { id: true, name: true, plan: true, billingSubscriptionId: true },
            orderBy: { id: 'asc' },
        }),
        readCatalog(),
    ]);
    const linkedIds = companies.flatMap(company => company.billingSubscriptionId ?? []);
    const subscriptions = linkedIds.length ? await db.paddleSubscription.findMany({
        where: { id: { in: linkedIds } },
        select: { ...stateSelect, priceId: true, scheduledChangeAt: true },
    }) : [];
    const byId = new Map(subscriptions.map(row => [row.id, row]));
    const items: BillingAttention['items'] = [];
    const pastDue: BillingAttention['pastDue'] = [];
    const atRisk: (Money | null)[] = [];
    for (const company of companies) {
        const subscription = byId.get(company.billingSubscriptionId ?? '');
        const kind = subscriptionState(company, subscription);
        if (!subscription || (kind !== 'PAST_DUE' && kind !== 'SCHEDULED_CANCEL')) continue;

        const monthly = catalog?.prices.get(subscription.priceId) ?? null;
        const companyRef = { companyId: company.id, name: company.name };
        if (kind === 'PAST_DUE') pastDue.push({ ...companyRef, monthly });
        const end = kind === 'SCHEDULED_CANCEL' ? subscription.scheduledChangeAt : null;
        items.push({ ...companyRef, kind, plan: company.plan, date: end?.toISOString() ?? null });
        atRisk.push(monthly);
    }
    return { items, pastDue, mrrAtRisk: sumMoney(atRisk, catalog?.currency) };
}
