import type { Request, Response } from "express";
import { prisma } from "../prisma/prisma.js";
import { STAFF_FALLBACK_TIME_ZONE } from "../services/mobile/staffMonth.js";
import { ApiError } from "../utils/ApiError.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { getZonedDayRange, isValidTimeZone } from "../utils/dateTime.js";
import { isWorkDay, nextWorkShiftStart, readDayList } from "../utils/workDays.js";

export const getStaffSelfProfile = async (req: Request, res: Response) => {
  const actor = req.user;
  if (!actor) throw new ApiError(401, "Sign in to continue");
  if (actor.role !== "STAFF") throw new ApiError(403, "Staff account required");

  const staff = await prisma.staff.findFirst({
    where: {
      id: actor.id,
      companyId: actor.companyId,
      role: "STAFF",
      isActive: true,
      company: { isActive: true },
    },
    select: {
      id: true, name: true, email: true, phone: true, role: true,
      isActive: true, companyId: true, locationId: true,
      createdAt: true, updatedAt: true, shiftStart: true, shiftEnd: true,
      workDays: true, location: { select: { timezone: true } },
    },
  });
  if (!staff) throw new ApiError(404, "Staff not found");
  const { location, workDays: storedWorkDays, ...profile } = staff;
  const { shiftStart, shiftEnd } = profile;
  const workDays = readDayList(storedWorkDays);
  const timeZone = location
    ? (isValidTimeZone(location.timezone) ? location.timezone : STAFF_FALLBACK_TIME_ZONE)
    : undefined;
  const now = new Date();
  const offToday = timeZone && shiftStart && shiftEnd
    ? !isWorkDay(workDays, getZonedDayRange(now, timeZone).start, timeZone)
    : false;
  const nextShiftStart = nextWorkShiftStart({ shiftStart, shiftEnd, workDays, timeZone, now });

  res.status(200).json(new ApiResponse(200, {
    ...profile,
    workDays,
    offToday,
    nextShiftStart: nextShiftStart?.toISOString() ?? null,
  }, "Profile fetched successfully"));
};
