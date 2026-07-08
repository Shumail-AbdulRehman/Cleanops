import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { expireVerificationTasks } from "./deadline.service.js";

const mocks = vi.hoisted(() => ({
  tasks: vi.fn(),
  reminders: vi.fn(),
  transaction: vi.fn(),
  jobAccountAllowed: vi.fn(),
  lockTask: vi.fn(),
  finalizeTask: vi.fn(),
  raiseIssue: vi.fn(),
}));

vi.mock("../../prisma/prisma.js", () => ({
  prisma: {
    taskInstance: { findMany: mocks.tasks },
    verificationException: { findMany: mocks.reminders },
    $transaction: mocks.transaction,
  },
}));
vi.mock("../launchJobs.service.js", () => ({ jobAccountAllowed: mocks.jobAccountAllowed }));
vi.mock("./captureSession.service.js", () => ({ lockTask: mocks.lockTask }));
vi.mock("./completion.service.js", () => ({ finalizeTask: mocks.finalizeTask }));
vi.mock("./exception.service.js", () => ({ raiseIssue: mocks.raiseIssue }));

// Wall-clock times in Asia/Karachi.
const now = new Date("2026-11-22T12:00:00+05:00");
const shiftEnd = new Date("2026-11-22T10:00:00+05:00");
const uploadDeadline = new Date("2026-11-22T10:30:00+05:00");
const task = {
  id: 1,
  isActive: true,
  locationId: 2,
  status: "IN_PROGRESS",
  shiftEnd,
  startedAt: new Date("2026-11-22T09:00:00+05:00"),
  uploadDeadline,
  staffSubmittedAt: null,
};
const reviewRequirement = { state: "REVIEW_REQUIRED", currentAttemptId: "photo" };
const receivedReview = {
  id: "photo",
  receivedAt: shiftEnd,
  sessionId: "session",
  session: { contextStatus: "ACCEPTABLE" },
};
const missingRequirement = { state: "MISSING", currentAttemptId: null };

