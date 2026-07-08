import { createHash, randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
const auth = vi.hoisted(() => ({ correct: vi.fn(async (plain: string, _hash: string) => plain === 'current-password') }));
vi.mock('../utils/auth.js', () => ({ isPasswordCorrect: auth.correct }));
import { createOwnerIdentityService } from './ownerIdentity.service.js';
import { configuredOwnerDelivery } from './ownerIdentityDelivery.service.js';
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const actor = { id: 7, companyId: 1, role: 'ADMIN' as const };
function harness() {
    let user: any = { ...actor, email: 'owner@example.invalid', password: 'stored-hash', isActive: true, emailVerifiedAt: null,
        credentialVersion: 0, refreshToken: 'prior-refresh', company: { isActive: false, operationalStatus: 'SUSPENDED' } };
    let rows: any[] = [], audits: any[] = [], enrolled = true, time = new Date('2026-10-20T10:00:00Z');
    const scheduled: Array<() => void> = [], messages: any[] = [];
    const tx = {
        $queryRaw: vi.fn(async () => []),
        manager: {
            findUnique: vi.fn(async ({ where }: any): Promise<any> => user.email === where.email ? { id: user.id } : null),
            findFirst: vi.fn(async ({ where }: any): Promise<any> => user.id === where.id && (!where.companyId || user.companyId === where.companyId) && user.role === where.role && user.isActive ? user : null),
            update: vi.fn(async ({ data }: any): Promise<any> => { user = { ...user, ...data, credentialVersion: user.credentialVersion + data.credentialVersion.increment }; return user; }),
        },
        credentialToken: {
            count: vi.fn(async ({ where }: any) => rows.filter(row => row.managerId === where.managerId && row.companyId === where.companyId && row.purpose === where.purpose && row.createdAt >= where.createdAt.gte).length),
            create: vi.fn(async ({ data }: any): Promise<any> => { const row = { ...data, id: randomUUID(), staffId: null, consumedAt: null }; rows.push(row); return row; }),
            findUnique: vi.fn(async ({ where }: any): Promise<any> => rows.find(row => row.tokenHash === where.tokenHash) ?? null),
            updateMany: vi.fn(async ({ where, data }: any) => { let count = 0; rows = rows.map(row => {
                const match = (!where.id || row.id === where.id) && (!where.companyId || row.companyId === where.companyId) && (!where.managerId || row.managerId === where.managerId) &&
                    (where.consumedAt !== null || row.consumedAt === null) && (!where.expiresAt || row.expiresAt > where.expiresAt.gt);
                if (!match) return row; ++count; return { ...row, ...data };
            }); return { count }; }),
        },
        auditLog: {
            findFirst: vi.fn(async (): Promise<any> => enrolled ? { id: 1 } : null),
            create: vi.fn(async ({ data }: any): Promise<any> => { const row = { ...data, id: audits.length + 1, createdAt: time }; audits.push(row); return row; }),
        },
    };
    const db = { ...tx, $transaction: vi.fn(async (run: any) => { const before = structuredClone({ user, rows, audits });
        try { return await run(tx); } catch (error) { user = before.user; rows = before.rows; audits = before.audits; throw error; } }) };
    const deliver = vi.fn(async (message: any) => { messages.push(message); });
    const service = createOwnerIdentityService({ db: db as any, delivery: () => deliver, now: () => time, defer: run => scheduled.push(run) });
    return { service, tx, db: db as any, deliver, messages, get user() { return user; }, get rows() { return rows; }, get audits() { return audits; },
        patch: (patch: any) => { user = { ...user, ...patch }; }, enroll: (value: boolean) => { enrolled = value; }, advance: (ms: number) => { time = new Date(+time + ms); },
        async flush() { for (const run of scheduled.splice(0)) run(); await service.whenIdle(); },
        addToken(purpose = 'RESET_OWNER_PASSWORD', patch: any = {}) { const raw = 't'.repeat(43); rows.push({ id: randomUUID(), tokenHash: hash(raw), purpose, companyId: 1, managerId: 7, staffId: null,
            targetEmail: user.email, createdAt: time, consumedAt: null, expiresAt: new Date(+time + 60000), ...patch }); return raw; },
    };
}
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); auth.correct.mockClear(); });

