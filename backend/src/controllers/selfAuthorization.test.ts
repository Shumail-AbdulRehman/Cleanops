import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Request, Response } from "express";
const db = vi.hoisted(() => ({ profile: vi.fn(), attendance: vi.fn() }));
vi.mock("../prisma/prisma.js", () => ({ prisma: {
  staff: { findFirst: db.profile }, attendance: { findMany: db.attendance },
} }));
import { getStaffSelfProfile } from "./staffSelf.controller.js";
import { getStaffSelfAttendance } from "./attendanceSelf.controller.js";
const request = (role?: "ADMIN" | "MANAGER" | "STAFF") => ({
  ...(role ? { user: { id: 7, role, companyId: 42 } } : {}),
} as Request);
function response() {
  const res = { status: vi.fn(), json: vi.fn() };
  res.status.mockReturnValue(res);
  return res;
}
beforeEach(() => { vi.resetAllMocks(); db.profile.mockResolvedValue({ id: 7, companyId: 42 }); db.attendance.mockResolvedValue([]); });
describe.each([
  ["profile", getStaffSelfProfile], ["attendance", getStaffSelfAttendance],
] as const)("staff self %s", (_name, handler) => {
  it.each(["ADMIN", "MANAGER"] as const)("rejects %s even with a colliding staff ID before data access", async role => {
    await expect(handler(request(role), response() as unknown as Response)).rejects.toMatchObject({ statusCode: 403 });
    expect(db.profile).not.toHaveBeenCalled(); expect(db.attendance).not.toHaveBeenCalled();
  });
  it("rejects a missing principal before data access", async () => {
    await expect(handler(request(), response() as unknown as Response)).rejects.toMatchObject({ statusCode: 401 });
    expect(db.profile).not.toHaveBeenCalled(); expect(db.attendance).not.toHaveBeenCalled();
  });
});
it("profile binds numeric ID to the staff role, tenant and active company without selecting credentials", async () => {
  const res = response(); await getStaffSelfProfile(request("STAFF"), res as unknown as Response);
  expect(db.profile).toHaveBeenCalledWith(expect.objectContaining({
    where: { id: 7, companyId: 42, role: "STAFF", isActive: true, company: { isActive: true } },
    select: expect.objectContaining({ id: true, name: true, companyId: true }),
  }));
  expect(db.profile.mock.calls[0]![0].select).not.toHaveProperty("password");
  expect(db.profile.mock.calls[0]![0].select).not.toHaveProperty("refreshToken");
  expect(res.status).toHaveBeenCalledWith(200);
});
it("does not fall back to an ID-only read when the scoped profile is absent", async () => {
  db.profile.mockResolvedValue(null);
  await expect(getStaffSelfProfile(request("STAFF"), response() as unknown as Response)).rejects.toMatchObject({ statusCode: 404 });
  expect(db.profile).toHaveBeenCalledTimes(1);
});
it("attendance binds staff and historical location to tenant while retaining own history and payload limit", async () => {
  const res = response(); await getStaffSelfAttendance(request("STAFF"), res as unknown as Response);
  expect(db.attendance).toHaveBeenCalledWith(expect.objectContaining({
    where: { staffId: 7, staff: { companyId: 42, role: "STAFF", isActive: true, company: { isActive: true } }, location: { companyId: 42 } },
    take: 30, orderBy: { date: "desc" },
  }));
  // A transferred worker may still read their own prior records, never another worker's.
  expect(db.attendance.mock.calls[0]![0].where).not.toHaveProperty("locationId");
  expect(res.status).toHaveBeenCalledWith(200);
});
