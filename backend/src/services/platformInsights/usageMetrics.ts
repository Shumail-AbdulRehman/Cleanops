import { Prisma, type AttemptState } from '@prisma/client';
import { prisma } from '../../prisma/prisma.js';
import { ApiError } from '../../utils/ApiError.js';
import type { OperatorPrincipal } from '../operatorIdentity.service.js';
import type { DayCount, PhotoCounts, PlatformOverviewResponse } from './contract.js';
import { lastActiveAt, lastDays, photoOutcome } from './rules.js';

type AggregateDb = Pick<typeof prisma, '$queryRaw'>;
type UsageDb = Pick<typeof prisma, '$queryRaw' | 'company'>;
type DailyCount = { day: string; count: bigint };
type CompanyDailyCount = DailyCount & { companyId: number };
type LatestActivity = { companyId: number; latest: Date | null };

export type UsageMetrics = Pick<PlatformOverviewResponse, 'tasksPerDay' | 'checkinsPerDay' | 'photos' | 'busiest'>;

function requireOperator(actor: OperatorPrincipal): void {
    if (!actor || actor.kind !== 'PLATFORM_OPERATOR' || typeof actor.issuer !== 'string' || !actor.issuer.trim() ||
        typeof actor.subject !== 'string' || !actor.subject.trim()) throw new ApiError(403, 'Platform operator required');
}

// Prisma stores DateTime as UTC timestamp without time zone. Convert only for grouping or on the bounds.
const dayBucket = (column: Prisma.Sql) => Prisma.sql`to_char(
    (${column} AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Karachi', 'YYYY-MM-DD'
)`;
// BETWEEN bounds need parentheses around AT TIME ZONE. PrismaPg binds Date values
// as UTC wall times, so cast them to the same type as the stored DateTime columns.
const startOfDayUtc = (day: string) => Prisma.sql`((${day}::date::timestamp AT TIME ZONE 'Asia/Karachi') AT TIME ZONE 'UTC')`;
const utcTimestamp = (asOf: Date) => Prisma.sql`${asOf}::timestamp`;
const taskActivity = Prisma.sql`COALESCE(t."staffSubmittedAt", t."completedAt")`;

function dailyTaskCounts(db: AggregateDb, firstDay: string, asOf: Date, companyIds?: readonly number[]) {
    const start = startOfDayUtc(firstDay);
    const end = utcTimestamp(asOf);
    const companyFilter = companyIds ? Prisma.sql`AND l."companyId" IN (${Prisma.join(companyIds)})` : Prisma.empty;
    return db.$queryRaw<CompanyDailyCount[]>(Prisma.sql`
        SELECT l."companyId", ${dayBucket(taskActivity)} AS day, COUNT(*) AS count
        FROM "TaskInstance" t
        JOIN "Location" l ON l.id = t."locationId"
        WHERE (t."staffSubmittedAt" BETWEEN ${start} AND ${end}
            OR (t."staffSubmittedAt" IS NULL AND t."completedAt" BETWEEN ${start} AND ${end}))
            ${companyFilter}
        GROUP BY l."companyId", day
    `);
}

function daySeries<T extends number | bigint>(days: readonly string[], counts: ReadonlyMap<string, T>): DayCount[] {
    return days.map(day => ({ day, count: Number(counts.get(day) ?? 0) }));
}

export async function getUsageMetrics(actor: OperatorPrincipal, db: UsageDb = prisma, asOf = new Date()): Promise<UsageMetrics> {
    requireOperator(actor);
    const taskDays = lastDays(asOf, 84);
    const checkinDays = lastDays(asOf, 14);
    const firstRecentDay = lastDays(asOf, 30)[0]!;
    const [tasks, checkins, attempts] = await Promise.all([
        dailyTaskCounts(db, taskDays[0]!, asOf),
        db.$queryRaw<DailyCount[]>(Prisma.sql`
            SELECT ${dayBucket(Prisma.sql`a."checkInTime"`)} AS day, COUNT(*) AS count
            FROM "Attendance" a
            WHERE a."checkInTime" BETWEEN ${startOfDayUtc(checkinDays[0]!)} AND ${utcTimestamp(asOf)}
            GROUP BY day
        `),
        db.$queryRaw<{ state: AttemptState; count: bigint }[]>(Prisma.sql`
            SELECT state, COUNT(*) AS count
            FROM "VerificationAttempt"
            WHERE "createdAt" BETWEEN ${startOfDayUtc(firstRecentDay)} AND ${utcTimestamp(asOf)}
            GROUP BY state
        `),
    ]);

    const taskTotals = new Map<string, number>();
    const recentByCompany = new Map<number, number>();
    for (const { companyId, day, count } of tasks) {
        const total = Number(count);
        taskTotals.set(day, (taskTotals.get(day) ?? 0) + total);
        if (day >= firstRecentDay) recentByCompany.set(companyId, (recentByCompany.get(companyId) ?? 0) + total);
    }
    const ranked = [...recentByCompany].sort(([idA, a], [idB, b]) => b - a || idA - idB).slice(0, 6);
    const companies = ranked.length ? await db.company.findMany({
        where: { id: { in: ranked.map(([id]) => id) } },
        select: { id: true, name: true },
    }) : [];
    const names = new Map(companies.map(({ id, name }) => [id, name]));
    const busiest = ranked.flatMap(([companyId, tasks]) => {
        const name = names.get(companyId);
        return name === undefined ? [] : [{ companyId, name, tasks }];
    });

    const photos: PhotoCounts = { passed: 0, retake: 0, manager: 0, cleaning: 0 };
    for (const { state, count } of attempts) {
        const outcome = photoOutcome(state);
        if (outcome) photos[outcome] += Number(count);
    }
    return {
        tasksPerDay: daySeries(taskDays, taskTotals),
        checkinsPerDay: daySeries(checkinDays, new Map(checkins.map(({ day, count }) => [day, count]))),
        photos,
        busiest,
    };
}

