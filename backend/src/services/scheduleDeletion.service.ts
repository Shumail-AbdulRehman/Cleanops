import { prisma } from "../prisma/prisma.js";
import { ApiError } from "../utils/ApiError.js";
import { getZonedDayRange } from "../utils/dateTime.js";
import { assertLocationAccess } from "../utils/scope.js";
import { writeAuditLog } from "./auditLog.service.js";

type Actor = {
  id: number;
  companyId: number;
  role: "ADMIN" | "MANAGER" | "STAFF";
  locationIds?: number[];
};

/** Remove operational work, retaining immutable evidence and past task snapshots. */
export async function deleteCleaningSchedule(id: number, actor: Actor, now = new Date()) {
  if (!Number.isSafeInteger(id) || id <= 0) throw new ApiError(400, "Invalid schedule id");
  if (actor.role === "STAFF") throw new ApiError(403, "Manager or owner account required");

  return prisma.$transaction(async tx => {
    const scope = { id, location: { companyId: actor.companyId } };
    const initial = await tx.taskTemplate.findFirst({ where: scope });
    if (!initial) throw new ApiError(404, "Task schedule not found in your company");
    assertLocationAccess(actor, initial.locationId);

    // Match inventory generation's area -> template -> task lock order. A cron
    // that was already running must finish before we select tasks to remove.
    if (initial.areaId) await tx.$queryRaw`SELECT id FROM "Area" WHERE id=${initial.areaId} FOR UPDATE`;
    await tx.$queryRaw`SELECT id FROM "TaskTemplate" WHERE id=${id} FOR UPDATE`;
    const schedule = await tx.taskTemplate.findFirst({ where: scope, include: { location: true } });
    if (!schedule) throw new ApiError(404, "Task schedule not found in your company");
    if (schedule.areaId !== initial.areaId || schedule.locationId !== initial.locationId)
      throw new ApiError(409, "Schedule changed. Refresh before deleting it.");
    const { start } = getZonedDayRange(now, schedule.location.timezone);
    const tasks = await tx.$queryRaw<Array<{ id: number }>>`
      SELECT id FROM "TaskInstance"
      WHERE "templateId"=${id} AND "isActive" AND
        (date >= ${start} OR ("shiftStart" <= ${now} AND "shiftEnd" > ${now}))
      ORDER BY id FOR UPDATE`;
    const taskIds = tasks.map(task => task.id);

    await tx.taskTemplate.update({ where: { id }, data: { isActive: false } });
    if (taskIds.length) {
      await tx.taskInstance.updateMany({
        where: { id: { in: taskIds }, status: { not: "COMPLETED" } },
        data: { isActive: false, status: "CANCELLED", rowVersion: { increment: 1 } },
      });
      // Preserve completed outcomes even when today's instance is removed.
      await tx.taskInstance.updateMany({
        where: { id: { in: taskIds }, status: "COMPLETED" },
        data: { isActive: false, rowVersion: { increment: 1 } },
      });
      await tx.taskAssignment.updateMany({
        where: { taskInstanceId: { in: taskIds }, isCurrent: true, status: { not: "COMPLETED" } },
        data: { status: "CANCELLED", isCurrent: false, failedAt: now, reason: "SCHEDULE_DELETED" },
      });
      await tx.captureSession.updateMany({
        where: { taskInstanceId: { in: taskIds }, state: { in: ["ACTIVE", "PAUSED"] } },
        data: { state: "REVOKED", closedAt: now, rowVersion: { increment: 1 } },
      });
      await tx.verificationIssue.updateMany({
        where: { exception: { taskInstanceId: { in: taskIds } }, state: { not: "RESOLVED" } },
        data: { state: "RESOLVED", resolvedAt: now },
      });
      await tx.verificationException.updateMany({
        where: { taskInstanceId: { in: taskIds }, state: { not: "RESOLVED" } },
        data: { state: "RESOLVED", resolvedAt: now, nextReminderAt: null, rowVersion: { increment: 1 } },
      });
    }
    await writeAuditLog({
      companyId: actor.companyId, actorType: actor.role, actorId: actor.id,
      entityType: "TASK_TEMPLATE", entityId: id, action: "DELETE_SCHEDULE",
      reason: "Remove current and future work while preserving past instances and verification evidence",
      newValue: { isActive: false, removedTaskIds: taskIds, localDayStart: start.toISOString(), timezone: schedule.location.timezone },
    }, tx);
    return { id, isActive: false, removedInstances: taskIds.length, pastInstancesPreserved: true, evidenceRetained: true };
  }, { maxWait: 10_000, timeout: 30_000 });
}
