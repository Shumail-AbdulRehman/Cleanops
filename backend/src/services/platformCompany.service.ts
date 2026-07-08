import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../prisma/prisma.js';
import { ApiError } from '../utils/ApiError.js';
import { configuredPlanForPrice, getPaddleCatalog, requireBillingActivation } from '../config/paddle.js';
import { evaluateAccountAccess } from './accountAccess.service.js';
import { writeAuditLog } from './auditLog.service.js';
import { getPublicBillingCatalog } from './billingCatalog.service.js';
import type { OperatorPrincipal } from './operatorIdentity.service.js';
import type { Money, PlatformCompanyListItemAdditions } from './platformInsights/contract.js';
import { monthlyValue, planLimits, subscriptionState } from './platformInsights/rules.js';
import { getCompanyLastActiveAt, getCompanyTaskCounts } from './platformInsights/usageMetrics.js';

type Db = typeof prisma;
const integer = z.number().int().min(1).max(2147483647);
const query = z.object({
    q: z.string().trim().max(100).optional(),
    status: z.enum(['ACTIVE', 'SUSPENDED']).optional(),
    plan: z.enum(['STARTER', 'PRO', 'ADVANCED']).optional(),
    subscription: z.enum(['ACTIVE', 'PAST_DUE', 'SCHEDULED_CANCEL', 'CANCELLED', 'NONE']).optional(),
    after: z.string().regex(/^[1-9]\d{0,9}$/).transform(Number).pipe(integer).optional(),
    limit: z.string().regex(/^[1-9]\d?$/).transform(Number).pipe(z.number().max(50)).optional(),
}).strict();
const change = z.object({
    operationalStatus: z.enum(['ACTIVE', 'SUSPENDED']),
    expectedVersion: z.number().int().min(0).max(2147483646),
    reason: z.string().trim().min(1).max(500).refine(value => !/[\u0000-\u001f\u007f]/.test(value)),
}).strict();
const companySelect = {
    id: true, name: true, plan: true, isActive: true, operationalStatus: true,
    accountVersion: true, createdAt: true, updatedAt: true,
    _count: { select: {
        managers: { where: { isActive: true, role: 'MANAGER' } },
        staff: { where: { isActive: true } },
        locations: { where: { isActive: true } },
    } },
} satisfies Prisma.CompanySelect;
type Summary = Prisma.CompanyGetPayload<{ select: typeof companySelect }>;
// Explicit DTO construction remains mandatory even when a DB adapter returns extra fields.
const summary = (company: Summary) => ({ id: company.id, name: company.name, plan: company.plan,
    isActive: company.isActive, operationalStatus: company.operationalStatus, accountVersion: company.accountVersion,
    createdAt: company.createdAt, updatedAt: company.updatedAt,
    counts: { managers: company._count.managers, staff: company._count.staff, locations: company._count.locations } });
function operator(actor: OperatorPrincipal) {
    if (!actor || actor.kind !== 'PLATFORM_OPERATOR' || typeof actor.issuer !== 'string' || !actor.issuer.trim() ||
        typeof actor.subject !== 'string' || !actor.subject.trim()) throw new ApiError(403, 'Platform operator required');
}
function companyId(raw: unknown) {
    const parsed = typeof raw === 'string' && /^[1-9]\d{0,9}$/.test(raw) ? Number(raw) : raw;
    if (!integer.safeParse(parsed).success) throw new ApiError(400, 'Invalid company identifier');
    return parsed as number;
}
const conflict = () => new ApiError(409, 'Company account changed. Reload before trying again.');

const listSelect = { ...companySelect, billingCustomerId: true, billingSubscriptionId: true } satisfies Prisma.CompanySelect;
const mirrorSelect = {
    id: true, companyId: true, customerId: true, status: true, scheduledChangeAction: true, priceId: true,
} satisfies Prisma.PaddleSubscriptionSelect;
type ListCompany = Prisma.CompanyGetPayload<{ select: typeof listSelect }>;
type ListMirror = Prisma.PaddleSubscriptionGetPayload<{ select: typeof mirrorSelect }>;

async function readListMirrors(db: Db, companies: ListCompany[]) {
    const ids = companies.flatMap(company => company.billingCustomerId && company.billingSubscriptionId ? [company.billingSubscriptionId] : []);
    const mirrors = ids.length ? await db.paddleSubscription.findMany({ where: { id: { in: ids } }, select: mirrorSelect }) : [];
    return new Map(mirrors.map(mirror => [mirror.id, mirror]));
}

