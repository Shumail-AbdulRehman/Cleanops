import { createPublicKey, type KeyObject, type webcrypto } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { ApiError } from '../utils/ApiError.js';

export type OperatorPrincipal = Readonly<{
    kind: 'PLATFORM_OPERATOR';
    issuer: string;
    subject: string;
}>;
export type OperatorIdentityConfig = {
    issuer: string;
    audience: string;
    jwksUrl: string;
    mfaAcr: string;
    subjects: readonly string[];
};
const unavailable = () => new ApiError(503, 'Platform sign-in is unavailable');
const unauthorized = () => new ApiError(401, 'Invalid platform identity');
const record = (value: unknown): value is Record<string, unknown> =>
    value !== null && typeof value === 'object' && !Array.isArray(value);

export function loadOperatorIdentityConfig(env: NodeJS.ProcessEnv = process.env): OperatorIdentityConfig {
    try {
        const issuer = env.PLATFORM_OIDC_ISSUER?.trim();
        const audience = env.PLATFORM_OIDC_AUDIENCE?.trim();
        const jwksUrl = env.PLATFORM_OIDC_JWKS_URL?.trim();
        const mfaAcr = env.PLATFORM_OIDC_MFA_ACR?.trim();
        const subjects: unknown = JSON.parse(env.PLATFORM_OIDC_SUBJECTS || 'null');
        if (!issuer || !audience || !jwksUrl || !mfaAcr || !Array.isArray(subjects) ||
            subjects.length < 1 || subjects.length > 100 || subjects.some(s =>
                typeof s !== 'string' || !s.trim() || s.length > 256 || s !== s.trim())) throw unavailable();
        const issuerUrl = new URL(issuer);
        const keysUrl = new URL(jwksUrl);
        for (const url of [issuerUrl, keysUrl]) {
            if (url.protocol !== 'https:' || url.username || url.password || url.hash || url.search) throw unavailable();
        }
        if (issuerUrl.origin !== keysUrl.origin) throw unavailable();
        return { issuer, audience, jwksUrl, mfaAcr, subjects };
    } catch { throw unavailable(); }
}

// Bounded provider-only HTTPS fetch. Never follow a token-supplied jku/x5u or redirects.
async function fetchProviderKeys(url: string): Promise<unknown> {
    const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(3000) });
    if (!response.ok || !response.body) throw unavailable();
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            size += value.byteLength;
            if (size > 128 * 1024) throw unavailable();
            chunks.push(value);
        }
        return JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } finally {
        await reader.cancel().catch(() => undefined);
    }
}

function parseKeys(document: unknown): Map<string, KeyObject> {
    if (!record(document) || !Array.isArray(document.keys) || !document.keys.length || document.keys.length > 32) throw unavailable();
    const keys = new Map<string, KeyObject>();
    const seen = new Set<string>();
    for (const jwk of document.keys) {
        if (!record(jwk) || typeof jwk.kid !== 'string' || !jwk.kid || jwk.kid.length > 256) throw unavailable();
        if (seen.has(jwk.kid)) throw unavailable();
        seen.add(jwk.kid);
        if (jwk.kty !== 'RSA' || (jwk.use !== undefined && jwk.use !== 'sig') ||
            (jwk.alg !== undefined && jwk.alg !== 'RS256')) continue;
        if (['d', 'p', 'q', 'dp', 'dq', 'qi', 'oth'].some(field => field in jwk) ||
            (jwk.key_ops !== undefined && (!Array.isArray(jwk.key_ops) || !jwk.key_ops.includes('verify')))) throw unavailable();
        // Use Node's maintained JWK parser; never implement signature cryptography here.
        const key = createPublicKey({ key: jwk as webcrypto.JsonWebKey, format: 'jwk' });
        if (key.asymmetricKeyType !== 'rsa' || (key.asymmetricKeyDetails?.modulusLength ?? 0) < 2048) throw unavailable();
        keys.set(jwk.kid, key);
    }
    if (!keys.size) throw unavailable();
    return keys;
}

export function createOperatorIdentityVerifier(deps: {
    config?: () => OperatorIdentityConfig;
    fetchKeys?: (url: string) => Promise<unknown>;
    now?: () => number;
} = {}) {
    const now = deps.now ?? Date.now;
    let cache: { url: string; until: number; keys: Map<string, KeyObject> } | undefined;
    let pending: { url: string; promise: Promise<Map<string, KeyObject>> } | undefined;
    let failed: { url: string; until: number } | undefined;
    async function keysFor(url: string) {
        if (cache?.url === url && cache.until > now()) return cache.keys;
        if (failed?.url === url && failed.until > now()) throw unavailable();
        if (pending?.url === url) return pending.promise;
        const promise = (async () => {
            try {
                const keys = parseKeys(await (deps.fetchKeys ?? fetchProviderKeys)(url));
                cache = { url, keys, until: now() + 60_000 };
                failed = undefined;
                return keys;
            } catch {
                failed = { url, until: now() + 5000 };
                throw unavailable();
            } finally { if (pending?.url === url) pending = undefined; }
        })();
        pending = { url, promise };
        return promise;
    }
    return async (token: string): Promise<OperatorPrincipal> => {
        const config = (deps.config ?? loadOperatorIdentityConfig)();
        if (typeof token !== 'string' || token.length > 16_384 || token.split('.').length !== 3) throw unauthorized();
        let decoded;
        try { decoded = jwt.decode(token, { complete: true }); } catch { throw unauthorized(); }
        if (!decoded || decoded.header.alg !== 'RS256' || typeof decoded.header.kid !== 'string' ||
            !decoded.header.kid || decoded.header.kid.length > 256 || decoded.header.crit?.length ||
            'jku' in decoded.header || 'x5u' in decoded.header || 'jwk' in decoded.header) throw unauthorized();
        const key = (await keysFor(config.jwksUrl)).get(decoded.header.kid);
        if (!key) throw unauthorized();
        try {
            const claims = jwt.verify(token, key, { algorithms: ['RS256'], issuer: config.issuer,
                audience: config.audience, maxAge: '15m', clockTimestamp: Math.floor(now() / 1000) });
            if (typeof claims === 'string' || !Number.isSafeInteger(claims.exp) || !Number.isSafeInteger(claims.iat) ||
                claims.iat! > Math.floor(now() / 1000) || claims.exp! <= claims.iat! ||
                typeof claims.sub !== 'string' || !config.subjects.includes(claims.sub) || claims.acr !== config.mfaAcr) throw unauthorized();
            return Object.freeze({ kind: 'PLATFORM_OPERATOR', issuer: config.issuer, subject: claims.sub });
        } catch { throw unauthorized(); }
    };
}

export const verifyOperatorIdentity = createOperatorIdentityVerifier();
