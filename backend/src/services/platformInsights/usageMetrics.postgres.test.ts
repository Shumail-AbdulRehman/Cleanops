import { createRequire } from 'node:module';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import pg, { type QueryArrayConfig } from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { OperatorPrincipal } from '../operatorIdentity.service.js';
import { getCompanyLastActiveAt, getCompanyOnTimeShare, getCompanyTaskCounts, getUsageMetrics } from './usageMetrics.js';

vi.mock('../../prisma/prisma.js', () => ({ prisma: {} }));

// Prisma's development dependency already provides PostgreSQL in memory.
const { PGlite } = createRequire(import.meta.url)('@electric-sql/pglite');
const postgres: {
    exec(sql: string): Promise<unknown>;
    query(sql: string, values: unknown[], options: {
        rowMode: 'array'; parsers: Record<number, (value: string) => unknown>;
    }): Promise<unknown>;
    close(): Promise<void>;
} = new PGlite();

// Keep PrismaPg's bind and result conversions while replacing the pool's network I/O.
const pool = new pg.Pool();
pool.connect = () => { throw new Error('Use the in-memory PostgreSQL fixture'); };
pool.query = (async (query: QueryArrayConfig, values: unknown[]) => {
    // PostgreSQL OIDs for bigint, integer, text, timestamp and timestamptz.
    const parsers = Object.fromEntries([20, 23, 25, 1114, 1184].map(oid => [oid, query.types!.getTypeParser(oid, 'text')]));
    return postgres.query(query.text, values, { rowMode: 'array', parsers });
}) as typeof pool.query;
const db = new PrismaClient({ adapter: new PrismaPg(pool) }).$extends({});

const actor: OperatorPrincipal = { kind: 'PLATFORM_OPERATOR', issuer: 'fixture', subject: 'operator' };
const asOf = new Date('2026-11-20T20:30:00.123Z');
const companyIds = [1, 2, 3];

beforeAll(async () => {
    await postgres.exec(`
        SET TIME ZONE 'America/Los_Angeles';
        CREATE TYPE "AttendanceStatus" AS ENUM ('ABSENT', 'CHECKED_IN', 'CHECKED_OUT', 'LATE');
        CREATE TYPE "AttemptState" AS ENUM ('PASSED', 'RECAPTURE_REQUIRED', 'CLEANING_REQUIRED', 'REVIEW_REQUIRED', 'RESERVED');
        CREATE TABLE "Company" (id integer PRIMARY KEY, name text NOT NULL);
        CREATE TABLE "Location" (id integer PRIMARY KEY, "companyId" integer NOT NULL REFERENCES "Company");
        CREATE TABLE "TaskInstance" (
            "locationId" integer NOT NULL REFERENCES "Location", "staffSubmittedAt" timestamp(3), "completedAt" timestamp(3)
        );
        CREATE TABLE "Attendance" (
            "locationId" integer NOT NULL REFERENCES "Location", "checkInTime" timestamp(3),
            status "AttendanceStatus" NOT NULL, "isLateCheckIn" boolean NOT NULL DEFAULT false
        );
        CREATE TABLE "VerificationAttempt" (state "AttemptState" NOT NULL, "createdAt" timestamp(3) NOT NULL);

        INSERT INTO "Company" VALUES (1, 'Fixture One'), (2, 'Fixture Two'), (3, 'Fixture Three');
        INSERT INTO "Location" VALUES (10, 1), (11, 1), (20, 2), (30, 3);
        INSERT INTO "TaskInstance" VALUES
            (10, '2026-11-20 18:59:59.999', '2026-11-20 19:05:00'),
            (11, NULL, '2026-11-20 19:00:00'),
            (11, '2026-11-20 20:00:00', NULL),
            (10, '2026-11-20 20:30:00.124', '2026-11-20 19:30:00'),
            (10, NULL, '2026-10-10 12:00:00'),
            (10, NULL, NULL),
            (20, '2026-11-20 20:30:00.123', NULL);
        INSERT INTO "Attendance" VALUES
            (10, '2026-11-20 18:55:00', 'CHECKED_IN', false),
            (11, '2026-11-20 19:00:00', 'LATE', false),
            (10, '2026-11-20 20:05:00', 'CHECKED_OUT', true),
            (10, '2026-11-20 20:30:00.124', 'CHECKED_IN', false),
            (10, '2026-10-22 18:59:59.999', 'CHECKED_IN', false),
            (10, '2026-10-22 19:00:00', 'CHECKED_IN', false),
            (10, '2026-11-07 18:59:59.999', 'LATE', true),
            (10, '2026-11-07 19:00:00', 'LATE', true),
            (20, '2026-11-20 20:20:00', 'CHECKED_IN', false),
            (10, NULL, 'ABSENT', false);
        INSERT INTO "VerificationAttempt" VALUES
            ('PASSED', '2026-10-22 19:00:00'),
            ('PASSED', '2026-11-20 20:30:00.123'),
            ('PASSED', '2026-11-20 20:30:00.124'),
            ('PASSED', '2026-10-22 18:59:59.999'),
            ('RECAPTURE_REQUIRED', '2026-11-20 19:00:00'),
            ('REVIEW_REQUIRED', '2026-11-20 18:59:59.999'),
            ('CLEANING_REQUIRED', '2026-11-20 19:30:00'),
            ('RESERVED', '2026-11-20 19:45:00');
    `);
}, 20_000);

