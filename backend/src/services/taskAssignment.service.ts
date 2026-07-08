import { jobAccountAllowed } from './launchJobs.service.js';
import { prisma } from "../prisma/prisma.js";
import { fitsStaffShift } from "../utils/scheduleFit.js";
import { worksCoveringShift } from "../utils/workDays.js";
import { writeAuditLog } from "./auditLog.service.js";
import { companyHasFeature } from "./subscription.service.js";

type DbClient = typeof prisma;

type TaskForAssignment = {
  id: number;
  title: string;
  date: Date;
  shiftStart: Date;
  shiftEnd: Date;
  status: string;
  isActive: boolean;
  startedAt: Date | null;
  completedAt: Date | null;
  staffId: number | null;
  locationId: number;
  location: {
    companyId: number;
    timezone: string;
  };
};

const taskWindowsOverlap = (
  firstStart: Date,
  firstEnd: Date,
  secondStart: Date,
  secondEnd: Date
) => firstStart < secondEnd && secondStart < firstEnd;

const getTaskWithCompany = async (taskInstanceId: number, client: DbClient = prisma) => {
  return client.taskInstance.findUnique({
    where: { id: taskInstanceId },
    include: {
      location: {
        select: {
          companyId: true,
          timezone: true,
        },
      },
    },
  });
};

const mapTaskStatusToAssignmentStatus = (status: string) => {
  if (status === "IN_PROGRESS") return "STARTED";
  if (status === "COMPLETED") return "COMPLETED";
  if (status === "MISSED" || status === "NOT_COMPLETED_INTIME") return "MISSED";
  if (status === "CANCELLED") return "CANCELLED";
  return "ASSIGNED";
};

const isTaskAssignable = (task: TaskForAssignment) =>
  task.isActive && ["PENDING", "IN_PROGRESS"].includes(task.status);

const getCurrentAssignment = async (taskInstanceId: number, client: DbClient = prisma) => {
  return client.taskAssignment.findFirst({
    where: {
      taskInstanceId,
      isCurrent: true,
    },
    orderBy: { assignedAt: "desc" },
  });
};

const isUsableWorker = async (staffId: number, task: TaskForAssignment, client: Pick<DbClient, "staff"> = prisma) => {
  const worker = await client.staff.findFirst({
    where: { id: staffId, isActive: true, locationId: task.locationId, companyId: task.location.companyId },
    select: { id: true },
  });
  return Boolean(worker);
};

const getAttendanceForTaskWindow = async (
  staffId: number,
  task: TaskForAssignment,
  client: DbClient = prisma
) => {
  return client.attendance.findFirst({
    where: {
      staffId,
      expectedStart: { lte: task.shiftEnd },
      expectedEnd: { gte: task.shiftStart },
    },
    orderBy: { expectedStart: "desc" },
  });
};

const isAttendanceEligible = async (
  staffId: number,
  task: TaskForAssignment,
  now: Date,
  client: DbClient = prisma
) => {
  const attendance = await getAttendanceForTaskWindow(staffId, task, client);

  if (!attendance) {
    return now < task.shiftStart;
  }

  if (attendance.status === "CHECKED_OUT" && attendance.checkOutTime && attendance.checkOutTime <= task.shiftStart) {
    return false;
  }

  if (now >= task.shiftStart) {
    return (
      !!attendance.checkInTime &&
      !attendance.checkOutTime &&
      ["CHECKED_IN", "LATE", "MISSED_CHECKOUT"].includes(attendance.status)
    );
  }

  return attendance.status !== "CHECKED_OUT";
};

const getStaffWorkloadScore = async (
  staffId: number,
  task: TaskForAssignment,
  client: DbClient = prisma
) => {
  const currentAssignments = await client.taskAssignment.findMany({
    where: {
      staffId,
      isCurrent: true,
      status: { in: ["ASSIGNED", "STARTED"] },
      taskInstance: {
        date: task.date,
        isActive: true,
      },
    },
    include: {
      taskInstance: {
        select: {
          id: true,
          shiftStart: true,
          shiftEnd: true,
        },
      },
    },
  });

  const hasOverlap = currentAssignments.some((assignment) =>
    assignment.taskInstance.id !== task.id &&
    taskWindowsOverlap(
      assignment.taskInstance.shiftStart,
      assignment.taskInstance.shiftEnd,
      task.shiftStart,
      task.shiftEnd
    )
  );

  if (hasOverlap) return null;

  return currentAssignments.length;
};

