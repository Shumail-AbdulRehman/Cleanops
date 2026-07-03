import { beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";
import type { Request, Response } from "express";

const db = vi.hoisted(() => ({
  transaction: vi.fn(), rootLocation: vi.fn(), rootStaff: vi.fn(), rootTemplates: vi.fn(), rootTemplate: vi.fn(),
  tx: {
    $queryRaw: vi.fn(),
    location: { findUnique: vi.fn() },
    staff: { findMany: vi.fn() },
    taskTemplate: { findMany: vi.fn(), create: vi.fn(), findUniqueOrThrow: vi.fn() },
    verificationException: { updateMany: vi.fn() },
  },
  validate: vi.fn(), configure: vi.fn(), today: vi.fn(), access: vi.fn(), audit: vi.fn(),
}));

vi.mock("../prisma/prisma.js", () => ({ prisma: {
  $transaction: db.transaction,
  location: { findUnique: db.rootLocation },
  staff: { findMany: db.rootStaff },
  taskTemplate: { findMany: db.rootTemplates, findUnique: db.rootTemplate },
} }));
vi.mock("../services/verification-v2/inventorySnapshot.service.js", () => ({
  validateInventorySelection: db.validate, configureTemplateInventory: db.configure, createTodaysTaskForNewTemplate: db.today,
}));
vi.mock("../services/verification-v2/authorization.service.js", () => ({ requireLocationAccess: db.access }));
vi.mock("../services/auditLog.service.js", () => ({ writeAuditLog: db.audit }));
vi.mock("../services/deletion.service.js", () => ({ permanentlyDelete: vi.fn() }));
vi.mock("../services/subscription.service.js", () => ({ companyHasFeature: vi.fn() }));
vi.mock("../utils/cloudinary.js", () => ({ uploadSingleImage: vi.fn() }));

import { createTaskTemplate, mapTemplateInventory } from "./taskTemplate.controller.js";
import { companyHasFeature } from "../services/subscription.service.js";

const selection = { areaId: 2, inventorySelection: "ALL", selectedItems: [], expectedInventoryVersion: 1 };
const request = () => ({
  params: { id: "42" },
  user: { id: 1, companyId: 3, role: "ADMIN" },
  body: { title: "Cleaning", locationId: 28, shiftStart: "2026-10-07T09:00:00Z", shiftEnd: "2026-10-07T10:00:00Z", effectiveDate: "2026-10-07T00:00:00Z", recurringType: "DAILY", ...selection },
}) as unknown as Request;
const response = () => {
  const res = { status: vi.fn(), json: vi.fn() };
  res.status.mockReturnValue(res);
  return res;
};
const timeout = (message: string) => new Prisma.PrismaClientKnownRequestError(message, { code: "P2028", clientVersion: "7.5.0" });

describe("inventory schedule save transactions", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(companyHasFeature).mockResolvedValue(true);
    db.access.mockResolvedValue({ id: 28, isActive: true, timezone: "Asia/Karachi" });
    db.tx.location.findUnique.mockResolvedValue({ timezone: "Asia/Karachi" });
    db.tx.staff.findMany.mockResolvedValue([{ id: 61, shiftStart: new Date("2026-10-07T03:00:00Z"), shiftEnd: new Date("2026-10-07T14:00:00Z") }]);
    db.tx.taskTemplate.findMany.mockResolvedValue([]);
    db.tx.taskTemplate.create.mockResolvedValue({ id: 42 });
    db.tx.taskTemplate.findUniqueOrThrow.mockResolvedValue({ id: 42, verificationVersion: 2, setupStatus: "READY" });
    db.rootTemplate.mockResolvedValue({ id: 42, locationId: 28, location: { companyId: 3 } });
    db.transaction.mockImplementation(async work => work(db.tx));
  });

  it("keeps capacity reads on the save connection and returns success only after inventory and audit", async () => {
    const res = response();
    await createTaskTemplate(request(), res as unknown as Response);
    expect(db.transaction).toHaveBeenCalledWith(expect.any(Function), { maxWait: 10_000, timeout: 30_000 });
    expect(db.tx.location.findUnique).toHaveBeenCalledOnce();
    expect(db.tx.staff.findMany).toHaveBeenCalledOnce();
    expect(db.tx.taskTemplate.findMany).toHaveBeenCalledOnce();
    expect(db.rootLocation).not.toHaveBeenCalled();
    expect(db.rootStaff).not.toHaveBeenCalled();
    expect(db.rootTemplates).not.toHaveBeenCalled();
    expect(db.configure).toHaveBeenCalledWith(db.tx, 42, 28, selection);
    expect(db.today).toHaveBeenCalledWith(db.tx, expect.objectContaining({id:42,location:expect.objectContaining({id:28})}));
    expect(db.audit).toHaveBeenCalledWith(expect.objectContaining({ action: "CONFIGURE_INVENTORY", entityId: 42 }), db.tx);
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json.mock.calls[0][0].data).toMatchObject({ id: 42, verificationVersion: 2 });
  });

  it("still rejects over-capacity schedules without creating a template", async () => {
    db.tx.taskTemplate.findMany.mockResolvedValue([{ id: 9, title: "Existing", shiftStart: new Date("2026-10-07T09:00:00Z"), shiftEnd: new Date("2026-10-07T10:00:00Z"), effectiveDate: new Date("2026-10-07T00:00:00Z"), recurringType: "DAILY" }]);
    await expect(createTaskTemplate(request(), response() as unknown as Response)).rejects.toMatchObject({ statusCode: 400 });
    expect(db.tx.taskTemplate.create).not.toHaveBeenCalled();
  });

  it("rejects the old photo-only creation payload without creating a legacy schedule", async () => {
    const req = request();
    req.body = { title: 'Old photo task', locationId: 28, referenceNames: ['Photo'] };
    req.files = [];
    await expect(createTaskTemplate(req, response() as unknown as Response)).rejects.toMatchObject({ statusCode: 422, errors: [{ code: 'INVENTORY_VERIFICATION_REQUIRED', field: 'areaId' }] });
    expect(db.transaction).not.toHaveBeenCalled();
  });

  it("cannot downgrade a new inventory schedule through a client-supplied version", async () => {
    const req = request();
    req.body.verificationVersion = 1;
    await createTaskTemplate(req, response() as unknown as Response);
    expect(db.tx.taskTemplate.create).toHaveBeenCalledWith({ data: expect.objectContaining({ verificationVersion: 2, areaId: 2 }) });
  });

  it("reports confirmed query expiration as an unsaved retryable request, never as success", async () => {
    db.configure.mockRejectedValue(timeout("A query cannot be executed on an expired transaction. The timeout was 30000 ms."));
    const res = response();
    await expect(createTaskTemplate(request(), res as unknown as Response)).rejects.toMatchObject({ statusCode: 408, errors: [{ code: "SCHEDULE_SAVE_TIMEOUT" }] });
    expect(res.json).not.toHaveBeenCalled();
    expect(db.audit).not.toHaveBeenCalled();
  });

  it("reports an unstarted transaction timeout without claiming a template exists", async () => {
    db.transaction.mockRejectedValue(timeout("Unable to start a transaction in the given time."));
    await expect(createTaskTemplate(request(), response() as unknown as Response)).rejects.toMatchObject({ statusCode: 408, errors: [{ code: "SCHEDULE_SAVE_TIMEOUT" }] });
    expect(db.tx.taskTemplate.create).not.toHaveBeenCalled();
  });

  it("preserves unknown commit errors so the client does not blindly create a duplicate", async () => {
    const uncertain = timeout("Unknown transaction outcome after connection loss.");
    db.transaction.mockRejectedValue(uncertain);
    await expect(createTaskTemplate(request(), response() as unknown as Response)).rejects.toBe(uncertain);
  });

  it("gives existing schedule inventory changes the same bounded transaction budget", async () => {
    const res = response();
    await mapTemplateInventory(request(), res as unknown as Response);
    expect(db.transaction).toHaveBeenCalledWith(expect.any(Function), { maxWait: 10_000, timeout: 30_000 });
    expect(db.configure).toHaveBeenCalledWith(db.tx, 42, 28, selection);
    expect(res.json).toHaveBeenCalledOnce();
  });
});
