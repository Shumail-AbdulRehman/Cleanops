import jwt from "jsonwebtoken";
import { createHash } from "node:crypto";
import type { prisma } from "../../prisma/prisma.js";
export const sessionHash = (token: string) =>
  createHash("sha256").update(token).digest("hex");
export function staffPushSession(token: string | null, now = new Date()) {
  if (!token) return null;
  try {
    const value = jwt.verify(token, process.env.REFRESH_TOKEN_SECRET!, {
      clockTimestamp: Math.floor(+now / 1000),
    }) as jwt.JwtPayload;
    if (value.role !== "STAFF" || !value.exp || value.exp * 1000 <= +now)
      return null;
    return {
      sessionHash: sessionHash(token),
      sessionExpiresAt: new Date(value.exp * 1000),
    };
  } catch {
    return null;
  }
}
export async function renewStaffPushSession(
  db: Pick<typeof prisma, "staffPushDevice">,
  staffId: number,
  previous: string,
  next: string,
) {
  const session = staffPushSession(next);
  if (session)
    await db.staffPushDevice.updateMany({
      where: { staffId, enabled: true, sessionHash: sessionHash(previous) },
      data: session,
    });
}