describe('owner enrollment and verification request', () => {
    it('requires persisted owner and current password, issues only a hash with24hour expiry, and never returns/logs token', async () => {
        const h = harness(), result = await h.service.requestVerification(actor, { currentPassword: 'current-password' });
        expect(result).toEqual({ requestAccepted: true, deliveryConfirmed: false }); expect(h.messages).toHaveLength(1);
        expect(h.rows[0]).toMatchObject({ purpose: 'VERIFY_OWNER_EMAIL', companyId: 1, managerId: 7, targetEmail: h.user.email,
            expiresAt: new Date('2026-10-21T10:00:00Z'), tokenHash: hash(h.messages[0].token) });
        expect(JSON.stringify([result, h.audits, h.rows])).not.toContain(h.messages[0].token);
        expect(h.user.emailVerifiedAt).toBeNull();
    });
    it.each(['MANAGER', 'STAFF', 'PLATFORM_OPERATOR'])('denies %s verification/status authority', async role => {
        const h = harness(); await expect(h.service.requestVerification({ ...actor, role } as any, { currentPassword: 'current-password' })).rejects.toMatchObject({ statusCode: 403 });
        await expect(h.service.status({ ...actor, role } as any)).rejects.toMatchObject({ statusCode: 403 }); expect(h.rows).toHaveLength(0);
    });
    it('does not auto-trust a legacy unverified address', async () => {
        const h = harness(); h.enroll(false);
        expect(await h.service.status(actor)).toEqual({ emailVerified: false, deliveryConfigured: true, bootstrapRequired: true });
        await expect(h.service.requestVerification(actor, { currentPassword: 'current-password' })).rejects.toMatchObject({ statusCode: 403 }); expect(h.messages).toHaveLength(0);
    });
    it('requires current exact owner/password/company even with an enrollment marker', async () => {
        const h = harness(); await expect(h.service.requestVerification(actor, { currentPassword: 'wrong-password' })).rejects.toMatchObject({ statusCode: 403 });
        await expect(h.service.requestVerification({ ...actor, companyId: 2 }, { currentPassword: 'current-password' })).rejects.toMatchObject({ statusCode: 403 }); expect(h.rows).toHaveLength(0);
    });
    it('allows own security without reactivating an inactive/suspended company', async () => {
        const h = harness(), before = structuredClone(h.user.company);
        await h.service.requestVerification(actor, { currentPassword: 'current-password' }); expect(h.user.company).toEqual(before);
    });
    it('does not issue redundant verification for already verified email', async () => {
        const h = harness(); h.patch({ emailVerifiedAt: new Date() }); await h.service.requestVerification(actor, { currentPassword: 'current-password' }); expect(h.rows).toHaveLength(0);
    });
    it('serializes and limits issuance to3 per15minutes without invalidating older valid links', async () => {
        const h = harness(); for (let n = 0; n < 4; n++) await h.service.requestVerification(actor, { currentPassword: 'current-password' });
        expect(h.rows).toHaveLength(3); expect(h.rows.every(row => row.consumedAt === null)).toBe(true); h.advance(15 * 60000 + 1);
        await h.service.requestVerification(actor, { currentPassword: 'current-password' }); expect(h.rows).toHaveLength(4);
    });
});

