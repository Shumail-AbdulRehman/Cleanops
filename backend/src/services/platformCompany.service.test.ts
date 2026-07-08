import { afterEach, describe, expect, it, vi } from 'vitest';
import { getPublicBillingCatalog } from './billingCatalog.service.js';
import { getPlatformCompany, listPlatformCompanies, setPlatformCompanyStatus } from './platformCompany.service.js';
import type { OperatorPrincipal } from './operatorIdentity.service.js';

vi.mock('./billingCatalog.service.js', async importOriginal => ({
    ...await importOriginal<typeof import('./billingCatalog.service.js')>(),
    getPublicBillingCatalog: vi.fn().mockResolvedValue([]),
}));

const actor: OperatorPrincipal = { kind: 'PLATFORM_OPERATOR', issuer: 'https://identity.example.test/', subject: 'synthetic-operator' };
const date = new Date('2026-10-20T00:00:00Z');
const annualPriceId = `pri_${'a'.repeat(26)}`;
function harness() {
    let company: any = { id: 1, name: 'Synthetic company', plan: 'STARTER', isActive: true, operationalStatus: 'ACTIVE', accountVersion: 0,
        createdAt: date, updatedAt: date, subscriptionStatus: 'CANCELLED', billingCustomerId: null, billingSubscriptionId: null,
        _count: { managers: 2, staff: 37, locations: 5 },
        suspendedAt: null, suspensionReason: null, password: 'PRIVATE', staff: ['PRIVATE'], verificationPolicy: { secret: 'PRIVATE' } };
    let audits: any[] = [];
    const tx = {
        $queryRaw: vi.fn(async (..._args: unknown[]): Promise<unknown[]> => []),
        company: {
            findMany: vi.fn(async (_args: { where: object }) => [company]), findUnique: vi.fn(async () => company), findUniqueOrThrow: vi.fn(async () => company),
            updateMany: vi.fn(async ({ data }: any) => {
                company = { ...company, ...data, accountVersion: company.accountVersion + data.accountVersion.increment }; return { count: 1 };
            }),
        },
        paddleSubscription: {
            findFirst: vi.fn(async (): Promise<any> => null),
            findMany: vi.fn(async (): Promise<any[]> => []),
        },
        manager: { findMany: vi.fn(async (): Promise<any[]> => []) },
        auditLog: {
            create: vi.fn(async ({ data }: any) => { const row = { ...data, id: audits.length + 1, createdAt: date }; audits.push(row); return row; }),
            findMany: vi.fn(async () => audits),
        },
    };
    const db = { ...tx, $transaction: vi.fn(async (run: any) => {
        const before = { ...company }, prior = [...audits];
        try { return await run(tx); } catch (error) { company = before; audits = prior; throw error; }
    }) };
    return { tx, db: db as any, get company() { return company; }, get audits() { return audits; }, patch: (data: any) => { company = { ...company, ...data }; } };
}
const change = (expectedVersion = 0, operationalStatus = 'SUSPENDED') => ({ expectedVersion, operationalStatus, reason: '  Synthetic review reason  ' });
afterEach(() => {
    vi.unstubAllEnvs();
    vi.mocked(getPublicBillingCatalog).mockReset().mockResolvedValue([]);
});

function billingFixture(companyId: number, status: string, scheduledChangeAction: string | null = null) {
    const mirror = { id: `sub_${companyId}`, companyId, customerId: `ctm_${companyId}`, status, scheduledChangeAction, priceId: annualPriceId };
    return { link: { billingSubscriptionId: mirror.id, billingCustomerId: mirror.customerId }, mirror };
}

function configureAnnualPrice() {
    vi.stubEnv('PADDLE_ENVIRONMENT', 'sandbox');
    vi.stubEnv('PADDLE_PRICE_CATALOG_JSON', JSON.stringify([{ plan: 'PRO', interval: 'year', priceId: annualPriceId }]));
}

