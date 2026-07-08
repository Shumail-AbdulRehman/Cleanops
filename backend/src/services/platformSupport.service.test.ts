import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getPlatformDiagnostics, getPlatformInquiry, getSupportContact, listPlatformAudit, listPlatformInquiries, updatePlatformInquiry } from './platformSupport.service.js';
import type { OperatorPrincipal } from './operatorIdentity.service.js';
const actor: OperatorPrincipal = { kind: 'PLATFORM_OPERATOR', issuer: 'https://identity.example.test/', subject: 'synthetic-operator' };
const input = (expectedVersion = 0) => ({ expectedVersion, status: 'IN_PROGRESS', ownership: 'SELF', reason: '  Synthetic inquiry triage  ' });
function harness() {
    const inquiry: any = { id: randomUUID(), company: 'Synthetic lead', name: 'Synthetic contact', email: 'lead@example.invalid', locations: 3, staff: 12,
        requirements: 'Synthetic submitted requirements', createdAt: new Date('2026-10-20'), password: 'PRIVATE', photos: ['PRIVATE'] };
    let events: any[] = [];
    const tx = {
        $queryRaw: vi.fn(async () => [{ '?column?': 1 }]),
        enterpriseInquiry: {
            findUnique: vi.fn(async (): Promise<any> => inquiry), findMany: vi.fn(async (): Promise<any[]> => [inquiry]),
            update: vi.fn(async () => { throw new Error('Do not rewrite submitted lead'); }),
        },
        auditLog: {
            findFirst: vi.fn(async (): Promise<any> => events.at(-1) ?? null), findMany: vi.fn(async (): Promise<any[]> => events),
            create: vi.fn(async ({ data }: any): Promise<any> => { const row = { ...data, id: events.length + 1, createdAt: new Date(), privateField: 'PRIVATE' }; events.push(row); return row; }),
        },
        paddleWebhookEvent: { aggregate: vi.fn(async (): Promise<any> => ({ _max: { occurredAt: null, processedAt: null }, secret: 'PRIVATE' })) },
        verificationWorkerHeartbeat: { aggregate: vi.fn(async (): Promise<any> => ({ _max: { lastSeenAt: null }, workerId: 'PRIVATE' })) },
    };
    const db = { ...tx, $transaction: vi.fn(async (run: any) => { const before = [...events];
        try { return await run(tx); } catch (error) { events = before; throw error; } }) };
    return { tx, db: db as any, inquiry, get events() { return events; } };
}
afterEach(() => vi.unstubAllEnvs());

describe('configured contact availability', () => {
    it.each([{}, { SUPPORT_CONTACT_EMAIL: 'help@example.invalid' }, { SUPPORT_CONTACT_VERIFIED: 'true' },
        { SUPPORT_CONTACT_VERIFIED: 'TRUE', SUPPORT_CONTACT_EMAIL: 'help@example.invalid' },
        { SUPPORT_CONTACT_VERIFIED: 'true', SUPPORT_CONTACT_EMAIL: 'not-email' },
        { SUPPORT_CONTACT_VERIFIED: 'true', SUPPORT_CONTACT_EMAIL: 'help@example.invalid\r\nBcc:evil@example.invalid' }])('keeps unqualified channel unavailable %j', env => {
        expect(getSupportContact(env)).toEqual({ available: false, email: null, channel: null, verification: 'UNAVAILABLE' });
    });
    it('exposes only explicitly provisioned qualified mailbox, without claiming delivery', () => {
        expect(getSupportContact({ SUPPORT_CONTACT_EMAIL: ' help@example.invalid ', SUPPORT_CONTACT_VERIFIED: 'true', PRIVATE_KEY: 'PRIVATE' }))
            .toEqual({ available: true, email: 'help@example.invalid', channel: 'EMAIL', verification: 'OPERATOR_CONFIGURED' });
    });
});

