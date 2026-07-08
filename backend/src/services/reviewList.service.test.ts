import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({ actor: vi.fn(), locations: vi.fn(), count: vi.fn() }));
vi.mock("../prisma/prisma.js", () => ({ prisma: {
  manager: { findFirst: db.actor }, location: { findMany: db.locations },
  verificationException: { count: db.count },
} }));
import { countReviews } from "./reviewList.service.js";

const actor = { id: 4, companyId: 3, role: "MANAGER" as const };
describe("review badge count", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    db.actor.mockResolvedValue(actor);
    db.locations.mockResolvedValue([{ id: 2, name: "Inactive site", timezone: "Asia/Karachi" }]);
    db.count.mockResolvedValue(7);
  });

  it("counts only open manager cases across all dates, with one scoped location read and one count", async () => {
    expect(await countReviews(actor, {})).toEqual({ total: 7 });
    expect(db.locations).toHaveBeenCalledTimes(1);
    expect(db.locations.mock.calls[0][0].where).toEqual({
      companyId: 3, managerAssignments: { some: { managerId: 4 } },
    });
    expect(db.count).toHaveBeenCalledExactlyOnceWith({ where: { AND: [
      { AND: [{ companyId: 3, locationId: { in: [2] } }, {}, {}] },
      { state: { in: ["OPEN", "MANAGER_REVIEW"] } },
    ] } });
  });

  it("rejects unauthorized locations, staff accounts and inactive accounts before counting", async () => {
    await expect(countReviews(actor, { locationId: 8 })).rejects.toMatchObject({ statusCode: 403 });
    await expect(countReviews({ ...actor, role: "STAFF" }, {})).rejects.toMatchObject({ statusCode: 403 });
    db.actor.mockResolvedValue(null);
    await expect(countReviews(actor, {})).rejects.toMatchObject({ statusCode: 403 });
    expect(db.count).not.toHaveBeenCalled();
  });
  it("keeps the optional reason predicate inside the same company and assigned-site scope", async () => {
    await countReviews(actor, { reasonCode: "MISSING_EVIDENCE", q: "sink" });
    const where = db.count.mock.calls[0][0].where;
    expect(where.AND[0].AND[0]).toEqual({ companyId: 3, locationId: { in: [2] }, issues: { some: { reasonCode: "MISSING_EVIDENCE" } } });
    expect(where.AND[0].AND[1].OR).toHaveLength(4);
    expect(where.AND[1]).toEqual({ state: { in: ["OPEN", "MANAGER_REVIEW"] } });
  });
  it("rejects oversized reason filters before any database access", async () => {
    await expect(countReviews(actor, { reasonCode: "x".repeat(81) })).rejects.toBeDefined();
    expect(db.actor).not.toHaveBeenCalled();
    expect(db.count).not.toHaveBeenCalled();
  });

});
