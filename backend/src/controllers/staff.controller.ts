import { assertNoWorkDayConflicts, insertStaff, lockStaffIdentities } from "../services/staffProvisioning.service.js";
import { requireLocationAccess } from '../services/verification-v2/authorization.service.js';
import { withAccountCapacity } from '../services/accountAccess.service.js';
import { deactivateWorkforce } from '../services/workforceLifecycle.service.js';
import { attendancePhotoPresentation } from "../services/attendanceMedia.service.js";
import {staffPerformanceReports} from '../services/verification-v2/reviewClosure.service.js';
import { Request, Response } from "express";
import type { ZodIssue } from "zod";
import {
  managerTaskPresentation,
  operationalTaskStatus,
} from "../services/verification-v2/sequentialPolicy.js";
import { editStaffSchema } from "../validations/staff.validation.js";
import { staffRecordSchema } from "../validations/staffRecord.validation.js";
import { prisma } from "../prisma/prisma.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { ApiError } from "../utils/ApiError.js";
import { INVALID_PAKISTAN_PHONE_MESSAGE } from "../utils/pakistanPhone.js";
import {
  DEFAULT_TIME_ZONE,
  getZonedDayRangeFromDateInput,
  getZonedMonthRange,
} from "../utils/dateTime.js";
import { fitsStaffShift } from "../utils/scheduleFit.js";
import { syncTodaysOpenAttendanceWindow } from "../utils/syncAttendanceWindow.js";
import { getScopedLocationIds, assertLocationAccess } from "../utils/scope.js";
import { readDayList, removedDays, type WeekdayList } from "../utils/workDays.js";

function staffValidationError(issues: readonly ZodIssue[]) {
  const workDaysIssue = issues.find((issue) => issue.code === "custom" && issue.params?.code === "INVALID_WORK_DAYS");
  if (workDaysIssue) {
    const { message } = workDaysIssue;
    return new ApiError(400, message, [{ field: "workDays", message, code: "INVALID_WORK_DAYS" }]);
  }

  if (issues.some((issue) => issue.code === "custom" && issue.params?.code === "INVALID_PHONE")) {
    return new ApiError(400, INVALID_PAKISTAN_PHONE_MESSAGE, [
      { field: "phone", message: INVALID_PAKISTAN_PHONE_MESSAGE, code: "INVALID_PHONE" },
    ]);
  }

  return new ApiError(400, "Validation failed", issues.map((issue) => ({
    field: issue.path.join("."),
    message: issue.message,
  })));
}

function withWorkDays<T extends { workDays?: WeekdayList }>(staff: T) {
  return { ...staff, workDays: readDayList(staff.workDays) };
}

export const createStaff = async (req: Request, res: Response) => {
  const result = staffRecordSchema.safeParse(req.body);
  if (!result.success) throw staffValidationError(result.error.issues);

  const { locationId } = result.data;

  if (req.user!.role === "MANAGER" && !locationId) throw new ApiError(403, "Choose an assigned site when creating staff");

  const staff = await withAccountCapacity(req.user!, 'staff', async tx => {
    if(locationId) {
      const location=await requireLocationAccess(req.user!,locationId,tx);
      if(!location.isActive) throw new ApiError(403,'Location is inactive');
    }
    return insertStaff(tx, req.user!.companyId, result.data);
  });

  const { password: _, ...safeStaff } = staff;

  res
    .status(201)
    .json(new ApiResponse(201, withWorkDays(safeStaff), "Staff created successfully"));
};

export const getStaff = async (req: Request, res: Response) => {
  const scopedLocationIds = getScopedLocationIds(req.user!);

  const staff = await prisma.staff.findMany({
    where: {
      companyId: req.user!.companyId,
      isActive: true,
      ...(scopedLocationIds ? { locationId: { in: scopedLocationIds } } : {}),
    },
    select: {
      id: true,
      name: true,
      email: true,
      phone: true,
      role: true,
      isActive: true,
      companyId: true,
      locationId: true,
      createdAt: true,
      updatedAt: true,
      shiftStart: true,
      shiftEnd: true,
      workDays: true,
    },
  });

  res
    .status(200)
    .json(new ApiResponse(200, staff.map(withWorkDays), "Staff fetched successfully"));
};

