import { z } from "zod";
import { prisma } from "../prisma/prisma.js";
import { ApiError } from "../utils/ApiError.js";
import { isPasswordCorrect } from "../utils/auth.js";
import { writeAuditLog } from "./auditLog.service.js";
import { requireLocationAccess, type VerificationActor } from "./verification-v2/authorization.service.js";

const password = z.string().min(8, "Use at least 8 characters").refine(value => Buffer.byteLength(value, "utf8") <= 72, "Use at most 72 UTF-8 bytes");
export const ownPasswordInput = z.object({ currentPassword: z.string().min(1).max(1024), newPassword: password }).strict();
const signOutStaffInput = z.object({ reason: z.string().trim().min(1).max(1000) }).strict();
type Db = Pick<typeof prisma, "$transaction">;
type Transaction = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

async function lockPrincipal(tx: Transaction, actor: Pick<VerificationActor, "id" | "role">) {
  if (actor.role === "STAFF") await tx.$queryRaw`SELECT id FROM "Staff" WHERE id=${actor.id} FOR UPDATE`;
  else await tx.$queryRaw`SELECT id FROM "Manager" WHERE id=${actor.id} FOR UPDATE`;
}

export async function changeOwnPassword(actor: VerificationActor, raw: unknown, db: Db = prisma) {
  if (actor.role === "STAFF") throw new ApiError(403, "Staff sign in with their phone number.", [{ code: "STAFF_PASSWORDS_RETIRED" }]);
  const parsed = ownPasswordInput.safeParse(raw);
  if (!parsed.success) throw new ApiError(400, "Check your password details", parsed.error.issues.map(issue => ({ field: issue.path.join("."), message: issue.message })));
  const input = parsed.data;
  return db.$transaction(async tx => {
    await lockPrincipal(tx, actor);
    const user = await tx.manager.findFirst({ where: { id: actor.id, companyId: actor.companyId, role: actor.role, isActive: true } });
    if (!user || !await isPasswordCorrect(input.currentPassword, user.password)) throw new ApiError(403, "Current password is incorrect or account access changed");
    if (await isPasswordCorrect(input.newPassword, user.password)) throw new ApiError(400, "Choose a different new password");
    const data = { password: input.newPassword, credentialVersion: { increment: 1 }, refreshToken: null, mustChangePassword: false };
    await tx.manager.update({ where: { id: actor.id }, data });
    await tx.credentialToken.updateMany({ where: { companyId: actor.companyId, managerId: actor.id, consumedAt: null }, data: { consumedAt: new Date() } });
    await writeAuditLog({ companyId: actor.companyId, actorType: actor.role, actorId: actor.id, entityType: "MANAGER", entityId: actor.id, action: "OWN_PASSWORD_CHANGED", newValue: { sessionsRevoked: true } }, tx);
    return { passwordChanged: true, signInRequired: true };
  });
}

const staffNotFound = () => new ApiError(404, "Staff account not found");

export async function signOutStaffEverywhere(actor: VerificationActor, staffId: number, raw: unknown, db: Db = prisma) {
  if (!["ADMIN", "MANAGER"].includes(actor.role)) throw new ApiError(403, "Owner or assigned-site manager required");
  if (!Number.isSafeInteger(staffId) || staffId < 1) throw new ApiError(400, "Invalid staff identifier");
  const parsed = signOutStaffInput.safeParse(raw);
  if (!parsed.success) throw new ApiError(400, "Enter a reason between 1 and 1000 characters.");
  return db.$transaction(async tx => {
    await lockPrincipal(tx, { id: staffId, role: "STAFF" });
    const staff = await tx.staff.findFirst({
      where: { id: staffId, companyId: actor.companyId, role: "STAFF", isActive: true, company: { isActive: true } },
      select: { locationId: true },
    });
    if (!staff) throw staffNotFound();
    if (actor.role === "MANAGER") {
      if (staff.locationId === null) throw staffNotFound();
      try {
        await requireLocationAccess(actor, staff.locationId, tx);
      } catch (error) {
        if (error instanceof ApiError && (error.statusCode === 403 || error.statusCode === 404)) throw staffNotFound();
        throw error;
      }
    }
    await tx.staff.update({ where: { id: staffId }, data: { credentialVersion: { increment: 1 }, refreshToken: null } });
    await tx.staffPushDevice.updateMany({ where: { staffId, companyId: actor.companyId }, data: { enabled: false } });
    await writeAuditLog({
      companyId: actor.companyId, actorType: actor.role, actorId: actor.id, entityType: "STAFF", entityId: staffId,
      action: "STAFF_SIGNED_OUT_EVERYWHERE", reason: parsed.data.reason, newValue: { sessionsRevoked: true },
    }, tx);
    return { signedOut: true };
  });
}
