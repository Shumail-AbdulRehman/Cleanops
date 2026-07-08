import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../prisma/prisma.js';
import { ApiError } from '../utils/ApiError.js';
import { writeAuditLog } from './auditLog.service.js';
import { loadOperatorIdentityConfig, type OperatorPrincipal } from './operatorIdentity.service.js';
import type { VerificationTransaction } from './verification-v2/transaction.js';

type Db = typeof prisma;
const uuid = z.uuid().transform(value => value.toLowerCase());
const identity = z.object({ issuer: z.string().min(1).max(2048).refine(value => value.trim() === value), subject: z.string().min(1).max(256).refine(value => value.trim() === value) }).strict();
const status = z.enum(['NEW', 'IN_PROGRESS', 'CLOSED']);
const storedState = z.object({ inquiryId: uuid, status, owner: identity.nullable(), operator: identity }).strict();
const updateInput = z.object({ expectedVersion: z.number().int().min(0).max(2147483646), status,
    ownership: z.enum(['SELF', 'UNASSIGNED']), reason: z.string().trim().min(1).max(500).refine(value => !/[\u0000-\u001f\u007f]/.test(value)) }).strict();
const limit = z.string().regex(/^[1-9]\d?$/).transform(Number).pipe(z.number().max(50)).optional();
const inquiryQuery = z.object({ q: z.string().trim().max(100).optional(), after: uuid.optional(), limit }).strict();
const auditActions = ['COMPANY_SUSPENDED', 'COMPANY_REACTIVATED', 'INQUIRY_UPDATED'] as const;
const positive = z.string().regex(/^[1-9]\d{0,9}$/).transform(Number).pipe(z.number().int().max(2147483647));
const auditQuery = z.object({ after: positive.optional(), companyId: positive.optional(), action: z.enum(auditActions).optional(), limit }).strict();
const summarySelect = { id: true, company: true, locations: true, staff: true, createdAt: true } satisfies Prisma.EnterpriseInquirySelect;
const auditWhere = { actorType: 'PLATFORM_OPERATOR', OR: [
    { entityType: 'COMPANY_ACCOUNT', action: { in: ['COMPANY_SUSPENDED', 'COMPANY_REACTIVATED'] } },
    { entityType: 'PLATFORM_INQUIRY', action: 'INQUIRY_UPDATED', companyId: null, entityId: 0 },
] } satisfies Prisma.AuditLogWhereInput;
function operator(actor: OperatorPrincipal) {
    if (!actor || actor.kind !== 'PLATFORM_OPERATOR' || !identity.safeParse({ issuer: actor.issuer, subject: actor.subject }).success)
        throw new ApiError(403, 'Platform operator required');
}
function inquiryId(raw: unknown) {
    const parsed = uuid.safeParse(raw); if (!parsed.success) throw new ApiError(400, 'Invalid inquiry identifier'); return parsed.data;
}
const unavailable = () => new ApiError(503, 'Support operations are temporarily unavailable');
const actorIdentity = (actor: OperatorPrincipal) => ({ issuer: actor.issuer, subject: actor.subject });

/** Deployment owner must qualify the actual mailbox before setting VERIFIED=true. No message is sent here. */
export function getSupportContact(env: NodeJS.ProcessEnv = process.env) {
    const email = env.SUPPORT_CONTACT_EMAIL?.trim();
    if (env.SUPPORT_CONTACT_VERIFIED !== 'true' || !email || email.length > 254 || !z.email().safeParse(email).success)
        return { available: false as const, email: null, channel: null, verification: 'UNAVAILABLE' as const };
    return { available: true as const, email, channel: 'EMAIL' as const, verification: 'OPERATOR_CONFIGURED' as const };
}
async function currentState(tx: VerificationTransaction, id: string) {
    const row = await tx.auditLog.findFirst({ where: { companyId: null, entityType: 'PLATFORM_INQUIRY', entityId: 0, actorType: 'PLATFORM_OPERATOR',
        action: 'INQUIRY_UPDATED', newValue: { path: ['inquiryId'], equals: id } }, select: { id: true, newValue: true, createdAt: true }, orderBy: { id: 'desc' } });
    if (!row) return { version: 0, status: 'NEW' as const, owner: null, updatedAt: null as Date | null };
    const parsed = storedState.safeParse(row.newValue);
    if (!parsed.success || parsed.data.inquiryId !== id) throw unavailable();
    return { version: row.id, status: parsed.data.status, owner: parsed.data.owner, updatedAt: row.createdAt };
}
const inquirySummary = (row: Prisma.EnterpriseInquiryGetPayload<{ select: typeof summarySelect }>) => ({ id: row.id, company: row.company,
    requestedLocations: row.locations, requestedStaff: row.staff, createdAt: row.createdAt, contactVerification: 'UNVERIFIED' as const });