export const findBestStaffForTask = async (
  task: TaskForAssignment,
  options: { excludeStaffIds?: number[]; now?: Date; client?: DbClient } = {}
) => {
  const client = options.client ?? prisma;
  const now = options.now ?? new Date();
  const excludeStaffIds = options.excludeStaffIds ?? [];
  const { timezone: timeZone } = task.location;

  const staffMembers = await client.staff.findMany({
    where: {
      companyId: task.location.companyId,
      locationId: task.locationId,
      isActive: true,
      id: excludeStaffIds.length ? { notIn: excludeStaffIds } : undefined,
      shiftStart: { not: null },
      shiftEnd: { not: null },
    },
    select: {
      id: true,
      name: true,
      shiftStart: true,
      shiftEnd: true,
      workDays: true,
    },
    orderBy: { id: "asc" },
  });

  const candidates = [];

  for (const staff of staffMembers) {
    const { shiftStart, shiftEnd, workDays } = staff;
    if (!shiftStart || !shiftEnd || !fitsStaffShift(task, staff, timeZone)) {
      continue;
    }
    if (!worksCoveringShift({ shiftStart, shiftEnd, instant: task.shiftStart, timeZone, workDays })) {
      continue;
    }

    const attendanceEligible = await isAttendanceEligible(staff.id, task, now, client);
    if (!attendanceEligible) {
      continue;
    }

    const workloadScore = await getStaffWorkloadScore(staff.id, task, client);
    if (workloadScore === null) {
      continue;
    }

    candidates.push({
      staff,
      score: workloadScore,
    });
  }

  candidates.sort((a, b) => a.score - b.score || a.staff.id - b.staff.id);

  return candidates[0]?.staff ?? null;
};

export const ensureCurrentAssignmentForTask = async (
  taskInstanceId: number,
  reason = "SCHEDULER_SYNC"
) => {
  const task = await getTaskWithCompany(taskInstanceId);
  if (!task || !isTaskAssignable(task)) {
    return null;
  }

  const existing = await getCurrentAssignment(taskInstanceId);
  return ensureAssignmentForTask(task, reason, existing);
};

