import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { parseAttendancePhoto } from "./attendancePhotoReference.js";

export const referenceDigest = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
const positive = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
export const transitionEntrySchema = z.object({
  attendanceId: positive, companyId: positive, staffId: positive, locationId: positive,
  field: z.enum(["checkInImage", "checkOutImage"]),
  sourceDigest: z.string().regex(/^[a-f0-9]{64}$/),
  state: z.enum(["READY", "PRIVATE", "HELD"]),
  destination: z.string().nullable(),
}).strict().superRefine((entry, ctx) => {
  if (entry.state === "READY") {
    const parsed = parseAttendancePhoto(entry.destination);
    if (!parsed || parsed.companyId !== entry.companyId || parsed.staffId !== entry.staffId)
      ctx.addIssue({ code: "custom", message: "Invalid bound destination" });
  } else if (entry.destination !== null) ctx.addIssue({ code: "custom", message: "Non-ready entries cannot have a destination" });
});
export const transitionManifestSchema = z.object({
  version: z.literal(1), mode: z.literal("dry-run"), createdAt: z.iso.datetime(),
  nextCursor: z.number().int().nonnegative().nullable(), entries: z.array(transitionEntrySchema).max(1000),
}).strict();
export type TransitionEntry = z.infer<typeof transitionEntrySchema>;
export type TransitionRow = { id: number; companyId: number; staffId: number; locationId: number; locationCompanyId: number; checkInImage: string | null; checkOutImage: string | null };

/** Allow only original assets from the configured account's old attendance folders. */
export function legacyAttendanceSource(value: string, cloudName: string): { publicId: string; format: string; version: number } | null {
  if (!cloudName || !/^[\w-]+$/.test(cloudName)) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.host !== "res.cloudinary.com" || url.search || url.hash || url.username || url.password) return null;
    const prefix = `/${cloudName}/image/upload/`;
    if (!url.pathname.startsWith(prefix)) return null;
    const match = url.pathname.slice(prefix.length).match(/^v(\d+)\/((?:attendance-selfies|attendance-check-out-image)\/[\w-]+)\.(jpg|jpeg|png|webp)$/);
    return match && Number.isSafeInteger(Number(match[1])) ? { publicId: match[2]!, format: match[3]!, version: Number(match[1]) } : null;
  } catch { return null; }
}

export function inventoryAttendanceMedia(rows: TransitionRow[], cloudName: string, nextCursor: number | null = null) {
  const entries: TransitionEntry[] = [];
  for (const row of rows) for (const field of ["checkInImage", "checkOutImage"] as const) {
    const source = row[field]; if (!source) continue;
    const privatePhoto = parseAttendancePhoto(source);
    const bound = row.companyId === row.locationCompanyId;
    const state = privatePhoto && privatePhoto.companyId === row.companyId && privatePhoto.staffId === row.staffId && bound ? "PRIVATE" :
      bound && legacyAttendanceSource(source, cloudName) ? "READY" : "HELD";
    entries.push({ attendanceId: row.id, companyId: row.companyId, staffId: row.staffId, locationId: row.locationId, field,
      sourceDigest: referenceDigest(source), state,
      destination: state === "READY" ? `attendance:v1:${row.companyId}:${row.staffId}:${randomUUID()}` : null });
  }
  return transitionManifestSchema.parse({ version: 1, mode: "dry-run", createdAt: new Date().toISOString(), nextCursor, entries });
}

export function assertIsolatedMediaDatabase(connectionString: string | undefined, nodeEnv?: string) {
  if (!connectionString || nodeEnv === "production") throw new Error("Media apply requires an explicitly isolated test database");
  let url: URL; try { url = new URL(connectionString); } catch { throw new Error("Invalid isolated test database configuration"); }
  if (!["postgres:", "postgresql:"].includes(url.protocol) || !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
      !/^[\w-]*_test[\w-]*$/.test(url.pathname.slice(1)))
    throw new Error("Media apply requires a local database whose name contains _test");
}

export type TransitionBoundary = {
  read: (entry: TransitionEntry) => Promise<TransitionRow | null>;
  copyAndVerify: (source: { publicId: string; format: string; version: number }, destination: string) => Promise<{ sourceSha256: string; destinationSha256: string }>;
  compareAndSwap: (entry: TransitionEntry, previous: string) => Promise<boolean>;
};

/** No raw URL or provider error escapes this resumable, record-bound boundary. */
export async function transitionAttendanceEntry(raw: unknown, cloudName: string, boundary: TransitionBoundary) {
  const entry = transitionEntrySchema.parse(raw);
  if (entry.state !== "READY") return { attendanceId: entry.attendanceId, field: entry.field, state: "SKIPPED" as const };
  const result = (state: "MIGRATED" | "ALREADY_PRIVATE" | "CONFLICT" | "HELD" | "UNAVAILABLE") => ({ attendanceId: entry.attendanceId, field: entry.field, state });
  try {
    const row = await boundary.read(entry);
    if (!row || row.id !== entry.attendanceId || row.companyId !== entry.companyId || row.locationCompanyId !== entry.companyId || row.staffId !== entry.staffId || row.locationId !== entry.locationId) return result("CONFLICT");
    const previous = row[entry.field];
    if (previous === entry.destination) return result("ALREADY_PRIVATE");
    if (!previous || referenceDigest(previous) !== entry.sourceDigest) return result("CONFLICT");
    const source = legacyAttendanceSource(previous, cloudName);
    if (!source) return result("HELD");
    const proof = await boundary.copyAndVerify(source, entry.destination!);
    if (!/^[a-f0-9]{64}$/.test(proof.sourceSha256) || proof.sourceSha256 !== proof.destinationSha256) return result("HELD");
    return result(await boundary.compareAndSwap(entry, previous) ? "MIGRATED" : "CONFLICT");
  } catch { return result("UNAVAILABLE"); }
}
