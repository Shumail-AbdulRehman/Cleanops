import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Request, Response } from "express";
import { WEEKDAYS, type WeekdayList } from "../utils/workDays.js";

const db = vi.hoisted(() => ({
  access: vi.fn(),
  transaction: vi.fn(),
  rootTemplate: vi.fn(),
  tx: {
    $queryRaw: vi.fn(),
    location: { findUnique: vi.fn() },
    staff: { findFirst: vi.fn(), findMany: vi.fn() },
    taskTemplate: { findMany: vi.fn(), findUnique: vi.fn(), create: vi.fn(), update: vi.fn(), findUniqueOrThrow: vi.fn() },
  },
}));

vi.mock("../prisma/prisma.js", () => ({ prisma: {
  $transaction: db.transaction,
  taskTemplate: { findUnique: db.rootTemplate },
} }));
vi.mock("../services/verification-v2/inventorySnapshot.service.js", () => ({
  validateInventorySelection: vi.fn(), configureTemplateInventory: vi.fn(), createTodaysTaskForNewTemplate: vi.fn(),
}));
vi.mock("../services/verification-v2/authorization.service.js", () => ({ requireLocationAccess: db.access }));
vi.mock("../services/auditLog.service.js", () => ({ writeAuditLog: vi.fn() }));
vi.mock("../services/deletion.service.js", () => ({ permanentlyDelete: vi.fn() }));
vi.mock("../services/subscription.service.js", () => ({
  companyHasFeature: async (_companyId: number, feature: string) => feature === "automaticAssignment",
}));

import { createTaskTemplate, editTaskTemplate } from "./taskTemplate.controller.js";

const location = { id: 28, companyId: 3, isActive: true, timezone: "Asia/Karachi" };
const monday = new Date("2026-11-23T02:00:00Z");
const tuesday = new Date("2026-11-24T02:00:00Z");
const shiftStart = new Date("2026-11-23T09:00:00Z");
const shiftEnd = new Date("2026-11-23T10:00:00Z");
const template = {
  id: 42, locationId: location.id, location, isActive: true,
  shiftStart, shiftEnd, effectiveDate: monday, recurringType: "DAILY", staffId: null, staff: null,
};
const staff = (workDays?: WeekdayList, id = 61) => ({
  id, name: "Ayesha", companyId: location.companyId, locationId: location.id, isActive: true, workDays,
  shiftStart: new Date("2026-11-23T03:00:00Z"), shiftEnd: new Date("2026-11-23T14:00:00Z"),
});
const request = (body: object) => ({
  params: { id: "42" }, user: { id: 1, companyId: location.companyId, role: "ADMIN" }, body,
}) as unknown as Request;
const response = () => {
  const res = { status: vi.fn(), json: vi.fn() };
  res.status.mockReturnValue(res);
  return res as unknown as Response;
};
const create = (body: object) => createTaskTemplate(request({
  title: "Cleaning", locationId: location.id, recurringType: "DAILY", shiftStart, shiftEnd, effectiveDate: monday,
  areaId: 2, inventorySelection: "ALL", selectedItems: [], expectedInventoryVersion: 1,
  ...body,
}), response());
const edit = (body: object) => editTaskTemplate(request(body), response());
const invalidDays = {
  statusCode: 400,
  message: "Choose at least one day for this schedule.",
  errors: [{ code: "INVALID_REPEAT_DAYS", field: "repeatDays" }],
};
const mismatch = {
  statusCode: 422,
  message: "Ayesha works Mon, Wed. Choose days within those, or use automatic assignment.",
  errors: [{ code: "SCHEDULE_OUTSIDE_WORK_DAYS", field: "repeatDays" }],
};
const capacityError = {
  statusCode: 400,
  message: "Cannot create this task schedule. 2 task(s) would overlap at this location, but only 1 active staff member(s) have shifts covering this time. Add staff, adjust shifts, or choose a different task time.",
};

