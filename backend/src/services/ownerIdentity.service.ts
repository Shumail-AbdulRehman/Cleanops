import { createHash, randomBytes } from 'node:crypto';
import { z } from 'zod';
import { prisma } from '../prisma/prisma.js';
import { ApiError } from '../utils/ApiError.js';
import { isPasswordCorrect } from '../utils/auth.js';
import { writeAuditLog } from './auditLog.service.js';
import { configuredOwnerDelivery, type OwnerDelivery, type OwnerPurpose } from './ownerIdentityDelivery.service.js';
import type { VerificationActor } from './verification-v2/authorization.service.js';
import type { VerificationTransaction } from './verification-v2/transaction.js';

type Db = typeof prisma;
const hash = (text: string) => createHash('sha256').update(text).digest('hex');
const token = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
const recoveryInput = z.object({ email: z.email().max(254) }).strict();
const verificationInput = z.object({ currentPassword: z.string().min(1).max(1024) }).strict();
const resetInput = z.object({ token, newPassword: z.string().min(8).refine(value => Buffer.byteLength(value, 'utf8') <= 72) }).strict();
const verifyInput = z.object({ token }).strict();
const select = { id: true, companyId: true, role: true, isActive: true, email: true, password: true, emailVerifiedAt: true, credentialVersion: true } as const;
const unavailable = () => new ApiError(503, 'Owner email delivery is unavailable');
const invalid = () => new ApiError(400, 'This owner link is invalid or expired');
const accepted = () => ({ requestAccepted: true, deliveryConfirmed: false });

