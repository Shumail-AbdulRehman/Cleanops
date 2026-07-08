import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WEEKDAYS } from "../utils/workDays.js";
import { findBestStaffForTask, reassignExpiredAssignments } from "./taskAssignment.service.js";

const mocks = vi.hoisted(() => ({
  transaction: vi.fn(),
  staff: { findMany: vi.fn() },
  attendance: { findFirst: vi.fn() },
  taskAssignment: { findMany: vi.fn(), count: vi.fn() },
  companyHasFeature: vi.fn(),
}));

vi.mock("../prisma/prisma.js", () => ({
  prisma: {
    $transaction: mocks.transaction,
    staff: mocks.staff,
    attendance: mocks.attendance,
    taskAssignment: mocks.taskAssignment,
  },
}));
vi.mock("./subscription.service.js", () => ({ companyHasFeature: mocks.companyHasFeature }));
vi.mock("./launchJobs.service.js", () => ({ jobAccountAllowed: vi.fn(async () => true) }));
vi.mock("./auditLog.service.js", () => ({ writeAuditLog: vi.fn() }));

const tuesdayTask = {
  id: 10,
  title: "Washroom",
  date: new Date("2026-11-24T00:00:00+05:00"),
  shiftStart: new Date("2026-11-24T10:00:00+05:00"),
  shiftEnd: new Date("2026-11-24T11:00:00+05:00"),
  status: "PENDING",
  isActive: true,
  startedAt: null,
  completedAt: null,
  staffId: null,
  locationId: 31,
  location: { companyId: 1, timezone: "Asia/Karachi" },
};
const beforeTuesdayTask = new Date("2026-11-24T09:00:00+05:00");
const dayOffStaff = {
  id: 1,
  name: "Day off",
  shiftStart: new Date("2026-11-24T08:00:00+05:00"),
  shiftEnd: new Date("2026-11-24T13:00:00+05:00"),
  workDays: ["MON", "WED"],
};
const everyDayStaff = {
  ...dayOffStaff,
  id: 2,
  name: "Available",
  workDays: [...WEEKDAYS],
};

describe("automatic assignment work days", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.attendance.findFirst.mockResolvedValue(null);
    mocks.taskAssignment.findMany.mockResolvedValue([]);
    mocks.companyHasFeature.mockResolvedValue(true);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  it("chooses the all-seven worker when the lower-ID worker is off on Tuesday", async () => {
    mocks.staff.findMany.mockResolvedValue([dayOffStaff, everyDayStaff]);

    const staff = await findBestStaffForTask(tuesdayTask, { now: beforeTuesdayTask });

    expect(staff).toEqual(everyDayStaff);
    expect(mocks.staff.findMany).toHaveBeenCalledWith(expect.objectContaining({
      select: expect.objectContaining({ workDays: true }),
    }));
    expect(mocks.attendance.findFirst).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      where: expect.objectContaining({ staffId: everyDayStaff.id }),
    }));
    expect(mocks.taskAssignment.findMany).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      where: expect.objectContaining({ staffId: everyDayStaff.id }),
    }));
  });

  it("returns no candidate when the only worker is off on Tuesday", async () => {
    mocks.staff.findMany.mockResolvedValue([dayOffStaff]);

    expect(await findBestStaffForTask(tuesdayTask, { now: beforeTuesdayTask })).toBeNull();
    expect(mocks.attendance.findFirst).not.toHaveBeenCalled();
    expect(mocks.taskAssignment.findMany).not.toHaveBeenCalled();
  });

  it.each([
    { timezone: "Asia/Karachi", offset: "+05:00" },
    { timezone: "America/Los_Angeles", offset: "-08:00" },
  ])("allows a Monday worker to cover Tuesday at 02:00 in $timezone", async ({ timezone, offset }) => {
    const mondayStaff = {
      ...dayOffStaff,
      shiftStart: new Date(`2026-11-23T22:00:00${offset}`),
      shiftEnd: new Date(`2026-11-24T06:00:00${offset}`),
      workDays: ["MON"],
    };
    const overnightTask = {
      ...tuesdayTask,
      date: new Date(`2026-11-24T00:00:00${offset}`),
      shiftStart: new Date(`2026-11-24T02:00:00${offset}`),
      shiftEnd: new Date(`2026-11-24T03:00:00${offset}`),
      location: { ...tuesdayTask.location, timezone },
    };
    mocks.staff.findMany.mockResolvedValue([mondayStaff]);

    const staff = await findBestStaffForTask(overnightTask, { now: mondayStaff.shiftStart });

    expect(staff).toEqual(mondayStaff);
  });

  it("keeps the current assignment when the only replacement after a missed start is off", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-24T10:30:00+05:00"));
    vi.stubEnv("MAX_TASK_REASSIGNMENTS", "3");
    const currentStaffId = 3;
    mocks.taskAssignment.findMany.mockResolvedValueOnce([{
      id: 20,
      staffId: currentStaffId,
      taskInstance: { ...tuesdayTask, staffId: currentStaffId },
    }]);
    mocks.taskAssignment.count.mockResolvedValue(1);
    mocks.staff.findMany.mockResolvedValue([dayOffStaff]);
    mocks.attendance.findFirst.mockResolvedValue({
      status: "CHECKED_IN",
      checkInTime: beforeTuesdayTask,
      checkOutTime: null,
    });

    expect(await reassignExpiredAssignments(10)).toEqual({
      scanned: 1,
      reassigned: 0,
      failedWithoutReplacement: 1,
    });
    expect(mocks.staff.findMany).toHaveBeenCalledOnce();
    expect(mocks.attendance.findFirst).not.toHaveBeenCalled();
    expect(mocks.taskAssignment.findMany).toHaveBeenCalledOnce();
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
});
