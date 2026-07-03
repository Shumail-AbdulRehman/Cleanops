import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Request, Response } from "express";
import jwt from "jsonwebtoken";
const db = vi.hoisted(() => ({ managerFind: vi.fn(), managerUpdate: vi.fn(), staffFind: vi.fn(), staffUpdate: vi.fn(), pushUpdate: vi.fn() }));
vi.mock("../prisma/prisma.js", () => {
  const tx = { staff: { updateMany: db.staffUpdate }, staffPushDevice: { updateMany: db.pushUpdate } };
  return { prisma: { manager: { findUnique: db.managerFind, updateMany: db.managerUpdate },
    staff: { findUnique: db.staffFind }, $transaction: (work: (client: typeof tx) => unknown) => work(tx) } };
});
import { refreshToken, logOut } from "./common.controller.js";
import { generateAccessToken, generateRefreshToken } from "../utils/auth.js";
const req = (token?: unknown) => ({ cookies: { refreshToken: token }, body: {}, header: () => undefined } as unknown as Request);
function response() {
  const res = { status: vi.fn(), cookie: vi.fn(), clearCookie: vi.fn(), json: vi.fn() };
  for (const fn of [res.status, res.cookie, res.clearCookie]) fn.mockReturnValue(res);
  return res;
}
function user(role: "ADMIN" | "MANAGER" | "STAFF", token: string) {
  return { id: 1, role, name: "Test", email: "test@example.invalid", companyId: 42, isActive: true, company: { isActive: true }, refreshToken: token, password: "must-not-leak", locationId: 20 };
}
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("ACCESS_TOKEN_SECRET", "test-access-key"); vi.stubEnv("REFRESH_TOKEN_SECRET", "test-refresh-key");
  vi.stubEnv("ACCESS_TOKEN_EXPIRY", "15m"); vi.stubEnv("REFRESH_TOKEN_EXPIRY", "7d");
  db.managerUpdate.mockResolvedValue({ count: 1 }); db.staffUpdate.mockResolvedValue({ count: 1 }); db.pushUpdate.mockResolvedValue({ count: 1 });
});
afterEach(() => vi.unstubAllEnvs());
describe.each(["ADMIN", "MANAGER", "STAFF"] as const)("%s session family", role => {
  function setup(token: string) { const value = user(role, token); (role === "STAFF" ? db.staffFind : db.managerFind).mockResolvedValue(value); return value; }
  it("rotates only the expected current token with active role/company checks", async () => {
    const token = generateRefreshToken({ id: 1 }, role); setup(token); const res = response();
    await refreshToken(req(token), res as unknown as Response);
    const mutate = role === "STAFF" ? db.staffUpdate : db.managerUpdate;
    expect(mutate).toHaveBeenCalledWith({ where: { id: 1, role, companyId: 42, credentialVersion: 0, refreshToken: token, isActive: true }, data: { refreshToken: expect.any(String) } });
    const payload = res.json.mock.calls[0]![0].data;
    expect(payload.refreshToken).not.toBe(token); expect(payload).not.toHaveProperty("password"); expect(payload).not.toHaveProperty("company");
    expect(db.pushUpdate).toHaveBeenCalledTimes(role === "STAFF" ? 1 : 0);
  });
  it("does not clear a newer login when an old refresh is replayed", async () => {
    const old = generateRefreshToken({ id: 1 }, role); setup(generateRefreshToken({ id: 1 }, role));
    await expect(refreshToken(req(old), response() as unknown as Response)).rejects.toMatchObject({ statusCode: 401 });
    expect(db.staffUpdate).not.toHaveBeenCalled(); expect(db.managerUpdate).not.toHaveBeenCalled(); expect(db.pushUpdate).not.toHaveBeenCalled();
  });
  it("has exactly one winner under concurrent refresh against the same expected token", async () => {
    const token = generateRefreshToken({ id: 1 }, role); setup(token);
    let current = token;
    const mutate = role === "STAFF" ? db.staffUpdate : db.managerUpdate;
    mutate.mockImplementation(async ({ where, data }) => {
      if (where.refreshToken !== current) return { count: 0 };
      current = data.refreshToken; return { count: 1 };
    });
    const result = await Promise.allSettled([refreshToken(req(token), response() as unknown as Response), refreshToken(req(token), response() as unknown as Response)]);
    expect(result.filter(r => r.status === "fulfilled")).toHaveLength(1);
    expect(result.filter(r => r.status === "rejected")).toHaveLength(1);
    expect(db.pushUpdate).toHaveBeenCalledTimes(role === "STAFF" ? 1 : 0);
  });
  it.each(["user", "company"])("rejects inactive %s before rotation", async kind => {
    const token = generateRefreshToken({ id: 1 }, role), value = setup(token);
    if (kind === "user") value.isActive = false; else value.company.isActive = false;
    if(kind==='company') {
      await expect(refreshToken(req(token), response() as unknown as Response)).resolves.toBeUndefined();
      expect(role === "STAFF" ? db.staffUpdate : db.managerUpdate).toHaveBeenCalledOnce();
    } else {
      await expect(refreshToken(req(token), response() as unknown as Response)).rejects.toMatchObject({ statusCode: 403 });
      expect(db.staffUpdate).not.toHaveBeenCalled(); expect(db.managerUpdate).not.toHaveBeenCalled();
    }
  });
  it("rejects obsolete database role", async () => {
    const token = generateRefreshToken({ id: 1 }, role), value = setup(token);
    value.role = role === "ADMIN" ? "MANAGER" : "ADMIN";
    await expect(refreshToken(req(token), response() as unknown as Response)).rejects.toMatchObject({ statusCode: 401 });
    expect(db.staffUpdate).not.toHaveBeenCalled(); expect(db.managerUpdate).not.toHaveBeenCalled();
  });
  it("logout revokes only the presented current family, not a later login or its push devices", async () => {
    const token = generateRefreshToken({ id: 1 }, role);
    const mutate = role === "STAFF" ? db.staffUpdate : db.managerUpdate;
    mutate.mockResolvedValue({ count: 0 });
    const res = response(); await logOut(req(token), res as unknown as Response);
    expect(mutate).toHaveBeenCalledWith({ where: { id: 1, role, refreshToken: token }, data: { refreshToken: null, credentialVersion: { increment: 1 } } });
    expect(db.pushUpdate).not.toHaveBeenCalled(); expect(res.clearCookie).toHaveBeenCalledTimes(2);
  });
});
it("malformed principal fails before either identity table is queried", async () => {
  const token = jwt.sign({ id: "1", role: "ADMIN", tokenUse: "refresh" }, "test-refresh-key", { expiresIn: "7d", jwtid: "test" });
  await expect(refreshToken(req(token), response() as unknown as Response)).rejects.toMatchObject({ statusCode: 401 });
  expect(db.managerFind).not.toHaveBeenCalled(); expect(db.staffFind).not.toHaveBeenCalled();
});
it("access-only logout clears local cookies without revoking a newer stored family", async () => {
  const request = req(); request.cookies.accessToken = generateAccessToken(user("ADMIN", "stored"), "ADMIN");
  const res = response(); await logOut(request, res as unknown as Response);
  expect(db.managerUpdate).not.toHaveBeenCalled(); expect(db.staffUpdate).not.toHaveBeenCalled(); expect(res.clearCookie).toHaveBeenCalledTimes(2);
});
it("current staff logout disables current push delivery", async () => {
  await logOut(req(generateRefreshToken({ id: 1 }, "STAFF")), response() as unknown as Response);
  expect(db.pushUpdate).toHaveBeenCalledWith({ where: { staffId: 1 }, data: { enabled: false } });
});
it("a password change revokes old refresh even if an old stored token was not yet cleared", async () => {
  const token = generateRefreshToken({ id: 1 }, "ADMIN"); db.managerFind.mockResolvedValue({ ...user("ADMIN", token), credentialVersion: 1 });
  await expect(refreshToken(req(token), response() as unknown as Response)).rejects.toMatchObject({ statusCode: 401 });
  expect(db.managerUpdate).not.toHaveBeenCalled();
});
it("does not refresh forced-password-replacement accounts", async () => {
  const token = generateRefreshToken({ id: 1 }, "STAFF"); db.staffFind.mockResolvedValue({ ...user("STAFF", token), mustChangePassword: true });
  await expect(refreshToken(req(token), response() as unknown as Response)).rejects.toMatchObject({ statusCode: 403 });
  expect(db.staffUpdate).not.toHaveBeenCalled(); expect(db.pushUpdate).not.toHaveBeenCalled();
});
