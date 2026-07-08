import { describe, expect, it, vi } from 'vitest';
import { getCompanySettings, updateCompanySettings } from './companySettings.service.js';
import type { VerificationActor } from './verification-v2/authorization.service.js';
const actor: VerificationActor = { role: 'ADMIN', id: 7, companyId: 1 };
function harness() {
    let company: any = { id: 1, name: 'Synthetic company', accountVersion: 0, updatedAt: new Date('2026-10-20'),
        plan: 'STARTER', isActive: true, operationalStatus: 'ACTIVE', billingCustomerId: null, billingSubscriptionId: null, password: 'PRIVATE', staff: ['PRIVATE'] };
    let audits: any[] = [];
    const tx = { $queryRaw: vi.fn(async () => []), manager: { findFirst: vi.fn(async (): Promise<any> => ({ id: 7 })) },
        company: { findUnique: vi.fn(async () => company), findUniqueOrThrow: vi.fn(async () => company),
            updateMany: vi.fn(async ({ data }: any) => { company = { ...company, ...data, accountVersion: company.accountVersion + data.accountVersion.increment }; return { count: 1 }; }) },
        auditLog: { create: vi.fn(async ({ data }: any) => { const row = { ...data, id: 1, createdAt: new Date() }; audits.push(row); return row; }) },
        paddleSubscription: { findFirst: vi.fn(async () => null) },
    };
    const db = { ...tx, $transaction: vi.fn(async (run: any) => { const before = company, prior = [...audits];
        try { return await run(tx); } catch (error) { company = before; audits = prior; throw error; } }) };
    return { tx, db: db as any, get company() { return company; }, get audits() { return audits; }, patch: (data: any) => { company = { ...company, ...data }; } };
}
const input = { name: '  Updated synthetic company  ', expectedVersion: 0 };
describe('owner-only company settings', () => {
    it.each(['MANAGER', 'STAFF', 'PLATFORM_OPERATOR', 'SYSTEM'])('denies %s without touching persistence', async role => {
        const h = harness(), denied = { ...actor, role } as VerificationActor;
        await expect(getCompanySettings(denied, h.db)).rejects.toMatchObject({ statusCode: 403 });
        await expect(updateCompanySettings(denied, input, h.db)).rejects.toMatchObject({ statusCode: 403 });
        expect(h.db.$transaction).not.toHaveBeenCalled();
    });
    it('rechecks owner activity, role and company in persistence', async () => {
        const h = harness(); await getCompanySettings(actor, h.db);
        expect(h.tx.manager.findFirst).toHaveBeenCalledWith({ where: { id: 7, companyId: 1, role: 'ADMIN', isActive: true } });
        expect(h.tx.company.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 1 } }));
        expect(h.tx.company.updateMany).not.toHaveBeenCalled();
    });
    it.each(['cross-tenant', 'inactive-owner', 'forged-role'])('denies an owner absent from exact persisted identity (%s)', async () => {
        const h = harness(); h.tx.manager.findFirst.mockResolvedValueOnce(null);
        await expect(updateCompanySettings({ ...actor, companyId: 2 }, input, h.db)).rejects.toMatchObject({ statusCode: 403 });
        expect(h.tx.company.updateMany).not.toHaveBeenCalled(); expect(h.audits).toHaveLength(0);
    });
    it('returns only company name/id/version/time; no contacts or protected records', async () => {
        const h = harness(); expect(await getCompanySettings(actor, h.db)).toEqual({ id: 1, name: 'Synthetic company', accountVersion: 0, updatedAt: h.company.updatedAt });
    });
    it.each([{ isActive: false }, { operationalStatus: 'SUSPENDED' }])('denies settings for restricted company %j', async patch => {
        const h = harness(); h.patch(patch);
        await expect(getCompanySettings(actor, h.db)).rejects.toMatchObject({ statusCode: 403 });
        await expect(updateCompanySettings(actor, input, h.db)).rejects.toMatchObject({ statusCode: 403 });
        expect(h.tx.company.updateMany).not.toHaveBeenCalled();
    });
    it('renames an active unentitled company without changing billing/security and atomically audits', async () => {
        const h = harness();
        const result = await updateCompanySettings(actor, input, h.db);
        expect(result).toEqual({ company: { id: 1, name: 'Updated synthetic company', accountVersion: 1, updatedAt: h.company.updatedAt }, changed: true });
        expect(h.company).toMatchObject({ plan: 'STARTER', operationalStatus: 'ACTIVE', isActive: true, billingCustomerId: null, billingSubscriptionId: null });
        expect(h.tx.company.updateMany).toHaveBeenCalledWith({ where: { id: 1, accountVersion: 0 }, data: { name: 'Updated synthetic company', accountVersion: { increment: 1 } } });
        expect(h.audits).toEqual([expect.objectContaining({ companyId: 1, actorType: 'ADMIN', actorId: 7, entityType: 'COMPANY_SETTINGS', entityId: 1, action: 'COMPANY_NAME_UPDATED',
            oldValue: { name: 'Synthetic company', accountVersion: 0 }, newValue: { name: 'Updated synthetic company', accountVersion: 1 }, createdAt: expect.any(Date) })]);
        expect(JSON.stringify(result)).not.toContain('PRIVATE');
    });
    it('returns conflict without mutating stale draft or newer current record', async () => {
        const h = harness(), draft = { ...input }; h.patch({ accountVersion: 2, name: 'Newer saved name' });
        await expect(updateCompanySettings(actor, draft, h.db)).rejects.toMatchObject({ statusCode: 409 });
        expect(draft).toEqual(input); expect(h.company).toMatchObject({ accountVersion: 2, name: 'Newer saved name' });
        expect(h.tx.company.updateMany).not.toHaveBeenCalled(); expect(h.audits).toHaveLength(0);
    });
    it('safe retry requires latest version; same name/current version is no-op', async () => {
        const h = harness(); await updateCompanySettings(actor, input, h.db);
        await expect(updateCompanySettings(actor, input, h.db)).rejects.toMatchObject({ statusCode: 409 });
        expect(await updateCompanySettings(actor, { ...input, expectedVersion: 1 }, h.db)).toMatchObject({ changed: false });
        expect(h.audits).toHaveLength(1); expect(h.company.accountVersion).toBe(1);
    });
    it('rolls back actual name/version mutation if audit boundary fails', async () => {
        const h = harness(); h.tx.auditLog.create.mockRejectedValueOnce(new Error('Synthetic audit failure'));
        await expect(updateCompanySettings(actor, input, h.db)).rejects.toThrow('Synthetic audit failure');
        expect(h.company).toMatchObject({ accountVersion: 0, name: 'Synthetic company' }); expect(h.audits).toHaveLength(0);
    });
    it('rejects conditional update conflict without auditing success', async () => {
        const h = harness(); h.tx.company.updateMany.mockResolvedValueOnce({ count: 0 });
        await expect(updateCompanySettings(actor, input, h.db)).rejects.toMatchObject({ statusCode: 409 }); expect(h.audits).toHaveLength(0);
    });
    it.each([{ name: '' }, { name: ' ' }, { name: 'a' }, { name: 'a'.repeat(161) }, { name: {} }, { expectedVersion: -1 }, { expectedVersion: '0' },
        { expectedVersion: 0.5 }, { expectedVersion: 2147483647 }, { companyId: 2 }, { id: 2 }, { plan: 'ADVANCED' }, { role: 'ADMIN' },
        { email: 'unverified@example.invalid' }, { password: 'guess' }, { isActive: true }, { operationalStatus: 'ACTIVE' }, { billingCustomerId: 'ctm_foreign' }])('rejects malformed/protected input %j', async patch => {
        const h = harness(); await expect(updateCompanySettings(actor, { ...input, ...patch }, h.db)).rejects.toMatchObject({ statusCode: 400 });
        expect(h.db.$transaction).not.toHaveBeenCalled();
    });
    it('returns honest not-found for missing company', async () => {
        const h = harness(); h.tx.company.findUnique.mockResolvedValue(null);
        await expect(getCompanySettings(actor, h.db)).rejects.toMatchObject({ statusCode: 404 });
    });
    it('accepts an Urdu company name using the existing registration validator', async () => {
        const h = harness(); expect(await updateCompanySettings(actor, { ...input, name: '  صفائی کمپنی  ' }, h.db)).toMatchObject({ company: { name: 'صفائی کمپنی' } });
    });
});

describe('company settings route authentication', () => {
    it.each(['GET', 'PATCH'])('requires tenant authentication for %s and marks denial private/no-store', async method => {
        const express = (await import('express')).default;
        const router = (await import('../routes/companySettings.route.js')).default;
        const app = express(); app.use(express.json()); app.use('/settings', router);
        app.use((error: any, _req: any, res: any, _next: any) => res.status(error.statusCode ?? 500).json({ message: error.message }));
        const server = app.listen(0, '127.0.0.1'); await new Promise<void>(resolve => server.once('listening', resolve));
        const port = (server.address() as import('node:net').AddressInfo).port;
        try {
            const response = await fetch(`http://127.0.0.1:${port}/settings`, { method, headers: { 'Content-Type': 'application/json' }, body: method === 'PATCH' ? JSON.stringify(input) : undefined });
            expect(response.status).toBe(401); expect(response.headers.get('Cache-Control')).toBe('private, no-store');
        } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
    });
});