async function readMonthlyPrices(priceIds: string[]): Promise<Map<string, Money | null>> {
    if (!priceIds.length) return new Map();
    try {
        const configured = getPaddleCatalog().filter(entry => priceIds.includes(entry.priceId));
        if (!configured.length) return new Map();
        const entries = await getPublicBillingCatalog();
        return new Map(configured.map(({ priceId, plan, interval }) => [
            priceId, monthlyValue(entries.find(entry => entry.plan === plan && entry.interval === interval)),
        ]));
    } catch {
        return new Map();
    }
}

export async function listPlatformCompanies(actor: OperatorPrincipal, raw: unknown = {}, db: Db = prisma) {
    operator(actor);
    const parsed = query.safeParse(raw);
    if (!parsed.success) throw new ApiError(400, 'Invalid company filters');
    const { q, status, plan, subscription: filter, after, limit = 25 } = parsed.data;
    const where: Prisma.CompanyWhereInput = {
        ...(q ? { name: { contains: q, mode: 'insensitive' as const } } : {}),
        ...(status ? { operationalStatus: status } : {}), ...(plan ? { plan } : {}),
    };
    const matches: { company: ListCompany; subscription: PlatformCompanyListItemAdditions['subscription']; mirror?: ListMirror }[] = [];
    // Classify linked mirrors with the shared rule before counting rows toward the page.
    const batchSize = filter ? 100 : limit + 1;
    let cursor = after;
    let hasMore = false;
    while (matches.length <= limit) {
        const rows: ListCompany[] = await db.company.findMany({
            where: { ...where, ...(cursor ? { id: { gt: cursor } } : {}) },
            select: listSelect, orderBy: { id: 'asc' }, take: batchSize,
        });
        const candidates = filter ? rows : rows.slice(0, limit);
        const mirrors = await readListMirrors(db, candidates);
        for (const company of candidates) {
            const candidate = mirrors.get(company.billingSubscriptionId ?? '');
            const mirror = candidate?.companyId === company.id && candidate.customerId === company.billingCustomerId
                ? candidate : undefined;
            const subscription = subscriptionState(company, mirror);
            if (!filter || subscription === filter) matches.push({ company, subscription, mirror });
            if (matches.length > limit) break;
        }
        if (!filter || matches.length > limit) {
            hasMore = filter ? matches.length > limit : rows.length > limit;
            break;
        }
        if (rows.length < batchSize) break;
        cursor = rows.at(-1)!.id;
    }

    const page = matches.slice(0, limit);
    if (!page.length) return { items: [], nextCursor: null };
    const ids = page.map(({ company }) => company.id);
    const asOf = new Date();
    const [owners, prices, activity, lastActive] = await Promise.all([
        db.manager.findMany({
            where: { companyId: { in: ids }, role: 'ADMIN', isActive: true },
            orderBy: { id: 'asc' }, distinct: ['companyId'],
            select: { companyId: true, name: true, email: true },
        }),
        readMonthlyPrices(page.flatMap(({ mirror }) => mirror ? [mirror.priceId] : [])),
        getCompanyTaskCounts(actor, ids, 14, db, asOf),
        getCompanyLastActiveAt(actor, ids, db, asOf),
    ]);
    const ownerByCompany = new Map(owners.map(({ companyId, name, email }) => [companyId, { name, email }]));
    const items = page.map(({ company, subscription, mirror }): ReturnType<typeof summary> & PlatformCompanyListItemAdditions => ({
        ...summary(company), subscription,
        monthly: mirror ? prices.get(mirror.priceId) ?? null : null,
        owner: ownerByCompany.get(company.id) ?? null,
        limits: planLimits(company.plan),
        lastActiveAt: lastActive.get(company.id) ?? null,
        activity14: activity.get(company.id)!,
    }));
    return { items, nextCursor: hasMore ? String(page.at(-1)!.company.id) : null };
}

