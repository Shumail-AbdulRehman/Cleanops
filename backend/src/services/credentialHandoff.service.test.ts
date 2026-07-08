import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../utils/ApiError.js";
const mock = vi.hoisted(() => ({ transaction: vi.fn(), raw: vi.fn(), managerFind: vi.fn(), staffFind: vi.fn(), managerUpdate: vi.fn(), staffUpdate: vi.fn(), push: vi.fn(), tokens: vi.fn(), password: vi.fn(), audit: vi.fn(), location: vi.fn() }));
vi.mock("../prisma/prisma.js", () => ({ prisma: { $transaction: mock.transaction } }));
vi.mock("../utils/auth.js", () => ({ isPasswordCorrect: mock.password }));
vi.mock("./auditLog.service.js", () => ({ writeAuditLog: mock.audit }));
vi.mock("./verification-v2/authorization.service.js", () => ({ requireLocationAccess: mock.location }));
import { changeOwnPassword, signOutStaffEverywhere } from "./credentialHandoff.service.js";
const actor = { id: 1, companyId: 42, role: "ADMIN" as const };
const manager = { id: 2, companyId: 42, role: "MANAGER" as const };
const staff = { id: 7, companyId: 42, role: "STAFF", isActive: true, locationId: 20 };
const tx = {
  $queryRaw: mock.raw,
  manager: { findFirst: mock.managerFind, update: mock.managerUpdate },
  staff: { findFirst: mock.staffFind, update: mock.staffUpdate },
  staffPushDevice: { updateMany: mock.push },
  credentialToken: { updateMany: mock.tokens },
};
beforeEach(() => {
  vi.resetAllMocks(); mock.transaction.mockImplementation(async work => work(tx));
  mock.managerFind.mockResolvedValue({ id: 1, companyId: 42, password: "stored-hash", role: "ADMIN" });
  mock.staffFind.mockResolvedValue(staff);
  mock.password.mockImplementation(async plain => plain === "correct-current" || plain === "same-password");
  mock.tokens.mockResolvedValue({ count: 1 }); mock.raw.mockResolvedValue([]); mock.location.mockResolvedValue({});
});
describe("self password change", () => {
  it.each(["ADMIN", "MANAGER"] as const)("requires current password and revokes %s credentials without leaking them to audit", async role => {
    const principal = { ...actor, role };
    expect(await changeOwnPassword(principal, { currentPassword: "correct-current", newPassword: "new-test-password" })).toEqual({ passwordChanged: true, signInRequired: true });
    expect(mock.managerUpdate).toHaveBeenCalledWith({ where: { id: principal.id }, data: { password: "new-test-password", refreshToken: null, credentialVersion: { increment: 1 }, mustChangePassword: false } });
    expect(mock.push).not.toHaveBeenCalled();
    expect(JSON.stringify(mock.audit.mock.calls)).not.toContain("new-test-password"); expect(JSON.stringify(mock.audit.mock.calls)).not.toContain("correct-current");
  });
  it("refuses staff password changes before reading or locking anything", async () => {
    await expect(changeOwnPassword({ ...actor, id: staff.id, role: "STAFF" }, undefined)).rejects.toMatchObject({
      statusCode: 403, message: "Staff sign in with their phone number.", errors: [{ code: "STAFF_PASSWORDS_RETIRED" }],
    });
    expect(mock.transaction).not.toHaveBeenCalled();
    expect(mock.password).not.toHaveBeenCalled();
  });

  it("denies wrong current password or changed tenant/role before any writes", async () => {
    await expect(changeOwnPassword(actor, { currentPassword: "wrong", newPassword: "new-test-password" })).rejects.toMatchObject({ statusCode: 403 });
    mock.managerFind.mockResolvedValue(null);
    await expect(changeOwnPassword(actor, { currentPassword: "correct-current", newPassword: "new-test-password" })).rejects.toMatchObject({ statusCode: 403 });
    expect(mock.managerUpdate).not.toHaveBeenCalled(); expect(mock.tokens).not.toHaveBeenCalled();
  });
  it("rejects same/new weak passwords and unsolicited company or role claims", async () => {
    await expect(changeOwnPassword(actor, { currentPassword: "correct-current", newPassword: "same-password" })).rejects.toMatchObject({ statusCode: 400 });
    for (const input of [{ currentPassword: "correct-current", newPassword: "short" }, { currentPassword: "correct-current", newPassword: "new-test-password", companyId: 99 }])
      await expect(changeOwnPassword(actor, input)).rejects.toMatchObject({ statusCode: 400 });
    expect(mock.managerUpdate).not.toHaveBeenCalled();
  });
});

