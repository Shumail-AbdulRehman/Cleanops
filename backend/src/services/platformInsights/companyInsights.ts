import { fromZonedTime } from 'date-fns-tz';
import { getPaddleEnvironment } from '../../config/paddle.js';
import { prisma } from '../../prisma/prisma.js';
import { ApiError } from '../../utils/ApiError.js';
import type { OperatorPrincipal } from '../operatorIdentity.service.js';
import type { PhotoCounts, PlatformCompanyInsightsResponse } from './contract.js';
import { karachiDay, lastDays, moneyFromMinorUnits, paddleDashboardUrl, photoOutcome, planLimits, sumMoney } from './rules.js';
import { getCompanyLastActiveAt, getCompanyOnTimeShare, getCompanyTaskCounts } from './usageMetrics.js';

type InsightsDb = Pick<typeof prisma, 'company' | 'verificationAttempt' | 'paddleTransaction' | '$queryRaw'>;
type Payment = PlatformCompanyInsightsResponse['payments'][number];

const paymentStatuses = { completed: 'PAID', paid: 'PAID', past_due: 'PAST_DUE' } as const;

function parseCompanyId(raw: unknown): number {
    const id = typeof raw === 'string' && /^[1-9]\d{0,9}$/.test(raw) ? Number(raw) : raw;
    if (typeof id !== 'number' || !Number.isInteger(id) || id < 1 || id > 2147483647) {
        throw new ApiError(400, 'Invalid company identifier');
    }
    return id;
}

function customerUrl(customerId: string | null): string | null {
    if (!customerId) return null;
    try {
        return paddleDashboardUrl(getPaddleEnvironment(), 'customer', customerId);
    } catch {
        return null;
    }
}

export async function getPlatformCompanyInsights(
    actor: OperatorPrincipal, rawId: unknown, db: InsightsDb = prisma, asOf = new Date(),
): Promise<PlatformCompanyInsightsResponse> {
    if (!actor || actor.kind !== 'PLATFORM_OPERATOR' || typeof actor.issuer !== 'string' || !actor.issuer.trim() ||
        typeof actor.subject !== 'string' || !actor.subject.trim()) throw new ApiError(403, 'Platform operator required');

    const id = parseCompanyId(rawId);
    const company = await db.company.findUnique({
        where: { id },
        select: {
            plan: true,
            operationalStatus: true,
            suspendedAt: true,
            billingCustomerId: true,
            managers: {
                where: { role: 'ADMIN', isActive: true },
                orderBy: { id: 'asc' },
                take: 1,
                select: { name: true, email: true },
            },
            _count: { select: {
                locations: { where: { isActive: true } },
                staff: { where: { isActive: true } },
                managers: { where: { isActive: true, role: 'MANAGER' } },
            } },
        },
    });
    if (!company) throw new ApiError(404, 'Company account not found');

    const firstPhotoDay = lastDays(asOf, 30)[0]!;
    const [taskCounts, lastActive, onTimeShare, attempts, transactions] = await Promise.all([
        getCompanyTaskCounts(actor, [id], 35, db, asOf),
        getCompanyLastActiveAt(actor, [id], db, asOf),
        getCompanyOnTimeShare(actor, [id], db, asOf),
        db.verificationAttempt.groupBy({
            by: ['state'],
            where: {
                session: { task: { location: { companyId: id } } },
                createdAt: { gte: fromZonedTime(firstPhotoDay + 'T00:00:00', 'Asia/Karachi'), lte: asOf },
            },
            _count: { _all: true },
        }),
        db.paddleTransaction.findMany({
            where: { companyId: id, status: { in: Object.keys(paymentStatuses) } },
            select: { id: true, status: true, invoiceNumber: true, total: true, currencyCode: true, paddleCreatedAt: true, createdAt: true },
        }),
    ]);

    const photos: PhotoCounts = { passed: 0, retake: 0, manager: 0, cleaning: 0 };
    for (const { state, _count } of attempts) {
        const outcome = photoOutcome(state);
        if (outcome) photos[outcome] += _count._all;
    }

    const payments: Payment[] = transactions.flatMap(row => {
        if (!Object.hasOwn(paymentStatuses, row.status)) return [];
        return [{
            id: row.id,
            date: (row.paddleCreatedAt ?? row.createdAt).toISOString(),
            invoice: row.invoiceNumber,
            amount: moneyFromMinorUnits(row.total, row.currencyCode),
            status: paymentStatuses[row.status as keyof typeof paymentStatuses],
        }];
    });
    payments.sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id));

    const days = taskCounts.get(id)!;
    const suspendedDay = company.operationalStatus === 'SUSPENDED' && company.suspendedAt
        ? karachiDay(company.suspendedAt)
        : null;
    const owner = company.managers[0];
    const { locations, staff, managers } = company._count;
    const link = customerUrl(company.billingCustomerId);

    return {
        owner: owner ? { name: owner.name, email: owner.email } : null,
        limits: planLimits(company.plan),
        usage: { locations, staff, managers },
        lastActiveAt: lastActive.get(id) ?? null,
        activity30: days.slice(-30),
        calendar35: days.map(day => suspendedDay && day.day > suspendedDay ? { ...day, count: 0 } : day),
        photos,
        onTimeShare: onTimeShare.get(id) ?? null,
        payments,
        paidToDate: sumMoney(payments.filter(payment => payment.status === 'PAID').map(payment => payment.amount)),
        paddle: link ? { customerUrl: link } : null,
    };
}
