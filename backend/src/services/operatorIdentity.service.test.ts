import { generateKeyPairSync } from 'node:crypto';
import jwt from 'jsonwebtoken';
import type { Request, Response, NextFunction } from 'express';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createOperatorAuthMiddleware } from '../middlewares/operatorAuth.middleware.js';
import { createOperatorIdentityVerifier, loadOperatorIdentityConfig, type OperatorIdentityConfig } from './operatorIdentity.service.js';

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const other = generateKeyPairSync('rsa', { modulusLength: 2048 });
const config: OperatorIdentityConfig = { issuer: 'https://identity.example.test/', audience: 'hygene-platform-api',
    jwksUrl: 'https://identity.example.test/keys', mfaAcr: 'approved-mfa-fixture', subjects: ['operator-fixture'] };
const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'key-1', use: 'sig', alg: 'RS256' };
const timestamp = 1_800_000_000;
const claims = { iss: config.issuer, aud: config.audience, sub: 'operator-fixture', acr: config.mfaAcr,
    iat: timestamp, exp: timestamp + 600 };
function token(overrides: Record<string, unknown> = {}, header: Record<string, unknown> = {}) {
    return jwt.sign(JSON.parse(JSON.stringify({ ...claims, ...overrides })), privateKey, { algorithm: 'RS256', noTimestamp: 'iat' in overrides && overrides.iat === undefined, header: { alg: 'RS256', kid: 'key-1', ...header } });
}
function harness(document: unknown = { keys: [jwk] }) {
    let time = timestamp * 1000;
    const fetchKeys = vi.fn(async (_url: string) => document);
    const current = { ...config, subjects: [...config.subjects] };
    const verify = createOperatorIdentityVerifier({ config: () => current, fetchKeys, now: () => time });
    return { verify, fetchKeys, current, advance: (ms: number) => { time += ms; } };
}
const env = { PLATFORM_OIDC_ISSUER: config.issuer, PLATFORM_OIDC_AUDIENCE: config.audience,
    PLATFORM_OIDC_JWKS_URL: config.jwksUrl, PLATFORM_OIDC_MFA_ACR: config.mfaAcr,
    PLATFORM_OIDC_SUBJECTS: JSON.stringify(config.subjects) };
afterEach(() => vi.unstubAllGlobals());

describe('explicit operator configuration', () => {
    it('loads only a provisioned HTTPS issuer/audience/MFA/subject boundary', () => {
        expect(loadOperatorIdentityConfig(env)).toEqual(config);
    });
    it.each(Object.keys(env))('fails closed when %s is absent', field => {
        expect(() => loadOperatorIdentityConfig({ ...env, [field]: '' })).toThrow('unavailable');
    });
    it.each([
        { PLATFORM_OIDC_ISSUER: 'http://identity.example.test/' },
        { PLATFORM_OIDC_ISSUER: 'https://user:password@identity.example.test/' },
        { PLATFORM_OIDC_JWKS_URL: 'https://foreign.example.test/keys' },
        { PLATFORM_OIDC_JWKS_URL: 'https://identity.example.test/keys#fragment' },
        { PLATFORM_OIDC_JWKS_URL: 'https://identity.example.test/keys?secret=token' },
        { PLATFORM_OIDC_SUBJECTS: '[" "]' }, { PLATFORM_OIDC_SUBJECTS: 'not-json' },
        { PLATFORM_OIDC_SUBJECTS: '[]' }, { PLATFORM_OIDC_SUBJECTS: '[42]' },
    ])('rejects unsafe or malformed configuration %j', overrides => {
        expect(() => loadOperatorIdentityConfig({ ...env, ...overrides })).toThrow('unavailable');
    });
    it('never fetches keys when configuration is missing', async () => {
        const fetchKeys = vi.fn();
        const verify = createOperatorIdentityVerifier({ config: () => loadOperatorIdentityConfig({}), fetchKeys });
        await expect(verify(token())).rejects.toMatchObject({ statusCode: 503 });
        expect(fetchKeys).not.toHaveBeenCalled();
    });
});

