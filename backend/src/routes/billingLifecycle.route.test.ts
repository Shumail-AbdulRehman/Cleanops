import express from 'express';
import jwt from 'jsonwebtoken';
import type { AddressInfo } from 'node:net';
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({
    principal: vi.fn(), lifecycle: vi.fn(), catalog: vi.fn(), portal: vi.fn(),
    checkout: vi.fn(), confirm: vi.fn(), reconcile: vi.fn(),
}));
vi.mock('../prisma/prisma.js', () => ({ prisma: {
    manager: { findUnique: m.principal }, staff: { findUnique: m.principal },
    managerLocation: { findMany: async () => [] },
} }));
vi.mock('../services/billingLifecycle.service.js', () => ({
    getBillingLifecycle: m.lifecycle, getBillingCatalog: m.catalog, createBillingPortal: m.portal,
}));
vi.mock('../services/billingCheckout.service.js', () => ({ createBillingCheckout: m.checkout }));
vi.mock('../services/billingConfirm.service.js', () => ({ confirmBillingCheckout: m.confirm }));
vi.mock('../services/billingReconcile.service.js', () => ({ reconcileBillingReservations: m.reconcile }));
import router from './billingLifecycle.route.js';
import { launchErrorHandler } from './launch.route.js';
import { ApiError } from '../utils/ApiError.js';

const lifecycle = { companyId: 42, onboardingStep: 'PAYMENT', workspaceAccessAllowed: false };
const paths = ['/checkout', '/checkout/confirm', '/checkout/reconcile', '/managed-portal'];
let server: ReturnType<express.Express['listen']>, origin: string;
let role = 'ADMIN';
async function request(path: string, body: unknown = {}, authenticated = true, method = 'POST') {
    const token = jwt.sign({ id: 7, role, credentialVersion: 0, tokenUse: 'access' }, 'billing-route-test-secret', { expiresIn: '5m' });
    return fetch(origin + path, {
        method, headers: { 'Content-Type': 'application/json', ...(authenticated ? { Authorization: 'Bearer ' + token } : {}) },
        ...(method === 'GET' ? {} : { body: JSON.stringify(body) }),
    });
}
function noStore(response: Response) {
    expect(response.headers.get('cache-control')).toBe('private, no-store');
}
function noBillingCalls() {
    for (const mock of [m.lifecycle, m.catalog, m.portal, m.checkout, m.confirm, m.reconcile]) expect(mock).not.toHaveBeenCalled();
}
beforeAll(async () => {
    vi.stubEnv('ACCESS_TOKEN_SECRET', 'billing-route-test-secret');
    const app = express();
    app.use(express.json()); app.use(router); app.use(launchErrorHandler);
    server = app.listen(0, '127.0.0.1');
    await new Promise<void>(resolve => server.once('listening', resolve));
    origin = 'http://127.0.0.1:' + (server.address() as AddressInfo).port;
});
afterAll(async () => {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    vi.unstubAllEnvs();
});
beforeEach(() => {
    vi.resetAllMocks(); role = 'ADMIN';
    m.principal.mockImplementation(async () => ({
        id: 7, companyId: 42, role, isActive: true, credentialVersion: 0, mustChangePassword: false,
        company: { isActive: true, operationalStatus: 'ACTIVE' },
    }));
    m.lifecycle.mockResolvedValue(lifecycle);
    m.confirm.mockResolvedValue({ outcome: 'NOT_PAID', lifecycle });
    m.reconcile.mockResolvedValue('RESUMABLE');
    m.checkout.mockResolvedValue({ transactionId: 'txn_fixture', reused: false, replaced: true });
    m.catalog.mockResolvedValue([]); m.portal.mockResolvedValue({ url: 'https://customer-portal.paddle.com/fixture' });
});
afterEach(() => vi.restoreAllMocks());

