vi.mock('./accountAccess.service.js',async original=>({...await original<typeof import('./accountAccess.service.js')>(),readAccountState:mock.access}));
import { beforeEach, describe, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({ access:vi.fn(), active: vi.fn(), locations: vi.fn(), total: vi.fn(), staff: vi.fn(), areas: vi.fn(), schedules: vi.fn(), tasks: vi.fn() }));
vi.mock("../prisma/prisma.js", () => ({ prisma: { location: { findMany: mock.locations, count: mock.total }, staff: { groupBy: mock.staff }, area: { groupBy: mock.areas }, taskTemplate: { groupBy: mock.schedules }, taskInstance: { groupBy: mock.tasks } } }));
vi.mock("./verification-v2/authorization.service.js", () => ({ requireActiveActor: mock.active, requireOperationalRole: (actor: { role: string }) => { if (!["ADMIN", "MANAGER"].includes(actor.role)) throw Object.assign(new Error("Operational role required"), { statusCode: 403 }); } }));
import { workspaceTaskReadiness } from "./taskReadiness.service.js";
const actor = { id: 1, companyId: 42, role: "MANAGER" as const };
const site = { id: 20, name: "Test site", timezone: "Asia/Karachi" };
const now = new Date("2026-11-01T12:00:00Z");
const group = (id: number, count: number) => ({ locationId: id, _count: { _all: count } });
beforeEach(() => {
  vi.resetAllMocks();mock.access.mockResolvedValue({company:{id:42,isActive:true,operationalStatus:'ACTIVE',billingCustomerId:null,billingSubscriptionId:null},subscription:null}); mock.active.mockResolvedValue({}); mock.locations.mockResolvedValue([site]); mock.total.mockResolvedValue(1);
  mock.staff.mockResolvedValue([]); mock.areas.mockResolvedValue([]); mock.schedules.mockResolvedValue([]); mock.tasks.mockResolvedValue([]);
});
describe("derived workspace/task readiness", () => {
  it("derives incomplete setup from real counts without writes or task generation", async () => {
    const result = await workspaceTaskReadiness(actor, {}, now);
    expect(result.sites[0]).toMatchObject({ setupReady: false, counts: { staffWithShift: 0, activeAreas: 0, readySchedules: 0, tasksToday: 0, unassignedTasksToday: 0 }, reasons: ["STAFF_SHIFT_REQUIRED", "AREA_SETUP_REQUIRED", "SCHEDULE_SETUP_REQUIRED"] });
    expect(result.calendar).toBe("DAILY_INCLUDES_EVERY_DAY");
  });
  it("keeps readiness separate from whether any task occurrence exists today", async () => {
    mock.staff.mockResolvedValue([group(20, 2)]); mock.areas.mockResolvedValue([group(20, 1)]); mock.schedules.mockResolvedValue([group(20, 1)]);
    const result = await workspaceTaskReadiness(actor, {}, now);
    expect(result.sites[0]?.setupReady).toBe(true); expect(result.sites[0]?.counts.tasksToday).toBe(0); expect(result.sites[0]?.reasons).toEqual([]);
  });
  it("binds all count queries to company and current manager location assignment", async () => {
    await workspaceTaskReadiness(actor, {}, now);
    expect(mock.locations.mock.calls[0]![0].where.AND[0]).toMatchObject({ companyId: 42, isActive: true, managerAssignments: { some: { managerId: 1 } } });
    for (const fn of [mock.staff, mock.areas, mock.schedules, mock.tasks]) for (const [query] of fn.mock.calls) {
      expect(query.where.location).toMatchObject({ companyId: 42, managerAssignments: { some: { managerId: 1 } }, id: { in: [20] } });
      expect(query.where.locationId).toEqual({ in: [20] });
    }
  });
  it("owner receives company scope without manager assignment condition", async () => {
    await workspaceTaskReadiness({ ...actor, role: "ADMIN" }, {}, now);
    expect(mock.locations.mock.calls[0]![0].where.AND[0]).not.toHaveProperty("managerAssignments");
    expect(mock.total).toHaveBeenCalledWith({ where: { companyId: 42, isActive: true } });
  });
  it("keeps an empty assigned scope empty without aggregate reads", async () => {
    mock.locations.mockResolvedValue([]); mock.total.mockResolvedValue(0);
    const result = await workspaceTaskReadiness(actor, {}, now);
    expect(result.sites).toEqual([]); expect(result.totalLocations).toBe(0); expect(mock.staff).not.toHaveBeenCalled(); expect(mock.tasks).not.toHaveBeenCalled();
  });
  it("denies a foreign or unassigned explicitly selected site", async () => {
    mock.locations.mockResolvedValue([]); mock.total.mockResolvedValue(0);
    await expect(workspaceTaskReadiness(actor, { locationId: 99 }, now)).rejects.toMatchObject({ statusCode: 404 });
    expect(mock.staff).not.toHaveBeenCalled();
  });
  it("bounds site page and returns full-scope site total rather than page total", async () => {
    mock.locations.mockResolvedValue([site, { ...site, id: 21 }]); mock.total.mockResolvedValue(100);
    const result = await workspaceTaskReadiness(actor, { limit: 1 }, now);
    expect(result.sites).toHaveLength(1); expect(result.totalLocations).toBe(100); expect(result.nextCursor).toBe(20);
    expect(mock.locations.mock.calls[0]![0]).toMatchObject({ take: 2, orderBy: { id: "asc" } });
  });
  it.each([{ limit: 51 }, { afterId: -1 }, { locationId: 1.5 }, { arbitrary: "value" }])("rejects malformed page/filter %j", async query => {
    await expect(workspaceTaskReadiness(actor, query, now)).rejects.toMatchObject({ statusCode: 400 }); expect(mock.locations).not.toHaveBeenCalled();
  });
  it("requires active operational principal before any reads", async () => {
    await expect(workspaceTaskReadiness({ ...actor, role: "STAFF" }, {}, now)).rejects.toMatchObject({ statusCode: 403 });
    mock.active.mockRejectedValue({ statusCode: 403 }); await expect(workspaceTaskReadiness(actor, {}, now)).rejects.toMatchObject({ statusCode: 403 });
    expect(mock.locations).not.toHaveBeenCalled();
  });
  it("uses site-local DST windows and exact same-site active staff schedule eligibility", async () => {
    mock.locations.mockResolvedValue([{ ...site, timezone: "America/New_York" }]);
    await workspaceTaskReadiness(actor, {}, now);
    expect(mock.tasks.mock.calls[0]![0].where.OR).toEqual([{ locationId: 20, OR: [{ date: { gte: new Date("2026-11-01T04:00:00Z"), lt: new Date("2026-11-02T05:00:00Z") } }, { shiftStart: { lt: new Date("2026-11-02T05:00:00Z") }, shiftEnd: { gt: new Date("2026-11-01T04:00:00Z") } }] }]);
    expect(mock.schedules.mock.calls[0]![0].where).toMatchObject({ setupStatus: "READY", verificationVersion: 2, area: { status: "ACTIVE" }, OR: [{ locationId: 20, staff: { companyId: 42, locationId: 20, isActive: true, role: "STAFF", shiftStart: { not: null }, shiftEnd: { not: null } } }] });
  });
  it("surfaces unassigned/no-replacement context without manufacturing staff assignment", async () => {
    mock.tasks.mockResolvedValueOnce([group(20, 3)]).mockResolvedValueOnce([group(20, 2)]);
    const result = await workspaceTaskReadiness(actor, {}, now);
    expect(result.sites[0]?.counts.unassignedTasksToday).toBe(2); expect(result.sites[0]?.reasons).toContain("NO_ELIGIBLE_STAFF");
  });
});

