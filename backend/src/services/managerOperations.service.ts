import type { Prisma } from "@prisma/client";
import { prisma } from "../prisma/prisma.js";
import { readDayList, weekdayOfLocalDay, type Weekday } from "../utils/workDays.js";
import { overviewAggregateSql, type OverviewSnapshot } from "./operationsOverviewAggregate.js";
import {
  operationsScope,
  taskDayWhere,
  attendanceDayWhere,
  taskStatusWhere,
  attendanceStatusWhere,
  pageBounds,
  type OperationsDay,
  type operationsQuery,
} from "./operationsScope.service.js";
import { managerTaskPresentation } from "./verification-v2/sequentialPolicy.js";
import type { VerificationActor } from "./verification-v2/authorization.service.js";
import type { z } from "zod";
type Query = z.infer<typeof operationsQuery>;
const taskSelect = {
  id: true,
  title: true,
  date: true,
  shiftStart: true,
  shiftEnd: true,
  status: true,
  staffSubmittedAt: true,
  verificationVersion: true,
  verificationState: true,
  completionOutcome: true,
  areaNameSnapshot: true,
  locationId: true,
  staffId: true,
  templateId: true,
  location: { select: { id: true, name: true, timezone: true } },
  staff: { select: { id: true, name: true } },
  assignments: {
    orderBy: [{ assignedAt: "desc" }, { id: "desc" }],
    take: 1,
    select: {
      id: true,
      staffId: true,
      status: true,
      isCurrent: true,
      staff: { select: { id: true, name: true } },
    },
  },
  verificationException: { select: { id: true, state: true } },
} satisfies Prisma.TaskInstanceSelect;
export type OperationTaskRow = Prisma.TaskInstanceGetPayload<{ select: typeof taskSelect }>;

function staffDayOffWhere(days: OperationsDay[]): Prisma.StaffWhereInput {
  const locationsByWeekday = new Map<Weekday, number[]>();
  for (const day of days) {
    const weekday = weekdayOfLocalDay(day.start, day.timezone);
    const locationIds = locationsByWeekday.get(weekday) ?? [];
    locationIds.push(day.locationId);
    locationsByWeekday.set(weekday, locationIds);
  }
  return {
    OR: Array.from(locationsByWeekday, ([weekday, locationIds]) => ({
      locationId: { in: locationIds },
      // Empty lists read as all seven days.
      workDays: { isEmpty: false },
      NOT: { workDays: { has: weekday } },
    })),
  };
}

