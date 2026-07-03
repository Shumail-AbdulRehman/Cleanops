import cron from "node-cron";
import { prisma } from "../prisma/prisma.js";
import { getZonedDayRange, resolveZonedAttendanceWindow } from "../utils/dateTime.js";
import { syncTodaysOpenAttendanceWindow } from "../utils/syncAttendanceWindow.js";

const NEXT_SHIFT_LOOKAHEAD_MS = 2 * 60 * 60 * 1000;

export async function runAttendanceCron(now = new Date()) {
    try {
        console.log("Creating daily attendance records...");

        const eligibleStaff = await prisma.staff.findMany({
            where: {
                isActive: true,
                company: { isActive: true, operationalStatus: "ACTIVE" },
                locationId: { not: null },
                shiftStart: { not: null },
                shiftEnd: { not: null },
            },
            select: {
                id: true,
                locationId: true,
                shiftStart: true,
                shiftEnd: true,
                location: {
                    select: {
                        timezone: true,
                    },
                },
            },
        });

        for (const staff of eligibleStaff) {
            try {
                const { shiftStart, shiftEnd } = staff;
                const timeZone = staff.location?.timezone;
                const input = { staffId: staff.id, locationId: staff.locationId, shiftStart, shiftEnd, timeZone };
                await syncTodaysOpenAttendanceWindow(input, now, 'today');

                if (!timeZone || !shiftStart || !shiftEnd) continue;
                const { expectedStart } = resolveZonedAttendanceWindow({
                    baseDate: getZonedDayRange(now, timeZone).end, shiftStart, shiftEnd, timeZone,
                });
                if (expectedStart.getTime() - now.getTime() <= NEXT_SHIFT_LOOKAHEAD_MS) {
                    await syncTodaysOpenAttendanceWindow(input, now, 'next');
                }
            } catch (error) {
                console.error("Attendance preparation error for staff", staff.id, error);
            }
        }

        console.log(`Attendance preparation checked ${eligibleStaff.length} eligible staff`);
    } catch (error) {
        console.error("Attendance cron error:", error);
    }
}

cron.schedule("2 * * * *", () => runAttendanceCron(), { noOverlap: true });
