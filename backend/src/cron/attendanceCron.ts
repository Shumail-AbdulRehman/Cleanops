import cron from "node-cron";
import { prisma } from "../prisma/prisma.js";
import {
    KARACHI_TIMEZONE,
    getKarachiDayRange,
    resolveAttendanceWindow,
} from "../utils/karachiTime.js";
import { syncTodaysOpenAttendanceWindow } from "../utils/syncAttendanceWindow.js";

cron.schedule("*/5 * * * *", async () => {
    try {
        console.log("Creating daily attendance records...");

        const { start: today } = getKarachiDayRange();

        const eligibleStaff = await prisma.staff.findMany({
            where: {
                isActive: true,
                locationId: { not: null },
                shiftStart: { not: null },
                shiftEnd: { not: null },
            },
            select: {
                id: true,
                locationId: true,
                shiftStart: true,
                shiftEnd: true,
            },
        });

        const attendanceToCreate = [];

        for (const staff of eligibleStaff) {
            const { date, expectedStart, expectedEnd } = resolveAttendanceWindow({
                baseDate: today,
                shiftStart: staff.shiftStart!,
                shiftEnd: staff.shiftEnd!,
            });

            attendanceToCreate.push({
                    staffId: staff.id,
                    locationId: staff.locationId!,
                    date,
                    expectedStart,
                    expectedEnd,
                    status: "ABSENT" as const,
            });
        }

        const { count: created } = attendanceToCreate.length
            ? await prisma.attendance.createMany({
                data: attendanceToCreate,
                skipDuplicates: true,
            })
            : { count: 0 };

        for (const staff of eligibleStaff) {
            await syncTodaysOpenAttendanceWindow({
                staffId: staff.id,
                locationId: staff.locationId,
                shiftStart: staff.shiftStart,
                shiftEnd: staff.shiftEnd,
            });
        }

        console.log(`Attendance records created: ${created}`);
    } catch (error) {
        console.error("Attendance cron error:", error);
    }
}, { timezone: KARACHI_TIMEZONE });