it.each(paths)('requires authentication for %s', async path => {
    const response = await request(path, {}, false);
    expect(response.status).toBe(401); noStore(response); noBillingCalls();
});
it.each(['MANAGER', 'STAFF'])('refuses %s on every billing route', async deniedRole => {
    role = deniedRole;
    for (const path of paths) {
        const response = await request(path);
        expect(response.status).toBe(403); noStore(response);
    }
    for (const path of ['/lifecycle', '/catalog']) expect((await request(path, {}, true, 'GET')).status).toBe(403);
    noBillingCalls();
});
it.each(['/checkout/confirm', '/checkout/reconcile'])('rejects inactive and stale owner sessions at %s', async path => {
    for (const [change, status] of [
        [{ isActive: false }, 403], [{ credentialVersion: 1 }, 401], [{ mustChangePassword: true }, 403],
    ] as const) {
        m.principal.mockResolvedValue(Object.assign({ id: 7, companyId: 42, role: 'ADMIN', isActive: true,
            credentialVersion: 0, mustChangePassword: false, company: { isActive: true, operationalStatus: 'ACTIVE' } }, change));
        const response = await request(path);
        expect(response.status).toBe(status); noStore(response);
    }
    noBillingCalls();
});
it.each(['/checkout/confirm', '/checkout/reconcile'])('accepts only an empty object at %s', async path => {
    for (const body of [{ companyId: 99 }, { transactionId: 'txn_foreign' }, { plan: 'PRO' }, { outcome: 'ACTIVE' }, []]) {
        const response = await request(path, body);
        expect(response.status).toBe(400);
        expect(await response.json()).toMatchObject({ success: false, code: 'INVALID_REQUEST' });
        noStore(response);
    }
    const missing = await fetch(origin + path, { method: 'POST', headers: {
        Authorization: 'Bearer ' + jwt.sign({ id: 7, role: 'ADMIN', credentialVersion: 0, tokenUse: 'access' }, 'billing-route-test-secret', { expiresIn: '5m' }),
    } });
    expect(missing.status).toBe(400); noStore(missing); noBillingCalls();
});
it.each(['/checkout/confirm', '/checkout/reconcile'])('rejects primitive JSON before routing %s', async path => {
    for (const body of [null, 'text', 1]) {
        const response = await request(path, body);
        expect(response.status).toBe(400);
        expect(await response.json()).toMatchObject({ success: false, code: 'INVALID_REQUEST' });
    }
    noBillingCalls();
});
it.each(['ACTIVE', 'PROCESSING', 'NOT_PAID', 'NO_CHECKOUT'])('returns confirm %s with the service lifecycle and authenticated actor', async outcome => {
    m.confirm.mockResolvedValue({ outcome, lifecycle });
    const response = await request('/checkout/confirm');
    expect(response.status).toBe(200); noStore(response);
    expect(await response.json()).toMatchObject({ statusCode: 200, success: true, data: { outcome, lifecycle } });
    expect(m.confirm).toHaveBeenCalledExactlyOnceWith({ id: 7, companyId: 42, role: 'ADMIN' });
    expect(m.lifecycle).not.toHaveBeenCalled();
});
it.each(['RESUMABLE', 'CLEARED', 'IN_PROGRESS', 'PAID', 'UNRESOLVED', 'CONFLICT'])('returns reconcile %s with a fresh lifecycle', async outcome => {
    m.reconcile.mockImplementation(async () => {
        m.lifecycle.mockResolvedValue({ ...lifecycle, onboardingStep: 'RECONCILE' });
        return outcome;
    });
    const response = await request('/checkout/reconcile');
    expect(response.status).toBe(200); noStore(response);
    expect(await response.json()).toMatchObject({ success: true, data: { outcome, lifecycle: { ...lifecycle, onboardingStep: 'RECONCILE' } } });
    const actor = { id: 7, companyId: 42, role: 'ADMIN' };
    expect(m.reconcile).toHaveBeenCalledExactlyOnceWith(actor);
    expect(m.lifecycle).toHaveBeenCalledExactlyOnceWith(actor);
    expect(m.reconcile.mock.invocationCallOrder[0]).toBeLessThan(m.lifecycle.mock.invocationCallOrder[0]!);
});
it('points checkout at the shared checkout service and retains the 201 shape', async () => {
    const body = { plan: 'PRO', interval: 'year' };
    const response = await request('/checkout', body);
    expect(response.status).toBe(201); noStore(response);
    expect(await response.json()).toMatchObject({ statusCode: 201, success: true, data: { transactionId: 'txn_fixture', reused: false, replaced: true } });
    expect(m.checkout).toHaveBeenCalledExactlyOnceWith({ id: 7, companyId: 42, role: 'ADMIN' }, body);
});
it('retains lifecycle, catalog and managed portal routes', async () => {
    for (const [path, method, status, mock] of [
        ['/lifecycle', 'GET', 200, m.lifecycle], ['/catalog', 'GET', 200, m.catalog], ['/managed-portal', 'POST', 201, m.portal],
    ] as const) {
        const response = await request(path, {}, true, method);
        expect(response.status).toBe(status); noStore(response); expect(mock).toHaveBeenCalledOnce();
    }
    expect(m.portal).toHaveBeenCalledWith({ id: 7, companyId: 42, role: 'ADMIN' }, {});
});
it.each([
    ['/checkout', 'checkout', 409, 'CHECKOUT_PAID'],
    ['/checkout', 'checkout', 503, 'CHECKOUT_UNRESOLVED'],
    ['/checkout/confirm', 'confirm', 503, 'SERVICE_UNAVAILABLE'],
    ['/checkout/reconcile', 'reconcile', 409, 'RECONCILIATION_REQUIRED'],
] as const)('preserves stable service errors for %s (%s, %s, %s)', async (path, service, status, code) => {
    m[service].mockRejectedValue(new ApiError(status, 'Try again', [{ code }]));
    const response = await request(path);
    expect(response.status).toBe(status); noStore(response);
    expect(await response.json()).toMatchObject({ success: false, code, errors: [{ code }] });
    expect(m.lifecycle).not.toHaveBeenCalled();
});
it('does not return a partial reconciliation response when the fresh lifecycle fails', async () => {
    m.lifecycle.mockRejectedValue(new ApiError(503, 'Unavailable'));
    const response = await request('/checkout/reconcile');
    expect(response.status).toBe(503); noStore(response);
    expect(await response.json()).toMatchObject({ success: false, code: 'SERVICE_UNAVAILABLE' });
});