describe('separate platform support authority', () => {
    it.each(['ADMIN', 'MANAGER', 'STAFF', 'SYSTEM'])('denies tenant %s at every service boundary', async role => {
        const h = harness(), denied = { id: 7, companyId: 1, role } as unknown as OperatorPrincipal;
        await expect(listPlatformInquiries(denied, {}, h.db)).rejects.toMatchObject({ statusCode: 403 });
        await expect(getPlatformInquiry(denied, h.inquiry.id, h.db)).rejects.toMatchObject({ statusCode: 403 });
        await expect(updatePlatformInquiry(denied, h.inquiry.id, input(), h.db)).rejects.toMatchObject({ statusCode: 403 });
        await expect(listPlatformAudit(denied, {}, h.db)).rejects.toMatchObject({ statusCode: 403 });
        await expect(getPlatformDiagnostics(denied, h.db)).rejects.toMatchObject({ statusCode: 403 });
        expect(h.db.$transaction).not.toHaveBeenCalled(); expect(h.tx.auditLog.findMany).not.toHaveBeenCalled();
    });
    it.each([null, {}, { ...actor, subject: '' }, { ...actor, issuer: ' ' }])('rejects incomplete principal %j', async denied => {
        await expect(getPlatformDiagnostics(denied as OperatorPrincipal, harness().db)).rejects.toMatchObject({ statusCode: 403 });
    });
});

