import { once } from "node:events";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import express, { type RequestHandler } from "express";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { launchErrorHandler } from "../routes/launch.route.js";
import staffRouter from "../routes/staff.route.js";
import { ApiError } from "../utils/ApiError.js";
import { WEEKDAYS } from "../utils/workDays.js";

const { tx, db, insertStaff, lockStaffIdentities, withAccountCapacity, requireLocationAccess, syncShift } = vi.hoisted(() => ({
  tx: {
    $queryRaw: vi.fn(),
    staff: { findUnique: vi.fn(), findFirst: vi.fn(), update: vi.fn() },
    staffPushDevice: { updateMany: vi.fn() },
    taskTemplate: { findMany: vi.fn() },
  },
  db: {
    $transaction: vi.fn(),
    staff: { findMany: vi.fn(), findUnique: vi.fn() },
    location: { findUnique: vi.fn() },
    taskTemplate: { findMany: vi.fn(), count: vi.fn() },
    taskInstance: { findMany: vi.fn(), groupBy: vi.fn(), count: vi.fn() },
    attendance: { findMany: vi.fn(), groupBy: vi.fn(), count: vi.fn() },
  },
  insertStaff: vi.fn(),
  lockStaffIdentities: vi.fn(),
  withAccountCapacity: vi.fn(),
  requireLocationAccess: vi.fn(),
  syncShift: vi.fn(),
}));

