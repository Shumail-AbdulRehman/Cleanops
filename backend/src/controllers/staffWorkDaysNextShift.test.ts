import type { Request, Response } from "express";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WEEKDAYS } from "../utils/workDays.js";
import { editStaff } from "./staff.controller.js";

const { tx, db } = vi.hoisted(() => ({
  tx: {
    $queryRaw: vi.fn(),
    staff: { findUnique: vi.fn(), findFirst: vi.fn(), update: vi.fn() },
    taskTemplate: { findMany: vi.fn() },
    attendance: { findUnique: vi.fn(), deleteMany: vi.fn() },
  },
  db: { $transaction: vi.fn() },
}));

vi.mock("../prisma/prisma.js", () => ({ prisma: db }));
vi.mock("../services/launchJobs.service.js", () => ({ jobAccountAllowed: async () => true }));

const staff = {
  id: 7,
  companyId: 42,
  name: "Test Staff",
  isActive: true,
  locationId: 9,
  location: { id: 9, isActive: true, timezone: "Asia/Karachi" },
  shiftStart: new Date("2026-11-23T19:00:00Z"),
  shiftEnd: new Date("2026-11-23T23:00:00Z"),
  workDays: [...WEEKDAYS],
};
const actor: NonNullable<Request["user"]> = {
  id: 10, name: "Test Manager", email: null, role: "MANAGER", companyId: staff.companyId,
  locationIds: [staff.locationId],
};

async function patchStaff(body: object) {
  const req: Pick<Request, "body" | "params" | "user"> = {
    body, params: { id: String(staff.id) }, user: actor,
  };
  const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
  await editStaff(req as Request, res as unknown as Response);
  expect(res.status).toHaveBeenCalledWith(200);
}

function mockStaff(currentStaff: typeof staff) {
  tx.staff.findUnique.mockReturnValue(currentStaff);
  tx.staff.findFirst.mockImplementation(() => currentStaff);
  tx.staff.update.mockImplementation(({ data }) => {
    currentStaff = { ...currentStaff, ...data };
    return currentStaff;
  });
}

const untouched = {
  status: "ABSENT", checkInTime: null, checkOutTime: null, checkInImage: null, checkOutImage: null,
};

beforeEach(() => {
  vi.resetAllMocks();
  vi.setSystemTime(new Date("2026-11-23T18:00:00Z"));
  db.$transaction.mockImplementation((run) => run(tx));
  tx.taskTemplate.findMany.mockResolvedValue([]);
  mockStaff(staff);
});

afterEach(() => vi.useRealTimers());

describe("attendance sync after a staff edit", () => {
  it.each([
    ["Asia/Karachi", "2026-11-23T18:00:00Z", "2026-11-22T19:00:00Z", "2026-11-23T19:00:00Z"],
    ["America/New_York", "2026-11-24T04:00:00Z", "2026-11-23T05:00:00Z", "2026-11-24T05:00:00Z"],
  ])("cleans up a prepared Tuesday midnight shift at 23:00 Monday in %s", async (timezone, time, monday, tuesday) => {
    const now = new Date(time);
    const todayStart = new Date(monday);
    const nextStart = new Date(tuesday);
    const nextEnd = new Date(nextStart.getTime() + 4 * 60 * 60 * 1000);
    vi.setSystemTime(now);
    mockStaff({ ...staff, location: { ...staff.location, timezone }, shiftStart: nextStart, shiftEnd: nextEnd });

    const todayRow = { id: 20, ...untouched, expectedEnd: new Date(todayStart.getTime() + 4 * 60 * 60 * 1000) };
    const nextRow = { id: 21, ...untouched, expectedEnd: nextEnd };
    const rows = new Map([[todayStart.getTime(), todayRow], [nextStart.getTime(), nextRow]]);
    tx.attendance.findUnique.mockImplementation(({ where }) => rows.get(where.staffId_date.date.getTime()) ?? null);
    tx.attendance.deleteMany.mockResolvedValue({ count: 1 });

    await patchStaff({ workDays: WEEKDAYS.filter((day) => day !== "TUE") });

    expect(tx.attendance.findUnique.mock.calls.map(([input]) => input.where.staffId_date)).toEqual([
      { staffId: staff.id, date: todayStart },
      { staffId: staff.id, date: nextStart },
    ]);
    expect(tx.attendance.deleteMany).toHaveBeenCalledExactlyOnceWith({
      where: { id: nextRow.id, ...untouched, expectedEnd: { gt: now } },
    });
  });

  it("does not sync attendance for a name-only edit", async () => {
    await patchStaff({ name: "Renamed Staff" });

    expect(db.$transaction).toHaveBeenCalledTimes(1);
    expect(tx.staff.findFirst).not.toHaveBeenCalled();
    expect(tx.attendance.findUnique).not.toHaveBeenCalled();
  });

  it("syncs only the current window for a shift-only edit", async () => {
    tx.attendance.findUnique.mockResolvedValue({ id: 20, ...untouched, expectedEnd: new Date("2026-11-22T23:00:00Z") });

    await patchStaff({ shiftEnd: "2026-11-24T00:00:00Z" });

    expect(tx.attendance.findUnique).toHaveBeenCalledExactlyOnceWith({
      where: { staffId_date: { staffId: staff.id, date: new Date("2026-11-22T19:00:00Z") } },
    });
  });
});