describe('neutral bounded public recovery admission', () => {
    it.each(['owner@example.invalid', 'unknown@example.invalid'])('returns same receipt before lookup/provider work for %s', async email => {
        const h = harness(); h.patch({ emailVerifiedAt: new Date() });
        expect(await h.service.requestRecovery({ email })).toEqual({ requestAccepted: true, deliveryConfirmed: false });
        expect(h.tx.manager.findUnique).not.toHaveBeenCalled(); expect(h.deliver).not.toHaveBeenCalled(); await h.flush();
        expect(h.messages).toHaveLength(email === 'owner@example.invalid' ? 1 : 0);
    });
    it.each([{ role: 'MANAGER' }, { isActive: false }, { emailVerifiedAt: null }])('does not recover an ineligible account %j', async patch => {
        const h = harness(); h.patch({ emailVerifiedAt: new Date(), ...patch }); await h.service.requestRecovery({ email: h.user.email }); await h.flush(); expect(h.messages).toHaveLength(0); expect(h.rows).toHaveLength(0);
    });
    it('uses30minute token lifetime and keeps raw secrets out of persistent/audit/response data', async () => {
        const h = harness(); h.patch({ emailVerifiedAt: new Date() }); await h.service.requestRecovery({ email: h.user.email }); await h.flush();
        expect(h.rows[0]).toMatchObject({ purpose: 'RESET_OWNER_PASSWORD', expiresAt: new Date('2026-10-20T10:30:00Z') });
        expect(JSON.stringify([h.rows, h.audits])).not.toContain(h.messages[0].token);
    });
    it('does not disclose a delivery rejection and does not invalidate a potentially delivered link', async () => {
        const h = harness(); h.patch({ emailVerifiedAt: new Date() }); h.deliver.mockRejectedValueOnce(new Error('PRIVATE provider detail'));
        expect(await h.service.requestRecovery({ email: h.user.email })).toEqual({ requestAccepted: true, deliveryConfirmed: false }); await h.flush();
        expect(h.audits.at(-1)).toMatchObject({ action: 'OWNER_IDENTITY_DELIVERY_UNCONFIRMED' }); expect(h.rows[0].consumedAt).toBeNull();
        expect(JSON.stringify(h.audits)).not.toContain('PRIVATE');
    });
    it('requires configured delivery before any account-specific lookup for all addresses', async () => {
        const h = harness(); const service = createOwnerIdentityService({ db: h.db, delivery: () => { throw new Error('disabled'); } });
        for (const email of ['owner@example.invalid', 'unknown@example.invalid']) await expect(service.requestRecovery({ email })).rejects.toMatchObject({ statusCode: 503, message: 'Owner email delivery is unavailable' });
        expect(h.tx.manager.findUnique).not.toHaveBeenCalled();
    });
    it('bounds public per-client admissions and in-memory work independently of account existence', async () => {
        const h = harness(); for (let n = 0; n < 20; n++) await h.service.requestRecovery({ email: 'unknown@example.invalid' }, 'same-client');
        await expect(h.service.requestRecovery({ email: 'unknown@example.invalid' }, 'same-client')).rejects.toMatchObject({ statusCode: 429 }); await h.flush();
        for (let n = 0; n < 64; n++) await h.service.requestRecovery({ email: 'unknown@example.invalid' }, `client-${n}`);
        await expect(h.service.requestRecovery({ email: 'owner@example.invalid' }, 'overload')).rejects.toMatchObject({ statusCode: 503 }); await h.flush();
    });
    it.each([{ email: 'bad' }, { email: 'owner@example.invalid', companyId: 2 }, { email: 'owner@example.invalid', role: 'ADMIN' }])('rejects invalid/forged public input %j', async raw => {
        await expect(harness().service.requestRecovery(raw)).rejects.toMatchObject({ statusCode: 400 });
    });
});