describe('separate signed operator identity', () => {
    it('returns an immutable metadata-only identity without tenant authority or extra claims', async () => {
        const { verify } = harness();
        const result = await verify(token({ role: 'ADMIN', companyId: 12, email: 'private@example.test' }));
        expect(result).toEqual({ kind: 'PLATFORM_OPERATOR', issuer: config.issuer, subject: 'operator-fixture' });
        expect(Object.isFrozen(result)).toBe(true);
    });
    it.each([
        ['wrong issuer', { iss: 'https://other.example.test/' }], ['wrong audience', { aud: 'tenant-api' }],
        ['unprovisioned subject', { sub: 'someone-else' }], ['missing subject', { sub: undefined }],
        ['missing assurance', { acr: undefined }], ['wrong assurance', { acr: 'password-only' }],
        ['array assurance', { acr: [config.mfaAcr] }], ['expired', { exp: timestamp }],
        ['missing expiry', { exp: undefined }], ['missing issue time', { iat: undefined }],
        ['future issue time', { iat: timestamp + 1 }], ['future validity', { nbf: timestamp + 1 }],
        ['stale token', { iat: timestamp - 901 }], ['inverted lifetime', { exp: timestamp - 1 }],
    ])('rejects %s', async (_name, overrides) => {
        await expect(harness().verify(token(overrides as Record<string, unknown>))).rejects.toMatchObject({ statusCode: 401 });
    });
    it.each([
        ['unknown key', { kid: 'absent' }], ['remote key', { jku: 'https://attacker.example/keys' }],
        ['remote certificate', { x5u: 'https://attacker.example/cert' }], ['inline key', { jwk }],
        ['critical extension', { crit: ['custom'] }], ['missing key id', { kid: undefined }],
    ])('rejects %s header', async (_name, header) => {
        await expect(harness().verify(token({}, header))).rejects.toMatchObject({ statusCode: 401 });
    });
    it('rejects a valid token signed by a different RSA key', async () => {
        const forged = jwt.sign(claims, other.privateKey, { algorithm: 'RS256', keyid: 'key-1' });
        await expect(harness().verify(forged)).rejects.toMatchObject({ statusCode: 401 });
    });
    it.each(['ADMIN', 'MANAGER', 'STAFF'])('rejects genuine tenant %s JWT without key fetch', async role => {
        const { verify, fetchKeys } = harness();
        const tenant = jwt.sign({ id: 1, role, tokenUse: 'access' }, 'tenant-secret', { algorithm: 'HS256' });
        await expect(verify(tenant)).rejects.toMatchObject({ statusCode: 401 });
        expect(fetchKeys).not.toHaveBeenCalled();
    });
    it.each(['bad', '', 'a.b.c', 'x'.repeat(16385)])('rejects malformed or oversized input', async input => {
        await expect(harness().verify(input)).rejects.toMatchObject({ statusCode: 401 });
    });
    it('uses updated provisioning on every request despite cached keys', async () => {
        const { verify, current } = harness();
        await verify(token());
        current.subjects = [];
        await expect(verify(token())).rejects.toMatchObject({ statusCode: 401 });
    });
});

