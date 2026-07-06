import type { AddressInfo } from 'node:net';
import express from 'express';
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { ApiError } from '../utils/ApiError.js';
import launchRouter, { launchErrorHandler } from './launch.route.js';

const mock = vi.hoisted(() => ({ request: vi.fn(), verifyPhone: vi.fn() }));
vi.mock('../prisma/prisma.js', () => ({ prisma: {} }));
vi.mock('../services/staffLogin/loginCode.service.js', () => ({
    staffLoginCodeService: {
        requestCode: mock.request,
        async verifyCode(phone: unknown, input: unknown) {
            mock.verifyPhone(phone);
            if (input !== fixedCode()) {
                throw new ApiError(400, 'Check the request details', [{ code: 'INVALID_REQUEST' }]);
            }
            return session;
        },
    },
}));

const fixedRandom = () => 7 * 151;
const fixedCode = () => String(fixedRandom()).padStart(6, '0');
const phone = '+923001234567';
const accepted = { phone, expiresInSeconds: 300, resendAfterSeconds: 60 };
const session = {
    id: 7, name: 'Field Staff', email: null, role: 'STAFF', companyId: 42, locationId: null,
    accessToken: 'access-fixture', refreshToken: 'refresh-fixture',
};
let server: ReturnType<express.Express['listen']>;
let origin: string;

beforeAll(async () => {
    const app = express();
    app.use(express.json());
    app.use('/api', launchRouter);
    app.use(launchErrorHandler);
    server = app.listen(0, '127.0.0.1');
    await new Promise<void>(resolve => server.once('listening', resolve));
    origin = 'http://127.0.0.1:' + (server.address() as AddressInfo).port;
});

afterAll(async () => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())));
beforeEach(() => {
    vi.resetAllMocks();
    mock.request.mockResolvedValue(accepted);
});
afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
});

function post(path: 'request-code' | 'verify-code', body: unknown) {
    return fetch(`${origin}/api/common/staff-login/${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
}

it('accepts a public request and returns the documented data with no cookies', async () => {
    const response = await post('request-code', { phone: '0300 1234567' });
    expect(response.status).toBe(202);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    expect(response.headers.get('Set-Cookie')).toBeNull();
    expect(await response.json()).toEqual({ statusCode: 202, success: true, message: 'Success', data: accepted });
    expect(mock.request).toHaveBeenCalledExactlyOnceWith('0300 1234567');
});

it('verifies publicly and sends the exact staff session fields and both session cookies', async () => {
    vi.stubEnv('COOKIE_SECURE', 'true');
    vi.stubEnv('COOKIE_SAME_SITE', 'lax');
    const response = await post('verify-code', { phone, code: fixedCode() });
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    expect(response.headers.getSetCookie()).toEqual([
        'accessToken=access-fixture; Path=/; HttpOnly; Secure; SameSite=Lax',
        'refreshToken=refresh-fixture; Path=/; HttpOnly; Secure; SameSite=Lax',
    ]);
    expect(await response.json()).toEqual({ statusCode: 200, success: true, message: 'Login successful', data: session });
    expect(mock.verifyPhone).toHaveBeenCalledExactlyOnceWith(phone);
});

it('returns the request wait in the launch error body and Retry-After', async () => {
    const detail = { code: 'CODE_RESEND_WAIT', retryAfterSeconds: 23 };
    mock.request.mockRejectedValueOnce(new ApiError(429, 'Wait 23 seconds before asking for a new code.', [detail]));
    const response = await post('request-code', { phone });
    expect(response.status).toBe(429);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    expect(response.headers.get('Retry-After')).toBe('23');
    expect(await response.json()).toMatchObject({
        success: false, code: detail.code, message: 'Wait 23 seconds before asking for a new code.', errors: [detail],
    });
});

it.each(['request-code', 'verify-code'] as const)('rejects extra fields before calling the service for %s', async path => {
    const response = await post(path, { phone, ...(path === 'verify-code' && { code: fixedCode() }), companyId: 42 });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: 'INVALID_REQUEST' });
    expect(mock.request).not.toHaveBeenCalled();
    expect(mock.verifyPhone).not.toHaveBeenCalled();
});

it('keeps the code out of success and error bodies, headers and captured logs', async () => {
    const logs = [vi.spyOn(console, 'log'), vi.spyOn(console, 'warn'), vi.spyOn(console, 'error')];
    logs.forEach(log => log.mockImplementation(() => {}));
    const success = await post('verify-code', { phone, code: fixedCode() });
    const invalid = await post('verify-code', { phone, code: fixedCode(), [fixedCode()]: true });
    expect(success.status).toBe(200);
    expect(invalid.status).toBe(400);
    for (const response of [success, invalid]) {
        const output = [await response.text(), JSON.stringify([...response.headers])].join('\n');
        expect(output.includes(fixedCode())).toBe(false);
    }
    expect(JSON.stringify(logs.map(log => log.mock.calls)).includes(fixedCode())).toBe(false);
});