afterAll(async () => {
    await db.$disconnect();
    await pool.end();
    await postgres.close();
});

describe('platform usage on PostgreSQL', () => {
    it('fills Karachi task and check-in series, groups photo outcomes, and ranks recent companies', async () => {
        const metrics = await getUsageMetrics(actor, db, asOf);

        expect(Object.keys(metrics).sort()).toEqual(['busiest', 'checkinsPerDay', 'photos', 'tasksPerDay']);
        expect(metrics.tasksPerDay).toHaveLength(84);
        expect(metrics.tasksPerDay.filter(({ count }) => count)).toEqual([
            { day: '2026-10-10', count: 1 },
            { day: '2026-11-20', count: 1 },
            { day: '2026-11-21', count: 3 },
        ]);
        expect(metrics.checkinsPerDay).toHaveLength(14);
        expect(metrics.checkinsPerDay[0]).toEqual({ day: '2026-11-08', count: 1 });
        expect(metrics.checkinsPerDay.filter(({ count }) => count)).toEqual([
            { day: '2026-11-08', count: 1 },
            { day: '2026-11-20', count: 1 },
            { day: '2026-11-21', count: 3 },
        ]);
        expect(metrics.photos).toEqual({ passed: 2, retake: 1, manager: 1, cleaning: 1 });
        expect(metrics.busiest).toEqual([
            { companyId: 1, name: 'Fixture One', tasks: 3 },
            { companyId: 2, name: 'Fixture Two', tasks: 1 },
        ]);
    });

    it('filters per-company task counts and fills zero days', async () => {
        const activity = await getCompanyTaskCounts(actor, [1, 3], 3, db, asOf);

        expect(activity).toEqual(new Map([
            [1, [{ day: '2026-11-19', count: 0 }, { day: '2026-11-20', count: 1 }, { day: '2026-11-21', count: 2 }]],
            [3, [{ day: '2026-11-19', count: 0 }, { day: '2026-11-20', count: 0 }, { day: '2026-11-21', count: 0 }]],
        ]));
    });

    it('uses the latest check-in or task activity through the requested UTC instant', async () => {
        await expect(getCompanyLastActiveAt(actor, companyIds, db, asOf)).resolves.toEqual(new Map([
            [1, '2026-11-20T20:05:00.000Z'],
            [2, '2026-11-20T20:30:00.123Z'],
            [3, null],
        ]));
    });

    it('calculates on-time check-in share from the 30-day Karachi window', async () => {
        await expect(getCompanyOnTimeShare(actor, companyIds, db, asOf)).resolves.toEqual(new Map([
            [1, 2 / 6],
            [2, 1],
            [3, null],
        ]));
    });

    it('returns empty company results without sending an empty IN list to PostgreSQL', async () => {
        const $queryRaw = vi.fn(() => { throw new Error('An empty company list needs no query'); });
        const noReads = { $queryRaw };

        await expect(getCompanyTaskCounts(actor, [], 14, noReads, asOf)).resolves.toEqual(new Map());
        await expect(getCompanyLastActiveAt(actor, [], noReads, asOf)).resolves.toEqual(new Map());
        await expect(getCompanyOnTimeShare(actor, [], noReads, asOf)).resolves.toEqual(new Map());
        expect($queryRaw).not.toHaveBeenCalled();
    });
});
