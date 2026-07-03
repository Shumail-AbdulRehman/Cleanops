import { withAccountCapacity, assertAccountAction } from '../services/accountAccess.service.js';
import { deactivateWorkforce } from '../services/workforceLifecycle.service.js';
import { managerTaskPresentation } from "../services/verification-v2/sequentialPolicy.js";
import { Request, Response } from "express";
import jwt from "jsonwebtoken";
import {
    managerLoginSchema,
    createManagerSchema,
    updateManagerSchema,
} from "../validations/manager.validation.js";
import { prisma } from "../prisma/prisma.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { ApiError } from "../utils/ApiError.js";
import { DEFAULT_TIME_ZONE, getZonedDayRange } from "../utils/dateTime.js";
import { formatInTimeZone } from "date-fns-tz";
import { getScopedLocationIds, assertLocationAccess } from "../utils/scope.js";
import { generateAccessToken, generateRefreshToken, isPasswordCorrect } from "../utils/auth.js";
import { TokenPayload } from "../types/jwt.js";
import { getCookieOptions } from "../utils/cookies.js";

const TASK_START_GRACE_MINUTES = 5;




export { signupCompany as signupManager } from "./companyRegistration.controller.js";

export const loginManager = async (req: Request, res: Response) => {


   
    const result = managerLoginSchema.safeParse(req.body);
    
   

    if (!result.success) {
        const errors = result.error.issues.map(e => ({
            field: e.path.join("."),
            message: e.message
        }));
        throw new ApiError(400, "Validation failed", errors);
    }

    const { email, password } = result.data;

    const manager = await prisma.manager.findUnique({
        where: { email }
    });

    if (!manager) {
        throw new ApiError(401, "Invalid email or password");
    }

    if (!manager.isActive) {
        throw new ApiError(403, "Account is deactivated");
    }

    const validPassword = await isPasswordCorrect(password, manager.password);

    if (!validPassword) {
        throw new ApiError(401, "Invalid email or password");
    }

    const accessToken = generateAccessToken(manager, manager.role);
    const refreshToken = generateRefreshToken(manager, manager.role);

    await prisma.manager.update({
        where: { id: manager.id },
        data: { refreshToken }
    });

    const cookieOptions = getCookieOptions();

    res
        .status(200)
        .cookie("accessToken", accessToken, cookieOptions)
        .cookie("refreshToken", refreshToken, cookieOptions)
        .json(
            new ApiResponse(
                200,
                {
                    id: manager.id,
                    name: manager.name,
                    email: manager.email,
                    role: manager.role,
                    companyId: manager.companyId
                },
                "Login successful"
            )
        );
};

export const getManagerProfile = async (req: Request, res: Response) => {

    if (req.user!.role !== "MANAGER" && req.user!.role !== "ADMIN") throw new ApiError(403, "Only managers can use this endpoint");

    const manager = await prisma.manager.findUnique({
        where: { id: req.user!.id },
        select: {
            id: true,
            name: true,
            email: true,
            role: true,
            companyId: true,
            assignedLocations: {
                select: {
                    location: {
                        select: { id: true, name: true },
                    },
                },
            },
        }
    });

    if (!manager) {
        throw new ApiError(404, "Manager not found");
    }

    const { assignedLocations, ...rest } = manager;

    res.status(200).json(new ApiResponse(200, {
        ...rest,
        locations: assignedLocations.map((assignment) => assignment.location),
    }, "Manager profile fetched successfully"));
};

