import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Request, Response } from "express";

const db = vi.hoisted(() => ({
  transaction: vi.fn(),
  findTemplate: vi.fn(),
  access: vi.fn(),
  tx: {
    $queryRaw: vi.fn(),
    location: { findUnique: vi.fn() },
    staff: { findFirst: vi.fn(), findMany: vi.fn() },
    taskTemplate: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      findUniqueOrThrow: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
  },
}));

vi.mock("../prisma/prisma.js", () => ({
  prisma: { $transaction: db.transaction, taskTemplate: { findUnique: db.findTemplate } },
}));
vi.mock("../services/verification-v2/authorization.service.js", () => ({ requireLocationAccess: db.access }));
vi.mock("../services/verification-v2/inventorySnapshot.service.js", () => ({
  validateInventorySelection: vi.fn(),
  configureTemplateInventory: vi.fn(),
  createTodaysTaskForNewTemplate: vi.fn(),
}));
vi.mock("../services/auditLog.service.js", () => ({ writeAuditLog: vi.fn() }));
vi.mock("../services/deletion.service.js", () => ({ permanentlyDelete: vi.fn() }));
vi.mock("../services/subscription.service.js", () => ({ companyHasFeature: vi.fn() }));

import { companyHasFeature } from "../services/subscription.service.js";
import { createTaskTemplate, editTaskTemplate } from "./taskTemplate.controller.js";

const location = { id: 28, companyId: 3, isActive: true, timezone: "Asia/Karachi" };
const worker = {
  id: 61, name: "Ayesha", companyId: 3, locationId: location.id, isActive: true,
  shiftStart: new Date("2026-11-23T04:00:00Z"),
  shiftEnd: new Date("2026-11-23T12:00:00Z"),
};
const existingSchedule = {
  id: 42, title: "Washroom opening", locationId: location.id, isActive: true,
  staffId: worker.id, staff: worker, location,
  shiftStart: new Date("2026-11-23T05:00:00Z"),
  shiftEnd: new Date("2026-11-23T06:00:00Z"),
  effectiveDate: new Date("2026-11-23T00:00:00Z"),
  recurringType: "DAILY", repeatDays: ["MON"],
};
const createBody = {
  title: "Washroom cleaning", locationId: location.id, staffId: worker.id,
  shiftStart: existingSchedule.shiftStart.toISOString(),
  shiftEnd: existingSchedule.shiftEnd.toISOString(),
  effectiveDate: existingSchedule.effectiveDate.toISOString(),
  recurringType: "DAILY", repeatDays: ["MON"],
  areaId: 2, inventorySelection: "ALL", selectedItems: [], expectedInventoryVersion: 1,
};

function request(body: object) {
  return { params: { id: "42" }, user: { id: 1, companyId: 3, role: "ADMIN" }, body } as unknown as Request;
}

function response() {
  const res = { status: vi.fn(), json: vi.fn() };
  res.status.mockReturnValue(res);
  return res as unknown as Response;
}

const workerRequired = {
  statusCode: 422,
  message: "Your plan does not assign staff automatically. Choose a worker for this schedule.",
  errors: [{ code: "WORKER_REQUIRED", field: "staffId" }],
};
const workerOverlap = {
  statusCode: 409,
  message: "Ayesha already has an overlapping schedule: Washroom opening. Choose a different time or worker.",
  errors: [{ code: "WORKER_OVERLAP", field: "staffId" }],
};

