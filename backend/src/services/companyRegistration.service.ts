import { prisma } from "../prisma/prisma.js";
import { managerSignupSchema } from "../validations/manager.validation.js";
import { ApiError } from "../utils/ApiError.js";
import { createHash } from "node:crypto";
import { writeAuditLog } from "./auditLog.service.js";

export const companyRegistrationSchema = managerSignupSchema.extend({
  companyName: managerSignupSchema.shape.companyName.trim().min(2).max(160),
  name: managerSignupSchema.shape.name.trim().min(2).max(120),
  email: managerSignupSchema.shape.email.max(254),
}).strict();

export type RegisteredOwner = { id: number; name: string; email: string; role: "ADMIN"; companyId: number };
type RegistrationDb = Pick<typeof prisma, "$transaction">;

const emailExists = () => new ApiError(409,
  "An account with these details already exists. Sign in or recover your account.",
  [{ code: "EMAIL_EXISTS", field: "email", message: "This email already has an account" }]);

export async function registerCompany(input: unknown, db: RegistrationDb = prisma): Promise<RegisteredOwner> {
  const parsed = companyRegistrationSchema.safeParse(input);
  if (!parsed.success) throw new ApiError(400, "Check your registration details", parsed.error.issues.map(issue => ({ field: issue.path.join("."), message: issue.message })));
  const { companyName, name, email, password } = parsed.data;
  try {
    const owner = await db.$transaction(async tx => {
      // Check both identity tables, including legacy mixed-case and inactive
      // accounts, before creating any company or owner records.
      const where = { email: { equals: email, mode: "insensitive" as const } };
      const manager = await tx.manager.findFirst({ where, select: { id: true } });
      const staff = await tx.staff.findFirst({ where, select: { id: true } });
      if (manager || staff) throw emailExists();
      const company = await tx.company.create({ data: { name: companyName }, select: { id: true } });
      // The existing extended Prisma client hashes manager.create passwords,
      // including its transaction client. Do not hash again before this call.
      const created = await tx.manager.create({
        data: { name, email, password, companyId: company.id, role: "ADMIN" },
        select: { id: true, name: true, email: true, role: true, companyId: true },
      });
      // New registrations may prove their supplied email. This grants no verified
      // state; pre-existing unverified accounts require a qualified bootstrap.
      await writeAuditLog({ companyId: company.id, actorType: "ADMIN", actorId: created.id,
        entityType: "MANAGER", entityId: created.id, action: "OWNER_EMAIL_ENROLLMENT_ALLOWED",
        newValue: { emailHash: createHash("sha256").update(created.email).digest("hex"), source: "REGISTRATION" } }, tx);
      return created;
    });
    if (owner.role !== "ADMIN") throw new ApiError(500, "Account creation could not be confirmed");
    return { id: owner.id, name: owner.name, email: owner.email, role: "ADMIN", companyId: owner.companyId };
  } catch (error) {
    if ((error as { code?: string })?.code === "P2002")
      throw emailExists();
    throw error;
  }
}