function makeTransaction() {
  return {
    $queryRaw: vi.fn().mockResolvedValue([]),
    taskInstance: {
      findUniqueOrThrow: vi.fn().mockResolvedValue(task),
      update: vi.fn(),
    },
    location: { findUniqueOrThrow: vi.fn().mockResolvedValue({ companyId: 3 }) },
    taskAssignment: { updateMany: vi.fn() },
    taskEvidenceRequirement: { findMany: vi.fn().mockResolvedValue([]) },
    verificationAttempt: { findMany: vi.fn().mockResolvedValue([]) },
    verificationIssue: { findFirst: vi.fn().mockResolvedValue(null) },
    captureSession: { count: vi.fn().mockResolvedValue(0), updateMany: vi.fn() },
    verificationException: { findUniqueOrThrow: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
    exceptionEvent: { upsert: vi.fn() },
  };
}

let tx: ReturnType<typeof makeTransaction>;
beforeEach(() => {
  vi.resetAllMocks();
  tx = makeTransaction();
  mocks.tasks.mockResolvedValue([{ id: task.id }]);
  mocks.reminders.mockResolvedValue([]);
  mocks.transaction.mockImplementation((work) => work(tx));
  mocks.jobAccountAllowed.mockResolvedValue(true);
  mocks.finalizeTask.mockResolvedValue(null);
  mocks.raiseIssue.mockResolvedValue(null);
});

afterEach(() => vi.restoreAllMocks());

describe("verification deadlines", () => {
  it("selects the last seven days and excludes a task that ended eight days ago", async () => {
    const oldestEligible = new Date("2026-11-15T12:00:00+05:00");
    const endedTasks = [
      { id: 10, shiftEnd: new Date("2026-11-14T12:00:00+05:00") },
      { id: 11, shiftEnd: oldestEligible },
      { id: 12, shiftEnd: now },
    ];
    mocks.tasks.mockImplementation(async ({ where: { shiftEnd: range } }) =>
      endedTasks.filter(({ shiftEnd }) => shiftEnd < range.lt && (!range.gte || shiftEnd >= range.gte)),
    );
    tx.taskInstance.findUniqueOrThrow.mockResolvedValue({ ...task, id: 11, shiftEnd: oldestEligible });

    await expireVerificationTasks(now);

    expect(mocks.tasks).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ shiftEnd: { gte: oldestEligible, lt: now } }),
    }));
    expect(mocks.lockTask).toHaveBeenCalledExactlyOnceWith(tx, 11);
  });

  it("skips a recorded missing-evidence outcome on the next run and still tries finalization", async () => {
    tx.taskEvidenceRequirement.findMany.mockResolvedValue([missingRequirement]);
    tx.taskInstance.findUniqueOrThrow.mockResolvedValueOnce(task)
      .mockResolvedValue({ ...task, status: "NOT_COMPLETED_INTIME" });
    tx.verificationIssue.findFirst.mockResolvedValue({ id: 7 });
    mocks.finalizeTask.mockResolvedValueOnce(null).mockResolvedValueOnce(null)
      .mockResolvedValueOnce("VERIFIED_COMPLETE");

    await expireVerificationTasks(now);
    await expireVerificationTasks(now);
    await expireVerificationTasks(now);

    expect(mocks.raiseIssue).toHaveBeenCalledExactlyOnceWith(tx, task.id, "MISSING_EVIDENCE");
    expect(tx.verificationIssue.findFirst).toHaveBeenCalledExactlyOnceWith({
      where: { exception: { taskInstanceId: task.id }, reasonCode: "MISSING_EVIDENCE", requirementId: null },
      select: { id: true },
    });
    expect(tx.taskEvidenceRequirement.findMany).toHaveBeenCalledOnce();
    expect(tx.taskInstance.update).toHaveBeenCalledOnce();
    expect(mocks.finalizeTask).toHaveBeenCalledTimes(3);
    expect(tx.captureSession.updateMany).toHaveBeenCalledTimes(2);
  });

  it("escalates a first missing-evidence outcome at the upload cutoff", async () => {
    tx.taskEvidenceRequirement.findMany.mockResolvedValue([missingRequirement]);
    mocks.raiseIssue.mockResolvedValue({ id: 7 });
    tx.verificationException.updateMany.mockResolvedValue({ count: 1 });

    await expireVerificationTasks(now);

    expect(tx.taskInstance.update).toHaveBeenCalledExactlyOnceWith({
      where: { id: task.id },
      data: { status: "NOT_COMPLETED_INTIME", verificationState: "NEEDS_REVIEW" },
    });
    expect(mocks.raiseIssue).toHaveBeenCalledExactlyOnceWith(tx, task.id, "MISSING_EVIDENCE");
    expect(tx.exceptionEvent.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({ type: "UPLOAD_WINDOW_EXHAUSTED", payload: { missing: 1 } }),
    }));
  });

  it("keeps a task submitted at shift end in review when its photo was received", async () => {
    tx.taskInstance.findUniqueOrThrow.mockResolvedValue({ ...task, staffSubmittedAt: shiftEnd });
    tx.taskEvidenceRequirement.findMany.mockResolvedValue([reviewRequirement]);
    tx.verificationAttempt.findMany.mockResolvedValue([receivedReview]);

    await expireVerificationTasks(now);

    expect(tx.taskInstance.update).not.toHaveBeenCalled();
    expect(mocks.raiseIssue).not.toHaveBeenCalled();
    expect(tx.captureSession.updateMany).toHaveBeenCalledOnce();
  });

  it("still counts a genuinely missing photo on a submitted task", async () => {
    tx.taskInstance.findUniqueOrThrow.mockResolvedValue({ ...task, staffSubmittedAt: shiftEnd });
    tx.taskEvidenceRequirement.findMany.mockResolvedValue([reviewRequirement, missingRequirement]);
    tx.verificationAttempt.findMany.mockResolvedValue([receivedReview]);
    mocks.raiseIssue.mockResolvedValue({ id: 7 });
    tx.verificationException.updateMany.mockResolvedValue({ count: 1 });

    await expireVerificationTasks(now);

    expect(tx.taskInstance.update).not.toHaveBeenCalled();
    expect(mocks.raiseIssue).toHaveBeenCalledExactlyOnceWith(tx, task.id, "MISSING_EVIDENCE");
    expect(tx.exceptionEvent.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({ payload: { missing: 1 } }),
    }));
  });

  it("counts a review requirement with no received attempt as missing", async () => {
    tx.taskEvidenceRequirement.findMany.mockResolvedValue([reviewRequirement]);

    await expireVerificationTasks(now);

    expect(mocks.raiseIssue).toHaveBeenCalledExactlyOnceWith(tx, task.id, "MISSING_EVIDENCE");
  });

  it("applies the cutoff for a late submission without counting its received review photo as missing", async () => {
    tx.taskInstance.findUniqueOrThrow.mockResolvedValue({
      ...task, staffSubmittedAt: new Date("2026-11-22T10:01:00+05:00"),
    });
    tx.taskEvidenceRequirement.findMany.mockResolvedValue([reviewRequirement]);
    tx.verificationAttempt.findMany.mockResolvedValue([receivedReview]);

    await expireVerificationTasks(now);

    expect(tx.taskInstance.update).toHaveBeenCalledExactlyOnceWith({
      where: { id: task.id },
      data: { status: "NOT_COMPLETED_INTIME", verificationState: "PROCESSING" },
    });
    expect(mocks.raiseIssue).not.toHaveBeenCalled();
  });

  it("still marks never-started tasks missed", async () => {
    tx.taskInstance.findUniqueOrThrow.mockResolvedValue({ ...task, startedAt: null, status: "PENDING" });

    await expireVerificationTasks(now);

    expect(tx.taskInstance.update).toHaveBeenCalledExactlyOnceWith({
      where: { id: task.id },
      data: { status: "MISSED", verificationState: "NEEDS_REVIEW" },
    });
    expect(tx.taskAssignment.updateMany).toHaveBeenCalledOnce();
    expect(mocks.raiseIssue).toHaveBeenCalledExactlyOnceWith(tx, task.id, "MISSING_EVIDENCE");
  });

  it("logs a failed task transaction and processes the next task", async () => {
    const error = new Error("Task transaction failed");
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.tasks.mockResolvedValue([{ id: 9 }, { id: task.id }]);
    mocks.transaction.mockRejectedValueOnce(error);

    await expireVerificationTasks(now);

    expect(log).toHaveBeenCalledExactlyOnceWith(expect.any(String), { taskId: 9, error });
    expect(mocks.finalizeTask).toHaveBeenCalledExactlyOnceWith(tx, task.id);
  });
});

