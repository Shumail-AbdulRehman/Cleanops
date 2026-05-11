import { prisma } from "../prisma/prisma.js";
import { resolveTaskInstanceWindow } from "./taskInstanceWindow.js";
import { getKarachiDayRange, resolveAttendanceWindow } from "../utils/karachiTime.js";
import { syncTodaysOpenAttendanceWindow } from "../utils/syncAttendanceWindow.js";


export async function runStartupCron(): Promise<void> {
    try {
        const { start: today, end: tomorrow } = getKarachiDayRange();

       

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

        const { count: attendanceCreated } = attendanceToCreate.length
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

       

        const dailyTemplates = await prisma.taskTemplate.findMany({
            where: {
                isActive: true,
                recurringType: "DAILY",
                effectiveDate: { lte: tomorrow },
                OR: [
                    { recurringEndDate: null },
                    { recurringEndDate: { gte: today } },
                ],
            },
            include: {
                staff: {
                    select: {
                        shiftStart: true,
                        shiftEnd: true,
                    },
                },
            },
        });

        const onceTemplates = await prisma.taskTemplate.findMany({
            where: {
                isActive: true,
                recurringType: "ONCE",
                effectiveDate: { gte: today, lt: tomorrow },
            },
            include: {
                staff: {
                    select: {
                        shiftStart: true,
                        shiftEnd: true,
                    },
                },
            },
        });

        const instancesToCreate = [];

        for (const template of [...dailyTemplates, ...onceTemplates]) {
            const { date, shiftStart, shiftEnd } = resolveTaskInstanceWindow({
                baseDate: today,
                taskShiftStart: template.shiftStart,
                taskShiftEnd: template.shiftEnd,
                staffShiftStart: template.staff?.shiftStart,
                staffShiftEnd: template.staff?.shiftEnd,
            });

            instancesToCreate.push({
                    templateId: template.id,
                    title: template.title,
                    date,
                    shiftStart,
                    shiftEnd,
                    staffId: template.staffId,
                    locationId: template.locationId,
            });
        }

        const { count: tasksCreated } = instancesToCreate.length
            ? await prisma.taskInstance.createMany({
                data: instancesToCreate,
                skipDuplicates: true,
            })
            : { count: 0 };

        if (attendanceCreated > 0 || tasksCreated > 0) {
            console.log(
                `Startup cron: created ${attendanceCreated} attendance record(s) and ${tasksCreated} task instance(s) for today.`
            );
        } else {
            console.log("Startup cron: all today's records already exist.");
        }
    } catch (error) {
        console.error("Startup cron error:", error);
    }
}