describe('durable inquiry handling', () => {
    it('returns existing commercial submission metadata, unverified contact truth and NEW initial handling', async () => {
        const h = harness(), result = await listPlatformInquiries(actor, {}, h.db);
        expect(result.items[0]).toEqual({ id: h.inquiry.id, company: 'Synthetic lead', requestedLocations: 3, requestedStaff: 12, createdAt: h.inquiry.createdAt,
            contactVerification: 'UNVERIFIED', handling: { version: 0, status: 'NEW', owner: null, updatedAt: null } });
        expect(h.tx.enterpriseInquiry.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 26, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] }));
        expect(JSON.stringify(result)).not.toContain('PRIVATE'); expect(JSON.stringify(result)).not.toContain('lead@example.invalid');
    });
    it('bounds name search/paging and returns honest empty state', async () => {
        const h = harness(); h.tx.enterpriseInquiry.findMany.mockResolvedValueOnce([]);
        expect(await listPlatformInquiries(actor, { q: ' Synthetic ', limit: '1', after: h.inquiry.id }, h.db)).toEqual({ items: [], nextCursor: null });
        expect(h.tx.enterpriseInquiry.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { company: { contains: 'Synthetic', mode: 'insensitive' } }, take: 2, skip: 1, cursor: { id: h.inquiry.id } }));
    });
    it('returns next cursor with bounded results and refuses nonexistent cursor', async () => {
        const h = harness(); h.tx.enterpriseInquiry.findMany.mockResolvedValueOnce([h.inquiry, { ...h.inquiry, id: randomUUID() }]);
        expect((await listPlatformInquiries(actor, { limit: '1' }, h.db)).nextCursor).toBe(h.inquiry.id);
        h.tx.enterpriseInquiry.findUnique.mockResolvedValueOnce(null);
        await expect(listPlatformInquiries(actor, { after: randomUUID() }, h.db)).rejects.toMatchObject({ statusCode: 400 });
    });
    it('returns submitted contact/requirements only in operator detail, never private workforce/model fields', async () => {
        const h = harness(), result = await getPlatformInquiry(actor, h.inquiry.id, h.db);
        expect(result).toMatchObject({ contactEmail: h.inquiry.email, contactName: h.inquiry.name, requirements: h.inquiry.requirements, contactVerification: 'UNVERIFIED' });
        expect(JSON.stringify(result)).not.toContain('PRIVATE');
    });
    it('persists a reasoned self-claim/status with exact operator provenance and leaves submission unchanged', async () => {
        const h = harness(), before = structuredClone(h.inquiry);
        const result = await updatePlatformInquiry(actor, h.inquiry.id, input(), h.db);
        expect(result).toMatchObject({ changed: true, handling: { version: 1, status: 'IN_PROGRESS', owner: { issuer: actor.issuer, subject: actor.subject }, updatedAt: expect.any(Date) } });
        expect(h.events).toEqual([expect.objectContaining({ companyId: null, actorType: 'PLATFORM_OPERATOR', actorId: null, entityId: 0, entityType: 'PLATFORM_INQUIRY', action: 'INQUIRY_UPDATED', reason: 'Synthetic inquiry triage',
            newValue: { inquiryId: h.inquiry.id, status: 'IN_PROGRESS', owner: { issuer: actor.issuer, subject: actor.subject }, operator: { issuer: actor.issuer, subject: actor.subject } } })]);
        expect((await getPlatformInquiry(actor, h.inquiry.id, h.db)).handling).toEqual(result.handling);
        expect(h.inquiry).toEqual(before); expect(h.tx.enterpriseInquiry.update).not.toHaveBeenCalled();
    });
    it('conflicts for stale save, no-ops current exact state and permits reasoned release/close', async () => {
        const h = harness(); await updatePlatformInquiry(actor, h.inquiry.id, input(), h.db);
        await expect(updatePlatformInquiry(actor, h.inquiry.id, input(), h.db)).rejects.toMatchObject({ statusCode: 409 });
        expect(await updatePlatformInquiry(actor, h.inquiry.id, input(1), h.db)).toMatchObject({ changed: false });
        expect(await updatePlatformInquiry(actor, h.inquiry.id, { ...input(1), ownership: 'UNASSIGNED', status: 'CLOSED' }, h.db)).toMatchObject({ handling: { owner: null, status: 'CLOSED', version: 2 } });
        expect(h.events).toHaveLength(2);
    });
    it('fails closed on invalid stored handling instead of inventing NEW state', async () => {
        const h = harness(); h.tx.auditLog.findFirst.mockResolvedValue({ id: 1, createdAt: new Date(), newValue: { inquiryId: h.inquiry.id, secret: 'PRIVATE' } });
        await expect(getPlatformInquiry(actor, h.inquiry.id, h.db)).rejects.toMatchObject({ statusCode: 503, message: 'Support operations are temporarily unavailable' });
        await expect(updatePlatformInquiry(actor, h.inquiry.id, input(), h.db)).rejects.toMatchObject({ statusCode: 503 });
        expect(h.events).toHaveLength(0);
    });
    it('does not claim success if audit storage fails', async () => {
        const h = harness(); h.tx.auditLog.create.mockRejectedValueOnce(new Error('Synthetic storage failure'));
        await expect(updatePlatformInquiry(actor, h.inquiry.id, input(), h.db)).rejects.toThrow('Synthetic storage failure'); expect(h.events).toHaveLength(0);
    });
    it('returns honest not-found for missing inquiry', async () => {
        const h = harness(); h.tx.enterpriseInquiry.findUnique.mockResolvedValue(null);
        await expect(getPlatformInquiry(actor, h.inquiry.id, h.db)).rejects.toMatchObject({ statusCode: 404 });
        await expect(updatePlatformInquiry(actor, h.inquiry.id, input(), h.db)).rejects.toMatchObject({ statusCode: 404 });
    });
    it.each([{ reason: '' }, { reason: ' ' }, { reason: 'a'.repeat(501) }, { reason: 'bad\u0000reason' }, { expectedVersion: -1 }, { expectedVersion: '0' }, { status: 'CONTACT_VERIFIED' },
        { ownership: 'SOMEONE_ELSE' }, { owner: { subject: 'other' } }, { contactVerified: true }, { email: 'change@example.invalid' }, { companyId: 2 }, { actorId: 7 }])('rejects malformed/protected lead change %j', async patch => {
        const h = harness(); await expect(updatePlatformInquiry(actor, h.inquiry.id, { ...input(), ...patch }, h.db)).rejects.toMatchObject({ statusCode: 400 }); expect(h.db.$transaction).not.toHaveBeenCalled();
    });
    it.each([{ limit: '0' }, { limit: '51' }, { limit: ['1'] }, { q: 'a'.repeat(101) }, { status: 'NEW' }, { after: 'bad' }, { include: 'staff' }])('rejects unbounded or unsupported lead filters %j', async query => {
        const h = harness(); await expect(listPlatformInquiries(actor, query, h.db)).rejects.toMatchObject({ statusCode: 400 });
    });
    it.each(['bad', '', 1])('rejects invalid inquiry UUID %s', async id => {
        const h = harness(); await expect(getPlatformInquiry(actor, id, h.db)).rejects.toMatchObject({ statusCode: 400 });
        await expect(updatePlatformInquiry(actor, id, input(), h.db)).rejects.toMatchObject({ statusCode: 400 });
    });
});

