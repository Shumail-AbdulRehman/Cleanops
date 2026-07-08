import { describe, expect, it, vi } from 'vitest';
import type { Request, Response, RequestHandler } from 'express';
import { createOperationalLogger } from '../utils/operationalLog.js';
import { authRateLimit, createAuthRateLimit } from './authRateLimit.js';

const LOGIN_WINDOW = 15 * 60_000;
const SIGNUP_WINDOW = 60 * 60_000;

function fixture(maxKeys = 10_000) {
    let at = 0;
    const sink = vi.fn();
    const limiter = createAuthRateLimit({ now: () => at, maxKeys, log: createOperationalLogger(sink) });
    function request(handler: RequestHandler, ip: string | undefined = '192.0.2.1', body: unknown = { email: 'owner@example.test' }) {
        const next = vi.fn();
        const res = { setHeader: vi.fn(), status: vi.fn().mockReturnThis(), json: vi.fn() };
        handler({ ip, body, headers: { 'x-forwarded-for': '192.0.2.99' } } as unknown as Request, res as unknown as Response, next);
        return { next, ...res };
    }
    return { limiter, sink, request, time: (value: number) => { at = value; } };
}

function allowed(result: ReturnType<ReturnType<typeof fixture>['request']>) {
    expect(result.next).toHaveBeenCalledExactlyOnceWith();
    expect(result.status).not.toHaveBeenCalled();
}

function blocked(result: ReturnType<ReturnType<typeof fixture>['request']>, seconds: number) {
    expect(result.next).not.toHaveBeenCalled();
    expect(result.status).toHaveBeenCalledExactlyOnceWith(429);
    expect(result.setHeader).toHaveBeenCalledExactlyOnceWith('Retry-After', String(seconds));
    expect(result.json).toHaveBeenCalledExactlyOnceWith({ success: false, code: 'AUTH_RATE_LIMITED', message: 'Too many attempts. Try again later.' });
}

