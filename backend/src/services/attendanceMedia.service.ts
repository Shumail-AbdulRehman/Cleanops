import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { prisma } from "../prisma/prisma.js";
import cloudinary, { uploadBufferToCloudinary } from "../utils/cloudinary.js";
import { ApiError } from "../utils/ApiError.js";
import { requireActiveActor, requireLocationAccess, type VerificationActor } from "./verification-v2/authorization.service.js";

const MAX_BYTES = 5 * 1024 * 1024;
export { parseAttendancePhoto } from "./attendancePhotoReference.js";
import { parseAttendancePhoto } from "./attendancePhotoReference.js";

/** Keep legacy public URLs and provider references out of every attendance DTO. */
export function attendancePhotoPresentation<T extends { id: number; checkInImage?: string | null; checkOutImage?: string | null }>(row: T) {
  function photo(reference: string | null | undefined, kind: "check-in" | "check-out") {
    if (!reference) return { state: "NONE" as const, path: null };
    if (!parseAttendancePhoto(reference)) return { state: "LEGACY_RESTRICTED" as const, path: null };
    return { state: "AVAILABLE" as const, path: `/attendance/${row.id}/photos/${kind}` };
  }
  return { ...row, checkInImage: null, checkOutImage: null,
    checkInPhoto: photo(row.checkInImage, "check-in"), checkOutPhoto: photo(row.checkOutImage, "check-out") };
}

export async function storeAttendancePhoto(bytes: Buffer, companyId: number, staffId: number): Promise<string> {
  if (!Number.isSafeInteger(companyId) || companyId < 1 || !Number.isSafeInteger(staffId) || staffId < 1)
    throw new ApiError(403, "Staff account required");
  if (!bytes.length || bytes.length > MAX_BYTES) throw new ApiError(422, "Use a photo up to 5 MB");
  let sanitized: Buffer;
  try {
    const image = sharp(bytes, { limitInputPixels: 25_000_000, failOn: "error", animated: false });
    const metadata = await image.metadata();
    if (!["jpeg", "png", "webp"].includes(metadata.format ?? "") || (metadata.pages ?? 1) > 1) throw new Error("Unsupported image");
    // Re-encoding removes metadata. This is not face redaction or GPS attestation.
    sanitized = await image.rotate().resize({ width: 1800, height: 1800, fit: "inside", withoutEnlargement: true }).jpeg({ quality: 85 }).toBuffer();
  } catch { throw new ApiError(422, "Use a valid JPEG, PNG or WebP photo"); }
  const reference = `attendance:v1:${companyId}:${staffId}:${randomUUID()}`;
  const parsed = parseAttendancePhoto(reference)!;
  try {
    const result = await uploadBufferToCloudinary(sanitized, {
      public_id: parsed.publicId, resource_type: "image", type: "authenticated",
      format: "jpg", overwrite: false, timeout: 30_000,
    });
    if (result.public_id !== parsed.publicId || result.type !== "authenticated") throw new Error("Storage mismatch");
    return reference;
  } catch { throw new ApiError(503, "Photo upload could not be confirmed. Check your attendance before retrying."); }
}

export async function readAttendancePhoto(actor: VerificationActor, id: number, kind: "check-in" | "check-out"): Promise<Buffer> {
  if (!Number.isSafeInteger(id) || id < 1) throw new ApiError(400, "Invalid attendance identifier");
  await requireActiveActor(actor);
  const row = await prisma.attendance.findFirst({
    where: { id, staff: { companyId: actor.companyId }, location: { companyId: actor.companyId } },
    select: { id: true, staffId: true, locationId: true, checkInImage: true, checkOutImage: true },
  });
  if (!row || (actor.role === "STAFF" && row.staffId !== actor.id)) throw new ApiError(404, "Photo unavailable");
  if (actor.role === "MANAGER") await requireLocationAccess(actor, row.locationId);
  const reference = parseAttendancePhoto(kind === "check-in" ? row.checkInImage : row.checkOutImage);
  if (!reference || reference.companyId !== actor.companyId || reference.staffId !== row.staffId)
    throw new ApiError(404, "Photo unavailable");
  try {
    const url = cloudinary.utils.private_download_url(reference.publicId, "jpg", {
      type: "authenticated", resource_type: "image", expires_at: Math.floor(Date.now() / 1000) + 60,
    });
    const response = await fetch(url, { signal: AbortSignal.timeout(30_000), redirect: "error" });
    if (!response.ok || !response.headers.get("content-type")?.startsWith("image/jpeg")) throw new Error("Storage unavailable");
    const reader = response.body?.getReader();
    if (!reader) throw new Error("Missing body");
    const chunks: Buffer[] = []; let size = 0;
    for (;;) {
      const part = await reader.read(); if (part.done) break;
      size += part.value.byteLength;
      if (size > MAX_BYTES) { await reader.cancel(); throw new Error("Image too large"); }
      chunks.push(Buffer.from(part.value));
    }
    if (!size) throw new Error("Empty image");
    return Buffer.concat(chunks);
  } catch { throw new ApiError(503, "Photo storage is temporarily unavailable"); }
}