const ensureAssignmentForTask = async (
  task: TaskForAssignment,
  reason: string,
  existing: Awaited<ReturnType<typeof getCurrentAssignment>>,
) => {
  if (existing && await isUsableWorker(existing.staffId, task)) return existing;
  if (!await jobAccountAllowed(task.location.companyId,'MANAGE_WORK')) return null;

  let staffId = task.staffId;
  if (staffId !== null && (staffId === existing?.staffId || !await isUsableWorker(staffId, task))) {
    staffId = null;
  }
  const automaticAssignmentEnabled = staffId === null &&
    await companyHasFeature(task.location.companyId, "automaticAssignment");
  if (!automaticAssignmentEnabled && task.staffId === null && !existing) return null;
  if (automaticAssignmentEnabled) staffId = (await findBestStaffForTask(task))?.id ?? null;

  try {
    return await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "TaskInstance" WHERE id=${task.id} FOR UPDATE`;
      const fresh = await getTaskWithCompany(task.id, tx as DbClient);
      if (!fresh || !isTaskAssignable(fresh) || fresh.staffId !== task.staffId || fresh.locationId !== task.locationId) return null;
      if (!await jobAccountAllowed(fresh.location.companyId, 'MANAGE_WORK', tx)) return null;
      const current = await getCurrentAssignment(task.id, tx as DbClient);
      if (current && await isUsableWorker(current.staffId, fresh, tx)) return current;
      if (staffId !== null && !await isUsableWorker(staffId, fresh, tx)) return null;
      if (fresh.staffId !== null && fresh.staffId !== staffId && fresh.staffId !== current?.staffId &&
        await isUsableWorker(fresh.staffId, fresh, tx)) return null;

      if (current) {
        await tx.taskAssignment.update({
          where: { id: current.id },
          data: { status: "CANCELLED", reason: "WORKER_UNAVAILABLE", isCurrent: false },
        });
      }

      if (fresh.staffId !== staffId) {
        await tx.taskInstance.update({
          where: { id: task.id },
          data: { staffId },
        });
      }

      if (staffId === null) {
        if (automaticAssignmentEnabled) {
          const skipped = { entityType: "TASK_INSTANCE", entityId: task.id, action: "AUTO_ASSIGNMENT_SKIPPED" };
          const previous = await tx.auditLog.findFirst({ where: skipped, select: { id: true } });
          if (!previous) {
            await writeAuditLog({
              ...skipped,
              companyId: fresh.location.companyId,
              actorType: "SYSTEM",
              reason: "NO_ELIGIBLE_STAFF",
              newValue: { taskInstanceId: task.id },
            }, tx);
          }
        }
        return null;
      }

      const createResult = await tx.taskAssignment.createMany({
        data: [{
          taskInstanceId: task.id,
          staffId,
          status: mapTaskStatusToAssignmentStatus(fresh.status),
          reason,
          isCurrent: true,
          startedAt: fresh.status === "IN_PROGRESS" ? fresh.startedAt : null,
          completedAt: fresh.status === "COMPLETED" ? fresh.completedAt : null,
        }],
        skipDuplicates: true,
      });

      const assignment = await getCurrentAssignment(task.id, tx as DbClient);
      if (!assignment) {
        return null;
      }

      if (createResult.count > 0) {
        await writeAuditLog(
          {
            companyId: task.location.companyId,
            actorType: "SYSTEM",
            entityType: "TASK_ASSIGNMENT",
            entityId: assignment.id,
            action: "ASSIGNMENT_CREATED",
            reason,
            newValue: {
              taskInstanceId: task.id,
              staffId,
              status: assignment.status,
            },
          },
          tx as DbClient
        );
      }

      return assignment;
    });
  } catch (error) {
    const current = await getCurrentAssignment(task.id);
    if (current && await isUsableWorker(current.staffId, task)) {
      return current;
    }
    throw error;
  }
};

export const ensureAssignmentsForToday = async () => {
  const now = new Date();
  const tasks = await prisma.taskInstance.findMany({
    where: {
      isActive: true,
      status: { in: ["PENDING", "IN_PROGRESS"] },
      shiftEnd: { gte: now },
    },
    include: {
      location: {
        select: {
          companyId: true,
          timezone: true,
        },
      },
      assignments: {
        where: { isCurrent: true },
        orderBy: { assignedAt: "desc" },
      },
    },
  });

  let ensured = 0;

  for (const task of tasks) {
    try {
      const assignment = await ensureAssignmentForTask(task, "SCHEDULER_SYNC", task.assignments[0] ?? null);
      if (assignment) ensured += 1;
    } catch (error) {
      console.error("Task assignment failed", { taskId: task.id, error });
    }
  }

  return ensured;
};

export const markCurrentAssignmentStarted = async (
  taskInstanceId: number,
  staffId: number,
  startedAt: Date,
  client: DbClient = prisma
) => {
  await client.taskAssignment.updateMany({
    where: {
      taskInstanceId,
      staffId,
      isCurrent: true,
      status: "ASSIGNED",
    },
    data: {
      status: "STARTED",
      startedAt,
    },
  });
};

export const markCurrentAssignmentCompleted = async (
  taskInstanceId: number,
  staffId: number,
  completedAt: Date,
  client: DbClient = prisma
) => {
  await client.taskAssignment.updateMany({
    where: {
      taskInstanceId,
      taskInstance: { OR: [{verificationVersion:1},{verificationVersion:2,status:"COMPLETED"}] },
      staffId,
      isCurrent: true,
      status: { in: ["ASSIGNED", "STARTED"] },
    },
    data: {
      status: "COMPLETED",
      completedAt,
      isCurrent: false,
    },
  });
};

export const markCurrentAssignmentsForTasks = async (
  taskInstanceIds: number[],
  status: "MISSED" | "CANCELLED" | "FAILED",
  reason: string,
  client: DbClient = prisma
) => {
  if (taskInstanceIds.length === 0) return;

  await client.taskAssignment.updateMany({
    where: {
      taskInstanceId: { in: taskInstanceIds },
      taskInstance: {location:{company:{isActive:true,operationalStatus:"ACTIVE"}}},
      isCurrent: true,
      status: { in: ["ASSIGNED", "STARTED"] },
    },
    data: {
      status,
      reason,
      failedAt: new Date(),
      isCurrent: false,
    },
  });
};

export const reassignExpiredAssignments = async (graceMinutes: number) => {
  const now = new Date();
  const graceCutoff = new Date(now.getTime() - graceMinutes * 60 * 1000);
  const maxReassignments = Number.parseInt(process.env.MAX_TASK_REASSIGNMENTS ?? "", 10);
  const reassignmentLimit = Number.isFinite(maxReassignments) && maxReassignments >= 0
    ? maxReassignments
    : 3;

  const expiredAssignments = await prisma.taskAssignment.findMany({
    where: {
      isCurrent: true,
      status: "ASSIGNED",
      // A late manager assignment still gets the configured time to start.
      assignedAt: { lt: graceCutoff },
      taskInstance: {
        isActive: true,
        status: "PENDING",
        shiftStart: { lt: graceCutoff },
        shiftEnd: { gt: now },
      },
    },
    include: {
      taskInstance: {
        include: {
          location: {
            select: { companyId: true, timezone: true },
          },
        },
      },
    },
    orderBy: { assignedAt: "asc" },
  });

  let reassigned = 0;
  let failedWithoutReplacement = 0;

  for (const assignment of expiredAssignments) {
    const task = assignment.taskInstance;
    try {
      const automaticReassignmentEnabled = await companyHasFeature(
        task.location.companyId,
        "automaticReassignment"
      );
      if (!automaticReassignmentEnabled) continue;

      const previousAssignmentCount = await prisma.taskAssignment.count({
        where: { taskInstanceId: task.id },
      });
      const hasReachedLimit = Math.max(previousAssignmentCount - 1, 0) >= reassignmentLimit;

      if (hasReachedLimit) {
        // Stop transferring the task, but keep it visible to its current worker.
        failedWithoutReplacement += 1;
        continue;
      }

      const replacement = await findBestStaffForTask(task, {
        excludeStaffIds: [assignment.staffId],
        now,
      });

      // A missed start is not a cancellation. Keep the current worker's task
      // until a replacement can take it or the task's actual end window passes.
      if (!replacement) {
        failedWithoutReplacement += 1;
        continue;
      }

      const transferred = await prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM "TaskInstance" WHERE id=${task.id} FOR UPDATE`;
        if (!await jobAccountAllowed(task.location.companyId,'MANAGE_WORK',tx,now)) return false;
        const stillCurrent = await tx.taskAssignment.findFirst({
          where: {
            id: assignment.id,
            isCurrent: true,
            status: "ASSIGNED",
            taskInstance: {
              status: "PENDING",
            },
          },
        });

        if (!stillCurrent) {
          return false;
        }

        await tx.taskAssignment.update({
          where: { id: assignment.id },
          data: {
            status: "REASSIGNED",
            reason: "MISSED_START_GRACE_PERIOD",
            failedAt: now,
            isCurrent: false,
          },
        });

        const newAssignment = await tx.taskAssignment.create({
          data: {
            taskInstanceId: task.id,
            staffId: replacement.id,
            status: "ASSIGNED",
            reason: "AUTO_REASSIGNED_AFTER_MISSED_START",
            isCurrent: true,
          },
        });

        await tx.taskInstance.update({
          where: { id: task.id },
          data: { staffId: replacement.id },
        });

        await writeAuditLog(
          {
            companyId: task.location.companyId,
            actorType: "SYSTEM",
            entityType: "TASK_ASSIGNMENT",
            entityId: newAssignment.id,
            action: "TASK_REASSIGNED",
            reason: "MISSED_START_GRACE_PERIOD",
            oldValue: { assignmentId: assignment.id, staffId: assignment.staffId },
            newValue: { assignmentId: newAssignment.id, staffId: replacement.id },
          },
          tx as DbClient
        );
        return true;
      });
      if (transferred) reassigned += 1;
    } catch (error) {
      console.error("Task reassignment failed", { taskId: task.id, error });
    }
  }

  return {
    scanned: expiredAssignments.length,
    reassigned,
    failedWithoutReplacement,
  };
};
