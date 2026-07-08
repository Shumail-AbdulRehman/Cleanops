import { createHash, randomBytes } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import bcrypt from 'bcrypt';
import { z } from 'zod';
import type { Request } from 'express';
import { ApiError } from '../utils/ApiError.js';
import type { OperatorPrincipal } from './operatorIdentity.service.js';

export const LOCAL_OPERATOR_COOKIE = 'hygene_local_platform';
export const localOperatorCookieOptions = { httpOnly: true, sameSite: 'strict' as const, secure: false, path: '/api/platform' };
export const LIVE_OPERATOR_COOKIE = 'hygene_platform';
const attemptWindowMs = 15 * 60_000;
const localMode = {
  name: 'local', issuer: 'urn:hygene:local-development', durationMs: 15 * 60_000, sessionLimit: 64,
  cookie: { name: LOCAL_OPERATOR_COOKIE, options: localOperatorCookieOptions },
} as const;
const liveMode = {
  name: 'live', issuer: 'urn:hygene:platform-password', durationMs: 8 * 60 * 60_000, sessionLimit: 16,
  cookie: { name: LIVE_OPERATOR_COOKIE, options: { ...localOperatorCookieOptions, secure: true } },
} as const;
const emailInput = z.string().email().max(254);
const bcryptHash = /^\$2[aby]\$(10|11|12|13|14)\$[./A-Za-z0-9]{53}$/;
const credentialsInput = z.object({ email: z.string().trim().email().max(254), password: z.string().min(8).refine(value => Buffer.byteLength(value, 'utf8') <= 72) }).strict();
type Credentials = { email: string; passwordHash: string };
type Mode = typeof localMode | typeof liveMode;
type Configuration = Credentials & { mode: Mode; env: NodeJS.ProcessEnv; fingerprint: string };
type LiveAttempts = { failures: number; pending: number; expiresAt: number };
const fail = (status: number, message: string) => new ApiError(status, message);
const throttled = () => fail(429, 'Too many sign-in attempts. Try again in 15 minutes.');
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const loopback = (address?: string) => ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(address ?? '');
export function localOperatorEnvironmentAllowed(env: NodeJS.ProcessEnv) {
  try {
    const db = new URL(env.DATABASE_URL ?? '');
    const database = db.pathname.slice(1);
    return env.NODE_ENV === 'development' && env.LOCAL_PLATFORM_LOGIN_ENABLED === 'true'
      && ['postgres:', 'postgresql:'].includes(db.protocol) && db.hostname === '127.0.0.1'
      && !db.search && !db.hash && ((db.port === '56445' && database === 'hygene_ops_local')
        || /^priv_e2e_test_[a-f0-9]{32}$/.test(database));
  } catch { return false; }
}
function readCredentials(env: NodeJS.ProcessEnv): Credentials {
  const file = env.LOCAL_PLATFORM_CREDENTIAL_FILE;
  if (!file || !isAbsolute(file)) throw Error();
  const info = statSync(file);
  if (!info.isFile() || info.size > 4096 || (info.mode & 0o077) || (process.getuid && info.uid !== process.getuid())) throw Error();
  const value = JSON.parse(readFileSync(file, 'utf8'));
  if (!emailInput.safeParse(value.email).success || !bcryptHash.test(value.passwordHash ?? '')) throw Error();
  return { email: value.email.toLowerCase(), passwordHash: value.passwordHash };
}

function readLiveCredentials(env: NodeJS.ProcessEnv): Credentials | null {
  const email = env.PLATFORM_LOGIN_EMAIL?.trim().toLowerCase() ?? '';
  const passwordHash = env.PLATFORM_LOGIN_PASSWORD_HASH;
  if (env.PLATFORM_LOGIN_ENABLED !== 'true' || !emailInput.safeParse(email).success || !passwordHash || !bcryptHash.test(passwordHash)) return null;
  return { email, passwordHash };
}

