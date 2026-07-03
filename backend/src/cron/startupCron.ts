import { generateTaskInstances } from "../services/verification-v2/inventorySnapshot.service.js";
import { prisma } from "../prisma/prisma.js";
import { buildScheduleOccurrences } from "./scheduleOccurrences.js";
import { syncTodaysOpenAttendanceWindow } from "../utils/syncAttendanceWindow.js";
import { ensureAssignmentsForToday } from "../services/taskAssignment.service.js";


export async function runStartupCron(now = new Date()): Promise<void> {
    try {


       

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
            await syncTodaysOpenAttendanceWindow({
                staffId: staff.id,
                locationId: staff.locationId,
                shiftStart: staff.shiftStart,
                shiftEnd: staff.shiftEnd,
                timeZone: staff.location?.timezone,
            });
        }

       

        const dailyTemplates = await prisma.taskTemplate.findMany({
            where: {
                isActive: true,
                recurringType: "DAILY",
            },
            include: {
                staff: {
                    select: {
                        shiftStart: true,
                        shiftEnd: true,
                    },
                },
                location: {
                    select: {
                        timezone: true,
                    },
                },
            },
        });

        const onceTemplates = await prisma.taskTemplate.findMany({
            where: {
                isActive: true,
                recurringType: "ONCE",
            },
            include: {
                staff: {
                    select: {
                        shiftStart: true,
                        shiftEnd: true,
                    },
                },
                location: {
                    select: {
                        timezone: true,
                    },
                },
            },
        });

        const instancesToCreate = buildScheduleOccurrences([...dailyTemplates, ...onceTemplates], now);

        const { count: tasksCreated } = instancesToCreate.length
            ? await generateTaskInstances(instancesToCreate)
            : { count: 0 };

        const assignmentsEnsured = await ensureAssignmentsForToday();

        if (tasksCreated > 0) {
            console.log(
                `Startup cron: prepared attendance windows and created ${tasksCreated} task instance(s), ensured ${assignmentsEnsured} assignment(s) for today.`
            );
        } else {
            console.log(`Startup cron: all today's records already exist; ensured ${assignmentsEnsured} assignment(s).`);
        }
    } catch (error) {
        console.error("Startup cron error:", error);
    }
}