describe('platform company metadata boundary', () => {
    it.each(['ADMIN', 'MANAGER', 'STAFF', 'SYSTEM'])('denies tenant %s before querying or writing', async role => {
        const h = harness(), tenant = { role, id: 1, companyId: 1 } as unknown as OperatorPrincipal;
        await expect(listPlatformCompanies(tenant, {}, h.db)).rejects.toMatchObject({ statusCode: 403 });
        await expect(getPlatformCompany(tenant, 1, h.db)).rejects.toMatchObject({ statusCode: 403 });
        await expect(setPlatformCompanyStatus(tenant, 1, change(), h.db)).rejects.toMatchObject({ statusCode: 403 });
        expect(h.tx.company.findMany).not.toHaveBeenCalled(); expect(h.db.$transaction).not.toHaveBeenCalled();
        expect(h.tx.paddleSubscription.findMany).not.toHaveBeenCalled();
        expect(h.tx.manager.findMany).not.toHaveBeenCalled();
        expect(h.tx.$queryRaw).not.toHaveBeenCalled();
        expect(getPublicBillingCatalog).not.toHaveBeenCalled();
    });
    it.each([null, {}, { kind: 'PLATFORM_OPERATOR' }, { ...actor, subject: '' }])('rejects missing or incomplete principal %j', async invalid => {
        await expect(listPlatformCompanies(invalid as OperatorPrincipal, {}, harness().db)).rejects.toMatchObject({ statusCode: 403 });
    });
    it('returns bounded stable cursor paging and explicit commercial DTO only', async () => {
        const h = harness(); h.tx.company.findMany.mockResolvedValueOnce([h.company, { ...h.company, id: 2 }]);
        const result = await listPlatformCompanies(actor, { q: ' Synthetic ', status: 'ACTIVE', after: '4', limit: '1' }, h.db);
        expect(result.nextCursor).toBe('1'); expect(result.items).toHaveLength(1);
        expect(Object.keys(result.items[0]!).sort()).toEqual([
            'id', 'name', 'plan', 'isActive', 'operationalStatus', 'accountVersion', 'createdAt', 'updatedAt', 'counts',
            'subscription', 'monthly', 'owner', 'limits', 'lastActiveAt', 'activity14',
        ].sort());
        expect(h.tx.company.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 2, orderBy: { id: 'asc' }, where: {
            name: { contains: 'Synthetic', mode: 'insensitive' }, operationalStatus: 'ACTIVE', id: { gt: 4 },
        } }));
        expect(JSON.stringify(result)).not.toContain('PRIVATE');
    });
    it('returns honest empty page and default bound', async () => {
        const h = harness(); h.tx.company.findMany.mockResolvedValueOnce([]);
        expect(await listPlatformCompanies(actor, {}, h.db)).toEqual({ items: [], nextCursor: null });
        expect(h.tx.company.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 26 }));
        expect(h.tx.manager.findMany).not.toHaveBeenCalled();
        expect(h.tx.$queryRaw).not.toHaveBeenCalled();
    });
    it('returns active aggregate counts and excludes owners from manager counts', async () => {
        const h = harness();
        h.tx.company.findMany.mockResolvedValueOnce([h.company, { ...h.company, id: 2, _count: { managers: 0, staff: 0, locations: 0 } }]);
        const result = await listPlatformCompanies(actor, {}, h.db);
        expect(result.items.map(row => row.counts)).toEqual([{ managers: 2, staff: 37, locations: 5 }, { managers: 0, staff: 0, locations: 0 }]);
        const counts = { select: {
            managers: { where: { isActive: true, role: 'MANAGER' } },
            staff: { where: { isActive: true } }, locations: { where: { isActive: true } },
        } };
        expect(h.tx.company.findMany).toHaveBeenCalledOnce();
        expect(h.tx.company.findMany).toHaveBeenCalledWith(expect.objectContaining({ select: expect.objectContaining({ _count: counts }) }));
        const detail = await getPlatformCompany(actor, 1, h.db);
        expect(detail.company.counts).toEqual(result.items[0]!.counts);
        expect(h.tx.company.findUnique).toHaveBeenCalledWith(expect.objectContaining({ select: expect.objectContaining({ _count: counts }) }));
        expect(JSON.stringify(detail)).not.toContain('PRIVATE');
    });
    it('batches page enrichment, values annual prices and returns only permitted owner metadata', async () => {
        const h = harness();
        const active = billingFixture(1, 'active');
        const pastDue = billingFixture(2, 'past_due');
        const lookahead = billingFixture(3, 'active');
        h.tx.company.findMany.mockResolvedValueOnce([
            { ...h.company, ...active.link }, { ...h.company, id: 2, ...pastDue.link }, { ...h.company, id: 3, ...lookahead.link },
        ]);
        h.tx.paddleSubscription.findMany.mockResolvedValueOnce([active.mirror, pastDue.mirror]);
        h.tx.manager.findMany.mockResolvedValueOnce([{ companyId: 1, name: 'Synthetic owner', email: 'owner@example.test', password: 'PRIVATE' }]);
        h.tx.$queryRaw.mockResolvedValueOnce([{ companyId: 1, day: '2026-10-20', count: 3n }])
            .mockResolvedValueOnce([{ companyId: 1, latest: date }])
            .mockResolvedValueOnce([{ companyId: 1, latest: new Date('2026-10-20T01:00:00Z') }]);
        configureAnnualPrice();
        vi.mocked(getPublicBillingCatalog).mockResolvedValueOnce([{ plan: 'PRO', interval: 'year', amount: '12000', currencyCode: 'USD' }]);
        vi.useFakeTimers({ toFake: ['Date'] });
        try {
            vi.setSystemTime(date);
            const { items, nextCursor } = await listPlatformCompanies(actor, { limit: '2' }, h.db);
            expect(nextCursor).toBe('2');
            expect(items[0]).toMatchObject({
                subscription: 'ACTIVE', monthly: { amount: 10, currency: 'USD' }, limits: { staff: 3, managers: 1, locations: 1 },
                lastActiveAt: '2026-10-20T01:00:00.000Z',
            });
            expect(items[0]!.owner).toEqual({ name: 'Synthetic owner', email: 'owner@example.test' });
            expect(items[0]!.activity14).toHaveLength(14);
            expect(items[0]!.activity14.at(-1)).toEqual({ day: '2026-10-20', count: 3 });
            expect(items[1]).toMatchObject({ subscription: 'PAST_DUE', owner: null, lastActiveAt: null });
            expect(items[1]!.activity14.map(({ count }) => count)).toEqual(Array(14).fill(0));
            expect(JSON.stringify(items)).not.toContain('PRIVATE');
        } finally {
            vi.useRealTimers();
        }
        expect(h.tx.paddleSubscription.findMany).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
            where: { id: { in: [active.mirror.id, pastDue.mirror.id] } },
        }));
        expect(h.tx.manager.findMany).toHaveBeenCalledExactlyOnceWith({
            where: { companyId: { in: [1, 2] }, role: 'ADMIN', isActive: true },
            orderBy: { id: 'asc' }, distinct: ['companyId'], select: { companyId: true, name: true, email: true },
        });
        expect(h.tx.$queryRaw).toHaveBeenCalledTimes(3);
        expect(getPublicBillingCatalog).toHaveBeenCalledOnce();
    });
    it('applies plan and subscription filters before paging across candidate batches', async () => {
        const h = harness();
        const first = billingFixture(1, 'past_due');
        const second = billingFixture(102, 'past_due');
        const active = billingFixture(101, 'active');
        const rows = Array.from({ length: 102 }, (_, index) => ({ ...h.company, id: index + 1, plan: 'PRO' }));
        Object.assign(rows[0], first.link);
        Object.assign(rows[100], active.link);
        Object.assign(rows[101], second.link);
        h.tx.company.findMany.mockResolvedValueOnce(rows.slice(0, 100)).mockResolvedValueOnce(rows.slice(100))
            .mockResolvedValueOnce(rows.slice(1, 101)).mockResolvedValueOnce(rows.slice(101));
        h.tx.paddleSubscription.findMany.mockResolvedValueOnce([first.mirror]).mockResolvedValueOnce([active.mirror, second.mirror])
            .mockResolvedValueOnce([active.mirror]).mockResolvedValueOnce([second.mirror]);
        const filters = { plan: 'PRO', subscription: 'PAST_DUE', limit: '1' };
        const firstPage = await listPlatformCompanies(actor, filters, h.db);
        expect(firstPage.items.map(({ id, plan, subscription }) => ({ id, plan, subscription })))
            .toEqual([{ id: 1, plan: 'PRO', subscription: 'PAST_DUE' }]);
        expect(firstPage.nextCursor).toBe('1');
        const secondPage = await listPlatformCompanies(actor, { ...filters, after: firstPage.nextCursor }, h.db);
        expect(secondPage.items.map(({ id }) => id)).toEqual([102]);
        expect(secondPage.nextCursor).toBeNull();
        expect(h.tx.company.findMany.mock.calls.map(([args]) => args.where)).toEqual([
            { plan: 'PRO' }, { plan: 'PRO', id: { gt: 100 } }, { plan: 'PRO', id: { gt: 1 } }, { plan: 'PRO', id: { gt: 101 } },
        ]);
    });
    it('combines a plan-only filter with existing name and operational status filters', async () => {
        const h = harness();
        const companies = [h.company, { ...h.company, id: 2, plan: 'PRO' }];
        h.tx.company.findMany.mockImplementationOnce(async ({ where }) => companies.filter(company => company.plan === (where as { plan: string }).plan));
        const { items } = await listPlatformCompanies(actor, { q: 'Synthetic', status: 'ACTIVE', plan: 'PRO' }, h.db);
        expect(items.map(({ id, plan }) => ({ id, plan }))).toEqual([{ id: 2, plan: 'PRO' }]);
        expect(h.tx.company.findMany).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
            take: 26, where: { name: { contains: 'Synthetic', mode: 'insensitive' }, operationalStatus: 'ACTIVE', plan: 'PRO' },
        }));
    });
    it('keeps unavailable catalog prices and missing or mismatched mirrors null', async () => {
        const h = harness();
        const valid = billingFixture(1, 'active', 'cancel');
        const mismatched = billingFixture(2, 'past_due');
        const missing = billingFixture(3, 'past_due');
        h.tx.company.findMany.mockResolvedValueOnce([
            { ...h.company, ...valid.link }, { ...h.company, id: 2, ...mismatched.link }, { ...h.company, id: 3, ...missing.link },
        ]);
        h.tx.paddleSubscription.findMany.mockResolvedValueOnce([valid.mirror, { ...mismatched.mirror, customerId: 'ctm_other' }]);
        configureAnnualPrice();
        vi.mocked(getPublicBillingCatalog).mockRejectedValueOnce(new Error('Catalog unavailable'));
        const { items } = await listPlatformCompanies(actor, {}, h.db);
        expect(items.map(({ subscription, monthly }) => ({ subscription, monthly }))).toEqual([
            { subscription: 'SCHEDULED_CANCEL', monthly: null }, { subscription: 'NONE', monthly: null }, { subscription: 'NONE', monthly: null },
        ]);
    });
    it('leaves a mirror with an unknown price unvalued even when its company plan has a configured price', async () => {
        const h = harness();
        const active = billingFixture(1, 'active');
        h.patch({ ...active.link, plan: 'PRO' });
        h.tx.paddleSubscription.findMany.mockResolvedValueOnce([{ ...active.mirror, priceId: 'pri_unknown' }]);
        configureAnnualPrice();
        const { items } = await listPlatformCompanies(actor, {}, h.db);
        expect(items[0]).toMatchObject({ subscription: 'ACTIVE', monthly: null });
        expect(getPublicBillingCatalog).not.toHaveBeenCalled();
    });
    it.each([{ limit: '0' }, { limit: '51' }, { limit: 10 }, { limit: ['1'] }, { after: '-1' }, { after: '2147483648' },
        { after: '1.2' }, { q: 'a'.repeat(101) }, { q: {} }, { status: 'DELETED' }, { plan: 'UNKNOWN' },
        { subscription: 'UNKNOWN' }, { include: 'staff' }])('rejects unbounded or unsupported filters %j', async input => {
        const h = harness(); await expect(listPlatformCompanies(actor, input, h.db)).rejects.toMatchObject({ statusCode: 400 });
        expect(h.tx.company.findMany).not.toHaveBeenCalled();
    });
    it('shows absent provider/configuration truth and account policy without workforce', async () => {
        vi.stubEnv('PADDLE_BILLING_ENABLED', 'false');
        const h = harness(), result = await getPlatformCompany(actor, '1', h.db);
        expect(result).toMatchObject({ billingConfigured: false, providerState: 'NOT_LINKED', subscription: null, operationalReadAllowed: true, activity: [] });
        expect(h.tx.paddleSubscription.findFirst).not.toHaveBeenCalled();
        expect(JSON.stringify(result)).not.toContain('PRIVATE');
        h.patch({ operationalStatus: 'SUSPENDED' });
        expect(await getPlatformCompany(actor, 1, h.db)).toMatchObject({ operationalReadAllowed: false });
    });
    it('constrains provider mirror to canonical company/customer/subscription and strips extra fields', async () => {
        const h = harness(); h.patch({ billingCustomerId: 'ctm_fixture', billingSubscriptionId: 'sub_fixture' });
        h.tx.paddleSubscription.findFirst.mockResolvedValue({ status: 'active', priceId: 'unknown', currentBillingPeriodStart: date,
            currentBillingPeriodEnd: date, scheduledChangeAt: null, scheduledChangeAction: null, lastEventAt: date, updatedAt: date, secret: 'PRIVATE' });
        h.tx.auditLog.findMany.mockResolvedValueOnce([{ id: 7, action: 'COMPANY_SUSPENDED', reason: 'Synthetic reason', createdAt: date, newValue: { password: 'PRIVATE' } }]);
        const result = await getPlatformCompany(actor, 1, h.db);
        expect(h.tx.paddleSubscription.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'sub_fixture', companyId: 1, customerId: 'ctm_fixture' } }));
        expect(result).toMatchObject({ providerState: 'MIRRORED', subscription: { status: 'active', plan: null, catalogQualified: false } });
        expect(JSON.stringify(result)).not.toContain('PRIVATE');
        expect(h.tx.auditLog.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 20, where: expect.objectContaining({ companyId: 1, actorType: 'PLATFORM_OPERATOR', entityType: 'COMPANY_ACCOUNT' }) }));
    });
    it('does not misrepresent missing mirror as synchronized', async () => {
        const h = harness(); h.patch({ billingCustomerId: 'ctm_fixture', billingSubscriptionId: 'sub_missing' });
        expect(await getPlatformCompany(actor, 1, h.db)).toMatchObject({ providerState: 'AWAITING_PROVIDER', subscription: null });
    });
    it.each([0, -1, 1.1, '01', '1 OR TRUE', '2147483648', undefined])('rejects invalid identifier %s', async id => {
        const h = harness();
        await expect(getPlatformCompany(actor, id, h.db)).rejects.toMatchObject({ statusCode: 400 });
        await expect(setPlatformCompanyStatus(actor, id, change(), h.db)).rejects.toMatchObject({ statusCode: 400 });
        expect(h.db.$transaction).not.toHaveBeenCalled();
    });
    it('returns missing accounts and propagates storage failures without fabricated success', async () => {
        const h = harness(); h.tx.company.findUnique.mockResolvedValue(null);
        await expect(getPlatformCompany(actor, 1, h.db)).rejects.toMatchObject({ statusCode: 404 });
        await expect(setPlatformCompanyStatus(actor, 1, change(), h.db)).rejects.toMatchObject({ statusCode: 404 });
        h.tx.company.findMany.mockRejectedValue(new Error('DB unavailable'));
        await expect(listPlatformCompanies(actor, {}, h.db)).rejects.toThrow('DB unavailable');
    });
});

