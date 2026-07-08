import type { TaskStatus } from "@prisma/client";
import { prisma } from "../../prisma/prisma.js";
import { jobAccountAllowed } from "../launchJobs.service.js";
import { lockTask } from "./captureSession.service.js";
import { finalizeTask } from "./completion.service.js";
import { raiseIssue } from "./exception.service.js";
import type { VerificationTransaction } from "./transaction.js";

const deadlineStatuses: TaskStatus[] = ["PENDING", "IN_PROGRESS", "NOT_COMPLETED_INTIME"];
const deadlineLookbackMs = 7 * 24 * 60 * 60 * 1000;
const reminderIntervalMs = 30 * 60 * 1000;

async function countMissingEvidence(tx: VerificationTransaction, taskId: number) {
  const requirements = await tx.taskEvidenceRequirement.findMany({
    where: {
      item: { taskInstanceId: taskId, mandatory: true },
      mandatory: true,
    },
  });
  const received = await tx.verificationAttempt.findMany({
    where: {
      id: {
        in: requirements
          .map((r) => r.currentAttemptId)
          .filter((id): id is string => !!id),
      },
      receivedAt: { not: null },
    },
    include: { session: true },
  });
  const receivedIds = new Set(received.map((a) => a.id));
  let missing = requirements.filter(
    (r) =>
      ["MISSING", "RECAPTURE_REQUIRED", "CLEANING_REQUIRED"].includes(r.state) ||
      ((r.state === "PROCESSING" || r.state === "REVIEW_REQUIRED") &&
        (!r.currentAttemptId || !receivedIds.has(r.currentAttemptId))),
  ).length;
  // Only sessions contributing current fixture evidence need context. Accepted old-worker
  // sessions remain valid after handover; absence of a new session does not erase them.
  const sessionIds = [
    ...new Set(
      received
        .filter((a) =>
          requirements.some(
            (r) => r.currentAttemptId === a.id && r.state !== "WAIVED",
          ),
        )
        .filter((a) => a.session.contextStatus !== "ACCEPTABLE")
        .map((a) => a.sessionId),
    ),
  ];
  if (sessionIds.length) {
    const contextSlots = await tx.captureSlot.findMany({
      where: {
        sessionId: { in: sessionIds },
        contextKey: { in: ["ENTRANCE", "LAYOUT"] },
      },
      orderBy: [{ generation: "desc" }, { id: "desc" }],
      select: {
        sessionId: true,
        contextKey: true,
        generation: true,
        attempt: { select: { receivedAt: true } },
      },
    });
    const latestContexts = new Map<string, (typeof contextSlots)[number]>();
    for (const slot of contextSlots) {
      const key = `${slot.sessionId}:${slot.contextKey}`;
      if (!latestContexts.has(key)) latestContexts.set(key, slot);
    }
    const overrides = await tx.verificationDecision.findMany({
      where: {
        exception: { taskInstanceId: taskId },
        action: "ACCEPT_CONTEXT",
      },
      select: { evidenceAttemptId: true },
    });
    const safeOverrides = await tx.verificationAttempt.findMany({
      where: {
        id: {
          in: overrides
            .map((d) => d.evidenceAttemptId)
            .filter((id): id is string => !!id),
        },
        sessionId: { in: sessionIds },
        contextKey: { not: null },
        media: { privacyState: "SAFE" },
      },
      select: { sessionId: true },
    });
    missing += sessionIds.filter(
      (id) =>
        !safeOverrides.some((a) => a.sessionId === id) &&
        !["ENTRANCE", "LAYOUT"].every(
          (key) =>
            !!latestContexts.get(`${id}:${key}`)?.attempt?.receivedAt,
        ),
    ).length;
  }
  return missing;
}

