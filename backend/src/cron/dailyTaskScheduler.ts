import { generateTaskInstances } from "../services/verification-v2/inventorySnapshot.service.js";
import { prisma } from "../prisma/prisma.js";
import { buildScheduleOccurrences } from "./scheduleOccurrences.js";
import { ensureAssignmentsForToday } from "../services/taskAssignment.service.js";

let isDailyTaskSchedulerRunning = false;

export const runDailyTaskScheduler = async (now = new Date()) => {
  if (isDailyTaskSchedulerRunning) {
    console.log("Daily task scheduler skipped: previous run still in progress.");
    return;
  }

  isDailyTaskSchedulerRunning = true;

  try {
    console.log("Generating daily task instances...");



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
        referenceImages: {
          orderBy: { sortOrder: "asc" },
        },
      },
    });

    const instancesToCreate = buildScheduleOccurrences(dailyTemplates, now);

    const { count: created } = instancesToCreate.length
      ? await generateTaskInstances(instancesToCreate)
      : { count: 0 };

    console.log(`Task instances created: ${created}`);

    const ensuredAssignments = await ensureAssignmentsForToday();
    console.log(`Task assignments ensured: ${ensuredAssignments}`);
  } catch (error) {
    console.error("Task scheduler cron error:", error);
  } finally {
    isDailyTaskSchedulerRunning = false;
  }
};

if (process.env.NODE_ENV !== "test") {
  void runDailyTaskScheduler();
  setInterval(() => { void runDailyTaskScheduler(); }, 90 * 1000);
}