describe('reasoned versioned platform status transitions', () => {
    it('atomically suspends, preserves billing/legacy activation, and records distinct issuer/subject/reason/time', async () => {
        const h = harness(), before = h.company;
        const result = await setPlatformCompanyStatus(actor, '1', change(), h.db);
        expect(result).toMatchObject({ changed: true, company: { operationalStatus: 'SUSPENDED', accountVersion: 1, isActive: true } });
        expect(h.company).toMatchObject({ subscriptionStatus: before.subscriptionStatus, plan: before.plan, suspensionReason: 'Synthetic review reason', suspendedAt: expect.any(Date) });
        expect(h.audits).toEqual([expect.objectContaining({ companyId: 1, actorType: 'PLATFORM_OPERATOR', actorId: null,
            action: 'COMPANY_SUSPENDED', reason: 'Synthetic review reason', createdAt: date,
            oldValue: { operationalStatus: 'ACTIVE', accountVersion: 0 }, newValue: { operationalStatus: 'SUSPENDED', accountVersion: 1,
                operator: { issuer: actor.issuer, subject: actor.subject } } })]);
        expect(JSON.stringify(result)).not.toContain('PRIVATE');
        expect(h.tx.company.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 1, accountVersion: 0 } }));
    });
    it('rejects stale repeated writes and stale reactivation; current-version same state is a no-op', async () => {
        const h = harness(); await setPlatformCompanyStatus(actor, 1, change(), h.db);
        await expect(setPlatformCompanyStatus(actor, 1, change(), h.db)).rejects.toMatchObject({ statusCode: 409 });
        await expect(setPlatformCompanyStatus(actor, 1, change(0, 'ACTIVE'), h.db)).rejects.toMatchObject({ statusCode: 409 });
        expect(await setPlatformCompanyStatus(actor, 1, change(1), h.db)).toMatchObject({ changed: false });
        expect(h.audits).toHaveLength(1); expect(h.company.accountVersion).toBe(1);
    });
    it('reactivates operations while preserving subscription state and prior audit', async () => {
        const h = harness(); await setPlatformCompanyStatus(actor, 1, change(), h.db);
        expect(await setPlatformCompanyStatus(actor, 1, change(1, 'ACTIVE'), h.db)).toMatchObject({ changed: true, company: { accountVersion: 2, operationalStatus: 'ACTIVE' } });
        expect(h.company).toMatchObject({ suspendedAt: null, suspensionReason: null, subscriptionStatus: 'CANCELLED' });
        expect(h.audits.map(row => row.action)).toEqual(['COMPANY_SUSPENDED', 'COMPANY_REACTIVATED']);
    });
    it('refuses legacy inactive account reactivation without altering its activation', async () => {
        const h = harness(); h.patch({ isActive: false, operationalStatus: 'SUSPENDED' });
        await expect(setPlatformCompanyStatus(actor, 1, change(0, 'ACTIVE'), h.db)).rejects.toMatchObject({ statusCode: 409 });
        expect(h.company.isActive).toBe(false); expect(h.audits).toHaveLength(0);
    });
    it('rolls back status and version when audit fails', async () => {
        const h = harness(); h.tx.auditLog.create.mockRejectedValueOnce(new Error('Audit unavailable'));
        await expect(setPlatformCompanyStatus(actor, 1, change(), h.db)).rejects.toThrow('Audit unavailable');
        expect(h.company).toMatchObject({ accountVersion: 0, operationalStatus: 'ACTIVE' }); expect(h.audits).toHaveLength(0);
    });
    it('does not audit a failed conditional update', async () => {
        const h = harness(); h.tx.company.updateMany.mockResolvedValueOnce({ count: 0 });
        await expect(setPlatformCompanyStatus(actor, 1, change(), h.db)).rejects.toMatchObject({ statusCode: 409 });
        expect(h.tx.auditLog.create).not.toHaveBeenCalled();
    });
    it.each([{ reason: '' }, { reason: '  ' }, { reason: 'a'.repeat(501) }, { reason: 'bad\u0000reason' }, { expectedVersion: -1 },
        { expectedVersion: 0.1 }, { expectedVersion: 2147483647 }, { expectedVersion: '0' }, { operationalStatus: 'DELETED' }, { plan: 'ADVANCED' }, { companyId: 2 }])('rejects malformed/financial/forged input %j', async patch => {
        const h = harness(); await expect(setPlatformCompanyStatus(actor, 1, { ...change(), ...patch }, h.db)).rejects.toMatchObject({ statusCode: 400 });
        expect(h.db.$transaction).not.toHaveBeenCalled();
    });
});