describe("verification reminders", () => {
  const suspended = {
    id: 6, companyId: 60, state: "MANAGER_REVIEW", priority: 2,
    nextReminderAt: new Date("2026-11-22T11:00:00+05:00"),
  };
  const active = {
    ...suspended, id: 7, companyId: 70, nextReminderAt: new Date("2026-11-22T11:30:00+05:00"),
  };

  beforeEach(() => {
    mocks.tasks.mockResolvedValue([]);
    mocks.reminders.mockResolvedValue([suspended, active]);
    tx.verificationException.findUniqueOrThrow.mockResolvedValueOnce(suspended).mockResolvedValueOnce(active);
  });

  it("reads due reminders oldest first", async () => {
    await expireVerificationTasks(now);

    expect(mocks.reminders).toHaveBeenCalledExactlyOnceWith({
      where: { state: { not: "RESOLVED" }, nextReminderAt: { lte: now } },
      orderBy: { nextReminderAt: "asc" },
      take: 100,
    });
  });

  it("defers a suspended company's reminder and sends the active company's reminder", async () => {
    mocks.jobAccountAllowed.mockResolvedValueOnce(false);
    const nextReminderAt = new Date("2026-11-22T12:30:00+05:00");
    const rowVersion = { increment: 1 };

    await expireVerificationTasks(now);

    expect(tx.verificationException.update).toHaveBeenNthCalledWith(1, {
      where: { id: suspended.id }, data: { nextReminderAt, rowVersion },
    });
    expect(tx.verificationException.update).toHaveBeenNthCalledWith(2, {
      where: { id: active.id }, data: { nextReminderAt, priority: 3, rowVersion },
    });
    expect(tx.exceptionEvent.upsert).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      create: expect.objectContaining({ exceptionId: active.id, type: "REMINDER" }),
    }));
  });

  it("logs a failed reminder transaction and processes the next reminder", async () => {
    const error = new Error("Reminder transaction failed");
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.transaction.mockRejectedValueOnce(error);
    tx.verificationException.findUniqueOrThrow.mockReset().mockResolvedValue(active);

    await expireVerificationTasks(now);

    expect(log).toHaveBeenCalledExactlyOnceWith(expect.any(String), { reminderId: suspended.id, error });
    expect(tx.exceptionEvent.upsert).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      create: expect.objectContaining({ exceptionId: active.id, type: "REMINDER" }),
    }));
  });
});