export async function managerOperations(
  actor: VerificationActor,
  q: Query,
  kind: "overview" | "staff" | "tasks",
  now = new Date(),
) {
  const scope = await operationsScope(actor, q.locationId, q.date, now);
  const taskBase: Prisma.TaskInstanceWhereInput = {
    AND: [
      {
        isActive: true,
        status: { not: "CANCELLED" },
        location: { companyId: actor.companyId },
      },
      taskDayWhere(scope.days),
    ],
  };
  const attendanceBase = attendanceDayWhere(scope.days);
  const staffBase: Prisma.StaffWhereInput = {
    companyId: actor.companyId,
    isActive: true,
    locationId: { in: scope.days.map((d) => d.locationId) },
  };
  const taskDto = (
    t: Prisma.TaskInstanceGetPayload<{ select: typeof taskSelect }>,
  ) => ({
    ...managerTaskPresentation(t),
    rawStatus: t.status,
    carryOver:
      t.shiftStart <
      (scope.days.find((d) => d.locationId === t.locationId)?.start ??
        t.shiftStart),
  });
  return prisma.$transaction(
    async (tx) => {
      if (kind === "tasks") {
        const where: Prisma.TaskInstanceWhereInput = {
          AND: [
            taskBase,
            taskStatusWhere(q.status, now),
            ...(q.workerId ? [{ staffId: q.workerId }] : []),
            ...(q.q
              ? [
                  {
                    OR: [
                      {
                        title: { contains: q.q, mode: "insensitive" as const },
                      },
                      {
                        areaNameSnapshot: {
                          contains: q.q,
                          mode: "insensitive" as const,
                        },
                      },
                      {
                        staff: {
                          name: { contains: q.q, mode: "insensitive" as const },
                        },
                      },
                    ],
                  },
                ]
              : []),
          ],
        };
        const page = pageBounds(
          await tx.taskInstance.count({ where }),
          q.page,
          q.pageSize,
        );
        const rows = await tx.taskInstance.findMany({
          where,
          select: taskSelect,
          orderBy: [{ shiftStart: "asc" }, { id: "asc" }],
          skip: (page.page - 1) * page.pageSize,
          take: page.pageSize,
        });
        return { ...scope, ...page, rows: rows.map(taskDto) };
      }
      if (kind === "staff") {
        const where: Prisma.StaffWhereInput = {
          ...staffBase,
          ...(q.q ? { name: { contains: q.q, mode: "insensitive" } } : {}),
        };
        if (q.attendance === "off") {
          where.AND = staffDayOffWhere(scope.days);
        } else if (q.attendance === "missing") {
          where.attendances = { none: attendanceBase };
          where.NOT = staffDayOffWhere(scope.days);
        } else if (q.attendance !== "all") {
          where.attendances = {
            some: { AND: [attendanceBase, attendanceStatusWhere(q.attendance, now)] },
          };
        }
        const page = pageBounds(
          await tx.staff.count({ where }),
          q.page,
          q.pageSize,
        );
        const rows = await tx.staff.findMany({
          where,
          select: {
            id: true,
            name: true,
            locationId: true,
            workDays: true,
            location: { select: { id: true, name: true, timezone: true } },
            attendances: {
              where: attendanceBase,
              select: {
                id: true,
                date: true,
                status: true,
                expectedStart: true,
                expectedEnd: true,
                checkInTime: true,
                checkOutTime: true,
              },
              orderBy: { expectedStart: "asc" },
            },
            taskInstances: {
              where: taskBase,
              select: taskSelect,
              orderBy: { shiftStart: "asc" },
              take: 3,
            },
            _count: { select: { taskInstances: { where: taskBase } } },
          },
          orderBy: [{ name: "asc" }, { id: "asc" }],
          take: page.pageSize,
          skip: (page.page - 1) * page.pageSize,
        });
        const submitted = await tx.taskInstance.groupBy({
          by: ["staffId"],
          where: {
            AND: [
              taskBase,
              taskStatusWhere("submitted"),
              { staffId: { in: rows.map((r) => r.id) } },
            ],
          },
          _count: { _all: true },
        });
        const daysByLocation = new Map(scope.days.map((day) => [day.locationId, day]));
        return {
          ...scope,
          ...page,
          rows: rows.map((r) => {
            const day = r.locationId === null ? undefined : daysByLocation.get(r.locationId);
            const workDays = readDayList(r.workDays);
            return {
              ...r,
              workDays,
              offToday: !!day && !workDays.includes(weekdayOfLocalDay(day.start, day.timezone)),
              tasks: r.taskInstances.map(taskDto),
              taskCount: r._count.taskInstances,
              submittedCount:
                submitted.find((s) => s.staffId === r.id)?._count._all ?? 0,
              localDate: day?.localDate,
              attendance:
                r.attendances.find(
                  (a) => a.expectedStart <= now && a.expectedEnd > now,
                ) ??
                r.attendances.find((a) => !!a.checkInTime && !a.checkOutTime) ??
                r.attendances.at(-1) ??
                null,
              carryOver: r.attendances.some(
                (a) => a.expectedStart < (day?.start ?? a.expectedStart),
              ),
            };
          }),
        };
      }
      const snapshot = scope.days.length
        ? (await tx.$queryRaw<OverviewSnapshot[]>(overviewAggregateSql(actor.companyId, scope.days, now)))[0]!
        : { counts: [], hourly: [], lateIds: [], unassignedIds: [], taskIds: [], tasks: [], absent: [], reviews: [] };
      const aggregates = snapshot.counts;
      const sum = (key: "present" | "scheduled" | "totalStaff" | "totalTasks" | "submitted" | "inProgress" | "notStarted" | "overdue" | "reviewCount" | "verified" | "accepted") =>
        aggregates.reduce((total, row) => total + row[key], 0);
      const present = sum("present"), scheduled = sum("scheduled"), totalStaff = sum("totalStaff"),
        totalTasks = sum("totalTasks"), submitted = sum("submitted"), inProgress = sum("inProgress"),
        notStarted = sum("notStarted"), overdue = sum("overdue"), reviewCount = sum("reviewCount"),
        verified = sum("verified"), accepted = sum("accepted");
      const { lateIds, unassignedIds, taskIds, absent, reviews } = snapshot;
      // PostgreSQL JSON timestamps include UTC offsets; restore Date values
      // before using the same task DTO as the paginated operational endpoints.
      const previewById = new Map(snapshot.tasks.map(t => [t.id, {
        ...t,
        date: new Date(t.date),
        shiftStart: new Date(t.shiftStart),
        shiftEnd: new Date(t.shiftEnd),
        staffSubmittedAt: t.staffSubmittedAt ? new Date(t.staffSubmittedAt) : null,
      }]));
      const hydrate = (ids: number[]) => ids.flatMap(id => {
        const task = previewById.get(id);
        return task ? [task] : [];
      });
      const lateTasks = hydrate(lateIds), unassigned = hydrate(unassignedIds), tasks = hydrate(taskIds);
      const countsByLocation = new Map(aggregates.map(row => [row.locationId, row]));
      const comparison = scope.selected.map(location => {
        const counts = countsByLocation.get(location.id);
        return {
          location,
          present: counts?.present ?? 0,
          scheduled: counts?.scheduled ?? 0,
          tasks: counts?.totalTasks ?? 0,
          submitted: counts?.submitted ?? 0,
          reviews: counts?.reviewCount ?? 0,
        };
      });
      const attention = [
        ...absent.map((s) => ({
          key: `staff:${s.id}`,
          kind: "attendance",
          staff: s,
          location: s.location,
          reasonCode: "MISSING_CHECKIN",
        })),
        ...lateTasks.map((t) => ({
          key: `task:${t.id}`,
          kind: "task",
          task: taskDto(t),
          location: t.location,
          reasonCode: "OVERDUE",
        })),
        ...unassigned.map((t) => ({
          key: `unassigned:${t.id}`,
          kind: "task",
          task: taskDto(t),
          location: t.location,
          reasonCode: "UNASSIGNED",
        })),
        ...reviews.map((c) => ({
          key: `review:${c.id}`,
          kind: "review",
          caseId: c.id,
          task: previewById.has(c.taskInstanceId) ? taskDto(previewById.get(c.taskInstanceId)!) : null,
          location: previewById.get(c.taskInstanceId)?.location,
          reasonCode: c.reasonCode,
        })),
      ];
      return {
        ...scope,
        metrics: {
          present,
          scheduled,
          totalStaff,
          totalTasks,
          submitted,
          reviewCount,
          verified,
          accepted,
        },
        chart: { submitted, inProgress, notStarted, overdue },
        hourly: snapshot.hourly,
        attention,
        tasks: tasks.map(taskDto),
        comparison,
      };
    },
    { isolationLevel: "RepeatableRead" },
  );
}
