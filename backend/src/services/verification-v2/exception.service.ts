import { reviewableMedia } from "./evidenceBuffer.js";
import { z } from "zod";
import type { VerificationTransaction } from "./transaction.js";
import { prisma } from "../../prisma/prisma.js";
import { ApiError } from "../../utils/ApiError.js";
import {
  requireTaskAccess,
  requireLocationAccess,
  requireOperationalRole,
  type VerificationActor,
} from "./authorization.service.js";
import { decisionRequestSchema } from "./contracts.js";
import {
  resolvePolicy,
  reasonInstructions,
} from "./verificationPolicy.service.js";
import { sha256 } from "./quality.service.js";
import { lockTask } from "./captureSession.service.js";
import { finalizeTask } from "./completion.service.js";
import { writeAuditLog } from "../auditLog.service.js";
export const GLOBAL_BLOCKING_REASONS = [
  "PRIVACY_HOLD",
  "DUPLICATE_EVIDENCE",
  "STALE_ASSIGNMENT",
  "SERVICE_FAILURE",
];
export async function refreshCase(tx: VerificationTransaction, id: number) {
  const issues = await tx.verificationIssue.findMany({
    where: { exceptionId: id, state: { not: "RESOLVED" } },
  });
  const state = issues.some(
    (i) => i.state === "MANAGER_REVIEW" || i.state === "OPEN",
  )
    ? "MANAGER_REVIEW"
    : issues.some((i) => i.state === "STAFF_ACTION_REQUIRED")
      ? "STAFF_ACTION_REQUIRED"
      : issues.length
        ? "WAITING_SERVICE"
        : "RESOLVED";
  const c = await tx.verificationException.findUniqueOrThrow({ where: { id } });
  if (c.state !== state)
    await tx.verificationException.update({
      where: { id },
      data: {
        state,
        resolvedAt: state === "RESOLVED" ? new Date() : null,
        nextReminderAt:
          state === "RESOLVED"
            ? null
            : (c.nextReminderAt ?? new Date(Date.now() + 1800000)),
        rowVersion: { increment: 1 },
      },
    });
  return state;
}
export async function raiseIssue(
  tx: VerificationTransaction,
  taskId: number,
  reasonCode: string,
  requirementId: string | null = null,
  attemptId: string | null = null,
) {
  // Wrong objects are discarded and corrected by staff, including repeated retakes.
  if (reasonCode === 'WRONG_ITEM') return null;
  await lockTask(tx, taskId);
  const task = await tx.taskInstance.findUniqueOrThrow({
    where: { id: taskId },
    include: { location: true },
  });
  if (
    requirementId &&
    !(await tx.taskEvidenceRequirement.findFirst({
      where: { id: requirementId, item: { taskInstanceId: taskId } },
    }))
  )
    throw new ApiError(404, "Requirement not found");
  if (
    attemptId &&
    !(await tx.verificationAttempt.findFirst({
      where: {
        id: attemptId,
        session: { taskInstanceId: taskId },
        ...(requirementId ? { requirementId } : {}),
      },
    }))
  )
    throw new ApiError(404, "Attempt not found");
  // A manager's case-level disposition is final for the same missing-photo
  // condition. Deadline polling must not put an already handled task back in queue.
  if (['MISSING_EVIDENCE','OCCUPIED'].includes(reasonCode) && !attemptId && await tx.verificationDecision.findFirst({
    where: {exception: {taskInstanceId: taskId, state: 'RESOLVED'}, action: {in: ['RESOLVE_REVIEW','RECORD_PERFORMANCE_ISSUE']}}, select: {id: true},
  })) return null;
  const ordinary =
    [
      "CLEANING_REQUIRED",
      "CANNOT_ASSESS",
      "MISSING_SURFACE",
      "PHOTO_TOO_DARK",
      "PHOTO_BLURRY",
      "PHOTO_TOO_SMALL",
      "IDENTITY_UNCERTAIN",
    ].includes(reasonCode) && !!requirementId;
  if (ordinary) {
    const policy = resolvePolicy(task.policySnapshot),
      cleaning = reasonCode === "CLEANING_REQUIRED";
    const failures = await tx.verificationAttempt.count({
      where: {
        requirementId,
        state: cleaning ? "CLEANING_REQUIRED" : "RECAPTURE_REQUIRED",
      },
    });
    if (
      attemptId &&
      failures > 0 &&
      failures <
        (cleaning
          ? policy.cleaningFailuresBeforeEscalation
          : policy.recaptureFailuresBeforeEscalation)
    ) {
      await tx.taskInstance.updateMany({
        where: { id: taskId, status: { not: "COMPLETED" } },
        data: { verificationState: "REWORK_REQUIRED" },
      });
      // No inbox/event for ordinary first failures. Existing escalated issues remain reviewable.
      const existing = await tx.verificationException.findUnique({
        where: { taskInstanceId: taskId },
      });
      if (existing) return existing;
      return null;
    }
  }
  const mapping = await tx.managerLocation.findFirst({
    where: { locationId: task.locationId, manager: { isActive: true } },
    select: { managerId: true },
  });
  const c = await tx.verificationException.upsert({
    where: { taskInstanceId: taskId },
    create: {
      companyId: task.location.companyId,
      locationId: task.locationId,
      areaId: task.areaId,
      taskInstanceId: taskId,
      dedupeKey: `task:${taskId}`,
      state: "MANAGER_REVIEW",
      priority: 2,
      assignedManagerId: mapping?.managerId,
      nextReminderAt: new Date(Date.now() + 1800000),
    },
    update: { assignedManagerId: mapping?.managerId ?? null },
  });
  const dedupeKey = `${requirementId ?? "task"}:${reasonCode}`;
  const prior = await tx.verificationIssue.findUnique({
    where: { exceptionId_dedupeKey: { exceptionId: c.id, dedupeKey } },
  });
  if (prior?.latestAttemptId === attemptId && prior.state !== "RESOLVED")
    return c;
  const issue = await tx.verificationIssue.upsert({
    where: { exceptionId_dedupeKey: { exceptionId: c.id, dedupeKey } },
    create: {
      exceptionId: c.id,
      dedupeKey,
      requirementId,
      reasonCode,
      state: "MANAGER_REVIEW",
      firstAttemptId: attemptId,
      latestAttemptId: attemptId,
      recommendedAction: reasonInstructions[reasonCode] ?? "Review this task.",
    },
    update: {
      state: "MANAGER_REVIEW",
      latestAttemptId: attemptId,
      occurrences: { increment: 1 },
      lastSeenAt: new Date(),
      resolvedAt: null,
    },
  });
  await tx.verificationException.update({
    where: { id: c.id },
    data: {
      state: "MANAGER_REVIEW",
      resolvedAt: null,
      nextReminderAt: c.nextReminderAt ?? new Date(Date.now() + 1800000),
      rowVersion: { increment: 1 },
    },
  });
  // A further failed image increments occurrence history without another alert.
  if (!prior || prior.state !== "MANAGER_REVIEW")
    await tx.exceptionEvent.upsert({
      where: { dedupeKey: `issue:${issue.id}:${issue.occurrences}` },
      create: {
        exceptionId: c.id,
        type: prior ? "ISSUE_REOPENED" : "ISSUE_RAISED",
        dedupeKey: `issue:${issue.id}:${issue.occurrences}`,
        payload: { issueId: issue.id, reasonCode, requirementId },
      },
      update: {},
    });
  if (task.status !== "COMPLETED")
    await tx.taskInstance.update({
      where: { id: taskId },
      data: { verificationState: "NEEDS_REVIEW" },
    });
  return tx.verificationException.findUniqueOrThrow({ where: { id: c.id } });
}
export async function caseAccess(
  actor: VerificationActor,
  id: number,
  tx: VerificationTransaction = prisma,
) {
  requireOperationalRole(actor);
  const c = await tx.verificationException.findFirst({
    where: { id, companyId: actor.companyId },
  });
  if (!c) throw new ApiError(404, "Case not found");
  await requireLocationAccess(actor, c.locationId, tx);
  return c;
}
const managerInputSchema = decisionRequestSchema.extend({
  extensionMinutes: z.number().int().min(1).max(120).optional(),
  followUpTaskInstanceId: z.number().int().positive().optional(),
});
export async function resolveCompletedConcern(
  tx: VerificationTransaction,
  actor: VerificationActor,
  c: { id: number; taskInstanceId: number | null },
  input: z.infer<typeof managerInputSchema>,
  readOnly = false,
) {
  if (
    input.action !== "RESOLVE_ISSUE" ||
    !input.followUpTaskInstanceId ||
    !input.issueId
  )
    throw new ApiError(
      409,
      "Completed concerns require issue resolution through a completed follow-up task",
    );
  const original = await requireTaskAccess(actor, c.taskInstanceId!, {}, tx);
  const followUp = await requireTaskAccess(
    actor,
    input.followUpTaskInstanceId,
    {},
    tx,
  );
  if (
    followUp.id === original.id ||
    followUp.locationId !== original.locationId ||
    !original.areaId ||
    followUp.areaId !== original.areaId ||
    followUp.verificationVersion !== 2 ||
    followUp.status !== "COMPLETED" ||
    !followUp.completedAt
  )
    throw new ApiError(
      422,
      "Follow-up must be a different completed inventory task in the same location and area",
    );
  const issue = await tx.verificationIssue.findFirst({
    where: { id: input.issueId, exceptionId: c.id },
  });
  if (!issue) throw new ApiError(404, "Issue not found");
  if (issue.state === "RESOLVED")
    throw new ApiError(409, "Issue is already resolved");
  if (input.requirementId && input.requirementId !== issue.requirementId)
    throw new ApiError(422, "Issue and requirement do not match");
  if (!followUp.startedAt || followUp.startedAt < issue.firstSeenAt)
    throw new ApiError(
      422,
      "Follow-up must start after the concern was raised",
    );
  const source = issue.requirementId
    ? await tx.taskEvidenceRequirement.findFirst({
        where: {
          id: issue.requirementId,
          item: { taskInstanceId: original.id },
        },
        include: { item: true },
      })
    : null;
  if (issue.requirementId && !source)
    throw new ApiError(404, "Original requirement not found");
  const acceptedRequirements = await tx.taskEvidenceRequirement.findMany({
    where: {
      item: {
        taskInstanceId: followUp.id,
        ...(source
          ? { sourceAreaItemId: source.item.sourceAreaItemId }
          : { mandatory: true }),
      },
      state: { in: ["PASSED", "MANAGER_ACCEPTED"] },
      ...(source ? { viewKey: source.viewKey } : { mandatory: true }),
    },
  });
  const contributingIds = acceptedRequirements
    .map((r) => r.currentAttemptId)
    .filter((id): id is string => !!id);
  const contributing = await tx.verificationAttempt.findMany({
    where: {
      id: { in: contributingIds },
      session: { taskInstanceId: followUp.id },
      receivedAt: { not: null },
      media: { privacyState: { in: ["SAFE", "NOT_REQUIRED"] } },
    },
    include: { media: true, session: true },
  });
  const previous = issue.latestAttemptId
    ? await tx.verificationAttempt.findFirst({
        where: {
          id: issue.latestAttemptId,
          session: { taskInstanceId: original.id },
        },
        include: { media: true },
      })
    : null;
  let candidates = contributing;
  if (!source) {
    const overrides = await tx.verificationDecision.findMany({
      where: {
        exception: { taskInstanceId: followUp.id },
        action: "ACCEPT_CONTEXT",
      },
      select: { evidenceAttemptId: true },
    });
    candidates = await tx.verificationAttempt.findMany({
      where: {
        sessionId: { in: contributing.map((a) => a.sessionId) },
        session: { taskInstanceId: followUp.id },
        contextKey: previous?.contextKey ?? { not: null },
        receivedAt: { not: null },
        media: { privacyState: { in: ["SAFE", "NOT_REQUIRED"] } },
        OR: [
          { state: "PASSED", session: { contextStatus: "ACCEPTABLE" } },
          {
            id: {
              in: overrides
                .map((d) => d.evidenceAttemptId)
                .filter((id): id is string => !!id),
            },
          },
        ],
      },
      include: { media: true, session: true },
    });
  }
  const replacement = candidates.find(
    (a) =>
      (!input.evidenceAttemptId || a.id === input.evidenceAttemptId) &&
      !!a.receivedAt &&
      a.receivedAt >= issue.firstSeenAt &&
      a.claimedCapturedAt >= issue.firstSeenAt &&
      a.id !== issue.latestAttemptId &&
      a.mediaAssetId !== previous?.mediaAssetId &&
      (!previous?.media ||
        (a.media?.sha256 !== previous.media.sha256 &&
          (!previous.media.normalizedHash ||
            a.media?.normalizedHash !== previous.media.normalizedHash))) &&
      (!source ||
        acceptedRequirements.some(
          (r) => r.id === a.requirementId && r.currentAttemptId === a.id,
        )),
  );
  if (!replacement)
    throw new ApiError(
      422,
      "Safe received accepted replacement evidence for the affected fixture/view or contributing context is required",
    );
  if (
    await tx.verificationJob.count({
      where: {
        attemptId: replacement.id,
        stage: { in: ["PHOTO", "QUALITY", "PRIVACY", "COVERAGE"] },
        state: { in: ["PENDING", "RUNNING", "RETRY_WAIT"] },
      },
    })
  )
    throw new ApiError(409, "Replacement safety checks are pending");
  if (readOnly) return replacement;
  const decision = await tx.verificationDecision.create({
    data: {
      exceptionId: c.id,
      issueId: issue.id,
      requirementId: issue.requirementId,
      action: input.action,
      reasonCode: input.reasonCode,
      note: input.note,
      actorManagerId: actor.id,
      evidenceAttemptId: replacement.id,
      followUpTaskInstanceId: followUp.id,
      expectedDecisionVersion: input.expectedVersion,
    },
  });
  await tx.verificationIssue.update({
    where: { id: issue.id },
    data: { state: "RESOLVED", resolvedAt: new Date() },
  });
  await tx.verificationException.update({
    where: { id: c.id },
    data: { rowVersion: { increment: 1 } },
  });
  await tx.exceptionEvent.create({
    data: {
      exceptionId: c.id,
      type: "FOLLOW_UP_RESOLVED",
      dedupeKey: `decision:${decision.id}`,
      payload: {
        decisionId: decision.id,
        issueId: issue.id,
        followUpTaskInstanceId: followUp.id,
        evidenceAttemptId: replacement.id,
      },
    },
  });
  await writeAuditLog(
    {
      companyId: actor.companyId,
      actorType: actor.role,
      actorId: actor.id,
      entityType: "TASK_INSTANCE",
      entityId: original.id,
      action: "FOLLOW_UP_ISSUE_RESOLVED",
      reason: input.reasonCode,
      newValue: {
        decisionId: decision.id,
        issueId: issue.id,
        followUpTaskInstanceId: followUp.id,
        evidenceAttemptId: replacement.id,
      },
    },
    tx,
  );
  await refreshCase(tx, c.id);
  return decision;
}
export async function managerDecision(
  actor: VerificationActor,
  id: number,
  raw: unknown,
) {
  const input = managerInputSchema.parse(raw);
  return prisma.$transaction(async (tx) => {
    let c = await caseAccess(actor, id, tx);
    if (!c.taskInstanceId)
      throw new ApiError(409, "Setup cases require inventory configuration");
    if (input.action === "MARK_MAINTENANCE") {
      if (!c.areaId) throw new ApiError(409, "Case has no area");
      await tx.$queryRaw`SELECT id FROM "Area" WHERE id=${c.areaId} FOR UPDATE`;
    }
    if (input.followUpTaskInstanceId)
      await requireTaskAccess(actor, input.followUpTaskInstanceId, {}, tx);
    for (const taskId of [
      ...new Set([
        c.taskInstanceId,
        ...(input.followUpTaskInstanceId ? [input.followUpTaskInstanceId] : []),
      ]),
    ].sort((a, b) => a - b))
      await lockTask(tx, taskId);
    await tx.$queryRaw`SELECT id FROM "VerificationException" WHERE id=${id} FOR UPDATE`;
    c = await caseAccess(actor, id, tx);
    if (['REQUEST_RECAPTURE','REQUEST_CLEANING','REJECT_EVIDENCE','EXTEND_WINDOW'].includes(input.action))
      throw new ApiError(410, 'Photo requests are no longer available. Resolve the review or record a staff performance issue.');
    const key = {
        companyId: actor.companyId,
        actorRole: actor.role,
        actorId: actor.id,
        operation: `decision:${id}`,
        requestId: input.requestId,
      },
      bodyHash = sha256(JSON.stringify(input)),
      prior = await tx.verificationRequest.findUnique({
        where: { companyId_actorRole_actorId_operation_requestId: key },
      });
    if (prior) {
      if (prior.bodyHash !== bodyHash)
        throw new ApiError(409, "Request changed");
      return tx.verificationDecision.findUniqueOrThrow({
        where: { id: Number(prior.resultEntityId) },
      });
    }
    if (c.rowVersion !== input.expectedVersion)
      throw new ApiError(409, "Case changed. Refresh.");
    const task = await requireTaskAccess(actor, c.taskInstanceId!, {}, tx);
    if (task.status === "COMPLETED" && task.verificationVersion === 2) {
      const decision = await resolveCompletedConcern(tx, actor, c, input);
      await tx.verificationRequest.create({
        data: { ...key, bodyHash, resultEntityId: String(decision.id) },
      });
      return decision;
    }
    if (input.followUpTaskInstanceId)
      throw new ApiError(
        422,
        "Follow-up links are only valid for completed-task concerns",
      );
    if (
      task.verificationVersion !== 2 ||
      !task.isActive ||
      ["COMPLETED", "CANCELLED"].includes(task.status)
    )
      throw new ApiError(409, "Completed decisions are immutable");
    if (input.action === "MARK_MAINTENANCE" && c.areaId !== task.areaId)
      throw new ApiError(409, "Case area changed. Refresh.");
    const r = input.requirementId
      ? await tx.taskEvidenceRequirement.findFirst({
          where: { id: input.requirementId, item: { taskInstanceId: task.id } },
        })
      : null;
    if (input.requirementId && !r)
      throw new ApiError(404, "Requirement not found");
    const issue = input.issueId
      ? await tx.verificationIssue.findFirst({
          where: { id: input.issueId, exceptionId: id },
        })
      : null;
    if (
      issue &&
      input.requirementId &&
      issue.requirementId !== input.requirementId
    )
      throw new ApiError(422, "Issue and requirement do not match");
    if (input.issueId && !issue) throw new ApiError(404, "Issue not found");
    const evidence = input.evidenceAttemptId
      ? await tx.verificationAttempt.findFirst({
          where: {
            id: input.evidenceAttemptId,
            session: { taskInstanceId: task.id },
          },
          include: { media: true, session: true },
        })
      : null;
    if (input.evidenceAttemptId && !evidence)
      throw new ApiError(404, "Evidence not found");
    if (input.action === "ACCEPT_CONTEXT") {
      if (
        !evidence ||
        !evidence.contextKey ||
        !evidence.receivedAt ||
        !reviewableMedia(evidence.media?.privacyState)
      )
        throw new ApiError(422, "Safe context evidence required");
      const contextAttempts = await tx.verificationAttempt.findMany({
        where: { sessionId: evidence.sessionId, contextKey: { not: null } },
        select: { id: true },
      });
      await tx.taskInstance.update({
        where: { id: task.id },
        data: { hasManualOverride: true },
      });
      await tx.verificationIssue.updateMany({
        where: {
          exceptionId: id,
          reasonCode: {
            in: [
              "GPS_UNCERTAIN",
              "GPS_STALE",
              "GPS_INACCURATE",
              "CONTEXT_UNCERTAIN",
              "IDENTITY_UNCERTAIN",
            ],
          },
          requirementId: null,
          OR: [
            { latestAttemptId: null },
            { latestAttemptId: { in: contextAttempts.map((a) => a.id) } },
          ],
        },
        data: { state: "RESOLVED", resolvedAt: new Date() },
      });
      // Origin uncertainty is tied to one photograph. An audited acceptance
      // settles that photograph, without accepting other context captures.
      await tx.verificationIssue.updateMany({
        where: {
          exceptionId: id,
          requirementId: null,
          latestAttemptId: evidence.id,
          reasonCode: "PHOTO_ORIGIN_UNCERTAIN",
          state: { not: "RESOLVED" },
        },
        data: { state: "RESOLVED", resolvedAt: new Date() },
      });
    } else if (
      [
        "ACCEPT_EVIDENCE",
        "WAIVE_REQUIREMENT",
        "REJECT_EVIDENCE",
        "REQUEST_RECAPTURE",
        "REQUEST_CLEANING",
      ].includes(input.action)
    ) {
      if (!r) throw new ApiError(422, "Requirement required");
      if (
        input.action === "ACCEPT_EVIDENCE" &&
        (!evidence ||
          evidence.requirementId !== r.id ||
          !evidence.receivedAt ||
          !reviewableMedia(evidence.media?.privacyState))
      )
        throw new ApiError(422, "Safe evidence for this requirement required");
      const state =
        input.action === "ACCEPT_EVIDENCE"
          ? "MANAGER_ACCEPTED"
          : input.action === "WAIVE_REQUIREMENT"
            ? "WAIVED"
            : input.action === "REQUEST_CLEANING"
              ? "CLEANING_REQUIRED"
              : "RECAPTURE_REQUIRED";
      await tx.taskEvidenceRequirement.update({
        where: { id: r.id },
        data: {
          state,
          decisionVersion: { increment: 1 },
          ...(input.action === "ACCEPT_EVIDENCE"
            ? { currentAttemptId: evidence!.id }
            : input.action === "WAIVE_REQUIREMENT"
              ? {}
              : { currentAttemptId: null }),
        },
      });
      if (["MANAGER_ACCEPTED", "WAIVED"].includes(state)) {
        await tx.taskInstance.update({
          where: { id: task.id },
          data: { hasManualOverride: true },
        });
        await tx.verificationIssue.updateMany({
          where: {
            exceptionId: id,
            requirementId: r.id,
            reasonCode: { notIn: ["PRIVACY_HOLD", ...GLOBAL_BLOCKING_REASONS] },
          },
          data: { state: "RESOLVED", resolvedAt: new Date() },
        });
      }
      if (!["MANAGER_ACCEPTED", "WAIVED"].includes(state)) {
        await tx.verificationIssue.updateMany({
          where: {
            exceptionId: id,
            requirementId: r.id,
            state: { not: "RESOLVED" },
            reasonCode: { notIn: GLOBAL_BLOCKING_REASONS },
          },
          data: { state: "STAFF_ACTION_REQUIRED" },
        });
        await tx.taskInstance.update({
          where: { id: task.id },
          data: { verificationState: "REWORK_REQUIRED" },
        });
      }
    } else if (input.action === "MARK_MAINTENANCE") {
      if (!r) throw new ApiError(422, "Requirement required");
      const item = await tx.taskVerificationItem.findUniqueOrThrow({
        where: { id: r.taskVerificationItemId },
      });
      const fixture = await tx.areaItem.findUniqueOrThrow({
        where: { id: item.sourceAreaItemId },
      });
      if (fixture.status === "RETIRED")
        throw new ApiError(409, "Retired fixture cannot enter maintenance");
      if (fixture.status !== "MAINTENANCE") {
        const currentArea = await tx.area.findUniqueOrThrow({
          where: { id: item.areaId },
        });
        if (currentArea.status === "ARCHIVED")
          throw new ApiError(409, "Area is archived");
        const area = await tx.area.update({
          where: { id: item.areaId },
          data: { inventoryVersion: { increment: 1 } },
        });
        await tx.areaItem.update({
          where: { id: fixture.id },
          data: { status: "MAINTENANCE" },
        });
        await tx.taskTemplate.updateMany({
          where: {
            areaId: item.areaId,
            isActive: true,
            OR: [
              { inventorySelection: "ALL" },
              { inventoryItems: { some: { areaItemId: fixture.id } } },
            ],
          },
          data: { setupStatus: "NEEDS_REVIEW" },
        });
        await writeAuditLog(
          {
            companyId: actor.companyId,
            actorType: actor.role,
            actorId: actor.id,
            entityType: "AREA",
            entityId: area.id,
            action: "ITEM_MAINTENANCE",
            oldValue: {
              inventoryVersion: area.inventoryVersion - 1,
              status: fixture.status,
            },
            newValue: {
              inventoryVersion: area.inventoryVersion,
              itemId: fixture.id,
              status: "MAINTENANCE",
            },
          },
          tx,
        );
      }
    } else if (input.action === "EXTEND_WINDOW") {
      if (
        !task.startedAt ||
        task.startedAt > task.shiftEnd ||
        task.status === "MISSED"
      )
        throw new ApiError(
          409,
          "Only work started before its original deadline can be extended",
        );
      if (
        await tx.verificationDecision.count({
          where: { exceptionId: id, action: "EXTEND_WINDOW" },
        })
      )
        throw new ApiError(409, "Extension already used");
      const policy = resolvePolicy(task.policySnapshot),
        minutes = input.extensionMinutes ?? policy.maxExtensionMinutes;
      if (minutes > policy.maxExtensionMinutes)
        throw new ApiError(422, "Extension exceeds task policy");
      const deadline = new Date(+task.shiftEnd + minutes * 60000);
      if (
        deadline <= new Date() ||
        deadline <= (task.verificationDeadline ?? task.shiftEnd)
      )
        throw new ApiError(
          409,
          "Extension unavailable; create a follow-up task",
        );
      await tx.taskInstance.update({
        where: { id: task.id },
        data: {
          verificationDeadline: deadline,
          uploadDeadline: new Date(+deadline + policy.uploadMinutes * 60000),
          rowVersion: { increment: 1 },
        },
      });
    } else if (input.action === "RESOLVE_ISSUE") {
      if (!issue) throw new ApiError(422, "Issue required");
      const satisfied = await issueSatisfied(tx, task, id, issue, r);
      if (!satisfied)
        throw new ApiError(409, "Resolve the blocking condition first");
      await tx.verificationIssue.update({
        where: { id: issue.id },
        data: { state: "RESOLVED", resolvedAt: new Date() },
      });
    }
    const d = await tx.verificationDecision.create({
      data: {
        exceptionId: id,
        issueId: input.issueId,
        requirementId: input.requirementId,
        action: input.action,
        reasonCode: input.reasonCode,
        note: input.note,
        actorManagerId: actor.id,
        evidenceAttemptId: input.evidenceAttemptId,
        expectedDecisionVersion: input.expectedVersion,
      },
    });
    await tx.verificationRequest.create({
      data: { ...key, bodyHash, resultEntityId: String(d.id) },
    });
    await tx.verificationException.update({
      where: { id },
      data: { rowVersion: { increment: 1 } },
    });
    await tx.exceptionEvent.create({
      data: {
        exceptionId: id,
        type: "MANAGER_DECISION",
        dedupeKey: `decision:${d.id}`,
        payload: { decisionId: d.id, action: d.action },
      },
    });
    await writeAuditLog(
      {
        companyId: actor.companyId,
        actorType: actor.role,
        actorId: actor.id,
        entityType: "TASK_INSTANCE",
        entityId: task.id,
        action: input.action,
        reason: input.reasonCode,
        newValue: { decisionId: d.id },
      },
      tx,
    );
    await finalizeTask(tx, task.id);
    await refreshCase(tx, id);
    return d;
  });
}