async function expireTask(
  tx: VerificationTransaction,
  taskId: number,
  now: Date,
  oldestShiftEnd: Date,
) {
  await lockTask(tx, taskId);
  const task = await tx.taskInstance.findUniqueOrThrow({ where: { id: taskId } });
  if (
    !task.isActive ||
    !deadlineStatuses.includes(task.status) ||
    task.shiftEnd < oldestShiftEnd ||
    task.shiftEnd >= now
  ) return;

  const location = await tx.location.findUniqueOrThrow({
    where: { id: task.locationId },
    select: { companyId: true },
  });
  if (!await jobAccountAllowed(location.companyId, "READ_OPERATIONAL", tx, now)) return;
  if (await finalizeTask(tx, task.id)) return;

  const recordedOutcome = task.status === "NOT_COMPLETED_INTIME" &&
    await tx.verificationIssue.findFirst({
      where: {
        exception: { taskInstanceId: task.id },
        reasonCode: "MISSING_EVIDENCE",
        requirementId: null,
      },
      select: { id: true },
    });

  if (!recordedOutcome && (!task.startedAt || task.startedAt > task.shiftEnd)) {
    await tx.taskInstance.update({
      where: { id: task.id },
      data: { status: "MISSED", verificationState: "NEEDS_REVIEW" },
    });
    await tx.taskAssignment.updateMany({
      where: { taskInstanceId: task.id, isCurrent: true },
      data: { status: "MISSED", isCurrent: false, failedAt: now },
    });
    await raiseIssue(tx, task.id, "MISSING_EVIDENCE");
    return;
  }

  const missing = recordedOutcome ? 0 : await countMissingEvidence(tx, task.id);
  if (
    await tx.captureSession.count({
      where: { taskInstanceId: task.id, state: "PAUSED" },
    })
  ) await raiseIssue(tx, task.id, "OCCUPIED");

  const issue = missing ? await raiseIssue(tx, task.id, "MISSING_EVIDENCE") : null;
  if (!recordedOutcome && task.uploadDeadline && now > task.uploadDeadline) {
    const submittedInTime = task.staffSubmittedAt && task.staffSubmittedAt <= task.shiftEnd;
    if (!submittedInTime) {
      await tx.taskInstance.update({
        where: { id: task.id },
        data: {
          status: "NOT_COMPLETED_INTIME",
          verificationState: missing ? "NEEDS_REVIEW" : "PROCESSING",
        },
      });
    }
    if (issue) {
      const escalated = await tx.verificationException.updateMany({
        where: { id: issue.id, priority: { lt: 3 } },
        data: { priority: 3, rowVersion: { increment: 1 } },
      });
      if (escalated.count) {
        const dedupeKey = `cutoff:${task.id}:${task.uploadDeadline.toISOString()}`;
        await tx.exceptionEvent.upsert({
          where: { dedupeKey },
          create: {
            exceptionId: issue.id,
            type: "UPLOAD_WINDOW_EXHAUSTED",
            dedupeKey,
            payload: { missing },
          },
          update: {},
        });
      }
    }
    // Accepted jobs remain eligible; assignment stays current for finalization.
  }
  await tx.captureSession.updateMany({
    where: {
      taskInstanceId: task.id,
      state: { in: ["ACTIVE", "PAUSED"] },
      captureExpiresAt: { lte: now },
    },
    data: { state: "EXPIRED", closedAt: now, rowVersion: { increment: 1 } },
  });
}

export async function expireVerificationTasks(now = new Date()) {
  const oldestShiftEnd = new Date(+now - deadlineLookbackMs);
  const tasks = await prisma.taskInstance.findMany({
    where: {
      location: { company: { isActive: true, operationalStatus: "ACTIVE" } },
      verificationVersion: 2,
      isActive: true,
      status: { in: deadlineStatuses },
      shiftEnd: { gte: oldestShiftEnd, lt: now },
    },
    select: { id: true },
  });
  for (const candidate of tasks) {
    try {
      await prisma.$transaction((tx) => expireTask(tx, candidate.id, now, oldestShiftEnd));
    } catch (error) {
      console.error("Verification deadline task failed", { taskId: candidate.id, error });
    }
  }

  const reminders = await prisma.verificationException.findMany({
    where: { state: { not: "RESOLVED" }, nextReminderAt: { lte: now } },
    orderBy: { nextReminderAt: "asc" },
    take: 100,
  });
  const nextReminderAt = new Date(+now + reminderIntervalMs);
  for (const reminder of reminders) {
    try {
      await prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM "VerificationException" WHERE id=${reminder.id} FOR UPDATE`;
        const fresh = await tx.verificationException.findUniqueOrThrow({
          where: { id: reminder.id },
        });
        if (
          fresh.state === "RESOLVED" ||
          !fresh.nextReminderAt ||
          fresh.nextReminderAt > now
        ) return;

        if (!await jobAccountAllowed(fresh.companyId, "READ_OPERATIONAL", tx, now)) {
          await tx.verificationException.update({
            where: { id: fresh.id },
            data: { nextReminderAt, rowVersion: { increment: 1 } },
          });
          return;
        }

        const dedupeKey = `reminder:${fresh.id}:${fresh.nextReminderAt.toISOString()}`;
        await tx.exceptionEvent.upsert({
          where: { dedupeKey },
          create: {
            exceptionId: fresh.id,
            type: "REMINDER",
            dedupeKey,
            payload: {},
          },
          update: {},
        });
        await tx.verificationException.update({
          where: { id: fresh.id },
          data: {
            priority: Math.min(5, fresh.priority + 1),
            nextReminderAt,
            rowVersion: { increment: 1 },
          },
        });
      });
    } catch (error) {
      console.error("Verification reminder failed", { reminderId: reminder.id, error });
    }
  }
}