describe('bounded pinned provider keys', () => {
    it('coalesces concurrent fetches, caches 60 seconds and refreshes for rotation', async () => {
        const { verify, fetchKeys, advance } = harness();
        await Promise.all([verify(token()), verify(token())]);
        expect(fetchKeys).toHaveBeenCalledTimes(1);
        expect(fetchKeys).toHaveBeenCalledWith(config.jwksUrl);
        await expect(verify(token({}, { kid: 'unknown' }))).rejects.toMatchObject({ statusCode: 401 });
        expect(fetchKeys).toHaveBeenCalledTimes(1);
        advance(60_000);
        fetchKeys.mockResolvedValueOnce({ keys: [{ ...other.publicKey.export({ format: 'jwk' }), kid: 'key-2' }] });
        const rotated = jwt.sign(claims, other.privateKey, { algorithm: 'RS256', keyid: 'key-2' });
        await expect(verify(rotated)).resolves.toMatchObject({ subject: 'operator-fixture' });
        expect(fetchKeys).toHaveBeenCalledTimes(2);
    });
    it.each([
        null, { keys: [] }, { keys: [jwk, jwk] }, { keys: [{ ...jwk, use: 'enc' }] },
        { keys: [{ ...jwk, alg: 'HS256' }] }, { keys: [{ ...jwk, d: 'private-material' }] },
        { keys: [{ ...jwk, key_ops: ['sign'] }] }, { keys: [{ ...jwk, n: undefined }] },
        { keys: Array.from({ length: 33 }, (_, i) => ({ ...jwk, kid: String(i) })) },
    ])('fails closed for invalid/ambiguous provider keys', async document => {
        await expect(harness(document).verify(token())).rejects.toMatchObject({ statusCode: 503 });
    });
    it('rejects weak RSA verification keys', async () => {
        const weak = generateKeyPairSync('rsa', { modulusLength: 1024 });
        await expect(harness({ keys: [{ ...weak.publicKey.export({ format: 'jwk' }), kid: 'key-1' }] }).verify(token()))
            .rejects.toMatchObject({ statusCode: 503 });
    });
    it('backs off provider failures and never uses stale cached keys after expiry', async () => {
        const { verify, fetchKeys, advance } = harness();
        await verify(token());
        advance(60_000);
        fetchKeys.mockRejectedValue(new Error('private-provider-detail'));
        await expect(verify(token())).rejects.toMatchObject({ statusCode: 503, message: 'Platform sign-in is unavailable' });
        await expect(verify(token())).rejects.toMatchObject({ statusCode: 503 });
        expect(fetchKeys).toHaveBeenCalledTimes(2);
        advance(5000);
        await expect(verify(token())).rejects.toMatchObject({ statusCode: 503 });
        expect(fetchKeys).toHaveBeenCalledTimes(3);
    });
    it('sets timeout/redirect bounds on the actual fetch adapter', async () => {
        const fetcher = vi.fn(async () => new Response(JSON.stringify({ keys: [jwk] })));
        vi.stubGlobal('fetch', fetcher);
        const verify = createOperatorIdentityVerifier({ config: () => config, now: () => timestamp * 1000 });
        await verify(token());
        expect(fetcher).toHaveBeenCalledWith(config.jwksUrl, expect.objectContaining({ redirect: 'error', signal: expect.any(AbortSignal) }));
    });
    it.each([new Response('unavailable', { status: 503 }), new Response('x'.repeat(128 * 1024 + 1)), new Response('bad-json')])
        ('rejects unsuccessful, oversized or malformed network response', async response => {
            vi.stubGlobal('fetch', vi.fn(async () => response));
            await expect(createOperatorIdentityVerifier({ config: () => config })(token())).rejects.toMatchObject({ statusCode: 503 });
        });
});

describe('operator middleware never promotes tenant identity', () => {
    const run = async (authorization?: string, extra: Record<string, unknown> = {}) => {
        const verify = vi.fn(async () => ({ kind: 'PLATFORM_OPERATOR' as const, issuer: config.issuer, subject: 'operator-fixture' }));
        const req = { header: () => authorization, ...extra } as unknown as Request;
        const next = vi.fn();
        await createOperatorAuthMiddleware(verify)(req, {} as Response, next as NextFunction);
        return { req, next, verify };
    };
    it('accepts only explicit operator bearer identity on its own request field', async () => {
        const { req, next } = await run(`Bearer ${token()}`);
        expect(req.operator).toMatchObject({ kind: 'PLATFORM_OPERATOR' });
        expect(req.user).toBeUndefined();
        expect(next).toHaveBeenCalledWith();
    });
    it.each([undefined, 'Basic credential', 'Bearer invalid', 'Bearer a.b.c extra'])('denies missing/malformed headers even with tenant cookies', async header => {
        const { req, next, verify } = await run(header, { cookies: { accessToken: token() } });
        expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 401 }));
        expect(verify).not.toHaveBeenCalled();
        expect(req.operator).toBeUndefined();
    });
    it('denies a mixed tenant/operator context', async () => {
        const { next, verify } = await run(`Bearer ${token()}`, { user: { role: 'ADMIN', id: 1 } });
        expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 401 }));
        expect(verify).not.toHaveBeenCalled();
    });
    it('propagates disabled provider state without assigning operator identity', async () => {
        const verify = vi.fn().mockRejectedValue(new Error('unavailable'));
        const req = { header: () => `Bearer ${token()}` } as unknown as Request;
        const next = vi.fn();
        await createOperatorAuthMiddleware(verify)(req, {} as Response, next);
        expect(next).toHaveBeenCalledWith(expect.objectContaining({ message: 'unavailable' }));
        expect(req.operator).toBeUndefined();
    });
});