export async function getPlatformCompany(actor: OperatorPrincipal, rawId: unknown, db: Db = prisma) {
    operator(actor); const id = companyId(rawId);
    // A coherent local mirror snapshot; no live provider requests or guessed freshness guarantees.
    return db.$transaction(async tx => {
        const company = await tx.company.findUnique({ where: { id }, select: { ...companySelect,
            subscriptionStatus: true, billingCustomerId: true, billingSubscriptionId: true, suspendedAt: true, suspensionReason: true,
        } });
        if (!company) throw new ApiError(404, 'Company account not found');
        const sub = company.billingCustomerId && company.billingSubscriptionId ? await tx.paddleSubscription.findFirst({
            where: { id: company.billingSubscriptionId, companyId: id, customerId: company.billingCustomerId },
            select: { status: true, priceId: true, currentBillingPeriodStart: true, currentBillingPeriodEnd: true,
                canceledAt: true, pausedAt: true, scheduledChangeAction: true, scheduledChangeAt: true, lastEventAt: true, updatedAt: true },
        }) : null;
        let billingConfigured = false;
        try { requireBillingActivation(); billingConfigured = true; } catch { /* Explicit configuration boundary. */ }
        let operationalReadAllowed = false;
        try { evaluateAccountAccess({ company, subscription: null }, 'ADMIN', 'READ_OPERATIONAL'); operationalReadAllowed = true; }
        catch (error) { if (!(error instanceof ApiError) || error.statusCode !== 403) throw error; }
        const plan = sub ? configuredPlanForPrice(sub.priceId) : undefined;
        // Activity is only platform status audit, never arbitrary tenant audit JSON.
        const activity = await tx.auditLog.findMany({ where: { companyId: id, entityType: 'COMPANY_ACCOUNT', entityId: id,
            actorType: 'PLATFORM_OPERATOR', action: { in: ['COMPANY_SUSPENDED', 'COMPANY_REACTIVATED'] } },
            select: { id: true, action: true, reason: true, createdAt: true }, orderBy: { id: 'desc' }, take: 20 });
        return { company: { ...summary(company), suspendedAt: company.suspendedAt, suspensionReason: company.suspensionReason },
            operationalReadAllowed, billingConfigured, mirroredSubscriptionStatus: company.subscriptionStatus,
            providerState: sub ? 'MIRRORED' : company.billingCustomerId ? 'AWAITING_PROVIDER' : 'NOT_LINKED',
            subscription: sub ? { status: sub.status, plan: plan ?? null, catalogQualified: !!plan,
                periodStart: sub.currentBillingPeriodStart, periodEnd: sub.currentBillingPeriodEnd,
                canceledAt: sub.canceledAt, pausedAt: sub.pausedAt, scheduledChangeAction: sub.scheduledChangeAction,
                scheduledChangeAt: sub.scheduledChangeAt, lastEventAt: sub.lastEventAt, mirroredAt: sub.updatedAt } : null,
            activity: activity.map(row => ({ id: row.id, action: row.action, reason: row.reason, createdAt: row.createdAt })),
        };
    }, { isolationLevel: 'RepeatableRead' });
}

export async function setPlatformCompanyStatus(actor: OperatorPrincipal, rawId: unknown, raw: unknown, db: Db = prisma) {
    operator(actor); const id = companyId(rawId), parsed = change.safeParse(raw);
    if (!parsed.success) throw new ApiError(400, 'A status, current version and reason are required');
    const input = parsed.data;
    return db.$transaction(async tx => {
        // Same company-first lock order as billing and capacity mutations.
        await tx.$queryRaw`SELECT id FROM "Company" WHERE id=${id} FOR UPDATE`;
        const company = await tx.company.findUnique({ where: { id }, select: companySelect });
        if (!company) throw new ApiError(404, 'Company account not found');
        if (company.accountVersion !== input.expectedVersion) throw conflict();
        if (input.operationalStatus === 'ACTIVE' && !company.isActive) throw new ApiError(409, 'Inactive legacy account requires review before reactivation');
        if (company.operationalStatus === input.operationalStatus) return { company: summary(company), changed: false };
        const suspended = input.operationalStatus === 'SUSPENDED';
        const update = await tx.company.updateMany({ where: { id, accountVersion: input.expectedVersion }, data: {
            operationalStatus: input.operationalStatus, accountVersion: { increment: 1 },
            suspendedAt: suspended ? new Date() : null, suspensionReason: suspended ? input.reason : null,
        } });
        if (update.count !== 1) throw conflict();
        const updated = await tx.company.findUniqueOrThrow({ where: { id }, select: companySelect });
        await writeAuditLog({ companyId: id, actorType: 'PLATFORM_OPERATOR', actorId: null, entityType: 'COMPANY_ACCOUNT', entityId: id,
            action: suspended ? 'COMPANY_SUSPENDED' : 'COMPANY_REACTIVATED', reason: input.reason,
            oldValue: { operationalStatus: company.operationalStatus, accountVersion: company.accountVersion },
            newValue: { operationalStatus: updated.operationalStatus, accountVersion: updated.accountVersion,
                operator: { issuer: actor.issuer, subject: actor.subject } },
        }, tx);
        return { company: summary(updated), changed: true };
    });
}
