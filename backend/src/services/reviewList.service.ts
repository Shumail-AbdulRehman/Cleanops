import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma } from "../prisma/prisma.js";
import {
  operationsScope,
  taskDayWhere,
  pageBounds,
} from "./operationsScope.service.js";
import type { VerificationActor } from "./verification-v2/authorization.service.js";
export const reviewQuery = z.object({
  locationId: z.coerce.number().int().positive().optional(),
  areaId: z.coerce.number().int().positive().optional(),
  reasonCode: z.string().trim().min(1).max(80).optional(),
  queue: z
    .enum(["needs-me", "staff", "service", "resolved"])
    .default("needs-me"),
  period: z.enum(["all", "today", "earlier", "date"]).default("all"),
  date: z.string().default("today"),
  q: z.string().trim().max(120).default(""),
  page: z.coerce.number().int().min(1).max(100000).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(20),
});
const queues = {
  "needs-me": ["OPEN", "MANAGER_REVIEW"],
  staff: ["STAFF_ACTION_REQUIRED"],
  service: ["WAITING_SERVICE"],
  resolved: ["RESOLVED"],
} as const;
async function reviewScope(actor: VerificationActor, q: z.infer<typeof reviewQuery>) {
  const scope = await operationsScope(
    actor,
    q.locationId,
    q.period === "date" ? q.date : "today",
    new Date(),
    true,
  );
  const locations = scope.selected;
  const days = scope.days;
  // AND keeps period and search predicates independent (both can use OR/task).
  const search: Prisma.VerificationExceptionWhereInput = q.q
    ? {
        OR: [
          { area: { name: { contains: q.q, mode: "insensitive" } } },
          { task: { title: { contains: q.q, mode: "insensitive" } } },
          {
            task: { areaNameSnapshot: { contains: q.q, mode: "insensitive" } },
          },
          { task: { staff: { name: { contains: q.q, mode: "insensitive" } } } },
        ],
      }
    : {};
  const period: Prisma.VerificationExceptionWhereInput =
    q.period === "today" || q.period === "date"
      ? { task: taskDayWhere(days) }
      : q.period === "earlier"
        ? {
            OR: days.map((d) => ({
              locationId: d.locationId,
              task: { shiftEnd: { lte: d.start } },
            })),
          }
        : {};
  const common: Prisma.VerificationExceptionWhereInput = {
    AND: [
      {
        companyId: actor.companyId,
        locationId: { in: locations.map((l) => l.id) },
        ...(q.areaId ? { areaId: q.areaId } : {}),
        ...(q.reasonCode ? { issues: { some: { reasonCode: q.reasonCode } } } : {}),
      },
      search,
      period,
    ],
  };
  const where: Prisma.VerificationExceptionWhereInput = {
    AND: [common, { state: { in: [...queues[q.queue]] } }],
  };
  return { scope, locations, common, where };
}

export async function countReviews(actor: VerificationActor, raw: unknown) {
  const { where } = await reviewScope(actor, reviewQuery.parse(raw));
  return { total: await prisma.verificationException.count({ where }) };
}

export async function listReviews(
  actor: VerificationActor,
  raw: unknown,
  nextAfterId?: number,
) {
  const q = reviewQuery.parse(raw);
  const { scope, locations, common, where: baseWhere } = await reviewScope(actor, q);
  let where = baseWhere;
  if (nextAfterId) {
    const current = await prisma.verificationException.findFirst({
      where: {
        id: nextAfterId,
        companyId: actor.companyId,
        locationId: { in: locations.map((l) => l.id) },
      },
    });
    if (!current) return { nextId: null };
    where = {
      AND: [
        where,
        {
          OR: [
            { priority: { lt: current.priority } },
            {
              priority: current.priority,
              firstRaisedAt: { gt: current.firstRaisedAt },
            },
            {
              priority: current.priority,
              firstRaisedAt: current.firstRaisedAt,
              id: { gt: current.id },
            },
          ],
        },
      ],
    };
    const next = await prisma.verificationException.findFirst({
      where,
      select: { id: true },
      orderBy: [{ priority: "desc" }, { firstRaisedAt: "asc" }, { id: "asc" }],
    });
    return { nextId: next?.id ?? null };
  }
  return prisma.$transaction(
    async (tx) => {
      const total = await tx.verificationException.count({ where });
      const page = pageBounds(total, q.page, q.pageSize);
      const [rows, queueCounts] = await Promise.all([
        tx.verificationException.findMany({
          where,
          include: {
            area: { select: { id: true, name: true } },
            task: {
              select: {
                id: true,
                title: true,
                areaNameSnapshot: true,
                date: true,
                shiftStart: true,
                shiftEnd: true,
                staffSubmittedAt: true,
                status: true,
                verificationState: true,
                completionOutcome: true,
                staff: { select: { id: true, name: true } },
              },
            },
            issues: {
              where: { state: { not: "RESOLVED" } },
              include: {
                requirement: {
                  select: {
                    viewKey: true,
                    item: { select: { nameSnapshot: true } },
                  },
                },
              },
              orderBy: { id: "asc" },
            },
            events: {
              take: 1,
              orderBy: { id: "desc" },
              select: { id: true, type: true, payload: true },
            },
            readReceipts: {
              where: { managerId: actor.id },
              select: { lastReadEventId: true },
            },
          },
          orderBy: [
            { priority: "desc" },
            { firstRaisedAt: "asc" },
            { id: "asc" },
          ],
          skip: (page.page - 1) * page.pageSize,
          take: page.pageSize,
        }),
        Promise.all(
          Object.entries(queues).map(async ([key, states]) => [
            key,
            await tx.verificationException.count({
              where: { AND: [common, { state: { in: [...states] } }] },
            }),
          ]),
        ),
      ]);
      return {
        ...page,
        locations,
        asOf: scope.asOf,
        queueCounts: Object.fromEntries(queueCounts),
        cases: rows.map(({ events, readReceipts, ...c }) => ({
          ...c,
          location: locations.find((l) => l.id === c.locationId),
          displayReasonCode:
            c.issues.find((i) => ["OPEN", "MANAGER_REVIEW"].includes(i.state))
              ?.reasonCode ??
            c.issues[0]?.reasonCode ??
            (c.kind === "SETUP" ? "SETUP_REQUIRED" : "REVIEW_REQUIRED"),
          openIssueCount: c.issues.length,
          unread:
            (events[0]?.id ?? 0) > (readReceipts[0]?.lastReadEventId ?? 0),
        })),
      };
    },
    { isolationLevel: "RepeatableRead" },
  );
}
