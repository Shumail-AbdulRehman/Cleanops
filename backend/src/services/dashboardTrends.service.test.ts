import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({ actor: vi.fn(), locations: vi.fn(), aggregate: vi.fn() }));
vi.mock("../prisma/prisma.js", () => ({ prisma: {
  manager: { findFirst: db.actor }, location: { findMany: db.locations }, $queryRaw: db.aggregate,
} }));
import { dashboardTrends, trendRanges } from "./dashboardTrends.service.js";

const actor = { id: 4, companyId: 3, role: "MANAGER" as const };
const now = new Date("2026-10-11T19:15:00Z");
describe("bounded dashboard trend aggregates", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    db.actor.mockResolvedValue(actor);
    db.locations.mockResolvedValue([{ id: 2, name: "Site", timezone: "Asia/Karachi" }]);
    db.aggregate.mockResolvedValue([]);
  });

  it("uses adjacent local calendar weeks, including DST and different local dates", () => {
    const karachi = trendRanges({ id: 2, timezone: "Asia/Karachi" }, "today", now);
    const ny = trendRanges({ id: 3, timezone: "America/New_York" }, "today", now);
    expect(karachi.current).toEqual({ dateFrom: "2026-10-06", dateTo: "2026-10-12" });
    expect(karachi.previous).toEqual({ dateFrom: "2026-09-29", dateTo: "2026-10-05" });
    expect(ny.current.dateTo).toBe("2026-10-11");
    const dst = trendRanges({ id: 3, timezone: "America/New_York" }, "2026-11-02", now);
    expect(+dst.end - +dst.currentStart).toBe((7 * 24 + 1) * 3600000);
  });

  it("performs one aggregate for every authorized site and returns only summary fields", async () => {
    db.aggregate.mockResolvedValue([{ locationId: 2, currentSubmitted: 2, currentScheduled: 3, previousSubmitted: 1, previousScheduled: 4 }]);
    const result = await dashboardTrends(actor, { date: "2026-10-12" }, now);
    expect(db.aggregate).toHaveBeenCalledTimes(1);
    expect(result.rows).toEqual([{
      locationId: 2,
      current: { dateFrom: "2026-10-06", dateTo: "2026-10-12", submitted: 2, scheduled: 3 },
      previous: { dateFrom: "2026-09-29", dateTo: "2026-10-05", submitted: 1, scheduled: 4 },
    }]);
    expect(db.locations).toHaveBeenCalledWith(expect.objectContaining({ where: {
      companyId: 3, isActive: true, managerAssignments: { some: { managerId: 4 } },
    } }));
  });

  it("returns an empty scope without aggregate work and rejects unauthorized locations", async () => {
    db.locations.mockResolvedValue([]);
    expect(await dashboardTrends(actor, {}, now)).toEqual({ rows: [] });
    expect(db.aggregate).not.toHaveBeenCalled();
    await expect(dashboardTrends(actor, { locationId: 9 }, now)).rejects.toMatchObject({ statusCode: 403 });
  });

  it("validates dates, asOf, repeated parameters, roles and active accounts", async () => {
    for (const query of [{ date: "2026-02-30" }, { asOf: "bad" }, { date: ["today"] }])
      await expect(dashboardTrends(actor, query, now)).rejects.toThrow();
    await expect(dashboardTrends({ ...actor, role: "STAFF" }, {}, now)).rejects.toMatchObject({ statusCode: 403 });
    db.actor.mockResolvedValue(null);
    await expect(dashboardTrends(actor, {}, now)).rejects.toMatchObject({ statusCode: 403 });
    expect(db.aggregate).not.toHaveBeenCalled();
  });
});
