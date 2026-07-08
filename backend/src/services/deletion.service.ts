import { assertDeletionAllowed } from "./verification-v2/retention.service.js";
import type { Prisma } from "@prisma/client";
import { prisma } from "../prisma/prisma.js";
import { ApiError } from "../utils/ApiError.js";
import { assertLocationAccess } from "../utils/scope.js";
import { deleteCleaningSchedule } from "./scheduleDeletion.service.js";

type Actor = {
  id: number;
  companyId: number;
  role: "ADMIN" | "MANAGER" | "STAFF";
  locationIds?: number[];
};
type Transaction = Omit<
  typeof prisma,
  "$connect" | "$disconnect" | "$on" | "$transaction" | "$use" | "$extends"
>;
type Entity = "location" | "staff" | "manager" | "taskTemplate";

async function queueMedia(tx: Transaction, rows: unknown) {
  const urls = new Set<string>();
  const visit = (value: unknown) => {
    if (typeof value === "string" && /^https?:\/\//.test(value))
      {
      // Private retained assets never enter the destructive legacy outbox.
      if (!value.includes("/verification/")) urls.add(value);
    }
    else if (Array.isArray(value)) value.forEach(visit);
    else if (value && typeof value === "object")
      Object.values(value).forEach(visit);
  };
  visit(rows);
  if (urls.size)
    await tx.deletedMedia.createMany({
      data: [...urls].map((url) => ({ url })),
      skipDuplicates: true,
    });
}

async function queueTemplateMedia(
  tx: Transaction,
  where: Prisma.TaskTemplateWhereInput,
) {
  await queueMedia(
    tx,
    await tx.taskTemplate.findMany({
      where,
      select: {
        referenceImageUrl: true,
        referenceImages: { select: { imageUrl: true } },
      },
    }),
  );
}

// Child evidence, reference images and assignments cascade from task instances.
// AuditLog has no foreign keys, so its links must be cleaned explicitly.
async function deleteTasks(
  tx: Transaction,
  where: Prisma.TaskInstanceWhereInput,
  companyId: number,
) {
  const tasks = await tx.taskInstance.findMany({
    where,
    select: {
      id: true,
      referenceImageUrl: true,
      proofImageUrls: true,
      referenceImages: { select: { imageUrl: true } },
      completionAttempts: { select: { imageUrl: true } },
      areaSubmissions: { select: { photoUrl: true, attempts: true } },
    },
  });
  await queueMedia(tx, tasks);
  const ids = tasks.map((task) => task.id);
  const assignments = await tx.taskAssignment.findMany({
    where: { taskInstanceId: { in: ids } },
    select: { id: true },
  });
  await tx.auditLog.deleteMany({
    where: {
      companyId,
      OR: [
        {
          entityType: { in: ["TaskInstance", "TASK_INSTANCE"] },
          entityId: { in: ids },
        },
        {
          entityType: "TASK_ASSIGNMENT",
          entityId: { in: assignments.map((item) => item.id) },
        },
      ],
    },
  });
  await tx.taskInstance.deleteMany({ where });
}

export async function permanentlyDelete(
  entity: Entity,
  id: number,
  actor: Actor,
) {
  if (!Number.isSafeInteger(id) || id <= 0)
    throw new ApiError(400, "Invalid deletion id");
  if (
    actor.role === "STAFF" ||
    ((entity === "location" || entity === "manager") && actor.role !== "ADMIN")
  ) {
    throw new ApiError(403, "You do not have permission to delete this record");
  }

  if (entity === "taskTemplate") return deleteCleaningSchedule(id, actor);

  await prisma.$transaction(
    async (tx) => {
      const companyId = actor.companyId;
      if (entity === "location") {
        const location = await tx.location.findFirst({
          where: { id, companyId },
        });
        if (!location)
          throw new ApiError(404, "Location not found in your company");
        await assertDeletionAllowed(tx, entity, id);
        await deleteTasks(tx, { locationId: id }, companyId);
        await queueTemplateMedia(tx, { locationId: id });
        await queueMedia(
          tx,
          await tx.attendance.findMany({
            where: { locationId: id },
            select: { checkInImage: true, checkOutImage: true },
          }),
        );
        await tx.taskTemplate.deleteMany({ where: { locationId: id } });
        await tx.attendance.deleteMany({ where: { locationId: id } });
        await tx.staff.updateMany({
          where: { locationId: id },
          data: { locationId: null, shiftStart: null, shiftEnd: null },
        });
        // ManagerLocation cascades; the manager and staff accounts are independent.
        await tx.location.delete({ where: { id, companyId } });
      } else if (entity === "staff") {
        const staff = await tx.staff.findFirst({ where: { id, companyId } });
        if (!staff) throw new ApiError(404, "Staff not found in your company");
        if (actor.role === "MANAGER") {
          if (staff.locationId === null)
            throw new ApiError(
              403,
              "You do not have access to this staff member",
            );
          assertLocationAccess(actor, staff.locationId);
        }
        await assertDeletionAllowed(tx, entity, id);
        const assignments = await tx.taskAssignment.findMany({
          where: { staffId: id },
          select: { id: true, taskInstanceId: true },
        });
        await tx.auditLog.deleteMany({
          where: {
            companyId,
            OR: [
              { actorType: "STAFF", actorId: id },
              {
                entityType: { in: ["TaskInstance", "TASK_INSTANCE"] },
                entityId: {
                  in: assignments.map((item) => item.taskInstanceId),
                },
              },
              {
                entityType: "TASK_ASSIGNMENT",
                entityId: { in: assignments.map((item) => item.id) },
              },
            ],
          },
        });
        await queueMedia(
          tx,
          await tx.attendance.findMany({
            where: { staffId: id },
            select: { checkInImage: true, checkOutImage: true },
          }),
        );
        await queueMedia(
          tx,
          await tx.taskAreaSubmission.findMany({
            where: { staffId: id },
            select: { photoUrl: true, attempts: true },
          }),
        );
        await queueMedia(
          tx,
          await tx.taskCompletionAttempt.findMany({
            where: { staffId: id },
            select: { imageUrl: true },
          }),
        );
        await queueMedia(
          tx,
          await tx.taskInstance.findMany({
            where: { staffId: id },
            select: { proofImageUrls: true },
          }),
        );
        await tx.attendance.deleteMany({ where: { staffId: id } });
        await tx.taskAreaSubmission.deleteMany({ where: { staffId: id } });
        await tx.taskCompletionAttempt.deleteMany({ where: { staffId: id } });
        await tx.taskAssignment.deleteMany({ where: { staffId: id } });
        await tx.taskInstance.updateMany({
          where: { staffId: id, status: { in: ["PENDING", "IN_PROGRESS"] } },
          data: { status: "CANCELLED" },
        });
        await tx.taskInstance.updateMany({
          where: { staffId: id },
          data: { proofImageUrls: [] },
        });
        // Nullable Staff relations on task schedules/history use ON DELETE SET NULL.
        await tx.staff.delete({ where: { id, companyId } });
      } else {
        const manager = await tx.manager.findFirst({
          where: { id, companyId, role: "MANAGER" },
        });
        if (!manager)
          throw new ApiError(404, "Manager not found in your company");
        if (id === actor.id)
          throw new ApiError(400, "You cannot delete your own account");
        await assertDeletionAllowed(tx, entity, id);
        await tx.auditLog.deleteMany({
          where: { companyId, actorType: "MANAGER", actorId: id },
        });
        await tx.manager.delete({ where: { id, companyId, role: "MANAGER" } });
      }
      const entityNames = {
        location: ["LOCATION", "Location"],
        staff: ["STAFF", "Staff"],
        manager: ["MANAGER", "Manager"],
        taskTemplate: ["TASK_TEMPLATE", "TaskTemplate"],
      };
      await tx.auditLog.deleteMany({
        where: {
          companyId,
          entityType: { in: entityNames[entity] },
          entityId: id,
        },
      });
    },
    { isolationLevel: "Serializable" },
  );
}
