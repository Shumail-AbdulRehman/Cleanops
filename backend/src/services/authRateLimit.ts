import { createHash } from 'node:crypto';
import type { RequestHandler } from 'express';
import { operationalLog } from '../utils/operationalLog.js';

const LOGIN_WINDOW_MS = 15 * 60_000;
const SIGNUP_WINDOW_MS = 60 * 60_000;
const STAFF_CODE_WINDOW_MS = 15 * 60_000;
type Bucket = { until: number; count: number };
type Rule = { key: string; limit: number; windowMs: number };
type Area = 'login' | 'signup' | 'staffCodeRequest' | 'staffCodeVerify';

/** Limits are per process: the app runs on one dyno today. No shared store. */
export function createAuthRateLimit(deps: {
    now?: () => number;
    maxKeys?: number;
    log?: typeof operationalLog;
} = {}) {
    const now = deps.now ?? Date.now;
    const maxKeys = deps.maxKeys ?? 10_000;
    const log = deps.log ?? operationalLog;
    if (!Number.isSafeInteger(maxKeys) || maxKeys < 2) {
        throw new RangeError('maxKeys must be a safe integer of at least 2');
    }
    const buckets = new Map<string, Bucket>();
    // Hash the entire tuple so neither email nor IP is retained as a map key.
    const key = (...parts: string[]) => createHash('sha256').update(JSON.stringify(parts)).digest('hex');

    function consume(rules: Rule[], at: number): number {
        for (const rule of rules) {
            const bucket = buckets.get(rule.key);
            if (bucket && bucket.until <= at) buckets.delete(rule.key);
        }
        const missing = rules.filter(rule => !buckets.has(rule.key));
        if (buckets.size + missing.length > maxKeys) {
            for (const [id, bucket] of buckets) if (bucket.until <= at) buckets.delete(id);
        }
        if (buckets.size + missing.length > maxKeys) {
            // Fail closed instead of evicting a live bucket and resetting its limit.
            let earliest = Infinity;
            for (const bucket of buckets.values()) earliest = Math.min(earliest, bucket.until);
            return Math.max(1, Math.ceil((earliest - at) / 1000));
        }
        let retryAfter = 0;
        for (const rule of rules) {
            let bucket = buckets.get(rule.key);
            if (!bucket) {
                bucket = { until: at + rule.windowMs, count: 0 };
                buckets.set(rule.key, bucket);
            }
            // Every login attempt counts against the IP, even if its email is blocked.
            bucket.count = Math.min(bucket.count + 1, rule.limit + 1);
            if (bucket.count > rule.limit) {
                retryAfter = Math.max(retryAfter, Math.ceil((bucket.until - at) / 1000));
            }
        }
        return retryAfter;
    }

    function rulesFor(area: Area, ip: string, email: unknown): Rule[] {
        switch (area) {
            case 'signup':
                return [{ key: key('signup', ip), limit: 10, windowMs: SIGNUP_WINDOW_MS }];
            case 'login':
                return [
                    { key: key('login', ip), limit: 50, windowMs: LOGIN_WINDOW_MS },
                    { key: key('login-email', ip, typeof email === 'string'
                        ? email.trim().toLowerCase() : ''), limit: 10, windowMs: LOGIN_WINDOW_MS },
                ];
            case 'staffCodeRequest':
                return [{ key: key('staffCode', 'request', ip), limit: 20, windowMs: STAFF_CODE_WINDOW_MS }];
            case 'staffCodeVerify':
                return [{ key: key('staffCode', 'verify', ip), limit: 30, windowMs: STAFF_CODE_WINDOW_MS }];
        }
    }

    function middleware(area: Area): RequestHandler {
        return (req, res, next) => {
            // req.ip is resolved by Express's configured trusted-proxy policy.
            // Never read X-Forwarded-For directly; unknown IPs share one bucket.
            const ip = req.ip ?? 'unknown';
            const retryAfter = consume(rulesFor(area, ip, req.body?.email), now());
            if (!retryAfter) { next(); return; }
            log({ event: 'AUTH_RATE_LIMITED', status: 429 }, { level: 'warn' });
            res.setHeader('Retry-After', String(retryAfter));
            res.status(429).json({ success: false, code: 'AUTH_RATE_LIMITED', message: 'Too many attempts. Try again later.' });
        };
    }

    return {
        login: middleware('login'),
        signup: middleware('signup'),
        staffCodeRequest: middleware('staffCodeRequest'),
        staffCodeVerify: middleware('staffCodeVerify'),
        /** Bounded aggregate only, for diagnostics; keys are never exposed. */
        get keyCount() { return buckets.size; },
    };
}

/** Reuse this singleton across public auth routes so each process shares limits. */
export const authRateLimit = createAuthRateLimit();
