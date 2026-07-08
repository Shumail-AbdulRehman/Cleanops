import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ensureAssignmentsForToday, ensureCurrentAssignmentForTask, reassignExpiredAssignments } from "./taskAssignment.service.js";

const db = vi.hoisted(() => ({
  $transaction: vi.fn(),
  $queryRaw: vi.fn(),
  staff: { findFirst: vi.fn(), findMany: vi.fn() },
  taskInstance: { findUnique: vi.fn(), findMany: vi.fn(), update: vi.fn() },
  taskAssignment: { findFirst: vi.fn(), findMany: vi.fn(), count: vi.fn(), update: vi.fn(), create: vi.fn(), createMany: vi.fn() },
  attendance: { findFirst: vi.fn() },
  auditLog: { findFirst: vi.fn(), create: vi.fn() },
}));
const companyHasFeature = vi.hoisted(() => vi.fn());
vi.mock("../prisma/prisma.js", () => ({ prisma: db }));
vi.mock("./subscription.service.js", () => ({ companyHasFeature }));
vi.mock("./launchJobs.service.js", () => ({ jobAccountAllowed: vi.fn(async () => true) }));

const now = new Date("2026-11-23T04:30:00Z");
const task = {
  id: 10,
  title: "Clean washroom",
  staffId: 70,
  status: "PENDING",
  isActive: true,
  date: new Date("2026-11-22T19:00:00Z"),
  shiftStart: new Date("2026-11-23T04:00:00Z"),
  shiftEnd: new Date("2026-11-23T06:00:00Z"),
  startedAt: null,
  completedAt: null,
  locationId: 31,
  location: { companyId: 1, timezone: "Asia/Karachi" },
};
const worker = {
  id: 71,
  locationId: task.locationId,
  companyId: task.location.companyId,
  isActive: true,
  name: "Replacement",
  shiftStart: new Date("2026-11-23T03:00:00Z"),
  shiftEnd: new Date("2026-11-23T07:00:00Z"),
  workDays: ["MON"],
};
const inactiveWorker = { ...worker, id: task.staffId, isActive: false };
const stale = { id: 20, taskInstanceId: task.id, staffId: task.staffId, isCurrent: true, status: "ASSIGNED" };
const current = { ...stale, id: 21, staffId: worker.id };

