import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../prisma/prisma.js';
import { ApiError } from '../utils/ApiError.js';
import { companyRegistrationSchema } from './companyRegistration.service.js';
import { assertAccountAction } from './accountAccess.service.js';
import { writeAuditLog } from './auditLog.service.js';
import type { VerificationActor } from './verification-v2/authorization.service.js';
import type { VerificationTransaction } from './verification-v2/transaction.js';

type Db = typeof prisma;
const select = { id: true, name: true, accountVersion: true, updatedAt: true } satisfies Prisma.CompanySelect;
type Settings = Prisma.CompanyGetPayload<{ select: typeof select }>;
const dto = (company: Settings) => ({ id: company.id, name: company.name, accountVersion: company.accountVersion, updatedAt: company.updatedAt });
const input = z.object({ name: companyRegistrationSchema.shape.companyName,
    expectedVersion: z.number().int().min(0).max(2147483646) }).strict();
function owner(actor: VerificationActor) {
    if (!actor || actor.role !== 'ADMIN' || !Number.isSafeInteger(actor.id) || actor.id < 1 ||
        !Number.isSafeInteger(actor.companyId) || actor.companyId < 1) throw new ApiError(403, 'Company owner access required');
}
async function currentSettings(actor: VerificationActor, tx: VerificationTransaction) {
    // Settings grant no new work/capacity: allow unentitled active owners, deny suspended companies.
    // Rechecks persisted ADMIN/company/isActive instead of trusting the supplied role alone.
    await assertAccountAction(actor, 'READ_OPERATIONAL', tx);
    const company = await tx.company.findUnique({ where: { id: actor.companyId }, select });
    if (!company) throw new ApiError(404, 'Company account not found');
    return company;
}
export async function getCompanySettings(actor: VerificationActor, db: Db = prisma) {
    owner(actor);
    return db.$transaction(async tx => dto(await currentSettings(actor, tx)), { isolationLevel: 'RepeatableRead' });
}
export async function updateCompanySettings(actor: VerificationActor, raw: unknown, db: Db = prisma) {
    owner(actor);
    const parsed = input.safeParse(raw);
    if (!parsed.success) throw new ApiError(400, 'A valid company name and current version are required');
    return db.$transaction(async tx => {
        await tx.$queryRaw`SELECT id FROM "Company" WHERE id=${actor.companyId} FOR UPDATE`;
        const company = await currentSettings(actor, tx), { name, expectedVersion } = parsed.data;
        if (company.accountVersion !== expectedVersion) throw new ApiError(409, 'Company settings changed. Reload before trying again.');
        if (company.name === name) return { company: dto(company), changed: false };
        const updated = await tx.company.updateMany({ where: { id: actor.companyId, accountVersion: expectedVersion },
            data: { name, accountVersion: { increment: 1 } } });
        if (updated.count !== 1) throw new ApiError(409, 'Company settings changed. Reload before trying again.');
        const saved = await tx.company.findUniqueOrThrow({ where: { id: actor.companyId }, select });
        await writeAuditLog({ companyId: actor.companyId, actorType: 'ADMIN', actorId: actor.id,
            entityType: 'COMPANY_SETTINGS', entityId: actor.companyId, action: 'COMPANY_NAME_UPDATED',
            oldValue: { name: company.name, accountVersion: company.accountVersion }, newValue: { name: saved.name, accountVersion: saved.accountVersion },
        }, tx);
        return { company: dto(saved), changed: true };
    });
}
