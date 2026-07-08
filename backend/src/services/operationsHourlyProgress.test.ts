import { createRequire } from "node:module";
import { Prisma } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { managerOperations } from "./managerOperations.service.js";
import { locationDay, operationsQuery } from "./operationsScope.service.js";
import { overviewAggregateSql, type OverviewSnapshot } from "./operationsOverviewAggregate.js";
import type { VerificationActor } from "./verification-v2/authorization.service.js";

const mocks = vi.hoisted(() => ({
  manager: vi.fn(), locations: vi.fn(), queryRaw: vi.fn(), transaction: vi.fn(),
}));
vi.mock("../prisma/prisma.js", () => ({
  prisma: {
    manager: { findFirst: mocks.manager },
    location: { findMany: mocks.locations },
    $transaction: mocks.transaction,
  },
}));

// PGlite is already pinned by Prisma's development dependencies. Execute the
// production SQL on an in-memory PostgreSQL fixture, with no application DB,
// network connection, migration, or added dependency.
// Its published types reference unshipped Emscripten globals; keep the small
// test-only adapter local instead of changing the project's compiler settings.
const { PGlite } = createRequire(import.meta.url)("@electric-sql/pglite");
const db: {
  exec(sql: string): Promise<unknown>;
  query<T>(sql: string, values: unknown[]): Promise<{ rows: T[] }>;
  close(): Promise<void>;
} = new PGlite();
const actor: VerificationActor = { id: 77, companyId: 1, role: "ADMIN" };
const now = new Date("2026-11-10T23:30:00Z");
let nextTaskId: number;

async function execute<T>(sql: Prisma.Sql): Promise<T[]> {
  return (await db.query<T>(sql.text, sql.values)).rows;
}
async function site(id = 1, timezone = "UTC", companyId = 1) {
  await execute(Prisma.sql`INSERT INTO "Location" (id, name, timezone, "companyId")
    VALUES (${id}, ${`Site ${id}`}, ${timezone}, ${companyId})`);
}
async function task(end: string, options: {
  start?: string; date?: string; locationId?: number; submittedAt?: string;
  completedAt?: string; status?: string; isActive?: boolean; staffId?: number;
  completionOutcome?: string;
} = {}) {
  const id = nextTaskId++;
  const endAt = new Date(end);
  const startAt = options.start ? new Date(options.start) : new Date(+endAt - 3_600_000);
  await execute(Prisma.sql`INSERT INTO "TaskInstance"
    (id, title, "locationId", "shiftStart", "shiftEnd", date, "staffSubmittedAt",
      "completedAt", status, "isActive", "staffId", "completionOutcome")
    VALUES (${id}, ${`Task ${id}`}, ${options.locationId ?? 1}, ${startAt}, ${endAt},
      ${options.date ? new Date(options.date) : startAt},
      ${options.submittedAt ? new Date(options.submittedAt) : null},
      ${options.completedAt ? new Date(options.completedAt) : null},
      ${options.status ?? "PENDING"}, ${options.isActive ?? true},
      ${options.staffId ?? null}, ${options.completionOutcome ?? null})`);
  return id;
}
async function overview(at = now, query: Record<string, unknown> = {}, who = actor) {
  const result = await managerOperations(who, operationsQuery.parse(query), "overview", at);
  if (!("metrics" in result)) throw new Error("Expected overview response");
  return result;
}
function expectFinalTotals(result: Awaited<ReturnType<typeof overview>>) {
  expect(result.hourly.at(-1)?.due).toBe(result.metrics.totalTasks);
  expect(result.hourly.at(-1)?.submitted).toBe(result.metrics.submitted);
}

