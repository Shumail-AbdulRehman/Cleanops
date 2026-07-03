import cron from "node-cron";
import { reassignExpiredAssignments } from "../services/taskAssignment.service.js";

const parseGraceMinutes = () => {
  const parsed = Number.parseInt(process.env.TASK_START_GRACE_MINUTES ?? "", 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 10;
};

cron.schedule("* * * * *", async () => {
  try {
    const result = await reassignExpiredAssignments(parseGraceMinutes());

    if (result.scanned > 0) {
      console.log(
        `Task reassignment cron: scanned ${result.scanned}, reassigned ${result.reassigned}, without replacement ${result.failedWithoutReplacement}`
      );
    }
  } catch (error) {
    console.error("Task reassignment cron error:", error);
  }
}, { noOverlap: true });
