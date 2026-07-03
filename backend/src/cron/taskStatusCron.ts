import {expireVerificationTasks} from '../services/verification-v2/deadline.service.js';
import cron from "node-cron";
import { prisma } from "../prisma/prisma.js";
import { markCurrentAssignmentsForTasks } from "../services/taskAssignment.service.js";

cron.schedule("7-59/15 * * * *", async () => {
  try {
    const now = new Date();
    await expireVerificationTasks(now);

    const missedTaskIds = await prisma.taskInstance.findMany({
      where: {
        location: {company:{isActive:true,operationalStatus:"ACTIVE"}},
        shiftEnd: { lt: now },
        status: "PENDING",
        verificationVersion: 1,
        isActive: true
      },
      select: { id: true },
    });

    const missedTasks = await prisma.taskInstance.updateMany({
      where: {
        location: {company:{isActive:true,operationalStatus:"ACTIVE"}},
        id: { in: missedTaskIds.map((task) => task.id) },
      },
      data: {
        status: "MISSED"
      }
    });
    await markCurrentAssignmentsForTasks(
      missedTaskIds.map((task) => task.id),
      "MISSED",
      "TASK_EXPIRED_BEFORE_START"
    );

    
    
    const incompleteTaskIds = await prisma.taskInstance.findMany({
      where: {
        location: {company:{isActive:true,operationalStatus:"ACTIVE"}},
        shiftEnd: { lt: now },
        status: "IN_PROGRESS",
        completedAt: null,
        verificationVersion: 1,
        isActive: true
      },
      select: { id: true },
    });

    const incompleteTasks = await prisma.taskInstance.updateMany({
      where: {
        location: {company:{isActive:true,operationalStatus:"ACTIVE"}},
        id: { in: incompleteTaskIds.map((task) => task.id) },
      },
      data: {
        status: "NOT_COMPLETED_INTIME"
      }
    });
    await markCurrentAssignmentsForTasks(
      incompleteTaskIds.map((task) => task.id),
      "MISSED",
      "TASK_NOT_COMPLETED_IN_TIME"
    );

    console.log(`Cron: ${missedTasks.count} missed, ${incompleteTasks.count} not_completed_intime`);
  } catch (error) {
    console.error("Task status cron error:", error);
  }
}, { noOverlap: true });
