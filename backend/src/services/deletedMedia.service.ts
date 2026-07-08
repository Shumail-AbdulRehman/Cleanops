import { parseAttendancePhoto } from "./attendancePhotoReference.js";
import { v2 as cloudinary } from "cloudinary";
import { prisma } from "../prisma/prisma.js";
import "../utils/cloudinary.js";

export function cloudinaryPublicId(
  url: string,
  cloudName = process.env.CLOUDINARY_CLOUD_NAME,
): string | null {
  const attendance = parseAttendancePhoto(url);
  if (attendance) return attendance.publicId;
  if (!cloudName) return null;
  try {
    const parsed = new URL(url);
    if (
      parsed.hostname !== "res.cloudinary.com" ||
      parsed.protocol !== "https:"
    )
      return null;
    const prefix = `/${cloudName}/image/upload/`;
    if (!parsed.pathname.startsWith(prefix)) return null;
    const match = parsed.pathname
      .slice(prefix.length)
      .match(/^v\d+\/(.+)\.[a-zA-Z0-9]+$/);
    return match?.[1] ? decodeURIComponent(match[1]) : null;
  } catch {
    return null;
  }
}

// A template's photo may also be used by retained task snapshots.
async function isReferenced(url: string) {
  const publicId = cloudinaryPublicId(url);
  if (publicId?.startsWith("verification/")) return true;
  const refs = await Promise.all([
    ...(publicId ? [prisma.evidenceAsset.count({ where: { OR: [{ originalPublicId: publicId }, { sanitizedPublicId: publicId }] } })] : []),
    prisma.taskTemplate.count({ where: { referenceImageUrl: url } }),
    prisma.taskTemplateReferenceImage.count({ where: { imageUrl: url } }),
    prisma.taskInstance.count({
      where: {
        OR: [{ referenceImageUrl: url }, { proofImageUrls: { has: url } }],
      },
    }),
    prisma.taskInstanceReferenceImage.count({ where: { imageUrl: url } }),
    prisma.taskCompletionAttempt.count({ where: { imageUrl: url } }),
    prisma.taskAreaSubmission.count({
      where: {
        OR: [
          { photoUrl: url },
          { attempts: { array_contains: [{ photoUrl: url }] } },
        ],
      },
    }),
    prisma.attendance.count({
      where: { OR: [{ checkInImage: url }, { checkOutImage: url }] },
    }),
  ]);
  return refs.some((count) => count > 0);
}

let running = false;
export async function cleanDeletedMedia() {
  if (running) return;
  running = true;
  try {
    const jobs = await prisma.deletedMedia.findMany({
      where: { retryAt: { lte: new Date() } },
      orderBy: { id: "asc" },
      take: 50,
    });
    for (const job of jobs) {
      try {
        const publicId = cloudinaryPublicId(job.url);
        if (!publicId)
          throw new Error(
            "Media URL is not a supported image in the configured Cloudinary account",
          );
        if (!(await isReferenced(job.url))) {
          const result = await cloudinary.uploader.destroy(publicId, {
            invalidate: true,
            resource_type: "image",
            ...(parseAttendancePhoto(job.url) ? { type: "authenticated" } : {}),
          });
          if (result.result !== "ok" && result.result !== "not found")
            throw new Error("Cloudinary deletion did not complete");
        }
        await prisma.deletedMedia.deleteMany({ where: { id: job.id } });
      } catch {
        // Keep failed work durable; outages must not resurrect database records.
        await prisma.deletedMedia.updateMany({
          where: { id: job.id },
          data: {
            attempts: { increment: 1 },
            retryAt: new Date(
              Date.now() +
                Math.min(24 * 60, 2 ** Math.min(job.attempts, 10)) * 60_000,
            ),
          },
        });
        console.warn(`Media cleanup job ${job.id} will be retried`);
      }
    }
  } finally {
    running = false;
  }
}
