import type { Prisma } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import type { OperatorPrincipal } from '../operatorIdentity.service.js';
import { karachiDay } from './rules.js';
import { getCompanyLastActiveAt, getCompanyOnTimeShare, getCompanyTaskCounts, getUsageMetrics } from './usageMetrics.js';

const operator: OperatorPrincipal = { kind: 'PLATFORM_OPERATOR', issuer: 'test-issuer', subject: 'test-operator' };
const asOf = new Date('2026-11-19T22:00:00Z');

function harness() {
    const query = vi.fn<(sql: Prisma.Sql) => Promise<unknown[]>>().mockResolvedValue([]);
    const findCompanies = vi.fn().mockResolvedValue([]);
    const db = { $queryRaw: query, company: { findMany: findCompanies } } as unknown as NonNullable<Parameters<typeof getUsageMetrics>[1]>;
    return { db, query, findCompanies };
}

describe('platform usage metrics', () => {
    it.each([
        { role: 'ADMIN', companyId: 1 },
        { ...operator, issuer: '' },
        null,
    ])('denies %j at every entry point before reading', async identity => {
        const { db, query, findCompanies } = harness();
        const actor = identity as OperatorPrincipal;
        await expect(getUsageMetrics(actor, db, asOf)).rejects.toMatchObject({ statusCode: 403 });
        await expect(getCompanyTaskCounts(actor, [1], 14, db, asOf)).rejects.toMatchObject({ statusCode: 403 });
        await expect(getCompanyLastActiveAt(actor, [1], db, asOf)).rejects.toMatchObject({ statusCode: 403 });
        await expect(getCompanyOnTimeShare(actor, [1], db, asOf)).rejects.toMatchObject({ statusCode: 403 });
        expect(query).not.toHaveBeenCalled();
        expect(findCompanies).not.toHaveBeenCalled();
    });

    it('groups submissions by Karachi day and uses completion only if submission is missing', async () => {
        const { db, query } = harness();
        const submittedAt = new Date('2026-11-19T20:30:00Z');
        const completedAt = new Date('2026-11-18T21:00:00Z');
        query.mockResolvedValueOnce([
            { companyId: 1, day: karachiDay(submittedAt), count: 2n },
            { companyId: 2, day: karachiDay(submittedAt), count: 1n },
            { companyId: 1, day: karachiDay(completedAt), count: 1n },
        ]).mockResolvedValueOnce([{ day: '2026-11-19', count: 4n }]);

        const { tasksPerDay, checkinsPerDay } = await getUsageMetrics(operator, db, asOf);
        const expectedDays = Array.from({ length: 84 }, (_, i) => new Date(Date.UTC(2026, 7, 29 + i)).toISOString().slice(0, 10));
        expect(tasksPerDay).toEqual(expectedDays.map(day => ({
            day, count: day === '2026-11-20' ? 3 : day === '2026-11-19' ? 1 : 0,
        })));
        expect(checkinsPerDay).toHaveLength(14);
        expect(checkinsPerDay[0]).toEqual({ day: '2026-11-07', count: 0 });
        expect(checkinsPerDay.slice(-2)).toEqual([{ day: '2026-11-19', count: 4 }, { day: '2026-11-20', count: 0 }]);

        const taskSql = query.mock.calls[0]![0];
        expect(taskSql.text).toContain(`(COALESCE(t."staffSubmittedAt", t."completedAt") AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Karachi'`);
        expect(taskSql.text).toContain('WHERE (t."staffSubmittedAt" BETWEEN');
        expect(taskSql.text).toContain('OR (t."staffSubmittedAt" IS NULL AND t."completedAt" BETWEEN');
        expect(taskSql.text).toContain('GROUP BY l."companyId", day');
        expect(taskSql.values).toEqual(['2026-08-29', asOf, '2026-08-29', asOf]);
        const checkinSql = query.mock.calls[1]![0];
        expect(checkinSql.text).toContain('WHERE a."checkInTime" BETWEEN');
        expect(checkinSql.values).toEqual(['2026-11-07', asOf]);
    });

    it('returns only allowed fields and four outcome counts and ranks six companies using just the last 30 days', async () => {
        const { db, query, findCompanies } = harness();
        query.mockResolvedValueOnce([
            ...[8, 7, 6, 5, 4, 3, 2, 1].map(companyId => ({ companyId, day: '2026-11-20', count: BigInt(companyId) })),
            { companyId: 7, day: '2026-10-22', count: 1n },
            { companyId: 1, day: '2026-10-21', count: 500n },
        ]).mockResolvedValueOnce([]).mockResolvedValueOnce([
            { state: 'PASSED', count: 4n, file: 'private' },
            { state: 'RECAPTURE_REQUIRED', count: 3n },
            { state: 'REVIEW_REQUIRED', count: 2n },
            { state: 'CLEANING_REQUIRED', count: 1n },
            { state: 'SERVICE_FAILURE', count: 99n },
            { state: 'RESERVED', count: 11n },
        ]);
        findCompanies.mockResolvedValue([3, 4, 5, 6, 7, 8].map(id => ({
            id, name: `Company ${id}`, person: 'private', photoUrl: 'private',
        })));

        const result = await getUsageMetrics(operator, db, asOf);
        expect(Object.keys(result)).toEqual(['tasksPerDay', 'checkinsPerDay', 'photos', 'busiest']);
        expect(result.tasksPerDay).toContainEqual({ day: '2026-10-21', count: 500 });
        expect(result.photos).toEqual({ passed: 4, retake: 3, manager: 2, cleaning: 1 });
        expect(result.busiest).toEqual([7, 8, 6, 5, 4, 3].map(companyId => ({
            companyId, name: `Company ${companyId}`, tasks: companyId === 7 ? 8 : companyId,
        })));
        expect(JSON.stringify(result)).not.toContain('private');
        expect(findCompanies).toHaveBeenCalledWith({ where: { id: { in: [7, 8, 6, 5, 4, 3] } }, select: { id: true, name: true } });
        const photoSql = query.mock.calls[2]![0];
        expect(photoSql.text).toContain('SELECT state, COUNT(*) AS count');
        expect(photoSql.text).toContain('WHERE "createdAt" BETWEEN');
        expect(photoSql.values).toEqual(['2026-10-22', asOf]);
    });

    it('fills empty activity with zeros and skips the company lookup', async () => {
        const { db, findCompanies } = harness();
        const result = await getUsageMetrics(operator, db, asOf);
        expect([...result.tasksPerDay, ...result.checkinsPerDay].map(row => row.count)).toEqual(Array(98).fill(0));
        expect(result.photos).toEqual({ passed: 0, retake: 0, manager: 0, cleaning: 0 });
        expect(result.busiest).toEqual([]);
        expect(findCompanies).not.toHaveBeenCalled();
    });

    it('keeps the requested company task series separate and includes zero days for silent companies', async () => {
        const { db, query } = harness();
        query.mockResolvedValueOnce([
            { companyId: 2, day: '2026-11-19', count: 2n },
            { companyId: 3, day: '2026-11-19', count: 5n },
            { companyId: 9, day: '2026-11-20', count: 99n },
        ]);
        const counts = await getCompanyTaskCounts(operator, [2, 3, 4, 2], 2, db, asOf);
        expect([...counts]).toEqual([2, 3, 4].map(id => [id, [
            { day: '2026-11-19', count: id === 2 ? 2 : id === 3 ? 5 : 0 },
            { day: '2026-11-20', count: 0 },
        ]]));
        const sql = query.mock.calls[0]![0];
        expect(sql.text).toContain('JOIN "Location" l ON l.id = t."locationId"');
        expect(sql.text).toContain('AND l."companyId" IN ($5,$6,$7)');
        expect(sql.values).toEqual(['2026-11-19', asOf, '2026-11-19', asOf, 2, 3, 4]);
    });

    it('takes the later task activity or check-in for each company and leaves missing activity null', async () => {
        const { db, query } = harness();
        const earlier = new Date('2026-08-01T04:00:00Z');
        const later = new Date('2026-10-01T03:00:00Z');
        query.mockResolvedValueOnce([
            { companyId: 1, latest: earlier }, { companyId: 2, latest: later }, { companyId: 4, latest: earlier },
        ]).mockResolvedValueOnce([
            { companyId: 1, latest: later }, { companyId: 2, latest: earlier }, { companyId: 5, latest: later },
            { companyId: 9, latest: later },
        ]);
        const activities = await getCompanyLastActiveAt(operator, [1, 2, 3, 4, 5], db, asOf);
        expect([...activities]).toEqual([[1, later.toISOString()], [2, later.toISOString()], [3, null], [4, earlier.toISOString()], [5, later.toISOString()]]);
        const [task, checkin] = query.mock.calls.map(([sql]) => sql);
        expect(task!.text).toContain('MAX(COALESCE(t."staffSubmittedAt", t."completedAt"))');
        expect(checkin!.text).toContain('MAX(a."checkInTime")');
        for (const sql of [task!, checkin!]) {
            expect(sql.text).toContain('WHERE l."companyId" IN ($1,$2,$3,$4,$5)');
            expect(sql.values).toEqual([1, 2, 3, 4, 5, asOf]);
        }
    });

    it('calculates each share from recorded check-ins and preserves the late flag after checkout', async () => {
        const { db, query } = harness();
        query.mockResolvedValueOnce([
            { companyId: 1, total: 4n, late: 1n }, { companyId: 2, total: 1n, late: 1n },
            { companyId: 3, total: 3n, late: 0n }, { companyId: 9, total: 4n, late: 0n },
        ]);
        expect([...await getCompanyOnTimeShare(operator, [1, 2, 3, 4], db, asOf)]).toEqual([[1, 0.75], [2, 0], [3, 1], [4, null]]);
        const sql = query.mock.calls[0]![0];
        expect(sql.text).toContain('COUNT(*) FILTER (WHERE a.status = \'LATE\' OR a."isLateCheckIn")');
        expect(sql.text).toContain('AND a."checkInTime" BETWEEN');
        expect(sql.values).toEqual([1, 2, 3, 4, '2026-10-22', asOf]);
    });

    it('skips queries for empty company sets and zero days', async () => {
        const { db, query } = harness();
        expect(await getCompanyTaskCounts(operator, [], 14, db, asOf)).toEqual(new Map());
        expect(await getCompanyTaskCounts(operator, [1], 0, db, asOf)).toEqual(new Map([[1, []]]));
        expect(await getCompanyLastActiveAt(operator, [], db, asOf)).toEqual(new Map());
        expect(await getCompanyOnTimeShare(operator, [], db, asOf)).toEqual(new Map());
        expect(query).not.toHaveBeenCalled();
    });
});
