import { z } from "zod";
import { prisma } from "../../prisma/prisma.js";
import { ApiError } from "../../utils/ApiError.js";
import { staffPushSession } from "./session.js";
import type { VerificationActor } from "../verification-v2/authorization.service.js";
export function staffOnly(actor: VerificationActor) {
  if (actor.role !== "STAFF") throw new ApiError(403, "Staff account required");
}
export const deviceSchema = z.object({
  id: z.uuid(),
  token: z
    .string()
    .regex(/^(ExponentPushToken|ExpoPushToken)\[[A-Za-z0-9_-]{10,200}\]$/),
  platform: z.enum(["android", "ios"]),
  language: z.enum(["en", "ur"]).default("en"),
  projectId: z.uuid(),
  alertChannelVersion: z.union([z.literal(1), z.literal(3)]).default(1),
});
export async function registerStaffDevice(
  actor: VerificationActor,
  input: unknown,
  now = new Date(),
) {
  staffOnly(actor);
  const q = deviceSchema.parse(input);
  if (
    !process.env.STAFF_EXPO_PROJECT_ID ||
    q.projectId !== process.env.STAFF_EXPO_PROJECT_ID
  )
    throw new ApiError(
      503,
      "Push notifications are not configured for this app.",
    );
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Staff" WHERE id=${actor.id} FOR UPDATE`;
    // A valid access token alone must not re-register a device after logout.
    const staff = await tx.staff.findFirst({
      where: {
        id: actor.id,
        companyId: actor.companyId,
        isActive: true,
        company: { isActive: true },
      },
      select: { refreshToken: true },
    });
    const session = staffPushSession(staff?.refreshToken ?? null, now);
    if (!session)
      throw new ApiError(401, "Sign in again to enable notifications.");
    const previous = await tx.staffPushDevice.findUnique({
      where: { id: q.id },
    });
    await tx.staffPushDevice.deleteMany({
      where: { token: q.token, id: { not: q.id } },
    });
    const data = {
      staffId: actor.id,
      companyId: actor.companyId,
      token: q.token,
      platform: q.platform,
      language: q.language,
      alertChannelVersion: q.alertChannelVersion,
      ...session,
      enabled: true,
      ...(!previous ||
      !previous.enabled ||
      previous.staffId !== actor.id ||
      previous.sessionHash !== session.sessionHash
        ? { boundAt: now }
        : {}),
    };
    await tx.staffPushDevice.upsert({
      where: { id: q.id },
      create: { id: q.id, ...data },
      update: data,
    });
    return { enabled: true };
  });
}
export async function listStaffNotifications(
  actor: VerificationActor,
  raw: unknown,
) {
  staffOnly(actor);
  const q = z
    .object({
      cursor: z.coerce.number().int().positive().optional(),
      limit: z.coerce.number().int().min(1).max(50).default(20),
    })
    .parse(raw);
  const where = { staffId: actor.id, companyId: actor.companyId };
  return prisma.$transaction(
    async (tx) => {
      const [rows, unreadCount] = await Promise.all([
        tx.staffNotification.findMany({
          where: { ...where, ...(q.cursor ? { id: { lt: q.cursor } } : {}) },
          orderBy: { id: "desc" },
          take: q.limit + 1,
          select: {
            id: true,
            kind: true,
            data: true,
            taskId: true,
            attendanceId: true,
            createdAt: true,
            expiresAt: true,
            readAt: true,
          },
        }),
        tx.staffNotification.count({ where: { ...where, readAt: null } }),
      ]);
      return {
        notifications: rows.slice(0, q.limit),
        unreadCount,
        nextCursor: rows.length > q.limit ? rows[q.limit - 1]!.id : null,
      };
    },
    { isolationLevel: "RepeatableRead" },
  );
}
