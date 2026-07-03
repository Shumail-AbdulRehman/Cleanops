import cron from "node-cron";
import { runStaffNotifications } from "../services/staff-notifications/worker.service.js";
if (process.env.NODE_ENV !== "test")
  cron.schedule("* * * * *", () => {
    return runStaffNotifications().catch(() =>
      console.error(
        "Staff notification processing failed; pending work will retry.",
      ),
    );
  }, { noOverlap: true });
