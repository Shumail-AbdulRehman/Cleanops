import { withAccountCapacity } from '../services/accountAccess.service.js';
import { Request, Response } from "express";
import { managerTaskPresentation } from "../services/verification-v2/sequentialPolicy.js";
import tzLookup from "tz-lookup";
import { createLocationSchema, editLocationSchema } from "../validations/location.validation.js";
import { prisma } from "../prisma/prisma.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { ApiError } from "../utils/ApiError.js";
import { addUtcDays, getZonedDayRange, getZonedDayRangeFromDateInput } from "../utils/dateTime.js";
import { readDayList } from "../utils/workDays.js";
import { permanentlyDelete } from "../services/deletion.service.js";
import { getScopedLocationIds, assertLocationAccess } from "../utils/scope.js";

const timezoneFromCoordinates = (latitude: string, longitude: string) => {
  try {
    return tzLookup(Number(latitude), Number(longitude));
  } catch {
    return "UTC";
  }
};

export const createLocation = async (req: Request, res: Response) => {
  const payload = req.body?.data ?? req.body;
  const result = createLocationSchema.safeParse(payload);

  if (!result.success) {
    const errors = result.error.issues.map(e => ({
      field: e.path.join("."),
      message: e.message
    }));
    throw new ApiError(400, "Validation failed", errors);
  }

  const location = await withAccountCapacity(req.user!, 'locations', async tx => tx.location.create({
    data: {
      ...result.data,
      timezone: result.data.timezone ?? timezoneFromCoordinates(result.data.latitude, result.data.longitude),
      companyId: req.user!.companyId
    }
  }));

  res.status(201).json(new ApiResponse(201, location, "Location created successfully"));
};

export const editLocation = async (req: Request, res: Response) => {
  const locationId = Number(req.params.id);
  if (isNaN(locationId)) throw new ApiError(400, "Invalid location id");

  const payload = req.body?.data ?? req.body;
  const result = editLocationSchema.safeParse(payload);

  if (!result.success) {
    const errors = result.error.issues.map(e => ({
      field: e.path.join("."),
      message: e.message
    }));
    throw new ApiError(400, "Validation failed", errors);
  }

  const location = await prisma.location.findUnique({ where: { id: locationId ,isActive:true} });

  if (!location || location.companyId !== req.user!.companyId) {
    throw new ApiError(404, "Location not found in your company");
  }

  const coordinatesChanged =
    result.data.latitude !== location.latitude || result.data.longitude !== location.longitude;

  const updatedLocation = await prisma.location.update({
    where: { id: locationId },
    data: {
      ...result.data,
      ...(result.data.timezone
        ? {}
        : coordinatesChanged
          ? { timezone: timezoneFromCoordinates(result.data.latitude, result.data.longitude) }
          : {}),
    }
  });

  res.status(200).json(new ApiResponse(200, updatedLocation, "Location updated successfully"));
};

export const getLocations = async (req: Request, res: Response) => {
  const includeInactive = req.query.includeInactive;
  if (includeInactive !== undefined && includeInactive !== "true" && includeInactive !== "false") {
    throw new ApiError(400, "includeInactive must be true or false");
  }
  const scopedLocationIds = getScopedLocationIds(req.user!);

  const locations = await prisma.location.findMany({
    where: {
      companyId: req.user!.companyId,
      ...(includeInactive === "true" ? {} : { isActive: true }),
      ...(scopedLocationIds ? { id: { in: scopedLocationIds } } : {}),
    },
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      address: true,
      latitude: true,
      longitude: true,
      radiusMeters: true,
      isActive: true,
      timezone: true,
      _count: {
        select: {
          staff: {
            where: {
              isActive: true,
            },
          },
          taskTemplates: {
            where: {
              isActive: true,
            },
          },
        },
      },
    },
  });

  res.status(200).json(new ApiResponse(200, locations, "Locations fetched successfully"));
};

export const deleteLocation = async (req: Request, res: Response) => {
  await permanentlyDelete("location", Number(req.params.id), req.user!);
  res.status(200).json(new ApiResponse(200, {}, "Deleted permanently"));
};

