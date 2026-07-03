import { generateTaskInstances } from "../services/verification-v2/inventorySnapshot.service.js";
import cron from "node-cron";
import { prisma } from "../prisma/prisma.js";
import { buildScheduleOccurrences } from "./scheduleOccurrences.js";
import { ensureAssignmentsForToday } from "../services/taskAssignment.service.js";


export async function runOnceTaskScheduler(now = new Date())
{
    try {

    console.log("Generating Once task instances...");



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
        referenceImages: {
          orderBy: { sortOrder: "asc" },
        },
      },
    });

    const instancesToCreate = buildScheduleOccurrences(onceTemplates, now);

    const { count: created } = instancesToCreate.length
      ? await generateTaskInstances(instancesToCreate)
      : { count: 0 };

    console.log(`Once Task instances created: ${created}`);

    const ensuredAssignments = await ensureAssignmentsForToday();
    console.log(`Once task assignments ensured: ${ensuredAssignments}`);

    } catch (error) {
         console.error("Once Task scheduler cron error:", error);
    }
}

if (process.env.NODE_ENV !== "test") cron.schedule("3-59/15 * * * *", () => runOnceTaskScheduler(), { noOverlap: true });