function origin(req: Request, config: Configuration, required = false) {
  const value = req.header('Origin');
  if (value === undefined && !required) return;
  if (config.mode.name === 'live') {
    const allowed = (config.env.FRONTEND_URL ?? '').split(',')
      .map(item => item.trim().replace(/^['"]+|['"]+$/g, '').replace(/\/+$/, ''));
    if (value?.startsWith('https://') && allowed.includes(value)) {
      try { if (new URL(value).origin === value) return; }
      catch { /* Deny malformed origins. */ }
    }
    throw fail(403, 'Platform origin required');
  }
  if (!value && !required) return;
  try {
    const candidate = new URL(value ?? '');
    const expected = new URL(config.env.FRONTEND_URL ?? '');
    if (candidate.protocol === 'http:' && ['localhost','127.0.0.1','[::1]'].includes(candidate.hostname)
      && candidate.port === expected.port && candidate.origin === value) return;
  } catch { /* Deny malformed origins. */ }
  throw fail(403, 'Local platform origin required');
}

export function createLocalOperatorSessions(deps: {
  env?: () => NodeJS.ProcessEnv; readCredentials?: (env: NodeJS.ProcessEnv) => Credentials; now?: () => number;
} = {}) {
  type Session = { fingerprint: string; expiresAt: number };
  const sessions = { local: new Map<string, Session>(), live: new Map<string, Session>() };
  const localAttempts = new Map<string, { count: number; expiresAt: number }>();
  const liveClientAttempts = new Map<string, LiveAttempts>();
  let liveAccountAttempts: LiveAttempts | undefined;
  let liveFingerprint: string | undefined;
  const now = deps.now ?? Date.now;
  function configuration(req: Request): Configuration | null {
    const env = (deps.env ?? (() => process.env))();
    if (localOperatorEnvironmentAllowed(env) && loopback(req.socket?.remoteAddress)) {
      try {
        const credentials = (deps.readCredentials ?? readCredentials)(env);
        return { ...credentials, env, mode: localMode, fingerprint: hash(credentials.email + ':' + credentials.passwordHash) };
      } catch { /* Try live credentials when local credentials cannot be read. */ }
    }
    const credentials = readLiveCredentials(env);
    const fingerprint = credentials ? hash(credentials.email + ':' + credentials.passwordHash) : undefined;
    if (fingerprint !== liveFingerprint) {
      sessions.live.clear();
      liveFingerprint = fingerprint;
    }
    return credentials && fingerprint ? { ...credentials, env, mode: liveMode, fingerprint } : null;
  }
  function authenticate(req: Request): OperatorPrincipal | null {
    const config = configuration(req);
    return config ? authenticateSession(req, config) : null;
  }
  function authenticateSession(req: Request, config: Configuration): OperatorPrincipal | null {
    const { mode } = config;
    const token = req.cookies?.[mode.cookie.name];
    if (!token) return null;
    origin(req, config, req.method !== 'GET' && (mode.name === 'live' || req.method !== 'HEAD'));
    if (req.user || req.header('Authorization') || typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(token)) {
      throw fail(401, mode.name === 'local' ? 'Invalid local platform session' : 'Invalid platform session');
    }
    const store = sessions[mode.name];
    const key = hash(token), session = store.get(key);
    if (!session || session.expiresAt <= now() || session.fingerprint !== config.fingerprint) {
      store.delete(key); throw fail(401, 'Platform session expired. Sign in again.');
    }
    return Object.freeze({ kind: 'PLATFORM_OPERATOR', issuer: mode.issuer, subject: config.email });
  }
  function reserveLocalAttempt(key: string, at: number) {
    for (const [address, value] of localAttempts) if (value.expiresAt <= at) localAttempts.delete(address);
    const previous = localAttempts.get(key);
    if (previous && previous.count >= 5) throw throttled();
    localAttempts.set(key, { count: (previous?.count ?? 0) + 1, expiresAt: previous?.expiresAt ?? at + attemptWindowMs });
    return (correct: boolean) => { if (correct) localAttempts.delete(key); };
  }
  function reserveLiveAttempt(key: string, at: number) {
    const window = () => ({ failures: 0, pending: 0, expiresAt: at + attemptWindowMs });
    for (const [address, value] of liveClientAttempts) if (value.expiresAt <= at) liveClientAttempts.delete(address);
    const client = liveClientAttempts.get(key) ?? window();
    const account = liveAccountAttempts && liveAccountAttempts.expiresAt > at ? liveAccountAttempts : window();
    if (client.failures + client.pending >= 5 || account.failures + account.pending >= 20) throw throttled();
    // Reserve capacity before bcrypt yields, so concurrent guesses share both limits.
    client.pending++;
    account.pending++;
    liveClientAttempts.set(key, client);
    liveAccountAttempts = account;
    return (correct: boolean) => {
      client.pending--;
      account.pending--;
      if (correct) {
        client.failures = 0;
        if (!client.pending && liveClientAttempts.get(key) === client) liveClientAttempts.delete(key);
        if (!account.pending && !account.failures && liveAccountAttempts === account) liveAccountAttempts = undefined;
      } else {
        client.failures++;
        account.failures++;
      }
    };
  }
  return {
    authenticate,
    status(req: Request) {
      const config = configuration(req);
      if (!config) return { enabled: false, authenticated: false };
      if (config.mode.name === 'live') origin(req, config);
      try { const actor = authenticateSession(req, config); return { enabled: true, authenticated: !!actor, ...(actor ? { email: actor.subject } : {}) }; }
      catch { return { enabled: true, authenticated: false }; }
    },
    async login(req: Request, raw: unknown) {
      const config = configuration(req);
      if (!config) throw fail(503, 'Local platform sign-in is unavailable');
      origin(req, config, true);
      const parsed = credentialsInput.safeParse(raw);
      if (!parsed.success) throw fail(400, 'Enter a valid email and password');
      const at = now();
      const { mode } = config;
      const live = mode.name === 'live';
      const finish = live ? reserveLiveAttempt(req.ip ?? '', at) : reserveLocalAttempt(req.socket.remoteAddress!, at);
      // Node bcrypt supports the equivalent 2b prefix for 2y hashes.
      const passwordHash = live ? config.passwordHash.replace(/^\$2y\$/, () => '$2b$') : config.passwordHash;
      let correct = false;
      try {
        const passwordMatches = await bcrypt.compare(parsed.data.password, passwordHash);
        correct = passwordMatches && parsed.data.email.toLowerCase() === config.email;
      } finally { finish(correct); }
      if (!correct) throw fail(401, 'Invalid platform email or password');
      if (live) {
        const active = configuration(req);
        if (active?.mode !== mode || active.fingerprint !== config.fingerprint) throw fail(503, 'Local platform sign-in is unavailable');
      }
      const issuedAt = live ? now() : at;
      const store = sessions[mode.name];
      for (const [id, value] of store) if (value.expiresAt <= issuedAt) store.delete(id);
      if (store.size >= mode.sessionLimit) store.delete(store.keys().next().value!);
      const token = randomBytes(32).toString('base64url'), expiresAt = issuedAt + mode.durationMs;
      store.set(hash(token), { fingerprint: config.fingerprint, expiresAt });
      return { token, expiresAt: new Date(expiresAt), email: config.email, cookie: mode.cookie };
    },
    logout(req: Request) {
      const config = configuration(req);
      if (!config) throw fail(503, 'Local platform sign-in is unavailable');
      origin(req, config, true);
      const { mode } = config;
      const token = req.cookies?.[mode.cookie.name];
      if (typeof token === 'string') sessions[mode.name].delete(hash(token));
      return mode.cookie;
    },
  };
}
export const localOperatorSessions = createLocalOperatorSessions();