describe('platform company route authentication adapter', () => {
    async function request(headers: Record<string, string>, method = 'GET', path = '/', body?: object) {
        const express = (await import('express')).default;
        const router = (await import('../routes/platformCompany.route.js')).default;
        const app = express(); app.use(express.json()); app.use('/companies', router);
        app.use((error: any, _req: any, res: any, _next: any) => res.status(error.statusCode ?? 500).json({ message: error.message }));
        const server = app.listen(0, '127.0.0.1');
        await new Promise<void>(resolve => server.once('listening', resolve));
        const port = (server.address() as import('node:net').AddressInfo).port;
        try {
            const response = await fetch(`http://127.0.0.1:${port}/companies${path}`, { method, headers: { ...headers, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
            return { status: response.status, cache: response.headers.get('Cache-Control'), body: await response.json() };
        } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
    }
    it.each([['GET', '/'], ['GET', '/1'], ['PATCH', '/1/status']])('denies cookie-only tenant identity for %s %s with no-store', async (method, path) => {
        expect(await request({ Cookie: 'accessToken=tenant-session' }, method, path, method === 'PATCH' ? change() : undefined))
            .toMatchObject({ status: 401, cache: 'private, no-store' });
    });
    it('rejects a signed tenant administrator bearer at the actual operator middleware', async () => {
        const jwt = (await import('jsonwebtoken')).default;
        // Config enables only local verification of the wrong-algorithm denial; no JWKS fetch.
        vi.stubEnv('PLATFORM_OIDC_ISSUER', 'https://identity.example.test/'); vi.stubEnv('PLATFORM_OIDC_AUDIENCE', 'platform');
        vi.stubEnv('PLATFORM_OIDC_JWKS_URL', 'https://identity.example.test/keys'); vi.stubEnv('PLATFORM_OIDC_MFA_ACR', 'fixture');
        vi.stubEnv('PLATFORM_OIDC_SUBJECTS', '["fixture"]');
        const token = jwt.sign({ id: 1, companyId: 1, role: 'ADMIN' }, 'synthetic-tenant-test-key', { algorithm: 'HS256' });
        expect(await request({ Authorization: `Bearer ${token}` })).toMatchObject({ status: 401, cache: 'private, no-store' });
    });
    it('fails unavailable when operator configuration is absent', async () => {
        vi.stubEnv('PLATFORM_OIDC_ISSUER', '');
        expect(await request({ Authorization: 'Bearer a.b.c' })).toMatchObject({ status: 503, body: { message: 'Platform sign-in is unavailable' } });
    });
});