export async function listPlatformInquiries(actor: OperatorPrincipal, raw: unknown = {}, db: Db = prisma) {
    operator(actor); const parsed = inquiryQuery.safeParse(raw);
    if (!parsed.success) throw new ApiError(400, 'Invalid inquiry filters');
    const { q, after, limit = 25 } = parsed.data;
    return db.$transaction(async tx => {
        if (after && !await tx.enterpriseInquiry.findUnique({ where: { id: after }, select: { id: true } })) throw new ApiError(400, 'Invalid inquiry cursor');
        const rows = await tx.enterpriseInquiry.findMany({ where: q ? { company: { contains: q, mode: 'insensitive' } } : {}, select: summarySelect,
            orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: limit + 1, ...(after ? { cursor: { id: after }, skip: 1 } : {}) });
        const page = rows.slice(0, limit);
        // At most50 bounded latest-event lookups; never read all event JSON into memory.
        const items = await Promise.all(page.map(async row => ({ ...inquirySummary(row), handling: await currentState(tx, row.id) })));
        return { items, nextCursor: rows.length > limit ? page.at(-1)!.id : null };
    }, { isolationLevel: 'RepeatableRead' });
}
export async function getPlatformInquiry(actor: OperatorPrincipal, rawId: unknown, db: Db = prisma) {
    operator(actor); const id = inquiryId(rawId);
    return db.$transaction(async tx => {
        const row = await tx.enterpriseInquiry.findUnique({ where: { id }, select: { ...summarySelect, name: true, email: true, requirements: true } });
        if (!row) throw new ApiError(404, 'Inquiry not found');
        return { ...inquirySummary(row), contactName: row.name, contactEmail: row.email,
            requirements: row.requirements, handling: await currentState(tx, id) };
    }, { isolationLevel: 'RepeatableRead' });
}
export async function updatePlatformInquiry(actor: OperatorPrincipal, rawId: unknown, raw: unknown, db: Db = prisma) {
    operator(actor); const id = inquiryId(rawId), parsed = updateInput.safeParse(raw);
    if (!parsed.success) throw new ApiError(400, 'A queue status, ownership, current version and reason are required');
    const input = parsed.data;
    return db.$transaction(async tx => {
        // Keep the original public submission immutable; its row serializes queue state.
        await tx.$queryRaw`SELECT id FROM "EnterpriseInquiry" WHERE id=${id} FOR UPDATE`;
        if (!await tx.enterpriseInquiry.findUnique({ where: { id }, select: { id: true } })) throw new ApiError(404, 'Inquiry not found');
        const before = await currentState(tx, id);
        if (before.version !== input.expectedVersion) throw new ApiError(409, 'Inquiry handling changed. Reload before trying again.');
        const owner = input.ownership === 'SELF' ? actorIdentity(actor) : null;
        if (before.status === input.status && before.owner?.issuer === owner?.issuer && before.owner?.subject === owner?.subject)
            return { handling: before, changed: false };
        const saved = await writeAuditLog({ companyId: null, actorType: 'PLATFORM_OPERATOR', actorId: null,
            entityType: 'PLATFORM_INQUIRY', entityId: 0, action: 'INQUIRY_UPDATED', reason: input.reason, oldValue: { ...before, updatedAt: before.updatedAt?.toISOString() ?? null },
            newValue: { inquiryId: id, status: input.status, owner, operator: actorIdentity(actor) } }, tx);
        return { handling: { version: saved.id, status: input.status, owner, updatedAt: saved.createdAt }, changed: true };
    });
}
export async function listPlatformAudit(actor: OperatorPrincipal, raw: unknown = {}, db: Db = prisma) {
    operator(actor); const parsed = auditQuery.safeParse(raw);
    if (!parsed.success) throw new ApiError(400, 'Invalid audit filters');
    const { after, companyId, action, limit = 25 } = parsed.data;
    const rows = await db.auditLog.findMany({ where: { ...auditWhere, ...(companyId ? { companyId } : {}), ...(action ? { action } : {}), ...(after ? { id: { lt: after } } : {}) },
        select: { id: true, companyId: true, action: true, createdAt: true }, orderBy: { id: 'desc' }, take: limit + 1 });
    const page = rows.slice(0, limit);
    return { items: page.map(row => ({ id: row.id, companyId: row.companyId, action: row.action, actorType: 'PLATFORM_OPERATOR' as const, createdAt: row.createdAt })),
        nextCursor: rows.length > limit ? String(page.at(-1)!.id) : null };
}
export async function getPlatformDiagnostics(actor: OperatorPrincipal, db: Db = prisma, env: NodeJS.ProcessEnv = process.env) {
    operator(actor);
    let identityConfigured = false; try { loadOperatorIdentityConfig(env); identityConfigured = true; } catch { /* No config details in diagnostics. */ }
    const base = { observedAt: new Date(), identityConfigured, supportContactAvailable: getSupportContact(env).available,
        providerConnectivity: 'NOT_CHECKED' as const };
    try {
        const observed = await db.$transaction(async tx => {
            await tx.$queryRaw`SELECT 1`;
            const webhook = await tx.paddleWebhookEvent.aggregate({ _max: { occurredAt: true, processedAt: true } });
            const worker = await tx.verificationWorkerHeartbeat.aggregate({ _max: { lastSeenAt: true } });
            return { lastWebhookOccurredAt: webhook._max.occurredAt, lastWebhookProcessedAt: webhook._max.processedAt,
                lastWorkerHeartbeatAt: worker._max.lastSeenAt };
        }, { isolationLevel: 'RepeatableRead' });
        return { ...base, database: 'REACHABLE' as const, observations: observed };
    } catch { return { ...base, database: 'UNAVAILABLE' as const, observations: null }; }
}
