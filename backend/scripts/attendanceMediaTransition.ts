import pg from "pg";
import sharp from "sharp";
import { readFile } from "node:fs/promises";
import cloudinary, { uploadBufferToCloudinary } from "../src/utils/cloudinary.js";
import { parseAttendancePhoto } from "../src/services/attendancePhotoReference.js";
import { assertIsolatedMediaDatabase, referenceDigest, transitionAttendanceEntry, transitionManifestSchema, type TransitionRow } from "../src/services/attendanceMediaTransition.service.js";

const file = process.argv[2];
if (!file) throw new Error("Usage: attendanceMediaTransition.ts <manifest-file> [--apply-isolated-test]");
const bytes = await readFile(file);
if (bytes.length > 1024 * 1024) throw new Error("Manifest exceeds allowed size");
const manifest = transitionManifestSchema.parse(JSON.parse(bytes.toString("utf8")));
if (!process.argv.includes("--apply-isolated-test")) {
  console.log(JSON.stringify({ mode: "dry-run", manifestSha256: referenceDigest(bytes.toString("utf8")), ready: manifest.entries.filter(e => e.state === "READY").length, held: manifest.entries.filter(e => e.state === "HELD").length }));
} else {
  assertIsolatedMediaDatabase(process.env.ATTENDANCE_MEDIA_TEST_DATABASE_URL, process.env.NODE_ENV);
  if (referenceDigest(bytes.toString("utf8")) !== process.env.ATTENDANCE_MEDIA_MANIFEST_SHA256) throw new Error("Explicit manifest digest does not match");
  if (!process.env.CLOUDINARY_CLOUD_NAME || !process.env.CLOUDINARY_API_KEY || !process.env.CLOUDINARY_API_SECRET) throw new Error("Explicit isolated storage credentials required");
  if (process.env.ATTENDANCE_MEDIA_TEST_STORAGE_ACK !== "isolated-storage-account") throw new Error("Isolated storage account acknowledgement required");
  const db = new pg.Client({ connectionString: process.env.ATTENDANCE_MEDIA_TEST_DATABASE_URL, connectionTimeoutMillis: 10_000, query_timeout: 30_000 });
  const download = async (url: string) => {
    const response = await fetch(url, { redirect: "error", signal: AbortSignal.timeout(30_000) });
    if (!response.ok) throw new Error("Storage unavailable");
    const reader = response.body?.getReader(); if (!reader) throw new Error("Missing image");
    const parts: Buffer[] = []; let size = 0;
    for (;;) { const part = await reader.read(); if (part.done) break; size += part.value.byteLength; if (size > 5 * 1024 * 1024) { await reader.cancel(); throw new Error("Image too large"); } parts.push(Buffer.from(part.value)); }
    if (!size) throw new Error("Missing image"); return Buffer.concat(parts);
  };
  try {
    await db.connect();
    for (const entry of manifest.entries) {
      const result = await transitionAttendanceEntry(entry, process.env.CLOUDINARY_CLOUD_NAME!, {
        read: async e => (await db.query<TransitionRow>(`SELECT a.id,a."staffId",a."locationId",s."companyId",l."companyId" AS "locationCompanyId",a."checkInImage",a."checkOutImage" FROM "Attendance" a JOIN "Staff" s ON s.id=a."staffId" JOIN "Location" l ON l.id=a."locationId" WHERE a.id=$1`, [e.attendanceId])).rows[0] ?? null,
        copyAndVerify: async (source, destination) => {
          const parsed = parseAttendancePhoto(destination)!;
          const resource = await cloudinary.api.resource(source.publicId, { type: "upload", resource_type: "image", timeout: 30_000 });
          if (resource.public_id !== source.publicId || resource.version !== source.version || resource.type !== "upload" || !["jpg", "jpeg", "png", "webp"].includes(resource.format)) throw new Error("Source mismatch");
          const sourceUrl = cloudinary.utils.private_download_url(source.publicId, resource.format, { type: "upload", resource_type: "image", expires_at: Math.floor(Date.now() / 1000) + 60 });
          const original = await download(sourceUrl);
          const copy = await sharp(original, { limitInputPixels: 25_000_000, failOn: "error", animated: false }).rotate().jpeg({ quality: 95 }).toBuffer();
          const digest = referenceDigest(copy);
          let existing;
          try { existing = await cloudinary.api.resource(parsed.publicId, { type: "authenticated", resource_type: "image", context: true, timeout: 30_000 }); }
          catch (error) { const e = error as { http_code?: number; error?: { http_code?: number } }; if ((e.error?.http_code ?? e.http_code) !== 404) throw error; }
          if (!existing) existing = await uploadBufferToCloudinary(copy, { public_id: parsed.publicId, type: "authenticated", resource_type: "image", format: "jpg", overwrite: false, context: { sourceCopyHash: digest }, timeout: 30_000 });
          if (existing.public_id !== parsed.publicId || existing.type !== "authenticated") throw new Error("Destination mismatch");
          const readback = await download(cloudinary.utils.private_download_url(parsed.publicId, "jpg", { type: "authenticated", resource_type: "image", expires_at: Math.floor(Date.now() / 1000) + 60 }));
          return { sourceSha256: digest, destinationSha256: referenceDigest(readback) };
        },
        compareAndSwap: async (e, previous) => {
          // field is validated enum, never an arbitrary SQL identifier.
          const field = e.field === "checkInImage" ? '"checkInImage"' : '"checkOutImage"';
          const result = await db.query(`UPDATE "Attendance" a SET ${field}=$1,"updatedAt"=NOW() FROM "Staff" s,"Location" l WHERE a.id=$2 AND a."staffId"=$3 AND a."locationId"=$4 AND s.id=a."staffId" AND s."companyId"=$5 AND l.id=a."locationId" AND l."companyId"=$5 AND a.${field}=$6`, [e.destination, e.attendanceId, e.staffId, e.locationId, e.companyId, previous]);
          return result.rowCount === 1;
        },
      });
      console.log(JSON.stringify(result));
    }
  } catch { console.error("Isolated media rehearsal did not complete. Review redacted manifest results; no public assets were deleted."); process.exitCode = 1; }
  finally { await db.end(); }
}
