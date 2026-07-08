import { prisma } from "../prisma/prisma.js";

type PrismaClientLike = Pick<typeof prisma, "auditLog">;

type AuditLogInput = {
  companyId?: number | null;
  actorType: "SYSTEM" | "ADMIN" | "MANAGER" | "STAFF" | "PLATFORM_OPERATOR";
  actorId?: number | null;
  entityType: string;
  entityId: number;
  action: string;
  reason?: string | null;
  oldValue?: unknown;
  newValue?: unknown;
};

export const writeAuditLog = async (
  input: AuditLogInput,
  client: PrismaClientLike = prisma
) => {
  return client.auditLog.create({
    data: {
      companyId: input.companyId ?? null,
      actorType: input.actorType,
      actorId: input.actorId ?? null,
      entityType: input.entityType,
      entityId: input.entityId,
      action: input.action,
      reason: input.reason ?? null,
      oldValue: input.oldValue === undefined ? undefined : (input.oldValue as any),
      newValue: input.newValue === undefined ? undefined : (input.newValue as any),
    },
  });
};
