import cron from "node-cron";
import { prisma } from "../prisma/prisma.js";

cron.schedule("5-59/10 * * * *", async () => {
  try {
    const now = new Date();

    const missedCheckout = await prisma.attendance.updateMany({
      where: {
        location: {company:{isActive:true,operationalStatus:"ACTIVE"}},
        expectedEnd: { lt: now },
        checkOutTime: null,
        status: { in: ["CHECKED_IN", "LATE"] },
      },
      data: {
        status: "MISSED_CHECKOUT",
      },
    });

    if (missedCheckout.count > 0) {
      console.log(`Attendance cron: ${missedCheckout.count} missed checkout record(s) marked.`);
    }
  } catch (error) {
    console.error("Attendance status cron error:", error);
  }
}, { noOverlap: true });