it('readiness does not imply permission to manage an unentitled account, including an empty site scope',async()=>{
 expect((await workspaceTaskReadiness(actor,{},now)).access.manageWork).toBe(false);
 mock.locations.mockResolvedValue([]);mock.total.mockResolvedValue(0);
 expect((await workspaceTaskReadiness(actor,{},now)).access.manageWork).toBe(false);
});
it('unavailable account state is an error, never inferred permission or a fabricated incomplete checklist',async()=>{
 mock.access.mockRejectedValue(new Error('Account read failed'));
 await expect(workspaceTaskReadiness(actor,{},now)).rejects.toThrow('Account read failed');expect(mock.locations).not.toHaveBeenCalled();
});
it('reports manage permission only from the current provider window and exact linkage',async()=>{
 mock.access.mockResolvedValue({company:{id:42,isActive:true,operationalStatus:'ACTIVE',billingCustomerId:'c',billingSubscriptionId:'s'},subscription:{id:'s',companyId:42,customerId:'c',status:'active',currentBillingPeriodStart:new Date(+now-1000),currentBillingPeriodEnd:new Date(+now+1000)}});
 expect((await workspaceTaskReadiness(actor,{},now)).access.manageWork).toBe(true);
 expect((await workspaceTaskReadiness(actor,{},new Date(+now+1000))).access.manageWork).toBe(false);
});