describe('purpose/company/email-bound atomic owner token consumption', () => {
    it('verifies email, consumes links and revokes access/refresh epoch without changing company state', async () => {
        const h = harness(), raw = h.addToken('VERIFY_OWNER_EMAIL');
        expect(await h.service.complete({ token: raw }, 'VERIFY_OWNER_EMAIL')).toEqual({ completed: true, signInRequired: true });
        expect(h.user).toMatchObject({ emailVerifiedAt: expect.any(Date), credentialVersion: 1, refreshToken: null, company: { isActive: false } });
        expect(h.rows[0].consumedAt).toBeInstanceOf(Date); expect(h.audits.at(-1)).toMatchObject({ action: 'OWNER_EMAIL_VERIFIED', actorType: 'SYSTEM' });
        await expect(h.service.complete({ token: raw }, 'VERIFY_OWNER_EMAIL')).rejects.toMatchObject({ statusCode: 400 });
    });
    it('resets verified owner once and consumes every other owner link while revoking sessions', async () => {
        const h = harness(); h.patch({ emailVerifiedAt: new Date() }); const raw = h.addToken();
        expect(await h.service.complete({ token: raw, newPassword: 'new-owner-password' }, 'RESET_OWNER_PASSWORD')).toEqual({ completed: true, signInRequired: true });
        expect(h.user).toMatchObject({ password: 'new-owner-password', credentialVersion: 1, refreshToken: null, mustChangePassword: false });
        await expect(h.service.complete({ token: raw, newPassword: 'different-password' }, 'RESET_OWNER_PASSWORD')).rejects.toMatchObject({ statusCode: 400 });
        expect(JSON.stringify(h.audits)).not.toContain('new-owner-password');
    });
    it.each([{ purpose: 'VERIFY_OWNER_EMAIL' }, { expiresAt: new Date('2026-10-20T10:00:00Z') }, { consumedAt: new Date() }, { targetEmail: 'other@example.invalid' },
        { companyId: 2 }, { managerId: 8 }, { staffId: 7 }, { createdAt: new Date('2026-10-20T11:00:00Z') }])('rejects invalid token binding/lifetime %j', async patch => {
        const h = harness(); h.patch({ emailVerifiedAt: new Date() }); const raw = h.addToken('RESET_OWNER_PASSWORD', patch);
        await expect(h.service.complete({ token: raw, newPassword: 'new-owner-password' }, 'RESET_OWNER_PASSWORD')).rejects.toMatchObject({ statusCode: 400 }); expect(h.tx.manager.update).not.toHaveBeenCalled();
    });
    it.each([{ isActive: false }, { role: 'MANAGER' }, { emailVerifiedAt: null }])('denies ineligible owner reset %j', async patch => {
        const h = harness(); h.patch({ emailVerifiedAt: new Date(), ...patch }); const raw = h.addToken();
        await expect(h.service.complete({ token: raw, newPassword: 'new-owner-password' }, 'RESET_OWNER_PASSWORD')).rejects.toMatchObject({ statusCode: 400 });
    });
    it('requires legacy enrollment at confirmation, not just at link issuance', async () => {
        const h = harness(), raw = h.addToken('VERIFY_OWNER_EMAIL'); h.enroll(false);
        await expect(h.service.complete({ token: raw }, 'VERIFY_OWNER_EMAIL')).rejects.toMatchObject({ statusCode: 400 });
    });
    it('rolls back consume/password/version when audit persistence fails', async () => {
        const h = harness(); h.patch({ emailVerifiedAt: new Date() }); const raw = h.addToken(); h.tx.auditLog.create.mockRejectedValueOnce(new Error('Synthetic audit failure'));
        await expect(h.service.complete({ token: raw, newPassword: 'new-owner-password' }, 'RESET_OWNER_PASSWORD')).rejects.toThrow('Synthetic audit failure');
        expect(h.user).toMatchObject({ password: 'stored-hash', credentialVersion: 0, refreshToken: 'prior-refresh' }); expect(h.rows[0].consumedAt).toBeNull();
    });
    it('denies a failed conditional consumption without password mutation', async () => {
        const h = harness(); h.patch({ emailVerifiedAt: new Date() }); const raw = h.addToken(); h.tx.credentialToken.updateMany.mockResolvedValueOnce({ count: 0 });
        await expect(h.service.complete({ token: raw, newPassword: 'new-owner-password' }, 'RESET_OWNER_PASSWORD')).rejects.toMatchObject({ statusCode: 400 }); expect(h.tx.manager.update).not.toHaveBeenCalled();
    });
    it.each([{ newPassword: 'short' }, { newPassword: 'آ'.repeat(40) }, { newPassword: 'current-password' }, { companyId: 2 }, { token: 'bad' }])('rejects invalid reset data %j', async patch => {
        const h = harness(); h.patch({ emailVerifiedAt: new Date() }); const raw = h.addToken();
        await expect(h.service.complete({ token: raw, newPassword: 'new-owner-password', ...patch }, 'RESET_OWNER_PASSWORD')).rejects.toMatchObject({ statusCode: 400 });
    });
});

const env = { OWNER_IDENTITY_MAIL_ENABLED: 'true', OWNER_IDENTITY_MAIL_PROVIDER: 'resend', OWNER_IDENTITY_SENDER_VERIFIED: 'true',
    OWNER_IDENTITY_SENDER_EMAIL: 'no-reply@example.invalid', OWNER_IDENTITY_RESEND_API_KEY: 'test-only-key-' + 'k'.repeat(32), OWNER_IDENTITY_WEB_ORIGIN: 'https://app.example.invalid' };