beforeAll(async () => {
  await db.exec(`
    CREATE TABLE "Location" (id integer PRIMARY KEY, name text, timezone text,
      "companyId" integer, "isActive" boolean DEFAULT true);
    CREATE TABLE "ManagerLocation" ("managerId" integer, "locationId" integer);
    CREATE TABLE "TaskInstance" (id integer PRIMARY KEY, title text, "locationId" integer,
      "staffId" integer, "templateId" integer, date timestamp, "shiftStart" timestamp,
      "shiftEnd" timestamp, "staffSubmittedAt" timestamp, "completedAt" timestamp,
      status text, "isActive" boolean, "completionOutcome" text,
      "verificationVersion" integer DEFAULT 2, "verificationState" text DEFAULT 'NOT_STARTED',
      "areaNameSnapshot" text);
    CREATE TABLE "Staff" (id integer PRIMARY KEY, name text, "locationId" integer,
      "companyId" integer, "isActive" boolean DEFAULT true);
    CREATE TABLE "Attendance" (id integer, "staffId" integer, "locationId" integer,
      date timestamp, "expectedStart" timestamp, "expectedEnd" timestamp,
      "checkInTime" timestamp, "checkOutTime" timestamp, status text);
    CREATE TABLE "VerificationException" (id integer, "taskInstanceId" integer,
      "locationId" integer, "companyId" integer, state text, priority integer DEFAULT 0,
      "firstRaisedAt" timestamp);
    CREATE TABLE "VerificationIssue" (id integer, "exceptionId" integer, "reasonCode" text, state text);
    CREATE TABLE "TaskAssignment" (id integer, "taskInstanceId" integer, "staffId" integer,
      status text, "isCurrent" boolean, "assignedAt" timestamp);
  `);
}, 20_000);
afterAll(async () => { await db.close(); });
beforeEach(async () => {
  await db.exec(`TRUNCATE "Location", "ManagerLocation", "TaskInstance", "Staff",
    "Attendance", "VerificationException", "VerificationIssue", "TaskAssignment";`);
  nextTaskId = 1;
  vi.clearAllMocks();
  mocks.manager.mockImplementation(async ({ where }) => ({ id: where.id, companyId: where.companyId, role: where.role }));
  mocks.locations.mockImplementation(async ({ where }) => execute(Prisma.sql`
    SELECT l.id, l.name, l.timezone FROM "Location" l WHERE l."companyId" = ${where.companyId}
      AND l."isActive" = true
      ${where.managerAssignments ? Prisma.sql`AND EXISTS (SELECT 1 FROM "ManagerLocation" m
        WHERE m."locationId" = l.id AND m."managerId" = ${where.managerAssignments.some.managerId})` : Prisma.empty}
    ORDER BY l.name
  `));
  mocks.queryRaw.mockImplementation((sql: Prisma.Sql) => execute<OverviewSnapshot>(sql));
  mocks.transaction.mockImplementation(async (fn) => fn({ $queryRaw: mocks.queryRaw }));
});

