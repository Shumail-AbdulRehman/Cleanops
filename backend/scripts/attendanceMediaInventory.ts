import pg from "pg";
import { writeFile } from "node:fs/promises";
import { inventoryAttendanceMedia, type TransitionRow } from "../src/services/attendanceMediaTransition.service.js";

// Deliberately no dotenv or DATABASE_URL fallback: the operator selects the
// inventory source explicitly; this script opens a READ ONLY transaction.
const target = process.argv[2];
const cursor = Number(process.argv[3] ?? "0");
if (!target || !Number.isSafeInteger(cursor) || cursor < 0 || !process.env.ATTENDANCE_MEDIA_INVENTORY_DATABASE_URL)
  throw new Error("Usage: attendanceMediaInventory.ts <new-manifest-file> [cursor]; configure ATTENDANCE_MEDIA_INVENTORY_DATABASE_URL explicitly");
const db = new pg.Client({ connectionString: process.env.ATTENDANCE_MEDIA_INVENTORY_DATABASE_URL, connectionTimeoutMillis: 10_000, query_timeout: 30_000 });
try {
  await db.connect(); await db.query("BEGIN READ ONLY");
  const rows = await db.query<TransitionRow>(`SELECT a.id,a."staffId",a."locationId",s."companyId",l."companyId" AS "locationCompanyId",a."checkInImage",a."checkOutImage" FROM "Attendance" a JOIN "Staff" s ON s.id=a."staffId" JOIN "Location" l ON l.id=a."locationId" WHERE a.id>$1 ORDER BY a.id LIMIT 501`, [cursor]);
  const page = rows.rows.slice(0, 500);
  const manifest = inventoryAttendanceMedia(page, process.env.CLOUDINARY_CLOUD_NAME ?? "", rows.rows.length > 500 ? page.at(-1)!.id : null);
  await db.query("COMMIT");
  await writeFile(target, JSON.stringify(manifest, null, 2) + "\n", { mode: 0o600, flag: "wx" });
  console.log(JSON.stringify({ mode: "read-only", entries: manifest.entries.length, nextCursor: manifest.nextCursor }));
} catch { console.error("Attendance media inventory did not complete; no database writes were performed."); process.exitCode = 1; }
finally { await db.end(); }