export const deleteStaff = async (req: Request, res: Response) => {
  const result = await deactivateWorkforce(req.user!, "staff", Number(req.params.id), req.body);
  res.status(200).json(new ApiResponse(200, result, "Staff deactivated; history preserved"));
};

export const getStaffById = async (req: Request, res: Response) => {
  const staffId = Number(req.params.id);
  if (isNaN(staffId)) throw new ApiError(400, "Invalid staff id");

  const staff = await prisma.staff.findUnique({
    where: { id: staffId },
    select: {
      id: true,
      name: true,
      email: true,
      phone: true,
      role: true,
      isActive: true,
      companyId: true,
      locationId: true,
      createdAt: true,
      updatedAt: true,
      shiftStart: true,
      shiftEnd: true,
      workDays: true,
    },
  });

  if (!staff || staff.companyId !== req.user!.companyId) {
    throw new ApiError(404, "Staff not found in your company");
  }

  if (req.user!.role === "MANAGER") {
    if (!staff.locationId) {
      throw new ApiError(403, "You do not have access to this location");
    }
    assertLocationAccess(req.user!, staff.locationId);
  }

  res
    .status(200)
    .json(new ApiResponse(200, withWorkDays(staff), "Staff fetched successfully"));
};

export const getStaffByLocation = async (req: Request, res: Response) => {
  const locationId = Number(req.params.locationId);
  if (isNaN(locationId)) throw new ApiError(400, "Invalid location id");

  assertLocationAccess(req.user!, locationId);

  const location = await prisma.location.findUnique({
    where: { id: locationId },
  });

  if (!location || location.companyId !== req.user!.companyId) {
    throw new ApiError(404, "Location not found in your company");
  }

  const staff = await prisma.staff.findMany({
    where: { companyId: req.user!.companyId, locationId, isActive: true },
    select: {
      id: true,
      name: true,
      email: true,
      phone: true,
      role: true,
      isActive: true,
      companyId: true,
      locationId: true,
      createdAt: true,
      updatedAt: true,
      shiftStart: true,
      shiftEnd: true,
      workDays: true,
    },
  });

  res
    .status(200)
    .json(new ApiResponse(200, staff.map(withWorkDays), "Staff fetched successfully"));
};

// Retain the legacy export for internal callers with the same actor-safe contract.
export { getStaffSelfProfile as getProfile } from "./staffSelf.controller.js";