describe("overview hourly progress using the shared scoped-task SQL", () => {
  it("accumulates due and submission events independently and fills gaps between them", async () => {
    await site();
    await task("2026-11-10T08:00:00Z", { submittedAt: "2026-11-10T07:45:00Z", status: "IN_PROGRESS" });
    await task("2026-11-10T10:59:59Z", { submittedAt: "2026-11-10T09:00:00Z" });
    await task("2026-11-10T12:00:00Z");
    const result = await overview();
    expect(result.hourly).toEqual([
      { hour: 7, due: 0, submitted: 1 }, { hour: 8, due: 1, submitted: 1 },
      { hour: 9, due: 1, submitted: 2 }, { hour: 10, due: 2, submitted: 2 },
      { hour: 11, due: 2, submitted: 2 }, { hour: 12, due: 3, submitted: 2 },
    ]);
    expectFinalTotals(result);
    expect(mocks.queryRaw).toHaveBeenCalledTimes(1);
    expect(mocks.transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: "RepeatableRead" });
  });

  it("buckets an overnight carry-over in its local end hour, including a previous-day date anchor", async () => {
    await site(1, "Asia/Karachi");
    await task("2026-11-10T01:00:00Z", {
      start: "2026-11-09T17:00:00Z", date: "2026-11-08T19:00:00Z",
      submittedAt: "2026-11-10T00:35:00Z", status: "IN_PROGRESS",
    });
    const result = await overview(now, { date: "2026-11-10" });
    expect(result.hourly).toEqual([{ hour: 5, due: 0, submitted: 1 }, { hour: 6, due: 1, submitted: 1 }]);
    expect(result.tasks[0]?.carryOver).toBe(true);
    expectFinalTotals(result);
  });

  it("sums location-local hours across timezones rather than using UTC buckets", async () => {
    await site(1, "Asia/Karachi");
    await site(2, "America/New_York");
    for (const locationId of [1, 2]) await task("2026-11-10T14:30:00Z", {
      locationId, submittedAt: "2026-11-10T13:45:00Z",
    });
    const result = await overview(new Date("2026-11-11T18:00:00Z"), { date: "2026-11-10" });
    expect(result.hourly.map(p => p.hour)).toEqual([8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19]);
    expect(result.hourly[0]).toEqual({ hour: 8, due: 0, submitted: 1 });
    expect(result.hourly[1]).toEqual({ hour: 9, due: 1, submitted: 1 });
    expect(result.hourly.at(-2)).toEqual({ hour: 18, due: 1, submitted: 2 });
    expectFinalTotals(result);
  });

  it("preserves due counts after now and masks only future submission hours", async () => {
    await site();
    await task("2026-11-10T08:00:00Z", { submittedAt: "2026-11-10T07:45:00Z" });
    await task("2026-11-10T12:00:00Z");
    const result = await overview(new Date("2026-11-10T10:15:00Z"));
    expect(result.hourly).toEqual([
      { hour: 7, due: 0, submitted: 1 }, { hour: 8, due: 1, submitted: 1 },
      { hour: 9, due: 1, submitted: 1 }, { hour: 10, due: 1, submitted: 1 },
      { hour: 11, due: 1, submitted: null }, { hour: 12, due: 2, submitted: null },
    ]);
    expect(result.hourly.at(-1)?.due).toBe(result.metrics.totalTasks);
    expect(result.hourly.filter(p => p.submitted !== null).at(-1)?.submitted).toBe(result.metrics.submitted);
  });

  it("keeps a mixed-timezone submission sum unknown once any contributing location is in the future", async () => {
    await site(1, "Asia/Karachi");
    await site(2, "America/New_York");
    for (const locationId of [1, 2]) await task("2026-11-10T14:00:00Z", {
      locationId, submittedAt: "2026-11-10T14:00:00Z",
    });
    const result = await overview(new Date("2026-11-10T15:00:00Z")); // 20:00 Karachi, 10:00 New York
    expect(result.hourly.slice(0, 2)).toEqual([{ hour: 9, due: 1, submitted: 1 }, { hour: 10, due: 1, submitted: 1 }]);
    expect(result.hourly.slice(2).every(p => p.submitted === null)).toBe(true);
    expect(result.hourly.at(-1)).toEqual({ hour: 19, due: 2, submitted: null });
    expect(result.metrics.submitted).toBe(2);
  });

  it("returns an empty hourly list and zero metrics for an empty authorized scope without querying tasks", async () => {
    const result = await overview();
    expect(result.hourly).toEqual([]);
    expect(result.metrics).toEqual({ present: 0, scheduled: 0, totalStaff: 0, totalTasks: 0,
      submitted: 0, reviewCount: 0, verified: 0, accepted: 0 });
    expect(result.comparison).toEqual([]);
    expect(result.tasks).toEqual([]);
    expect(result.attention).toEqual([]);
    expect(mocks.queryRaw).not.toHaveBeenCalled();
  });

  it("returns an empty hourly list when selected locations have no tasks", async () => {
    await site();
    const result = await overview();
    expect(result.hourly).toEqual([]);
    expect(result.comparison).toEqual([{ location: result.selected[0], present: 0, scheduled: 0,
      tasks: 0, submitted: 0, reviews: 0 }]);
  });

  it("uses exactly the metrics' active, non-cancelled, tenant and local-day task set", async () => {
    await site();
    await site(2, "UTC", 2);
    await task("2026-11-10T10:00:00Z", { submittedAt: "2026-11-10T09:00:00Z" });
    await task("2026-11-10T11:00:00Z", { isActive: false, submittedAt: "2026-11-10T08:00:00Z" });
    await task("2026-11-10T12:00:00Z", { status: "CANCELLED", submittedAt: "2026-11-10T07:00:00Z" });
    await task("2026-11-10T13:00:00Z", { locationId: 2, submittedAt: "2026-11-10T06:00:00Z" });
    await task("2026-11-09T00:00:00Z");
    await task("2026-11-10T00:00:00Z"); // ends exactly at scope start: no overlap
    await task("2026-11-11T01:00:00Z"); // starts exactly at scope end
    const result = await overview();
    expect(result.hourly).toEqual([{ hour: 9, due: 0, submitted: 1 }, { hour: 10, due: 1, submitted: 1 }]);
    expect(result.metrics.totalTasks).toBe(1);
    expectFinalTotals(result);
    // Even malformed scope input cannot bypass the SQL tenant check.
    const [foreign] = await execute<OverviewSnapshot>(overviewAggregateSql(1, [locationDay({ id: 2, timezone: "UTC" }, "today", now)], now));
    expect(foreign?.hourly).toEqual([]);
  });

  it("excludes unassigned locations and foreign tenants for a manager through the existing operationsScope", async () => {
    await site();
    await site(2);
    await site(3, "UTC", 2);
    await db.exec('INSERT INTO "ManagerLocation" VALUES (77, 1), (77, 3)');
    for (const locationId of [1, 2, 3]) await task("2026-11-10T10:00:00Z", {
      locationId, submittedAt: "2026-11-10T09:00:00Z",
    });
    const result = await overview(now, {}, { ...actor, role: "MANAGER" });
    expect(mocks.locations).toHaveBeenCalledWith(expect.objectContaining({ where: {
      companyId: 1, isActive: true, managerAssignments: { some: { managerId: 77 } },
    } }));
    expect(result.selected.map(s => s.id)).toEqual([1]);
    expect(result.comparison.map(c => c.location.id)).toEqual([1]);
    expect(result.hourly).toEqual([{ hour: 9, due: 0, submitted: 1 }, { hour: 10, due: 1, submitted: 1 }]);
    expectFinalTotals(result);
  });

  it("rejects a manager's explicit request for an unassigned location before the overview query", async () => {
    await site();
    await expect(overview(now, { locationId: 1 }, { ...actor, role: "MANAGER" }))
      .rejects.toMatchObject({ statusCode: 403 });
    expect(mocks.queryRaw).not.toHaveBeenCalled();
  });

  it("returns no hourly or comparison rows for a manager with no assignments", async () => {
    await site();
    await task("2026-11-10T10:00:00Z");
    const result = await overview(now, {}, { ...actor, role: "MANAGER" });
    expect(result.hourly).toEqual([]);
    expect(result.comparison).toEqual([]);
    expect(result.metrics.totalTasks).toBe(0);
  });

  it("returns every selected location, including empty locations beyond the old four-row cap", async () => {
    for (let id = 1; id <= 7; id++) await site(id);
    await task("2026-11-10T10:00:00Z", { locationId: 7, submittedAt: "2026-11-10T09:00:00Z" });
    const result = await overview();
    expect(result.comparison).toHaveLength(7);
    expect(result.comparison.map(c => c.location)).toEqual(result.selected);
    expect(result.comparison.slice(0, 6).every(c => c.tasks === 0 && c.submitted === 0)).toBe(true);
    expect(result.comparison[6]).toEqual({ location: result.selected[6], present: 0, scheduled: 0,
      tasks: 1, submitted: 1, reviews: 0 });
    expectFinalTotals(result);
  });

  it("applies an explicit selected-location filter to metrics, hourly and comparison alike", async () => {
    await site();
    await site(2);
    await task("2026-11-10T10:00:00Z");
    await task("2026-11-10T12:00:00Z", { locationId: 2, submittedAt: "2026-11-10T12:00:00Z" });
    const result = await overview(now, { locationId: 2 });
    expect(result.locations).toHaveLength(2);
    expect(result.selected.map(s => s.id)).toEqual([2]);
    expect(result.comparison).toHaveLength(1);
    expect(result.hourly).toEqual([{ hour: 12, due: 1, submitted: 1 }]);
    expectFinalTotals(result);
  });

  it("preserves legacy counts, attention, previews, DTO dates and separate submission/verification states", async () => {
    await site();
    await db.exec(`INSERT INTO "Staff" VALUES (10, 'Worker', 1, 1, true);
      INSERT INTO "Attendance" VALUES (1, 10, 1, '2026-11-10', '2026-11-10T07:00:00',
        '2026-11-10T15:00:00', '2026-11-10T07:01:00', NULL, 'PRESENT');`);
    const late = await task("2026-11-10T08:00:00Z", { start: "2026-11-09T23:00:00Z", staffId: 10, status: "IN_PROGRESS" });
    const unassigned = await task("2026-11-10T15:00:00Z");
    const submitted = await task("2026-11-10T09:00:00Z", {
      submittedAt: "2026-11-10T08:30:00Z", staffId: 10, status: "IN_PROGRESS", completionOutcome: "VERIFIED_COMPLETE",
    });
    await db.exec(`INSERT INTO "TaskAssignment" VALUES (20, ${late}, 10, 'STARTED', true, '2026-11-09T23:00:00');
      INSERT INTO "VerificationException" VALUES (30, ${submitted}, 1, 1, 'MANAGER_REVIEW', 1, '2026-11-10T09:00:00');
      INSERT INTO "VerificationIssue" VALUES (40, 30, 'REVIEW_REQUIRED', 'OPEN');`);
    const result = await overview(new Date("2026-11-10T10:00:00Z"));
    expect(result.metrics).toEqual({ present: 1, scheduled: 1, totalStaff: 1, totalTasks: 3,
      submitted: 1, reviewCount: 1, verified: 1, accepted: 0 });
    expect(result.chart).toEqual({ submitted: 1, inProgress: 0, notStarted: 1, overdue: 1 });
    expect(result.comparison).toEqual([{ location: result.selected[0], present: 1, scheduled: 1,
      tasks: 3, submitted: 1, reviews: 1 }]);
    expect(result.attention.map(a => ({ key: a.key, reasonCode: a.reasonCode }))).toEqual([
      { key: `task:${late}`, reasonCode: "OVERDUE" },
      { key: `unassigned:${unassigned}`, reasonCode: "UNASSIGNED" },
      { key: "review:30", reasonCode: "REVIEW_REQUIRED" },
    ]);
    expect(result.tasks.map(t => t.id)).toEqual([late, submitted, unassigned]);
    expect(result.tasks[0]).toMatchObject({ carryOver: true, rawStatus: "IN_PROGRESS",
      shiftStart: new Date("2026-11-09T23:00:00Z"), assignments: [{ id: 20, staff: { id: 10, name: "Worker" } }] });
    expect(result.tasks[1]).toMatchObject({ status: "COMPLETED", rawStatus: "IN_PROGRESS",
      staffSubmittedAt: new Date("2026-11-10T08:30:00Z"), completionOutcome: "VERIFIED_COMPLETE",
      verificationException: { id: 30, state: "MANAGER_REVIEW" } });
    expect(result.tasks.every(t => t.date instanceof Date && t.shiftEnd instanceof Date)).toBe(true);
  });

  it("prefers staffSubmittedAt over verification completedAt and counts legacy COMPLETED tasks", async () => {
    await site();
    await task("2026-11-10T10:00:00Z", { status: "COMPLETED", submittedAt: "2026-11-10T08:00:00Z", completedAt: "2026-11-10T11:00:00Z" });
    await task("2026-11-10T10:00:00Z", { status: "COMPLETED", completedAt: "2026-11-10T09:00:00Z", completionOutcome: "COMPLETED_WITH_EXCEPTIONS" });
    await task("2026-11-10T10:00:00Z", { status: "COMPLETED" });
    const result = await overview();
    expect(result.hourly).toEqual([{ hour: 8, due: 0, submitted: 1 },
      { hour: 9, due: 0, submitted: 2 }, { hour: 10, due: 3, submitted: 3 }]);
    expect(result.metrics.accepted).toBe(1);
    expectFinalTotals(result);
  });

  it("keeps a legacy early completion with no timestamps in an observed hour", async () => {
    await site();
    await task("2026-11-10T18:00:00Z", { status: "COMPLETED" });
    const result = await overview(new Date("2026-11-10T10:15:00Z"));
    expect(result.hourly[0]).toEqual({ hour: 10, due: 0, submitted: 1 });
    expect(result.hourly.at(-1)).toEqual({ hour: 18, due: 1, submitted: null });
    expect(result.metrics.submitted).toBe(1);
  });

  it("exposes the full historical day even when today's local clock is earlier", async () => {
    await site();
    await task("2026-11-10T20:00:00Z", { submittedAt: "2026-11-10T21:00:00Z" });
    const result = await overview(new Date("2026-11-11T01:00:00Z"), { date: "2026-11-10" });
    expect(result.hourly).toEqual([{ hour: 20, due: 1, submitted: 0 }, { hour: 21, due: 1, submitted: 1 }]);
    expectFinalTotals(result);
  });

  it("keeps all submission hours null for a selected day that has not started", async () => {
    await site();
    await task("2026-11-11T08:00:00Z");
    const result = await overview(now, { date: "2026-11-11" });
    expect(result.hourly).toEqual([{ hour: 8, due: 1, submitted: null }]);
  });

  it("combines repeated local hours on a 25-hour DST day without losing tasks", async () => {
    await site(1, "America/New_York");
    await task("2026-11-01T05:30:00Z", { submittedAt: "2026-11-01T04:45:00Z" });
    await task("2026-11-01T06:30:00Z", { submittedAt: "2026-11-01T06:15:00Z" });
    const result = await overview(now, { date: "2026-11-01" });
    expect(result.hourly).toEqual([{ hour: 0, due: 0, submitted: 1 }, { hour: 1, due: 2, submitted: 2 }]);
    expectFinalTotals(result);
  });

  it("uses timezone minutes as well as hours for non-integral UTC offsets", async () => {
    await site(1, "Asia/Kathmandu");
    await task("2026-11-10T03:15:00Z", { submittedAt: "2026-11-10T02:30:00Z" });
    const result = await overview(now, { date: "2026-11-10" });
    expect(result.hourly).toEqual([{ hour: 8, due: 0, submitted: 1 }, { hour: 9, due: 1, submitted: 1 }]);
    expectFinalTotals(result);
  });

  it("does not let an empty location's earlier local clock hide another location's submissions", async () => {
    await site(1, "Asia/Karachi");
    await site(2, "America/New_York");
    await task("2026-11-10T14:00:00Z", { submittedAt: "2026-11-10T14:00:00Z" });
    const result = await overview(new Date("2026-11-10T15:00:00Z"));
    expect(result.hourly).toEqual([{ hour: 19, due: 1, submitted: 1 }]);
    expectFinalTotals(result);
  });

  it("binds timezones, company ids and scope ranges as raw-SQL parameters", () => {
    const day = locationDay({ id: 1, timezone: "UTC" }, "today", now);
    const timezone = "UTC'); SELECT 1; --";
    const sql = overviewAggregateSql(51, [{ ...day, timezone }], now);
    expect(sql.text).not.toContain(timezone);
    expect(sql.values).toContain(timezone);
    expect(sql.values).toContain(51);
    expect(sql.values).toContain(day.start);
    expect(sql.values).toContain(day.end);
  });
});