describe('authentication rate limits', () => {
    it('allows ten login attempts and rejects the eleventh', () => {
        const f = fixture();
        for (let i = 0; i < 10; i++) allowed(f.request(f.limiter.login));
        blocked(f.request(f.limiter.login), 900);
    });

    it('allows fifty logins per IP across emails and rejects the fifty-first', () => {
        const f = fixture();
        for (let i = 0; i < 50; i++) allowed(f.request(f.limiter.login, '192.0.2.1', { email: `user${i}@example.test` }));
        blocked(f.request(f.limiter.login, '192.0.2.1', { email: 'another@example.test' }), 900);
    });

    it('counts attempts rejected by the email bucket against the IP too', () => {
        const f = fixture();
        for (let i = 0; i < 50; i++) f.request(f.limiter.login);
        blocked(f.request(f.limiter.login, '192.0.2.1', { email: 'another@example.test' }), 900);
    });

    it('keeps different emails separate on the same IP', () => {
        const f = fixture();
        for (let i = 0; i < 10; i++) f.request(f.limiter.login);
        allowed(f.request(f.limiter.login, '192.0.2.1', { email: 'another@example.test' }));
        blocked(f.request(f.limiter.login), 900);
    });

    it('normalizes email whitespace and case before hashing', () => {
        const f = fixture();
        for (let i = 0; i < 10; i++) f.request(f.limiter.login);
        blocked(f.request(f.limiter.login, '192.0.2.1', { email: ' Owner@EXAMPLE.test ' }), 900);
        expect(f.limiter.keyCount).toBe(2);
    });

    it('keeps IPs separate even for the same email', () => {
        const f = fixture();
        for (let i = 0; i < 10; i++) f.request(f.limiter.login);
        allowed(f.request(f.limiter.login, '192.0.2.2'));
    });

    it.each([undefined, null, {}, { email: 123 }])('bounds malformed login bodies: %j', body => {
        const f = fixture();
        for (let i = 0; i < 10; i++) f.request(f.limiter.login, '192.0.2.1', body === undefined ? null : body);
        blocked(f.request(f.limiter.login, '192.0.2.1', body === undefined ? null : body), 900);
    });

    it('allows ten signups per IP, regardless of email, and rejects the eleventh', () => {
        const f = fixture();
        for (let i = 0; i < 10; i++) allowed(f.request(f.limiter.signup, '192.0.2.1', { email: `user${i}@example.test` }));
        blocked(f.request(f.limiter.signup), 3600);
        allowed(f.request(f.limiter.signup, '192.0.2.2'));
    });

    it.each([
        ['login', LOGIN_WINDOW], ['signup', SIGNUP_WINDOW],
    ] as const)('resets %s exactly at expiry without extending the fixed window', (area, windowMs) => {
        const f = fixture();
        for (let i = 0; i < 10; i++) f.request(f.limiter[area]);
        f.time(windowMs - 1001);
        blocked(f.request(f.limiter[area]), 2);
        f.time(windowMs - 1);
        blocked(f.request(f.limiter[area]), 1);
        f.time(windowMs);
        for (let i = 0; i < 10; i++) allowed(f.request(f.limiter[area]));
        blocked(f.request(f.limiter[area]), windowMs / 1000);
    });

    it('keeps login and signup windows independent', () => {
        const f = fixture();
        for (let i = 0; i < 10; i++) f.request(f.limiter.login);
        allowed(f.request(f.limiter.signup));
        f.time(LOGIN_WINDOW);
        allowed(f.request(f.limiter.login));
        for (let i = 0; i < 9; i++) allowed(f.request(f.limiter.signup));
        blocked(f.request(f.limiter.signup), 2700);
    });

    it.each([['staffCodeRequest', 20], ['staffCodeVerify', 30]] as const)(
        'caps %s at %i attempts per IP for 15 minutes', (area, limit) => {
            const f = fixture();
            const handler = f.limiter[area];
            for (let i = 0; i < limit; i++) allowed(f.request(handler, '192.0.2.1', { phone: i }));
            blocked(f.request(handler), 900);
            allowed(f.request(handler, '192.0.2.2'));
            f.time(LOGIN_WINDOW - 1);
            blocked(f.request(handler), 1);
            f.time(LOGIN_WINDOW);
            allowed(f.request(handler));
        },
    );

    it('keeps staff code requests, verification, login and signup in separate buckets', () => {
        const f = fixture();
        for (let i = 0; i < 20; i++) f.request(f.limiter.staffCodeRequest);
        blocked(f.request(f.limiter.staffCodeRequest), 900);
        for (let i = 0; i < 30; i++) allowed(f.request(f.limiter.staffCodeVerify));
        blocked(f.request(f.limiter.staffCodeVerify), 900);
        allowed(f.request(f.limiter.login));
        allowed(f.request(f.limiter.signup));
    });

    it('holds the key cap under a flood without evicting live limits', () => {
        const f = fixture(3);
        for (let i = 0; i < 10; i++) f.request(f.limiter.login);
        allowed(f.request(f.limiter.signup));
        for (let i = 0; i < 100; i++) {
            blocked(f.request(f.limiter.login, `client-${i}`, { email: `user${i}@example.test` }), 900);
            expect(f.limiter.keyCount).toBe(3);
        }
        blocked(f.request(f.limiter.login), 900);
    });

    it('reserves both login keys atomically when only one slot remains', () => {
        const f = fixture(2);
        allowed(f.request(f.limiter.signup));
        blocked(f.request(f.limiter.login), 3600);
        expect(f.limiter.keyCount).toBe(1);
    });

    it('prunes expired unrelated buckets before admitting new keys', () => {
        const f = fixture(2);
        allowed(f.request(f.limiter.login));
        f.time(LOGIN_WINDOW);
        allowed(f.request(f.limiter.login, '192.0.2.2'));
        expect(f.limiter.keyCount).toBe(2);
    });

    it('does not let forwarded headers replace the Express-resolved IP', () => {
        const f = fixture();
        for (let i = 0; i < 10; i++) f.request(f.limiter.signup);
        blocked(f.request(f.limiter.signup), 3600);
        allowed(f.request(f.limiter.signup, '192.0.2.99'));
    });

    it('logs blocked requests safely at warning level', () => {
        const f = fixture();
        for (let i = 0; i < 10; i++) f.request(f.limiter.login);
        expect(f.sink).not.toHaveBeenCalled();
        f.request(f.limiter.login);
        expect(f.sink).toHaveBeenCalledExactlyOnceWith(JSON.stringify({ event: 'AUTH_RATE_LIMITED', status: 429 }), 'warn');
    });

    it.each([0, 1, -1, 2.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])('rejects invalid key cap %s', maxKeys => {
        expect(() => createAuthRateLimit({ maxKeys })).toThrow(RangeError);
    });

    it('exports shared middleware without wiring routes', () => {
        expect(authRateLimit.login).toBeTypeOf('function');
        expect(authRateLimit.signup).toBeTypeOf('function');
        expect(authRateLimit.staffCodeRequest).toBeTypeOf('function');
        expect(authRateLimit.staffCodeVerify).toBeTypeOf('function');
    });
});