const message = { purpose: 'VERIFY_OWNER_EMAIL' as const, to: 'owner@example.invalid', token: 't'.repeat(43), operationId: randomUUID() };
describe('qualified opt-in no-network delivery adapter fixtures', () => {
    it.each(Object.keys(env))('fails closed with missing %s', field => {
        expect(() => configuredOwnerDelivery({ ...env, [field]: '' }, vi.fn())).toThrow('unavailable');
    });
    it.each(['http://app.example.invalid', 'https://user:secret@app.example.invalid', 'https://app.example.invalid/path', 'https://app.example.invalid/?token=secret'])('rejects unsafe link origin %s', origin => {
        expect(() => configuredOwnerDelivery({ ...env, OWNER_IDENTITY_WEB_ORIGIN: origin }, vi.fn())).toThrow('unavailable');
    });
    it('pins provider/redirect/timeout/idempotency, sends token in link fragment and never returns it', async () => {
        const fetcher = vi.fn(async () => new Response(JSON.stringify({ id: randomUUID() })));
        expect(await configuredOwnerDelivery(env, fetcher)(message)).toBeUndefined();
        const [url, options] = fetcher.mock.calls[0] as unknown as [string, RequestInit]; expect(url).toBe('https://api.resend.com/emails');
        expect(options).toMatchObject({ redirect: 'error', signal: expect.any(AbortSignal), headers: expect.objectContaining({ 'Idempotency-Key': `owner-identity/${message.operationId}` }) });
        const body = JSON.parse(options.body as string); expect(body.to).toEqual([message.to]); expect(body.text).toContain('/verify-owner-email#token='); expect(body.text).not.toContain('?token=');
    });
    it.each([new Response('PRIVATE', { status: 503 }), new Response('not-json'), new Response(JSON.stringify({ id: 'PRIVATE' })), new Response('x'.repeat(8193))])('sanitizes rejected/uncertain/malformed provider response', async response => {
        await expect(configuredOwnerDelivery(env, async () => response)(message)).rejects.toMatchObject({ statusCode: 503, message: 'Owner email delivery is unavailable' });
    });
});

describe('owner identity HTTP boundary', () => {
    async function request(path: string, body: object) {
        const express = (await import('express')).default;
        const router = (await import('../routes/ownerIdentity.route.js')).default;
        const app = express(); app.use(express.json()); app.use('/owner', router);
        app.use((error: any, _req: any, res: any, _next: any) => res.status(error.statusCode ?? 500).json({ message: error.message }));
        const server = app.listen(0, '127.0.0.1'); await new Promise<void>(resolve => server.once('listening', resolve));
        const port = (server.address() as import('node:net').AddressInfo).port;
        try {
            const response = await fetch(`http://127.0.0.1:${port}/owner${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
            return { status: response.status, cache: response.headers.get('Cache-Control'), referrer: response.headers.get('Referrer-Policy'), body: await response.json() };
        } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
    }
    it('requires authentication before email enrollment request', async () => {
        expect(await request('/email/request', { currentPassword: 'current-password' })).toMatchObject({ status: 401, cache: 'private, no-store', referrer: 'no-referrer' });
    });
    it('makes missing sender unavailable for known and unknown recovery addresses without DB lookup', async () => {
        vi.stubEnv('OWNER_IDENTITY_MAIL_ENABLED', 'false'); vi.stubEnv('OWNER_IDENTITY_WEB_ORIGIN', '');
        for (const email of ['owner@example.invalid', 'unknown@example.invalid']) expect(await request('/recovery/request', { email })).toMatchObject({ status: 503, body: { message: 'Owner email delivery is unavailable' } });
    });
    it('sanitizes unexpected credential-storage errors at HTTP adapter before generic logging', async () => {
        const { ownerIdentity } = await import('./ownerIdentity.service.js');
        const stub = vi.spyOn(ownerIdentity, 'complete').mockRejectedValueOnce(new Error('PRIVATE raw password or token'));
        try { expect(await request('/recovery/complete', { token: 't'.repeat(43), newPassword: 'new-password' })).toMatchObject({ status: 503, body: { message: 'Owner security processing is unavailable' } }); }
        finally { stub.mockRestore(); }
    });
});
