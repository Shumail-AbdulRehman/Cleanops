import { reviewReplacementContext } from '../services/verification-v2/launchReviewContext.js';
import { accountAccess } from '../middlewares/accountAccess.middleware.js';
import {closeReview, reviewClosureActions} from '../services/verification-v2/reviewClosure.service.js';
import { reviewEvidenceSummary } from '../services/verification-v2/reviewEvidenceSummary.js';
import { reviewableMedia } from "../services/verification-v2/evidenceBuffer.js";
import { sha256 } from "../services/verification-v2/quality.service.js";
import { Router } from "express";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma } from "../prisma/prisma.js";
import { verifyJwt } from "../middlewares/auth.middleware.js";
import {
  requireActiveActor,
  requireOperationalRole,
  requireTaskAccess,
} from "../services/verification-v2/authorization.service.js";
import {
  issueSatisfied,
  resolveCompletedConcern,
  caseAccess,
  managerDecision,
  raiseIssue,
} from "../services/verification-v2/exception.service.js";
import {
  resolvePolicy,
  reasonInstructions,
} from "../services/verification-v2/verificationPolicy.service.js";
import { lockTask } from "../services/verification-v2/captureSession.service.js";
import { writeAuditLog } from "../services/auditLog.service.js";
import { ApiError } from "../utils/ApiError.js";
import { countReviews, listReviews } from "../services/reviewList.service.js";
const router = Router();
router.use(
  [
    /^\/verification-exceptions(?=\/|$)/,
    /^\/task-instance\/[^/]+\/verification-issues(?=\/|$)/,
  ],
  verifyJwt,
);
const idSchema = z.coerce.number().int().positive();
const cursorSchema = idSchema.optional();
router.get("/verification-exceptions/count", async (req, res) =>
  res.json({ success: true, data: await countReviews(req.user!, req.query) }),
);
router.post("/task-instance/:taskId/verification-issues", async (req) => {
 await requireTaskAccess(req.user!,idSchema.parse(req.params.taskId),{staffMutation:true});
 throw new ApiError(410,"Complete and upload all required photos. Staff exception requests are no longer available.",[{code:'REQUIRED_PHOTOS_ONLY'}]);
});
router.post('/verification-exceptions/:id/close', accountAccess('MANAGE_WORK'), async(req,res) => {
  res.json({success:true,data:await closeReview(req.user!,idSchema.parse(req.params.id),req.body)});
});
router.get("/verification-exceptions/:id/next", async (req, res) =>
  res.json({
    success: true,
    data: await listReviews(
      req.user!,
      req.query,
      idSchema.parse(req.params.id),
    ),
  }),
);
router.get("/verification-exceptions/:id/follow-ups", async (req, res) => {
  const c = await caseAccess(req.user!, idSchema.parse(req.params.id));
  if (!c.taskInstanceId)
    return res.json({ success: true, data: { tasks: [], nextCursor: null } });
  const task = await requireTaskAccess(req.user!, c.taskInstanceId);
  const issue = await prisma.verificationIssue.findFirst({
    where: { id: idSchema.parse(req.query.issueId), exceptionId: c.id },
  });
  if (!issue) throw new ApiError(404, "Issue not found");
  const cursor = cursorSchema.parse(req.query.cursor),
    q = z.string().max(120).default("").parse(req.query.q);
  const candidates = await prisma.taskInstance.findMany({
    where: {
      id: { not: task.id },
      locationId: task.locationId,
      areaId: task.areaId ?? -1,
      status: "COMPLETED",
      verificationVersion: 2,
      startedAt: { gte: issue.firstSeenAt },
      ...(q ? { title: { contains: q, mode: "insensitive" } } : {}),
    },
    orderBy: { id: "asc" },
    take: 21,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
  });
  const tasks = [];
  for (const candidate of candidates.slice(0, 20)) {
    try {
      await resolveCompletedConcern(
        prisma,
        req.user!,
        c,
        {
          requestId: crypto.randomUUID(),
          expectedVersion: c.rowVersion,
          issueId: issue.id,
          action: "RESOLVE_ISSUE",
          reasonCode: "CANNOT_ASSESS",
          note: "Eligibility check",
          followUpTaskInstanceId: candidate.id,
        },
        true,
      );
      tasks.push({
        id: candidate.id,
        title: candidate.title,
        shiftStart: candidate.shiftStart,
        completedAt: candidate.completedAt,
      });
    } catch (error) {
      if (!(error instanceof ApiError)) throw error;
    }
  }
  res.json({
    success: true,
    data: {
      tasks,
      nextCursor: candidates.length > 20 ? String(candidates[19]!.id) : null,
    },
  });
});
router.get("/verification-exceptions", async (req, res) => {
  if (
    req.query.page !== undefined ||
    req.query.queue !== undefined ||
    req.query.period !== undefined ||
    req.query.q !== undefined
  ) {
    if (req.query.cursor !== undefined)
      throw new ApiError(400, "Choose page or cursor pagination");
    return res.json({
      success: true,
      data: await listReviews(req.user!, req.query),
    });
  }
  const actor = req.user!;
  requireOperationalRole(actor);
  await requireActiveActor(actor);
  const q = z
    .object({
      cursor: cursorSchema,
      locationId: cursorSchema,
      areaId: cursorSchema,
      workerId: cursorSchema,
      reasonCode: z.string().max(80).optional(),
      priority: z.coerce.number().int().min(0).max(5).optional(),
      state: z
        .enum([
          "OPEN",
          "STAFF_ACTION_REQUIRED",
          "MANAGER_REVIEW",
          "WAITING_SERVICE",
          "RESOLVED",
        ])
        .optional(),
    })
    .parse(req.query);
  const locations = await prisma.location.findMany({
    where: {
      companyId: actor.companyId,
      ...(actor.role === "MANAGER"
        ? { managerAssignments: { some: { managerId: actor.id } } }
        : {}),
    },
    select: { id: true, name: true, timezone: true },
  });
  const scope: Prisma.VerificationExceptionWhereInput = {
    companyId: actor.companyId,
    locationId: { in: locations.map((l) => l.id) },
  };
  const where: Prisma.VerificationExceptionWhereInput = {
    AND: [
      scope,
      {
        ...(q.locationId ? { locationId: q.locationId } : {}),
        ...(q.areaId ? { areaId: q.areaId } : {}),
        ...(q.workerId ? { task: { staffId: q.workerId } } : {}),
        ...(q.reasonCode
          ? { issues: { some: { reasonCode: q.reasonCode } } }
          : {}),
        ...(q.priority !== undefined ? { priority: q.priority } : {}),
        ...(q.state ? { state: q.state } : {}),
      },
    ],
  };
  const [cases, total, actionable] = await Promise.all([
    prisma.verificationException.findMany({
      where,
      include: {
        issues: true,
        area: { select: { id: true, name: true } },
        task: {
          select: {
            id: true,
            title: true,
            areaNameSnapshot: true,
            shiftEnd: true,
            staff: { select: { id: true, name: true } },
          },
        },
        readReceipts: { where: { managerId: actor.id } },
        events: { take: 1, orderBy: { id: "desc" }, select: { id: true } },
      },
      take: 51,
      orderBy: { id: "asc" },
      ...(q.cursor ? { cursor: { id: q.cursor }, skip: 1 } : {}),
    }),
    prisma.verificationException.count({ where }),
    prisma.verificationException.findMany({
      where: { AND: [scope, { state: { in: ["OPEN", "MANAGER_REVIEW"] } }] },
      select: {
        readReceipts: {
          where: { managerId: actor.id },
          select: { lastReadEventId: true },
        },
        events: { take: 1, orderBy: { id: "desc" }, select: { id: true } },
      },
    }),
  ]);
  const unread = (c: {
    readReceipts: { lastReadEventId: number | null }[];
    events: { id: number }[];
  }) => (c.events[0]?.id ?? 0) > (c.readReceipts[0]?.lastReadEventId ?? 0);
  res.json({
    success: true,
    data: {
      cases: cases.slice(0, 50).map(({ readReceipts, events, ...c }) => ({
        ...c,
        unread: unread({ readReceipts, events }),
        location: locations.find((l) => l.id === c.locationId),
      })),
      nextCursor: cases.length > 50 ? String(cases[49]!.id) : null,
      total,
      unreadCount: actionable.filter(unread).length,
    },
  });
});
router.get("/verification-exceptions/:id", async (req, res) => {
  const c = await caseAccess(req.user!, idSchema.parse(req.params.id));
  const eventCursor = cursorSchema.parse(
      req.query.eventCursor ?? req.query.cursor,
    ),
    attemptCursor = z.uuid().optional().parse(req.query.attemptCursor),
    decisionCursor = cursorSchema.parse(req.query.decisionCursor);
  if (
    attemptCursor &&
    (!c.taskInstanceId ||
      !(await prisma.verificationAttempt.findFirst({
        where: {
          id: attemptCursor,
          session: { taskInstanceId: c.taskInstanceId },
        },
        select: { id: true },
      })))
  )
    throw new ApiError(404, "Attempt cursor not found");
  const [events, issues, decisions, attempts, task, area, location] =
    await Promise.all([
      prisma.exceptionEvent.findMany({
        where: {
          exceptionId: c.id,
          ...(eventCursor ? { id: { gt: eventCursor } } : {}),
        },
        orderBy: { id: "asc" },
        take: 51,
      }),
      prisma.verificationIssue.findMany({
        where: { exceptionId: c.id },
        include: { requirement: { include: { item: true } } },
      }),
      prisma.verificationDecision.findMany({
        where: {
          exceptionId: c.id,
          ...(decisionCursor ? { id: { lt: decisionCursor } } : {}),
        },
        take: 51,
        orderBy: { id: "desc" },
      }),
      c.taskInstanceId
        ? prisma.verificationAttempt.findMany({
            where: { session: { taskInstanceId: c.taskInstanceId } },
            orderBy: [{ createdAt: "desc" }, { id: "desc" }],
            take: 51,
            ...(attemptCursor
              ? { cursor: { id: attemptCursor }, skip: 1 }
              : {}),
            select: {
              id: true,
              requirementId: true,
              contextKey: true,
              staffId: true,
              state: true,
              createdAt: true,
              receivedAt: true,
              mediaAssetId: true,
              media: { select: { privacyState: true } },
              assignmentEpoch: true,
              timingEvidence: true,
              cleanlinessResult: true,
            },
          })
        : Promise.resolve([]),
      c.taskInstanceId
        ? prisma.taskInstance.findUnique({
            where: { id: c.taskInstanceId },
            select: {
              id: true,
              title: true,
              areaNameSnapshot: true,
              shiftEnd: true,
              verificationDeadline: true,
              uploadDeadline: true,
              status: true,
              verificationState: true,
              completionOutcome: true,
              isActive: true,
              verificationVersion: true,
              startedAt: true,
              staffSubmittedAt: true,
              assignmentEpoch: true,
              staffId: true,
              shiftStart: true,
              areaId: true,
              policySnapshot: true,
              staff: { select: { id: true, name: true } },
            },
          })
        : Promise.resolve(null),
      c.areaId
        ? prisma.area.findUnique({
            where: { id: c.areaId },
            select: { id: true, name: true },
          })
        : Promise.resolve(null),
      prisma.location.findUnique({
        where: { id: c.locationId },
        select: { id: true, name: true, timezone: true },
      }),
    ]);
  const latestIds = issues
    .map((i) => i.latestAttemptId)
    .filter((id): id is string => !!id);
  const latestAttempts = c.taskInstanceId
    ? await prisma.verificationAttempt.findMany({
        where: {
          id: { in: latestIds },
          session: { taskInstanceId: c.taskInstanceId },
        },
        select: {
          id: true,
          requirementId: true,
          contextKey: true,
          staffId: true,
          state: true,
          createdAt: true,
          receivedAt: true,
          mediaAssetId: true,
          media: { select: { privacyState: true } },
          assignmentEpoch: true,
          timingEvidence: true,
          cleanlinessResult: true,
        },
      })
    : [];
  const managers = await prisma.manager.findMany({
    where: {
      companyId: req.user!.companyId,
      id: { in: decisions.map((d) => d.actorManagerId) },
    },
    select: { id: true, name: true },
  });
  const staff = await prisma.staff.findMany({
    where: {
      companyId: req.user!.companyId,
      id: { in: [...attempts, ...latestAttempts].map((a) => a.staffId) },
    },
    select: { id: true, name: true },
  });
  const safeAttempt = (a: (typeof latestAttempts)[number]) => {
    const { cleanlinessResult, ...safe } = a;
    return {
      ...safe,
      reviewSummary: reviewEvidenceSummary(cleanlinessResult),
      staff: staff.find((s) => s.id === a.staffId) ?? null,
      privacyState: a.media?.privacyState,
      mediaAssetId: ["SAFE", "NOT_REQUIRED", "HOLD"].includes(a.media?.privacyState ?? "")
        ? a.mediaAssetId
        : null,
    };
  };
  const page = attempts.slice(0, 50).map(safeAttempt);
  const latestPage = latestAttempts.map(safeAttempt);
  const policy = task ? resolvePolicy(task.policySnapshot) : null;
  const mutable =
    !!task &&
    task.isActive &&
    task.verificationVersion === 2 &&
    !["COMPLETED", "CANCELLED"].includes(task.status);
  const extensionUsed =
    (await prisma.verificationDecision.count({
      where: { exceptionId: c.id, action: "EXTEND_WINDOW" },
    })) > 0;
  const canExtend =
    mutable &&
    !!task?.startedAt &&
    task.startedAt <= task.shiftEnd &&
    !!policy &&
    policy.maxExtensionMinutes > 0 &&
    !extensionUsed &&
    +task.shiftEnd + policy.maxExtensionMinutes * 60000 > Date.now() &&
    +task.shiftEnd + policy.maxExtensionMinutes * 60000 >
      +(task.verificationDeadline ?? task.shiftEnd);
  const requiresFollowUp =
    task?.verificationVersion === 2 && task.status === "COMPLETED";
  const allowedActions = requiresFollowUp
    ? c.state === "RESOLVED"
      ? []
      : ["RESOLVE_ISSUE"]
    : mutable
      ? [
          "ACCEPT_EVIDENCE",
          "ACCEPT_CONTEXT",
          "MARK_MAINTENANCE",
          "WAIVE_REQUIREMENT",
          "RESOLVE_ISSUE",

        ]
      : [];
  const items = c.taskInstanceId
    ? await prisma.taskVerificationItem.findMany({
        where: { taskInstanceId: c.taskInstanceId },
        orderBy: { orderSnapshot: "asc" },
        include: { requirements: true },
      })
    : [];
  const currentAttempts = await prisma.verificationAttempt.findMany({
    where: {
      id: {
        in: items.flatMap((i) =>
          i.requirements
            .map((r) => r.currentAttemptId)
            .filter((id): id is string => !!id),
        ),
      },
      session: { taskInstanceId: c.taskInstanceId ?? -1 },
    },
    include: { media: { select: { privacyState: true } }, slot: { select: { generation: true } }, session: {select:{id:true,taskInstanceId:true,staffId:true,assignmentId:true,assignmentEpoch:true,captureExpiresAt:true,uploadExpiresAt:true,state:true}} },
  });
  const currentAssignment = task?.staffId ? await prisma.taskAssignment.findFirst({where:{taskInstanceId:task.id,staffId:task.staffId,isCurrent:true},select:{id:true}}) : null;
  const serverTime = new Date();
  const captureAvailable =
    mutable &&
    !task?.staffSubmittedAt &&
    !!task?.startedAt &&
    +(task.verificationDeadline ?? task.shiftEnd) > +serverTime;
  const itemActions = items.flatMap((item) =>
    item.requirements.map((r) => ({
      requirementId: r.id,
      actions: mutable
        ? [
            "WAIVE_REQUIREMENT",
            ...(currentAttempts.find((a) => a.id === r.currentAttemptId)
              ?.receivedAt &&
            reviewableMedia(currentAttempts.find((a) => a.id === r.currentAttemptId)?.media?.privacyState)
              ? ["ACCEPT_EVIDENCE"]
              : []),
          ]
        : [],
    })),
  );
  const eligibleIssues = await Promise.all(
    issues.map(async (i) => {
      const attempt = latestPage.find((a) => a.id === i.latestAttemptId);
      let actions = (i.state === "RESOLVED" ? [] : allowedActions).filter(
        (action) =>
          action === "EXTEND_WINDOW" ||
          action === "RESOLVE_ISSUE" ||
          (i.requirementId
            ? action !== "ACCEPT_CONTEXT"
            : action === "ACCEPT_CONTEXT"),
      );
      if (!requiresFollowUp) {
        actions = actions.filter(
          (a) =>
            a !== "REQUEST_CLEANING" || i.reasonCode === "CLEANING_REQUIRED",
        );
        actions = actions.filter(
          (a) => a !== "REJECT_EVIDENCE" || !!attempt?.receivedAt,
        );
        actions = actions.filter(
          (a) =>
            ![
              "REQUEST_RECAPTURE",
              "REQUEST_CLEANING",
              "REJECT_EVIDENCE",
            ].includes(a) || captureAvailable,
        );
        actions = actions.filter(
          (a) =>
            a !== "ACCEPT_EVIDENCE" ||
            (!!attempt?.receivedAt &&
              reviewableMedia(attempt.privacyState) &&
              !!attempt.mediaAssetId),
        );
        if (
          task &&
          actions.includes("RESOLVE_ISSUE") &&
          !(await issueSatisfied(prisma, task, c.id, i))
        )
          actions = actions.filter((a) => a !== "RESOLVE_ISSUE");
      }
      return {
        ...i,
        recommendedAction:
          i.reasonCode === "CLEAN"
            ? "Review this photo before accepting the evidence."
            : (reasonInstructions[i.reasonCode] ?? i.recommendedAction),
        latestAttempt: attempt ?? null,
        requiresFollowUp,
        allowedActions: actions,
        blockedReason:
          !captureAvailable && mutable
            ? "This task cannot receive another photo now. Check the photo deadline and available options."
            : i.reasonCode === "MISSING_EVIDENCE"
              ? "Missing requirements must be satisfied before this issue can close."
              : null,
      };
    }),
  );
  const standards = c.areaId
    ? await prisma.areaStandardPhoto.findMany({
        where: { areaId: c.areaId, media: { privacyState: { in: ["SAFE", "NOT_REQUIRED"] } } },
        select: {
          id: true,
          caption: true,
          areaItemId: true,
          mediaAssetId: true,
        },
        take: 30,
      })
    : [];
  const assignees = task ? await prisma.taskAssignment.findMany({where:{taskInstanceId:task.id},select:{staff:{select:{id:true,name:true}}}}) : [];
  const performanceStaffOptions = [...new Map([task?.staff, ...assignees.map(row=>row.staff)].filter((staff):staff is {id:number;name:string} => !!staff).map(staff=>[staff.id,staff])).values()];
  const performanceReport = await prisma.exceptionEvent.findUnique({where:{dedupeKey:`performance-review:${c.id}`},select:{id:true}});
  const closureActions = c.kind === 'TASK' && !!task && c.state !== 'RESOLVED'
    ? reviewClosureActions.filter(action=>action!=='RECORD_PERFORMANCE_ISSUE'||(performanceStaffOptions.length>0&&!performanceReport)) : [];
  const { policySnapshot: _policy, ...taskSummary } = task ?? {};
  res.json({
    success: true,
    data: {
      ...c,
      task: task ? taskSummary : null,
      area,
      location,
      allowedActions,
      requiresFollowUp,
      closureActions,
      performanceStaffOptions,
      performanceIssueRecorded: !!performanceReport,
      policyBounds: policy
        ? {
            maxExtensionMinutes: policy.maxExtensionMinutes,
            uploadMinutes: policy.uploadMinutes,
            reworkMinutes: policy.reworkMinutes,
            extensionUsed,
            extensionDeadline: new Date(
              +task!.shiftEnd + policy.maxExtensionMinutes * 60000,
            ),
          }
        : null,
      reasonInstructions,
      issues: eligibleIssues,
      serverTime,
      captureStatus: {
        available: captureAvailable,
        canExtend,
        deadline: task?.verificationDeadline ?? task?.shiftEnd ?? null,
        reason: !task ? 'UNAVAILABLE' : !task.isActive ? 'INACTIVE'
          : task.status === 'COMPLETED' ? 'COMPLETED' : task.status === 'CANCELLED' ? 'CANCELLED'
          : task.staffSubmittedAt ? 'SUBMITTED' : !task.startedAt ? 'NOT_STARTED'
          : captureAvailable ? 'AVAILABLE' : +(task.verificationDeadline ?? task.shiftEnd) <= +serverTime ? 'DEADLINE_PASSED' : 'UNAVAILABLE',
      },
      items: items.map(({ requirements, ...item }) => ({
        ...item,
        requirements: requirements.map((r) => {
          const currentAttempt = currentAttempts.find(
            (a) => a.id === r.currentAttemptId,
          );
          return {
            ...r,
            replacement: reviewReplacementContext(task && task.staffId && currentAttempt ? {
              task, staffId: task.staffId, now: serverTime, session: currentAttempt.session,
              requirement: {...r, item: {mandatory:item.mandatory}}, attempt: currentAttempt,
              expectedGeneration: r.decisionVersion, cleaning: r.state === "CLEANING_REQUIRED",
            } : null, item.typeSnapshot, currentAssignment?.id ?? null),
            currentAttempt: currentAttempt
              ? {
                  id: currentAttempt.id,
                  state: currentAttempt.state,
                  createdAt: currentAttempt.createdAt,
                  receivedAt: currentAttempt.receivedAt,
                  requirementId: currentAttempt.requirementId,
                  contextKey: currentAttempt.contextKey,
                  reviewSummary: reviewEvidenceSummary(currentAttempt.cleanlinessResult),
                  privacyState: currentAttempt.media?.privacyState,
                  mediaAssetId: ["SAFE", "NOT_REQUIRED", "HOLD"].includes(
                    currentAttempt.media?.privacyState ?? "",
                  )
                    ? currentAttempt.mediaAssetId
                    : null,
                }
              : null,
            allowedActions:
              itemActions.find((x) => x.requirementId === r.id)?.actions ?? [],
          };
        }),
      })),
      standards,
      decisions: decisions.slice(0, 50).map((d) => ({
        ...d,
        actorManager: managers.find((m) => m.id === d.actorManagerId) ?? null,
      })),
      events: events.slice(0, 50),
      attempts: page,
      nextCursor: events.length > 50 ? String(events[49]!.id) : null,
      nextEventCursor: events.length > 50 ? String(events[49]!.id) : null,
      eventsNextCursor: events.length > 50 ? String(events[49]!.id) : null,
      nextAttemptCursor: attempts.length > 50 ? attempts[49]!.id : null,
      nextDecisionCursor:
        decisions.length > 50 ? String(decisions[49]!.id) : null,
    },
  });
});
router.post("/verification-exceptions/:id/actions", accountAccess('MANAGE_WORK'), async (req, res) =>
  res.json({
    success: true,
    data: await managerDecision(
      req.user!,
      idSchema.parse(req.params.id),
      req.body,
    ),
  }),
);
router.post("/verification-exceptions/:id/read", accountAccess('MANAGE_WORK'), async (req, res) => {
  const receipt = await prisma.$transaction(async (tx) => {
    const id = idSchema.parse(req.params.id);
    await caseAccess(req.user!, id, tx);
    await tx.$queryRaw`SELECT id FROM "VerificationException" WHERE id=${id} FOR UPDATE`;
    await caseAccess(req.user!, id, tx);
    const latest = await tx.exceptionEvent.findFirst({
        where: { exceptionId: id },
        orderBy: { id: "desc" },
      }),
      key = { exceptionId: id, managerId: req.user!.id };
    return tx.exceptionReadReceipt.upsert({
      where: { exceptionId_managerId: key },
      create: { ...key, lastReadEventId: latest?.id },
      update: { lastReadEventId: latest?.id, readAt: new Date() },
    });
  });
  res.json({ success: true, data: receipt });
});
router.use((error: any, _req: any, _res: any, next: any) =>
  next(
    error instanceof z.ZodError
      ? new ApiError(400, "Invalid request", error.issues)
      : error,
  ),
);
export default router;
