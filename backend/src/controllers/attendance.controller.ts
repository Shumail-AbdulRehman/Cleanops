import { attendanceDateScope } from "../services/attendanceWrites.service.js";
import { Request, Response } from "express";
import { prisma } from "../prisma/prisma.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { ApiError } from "../utils/ApiError.js";
import { assignShiftSchema } from "../validations/attendance.validation.js";
import { attendancePhotoPresentation } from "../services/attendanceMedia.service.js";
import { syncTodaysOpenAttendanceWindow } from "../utils/syncAttendanceWindow.js";
import { getScopedLocationIds, assertLocationAccess } from "../utils/scope.js";


export const assignShiftToStaff = async (req: Request, res: Response) => {
    const staffId = Number(req.params.id);
    if (!Number.isSafeInteger(staffId) || staffId < 1) throw new ApiError(400, "Invalid staff id");

    const result = assignShiftSchema.safeParse(req.body);

    if (!result.success) {
        const errors = result.error.issues.map(e => ({
            field: e.path.join("."),
            message: e.message,
        }));
        throw new ApiError(400, "Validation failed", errors);
    }

    const staff = await prisma.staff.findUnique({ where: { id: staffId } });

    if (!staff || staff.companyId !== req.user!.companyId) {
        throw new ApiError(404, "Staff not found in your company");
    }

    if (req.user!.role === "MANAGER") {
        if (!staff.locationId) {
            throw new ApiError(403, "You do not have access to this location");
        }
        assertLocationAccess(req.user!, staff.locationId);
    }

    if (!staff.isActive) {
        throw new ApiError(400, "Staff is deactivated");
    }

    const newShiftStartMin =
        result.data.shiftStart.getUTCHours() * 60 + result.data.shiftStart.getUTCMinutes();

    const newShiftEndMin =
        result.data.shiftEnd.getUTCHours() * 60 + result.data.shiftEnd.getUTCMinutes();

    const activeTemplates = await prisma.taskTemplate.findMany({
        where: { staffId, isActive: true },
        select: { id: true, title: true, shiftStart: true, shiftEnd: true },
    });

    const isWithinRange = (
        innerStart: number,
        innerEnd: number,
        outerStart: number,
        outerEnd: number
    ) => {
        if (outerEnd <= outerStart) outerEnd += 1440;
        if (innerEnd <= innerStart) innerEnd += 1440;

        if (innerStart < outerStart) {
            innerStart += 1440;
            innerEnd += 1440;
        }

        return innerStart >= outerStart && innerEnd <= outerEnd;
    };

    const conflicts = activeTemplates.filter(t => {
        const taskStart =
            t.shiftStart.getUTCHours() * 60 + t.shiftStart.getUTCMinutes();

        const taskEnd =
            t.shiftEnd.getUTCHours() * 60 + t.shiftEnd.getUTCMinutes();

        return !isWithinRange(taskStart, taskEnd, newShiftStartMin, newShiftEndMin);
    });

    if (conflicts.length > 0) {
        const formatTime = (d: Date) =>
            `${d.getUTCHours().toString().padStart(2, "0")}:${d
                .getUTCMinutes()
                .toString()
                .padStart(2, "0")}`;

        const details = conflicts.map(
            t => `"${t.title}" (${formatTime(t.shiftStart)} - ${formatTime(t.shiftEnd)})`
        );

        throw new ApiError(
            400,
            `Cannot update shift: ${conflicts.length} task(s) would fall outside the new shift window: ${details.join(
                ", "
            )}. Please reassign or update those tasks first.`
        );
    }

    const updated = await prisma.staff.update({
        where: { id: staffId },
        data: {
            shiftStart: result.data.shiftStart,
            shiftEnd: result.data.shiftEnd,
        },
        select: {
            id: true,
            name: true,
            email: true,
            shiftStart: true,
            shiftEnd: true,
            locationId: true,
        },
    });

    await syncTodaysOpenAttendanceWindow({
        staffId,
        locationId: updated.locationId,
        shiftStart: updated.shiftStart,
        shiftEnd: updated.shiftEnd,
    });

    res
        .status(200)
        .json(new ApiResponse(200, updated, "Shift assigned to staff successfully"));
};

export { checkIn, checkOut } from "./attendanceWrites.controller.js";

export { getStaffSelfAttendance as getMyAttendance } from "./attendanceSelf.controller.js";

export const getStaffAttendance = async (req: Request, res: Response) => {
    const companyId = req.user!.companyId;

    const filters: any = {};

    const scopedLocationIds = getScopedLocationIds(req.user!);

    if (req.query.locationId) {
        const locationId = Number(req.query.locationId);
        if (!Number.isSafeInteger(locationId) || locationId < 1) throw new ApiError(400, "Invalid locationId");
        assertLocationAccess(req.user!, locationId);
        filters.locationId = locationId;
    } else if (scopedLocationIds) {
        filters.locationId = { in: scopedLocationIds };
    }

    if (req.query.staffId) {
        const staffId = Number(req.query.staffId);
        if (!Number.isSafeInteger(staffId) || staffId < 1) throw new ApiError(400, "Invalid staffId");
        filters.staffId = staffId;
    }

    if (req.query.from !== undefined || req.query.to !== undefined) {
        if ((req.query.from !== undefined && typeof req.query.from !== "string") ||
            (req.query.to !== undefined && typeof req.query.to !== "string"))
            throw new ApiError(400, "Choose dates in YYYY-MM-DD format");
        const locations = await prisma.location.findMany({
            where: { companyId, ...(filters.locationId !== undefined ? { id: filters.locationId } : {}) },
            select: { id: true, timezone: true },
        });
        Object.assign(filters, attendanceDateScope(locations, req.query.from as string | undefined, req.query.to as string | undefined));
    }

    const attendance = await prisma.attendance.findMany({
        where: {
            ...filters,
            location: { companyId },
            staff: {
                companyId,
                isActive: true,
            },
        },
        orderBy: { date: "desc" },
        select: {
            id: true,
            staffId: true,
            locationId: true,
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
            staff: {
                select: { id: true, name: true, email: true },
            },
            location: {
                select: { id: true, name: true },
            },
        },
    });

    res.status(200).json(new ApiResponse(200, attendance.map(attendancePhotoPresentation), "Staff attendance fetched successfully"));
};
