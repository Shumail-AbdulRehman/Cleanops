import { IncomingMessage, ServerResponse } from 'node:http';
import { Socket } from 'node:net';
import bcrypt from 'bcrypt';
import cookieParser from 'cookie-parser';
import express, { type ErrorRequestHandler, type Request } from 'express';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { verifyOperator } from '../middlewares/operatorAuth.middleware.js';
import { verifyOperatorIdentity } from '../services/operatorIdentity.service.js';
import { ApiError } from '../utils/ApiError.js';
import localOperatorSessionRouter from './localOperatorSession.route.js';

vi.mock('../services/operatorIdentity.service.js', () => ({ verifyOperatorIdentity: vi.fn() }));

const origin = 'https://console.example.test';
const loginBody = { email: 'operator@example.test', password: 'Synthetic-route-fixture!42' };
const sessionPath = '/api/platform/session';
const protectedPath = '/api/platform/protected-fixture';
let passwordHash: string;

const app = express();
app.use(cookieParser());
app.use(sessionPath, localOperatorSessionRouter);
app.all(protectedPath, verifyOperator, (req, res) => { res.json({ data: req.operator }); });
const handleError: ErrorRequestHandler = (error: ApiError, _req, res, _next) => {
  res.status(error.statusCode).json({ message: error.message });
};
app.use(handleError);

function request(method: string, path = sessionPath, headers: IncomingMessage['headers'] = {}, body?: unknown) {
  // Exercise Express's session route directly because app-level CORS can reject first.
  const req = new IncomingMessage(new Socket()) as Request;
  req.method = method;
  req.url = path;
  req.headers = headers;
  req.body = body;
  const res = new ServerResponse(req);
  return new Promise<{ status: number; cookies: string[]; cacheControl: unknown; body: unknown }>(resolve => {
    vi.spyOn(res, 'end').mockImplementation((response?: unknown) => {
      const cookies = res.getHeader('Set-Cookie');
      resolve({
        status: res.statusCode,
        cookies: cookies === undefined ? [] : [cookies].flat().map(String),
        cacheControl: res.getHeader('Cache-Control'),
        body: JSON.parse(String(response)),
      });
      return res;
    });
    app(req, res);
  });
}

const signIn = (headers = { origin }) => request('POST', sessionPath + '/login', headers, loginBody);

beforeAll(async () => { passwordHash = await bcrypt.hash(loginBody.password, 10); });
beforeEach(() => {
  vi.stubEnv('NODE_ENV', 'production');
  vi.stubEnv('FRONTEND_URL', ` ${origin}, http://console.example.test `);
  vi.stubEnv('PLATFORM_LOGIN_ENABLED', 'true');
  vi.stubEnv('PLATFORM_LOGIN_EMAIL', loginBody.email);
  vi.stubEnv('PLATFORM_LOGIN_PASSWORD_HASH', passwordHash);
  vi.mocked(verifyOperatorIdentity).mockReset().mockRejectedValue(new ApiError(403, 'Platform operator required'));
});
afterEach(() => { vi.unstubAllEnvs(); });

describe('live platform session route', () => {
  it('sets a secure eight-hour cookie, uses it for the protected principal, and revokes it on logout', async () => {
    const earliestExpiry = Date.now() + 8 * 60 * 60_000 - 999; // HTTP cookie dates omit milliseconds.
    const signedIn = await signIn();
    const latestExpiry = Date.now() + 8 * 60 * 60_000;
    expect(signedIn.status).toBe(200);
    expect(signedIn.cacheControl).toBe('private, no-store');
    expect(signedIn.cookies).toHaveLength(1);
    const [cookie, ...attributes] = signedIn.cookies[0].split('; ');
    expect(cookie).toMatch(/^hygene_platform=[A-Za-z0-9_-]{43}$/);
    expect(attributes).toEqual(expect.arrayContaining(['Path=/api/platform', 'HttpOnly', 'Secure', 'SameSite=Strict']));
    const expiry = Date.parse(attributes.find(value => value.startsWith('Expires='))!.slice('Expires='.length));
    expect(expiry).toBeGreaterThanOrEqual(earliestExpiry);
    expect(expiry).toBeLessThanOrEqual(latestExpiry);
    expect(signedIn.body).toEqual({ data: { authenticated: true, email: loginBody.email, expiresAt: expect.any(String) } });
    expect((await request('GET', sessionPath, { cookie })).body)
      .toEqual({ data: { enabled: true, authenticated: true, email: loginBody.email } });
    expect((await request('PATCH', protectedPath, { cookie })).status).toBe(403);
    expect(await request('PATCH', protectedPath, { cookie, origin })).toMatchObject({
      status: 200, body: { data: { kind: 'PLATFORM_OPERATOR', issuer: 'urn:hygene:platform-password', subject: loginBody.email } },
    });

    const signedOut = await request('POST', sessionPath + '/logout', { cookie, origin });
    expect(signedOut).toMatchObject({ status: 200, body: { data: { authenticated: false } } });
    expect(signedOut.cookies).toEqual([
      'hygene_platform=; Path=/api/platform; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; Secure; SameSite=Strict',
    ]);
    expect((await request('GET', protectedPath, { cookie })).status).toBe(401);
  });

  it.each([undefined, 'http://console.example.test', 'https://foreign.example.test', origin + '/'])(
    'returns 403 for session POSTs with Origin %s', async (value) => {
      const headers = value === undefined ? {} : { origin: value };
      expect((await request('POST', sessionPath + '/login', headers, loginBody)).status).toBe(403);
      expect((await request('POST', sessionPath + '/logout', headers)).status).toBe(403);
    },
  );

  it('does not promote tenant cookies or bearer tokens to live sessions', async () => {
    const tenantCookie = 'accessToken=synthetic-tenant-cookie';
    const authorization = 'Bearer tenant.jwt.fixture';
    expect((await request('GET', protectedPath, { cookie: tenantCookie })).status).toBe(401);
    expect((await request('GET', protectedPath, { authorization })).status).toBe(403);
    expect(verifyOperatorIdentity).toHaveBeenCalledExactlyOnceWith('tenant.jwt.fixture');
    expect((await request('GET', sessionPath, { cookie: tenantCookie, authorization })).body)
      .toEqual({ data: { enabled: true, authenticated: false } });

    const cookie = (await signIn()).cookies[0].split('; ')[0];
    expect((await request('GET', protectedPath, { cookie, authorization })).status).toBe(401);
    expect(verifyOperatorIdentity).toHaveBeenCalledTimes(1);
  });
});
