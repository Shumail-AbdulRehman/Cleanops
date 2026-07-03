import type { Request, Response } from "express";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createStaff, editStaff } from "./staff.controller.js";
import { WEEKDAYS, type Weekday } from "../utils/workDays.js";

const { tx, db, withAccountCapacity, syncAttendance } = vi.hoisted(() => ({
  tx: {
    $queryRaw: vi.fn(),
    staff: { create: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
    taskTemplate: { findMany: vi.fn() },
  },
  db: { $transaction: vi.fn() },
  withAccountCapacity: vi.fn(),
  syncAttendance: vi.fn(),
}));

vi.mock("../prisma/prisma.js", () => ({ prisma: db }));
vi.mock("../services/accountAccess.service.js", async (importOriginal) => ({
  ...await importOriginal<typeof import("../services/accountAccess.service.js")>(),
  withAccountCapacity,
}));
vi.mock("../utils/syncAttendanceWindow.js", () => ({
  syncTodaysOpenAttendanceWindow: syncAttendance,
}));

const staff = {
  id: 7,
  companyId: 42,
  name: "Test Staff",
  phone: "+923011234567",
  isActive: true,
  locationId: 9,
  location: { timezone: "Asia/Karachi" },
  shiftStart: new Date("2026-11-24T03:00:00Z"),
  shiftEnd: new Date("2026-11-24T11:00:00Z"),
  workDays: [...WEEKDAYS],
};
const actor: NonNullable<Request["user"]> = {
  id: 10, name: "Test Actor", email: null, role: "ADMIN", companyId: staff.companyId, locationIds: [],
};
const createBody = { name: staff.name, phone: staff.phone };
const withoutDay = (day: Weekday) => WEEKDAYS.filter((weekday) => weekday !== day);

async function call(handler: typeof editStaff, body: object) {
  const req: Pick<Request, "body" | "params" | "user"> = {
    body, params: { id: String(staff.id) }, user: actor,
  };
  const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
  await handler(req as Request, res as unknown as Response);
  return { status: res.status.mock.calls[0]?.[0], data: res.json.mock.calls[0]?.[0].data };
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.setSystemTime(new Date("2026-11-24T00:30:00Z"));
  db.$transaction.mockImplementation((run) => run(tx));
  withAccountCapacity.mockImplementation((_actor, _resource, run) => run(tx));
  tx.staff.findUnique.mockImplementation(({ where }) => where.id === staff.id ? staff : null);
  tx.staff.create.mockImplementation(({ data }) => ({
    ...data, id: staff.id, workDays: data.workDays ?? WEEKDAYS,
  }));
  tx.staff.update.mockImplementation(({ data }) => ({ ...staff, ...data }));
  tx.taskTemplate.findMany.mockResolvedValue([]);
});

afterEach(() => vi.useRealTimers());

describe("create staff with work days", () => {
  it("stores the requested work days in canonical order", async () => {
    expect(await call(createStaff, { ...createBody, workDays: ["WED", "MON"] })).toMatchObject({
      status: 201, data: { workDays: ["MON", "WED"] },
    });
    expect(tx.staff.create.mock.calls[0]?.[0].data.workDays).toEqual(["MON", "WED"]);
  });

  it("leaves work days out of the insert when omitted", async () => {
    expect(await call(createStaff, createBody)).toMatchObject({
      status: 201, data: { workDays: WEEKDAYS },
    });
    expect(tx.staff.create.mock.calls[0]?.[0].data).not.toHaveProperty("workDays");
  });

  it("rejects an empty list before the capacity transaction", async () => {
    const message = "Choose at least one work day.";
    await expect(call(createStaff, { ...createBody, workDays: [] })).rejects.toMatchObject({
      statusCode: 400, message, errors: [{ code: "INVALID_WORK_DAYS", field: "workDays", message }],
    });
    expect(withAccountCapacity).not.toHaveBeenCalled();
  });
});