describe('redacted bounded platform audit', () => {
    it('filters to platform actions and emits no raw JSON/reason/worker actor identifiers', async () => {
        const h = harness(); h.tx.auditLog.findMany.mockResolvedValueOnce([{ id: 6, companyId: 2, action: 'COMPANY_SUSPENDED', createdAt: h.inquiry.createdAt, reason: 'PRIVATE', newValue: { password: 'PRIVATE', photo: 'PRIVATE' }, actorId: 99 }, { id: 5 }]);
        const result = await listPlatformAudit(actor, { after: '9', companyId: '2', action: 'COMPANY_SUSPENDED', limit: '1' }, h.db);
        expect(result).toEqual({ items: [{ id: 6, companyId: 2, action: 'COMPANY_SUSPENDED', actorType: 'PLATFORM_OPERATOR', createdAt: h.inquiry.createdAt }], nextCursor: '6' });
        expect(h.tx.auditLog.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 2, where: expect.objectContaining({ actorType: 'PLATFORM_OPERATOR', id: { lt: 9 }, companyId: 2, action: 'COMPANY_SUSPENDED', OR: expect.any(Array) }) }));
        expect(JSON.stringify(result)).not.toContain('PRIVATE');
    });
    it('handles no audit events', async () => {
        const h = harness(); expect(await listPlatformAudit(actor, {}, h.db)).toEqual({ items: [], nextCursor: null });
    });
    it.each([{ action: 'WORK_ENTITLEMENT_GRANTED' }, { companyId: '-1' }, { after: '2147483648' }, { limit: '51' }, { include: 'newValue' }, { actorType: 'STAFF' }])('rejects unsafe audit filters %j', async query => {
        const h = harness(); await expect(listPlatformAudit(actor, query, h.db)).rejects.toMatchObject({ statusCode: 400 });
        expect(h.tx.auditLog.findMany).not.toHaveBeenCalled();
    });
});

describe('observed service diagnostics without health guesses', () => {
    it('returns only actual timestamp observations, not secrets/configuration values or liveness claims', async () => {
        const h = harness(), timestamp = new Date(); h.tx.paddleWebhookEvent.aggregate.mockResolvedValueOnce({ _max: { occurredAt: timestamp, processedAt: timestamp }, payload: 'PRIVATE' });
        h.tx.verificationWorkerHeartbeat.aggregate.mockResolvedValueOnce({ _max: { lastSeenAt: timestamp }, workerId: 'PRIVATE' });
        const result = await getPlatformDiagnostics(actor, h.db, { DATABASE_URL: 'PRIVATE', PADDLE_API_KEY: 'PRIVATE' });
        expect(result).toEqual({ observedAt: expect.any(Date), identityConfigured: false, supportContactAvailable: false, providerConnectivity: 'NOT_CHECKED', database: 'REACHABLE',
            observations: { lastWebhookOccurredAt: timestamp, lastWebhookProcessedAt: timestamp, lastWorkerHeartbeatAt: timestamp } });
        expect(JSON.stringify(result)).not.toContain('PRIVATE');
    });
    it('returns unavailable safely on database failure, never the raw driver message', async () => {
        const h = harness(); h.tx.$queryRaw.mockRejectedValueOnce(new Error('PRIVATE password or host'));
        expect(await getPlatformDiagnostics(actor, h.db, {})).toMatchObject({ database: 'UNAVAILABLE', observations: null, providerConnectivity: 'NOT_CHECKED' });
    });
    it('distinguishes absent observations from healthy workers or live provider reachability', async () => {
        const result = await getPlatformDiagnostics(actor, harness().db, {});
        expect(result).toMatchObject({ database: 'REACHABLE', observations: { lastWebhookOccurredAt: null, lastWebhookProcessedAt: null, lastWorkerHeartbeatAt: null } });
    });
});