export const editStaff = async (req: Request, res: Response) => {
  const staffId = Number(req.params.id);
  if (isNaN(staffId)) throw new ApiError(400, "Invalid staff id");

  const result = editStaffSchema.safeParse(req.body);
  if (!result.success) throw staffValidationError(result.error.issues);

  const actor = req.user!;
  const { phone, email, shiftStart, shiftEnd, workDays } = result.data;
  const shiftChanged = shiftStart !== undefined || shiftEnd !== undefined;

  const { updated, workDaysChanged } = await prisma.$transaction(async (tx) => {
    // Read the current identity and shift after locking the row against concurrent edits.
    await tx.$queryRaw`SELECT id FROM "Staff" WHERE id = ${staffId} AND "companyId" = ${actor.companyId} FOR UPDATE`;
    const staff = await tx.staff.findUnique({
      where: { id: staffId, companyId: actor.companyId },
      include: { location: { select: { timezone: true } } },
    });

    if (!staff) {
      throw new ApiError(404, "Staff not found in your company");
    }

    if (!staff.isActive) {
      throw new ApiError(400, "Cannot edit deactivated staff");
    }

    if (staff.locationId) {
      assertLocationAccess(actor, staff.locationId);
    }

    const newPhone = phone !== staff.phone ? phone : undefined;
    const newEmail = email && email !== staff.email ? email : undefined;
    if (newPhone) {
      await lockStaffIdentities(tx, [{ phone: newPhone, email: newEmail }]);
    } else if (newEmail) {
      // Use provisioning's email lock for email-only edits, including legacy rows without a phone.
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(lower(${newEmail}), 1542))::text`;
    }

    if (newPhone && await tx.staff.findUnique({ where: { phone: newPhone }, select: { id: true } })) {
      throw new ApiError(409, "This phone number is already used by another staff member.", [{ code: "PHONE_IN_USE" }]);
    }
    if (newEmail && await tx.staff.findFirst({
      where: { id: { not: staffId }, email: { equals: newEmail, mode: "insensitive" } },
      select: { id: true },
    })) {
      throw new ApiError(409, "This email is already used by another staff member.", [{ code: "EMAIL_IN_USE" }]);
    }

    if (result.data.shiftStart || result.data.shiftEnd) {
      const newStart = result.data.shiftStart ?? staff.shiftStart;
      const newEnd = result.data.shiftEnd ?? staff.shiftEnd;

      if (newStart && newEnd) {
        const staffTemplates = await tx.taskTemplate.findMany({
          where: {
            staffId,
            isActive: true,
          },
          include: { location: { select: { timezone: true } } },
        });

        const newShift = { shiftStart: newStart, shiftEnd: newEnd };
        const conflicts = staffTemplates.filter((template) =>
          !fitsStaffShift(template, newShift, template.location.timezone),
        );

        if (conflicts.length > 0) {
          const names = conflicts.map((c) => `"${c.title}"`).join(", ");
          throw new ApiError(
            400,
            `Cannot update shift: ${names} task template(s) fall outside the new shift window. Remove or reassign them first.`,
          );
        }
      }
    }

    const previousWorkDays = readDayList(staff.workDays);
    const removed = workDays === undefined ? [] : removedDays(previousWorkDays, workDays);
    if (removed.length) {
      await assertNoWorkDayConflicts(tx, staff, removed);
    }
    const workDaysChanged = workDays !== undefined &&
      (removed.length > 0 || workDays.length > previousWorkDays.length);

    const updated = await tx.staff.update({
      where: { id: staffId },
      data: {
        ...result.data,
        ...(newPhone ? { credentialVersion: { increment: 1 }, refreshToken: null } : {}),
      },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        role: true,
        isActive: true,
        companyId: true,
        locationId: true,
        shiftStart: true,
        shiftEnd: true,
        workDays: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    if (newPhone) {
      await tx.staffPushDevice.updateMany({
        where: { staffId, companyId: actor.companyId },
        data: { enabled: false },
      });
    }

    return { updated, workDaysChanged };
  });

  if (shiftChanged || workDaysChanged) {
    const attendanceStaff = {
      staffId,
      locationId: updated.locationId,
      shiftStart: updated.shiftStart,
      shiftEnd: updated.shiftEnd,
    };
    if (workDaysChanged) {
      const now = new Date();
      await syncTodaysOpenAttendanceWindow(attendanceStaff, now);
      await syncTodaysOpenAttendanceWindow(attendanceStaff, now, "next");
    } else {
      await syncTodaysOpenAttendanceWindow(attendanceStaff);
    }
  }

  res
    .status(200)
    .json(new ApiResponse(200, withWorkDays(updated), "Staff updated successfully"));
};

export const getStaffDetails = async (req: Request, res: Response) => {
  if (!req.user) throw new ApiError(401, "Sign in to continue");
  if (req.user.role !== "ADMIN" && req.user.role !== "MANAGER")
    throw new ApiError(403, "Manager or owner account required");
  const staffId = Number(req.params.id);
  if (!Number.isSafeInteger(staffId) || staffId < 1) throw new ApiError(400, "Invalid staff id");

  const monthParam = req.query.month as string | undefined;
  const dateFromParam = req.query.dateFrom as string | undefined;
  const dateToParam = req.query.dateTo as string | undefined;

  const staff = await prisma.staff.findUnique({
    where: { id: staffId },
    select: {
      id: true,
      name: true,
      email: true,
      phone: true,
      role: true,
      isActive: true,
      companyId: true,
      locationId: true,
      shiftStart: true,
      shiftEnd: true,
      workDays: true,
      createdAt: true,
      updatedAt: true,
      location: {
        select: { id: true, name: true, address: true, timezone: true },
      },
    },
  });

  if (!staff || staff.companyId !== req.user!.companyId) {
    throw new ApiError(404, "Staff not found in your company");
  }

  if (req.user!.role === "MANAGER") {
    if (!staff.locationId) {
      throw new ApiError(403, "You do not have access to this location");
    }
    assertLocationAccess(req.user!, staff.locationId);
  }

  const timeZone = staff.location?.timezone ?? DEFAULT_TIME_ZONE;

  let dateFilter: { gte?: Date; lt?: Date } | undefined;
  let periodLabel = "All time";

  if (monthParam) {
    const match = /^(\d{4})-(\d{2})$/.exec(monthParam);
    if (!match) {
      throw new ApiError(400, "Invalid month format. Use YYYY-MM");
    }

    const year = Number(match[1]);
    const monthIndex = Number(match[2]) - 1;

    if (monthIndex < 0 || monthIndex > 11) {
      throw new ApiError(400, "Invalid month value");
    }

    const monthRange = getZonedMonthRange(year, monthIndex, timeZone);
    if (!monthRange) {
      throw new ApiError(400, "Invalid month value");
    }

    dateFilter = { gte: monthRange.start, lt: monthRange.end };
    periodLabel = new Date(Date.UTC(year, monthIndex, 15)).toLocaleDateString(
      "en-US",
      {
        month: "long",
        year: "numeric",
        timeZone,
      },
    );
  } else if (dateFromParam || dateToParam) {
    if (!dateFromParam || !dateToParam) {
      throw new ApiError(400, "Both dateFrom and dateTo are required together");
    }

    const startRange = getZonedDayRangeFromDateInput(dateFromParam, timeZone);
    const endRange = getZonedDayRangeFromDateInput(dateToParam, timeZone);

    if (!startRange || !endRange) {
      throw new ApiError(
        400,
        "Invalid dateFrom or dateTo format. Use YYYY-MM-DD",
      );
    }

    if (startRange.start > endRange.start) {
      throw new ApiError(400, "dateFrom must be before dateTo");
    }

    dateFilter = { gte: startRange.start, lt: endRange.end };
    periodLabel = `${dateFromParam} to ${dateToParam}`;
  }

  // A worker's current site does not authorize their previous sites. Apply
  // the same record-location boundary to both rows and every aggregate.
  const scopedLocationIds = getScopedLocationIds(req.user);
  const historyScope = {
    location: { companyId: req.user.companyId },
    ...(scopedLocationIds === null ? {} : { locationId: { in: scopedLocationIds } }),
  };

  const taskInstanceWhere = {
    staffId,
    ...historyScope,
    isActive: true,
    ...(dateFilter
      ? {
          OR: [
            { date: dateFilter },
            {
              shiftStart: { lt: dateFilter.lt },
              shiftEnd: { gt: dateFilter.gte },
            },
          ],
        }
      : {}),
  };

  const attendanceWhere = {
    staffId,
    ...historyScope,
    ...(dateFilter
      ? {
          OR: [
            { date: dateFilter },
            {
              expectedStart: { lt: dateFilter.lt },
              expectedEnd: { gt: dateFilter.gte },
            },
          ],
        }
      : {}),
  };

  const [
    taskTemplates,
    taskInstances,
    attendances,
    totalTaskTemplates,
    taskStatusGroups,
    lateTaskCount,
    attendanceStatusGroups,
    lateAttendanceCount,
  ] = await Promise.all([
    prisma.taskTemplate.findMany({
      where: { staffId, isActive: true, ...historyScope },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        title: true,
        description: true,
        recurringType: true,
        repeatDays: true,
        isActive: true,
        shiftStart: true,
        shiftEnd: true,
        effectiveDate: true,
        location: { select: { id: true, name: true, timezone: true } },
      },
    }),
    prisma.taskInstance.findMany({
      where: taskInstanceWhere,
      orderBy: { date: "desc" },
      take: 50,
      select: {
        id: true,
        title: true,
        date: true,
        shiftStart: true,
        shiftEnd: true,
        status: true,
        isLate: true,
        startedAt: true,
        completedAt: true,
        proofImageUrls: true,
        verificationVersion: true,
        verificationState: true,
        completionOutcome: true,
        completionTiming: true,
        areaNameSnapshot: true,
        staffSubmittedAt: true,
        location: { select: { id: true, name: true, timezone: true } },
      },
    }),
    prisma.attendance.findMany({
      where: attendanceWhere,
      orderBy: { date: "desc" },
      take: 50,
      select: {
        id: true,
        date: true,
        expectedStart: true,
        expectedEnd: true,
        checkInTime: true,
        checkOutTime: true,
        status: true,
        isLateCheckIn: true,
        lateMinutes: true,
        checkInImage: true,
        checkOutImage: true,
        location: { select: { id: true, name: true, timezone: true } },
      },
    }),
    prisma.taskTemplate.count({
      where: { staffId, isActive: true, ...historyScope },
    }),
    prisma.taskInstance.groupBy({
      by: ["status", "staffSubmittedAt"],
      where: taskInstanceWhere,
      _count: { status: true },
    }),
    prisma.taskInstance.count({
      where: {
        ...taskInstanceWhere,
        isLate: true,
      },
    }),
    prisma.attendance.groupBy({
      by: ["status"],
      where: attendanceWhere,
      _count: { status: true },
    }),
    prisma.attendance.count({
      where: {
        AND: [attendanceWhere, { OR: [{ status: "LATE" }, { isLateCheckIn: true }] }],
      },
    }),
  ]);

  const totalTaskInstances = taskStatusGroups.reduce(
    (sum, group) => sum + group._count.status,
    0,
  );
  const totalAttendanceRecords = attendanceStatusGroups.reduce(
    (sum, group) => sum + group._count.status,
    0,
  );

  const taskStatusMap = new Map<string, number>();
  for (const group of taskStatusGroups) {
    const status = operationalTaskStatus(group);
    taskStatusMap.set(
      status,
      (taskStatusMap.get(status) ?? 0) + group._count.status,
    );
  }
  const attendanceStatusMap = new Map(
    attendanceStatusGroups.map((group) => [group.status, group._count.status]),
  );

  const performanceIssues = await staffPerformanceReports(req.user!, staffId, dateFilter);

  const taskStats = {
    totalTemplates: totalTaskTemplates,
    totalInstances: totalTaskInstances,
    completed: taskStatusMap.get("COMPLETED") ?? 0,
    pending: taskStatusMap.get("PENDING") ?? 0,
    inProgress: taskStatusMap.get("IN_PROGRESS") ?? 0,
    missed: taskStatusMap.get("MISSED") ?? 0,
    late: lateTaskCount,
  };

  const attendanceStats = {
    totalRecords: totalAttendanceRecords,
    present:
      (attendanceStatusMap.get("CHECKED_IN") ?? 0) +
      (attendanceStatusMap.get("CHECKED_OUT") ?? 0),
    absent: attendanceStatusMap.get("ABSENT") ?? 0,
    late: lateAttendanceCount,
    missedCheckout: attendanceStatusMap.get("MISSED_CHECKOUT") ?? 0,
  };

  res.status(200).json(
    new ApiResponse(
      200,
      {
        ...withWorkDays(staff),
        taskTemplates: taskTemplates.map((template) => ({
          ...template,
          repeatDays: readDayList(template.repeatDays),
        })),
        taskInstances: taskInstances.map(managerTaskPresentation),
        attendances: attendances.map(attendancePhotoPresentation),
        taskStats,
        attendanceStats,
        performanceIssues,
        periodLabel,
      },
      "Staff details fetched successfully",
    ),
  );
};
