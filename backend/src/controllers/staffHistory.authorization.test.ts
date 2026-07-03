import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Request, Response } from "express";
const db = vi.hoisted(() => ({
  staff: vi.fn(), templates: vi.fn(), templateCount: vi.fn(),
  tasks: vi.fn(), taskGroups: vi.fn(), taskCount: vi.fn(),
  attendance: vi.fn(), attendanceGroups: vi.fn(), attendanceCount: vi.fn(), reports: vi.fn(),
}));
vi.mock("../prisma/prisma.js", () => ({ prisma: {
  staff: { findUnique: db.staff },
  taskTemplate: { findMany: db.templates, count: db.templateCount },
  taskInstance: { findMany: db.tasks, groupBy: db.taskGroups, count: db.taskCount },
  attendance: { findMany: db.attendance, groupBy: db.attendanceGroups, count: db.attendanceCount },
} }));
vi.mock("../services/verification-v2/reviewClosure.service.js", () => ({ staffPerformanceReports: db.reports }));
import { getStaffDetails } from "./staff.controller.js";
const request = (role: "ADMIN" | "MANAGER" | "STAFF" = "MANAGER", locationIds = [20], query = {}) => ({
  user: { id: 1, role, companyId: 42, locationIds }, params: { id: "7" }, query,
} as unknown as Request);
function response() { const res = { status: vi.fn(), json: vi.fn() }; res.status.mockReturnValue(res); return res; }
beforeEach(() => {
  vi.resetAllMocks(); db.staff.mockResolvedValue({ id: 7, companyId: 42, locationId: 20, location: { timezone: "Asia/Karachi" } });
  for (const mock of [db.templates, db.tasks, db.attendance, db.taskGroups, db.attendanceGroups]) mock.mockResolvedValue([]);
  for (const mock of [db.templateCount, db.taskCount, db.attendanceCount]) mock.mockResolvedValue(0);
  db.reports.mockResolvedValue({ total: 0, reports: [] });
});
const queries = () => [db.templates, db.templateCount, db.tasks, db.taskGroups, db.taskCount, db.attendance, db.attendanceGroups].map(mock => mock.mock.calls[0]![0].where);
describe("historical worker detail authorization", () => {
  it("scopes every history list and total to historical site B after a worker transfer from A", async () => {
    await getStaffDetails(request(), response() as unknown as Response);
    for (const where of queries()) expect(where).toMatchObject({ staffId: 7, location: { companyId: 42 }, locationId: { in: [20] } });
    const late = db.attendanceCount.mock.calls[0]![0].where;
    expect(late.AND[0]).toMatchObject({ staffId: 7, locationId: { in: [20] }, location: { companyId: 42 } });
    expect(late.AND[1]).toEqual({ OR: [{ status: "LATE" }, { isLateCheckIn: true }] });
  });
  it("keeps owner company-wide histories but never drops the company boundary", async () => {
    await getStaffDetails(request("ADMIN"), response() as unknown as Response);
    for (const where of queries()) { expect(where).toMatchObject({ staffId: 7, location: { companyId: 42 } }); expect(where).not.toHaveProperty("locationId"); }
  });
  it("scopes to exactly the manager's assigned set, not only the current worker site", async () => {
    await getStaffDetails(request("MANAGER", [10, 20]), response() as unknown as Response);
    for (const where of queries()) expect(where.locationId).toEqual({ in: [10, 20] });
  });
  it("preserves date OR predicates for late attendance totals", async () => {
    await getStaffDetails(request("MANAGER", [20], { month: "2026-10" }), response() as unknown as Response);
    const where = db.attendanceCount.mock.calls[0]![0].where;
    expect(where.AND[0].OR).toHaveLength(2);
    expect(where.AND[0].OR[0].date.gte).toEqual(new Date("2026-09-30T19:00:00Z"));
    expect(where.AND[0].OR[1]).toHaveProperty("expectedStart");
  });
  it.each([{ ids: [] }, { ids: [10] }])("denies a manager with no access to the current site: $ids", async ({ ids }) => {
    await expect(getStaffDetails(request("MANAGER", ids), response() as unknown as Response)).rejects.toMatchObject({ statusCode: 403 });
    expect(db.tasks).not.toHaveBeenCalled(); expect(db.attendance).not.toHaveBeenCalled();
  });
  it("denies a worker from another company before any history/total read", async () => {
    db.staff.mockResolvedValue({ id: 7, companyId: 99, locationId: 20 });
    await expect(getStaffDetails(request("ADMIN"), response() as unknown as Response)).rejects.toMatchObject({ statusCode: 404 });
    expect(db.templateCount).not.toHaveBeenCalled(); expect(db.attendance).not.toHaveBeenCalled();
  });
  it("rejects STAFF and malformed IDs before the worker lookup", async () => {
    await expect(getStaffDetails(request("STAFF"), response() as unknown as Response)).rejects.toMatchObject({ statusCode: 403 });
    const req = request(); req.params.id = "1.5";
    await expect(getStaffDetails(req, response() as unknown as Response)).rejects.toMatchObject({ statusCode: 400 });
    expect(db.staff).not.toHaveBeenCalled();
  });
});
