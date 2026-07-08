import type { Prisma } from '@prisma/client';
import { fromZonedTime } from 'date-fns-tz';
import { z } from 'zod';
import { getPaddleCatalog, getPaddleEnvironment } from '../../config/paddle.js';
import { prisma } from '../../prisma/prisma.js';
import { ApiError } from '../../utils/ApiError.js';
import { getBillingCatalog } from '../billingCatalog.service.js';
import type { OperatorPrincipal } from '../operatorIdentity.service.js';
import { PLAN_DEFINITIONS } from '../subscription.service.js';
import type { Money, PlatformPaymentsResponse, PlatformSubscriptionsResponse, StatusCounts } from './contract.js';
import {
    isPaying, isRecurring, karachiDay, lastEightWeekStarts, moneyFromMinorUnits, monthlyValue,
    paddleDashboardUrl, subscriptionState, sumMoney,
} from './rules.js';

type SubscriptionDb = Pick<typeof prisma, 'company' | 'paddleSubscription'>;
type PaymentDb = Pick<typeof prisma, 'paddleTransaction'>;

const pageSize = 25;
const weekMs = 7 * 24 * 60 * 60 * 1000;

const subscriptionsQuery = z.object({
    status: z.enum(['ACTIVE', 'PAST_DUE', 'SCHEDULED_CANCEL', 'CANCELLED']).optional(),
    after: z.string().regex(/^[1-9]\d{0,9}$/).transform(Number).pipe(z.number().max(2147483647)).optional(),
}).strict();

const paymentCursor = z.string()
    .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z\|[^\u0000-\u001f\u007f]{1,256}$/)
    .transform(value => ({ date: value.slice(0, 24), id: value.slice(25) }))
    .refine(({ date }) => {
        const instant = new Date(date);
        return Number.isFinite(+instant) && instant.toISOString() === date;
    });

const paymentsQuery = z.object({
    range: z.enum(['month', 'three', 'all']).default('all'),
    after: paymentCursor.optional(),
}).strict();

const mirrorSelect = {
    id: true, status: true, priceId: true, scheduledChangeAction: true, scheduledChangeAt: true,
    currentBillingPeriodEnd: true, canceledAt: true,
} satisfies Prisma.PaddleSubscriptionSelect;

type Subscription = Prisma.PaddleSubscriptionGetPayload<{ select: typeof mirrorSelect }>;
type SubscriptionItem = PlatformSubscriptionsResponse['items'][number];

function requireOperator(actor: OperatorPrincipal) {
    if (!actor || actor.kind !== 'PLATFORM_OPERATOR' || typeof actor.issuer !== 'string' || !actor.issuer.trim() ||
        typeof actor.subject !== 'string' || !actor.subject.trim()) throw new ApiError(403, 'Platform operator required');
}

function paddleEnvironment() {
    try {
        return getPaddleEnvironment();
    } catch {
        return null;
    }
}

async function readPrices() {
    let configured: ReturnType<typeof getPaddleCatalog> = [];
    let entries: Awaited<ReturnType<typeof getBillingCatalog.getPublicCatalog>> = [];
    try {
        configured = getPaddleCatalog();
        entries = await getBillingCatalog.getPublicCatalog();
    } catch {
        // The configured interval remains known when the catalog is unavailable.
    }
    const currency = entries[0]?.currencyCode;
    return {
        currency: entries.every(entry => entry.currencyCode === currency) ? currency : undefined,
        prices: new Map(configured.map(({ priceId, plan, interval }) => {
            const entry = entries.find(price => price.plan === plan && price.interval === interval);
            return [priceId, {
                interval,
                amount: entry ? moneyFromMinorUnits(entry.amount, entry.currencyCode) : null,
                monthly: monthlyValue(entry),
            }];
        })),
    };
}

function subscriptionDate(status: SubscriptionItem['status'], mirror?: Subscription) {
    if (!mirror) return null;
    if (status === 'CANCELLED') return mirror.canceledAt;
    if (status === 'SCHEDULED_CANCEL') return mirror.scheduledChangeAt ?? mirror.currentBillingPeriodEnd;
    return mirror.currentBillingPeriodEnd;
}