export async function getCompanyTaskCounts(
    actor: OperatorPrincipal, companyIds: readonly number[], days: number, db: AggregateDb = prisma, asOf = new Date(),
): Promise<Map<number, DayCount[]>> {
    requireOperator(actor);
    const result = new Map(companyIds.map(id => [id, [] as DayCount[]]));
    if (!result.size) return result;
    const dayKeys = lastDays(asOf, days);
    const [firstDay] = dayKeys;
    if (!firstDay) return result;

    const rows = await dailyTaskCounts(db, firstDay, asOf, [...result.keys()]);
    const byCompany = new Map<number, Map<string, bigint>>([...result.keys()].map(id => [id, new Map()]));
    for (const { companyId, day, count } of rows) byCompany.get(companyId)?.set(day, count);
    for (const [companyId, counts] of byCompany) result.set(companyId, daySeries(dayKeys, counts));
    return result;
}

export async function getCompanyLastActiveAt(
    actor: OperatorPrincipal, companyIds: readonly number[], db: AggregateDb = prisma, asOf = new Date(),
): Promise<Map<number, string | null>> {
    requireOperator(actor);
    const activities = new Map<number, string | null>(companyIds.map(id => [id, null]));
    if (!activities.size) return activities;
    const ids = Prisma.join([...activities.keys()]);
    // Read back the stored UTC timestamps without a session time zone conversion.
    const [tasks, checkins] = await Promise.all([
        db.$queryRaw<LatestActivity[]>(Prisma.sql`
            SELECT l."companyId", MAX(${taskActivity}) AS latest
            FROM "TaskInstance" t
            JOIN "Location" l ON l.id = t."locationId"
            WHERE l."companyId" IN (${ids}) AND ${taskActivity} <= ${utcTimestamp(asOf)}
            GROUP BY l."companyId"
        `),
        db.$queryRaw<LatestActivity[]>(Prisma.sql`
            SELECT l."companyId", MAX(a."checkInTime") AS latest
            FROM "Attendance" a
            JOIN "Location" l ON l.id = a."locationId"
            WHERE l."companyId" IN (${ids}) AND a."checkInTime" <= ${utcTimestamp(asOf)}
            GROUP BY l."companyId"
        `),
    ]);
    const taskDates = new Map(tasks.map(({ companyId, latest }) => [companyId, latest]));
    const checkinDates = new Map(checkins.map(({ companyId, latest }) => [companyId, latest]));
    for (const companyId of activities.keys()) {
        activities.set(companyId, lastActiveAt(taskDates.get(companyId), checkinDates.get(companyId))?.toISOString() ?? null);
    }
    return activities;
}

export async function getCompanyOnTimeShare(
    actor: OperatorPrincipal, companyIds: readonly number[], db: AggregateDb = prisma, asOf = new Date(),
): Promise<Map<number, number | null>> {
    requireOperator(actor);
    const shares = new Map<number, number | null>(companyIds.map(id => [id, null]));
    if (!shares.size) return shares;
    const firstDay = lastDays(asOf, 30)[0]!;
    const rows = await db.$queryRaw<{ companyId: number; total: bigint; late: bigint }[]>(Prisma.sql`
        SELECT l."companyId", COUNT(*) AS total,
            COUNT(*) FILTER (WHERE a.status = 'LATE' OR a."isLateCheckIn") AS late
        FROM "Attendance" a
        JOIN "Location" l ON l.id = a."locationId"
        WHERE l."companyId" IN (${Prisma.join([...shares.keys()])})
            AND a."checkInTime" BETWEEN ${startOfDayUtc(firstDay)} AND ${utcTimestamp(asOf)}
        GROUP BY l."companyId"
    `);
    for (const { companyId, total, late } of rows) {
        if (shares.has(companyId) && total > 0n) shares.set(companyId, Number(total - late) / Number(total));
    }
    return shares;
}