describe("schedule save checks", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-22T00:00:00Z"));
    db.access.mockResolvedValue(location);
    db.tx.location.findUnique.mockResolvedValue(location);
    db.tx.staff.findFirst.mockResolvedValue(worker);
    db.tx.staff.findMany.mockResolvedValue([worker]);
    db.tx.taskTemplate.findMany.mockResolvedValue([]);
    db.tx.taskTemplate.create.mockResolvedValue({ id: 43 });
    db.tx.taskTemplate.findUniqueOrThrow.mockResolvedValue({ id: 43 });
    db.transaction.mockImplementation(work => work(db.tx));
  });

  afterEach(() => vi.useRealTimers());

  it("rejects a 16:00–10:00 schedule for a 09:00–17:00 worker", async () => {
    const body = { ...createBody, shiftStart: "2026-11-23T11:00:00Z", shiftEnd: "2026-11-24T05:00:00Z" };
    await expect(createTaskTemplate(request(body), response())).rejects.toMatchObject({
      statusCode: 422,
      message: "This time falls outside Ayesha's shift (09:00–17:00). Choose a time inside the shift or update the shift.",
      errors: [{ code: "SHIFT_MISMATCH", field: "shiftStart" }],
    });
    expect(db.tx.staff.findFirst).toHaveBeenCalledWith({
      where: { id: worker.id, companyId: 3, locationId: location.id, isActive: true },
    });
    expect(db.tx.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(db.tx.staff.findFirst.mock.invocationCallOrder[0]!);
    expect(db.tx.taskTemplate.create).not.toHaveBeenCalled();
  });

  it("names the worker's overlapping active schedule on a shared repeat day", async () => {
    db.tx.taskTemplate.findMany.mockResolvedValue([existingSchedule]);
    await expect(createTaskTemplate(request(createBody), response())).rejects.toMatchObject(workerOverlap);
    expect(db.tx.taskTemplate.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ staffId: worker.id, locationId: location.id, isActive: true }),
    }));
    expect(db.tx.taskTemplate.create).not.toHaveBeenCalled();
  });

  it("saves the same hours on separate repeat days", async () => {
    db.tx.taskTemplate.findMany.mockResolvedValue([existingSchedule]);
    const res = response();
    await createTaskTemplate(request({ ...createBody, repeatDays: ["TUE"] }), res);
    expect(res.status).toHaveBeenCalledWith(201);
  });

  it.each([undefined, ""])("requires a worker on Starter with staffId %j", async staffId => {
    vi.mocked(companyHasFeature).mockResolvedValue(false);
    await expect(createTaskTemplate(request({ ...createBody, staffId }), response())).rejects.toMatchObject(workerRequired);
    expect(companyHasFeature).toHaveBeenCalledWith(3, "automaticAssignment");
    expect(db.tx.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(companyHasFeature).mock.invocationCallOrder[0]!);
    expect(db.tx.taskTemplate.create).not.toHaveBeenCalled();
  });

  it("saves without a worker on Pro", async () => {
    vi.mocked(companyHasFeature).mockResolvedValue(true);
    const res = response();
    await createTaskTemplate(request({ ...createBody, staffId: undefined }), res);
    expect(companyHasFeature).toHaveBeenCalledWith(3, "automaticAssignment");
    expect(res.status).toHaveBeenCalledWith(201);
  });

  it("requires a worker when editing an active unassigned Starter schedule", async () => {
    const unassigned = { ...existingSchedule, staffId: null, staff: null };
    db.findTemplate.mockResolvedValue(unassigned);
    db.tx.taskTemplate.findUnique.mockResolvedValue(unassigned);
    vi.mocked(companyHasFeature).mockResolvedValue(false);
    await expect(editTaskTemplate(request({ title: "New title" }), response())).rejects.toMatchObject(workerRequired);
    expect(db.tx.taskTemplate.update).not.toHaveBeenCalled();
  });

  it("checks a fixed-worker edit against other schedules using the merged dates and repeat days", async () => {
    const current = { ...existingSchedule, repeatDays: ["TUE"] };
    db.findTemplate.mockResolvedValue(current);
    db.tx.taskTemplate.findUnique.mockResolvedValue(current);
    db.tx.taskTemplate.findMany.mockResolvedValue([{ ...existingSchedule, id: 43 }]);
    await expect(editTaskTemplate(request({ repeatDays: ["MON"] }), response())).rejects.toMatchObject(workerOverlap);
    expect(db.tx.taskTemplate.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: { not: 42 }, staffId: worker.id, isActive: true, locationId: location.id },
    }));
    expect(db.tx.taskTemplate.update).not.toHaveBeenCalled();
  });
});