describe('platform support HTTP boundaries', () => {
    async function request(path: string, headers: Record<string, string> = {}, method = 'GET') {
        const express = (await import('express')).default;
        const { default: router, customerSupportRouter } = await import('../routes/platformSupport.route.js');
        const app = express(); app.use(express.json()); app.use('/platform/service', router); app.use('/support', customerSupportRouter);
        app.use((error: any, _req: any, res: any, _next: any) => res.status(error.statusCode ?? 500).json({ message: error.message }));
        const server = app.listen(0, '127.0.0.1'); await new Promise<void>(resolve => server.once('listening', resolve));
        const port = (server.address() as import('node:net').AddressInfo).port;
        try {
            const response = await fetch(`http://127.0.0.1:${port}${path}`, { method, headers });
            return { status: response.status, cache: response.headers.get('Cache-Control'), body: await response.json() };
        } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
    }
    it.each(['/diagnostics', '/audit', '/inquiries', `/inquiries/${randomUUID()}`])('denies cookie-only tenant on %s', async path => {
        expect(await request(`/platform/service${path}`, { Cookie: 'accessToken=tenant-cookie' })).toMatchObject({ status: 401, cache: 'private, no-store' });
    });
    it('requires operator identity for lead changes', async () => {
        expect(await request(`/platform/service/inquiries/${randomUUID()}`, {}, 'PATCH')).toMatchObject({ status: 401, cache: 'private, no-store' });
    });
    it('rejects a genuinely signed tenant ADMIN bearer before DB work', async () => {
        const jwt = (await import('jsonwebtoken')).default;
        vi.stubEnv('PLATFORM_OIDC_ISSUER', 'https://identity.example.test/'); vi.stubEnv('PLATFORM_OIDC_AUDIENCE', 'platform');
        vi.stubEnv('PLATFORM_OIDC_JWKS_URL', 'https://identity.example.test/keys'); vi.stubEnv('PLATFORM_OIDC_MFA_ACR', 'fixture'); vi.stubEnv('PLATFORM_OIDC_SUBJECTS', '["fixture"]');
        const token = jwt.sign({ id: 1, role: 'ADMIN', companyId: 1 }, 'synthetic-tenant-test-key', { algorithm: 'HS256' });
        expect(await request('/platform/service/diagnostics', { Authorization: `Bearer ${token}` })).toMatchObject({ status: 401 });
    });
    it('keeps missing real operator configuration unavailable', async () => {
        vi.stubEnv('PLATFORM_OIDC_ISSUER', '');
        expect(await request('/platform/service/audit', { Authorization: 'Bearer a.b.c' })).toMatchObject({ status: 503 });
    });
    it('serves only explicit support contact availability without a tenant session', async () => {
        vi.stubEnv('SUPPORT_CONTACT_VERIFIED', 'false');
        expect(await request('/support/contact')).toMatchObject({ status: 200, cache: 'private, no-store', body: { data: { available: false, email: null } } });
        vi.stubEnv('SUPPORT_CONTACT_VERIFIED', 'true'); vi.stubEnv('SUPPORT_CONTACT_EMAIL', 'help@example.invalid');
        expect(await request('/support/contact')).toMatchObject({ status: 200, body: { data: { available: true, email: 'help@example.invalid' } } });
    });
});