describe("staff sign-out everywhere", () => {
  const reason = "Phone reported lost";

  it("locks the staff row and revokes sessions and push devices with a trimmed audit reason", async () => {
    expect(await signOutStaffEverywhere(actor, staff.id, { reason: `  ${reason}  ` })).toEqual({ signedOut: true });
    expect(mock.transaction).toHaveBeenCalledOnce();
    expect(mock.raw).toHaveBeenCalledWith(expect.arrayContaining(['SELECT id FROM "Staff" WHERE id=', ' FOR UPDATE']), staff.id);
    expect(mock.raw.mock.invocationCallOrder[0]).toBeLessThan(mock.staffFind.mock.invocationCallOrder[0]!);
    expect(mock.staffFind).toHaveBeenCalledWith({
      where: { id: staff.id, companyId: actor.companyId, role: "STAFF", isActive: true, company: { isActive: true } },
      select: { locationId: true },
    });
    expect(mock.staffUpdate).toHaveBeenCalledWith({
      where: { id: staff.id }, data: { credentialVersion: { increment: 1 }, refreshToken: null },
    });
    expect(mock.push).toHaveBeenCalledWith({
      where: { staffId: staff.id, companyId: actor.companyId }, data: { enabled: false },
    });
    expect(mock.audit).toHaveBeenCalledWith({
      companyId: actor.companyId, actorType: "ADMIN", actorId: actor.id, entityType: "STAFF", entityId: staff.id,
      action: "STAFF_SIGNED_OUT_EVERYWHERE", reason, newValue: { sessionsRevoked: true },
    }, tx);
    expect(mock.location).not.toHaveBeenCalled();
    expect(mock.password).not.toHaveBeenCalled();
  });

  it("allows an assigned manager after checking location access in the transaction", async () => {
    expect(await signOutStaffEverywhere(manager, staff.id, { reason })).toEqual({ signedOut: true });
    expect(mock.location).toHaveBeenCalledWith(manager, staff.locationId, tx);
    expect(mock.location.mock.invocationCallOrder[0]).toBeLessThan(mock.staffUpdate.mock.invocationCallOrder[0]!);
    expect(mock.audit).toHaveBeenCalledWith(expect.objectContaining({ actorType: "MANAGER", actorId: manager.id }), tx);
  });

  it.each([
    new ApiError(403, "Location access denied"),
    new ApiError(404, "Location not found"),
  ])("returns an indistinguishable 404 for manager scope denial: %s", async error => {
    mock.location.mockRejectedValueOnce(error);
    await expect(signOutStaffEverywhere(manager, staff.id, { reason })).rejects.toMatchObject({
      statusCode: 404, message: "Staff account not found",
    });
    expect(mock.staffUpdate).not.toHaveBeenCalled();
    expect(mock.push).not.toHaveBeenCalled();
    expect(mock.audit).not.toHaveBeenCalled();
  });

  it("propagates unexpected authorization failures before writing", async () => {
    const error = new Error("Location lookup failed");
    mock.location.mockRejectedValueOnce(error);
    await expect(signOutStaffEverywhere(manager, staff.id, { reason })).rejects.toBe(error);
    expect(mock.staffUpdate).not.toHaveBeenCalled();
  });

  it("treats staff with no site as out of scope for a manager", async () => {
    mock.staffFind.mockResolvedValueOnce({ ...staff, locationId: null });
    await expect(signOutStaffEverywhere(manager, staff.id, { reason })).rejects.toMatchObject({
      statusCode: 404, message: "Staff account not found",
    });
    expect(mock.location).not.toHaveBeenCalled();
    expect(mock.staffUpdate).not.toHaveBeenCalled();
  });

  it.each([
    ["missing", { ...staff, id: 8 }],
    ["inactive", { ...staff, isActive: false }],
    ["other-company", { ...staff, companyId: 43 }],
  ] as const)("does not revoke sessions for %s staff", async (_label, row) => {
    mock.staffFind.mockImplementationOnce(async ({ where }) => (
      row.id === where.id && row.companyId === where.companyId && row.isActive === where.isActive ? row : null
    ));
    await expect(signOutStaffEverywhere(actor, staff.id, { reason })).rejects.toMatchObject({
      statusCode: 404, message: "Staff account not found",
    });
    expect(mock.staffUpdate).not.toHaveBeenCalled();
  });

  it("rejects a staff actor before any transaction", async () => {
    await expect(signOutStaffEverywhere({ ...actor, role: "STAFF" }, staff.id, { reason })).rejects.toMatchObject({ statusCode: 403 });
    expect(mock.transaction).not.toHaveBeenCalled();
  });

  it.each([
    ["blank reason", { reason: " 	 " }],
    ["missing reason", {}],
    ["long reason", { reason: "x".repeat(1001) }],
    ["unknown key", { reason, companyId: 43 }],
  ] as const)("rejects %s before any transaction", async (_label, body) => {
    await expect(signOutStaffEverywhere(actor, staff.id, body)).rejects.toMatchObject({ statusCode: 400 });
    expect(mock.transaction).not.toHaveBeenCalled();
  });

  it("rejects an invalid staff identifier before any transaction", async () => {
    await expect(signOutStaffEverywhere(actor, 0, { reason })).rejects.toMatchObject({ statusCode: 400 });
    expect(mock.transaction).not.toHaveBeenCalled();
  });
});
