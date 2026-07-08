import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma } from "../prisma/prisma.js";
import { ApiError } from "../utils/ApiError.js";
import { formatInTimeZone } from "date-fns-tz";
import {
  getZonedDayRange,
  getZonedDayRangeFromDateInput,
} from "../utils/dateTime.js";
import {
  requireActiveActor,
  requireOperationalRole,
  type VerificationActor,
} from "./verification-v2/authorization.service.js";
export const operationsQuery = z.object({
  locationId: z.coerce.number().int().positive().optional(),
  date: z.string().default("today"),
  q: z.string().trim().max(120).default(""),
  page: z.coerce.number().int().min(1).max(100000).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(20),
  attendance: z
    .enum(["all", "present", "absent", "upcoming", "missing", "off"])
    .default("all"),
  status: z
    .enum([
      "all",
      "submitted",
      "overdue",
      "in-progress",
      "not-started",
      "unassigned",
    ])
    .default("all"),
  workerId: z.coerce.number().int().positive().optional(),
});
export function locationDay(
  location: { id: number; timezone: string },
  date = "today",
  now = new Date(),
) {
  const range =
    date === "today"
      ? getZonedDayRange(now, location.timezone)
      : getZonedDayRangeFromDateInput(date, location.timezone);
  if (!range) throw new ApiError(400, "Choose a valid calendar date");
  return {
    locationId: location.id,
    timezone: location.timezone,
    localDate: formatInTimeZone(range.start, location.timezone, "yyyy-MM-dd"),
    ...range,
  };
}
export type OperationsDay = ReturnType<typeof locationDay>;
export function taskDayWhere(
  days: OperationsDay[],
): Prisma.TaskInstanceWhereInput {
  return {
    OR: days.map((d) => ({
      locationId: d.locationId,
      OR: [
        { date: { gte: d.start, lt: d.end } },
        { shiftStart: { lt: d.end }, shiftEnd: { gt: d.start } },
      ],
    })),
  };
}
export function attendanceDayWhere(
  days: OperationsDay[],
): Prisma.AttendanceWhereInput {
  return {
    OR: days.map((d) => ({
      locationId: d.locationId,
      OR: [
        { date: { gte: d.start, lt: d.end } },
        { expectedStart: { lt: d.end }, expectedEnd: { gt: d.start } },
      ],
    })),
  };
}
export const submittedWhere: Prisma.TaskInstanceWhereInput = {
  OR: [{ staffSubmittedAt: { not: null } }, { status: "COMPLETED" }],
};
export function taskStatusWhere(
  status: string,
  now = new Date(),
): Prisma.TaskInstanceWhereInput {
  const unfinished: Prisma.TaskInstanceWhereInput = { NOT: submittedWhere };
  if (status === "submitted") return submittedWhere;
  if (status === "unassigned") return { staffId: null };
  if (status === "overdue")
    return {
      AND: [
        unfinished,
        {
          OR: [
            { shiftEnd: { lt: now } },
            { status: { in: ["MISSED", "NOT_COMPLETED_INTIME"] } },
          ],
        },
      ],
    };
  const notOverdue: Prisma.TaskInstanceWhereInput = {
    NOT: taskStatusWhere("overdue", now),
  };
  if (status === "in-progress")
    return { AND: [unfinished, notOverdue, { status: "IN_PROGRESS" }] };
  if (status === "not-started")
    return { AND: [unfinished, notOverdue, { status: "PENDING" }] };
  return {};
}
export function attendanceStatusWhere(
  status: string,
  now = new Date(),
): Prisma.AttendanceWhereInput {
  if (status === "present") return { checkInTime: { not: null } };
  if (status === "absent")
    return {
      checkInTime: null,
      checkOutTime: null,
      status: "ABSENT",
      expectedStart: { lte: now },
    };
  if (status === "upcoming")
    return { checkInTime: null, status: "ABSENT", expectedStart: { gt: now } };
  return {};
}
export async function operationsScope(
  actor: VerificationActor,
  locationId?: number,
  date = "today",
  now = new Date(),
  includeInactive = false,
) {
  requireOperationalRole(actor);
  await requireActiveActor(actor);
  const locations = await prisma.location.findMany({
    where: {
      companyId: actor.companyId,
      ...(includeInactive ? {} : { isActive: true }),
      ...(actor.role === "MANAGER"
        ? { managerAssignments: { some: { managerId: actor.id } } }
        : {}),
    },
    select: { id: true, name: true, timezone: true },
    orderBy: { name: "asc" },
  });
  if (locationId && !locations.some((l) => l.id === locationId))
    throw new ApiError(403, "You do not have access to this location");
  const selected = locationId
    ? locations.filter((l) => l.id === locationId)
    : locations;
  const days = selected.map((l) => locationDay(l, date, now));
  // Validate the date even for an empty assigned scope.
  if (!days.length) locationDay({ id: 0, timezone: "UTC" }, date, now);
  return { locations, selected, days, asOf: now, date };
}
export function pageBounds(total: number, page: number, pageSize: number) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  return { total, page: Math.min(page, totalPages), pageSize, totalPages };
}