vi.mock("../prisma/prisma.js", () => ({ prisma: db }));
vi.mock("../services/staffProvisioning.service.js", async (importOriginal) => ({
  ...await importOriginal<typeof import("../services/staffProvisioning.service.js")>(),
  insertStaff,
  lockStaffIdentities,
}));
vi.mock("../services/accountAccess.service.js", async (importOriginal) => ({
  ...await importOriginal<typeof import("../services/accountAccess.service.js")>(),
  withAccountCapacity,
}));
vi.mock("../services/verification-v2/authorization.service.js", async (importOriginal) => ({
  ...await importOriginal<typeof import("../services/verification-v2/authorization.service.js")>(),
  requireLocationAccess,
}));
vi.mock("../utils/syncAttendanceWindow.js", () => ({ syncTodaysOpenAttendanceWindow: syncShift }));
vi.mock("../services/verification-v2/reviewClosure.service.js", () => ({
  staffPerformanceReports: async () => [],
}));
vi.mock("../middlewares/accountAccess.middleware.js", () => ({
  accountAccess: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));
vi.mock("../middlewares/auth.middleware.js", async (importOriginal) => ({
  ...await importOriginal<typeof import("../middlewares/auth.middleware.js")>(),
  verifyJwt: ((req, _res, next) => {
    req.user = {
      id: 10,
      name: "Test Actor",
      email: null,
      role: req.get("X-Test-Role") === "MANAGER" ? "MANAGER" : "ADMIN",
      companyId: 42,
      locationIds: [9],
    };
    next();
  }) satisfies RequestHandler,
}));

const createPath = "/api/staff/create-staff";
const editPath = "/api/staff/7";
const staff = {
  id: 7,
  companyId: 42,
  name: "Test Staff",
  phone: "+923011234567",
  email: "staff@example.test",
  locationId: 9,
  shiftStart: new Date("2026-11-20T03:00:00Z"),
  shiftEnd: new Date("2026-11-20T11:00:00Z"),
  location: { timezone: "Asia/Karachi" },
  isActive: true,
};

const app = express();
app.use(express.json());
app.use("/api/staff", staffRouter);
app.use(launchErrorHandler);
const server = createServer(app);
let origin: string;

beforeAll(async () => {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
});

async function call(method: "GET" | "POST" | "PATCH", path: string, body?: object, role = "ADMIN") {
  const response = await fetch(origin + path, {
    method,
    headers: { "Content-Type": "application/json", "X-Test-Role": role },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
}

beforeEach(() => {
  vi.resetAllMocks();
  db.$transaction.mockImplementation((run) => run(tx));
  withAccountCapacity.mockImplementation((_actor, _resource, run) => run(tx));
  requireLocationAccess.mockResolvedValue({ isActive: true });
  insertStaff.mockResolvedValue({ id: staff.id, name: staff.name, phone: "+923001234567", email: null, password: "generated fixture password" });
  tx.staff.findUnique.mockImplementation(({ where }) => where.id === staff.id && where.companyId === staff.companyId ? staff : null);
  tx.staff.update.mockImplementation(({ data, select }) => {
    const updated = { ...staff, ...data };
    return Object.fromEntries(Object.keys(select).map((key) => [key, updated[key as keyof typeof staff]]));
  });
  tx.taskTemplate.findMany.mockResolvedValue([]);
});

describe("create staff", () => {
  it("passes the normalized phone and optional email to provisioning and ignores a submitted password", async () => {
    const response = await call("POST", createPath, { name: staff.name, phone: "0300-1234567", password: "ignored" });
    expect(response.status).toBe(201);
    expect(insertStaff.mock.calls[0]).toStrictEqual([tx, 42, { name: staff.name, phone: "+923001234567" }]);
    expect(withAccountCapacity).toHaveBeenCalledWith(expect.objectContaining({ companyId: 42 }), "staff", expect.any(Function));
    expect(response.body.data).toEqual({ id: 7, name: staff.name, phone: "+923001234567", email: null, workDays: WEEKDAYS });
  });

  it("keeps field validation for malformed fields other than phone", async () => {
    const response = await call("POST", createPath, { name: "", phone: staff.phone });
    expect(response).toMatchObject({ status: 400, body: { message: "Validation failed", errors: [{ field: "name" }] } });
    expect(insertStaff).not.toHaveBeenCalled();
  });

  it.each([
    ["PHONE_IN_USE", "This phone number is already used by another staff member."],
    ["EMAIL_IN_USE", "This email is already used by another staff member."],
  ])("returns provisioning error %s to the caller", async (code, message) => {
    insertStaff.mockRejectedValue(new ApiError(409, message, [{ code }]));
    const response = await call("POST", createPath, { name: staff.name, phone: staff.phone });
    expect(response).toMatchObject({ status: 409, body: { success: false, message, code, errors: [{ code }] } });
  });

  it("requires a manager to choose an assigned site", async () => {
    const response = await call("POST", createPath, { name: staff.name, phone: staff.phone }, "MANAGER");
    expect(response).toMatchObject({ status: 403, body: { message: "Choose an assigned site when creating staff" } });
    expect(withAccountCapacity).not.toHaveBeenCalled();
  });

  it("rejects an inactive site before provisioning", async () => {
    requireLocationAccess.mockResolvedValue({ isActive: false });
    const response = await call("POST", createPath, { name: staff.name, phone: staff.phone, locationId: 9 }, "MANAGER");
    expect(response).toMatchObject({ status: 403, body: { message: "Location is inactive" } });
    expect(requireLocationAccess).toHaveBeenCalledWith(expect.objectContaining({ role: "MANAGER" }), 9, tx);
    expect(insertStaff).not.toHaveBeenCalled();
  });
});

it.each([
  ["POST", createPath, { name: staff.name, phone: staff.phone, workDays: [] }],
  ["PATCH", editPath, { workDays: ["WED", "FRIDAY"] }],
] as const)("%s %s returns INVALID_WORK_DAYS with a field error", async (method, path, body) => {
  const message = "Choose at least one work day.";
  expect(await call(method, path, body)).toMatchObject({
    status: 400,
    body: { success: false, code: "INVALID_WORK_DAYS", message, errors: [{ field: "workDays", message, code: "INVALID_WORK_DAYS" }] },
  });
  expect(withAccountCapacity).not.toHaveBeenCalled();
  expect(db.$transaction).not.toHaveBeenCalled();
});

describe("read staff work days", () => {
  it.each(["/api/staff", "/api/staff/location/9"])("returns canonical work days from %s", async (path) => {
    db.staff.findMany.mockResolvedValue([{ ...staff, workDays: ["WED", "MON", "WED"] }]);
    db.location.findUnique.mockResolvedValue({ id: 9, companyId: 42 });
    expect(await call("GET", path)).toMatchObject({
      status: 200, body: { data: [{ id: staff.id, workDays: ["MON", "WED"] }] },
    });
    expect(db.staff.findMany).toHaveBeenCalledWith(expect.objectContaining({
      select: expect.objectContaining({ workDays: true }),
    }));
  });

  it("returns all seven days for a legacy staff read without work days", async () => {
    db.staff.findUnique.mockResolvedValue(staff);
    expect(await call("GET", editPath)).toMatchObject({
      status: 200, body: { data: { id: staff.id, workDays: WEEKDAYS } },
    });
    expect(db.staff.findUnique).toHaveBeenCalledWith(expect.objectContaining({
      select: expect.objectContaining({ workDays: true }),
    }));
  });

  it("returns canonical staff and schedule days in staff details", async () => {
    db.staff.findUnique.mockResolvedValue({ ...staff, workDays: ["WED", "MON"] });
    db.taskTemplate.findMany.mockResolvedValue([
      { id: 1, recurringType: "DAILY", repeatDays: ["WED", "MON"] },
      { id: 2, recurringType: "ONCE", repeatDays: [] },
    ]);
    db.taskInstance.findMany.mockResolvedValue([]);
    db.taskInstance.groupBy.mockResolvedValue([]);
    db.attendance.findMany.mockResolvedValue([]);
    db.attendance.groupBy.mockResolvedValue([]);
    expect(await call("GET", "/api/staff/details/7")).toMatchObject({
      status: 200,
      body: { data: {
        workDays: ["MON", "WED"],
        taskTemplates: [{ repeatDays: ["MON", "WED"] }, { repeatDays: WEEKDAYS }],
      } },
    });
    expect(db.staff.findUnique).toHaveBeenCalledWith(expect.objectContaining({
      select: expect.objectContaining({ workDays: true }),
    }));
    expect(db.taskTemplate.findMany).toHaveBeenCalledWith(expect.objectContaining({
      select: expect.objectContaining({ repeatDays: true }),
    }));
  });
});

it.each([
  ["POST", createPath, { name: staff.name, phone: "invalid" }],
  ["POST", createPath, { name: staff.name }],
  ["PATCH", editPath, { phone: null }],
] as const)("%s %s returns INVALID_PHONE with a field error", async (method, path, body) => {
  const message = "Enter a Pakistan mobile number, like 03001234567.";
  const response = await call(method, path, body);
  expect(response).toMatchObject({
    status: 400,
    body: { success: false, code: "INVALID_PHONE", message, errors: [{ field: "phone", message, code: "INVALID_PHONE" }] },
  });
  expect(withAccountCapacity).not.toHaveBeenCalled();
  expect(db.$transaction).not.toHaveBeenCalled();
});

describe("edit staff", () => {
  it("locks the new phone and revokes sessions and push in the same transaction", async () => {
    const response = await call("PATCH", editPath, { phone: "0300-1234567" });
    expect(response).toMatchObject({ status: 200, body: { data: { phone: "+923001234567", email: staff.email } } });
    expect(db.$transaction).toHaveBeenCalledTimes(1);
    expect(tx.$queryRaw.mock.calls[0]?.[0].join("")).toContain("FOR UPDATE");
    expect(lockStaffIdentities).toHaveBeenCalledWith(tx, [{ phone: "+923001234567", email: undefined }]);
    expect(lockStaffIdentities.mock.invocationCallOrder[0]).toBeLessThan(tx.staff.findUnique.mock.invocationCallOrder[1]!);
    expect(tx.staff.findUnique).toHaveBeenCalledWith({ where: { phone: "+923001234567" }, select: { id: true } });
    expect(tx.staff.update.mock.calls[0]?.[0].data).toStrictEqual({
      phone: "+923001234567", credentialVersion: { increment: 1 }, refreshToken: null,
    });
    expect(tx.staffPushDevice.updateMany).toHaveBeenCalledWith({
      where: { staffId: 7, companyId: 42 },
      data: { enabled: false },
    });
    expect(response.body.data).not.toHaveProperty("refreshToken");
  });

  it("rejects a phone belonging to another staff member before writing", async () => {
    tx.staff.findUnique.mockResolvedValueOnce(staff).mockResolvedValueOnce({ id: 8 });
    const response = await call("PATCH", editPath, { phone: "0300-1234567" });
    expect(response).toMatchObject({
      status: 409,
      body: { code: "PHONE_IN_USE", message: "This phone number is already used by another staff member." },
    });
    expect(tx.staff.update).not.toHaveBeenCalled();
    expect(tx.staffPushDevice.updateMany).not.toHaveBeenCalled();
  });

  it("rejects a case-insensitive email duplicate, including when the current staff row has no phone", async () => {
    tx.staff.findUnique.mockResolvedValueOnce({ ...staff, phone: null });
    tx.staff.findFirst.mockResolvedValueOnce({ id: 8 });
    const response = await call("PATCH", editPath, { email: "Other@Example.test" });
    expect(response).toMatchObject({
      status: 409,
      body: { code: "EMAIL_IN_USE", message: "This email is already used by another staff member." },
    });
    expect(tx.$queryRaw.mock.calls[1]?.[0].join("")).toContain("hashtextextended(lower(), 1542)");
    expect(tx.staff.findFirst).toHaveBeenCalledWith({
      where: { id: { not: 7 }, email: { equals: "Other@Example.test", mode: "insensitive" } },
      select: { id: true },
    });
    expect(tx.staff.update).not.toHaveBeenCalled();
  });

  it.each([null, ""])("clears email with %j without signing out", async (email) => {
    const response = await call("PATCH", editPath, { email });
    expect(response).toMatchObject({ status: 200, body: { data: { email: null } } });
    expect(tx.staff.update.mock.calls[0]?.[0].data).toStrictEqual({ email: null });
    expect(tx.staffPushDevice.updateMany).not.toHaveBeenCalled();
  });

  it("can change email and submit the equivalent phone without signing out", async () => {
    const response = await call("PATCH", editPath, { email: "STAFF@example.test", phone: "0301 1234567" });
    expect(response).toMatchObject({ status: 200, body: { data: { email: "STAFF@example.test", phone: staff.phone } } });
    expect(tx.staff.update.mock.calls[0]?.[0].data).toStrictEqual({ email: "STAFF@example.test", phone: staff.phone });
    expect(lockStaffIdentities).not.toHaveBeenCalled();
    expect(tx.staffPushDevice.updateMany).not.toHaveBeenCalled();
  });

  it("keeps the existing template conflict check when editing one side of the shift", async () => {
    tx.taskTemplate.findMany.mockResolvedValueOnce([{
      title: "Morning round",
      location: staff.location,
      shiftStart: new Date("2026-11-20T03:00:00Z"),
      shiftEnd: new Date("2026-11-20T05:00:00Z"),
    }]);
    const response = await call("PATCH", editPath, { shiftStart: "2026-11-20T04:00:00Z" });
    expect(response).toMatchObject({
      status: 400,
      body: { message: 'Cannot update shift: "Morning round" task template(s) fall outside the new shift window. Remove or reassign them first.' },
    });
    expect(tx.staff.update).not.toHaveBeenCalled();
    expect(syncShift).not.toHaveBeenCalled();
  });

  it("keeps shift validation and syncs today's attendance after a valid update", async () => {
    const shiftStart = "2026-11-20T04:00:00Z";
    const invalid = await call("PATCH", editPath, { shiftStart, shiftEnd: shiftStart });
    expect(invalid).toMatchObject({
      status: 400,
      body: { message: "Validation failed", errors: [{ field: "shiftEnd", message: "Shift start and end cannot be the same time" }] },
    });
    const valid = await call("PATCH", editPath, { shiftStart });
    expect(valid.status).toBe(200);
    expect(syncShift).toHaveBeenCalledWith({ staffId: 7, locationId: 9, shiftStart: new Date(shiftStart), shiftEnd: staff.shiftEnd });
  });
});

it("returns APP_UPDATE_REQUIRED from the legacy route even without a request body", async () => {
  const response = await call("POST", "/api/staff/staff-login");
  expect(response).toMatchObject({
    status: 410,
    body: {
      success: false,
      code: "APP_UPDATE_REQUIRED",
      message: "Update the Hygene Ops app to sign in with your phone number.",
    },
  });
  expect(db.$transaction).not.toHaveBeenCalled();
});