export const getTodayStatus = async (req: Request, res: Response) => {
    if (req.user!.role !== "MANAGER" && req.user!.role !== "ADMIN") {
        throw new ApiError(403, "Only managers can use this endpoint");
    }

    const companyId = req.user!.companyId;
    const locationId = req.query.locationId ? Number(req.query.locationId) : null;

    if (req.query.locationId && Number.isNaN(locationId)) {
        throw new ApiError(400, "Invalid locationId");
    }

    if (locationId) {
        assertLocationAccess(req.user!, locationId);
    }

    const scopedLocationIds = getScopedLocationIds(req.user!);

    const locationWhere = {
        companyId,
        isActive: true,
        ...(locationId
            ? { id: locationId }
            : scopedLocationIds
              ? { id: { in: scopedLocationIds } }
              : {}),
    };

    const locations = await prisma.location.findMany({
        where: locationWhere,
        select: {
            id: true,
            name: true,
            address: true,
            timezone: true,
        },
        orderBy: { name: "asc" },
    });

    if (locationId && locations.length === 0) {
        throw new ApiError(404, "Location not found in your company");
    }

    const now = new Date();

    const dayAnchors = [
        ...new Map(
            locations.map((location) => {
                const anchor = getZonedDayRange(now, location.timezone).start;
                return [anchor.getTime(), anchor];
            })
        ).values(),
    ];

    const today = dayAnchors[0] ?? getZonedDayRange(now, DEFAULT_TIME_ZONE).start;

    const allowedLocationIds = locations.map((location) => location.id);

    const staff = await prisma.staff.findMany({
        where: {
            companyId,
            isActive: true,
            ...(locationId
                ? { locationId }
                : scopedLocationIds
                  ? { locationId: { in: scopedLocationIds } }
                  : {}),
        },
        select: {
            id: true,
            name: true,
            email: true,
            locationId: true,
            shiftStart: true,
            shiftEnd: true,
            location: {
                select: {
                    id: true,
                    name: true,
                    timezone: true,
                },
            },
        },
        orderBy: { name: "asc" },
    });

    const staffIds = staff.map((member) => member.id);

    if (staffIds.length === 0) {
        return res.status(200).json(
            new ApiResponse(
                200,
                {
                    date: today.toISOString(),
                    asOf: now.toISOString(),
                    locations,
                    summary: {
                        totalStaff: 0,
                        present: 0,
                        absent: 0,
                        lateAttendance: 0,
                        shiftNotStarted: 0,
                        staffNeedingReview: 0,
                        pendingTasks: 0,
                        inProgressTasks: 0,
                        completedTasks: 0,
                        attentionTasks: 0,
                    },
                    staffStatus: [],
                },
                "Today's status fetched successfully"
            )
        );
    }

    const [attendanceRecords, taskInstances] = await Promise.all([
        prisma.attendance.findMany({
            where: {
                staffId: { in: staffIds },
                date: { in: dayAnchors },
                ...(locationId ? { locationId } : {}),
            },
            select: {
                id: true,
                staffId: true,
                status: true,
                expectedStart: true,
                expectedEnd: true,
                checkInTime: true,
                checkOutTime: true,
                lateMinutes: true,
            },
        }),
        prisma.taskInstance.findMany({
            where: {
                date: { in: dayAnchors },
                isActive: true,
                staffId: { in: staffIds },
                ...(allowedLocationIds.length > 0 ? { locationId: { in: allowedLocationIds } } : { locationId: -1 }),
            },
            orderBy: { shiftStart: "asc" },
            select: {
                id: true,
                title: true,
                status: true,
                verificationVersion:true, verificationState:true, completionOutcome:true, completionTiming:true, areaNameSnapshot:true, staffSubmittedAt:true,
                shiftStart: true,
                shiftEnd: true,
                isLate: true,
                lateMinutes: true,
                staffId: true,
                assignments: {
                    orderBy: { assignedAt: "asc" },
                    select: {
                        id: true,
                        staffId: true,
                        status: true,
                        reason: true,
                        isCurrent: true,
                        assignedAt: true,
                        startedAt: true,
                        completedAt: true,
                        failedAt: true,
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
        }),
    ]);

    const attendanceByStaff = new Map(attendanceRecords.map((record) => [record.staffId, record]));
    const tasksByStaff = new Map<number, typeof taskInstances>();

    for (const task of taskInstances) {
        if (!task.staffId) continue;
        const existing = tasksByStaff.get(task.staffId) ?? [];
        existing.push(task);
        tasksByStaff.set(task.staffId, existing);
    }

    const staffStatus = staff.map((member) => {
        const attendance = attendanceByStaff.get(member.id) ?? null;
        const tasks = tasksByStaff.get(member.id) ?? [];
        const normalizedTasks = tasks.map((task) => {
            const graceDeadline = new Date(task.shiftStart.getTime() + TASK_START_GRACE_MINUTES * 60 * 1000);
            const isPendingStartLate = task.status === "PENDING" && now > graceDeadline;
            const derivedLateMinutes = isPendingStartLate
                ? Math.floor((now.getTime() - task.shiftStart.getTime()) / (1000 * 60))
                : null;

            return {
                ...managerTaskPresentation(task),
                assignmentSummary: {
                    originalAssignee: task.assignments[0]?.staff ?? null,
                    currentAssignee: task.assignments.find((assignment) => assignment.isCurrent)?.staff ?? null,
                    reassignmentCount: Math.max(task.assignments.length - 1, 0),
                    lastReassignmentReason:
                        [...task.assignments].reverse().find((assignment) => assignment.reason)?.reason ?? null,
                },
                isCurrentlyLate: task.isLate || isPendingStartLate,
                displayLateMinutes: task.lateMinutes ?? derivedLateMinutes,
            };
        });

        const taskCounts = {
            pending: normalizedTasks.filter((task) => task.status === "PENDING").length,
            inProgress: normalizedTasks.filter((task) => task.status === "IN_PROGRESS").length,
            completed: normalizedTasks.filter((task) => task.status === "COMPLETED").length,
            missed: normalizedTasks.filter((task) => task.status === "MISSED").length,
            notCompletedInTime: normalizedTasks.filter((task) => task.status === "NOT_COMPLETED_INTIME" && task.verificationState!=="PROCESSING").length,
            cancelled: normalizedTasks.filter((task) => task.status === "CANCELLED").length,
            late: normalizedTasks.filter((task) => task.isCurrentlyLate).length,
            total: normalizedTasks.length,
        };

        const isPresent =
            attendance?.status === "CHECKED_IN" ||
            attendance?.status === "CHECKED_OUT" ||
            attendance?.status === "LATE";

        const isShiftNotStarted =
            !!attendance &&
            attendance.status === "ABSENT" &&
            !attendance.checkInTime &&
            !attendance.checkOutTime &&
            attendance.expectedStart > now;

        const attentionCount =
            taskCounts.missed +
            taskCounts.notCompletedInTime +
            taskCounts.late +
            normalizedTasks.filter(task=>task.verificationVersion===2&&["NEEDS_REVIEW","REWORK_REQUIRED"].includes(task.verificationState)).length +
            (attendance?.status === "MISSED_CHECKOUT" ? 1 : 0);

        return {
            staff: member,
            localDate: formatInTimeZone(now, member.location?.timezone ?? DEFAULT_TIME_ZONE, "yyyy-MM-dd"),
            attendance,
            attendanceDisplayStatus: isShiftNotStarted ? "SHIFT_NOT_STARTED" : attendance?.status ?? "NO_RECORD_TODAY",
            tasks: normalizedTasks,
            taskCounts,
            attentionCount,
            flags: {
                isAbsent: !!attendance && attendance.status === "ABSENT" && !isShiftNotStarted,
                isPresent: !!isPresent,
                isLateAttendance: attendance?.status === "LATE",
                isShiftNotStarted,
                hasPendingTasks: taskCounts.pending > 0,
                hasInProgressTasks: taskCounts.inProgress > 0,
                hasAttentionTasks: attentionCount > 0,
            },
        };
    });

    const summary = {
        totalStaff: staffStatus.length,
        present: staffStatus.filter((entry) => entry.flags.isPresent).length,
        absent: staffStatus.filter((entry) => entry.flags.isAbsent).length,
        lateAttendance: staffStatus.filter((entry) => entry.flags.isLateAttendance).length,
        shiftNotStarted: staffStatus.filter((entry) => entry.flags.isShiftNotStarted).length,
        staffNeedingReview: staffStatus.filter((entry) => entry.flags.hasAttentionTasks).length,
        pendingTasks: staffStatus.reduce((sum, entry) => sum + entry.taskCounts.pending, 0),
        inProgressTasks: staffStatus.reduce((sum, entry) => sum + entry.taskCounts.inProgress, 0),
        completedTasks: staffStatus.reduce((sum, entry) => sum + entry.taskCounts.completed, 0),
        attentionTasks: staffStatus.reduce(
            (sum, entry) =>
                sum + entry.attentionCount,
            0
        ),
    };

    res.status(200).json(
        new ApiResponse(
            200,
            {
                date: today.toISOString(),
                asOf: now.toISOString(),
                locations,
                summary,
                staffStatus,
            },
            "Today's status fetched successfully"
        )
    );
};


export const createManager = async (req: Request, res: Response) => {

    const result = createManagerSchema.safeParse(req.body);

    if (!result.success) {
        const errors = result.error.issues.map(e => ({
            field: e.path.join("."),
            message: e.message
        }));
        throw new ApiError(400, "Validation failed", errors);
    }

    const { name, email, password, locationIds } = result.data;
    const companyId = req.user!.companyId;

    const existingManager = await prisma.manager.findUnique({
        where: { email }
    });

    if (existingManager) {
        throw new ApiError(409, "Manager with this email already exists");
    }

    const uniqueLocationIds = [...new Set(locationIds)];

    const locations = await prisma.location.findMany({
        where: { id: { in: uniqueLocationIds }, companyId },
        select: { id: true },
    });

    if (locations.length !== uniqueLocationIds.length) {
        throw new ApiError(400, "One or more locations do not belong to your company");
    }

    const takenAssignments = await prisma.managerLocation.findMany({
        where: { locationId: { in: uniqueLocationIds } },
        select: {
            location: { select: { name: true } },
            manager: { select: { name: true } },
        },
    });

    if (takenAssignments.length > 0) {
        const conflicts = takenAssignments.map((taken) => `${taken.location.name} (assigned to ${taken.manager.name})`);
        throw new ApiError(409, `These locations are already assigned to another manager: ${conflicts.join(", ")}`);
    }

    const manager = await withAccountCapacity(req.user!, 'managers', async (tx) => {
        const created = await tx.manager.create({
            data: {
                name,
                email,
                password,
                role: "MANAGER",
                companyId,
            },
        });

        await tx.managerLocation.createMany({
            data: uniqueLocationIds.map((locationId) => ({
                managerId: created.id,
                locationId,
            })),
        });

        return created;
    });

    res.status(201).json(
        new ApiResponse(
            201,
            {
                id: manager.id,
                name: manager.name,
                email: manager.email,
                role: manager.role,
                companyId: manager.companyId,
                locationIds: uniqueLocationIds,
            },
            "Manager created successfully"
        )
    );
};

export const getManagers = async (req: Request, res: Response) => {

    const companyId = req.user!.companyId;

    const managers = await prisma.manager.findMany({
        where: { companyId, role: "MANAGER" },
        select: {
            id: true,
            name: true,
            email: true,
            isActive: true,
            createdAt: true,
            assignedLocations: {
                select: {
                    location: {
                        select: { id: true, name: true, isActive: true },
                    },
                },
            },
        },
        orderBy: { name: "asc" },
    });

    const data = managers.map((manager) => ({
        id: manager.id,
        name: manager.name,
        email: manager.email,
        isActive: manager.isActive,
        createdAt: manager.createdAt,
        locations: manager.assignedLocations.map((assignment) => assignment.location),
    }));

    res.status(200).json(new ApiResponse(200, data, "Managers fetched successfully"));
};

export const updateManager = async (req: Request, res: Response) => {
    await assertAccountAction(req.user!, "MANAGE_WORK");

    const managerId = Number(req.params.id);

    if (Number.isNaN(managerId)) {
        throw new ApiError(400, "Invalid manager id");
    }

    const result = updateManagerSchema.safeParse(req.body);

    if (!result.success) {
        const errors = result.error.issues.map(e => ({
            field: e.path.join("."),
            message: e.message
        }));
        throw new ApiError(400, "Validation failed", errors);
    }

    const { name, email, password, locationIds } = result.data;
    const companyId = req.user!.companyId;
    if (password !== undefined) throw new ApiError(400, 'Use your own password security settings. Manager password reset by another account is unavailable.');

    const target = await prisma.manager.findFirst({
        where: { id: managerId, companyId, role: "MANAGER" },
    });

    if (!target) {
        throw new ApiError(404, "Manager not found in your company");
    }

    if (email && email !== target.email) {
        const existingManager = await prisma.manager.findUnique({
            where: { email }
        });

        if (existingManager) {
            throw new ApiError(409, "Manager with this email already exists");
        }
    }

    const uniqueLocationIds = locationIds ? [...new Set(locationIds)] : undefined;

    if (uniqueLocationIds) {
        const locations = await prisma.location.findMany({
            where: { id: { in: uniqueLocationIds }, companyId },
            select: { id: true },
        });

        if (locations.length !== uniqueLocationIds.length) {
            throw new ApiError(400, "One or more locations do not belong to your company");
        }

        const takenAssignments = await prisma.managerLocation.findMany({
            where: { locationId: { in: uniqueLocationIds }, managerId: { not: managerId } },
            select: {
                location: { select: { name: true } },
                manager: { select: { name: true } },
            },
        });

        if (takenAssignments.length > 0) {
            const conflicts = takenAssignments.map((taken) => `${taken.location.name} (assigned to ${taken.manager.name})`);
            throw new ApiError(409, `These locations are already assigned to another manager: ${conflicts.join(", ")}`);
        }
    }

    const updated = await prisma.$transaction(async (tx) => {
        const manager = await tx.manager.update({
            where: { id: managerId },
            data: {
                ...(name !== undefined ? { name } : {}),
                ...(email !== undefined ? { email } : {}),
                ...(password !== undefined ? { password } : {}),
                ...(password !== undefined || (email !== undefined && email !== target.email) || uniqueLocationIds !== undefined
                    ? { credentialVersion: { increment: 1 }, refreshToken: null } : {}),
            },
        });

        if (uniqueLocationIds) {
            await tx.managerLocation.deleteMany({ where: { managerId } });
            await tx.managerLocation.createMany({
                data: uniqueLocationIds.map((locationId) => ({ managerId, locationId })),
            });
        }

        return manager;
    });

    res.status(200).json(
        new ApiResponse(
            200,
            {
                id: updated.id,
                name: updated.name,
                email: updated.email,
                role: updated.role,
                isActive: updated.isActive,
                companyId: updated.companyId,
            },
            "Manager updated successfully"
        )
    );
};

export const deleteManager = async (req: Request, res: Response) => {
  await assertAccountAction(req.user!, "MANAGE_WORK");
  const result = await deactivateWorkforce(req.user!, "manager", Number(req.params.id), req.body);
  res.status(200).json(new ApiResponse(200, result, "Manager deactivated; history preserved"));
};