describe("scheduler assignment reliability", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(now);
    vi.stubEnv("MAX_TASK_REASSIGNMENTS", "3");
    db.$transaction.mockImplementation(work => work(db));
    companyHasFeature.mockResolvedValue(true);
    db.taskInstance.findUnique.mockResolvedValue(task);
    db.taskAssignment.findFirst.mockResolvedValue(null);
    db.taskAssignment.findMany.mockResolvedValue([]);
    db.staff.findFirst.mockImplementation(async ({ where }: { where: Partial<typeof worker> }) =>
      [worker, inactiveWorker].find(staff =>
        Object.entries(where).every(([key, value]) => staff[key as keyof typeof worker] === value)) ?? null);
    db.staff.findMany.mockResolvedValue([worker]);
    db.attendance.findFirst.mockResolvedValue({ status: "CHECKED_IN", checkInTime: worker.shiftStart, checkOutTime: null });
    db.taskAssignment.createMany.mockImplementation(async () => {
      db.taskAssignment.findFirst.mockResolvedValue(current);
      return { count: 1 };
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("assigns an eligible worker on a paid plan when the fixed worker is inactive", async () => {
    await expect(ensureCurrentAssignmentForTask(task.id)).resolves.toEqual(current);

    expect(companyHasFeature).toHaveBeenCalledWith(task.location.companyId, "automaticAssignment");
    expect(db.taskInstance.update).toHaveBeenCalledExactlyOnceWith({ where: { id: task.id }, data: { staffId: worker.id } });
    expect(db.taskAssignment.createMany).toHaveBeenCalledExactlyOnceWith({
      data: [expect.objectContaining({ taskInstanceId: task.id, staffId: worker.id, isCurrent: true })], skipDuplicates: true,
    });
  });

  it("retires a stale current assignment when syncing the task to an eligible worker", async () => {
    db.taskInstance.findMany.mockResolvedValue([{ ...task, assignments: [stale] }]);
    db.taskAssignment.findFirst.mockResolvedValue(stale);

    expect(await ensureAssignmentsForToday()).toBe(1);

    expect(db.taskAssignment.update).toHaveBeenCalledExactlyOnceWith({
      where: { id: stale.id }, data: { status: "CANCELLED", reason: "WORKER_UNAVAILABLE", isCurrent: false },
    });
    expect(db.taskInstance.update).toHaveBeenCalledExactlyOnceWith({ where: { id: task.id }, data: { staffId: worker.id } });
  });

  it("keeps the usable current assignment without invoking automatic assignment", async () => {
    db.taskAssignment.findFirst.mockResolvedValue(current);
    db.taskInstance.findUnique.mockResolvedValue({ ...task, staffId: worker.id });

    await expect(ensureCurrentAssignmentForTask(task.id)).resolves.toEqual(current);

    expect(companyHasFeature).not.toHaveBeenCalled();
    expect(db.taskInstance.update).not.toHaveBeenCalled();
  });

  it("keeps a Starter task unassigned even if a replacement is available", async () => {
    companyHasFeature.mockResolvedValue(false);
    db.taskAssignment.findFirst.mockResolvedValue(stale);

    await expect(ensureCurrentAssignmentForTask(task.id)).resolves.toBeNull();

    expect(db.taskInstance.update).toHaveBeenCalledExactlyOnceWith({ where: { id: task.id }, data: { staffId: null } });
    expect(db.taskAssignment.update).toHaveBeenCalledWith({ where: { id: stale.id }, data: expect.objectContaining({ isCurrent: false }) });
    expect(db.staff.findMany).not.toHaveBeenCalled();
    expect(db.taskAssignment.createMany).not.toHaveBeenCalled();
    expect(db.auditLog.create).not.toHaveBeenCalled();
  });

  it("audits an unassignable paid task once across two runs", async () => {
    db.taskInstance.findUnique.mockResolvedValue({ ...task, staffId: null });
    db.staff.findMany.mockResolvedValue([]);
    db.auditLog.findFirst.mockResolvedValue(null);
    db.auditLog.create.mockImplementation(async () => {
      db.auditLog.findFirst.mockResolvedValue({ id: 1 });
    });

    await expect(ensureCurrentAssignmentForTask(task.id)).resolves.toBeNull();
    await expect(ensureCurrentAssignmentForTask(task.id)).resolves.toBeNull();

    const skipped = { entityType: "TASK_INSTANCE", entityId: task.id, action: "AUTO_ASSIGNMENT_SKIPPED" };
    expect(db.$queryRaw).toHaveBeenCalledTimes(2);
    expect(db.auditLog.findFirst).toHaveBeenLastCalledWith({ where: skipped, select: { id: true } });
    expect(db.auditLog.create).toHaveBeenCalledExactlyOnceWith({ data: expect.objectContaining(skipped) });
  });

  it("logs an assignment failure and counts the next successful task", async () => {
    const next = { ...task, id: 11, assignments: [] };
    const error = new Error("Cannot check the first worker");
    db.staff.findFirst.mockRejectedValueOnce(error);
    db.taskInstance.findMany.mockResolvedValue([{ ...task, assignments: [] }, next]);
    db.taskInstance.findUnique.mockResolvedValue(next);
    const log = vi.spyOn(console, "error").mockImplementation(() => {});

    expect(await ensureAssignmentsForToday()).toBe(1);

    expect(db.taskAssignment.createMany).toHaveBeenCalledExactlyOnceWith({
      data: [expect.objectContaining({ taskInstanceId: next.id })], skipDuplicates: true,
    });
    expect(log).toHaveBeenCalledExactlyOnceWith("Task assignment failed", { taskId: task.id, error });
  });

  it("logs a failed reassignment commit and counts only the next successful transfer", async () => {
    const next = { ...task, id: 11 };
    const error = new Error("Cannot commit the first transfer");
    db.taskAssignment.findMany.mockResolvedValueOnce([
      { ...stale, taskInstance: task }, { ...stale, id: 22, taskInstanceId: next.id, taskInstance: next },
    ]);
    db.taskAssignment.findFirst.mockResolvedValue(stale);
    db.taskAssignment.count.mockResolvedValue(1);
    db.taskAssignment.create.mockResolvedValue(current);
    db.$transaction.mockImplementationOnce(async work => {
      await work(db);
      throw error;
    });
    const log = vi.spyOn(console, "error").mockImplementation(() => {});

    expect(await reassignExpiredAssignments(10)).toEqual({ scanned: 2, reassigned: 1, failedWithoutReplacement: 0 });

    expect(db.taskAssignment.create).toHaveBeenLastCalledWith({ data: expect.objectContaining({ taskInstanceId: next.id }) });
    expect(log).toHaveBeenCalledExactlyOnceWith("Task reassignment failed", { taskId: task.id, error });
  });
});