describe("schedule repeat days", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-22T12:00:00Z"));
    db.access.mockResolvedValue(location);
    db.transaction.mockImplementation(async work => work(db.tx));
    db.rootTemplate.mockResolvedValue(template);
    db.tx.staff.findFirst.mockResolvedValue(staff(["MON", "WED"]));
    db.tx.location.findUnique.mockResolvedValue(location);
    db.tx.staff.findMany.mockResolvedValue([staff()]);
    db.tx.taskTemplate.findMany.mockResolvedValue([]);
    db.tx.taskTemplate.findUnique.mockResolvedValue(template);
    db.tx.taskTemplate.create.mockResolvedValue(template);
    db.tx.taskTemplate.findUniqueOrThrow.mockResolvedValue(template);
  });

  afterEach(() => vi.useRealTimers());

  it("stores daily repeat days in canonical order and removes duplicates", async () => {
    await create({ repeatDays: ["WED", "MON", "WED"] });
    expect(db.tx.taskTemplate.create).toHaveBeenCalledWith({ data: expect.objectContaining({ repeatDays: ["MON", "WED"] }) });
  });

  it("rejects invalid create and edit lists with the field error", async () => {
    await expect(create({ repeatDays: [] })).rejects.toMatchObject(invalidDays);
    await expect(edit({ repeatDays: ["MON", "FUNDAY"] })).rejects.toMatchObject(invalidDays);
    expect(db.transaction).not.toHaveBeenCalled();
  });

  it("stores all seven days for a one-off and checks the fixed worker against the location date", async () => {
    const westernLocation = { ...location, timezone: "America/Los_Angeles" };
    db.access.mockResolvedValue(westernLocation);
    db.tx.location.findUnique.mockResolvedValue(westernLocation);
    const body = { recurringType: "ONCE", repeatDays: ["MON"], staffId: 61 };
    await expect(create(body)).rejects.toMatchObject(mismatch);
    db.tx.staff.findFirst.mockResolvedValue(staff(["SUN"]));
    db.tx.staff.findMany.mockResolvedValue([staff(["SUN"])]);
    await create(body);
    expect(db.tx.taskTemplate.create).toHaveBeenCalledExactlyOnceWith({ data: expect.objectContaining({ repeatDays: WEEKDAYS }) });
  });

  it("rejects an every-day schedule for a restricted fixed worker before checking overlap or writing", async () => {
    await expect(create({ staffId: 61 })).rejects.toMatchObject(mismatch);
    expect(db.tx.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(db.tx.staff.findFirst.mock.invocationCallOrder[0]!);
    expect(db.tx.taskTemplate.findMany).not.toHaveBeenCalled();
    expect(db.tx.taskTemplate.create).not.toHaveBeenCalled();
  });

  it("saves a Monday schedule for the same fixed worker", async () => {
    db.tx.staff.findMany.mockResolvedValue([staff(["MON", "WED"])]);
    await create({ staffId: 61, repeatDays: ["MON"] });
    expect(db.tx.taskTemplate.create).toHaveBeenCalledWith({ data: expect.objectContaining({ staffId: 61, repeatDays: ["MON"] }) });
  });

  it("uses the fixed worker seen under the lock when rejecting a switch to Tuesday", async () => {
    db.tx.taskTemplate.findUnique.mockResolvedValue({ ...template, staffId: 61, staff: staff(["MON", "WED"]), repeatDays: ["MON"] });
    await expect(edit({ repeatDays: ["TUE"] })).rejects.toMatchObject(mismatch);
    expect(db.tx.taskTemplate.update).not.toHaveBeenCalled();
  });

  it.each([null, 62])("ignores staffId %s and keeps validating the stored fixed worker", async (staffId) => {
    db.tx.taskTemplate.findUnique.mockResolvedValue({ ...template, staffId: 61, staff: staff(["MON", "WED"]), repeatDays: ["MON"] });
    await expect(edit({ staffId, repeatDays: ["TUE"] })).rejects.toMatchObject(mismatch);
    await edit({ staffId, repeatDays: ["WED"] });
    expect(db.tx.taskTemplate.update).toHaveBeenCalledExactlyOnceWith({ where: { id: 42 }, data: { repeatDays: ["WED"] } });
  });

  it("resets repeat days when editing a daily schedule into a one-off", async () => {
    db.tx.taskTemplate.findUnique.mockResolvedValue({ ...template, staffId: 61, staff: staff(["MON"]), repeatDays: ["MON"] });
    await edit({ recurringType: "ONCE" });
    expect(db.tx.taskTemplate.update).toHaveBeenCalledWith({ where: { id: 42 }, data: { recurringType: "ONCE", repeatDays: WEEKDAYS } });
  });

  it("keeps stored repeat days for unrelated edits and uses them in the capacity check", async () => {
    db.tx.taskTemplate.findUnique.mockResolvedValue({ ...template, repeatDays: ["MON"] });
    db.tx.staff.findMany.mockResolvedValue([staff(["MON"])]);
    await edit({ title: "New title" });
    expect(db.tx.taskTemplate.update).toHaveBeenCalledWith({ where: { id: 42 }, data: { title: "New title" } });
  });

  it("checks Tuesday capacity separately and ignores the Tuesday schedule on Monday", async () => {
    db.tx.staff.findMany.mockResolvedValue([staff(["MON", "WED"]), staff(WEEKDAYS, 62)]);
    await create({ repeatDays: ["TUE"] });
    db.tx.taskTemplate.findMany.mockResolvedValue([{ ...template, repeatDays: ["TUE"] }]);
    await expect(create({ repeatDays: ["TUE"] })).rejects.toMatchObject(capacityError);
    db.tx.staff.findMany.mockResolvedValue([staff(["MON", "WED"])]);
    await create({ repeatDays: ["MON"] });
    expect(db.tx.taskTemplate.create).toHaveBeenCalledTimes(2);
  });

  it("counts a one-off on its local weekday when checking chosen repeat days", async () => {
    db.tx.staff.findMany.mockResolvedValue([staff(["MON", "TUE"])]);
    db.tx.taskTemplate.findMany.mockResolvedValue([{ ...template, recurringType: "ONCE", effectiveDate: tuesday, repeatDays: WEEKDAYS }]);
    await create({ repeatDays: ["MON"] });
    await expect(create({ repeatDays: ["TUE"] })).rejects.toMatchObject(capacityError);
    expect(db.tx.taskTemplate.create).toHaveBeenCalledOnce();
  });

  it("retains the previous overlap count when all schedules and staff use all seven days", async () => {
    db.tx.staff.findMany.mockResolvedValue([staff(), staff(WEEKDAYS, 62)]);
    db.tx.taskTemplate.findMany.mockResolvedValue([
      { ...template, recurringType: "ONCE", effectiveDate: monday },
      { ...template, recurringType: "ONCE", effectiveDate: tuesday, repeatDays: WEEKDAYS },
    ]);
    await expect(create({})).rejects.toMatchObject({ statusCode: 400, message: expect.stringContaining("3 task(s) would overlap") });
    expect(db.tx.taskTemplate.create).not.toHaveBeenCalled();
  });
});