describe("edit staff work days", () => {
  it("refuses to remove a day used by an active fixed daily schedule", async () => {
    tx.taskTemplate.findMany.mockResolvedValue([{ title: "Washroom A", recurringType: "DAILY", repeatDays: ["TUE"] }]);
    const message = 'Test Staff has schedules on the days you removed: "Washroom A". Change those schedules first.';
    await expect(call(editStaff, { workDays: withoutDay("TUE") })).rejects.toMatchObject({
      statusCode: 409, message, errors: [{ code: "WORK_DAYS_CONFLICT", field: "workDays", message }],
    });
    expect(tx.taskTemplate.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { staffId: staff.id, isActive: true, recurringType: { in: ["DAILY", "ONCE"] } },
    }));
    expect(tx.staff.update).not.toHaveBeenCalled();
    expect(syncAttendance).not.toHaveBeenCalled();
  });

  it.each([
    ["Asia/Karachi", "2026-11-23T19:00:00Z", "TUE"],
    ["America/New_York", "2026-11-23T05:00:00Z", "MON"],
    ["Asia/Karachi", "2026-11-30T19:00:00Z", "TUE"],
  ] as const)("includes a fixed ONCE schedule dated today or later in %s (%s)", async (timezone, date, removed) => {
    tx.taskTemplate.findMany.mockResolvedValue([
      { title: "All week", recurringType: "DAILY" },
      { title: "One visit", recurringType: "ONCE", effectiveDate: new Date(date), location: { timezone } },
    ]);
    await expect(call(editStaff, { workDays: withoutDay(removed) })).rejects.toMatchObject({
      statusCode: 409,
      message: 'Test Staff has schedules on the days you removed: "All week", "One visit". Change those schedules first.',
    });
    expect(tx.staff.update).not.toHaveBeenCalled();
    expect(syncAttendance).not.toHaveBeenCalled();
  });

  it.each([
    ["Asia/Karachi", "2026-11-22T19:00:00Z", "TUE"],
    ["America/New_York", "2026-11-22T05:00:00Z", "MON"],
  ] as const)("ignores a daily schedule that ended before today in %s", async (timezone, endDate, removed) => {
    tx.taskTemplate.findMany.mockResolvedValue([{
      title: "Ended round", recurringType: "DAILY", repeatDays: [removed],
      recurringEndDate: new Date(endDate), location: { timezone },
    }]);
    const workDays = withoutDay(removed);
    expect(await call(editStaff, { workDays })).toMatchObject({ status: 200, data: { workDays } });
    expect(tx.taskTemplate.findMany).toHaveBeenCalledWith(expect.objectContaining({
      select: expect.objectContaining({ recurringEndDate: true }),
    }));
  });

  it("still refuses to remove a day from a daily schedule ending today in its location", async () => {
    tx.taskTemplate.findMany.mockResolvedValue([{
      title: "Current round", recurringType: "DAILY", repeatDays: ["MON"],
      recurringEndDate: new Date("2026-11-23T05:00:00Z"),
      location: { timezone: "America/New_York" },
    }]);
    await expect(call(editStaff, { workDays: withoutDay("MON") })).rejects.toMatchObject({
      statusCode: 409, errors: [{ code: "WORK_DAYS_CONFLICT", field: "workDays" }],
    });
  });

  it("saves when fixed schedules use other days or are past ONCE schedules, then syncs once", async () => {
    tx.taskTemplate.findMany.mockResolvedValue([
      { title: "Monday round", recurringType: "DAILY", repeatDays: ["MON"] },
      { title: "Past visit", recurringType: "ONCE", effectiveDate: new Date("2026-11-16T19:00:00Z"), location: staff.location },
      { title: "Wednesday visit", recurringType: "ONCE", effectiveDate: new Date("2026-11-24T19:00:00Z"), location: staff.location },
    ]);
    const workDays = withoutDay("TUE");
    expect(await call(editStaff, { workDays })).toMatchObject({ status: 200, data: { workDays } });
    expect(tx.staff.update).toHaveBeenCalledWith(expect.objectContaining({
      data: { workDays }, select: expect.objectContaining({ workDays: true }),
    }));
    expect(tx.staff.update).toHaveBeenCalledBefore(syncAttendance);
    expect(syncAttendance.mock.calls).toEqual([
      [{ staffId: staff.id, locationId: staff.locationId, shiftStart: staff.shiftStart, shiftEnd: staff.shiftEnd }, new Date()],
      [{ staffId: staff.id, locationId: staff.locationId, shiftStart: staff.shiftStart, shiftEnd: staff.shiftEnd }, new Date(), "next"],
    ]);
  });

  it("syncs once for an addition without looking up fixed schedules", async () => {
    tx.staff.findUnique.mockResolvedValueOnce({ ...staff, workDays: ["MON"] });
    expect(await call(editStaff, { workDays: ["WED", "MON"] })).toMatchObject({
      status: 200, data: { workDays: ["MON", "WED"] },
    });
    expect(tx.taskTemplate.findMany).not.toHaveBeenCalled();
    expect(syncAttendance.mock.calls).toEqual([
      [{ staffId: staff.id, locationId: staff.locationId, shiftStart: staff.shiftStart, shiftEnd: staff.shiftEnd }, new Date()],
      [{ staffId: staff.id, locationId: staff.locationId, shiftStart: staff.shiftStart, shiftEnd: staff.shiftEnd }, new Date(), "next"],
    ]);
  });

  it.each([{ name: "Renamed Staff" }, { workDays: [...WEEKDAYS].reverse() }])(
    "skips attendance sync without a work day or shift change (%j)",
    async (body) => {
      expect(await call(editStaff, body)).toMatchObject({ status: 200, data: { workDays: WEEKDAYS } });
      expect(tx.taskTemplate.findMany).not.toHaveBeenCalled();
      expect(syncAttendance).not.toHaveBeenCalled();
    },
  );
});