export async function issueSatisfied(
  tx: VerificationTransaction,
  task: { id: number; assignmentEpoch: number },
  id: number,
  issue: import("@prisma/client").VerificationIssue,
  r: import("@prisma/client").TaskEvidenceRequirement | null = null,
) {
  let satisfied = false;
  if (issue.requirementId) {
    const requirement =
      r ??
      (await tx.taskEvidenceRequirement.findUniqueOrThrow({
        where: { id: issue.requirementId },
      }));
    satisfied = ["PASSED", "MANAGER_ACCEPTED", "WAIVED"].includes(
      requirement.state,
    );
    if (GLOBAL_BLOCKING_REASONS.includes(issue.reasonCode)) {
      const replacement = requirement.currentAttemptId
        ? await tx.verificationAttempt.findUnique({
            where: { id: requirement.currentAttemptId },
            include: { media: true, session: true },
          })
        : null;
      const safeAccepted =
        !!replacement &&
        reviewableMedia(replacement.media?.privacyState) &&
        !!replacement.receivedAt &&
        ["PASSED", "MANAGER_ACCEPTED"].includes(requirement.state);
      if (issue.reasonCode === "PRIVACY_HOLD") {
        // The held original remains private. Only independently screened replacement bytes can satisfy the hold.
        satisfied =
          safeAccepted &&
          replacement!.id !== issue.latestAttemptId &&
          replacement!.mediaAssetId !==
            (issue.latestAttemptId
              ? (
                  await tx.verificationAttempt.findUnique({
                    where: { id: issue.latestAttemptId },
                    select: { mediaAssetId: true },
                  })
                )?.mediaAssetId
              : null);
      } else if (issue.reasonCode === "SERVICE_FAILURE") {
        satisfied = safeAccepted;
      } else if (issue.reasonCode === "DUPLICATE_EVIDENCE") {
        // Waiving gives no image credit. The separate reasoned resolution records the integrity disposition.
        const previous = issue.latestAttemptId
          ? await tx.verificationAttempt.findUnique({
              where: { id: issue.latestAttemptId },
              include: { media: true },
            })
          : null;
        satisfied =
          requirement.state === "WAIVED" ||
          (safeAccepted &&
            replacement!.id !== issue.latestAttemptId &&
            replacement!.media?.sha256 !== previous?.media?.sha256);
      } else if (issue.reasonCode === "STALE_ASSIGNMENT") {
        satisfied = requirement.state === "WAIVED";
        if (safeAccepted) {
          const decisions = await tx.verificationDecision.findMany({
            where: { exceptionId: id, action: "ACCEPT_CONTEXT" },
            select: { evidenceAttemptId: true },
          });
          satisfied = !!(await tx.verificationAttempt.findFirst({
            where: {
              id: {
                in: decisions
                  .map((d) => d.evidenceAttemptId)
                  .filter((id): id is string => !!id),
              },
              sessionId: replacement!.sessionId,
              contextKey: { not: null },
              media: { privacyState: { in: ["SAFE", "NOT_REQUIRED"] } },
            },
          }));
        }
      }
    }
  } else if (
    issue.reasonCode === "MISSING_EVIDENCE" ||
    (issue.reasonCode === "SERVICE_FAILURE" && !issue.latestAttemptId)
  ) {
    const requirements = await tx.taskEvidenceRequirement.findMany({
      where: {
        item: { taskInstanceId: task.id, mandatory: true },
        mandatory: true,
      },
    });
    satisfied =
      requirements.length > 0 &&
      requirements.every((r) =>
        ["PASSED", "MANAGER_ACCEPTED", "WAIVED"].includes(r.state),
      );
    if (satisfied) {
      const nonWaived = requirements.filter((r) => r.state !== "WAIVED");
      const attempts = await tx.verificationAttempt.findMany({
        where: {
          id: {
            in: nonWaived
              .map((r) => r.currentAttemptId)
              .filter((id): id is string => !!id),
          },
          receivedAt: { not: null },
          media: { privacyState: { in: ["SAFE", "NOT_REQUIRED"] } },
        },
        include: { session: true },
      });
      satisfied = attempts.length === nonWaived.length;
      const decisions = await tx.verificationDecision.findMany({
        where: { exceptionId: id, action: "ACCEPT_CONTEXT" },
        select: { evidenceAttemptId: true },
      });
      const overrides = await tx.verificationAttempt.findMany({
        where: {
          id: {
            in: decisions
              .map((d) => d.evidenceAttemptId)
              .filter((id): id is string => !!id),
          },
          contextKey: { not: null },
          media: { privacyState: { in: ["SAFE", "NOT_REQUIRED"] } },
        },
        select: { sessionId: true },
      });
      satisfied =
        satisfied &&
        attempts.every(
          (a) =>
            a.session.contextStatus === "ACCEPTABLE" ||
            overrides.some((o) => o.sessionId === a.sessionId),
        );
    }
  } else if (
    ["OCCUPIED", "INACCESSIBLE", "DAMAGED"].includes(issue.reasonCode)
  ) {
    // Explicit manager confirmation addresses the reported room condition, never fixture requirements.
    satisfied = true;
  } else if (
    [
      "PRIVACY_HOLD",
      "SERVICE_FAILURE",
      "STALE_ASSIGNMENT",
      "DUPLICATE_EVIDENCE",
    ].includes(issue.reasonCode) &&
    issue.latestAttemptId
  ) {
    const previous = await tx.verificationAttempt.findUnique({
      where: { id: issue.latestAttemptId },
    });
    if (previous?.contextKey)
      satisfied = !!(await tx.verificationAttempt.findFirst({
        where: {
          id: { not: previous.id },
          contextKey: previous.contextKey,
          session: {
            taskInstanceId: task.id,
            assignmentEpoch: task.assignmentEpoch,
          },
          state: "PASSED",
          media: { privacyState: { in: ["SAFE", "NOT_REQUIRED"] } },
        },
      }));
  }
  if (
    !satisfied &&
    issue.reasonCode === "PRIVACY_HOLD" &&
    !issue.requirementId &&
    issue.latestAttemptId
  ) {
    const previous = await tx.verificationAttempt.findUnique({
      where: { id: issue.latestAttemptId },
    });
    if (previous?.contextKey) {
      const decisions = await tx.verificationDecision.findMany({
        where: { exceptionId: id, action: "ACCEPT_CONTEXT" },
        select: { evidenceAttemptId: true },
      });
      satisfied = !!(await tx.verificationAttempt.findFirst({
        where: {
          id: {
            in: decisions
              .map((d) => d.evidenceAttemptId)
              .filter((id): id is string => !!id),
            not: previous.id,
          },
          contextKey: previous.contextKey,
          session: { taskInstanceId: task.id },
          mediaAssetId: { not: previous.mediaAssetId ?? "" },
          media: { privacyState: { in: ["SAFE", "NOT_REQUIRED"] } },
          receivedAt: { not: null },
        },
      }));
    }
  }
  if (
    !satisfied &&
    issue.reasonCode === "STALE_ASSIGNMENT" &&
    !issue.requirementId &&
    issue.latestAttemptId
  ) {
    const previous = await tx.verificationAttempt.findUnique({
      where: { id: issue.latestAttemptId },
    });
    if (previous) {
      const decisions = await tx.verificationDecision.findMany({
        where: { exceptionId: id, action: "ACCEPT_CONTEXT" },
        select: { evidenceAttemptId: true },
      });
      satisfied = !!(await tx.verificationAttempt.findFirst({
        where: {
          id: {
            in: decisions
              .map((d) => d.evidenceAttemptId)
              .filter((id): id is string => !!id),
          },
          sessionId: previous.sessionId,
          contextKey: { not: null },
          media: { privacyState: { in: ["SAFE", "NOT_REQUIRED"] } },
        },
      }));
    }
  }

  return satisfied;
}