export async function listPlatformSubscriptions(
    actor: OperatorPrincipal, raw: unknown = {}, db: SubscriptionDb = prisma, asOf = new Date(),
): Promise<PlatformSubscriptionsResponse> {
    requireOperator(actor);
    const parsed = subscriptionsQuery.safeParse(raw);
    if (!parsed.success) throw new ApiError(400, 'Invalid subscription filters');
    const { status: filter, after = 0 } = parsed.data;

    const companies = await db.company.findMany({
        orderBy: { id: 'asc' },
        select: { id: true, name: true, plan: true, billingSubscriptionId: true },
    });
    const ids = companies.flatMap(company => company.billingSubscriptionId ?? []);
    const [mirrors, catalog] = ids.length
        ? await Promise.all([
            db.paddleSubscription.findMany({ where: { id: { in: ids } }, select: mirrorSelect }),
            readPrices(),
        ])
        : [[], null];
    const byId = new Map(mirrors.map(mirror => [mirror.id, mirror]));
    const env = paddleEnvironment();

    const statusCounts: StatusCounts = { ACTIVE: 0, PAST_DUE: 0, SCHEDULED_CANCEL: 0, CANCELLED: 0, NONE: 0 };
    const recurring = Object.values(PLAN_DEFINITIONS).map(({ code: plan }) => ({ plan, values: [] as (Money | null)[] }));
    const byPlan = new Map(recurring.map(plan => [plan.plan, plan.values]));
    const weeks = lastEightWeekStarts(new Date(+asOf + 3 * weekMs)).slice(-4);
    const renewalAmounts = new Map(weeks.map(week => [week, [] as (Money | null)[]]));
    const endingSoon: PlatformSubscriptionsResponse['summary']['endingSoon'] = [];
    const items: SubscriptionItem[] = [];
    let paying = 0;

    for (const company of companies) {
        const mirror = byId.get(company.billingSubscriptionId ?? '');
        const status = subscriptionState(company, mirror);
        statusCounts[status]++;
        if (!company.billingSubscriptionId) continue;

        const price = mirror && catalog?.prices.get(mirror.priceId);
        const amount = price?.amount ?? null;
        const date = subscriptionDate(status, mirror);
        const renewsOrEndsAt = date?.toISOString() ?? null;
        if (isPaying(status)) paying++;
        if (isRecurring(status)) byPlan.get(company.plan)!.push(price?.monthly ?? null);
        if (status === 'SCHEDULED_CANCEL') {
            endingSoon.push({ companyId: company.id, name: company.name, renewsOrEndsAt });
        }
        if (status === 'ACTIVE' && date && date >= asOf) {
            renewalAmounts.get(lastEightWeekStarts(date).at(-1)!)?.push(amount);
        }
        if (company.id > after && (!filter || filter === status) && items.length <= pageSize) {
            items.push({
                companyId: company.id, name: company.name, owner: null, plan: company.plan,
                interval: price?.interval ?? null, amount, status, renewsOrEndsAt,
                paddleUrl: paddleDashboardUrl(env, 'subscription', company.billingSubscriptionId),
            });
        }
    }

    const nextCursor = items.length > pageSize ? String(items[pageSize - 1]!.companyId) : null;
    if (nextCursor) items.pop();
    if (items.length) {
        const owners = await db.company.findMany({
            where: { id: { in: items.map(item => item.companyId) } },
            select: {
                id: true,
                managers: {
                    where: { role: 'ADMIN', isActive: true },
                    orderBy: { id: 'asc' }, take: 1, select: { name: true, email: true },
                },
            },
        });
        const ownerById = new Map(owners.map(company => [company.id, company.managers[0]]));
        for (const item of items) {
            const owner = ownerById.get(item.companyId);
            if (owner) item.owner = { name: owner.name, email: owner.email };
        }
    }

    const currency = catalog?.currency;
    const mrr = sumMoney(recurring.flatMap(plan => plan.values), currency);
    return {
        summary: {
            mrrByPlan: recurring.map(({ plan, values }) => ({ plan, mrr: sumMoney(values, currency) })),
            averagePerPaying: paying && mrr ? { amount: mrr.amount / paying, currency: mrr.currency } : null,
            renewals: weeks.map(week => {
                const amounts = renewalAmounts.get(week)!;
                return { week, count: amounts.length, amount: sumMoney(amounts, currency) };
            }),
            endingSoon,
            cancelled: statusCounts.CANCELLED,
        },
        statusCounts,
        items,
        nextCursor,
    };
}

