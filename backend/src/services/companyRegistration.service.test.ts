import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import type { Request, Response } from "express";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
const mock = vi.hoisted(() => ({ transaction: vi.fn(), company: vi.fn(), owner: vi.fn(), managerEmail: vi.fn(), staffEmail: vi.fn(), session: vi.fn(), access: vi.fn(), refresh: vi.fn(), audit: vi.fn(), log: vi.fn() }));
vi.mock("../prisma/prisma.js", () => ({ prisma: { $transaction: mock.transaction, manager: { updateMany: mock.session } } }));
vi.mock("../utils/auth.js", () => ({ generateAccessToken: mock.access, generateRefreshToken: mock.refresh }));
vi.mock("../utils/operationalLog.js", () => ({ operationalLog: mock.log }));
// Keep the production public signup route and handler; isolate unrelated routes.
vi.mock("../controllers/manager.controller.js", async () => ({
  signupManager: (await import("../controllers/companyRegistration.controller.js")).signupCompany,
  loginManager: vi.fn(), getManagerProfile: vi.fn(), getTodayStatus: vi.fn(),
  createManager: vi.fn(), getManagers: vi.fn(), updateManager: vi.fn(), deleteManager: vi.fn(),
}));
vi.mock("../controllers/managerOperations.controller.js", () => ({
  operationsRead: () => vi.fn(), readDashboardTrends: vi.fn(), readCompanyPerformance: vi.fn(),
}));
import { companyRegistrationSchema, registerCompany } from "./companyRegistration.service.js";
import { signupCompany } from "../controllers/companyRegistration.controller.js";
import managerRouter from "../routes/manager.route.js";
import { ApiError } from "../utils/ApiError.js";
const input = () => ({ companyName: "Test cleaning", name: "Test owner", email: "owner@example.invalid", password: "test-password" });
const owner = { id: 2, name: "Test owner", email: "owner@example.invalid", role: "ADMIN", companyId: 3 };
beforeEach(() => {
  vi.resetAllMocks(); mock.company.mockResolvedValue({ id: 3 }); mock.owner.mockResolvedValue(owner);
  mock.managerEmail.mockResolvedValue(null); mock.staffEmail.mockResolvedValue(null);
  mock.transaction.mockImplementation(async work => work({ company: { create: mock.company }, manager: { create: mock.owner, findFirst: mock.managerEmail }, staff: { findFirst: mock.staffEmail }, auditLog: { create: mock.audit } }));
  mock.session.mockResolvedValue({ count: 1 }); mock.access.mockReturnValue("test-access"); mock.refresh.mockReturnValue("test-refresh");
});
function response() { const res = { status: vi.fn(), cookie: vi.fn(), json: vi.fn() }; res.status.mockReturnValue(res); res.cookie.mockReturnValue(res); return res; }
describe("company registration", () => {
  it("creates company and first ADMIN inside one transaction and returns only a safe owner DTO", async () => {
    const result = await registerCompany(input());
    expect(mock.transaction).toHaveBeenCalledTimes(1);
    expect(mock.company).toHaveBeenCalledWith({ data: { name: "Test cleaning" }, select: { id: true } });
    expect(mock.owner).toHaveBeenCalledWith({ data: { name: "Test owner", email: "owner@example.invalid", password: "test-password", companyId: 3, role: "ADMIN" }, select: { id: true, name: true, email: true, role: true, companyId: true } });
    expect(mock.audit).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ action: "OWNER_EMAIL_ENROLLMENT_ALLOWED", actorId: owner.id, newValue: { emailHash: expect.stringMatching(/^[a-f0-9]{64}$/), source: "REGISTRATION" } }) }));
    expect(result).toEqual(owner); expect(result).not.toHaveProperty("password");
  });
  it("does not publish a signup/session when enrollment audit fails inside its transaction", async () => {
    mock.audit.mockRejectedValueOnce(new Error("synthetic enrollment audit failure"));
    await expect(registerCompany(input())).rejects.toThrow("synthetic enrollment audit failure");
    expect(mock.session).not.toHaveBeenCalled();
  });
  it("rolls back a newly created company if owner insert fails", async () => {
    const persisted: object[] = [];
    mock.transaction.mockImplementation(async work => {
      const pending: object[] = [];
      const tx = { company: { create: async () => { pending.push({ id: 3 }); return { id: 3 }; } }, manager: { findFirst: mock.managerEmail, create: async () => { throw new Error("owner insert failed"); } }, staff: { findFirst: mock.staffEmail } };
      const result = await work(tx); persisted.push(...pending); return result;
    });
    await expect(registerCompany(input())).rejects.toThrow("owner insert failed"); expect(persisted).toEqual([]); expect(mock.session).not.toHaveBeenCalled();
  });
  it("maps the uniqueness error raised inside a concurrent transaction without exposing internal fields", async () => {
    mock.owner.mockRejectedValue(Object.assign(new Error("constraint internal password detail"), { code: "P2002" }));
    await expect(registerCompany(input())).rejects.toMatchObject({ statusCode: 409, message: "An account with these details already exists. Sign in or recover your account.", errors: [{ code: "EMAIL_EXISTS", field: "email", message: "This email already has an account" }] });
    expect(mock.audit).not.toHaveBeenCalled();
  });
  it.each(["role", "companyId", "plan", "isActive", "operator"])("rejects public %s claims before DB writes", async key => {
    await expect(registerCompany({ ...input(), [key]: "ADMIN" })).rejects.toMatchObject({ statusCode: 400 }); expect(mock.transaction).not.toHaveBeenCalled();
  });
  it("rejects a blank organization", () => {
    expect(companyRegistrationSchema.safeParse({ ...input(), companyName: "  " }).success).toBe(false);
    expect(mock.transaction).not.toHaveBeenCalled();
  });
  it.each([
    ["seven characters", "abcdefg", "Password must be at least 8 characters"],
    ["73 ASCII bytes", "a".repeat(73), "Password must be at most 72 UTF-8 bytes"],
    ["73 UTF-8 bytes", "آ".repeat(36) + "a", "Password must be at most 72 UTF-8 bytes"],
    ["80 UTF-8 bytes", "آ".repeat(40), "Password must be at most 72 UTF-8 bytes"],
  ])("rejects %s before database access", async (_label, password, message) => {
    await expect(registerCompany({ ...input(), password })).rejects.toMatchObject({
      statusCode: 400, errors: [{ field: "password", message }],
    });
    expect(mock.transaction).not.toHaveBeenCalled();
  });
  it.each(["abcdefgh", "a".repeat(72), "آ".repeat(36), "  abcdef  "])("accepts valid password boundaries without trimming or hashing the password", async password => {
    await registerCompany({ ...input(), password });
    expect(mock.owner).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ password }) }));
  });
  it("trims names and normalizes email before checking or saving it", async () => {
    await registerCompany({ ...input(), name: "  Test owner  ", email: "  OWNER@Example.invalid  ", companyName: "  Test cleaning  " });
    const query = { where: { email: { equals: "owner@example.invalid", mode: "insensitive" } }, select: { id: true } };
    expect(mock.managerEmail).toHaveBeenCalledWith(query);
    expect(mock.staffEmail).toHaveBeenCalledWith(query);
    expect(mock.owner.mock.calls[0]![0].data).toMatchObject({ name: "Test owner", email: "owner@example.invalid" });
    expect(mock.company.mock.calls[0]![0].data.name).toBe("Test cleaning");
    expect(mock.managerEmail.mock.invocationCallOrder[0]).toBeLessThan(mock.company.mock.invocationCallOrder[0]!);
    expect(mock.staffEmail.mock.invocationCallOrder[0]).toBeLessThan(mock.company.mock.invocationCallOrder[0]!);
  });
  it.each(["manager", "staff"] as const)("rejects an existing %s email without creating company, owner, audit or session", async table => {
    const lookup = table === "manager" ? mock.managerEmail : mock.staffEmail;
    lookup.mockResolvedValueOnce({ id: 91 });
    const res = response();
    await expect(signupCompany({ body: { ...input(), email: "  OWNER@Example.invalid  " } } as Request, res as unknown as Response)).rejects.toMatchObject({
      statusCode: 409, errors: [{ code: "EMAIL_EXISTS", field: "email", message: "This email already has an account" }],
    });
    expect(lookup).toHaveBeenCalledWith({ where: { email: { equals: "owner@example.invalid", mode: "insensitive" } }, select: { id: true } });
    expect(mock.company).not.toHaveBeenCalled(); expect(mock.owner).not.toHaveBeenCalled();
    expect(mock.audit).not.toHaveBeenCalled(); expect(mock.session).not.toHaveBeenCalled();
    expect(res.cookie).not.toHaveBeenCalled();
  });
  it("maps a transaction-level unique-index race to the same duplicate email response", async () => {
    mock.transaction.mockRejectedValueOnce(Object.assign(new Error("private index detail"), { code: "P2002" }));
    await expect(registerCompany(input())).rejects.toMatchObject({ statusCode: 409, errors: [{ code: "EMAIL_EXISTS", field: "email" }] });
  });
  it("propagates lookup failures without treating them as duplicate emails or writing records", async () => {
    const error = new Error("synthetic unavailable lookup"); mock.staffEmail.mockRejectedValueOnce(error);
    await expect(registerCompany(input())).rejects.toBe(error);
    expect(mock.company).not.toHaveBeenCalled(); expect(mock.owner).not.toHaveBeenCalled();
  });
  it("returns messages for every invalid field without including submitted values", async () => {
    await expect(registerCompany({ companyName: " ", name: " ", email: "bad-email", password: "short" })).rejects.toMatchObject({
      statusCode: 400, errors: expect.arrayContaining([
        { field: "companyName", message: expect.any(String) },
        { field: "name", message: expect.any(String) },
        { field: "email", message: "Invalid email format" },
        { field: "password", message: "Password must be at least 8 characters" },
      ]),
    });
    expect(mock.transaction).not.toHaveBeenCalled();
  });
  it("sets session cookies only after the account transaction commits", async () => {
    const res = response(); await signupCompany({ body: input() } as Request, res as unknown as Response);
    expect(mock.transaction.mock.invocationCallOrder[0]).toBeLessThan(mock.session.mock.invocationCallOrder[0]!);
    expect(res.cookie).toHaveBeenCalledWith("accessToken", "test-access", expect.objectContaining({ httpOnly: true }));
    expect(res.json.mock.calls[0]![0].data).toEqual({ ...owner, sessionEstablished: true });
  });
  it.each(["access", "refresh", "session"] as const)("reports durable account creation explicitly if %s issuing fails", async stage => {
    mock[stage].mockImplementation(() => { throw new Error("session problem must not leak"); });
    const res = response(); await signupCompany({ body: input() } as Request, res as unknown as Response);
    expect(res.status).toHaveBeenCalledWith(201); expect(res.cookie).not.toHaveBeenCalled();
    expect(res.json.mock.calls[0]![0].data).toEqual({ ...owner, sessionEstablished: false });
    expect(res.json.mock.calls[0]![0].message).toBe("Account created. Sign in to continue.");
  });
  it("does not overwrite an intervening sign-in when establishing the signup session", async () => {
    mock.session.mockResolvedValue({ count: 0 }); const res = response();
    await signupCompany({ body: input() } as Request, res as unknown as Response);
    expect(mock.session).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 2, companyId: 3, role: "ADMIN", credentialVersion: 0, isActive: true, refreshToken: null, company: { isActive: true } } }));
    expect(res.cookie).not.toHaveBeenCalled(); expect(res.json.mock.calls[0]![0].data.sessionEstablished).toBe(false);
  });
  it("rate limits the public signup route before validation or database access", async () => {
    const app = express();
    app.use(express.json());
    app.use("/api/manager", managerRouter);
    app.use(((error, _req, res, _next) => {
      if (!(error instanceof ApiError)) throw error;
      res.status(error.statusCode).json({ errors: error.errors });
    }) as express.ErrorRequestHandler);
    const server = app.listen(0, "127.0.0.1");
    try {
      await once(server, "listening");
      const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/manager/manager-signup`;
      const request = (body: unknown) => fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      for (let attempt = 0; attempt < 10; attempt++) {
        const allowed = await request({});
        expect(allowed.status).toBe(400);
        await allowed.json();
      }
      const blocked = await request(input());
      expect(blocked.status).toBe(429);
      expect(Number(blocked.headers.get("Retry-After"))).toBeGreaterThan(0);
      expect(await blocked.json()).toEqual({ success: false, code: "AUTH_RATE_LIMITED", message: "Too many attempts. Try again later." });
      expect(mock.transaction).not.toHaveBeenCalled();
      expect(mock.session).not.toHaveBeenCalled();
      expect(mock.log).toHaveBeenCalledWith({ event: "AUTH_RATE_LIMITED", status: 429 }, { level: "warn" });
    } finally {
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    }
  });
});
