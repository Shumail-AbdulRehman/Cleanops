import cron from "node-cron";
import { cleanDeletedMedia } from "../services/deletedMedia.service.js";

cron.schedule("* * * * *", () => {
  return cleanDeletedMedia().catch((error) =>
    console.error("Deleted media cleanup failed", error),
  );
}, { noOverlap: true });