const paymentStatuses = { completed: 'PAID', paid: 'PAID', past_due: 'PAST_DUE' } as const;
type PaymentItem = PlatformPaymentsResponse['items'][number];

function paymentWindow(asOf: Date, range: 'month' | 'three' | 'all'): Prisma.DateTimeFilter {
    if (range === 'all') return { lte: asOf };
    const first = new Date(karachiDay(asOf).slice(0, 7) + '-01T00:00:00Z');
    if (range === 'three') first.setUTCMonth(first.getUTCMonth() - 2);
    return { gte: fromZonedTime(first.toISOString().slice(0, 10) + 'T00:00:00', 'Asia/Karachi'), lte: asOf };
}

function comparePayments(a: Pick<PaymentItem, 'date' | 'id'>, b: Pick<PaymentItem, 'date' | 'id'>) {
    if (a.date !== b.date) return a.date > b.date ? -1 : 1;
    return a.id < b.id ? -1 : Number(a.id > b.id);
}

export async function listPlatformPayments(
    actor: OperatorPrincipal, raw: unknown = {}, db: PaymentDb = prisma, asOf = new Date(),
): Promise<PlatformPaymentsResponse> {
    requireOperator(actor);
    const parsed = paymentsQuery.safeParse(raw);
    if (!parsed.success) throw new ApiError(400, 'Invalid payment filters');
    const { range, after } = parsed.data;
    const window = paymentWindow(asOf, range);
    const rows = await db.paddleTransaction.findMany({
        where: {
            companyId: { not: null },
            status: { in: Object.keys(paymentStatuses) },
            OR: [{ paddleCreatedAt: window }, { paddleCreatedAt: null, createdAt: window }],
        },
        select: {
            id: true, company: { select: { id: true, name: true } }, status: true, total: true,
            currencyCode: true, invoiceNumber: true, paddleCreatedAt: true, createdAt: true,
        },
    });

    const env = paddleEnvironment();
    const weeks = lastEightWeekStarts(asOf);
    const weeklyAmounts = new Map(weeks.map(week => [week, [] as (Money | null)[]]));
    const collected: (Money | null)[] = [];
    const currencies = new Set<string>();
    const items: PaymentItem[] = [];
    let pastDue = 0;

    for (const row of rows) {
        if (!row.company || !Object.hasOwn(paymentStatuses, row.status)) continue;
        const status = paymentStatuses[row.status as keyof typeof paymentStatuses];
        const date = row.paddleCreatedAt ?? row.createdAt;
        const amount = moneyFromMinorUnits(row.total, row.currencyCode);
        if (/^[A-Z]{3}$/.test(row.currencyCode)) currencies.add(row.currencyCode);
        if (status === 'PAID') {
            collected.push(amount);
            weeklyAmounts.get(lastEightWeekStarts(date).at(-1)!)?.push(amount);
        } else {
            pastDue++;
        }
        const key = { id: row.id, date: date.toISOString() };
        if (!after || comparePayments(key, after) > 0) {
            items.push({
                ...key, companyId: row.company.id, companyName: row.company.name, invoice: row.invoiceNumber,
                amount, status, paddleUrl: paddleDashboardUrl(env, 'transaction', row.id),
            });
        }
    }

    items.sort(comparePayments);
    const page = items.slice(0, pageSize);
    const last = page.at(-1);
    const currency = currencies.size === 1 ? currencies.values().next().value : undefined;
    return {
        summary: {
            weekly: weeks.map(week => ({ week, collected: sumMoney(weeklyAmounts.get(week)!, currency) })),
            paid: collected.length,
            pastDue,
            collected: sumMoney(collected, currency),
            count: collected.length + pastDue,
        },
        items: page,
        nextCursor: items.length > pageSize && last ? `${last.date}|${last.id}` : null,
    };
}
