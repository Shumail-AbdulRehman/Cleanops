import { Request, Response } from "express";
import jwt from "jsonwebtoken";
import {
    managerSignupSchema,
    managerLoginSchema,
} from "../validations/manager.validation.js";
import { prisma } from "../prisma/prisma.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { ApiError } from "../utils/ApiError.js";
import { getKarachiDayRange } from "../utils/karachiTime.js";
import { generateAccessToken, generateRefreshToken, isPasswordCorrect } from "../utils/auth.js";
import { TokenPayload } from "../types/jwt.js";
import { getCookieOptions } from "../utils/cookies.js";

const TASK_START_GRACE_MINUTES = 5;




export const signupManager = async (req: Request, res: Response) => {

    const result = managerSignupSchema.safeParse(req.body);

    if (!result.success) {
        const errors = result.error.issues.map(e => ({
            field: e.path.join("."),
            message: e.message
        }));
        throw new ApiError(400, "Validation failed", errors);
    }

    const { name, email, password, companyName } = result.data;

    const existingManager = await prisma.manager.findUnique({
        where: { email }
    });

    if (existingManager) {
        throw new ApiError(409, "Manager with this email already exists");
    }



    const company = await prisma.company.create({
        data: { name: companyName }
    });

    const manager = await prisma.manager.create({
        data: {
            name,
            email,
            password,
            companyId: company.id
        }
    });

    const accessToken = generateAccessToken(manager, manager.role);
    const refreshToken = generateRefreshToken(manager, manager.role);

    await prisma.manager.update({
        where: { id: manager.id },
        data: { refreshToken }
    });

    const cookieOptions = getCookieOptions();

    res
        .status(201)
        .cookie("accessToken", accessToken, cookieOptions)
        .cookie("refreshToken", refreshToken, cookieOptions)
        .json(
            new ApiResponse(
                201,
                {
                    id: manager.id,
                    name: manager.name,
                    email: manager.email,
                    role: manager.role,
                    companyId: manager.companyId
                },
                "Manager registered successfully"
            )
        );
};

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

    if (req.user!.role !== "MANAGER") throw new ApiError(403, "Only managers can use this endpoint");

    const manager = await prisma.manager.findUnique({
        where: { id: req.user!.id },
        select: {
            id: true,
            name: true,
            email: true,
            role: true,
            companyId: true
        }
    });

    if (!manager) {
        throw new ApiError(404, "Manager not found");
    }

    res.status(200).json(new ApiResponse(200, manager, "Manager profile fetched successfully"));
};

export const getTodayStatus = async (req: Request, res: Response) => {
    if (req.user!.role !== "MANAGER") {
        throw new ApiError(403, "Only managers can use this endpoint");
    }

    const companyId = req.user!.companyId;
    const locationId = req.query.locationId ? Number(req.query.locationId) : null;

    if (req.query.locationId && Number.isNaN(locationId)) {
        throw new ApiError(400, "Invalid locationId");
    }

    const { start: today, end: tomorrow } = getKarachiDayRange();

    const locationWhere = {
        companyId,
        isActive: true,
        ...(locationId ? { id: locationId } : {}),
    };

    const locations = await prisma.location.findMany({
        where: locationWhere,
        select: {
            id: true,
            name: true,
            address: true,
        },
        orderBy: { name: "asc" },
    });

    if (locationId && locations.length === 0) {
        throw new ApiError(404, "Location not found in your company");
    }

    const allowedLocationIds = locations.map((location) => location.id);

    const staff = await prisma.staff.findMany({
        where: {
            companyId,
            isActive: true,
            ...(locationId ? { locationId } : {}),
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
                date: { gte: today, lt: tomorrow },
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
                date: { gte: today, lt: tomorrow },
                isActive: true,
                staffId: { in: staffIds },
                ...(allowedLocationIds.length > 0 ? { locationId: { in: allowedLocationIds } } : { locationId: -1 }),
            },
            orderBy: { shiftStart: "asc" },
            select: {
                id: true,
                title: true,
                status: true,
                shiftStart: true,
                shiftEnd: true,
                isLate: true,
                lateMinutes: true,
                staffId: true,
            },
        }),
    ]);

    const now = new Date();
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
                ...task,
                isCurrentlyLate: task.isLate || isPendingStartLate,
                displayLateMinutes: task.lateMinutes ?? derivedLateMinutes,
            };
        });

        const taskCounts = {
            pending: normalizedTasks.filter((task) => task.status === "PENDING").length,
            inProgress: normalizedTasks.filter((task) => task.status === "IN_PROGRESS").length,
            completed: normalizedTasks.filter((task) => task.status === "COMPLETED").length,
            missed: normalizedTasks.filter((task) => task.status === "MISSED").length,
            notCompletedInTime: normalizedTasks.filter((task) => task.status === "NOT_COMPLETED_INTIME").length,
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
            (attendance?.status === "MISSED_CHECKOUT" ? 1 : 0);

        return {
            staff: member,
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
                locations,
                summary,
                staffStatus,
            },
            "Today's status fetched successfully"
        )
    );
};