export const getLocationById = async (req: Request, res: Response) => {
  const locationId = Number(req.params.id);
  if (isNaN(locationId)) throw new ApiError(400, "Invalid location id");
  const location = await prisma.location.findUnique({
    where: { id: locationId },
  });
  
  if (!location || location.companyId !== req.user!.companyId) {
    throw new ApiError(404, "Location not found in your company");
  }
  assertLocationAccess(req.user!, location.id);
  res.status(200).json(new ApiResponse(200, location, "Location fetched successfully"));
};

export const getLocationStatsById = async (req: Request, res: Response) => {
  const locationId = Number(req.params.id);
  if (isNaN(locationId)) throw new ApiError(400, "Invalid location id");

  const location = await prisma.location.findUnique({ where: { id: locationId } });
  if (!location || location.companyId !== req.user!.companyId) {
    throw new ApiError(404, "Location not found in your company");
  }

  assertLocationAccess(req.user!, location.id);

  
  const days = req.query.days ? Number(req.query.days) : null;
  const dateFromParam = req.query.dateFrom as string;
  const dateToParam = req.query.dateTo as string;

  let dateFilter = {};
  let periodLabel = "All time";

  
  if (dateFromParam && dateToParam) {
    const startRange = getZonedDayRangeFromDateInput(dateFromParam, location.timezone);
    const endRange = getZonedDayRangeFromDateInput(dateToParam, location.timezone);

    if (!startRange || !endRange) {
      throw new ApiError(400, "Invalid dateFrom or dateTo format. Use YYYY-MM-DD");
    }

    if (startRange.start > endRange.start) {
      throw new ApiError(400, "dateFrom must be before dateTo");
    }

    dateFilter = { date: { gte: startRange.start, lt: endRange.end } };
    const diffDays =
      Math.round((endRange.start.getTime() - startRange.start.getTime()) / (1000 * 60 * 60 * 24)) + 1;
    periodLabel = `${dateFromParam} to ${dateToParam} (${diffDays} days)`;
  } else if (days) {
    if (isNaN(days) || days <= 0) {
      throw new ApiError(400, "days must be a positive number");
    }

    const { start: todayStart, end: tomorrowStart } = getZonedDayRange(new Date(), location.timezone);
    const startDate = addUtcDays(todayStart, -(days - 1));

    dateFilter = { date: { gte: startDate, lt: tomorrowStart } };
    periodLabel = `Last ${days} days`;
  }

 const [locationInfo, taskStats] = await Promise.all([
  prisma.location.findUnique({
    where: { id: locationId },
    include: {
      taskInstances: {
        where: {
          isActive: true,
          ...dateFilter,
        },
        include: {
          assignments: {
            orderBy: { assignedAt: "asc" },
            include: {
              staff: {
                select: {
                  id: true,
                  name: true,
                  email: true,
                },
              },
            },
          },
        },
      },
      staff: {
        where:{
          isActive:true
        },
        select: {
          id: true, name: true, email: true, shiftStart: true, shiftEnd: true, isActive: true, workDays: true,
        },
      },
      taskTemplates: {where:{
        isActive:true
      },
      include:{
        staff: { select: { id: true, name: true } },
      }
    },
    },
  }),

  prisma.taskInstance.groupBy({
    by: ["status"],
    where: {
      locationId,
      isActive: true,
      ...dateFilter,
    },
    _count: {
      status: true,
      staffSubmittedAt: true,
    },
  }),
]);




  const counts = new Map<string, number>();
  for (const group of taskStats) {
    // Count non-null submission timestamps instead of grouping by each instant.
    const submitted = ["IN_PROGRESS", "NOT_COMPLETED_INTIME"].includes(group.status)
      ? group._count.staffSubmittedAt : 0;
    const remaining = group._count.status - submitted;
    if (remaining) counts.set(group.status, (counts.get(group.status) ?? 0) + remaining);
    if (submitted) counts.set("COMPLETED", (counts.get("COMPLETED") ?? 0) + submitted);
  }
  const presentedLocation = locationInfo ? {
    ...locationInfo,
    staff: locationInfo.staff.map(staff => ({ ...staff, workDays: readDayList(staff.workDays) })),
    taskInstances: locationInfo.taskInstances.map(managerTaskPresentation),
  } : null;
  const presentedStats = [...counts].map(([status, count]) => ({status, _count: {status: count}}));
  res.status(200).json(new ApiResponse(200, {locationInfo: presentedLocation, taskStats: presentedStats}, "Location stats fetched successfully"));
};
