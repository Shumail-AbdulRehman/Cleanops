import type { Request, Response } from "express";
import { prisma } from "../prisma/prisma.js";
import { ApiError } from "../utils/ApiError.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { assertLocationAccess } from "../utils/scope.js";
import { addCalendarDays, normalizeMonday, projectWeek } from "../services/schedulePreview.service.js";
import { getZonedDayRangeFromDateInput } from "../utils/dateTime.js";

export const getLocationSchedule = async (req: Request, res: Response) => {
  const idValue = String(req.params.id);
  if (!/^[1-9]\d*$/.test(idValue) || !Number.isSafeInteger(Number(idValue))) throw new ApiError(400, "Invalid location id");
  const locationId = Number(idValue);
  assertLocationAccess(req.user!, locationId);
  const location = await prisma.location.findFirst({
    where: { id: locationId, companyId: req.user!.companyId, isActive: true },
    select: { id: true, name: true, timezone: true },
  });
  if (!location) throw new ApiError(404, "Location not found in your company");
  if (req.query.week !== undefined && typeof req.query.week !== "string") throw new ApiError(400, "Invalid week. Use YYYY-MM-DD");
  const now = new Date();
  const weekStart = normalizeMonday(req.query.week as string | undefined, now, location.timezone);
  if (!weekStart) throw new ApiError(400, "Invalid week. Use YYYY-MM-DD");
  const start = getZonedDayRangeFromDateInput(weekStart, location.timezone)!.start;
  const end = getZonedDayRangeFromDateInput(addCalendarDays(weekStart, 7), location.timezone)!.start;
  const earliestOccurrence = getZonedDayRangeFromDateInput(addCalendarDays(weekStart, -2), location.timezone)!.start;
  const [templates, instances] = await Promise.all([
    prisma.taskTemplate.findMany({
      where: { locationId, isActive: true, recurringType: { in: ["DAILY", "ONCE"] } },
      select: { id: true, title: true, shiftStart: true, shiftEnd: true, effectiveDate: true,
        recurringType: true, recurringEndDate: true, repeatDays: true,
        staff: { select: { id: true, name: true, shiftStart: true, shiftEnd: true } } },
    }),
    prisma.taskInstance.findMany({
      where: { locationId, isActive: true, OR: [
        { shiftStart: { lt: end }, shiftEnd: { gt: start } },
        { date: { gte: earliestOccurrence, lt: end } },
      ] },
      select: { id: true, templateId: true, title: true, date: true, shiftStart: true, shiftEnd: true, status: true, verificationVersion:true,verificationState:true,completionOutcome:true,areaNameSnapshot:true,
        staff: { select: { id: true, name: true } },
        assignments: { where: { isCurrent: true }, take: 1, select: { staff: { select: { id: true, name: true } } } } },
    }),
  ]);
  const projection = projectWeek({ weekStart, timezone: location.timezone, now, templates, instances });
  res.status(200).json(new ApiResponse(200, { location, ...projection, asOf: now.toISOString() }, "Location week schedule fetched successfully"));
};