export function createOwnerIdentityService(deps: { db?: Db; delivery?: () => OwnerDelivery; now?: () => Date;
    defer?: (work: () => void) => void } = {}) {
    const db = deps.db ?? prisma, now = deps.now ?? (() => new Date());
    const buckets = new Map<string, { until: number; count: number }>();
    const jobs = new Set<Promise<void>>(); let pending = 0;
    function rateLimit(clientKey: string, area: string) {
        const at = +now(), key = hash(`${area}:${clientKey}`);
        let bucket = buckets.get(key);
        if (!bucket || bucket.until <= at) {
            if (buckets.size >= 10000) for (const [id, value] of buckets) if (value.until <= at) buckets.delete(id);
            if (buckets.size >= 10000 && !buckets.has(key)) throw new ApiError(429, 'Too many identity requests. Try again later.');
            bucket = { until: at + 15 * 60_000, count: 0 }; buckets.set(key, bucket);
        }
        if (++bucket.count > 20) throw new ApiError(429, 'Too many identity requests. Try again later.');
    }
    function delivery() { try { return (deps.delivery ?? configuredOwnerDelivery)(); } catch { throw unavailable(); } }
    async function owner(tx: VerificationTransaction, id: number, companyId?: number) {
        return tx.manager.findFirst({ where: { id, ...(companyId ? { companyId } : {}), role: 'ADMIN', isActive: true }, select });
    }
    async function enrollment(tx: VerificationTransaction, user: { id: number; companyId: number; email: string }) {
        return tx.auditLog.findFirst({ where: { companyId: user.companyId, entityType: 'MANAGER', entityId: user.id,
            action: 'OWNER_EMAIL_ENROLLMENT_ALLOWED', AND: [
                { newValue: { path: ['emailHash'], equals: hash(user.email) } },
                { OR: [ { actorType: 'ADMIN', actorId: user.id, newValue: { path: ['source'], equals: 'REGISTRATION' } },
                    { actorType: 'SYSTEM', actorId: null, newValue: { path: ['source'], equals: 'IDENTITY_CHECKED_BOOTSTRAP' } } ] },
            ] }, select: { id: true } });
    }
    function assertOwner(actor: VerificationActor) {
        if (!actor || actor.role !== 'ADMIN' || !Number.isSafeInteger(actor.id) || actor.id < 1 || !Number.isSafeInteger(actor.companyId) || actor.companyId < 1)
            throw new ApiError(403, 'Company owner access required');
    }
    async function issue(tx: VerificationTransaction, user: NonNullable<Awaited<ReturnType<typeof owner>>>, purpose: OwnerPurpose) {
        const at = now();
        const recent = await tx.credentialToken.count({ where: { companyId: user.companyId, managerId: user.id, purpose, createdAt: { gte: new Date(+at - 15 * 60_000) } } });
        if (recent >= 3) return null;
        const raw = randomBytes(32).toString('base64url'), expiresAt = new Date(+at + (purpose === 'VERIFY_OWNER_EMAIL' ? 24 * 60 * 60_000 : 30 * 60_000));
        const saved = await tx.credentialToken.create({ data: { tokenHash: hash(raw), purpose, companyId: user.companyId, managerId: user.id,
            targetEmail: user.email, createdAt: at, expiresAt }, select: { id: true } });
        await writeAuditLog({ companyId: user.companyId, actorType: purpose === 'VERIFY_OWNER_EMAIL' ? 'ADMIN' : 'SYSTEM',
            actorId: purpose === 'VERIFY_OWNER_EMAIL' ? user.id : null, entityType: 'MANAGER', entityId: user.id, action: 'OWNER_IDENTITY_LINK_ISSUED',
            newValue: { purpose, expiresAt: expiresAt.toISOString() } }, tx);
        return { to: user.email, token: raw, operationId: saved.id, purpose, managerId: user.id, companyId: user.companyId };
    }
    async function send(message: NonNullable<Awaited<ReturnType<typeof issue>>>, deliver: OwnerDelivery) {
        let providerAccepted = false;
        try { await deliver(message); providerAccepted = true; } catch { /* A timeout may still have delivered a valid link. */ }
        await writeAuditLog({ companyId: message.companyId, actorType: 'SYSTEM', entityType: 'MANAGER', entityId: message.managerId,
            action: providerAccepted ? 'OWNER_IDENTITY_PROVIDER_ACCEPTED' : 'OWNER_IDENTITY_DELIVERY_UNCONFIRMED', newValue: { purpose: message.purpose } }, db);
    }
    function defer(work: () => Promise<void>) {
        ++pending;
        let finish!: () => void;
        const job = new Promise<void>(resolve => { finish = resolve; }); jobs.add(job);
        (deps.defer ?? (run => { setImmediate(run); }))(async () => {
            try { await work(); } catch {
                // Never emit an exception containing token/email/provider request data.
                console.warn('Owner identity request processing unavailable');
            } finally { --pending; jobs.delete(job); finish(); }
        });
    }
    return {
        async status(actor: VerificationActor) {
            assertOwner(actor);
            return db.$transaction(async tx => {
                const user = await owner(tx, actor.id, actor.companyId);
                if (!user) throw new ApiError(403, 'Company owner access required');
                let deliveryConfigured = false; try { delivery(); deliveryConfigured = true; } catch { /* Safe availability only. */ }
                const enrolled = !!user.emailVerifiedAt || !!await enrollment(tx, user);
                return { emailVerified: !!user.emailVerifiedAt, deliveryConfigured, bootstrapRequired: !enrolled };
            });
        },
        async requestRecovery(raw: unknown, clientKey = 'local') {
            const parsed = recoveryInput.safeParse(raw); if (!parsed.success) throw new ApiError(400, 'Enter a valid owner email');
            const deliver = delivery();
            rateLimit(clientKey, 'recovery'); if (pending >= 64) throw unavailable();
            // Account lookup and provider timing never influence the public response.
            // Admission is volatile and explicitly makes no durable/sent guarantee.
            defer(async () => {
                const initial = await db.manager.findUnique({ where: { email: parsed.data.email }, select: { id: true } });
                if (!initial) return;
                const message = await db.$transaction(async tx => {
                    await tx.$queryRaw`SELECT id FROM "Manager" WHERE id=${initial.id} FOR UPDATE`;
                    const user = await owner(tx, initial.id);
                    if (!user || user.email !== parsed.data.email || !user.emailVerifiedAt) return null;
                    return issue(tx, user, 'RESET_OWNER_PASSWORD');
                });
                if (message) await send(message, deliver);
            });
            return accepted();
        },
        async requestVerification(actor: VerificationActor, raw: unknown, clientKey = 'local') {
            assertOwner(actor);
            const parsed = verificationInput.safeParse(raw); if (!parsed.success) throw new ApiError(400, 'Enter your current password');
            const deliver = delivery(); rateLimit(clientKey, 'verify'); if (pending >= 64) throw unavailable();
            ++pending;
            try {
            const message = await db.$transaction(async tx => {
                await tx.$queryRaw`SELECT id FROM "Manager" WHERE id=${actor.id} FOR UPDATE`;
                const user = await owner(tx, actor.id, actor.companyId);
                if (!user || !await isPasswordCorrect(parsed.data.currentPassword, user.password)) throw new ApiError(403, 'Current owner credentials could not be verified');
                if (user.emailVerifiedAt) return null;
                const enrolled = await enrollment(tx, user);
                if (!enrolled) throw new ApiError(403, 'Identity-verified enrollment is required before verifying this legacy email');
                return issue(tx, user, 'VERIFY_OWNER_EMAIL');
            });
            if (message) await send(message, deliver);
            return accepted();
            } finally { --pending; }
        },
        async complete(raw: unknown, purpose: OwnerPurpose, clientKey = 'local') {
            const parsed = (purpose === 'VERIFY_OWNER_EMAIL' ? verifyInput : resetInput).safeParse(raw);
            if (!parsed.success) throw invalid(); rateLimit(clientKey, 'complete');
            const tokenHash = hash(parsed.data.token);
            return db.$transaction(async tx => {
                const initial = await tx.credentialToken.findUnique({ where: { tokenHash }, select: { managerId: true } });
                if (!initial?.managerId) throw invalid();
                await tx.$queryRaw`SELECT id FROM "Manager" WHERE id=${initial.managerId} FOR UPDATE`;
                await tx.$queryRaw`SELECT id FROM "CredentialToken" WHERE "tokenHash"=${tokenHash} FOR UPDATE`;
                const saved = await tx.credentialToken.findUnique({ where: { tokenHash } }), at = now();
                if (!saved || saved.managerId !== initial.managerId || saved.purpose !== purpose || saved.staffId !== null || saved.consumedAt || saved.createdAt > at || saved.expiresAt <= at) throw invalid();
                const user = await owner(tx, initial.managerId, saved.companyId);
                if (!user || user.email !== saved.targetEmail || (purpose === 'RESET_OWNER_PASSWORD' ? !user.emailVerifiedAt : !!user.emailVerifiedAt) || user.credentialVersion >= 2147483647) throw invalid();
                if (purpose === 'VERIFY_OWNER_EMAIL' && !await enrollment(tx, user)) throw invalid();
                const newPassword = 'newPassword' in parsed.data ? parsed.data.newPassword as string : undefined;
                if (purpose === 'RESET_OWNER_PASSWORD' && (!newPassword || await isPasswordCorrect(newPassword, user.password))) throw invalid();
                const changed = await tx.credentialToken.updateMany({ where: { id: saved.id, consumedAt: null, expiresAt: { gt: at } }, data: { consumedAt: at } });
                if (changed.count !== 1) throw invalid();
                await tx.manager.update({ where: { id: user.id }, data: { ...(purpose === 'VERIFY_OWNER_EMAIL' ? { emailVerifiedAt: at } : { password: newPassword, mustChangePassword: false }),
                    credentialVersion: { increment: 1 }, refreshToken: null } });
                await tx.credentialToken.updateMany({ where: { companyId: user.companyId, managerId: user.id, consumedAt: null }, data: { consumedAt: at } });
                await writeAuditLog({ companyId: user.companyId, actorType: 'SYSTEM', entityType: 'MANAGER', entityId: user.id,
                    action: purpose === 'VERIFY_OWNER_EMAIL' ? 'OWNER_EMAIL_VERIFIED' : 'OWNER_PASSWORD_RESET', newValue: { sessionsRevoked: true } }, tx);
                return { completed: true, signInRequired: true };
            });
        },
        async whenIdle() { await Promise.all([...jobs]); },
    };
}
export const ownerIdentity = createOwnerIdentityService();
