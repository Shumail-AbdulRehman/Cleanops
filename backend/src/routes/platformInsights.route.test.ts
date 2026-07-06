import express from 'express';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { verifyOperatorIdentity, type OperatorPrincipal } from '../services/operatorIdentity.service.js';
import { PLATFORM_INSIGHT_FIELDS } from '../services/platformInsights/contract.js';
import { ApiError } from '../utils/ApiError.js';
import launchRouter, { launchErrorHandler } from './launch.route.js';

const db = vi.hoisted(() => ({
    company: { findMany: vi.fn(async () => []) },
    paddleSubscription: { findMany: vi.fn(async () => []) },
    paddleTransaction: { findMany: vi.fn(async () => []) },
    $queryRaw: vi.fn(async () => []),
    $transaction: vi.fn(async () => { throw new Error('No transaction fixture'); }),
}));

vi.mock('../prisma/prisma.js', () => ({ prisma: db }));
vi.mock('../services/billingCatalog.service.js', async importOriginal => ({
    ...await importOriginal<typeof import('../services/billingCatalog.service.js')>(),
    getBillingCatalog: { getPublicCatalog: vi.fn(async () => []) },
}));
vi.mock('../services/operatorIdentity.service.js', async importOriginal => ({
    ...await importOriginal<typeof import('../services/operatorIdentity.service.js')>(),
    verifyOperatorIdentity: vi.fn(),
}));

const actor: OperatorPrincipal = { kind: 'PLATFORM_OPERATOR', issuer: 'https://identity.example.invalid/', subject: 'fixture' };
const operatorToken = 'verified.operator.fixture';
const paths = [
    { path: '/api/platform/overview', query: '', message: 'Platform overview fetched' },
    { path: '/api/platform/subscriptions', query: '?status=ACTIVE&after=2', message: 'Platform subscriptions fetched' },
    { path: '/api/platform/payments', query: '?range=month&after=2026-11-01T00%3A00%3A00.000Z%7Ctxn_fixture', message: 'Platform payments fetched' },
] as const;

let server: ReturnType<express.Express['listen']>;
let origin: string;

beforeAll(async () => {
    const app = express();
    app.use('/api', launchRouter);
    app.use(launchErrorHandler);
    server = app.listen(0, '127.0.0.1');
    await new Promise<void>(resolve => server.once('listening', resolve));
    origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())));

beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(verifyOperatorIdentity).mockImplementation(async token => {
        if (token !== operatorToken) throw new ApiError(401, 'Invalid platform identity');
        return actor;
    });
});

function get(path: string, token?: string) {
    return fetch(`${origin}${path}`, token ? { headers: { Authorization: `Bearer ${token}` } } : undefined);
}

function expectNoReads() {
    expect(db.company.findMany).not.toHaveBeenCalled();
    expect(db.paddleSubscription.findMany).not.toHaveBeenCalled();
    expect(db.paddleTransaction.findMany).not.toHaveBeenCalled();
    expect(db.$queryRaw).not.toHaveBeenCalled();
    expect(db.$transaction).not.toHaveBeenCalled();
}

describe.each(paths)('$path', ({ path, query, message }) => {
    it.each([undefined, 'signed.tenant.fixture'])('denies requests without operator identity (%s) before reading', async token => {
        const response = await get(path, token);
        expect(response.status).toBe(401);
        expect(response.headers.get('Cache-Control')).toBe('private, no-store');
        expect(await response.json()).toMatchObject({ success: false, code: 'AUTH_REQUIRED' });
        expectNoReads();
    });

    it('returns just the contract fields in an uncacheable success envelope', async () => {
        const response = await get(`${path}${query}`, operatorToken);
        expect(response.status).toBe(200);
        expect(response.headers.get('Cache-Control')).toBe('private, no-store');
        const body = await response.json();
        expect(body).toEqual({ success: true, statusCode: 200, message, data: expect.any(Object) });
        expect(Object.keys(body.data).sort()).toEqual([...PLATFORM_INSIGHT_FIELDS[path]].sort());
        expect(verifyOperatorIdentity).toHaveBeenCalledWith(operatorToken);
    });
});

it.each([
    '/api/platform/subscriptions?status=obsolete',
    '/api/platform/subscriptions?after=0',
    '/api/platform/subscriptions?status=ACTIVE&status=PAST_DUE',
    '/api/platform/payments?range=week',
    '/api/platform/payments?after=invalid',
    '/api/platform/payments?unknown=value',
])('rejects bad query values for %s before reading', async path => {
    const response = await get(path, operatorToken);
    expect(response.status).toBe(400);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    expect(await response.json()).toMatchObject({ success: false, code: 'INVALID_REQUEST' });
    expectNoReads();
});
