import { createHmac, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Page, Request, Route } from '@playwright/test';
import { API_ORIGIN } from './env';

/** A fixture body as the real API sends it: `{ success, message?, data }` or an error envelope. */
export type Body = { success: boolean; data?: unknown; message?: string; [key: string]: unknown };
export type Reply = { status?: number; body: Body; delayMs?: number };
export type Call = { method: string; path: string; query: Record<string, string>; body: unknown; authorized: boolean };
type Responder = Reply | ((call: Call) => Reply | Promise<Reply>);

const JSQR_CDN = 'https://cdn.jsdelivr.net/npm/jsqr@';
const fixtureDir = join(__dirname, '..', 'fixtures');
export const requestCodePath = '/common/staff-login/request-code';
export const verifyCodePath = '/common/staff-login/verify-code';
const fingerprintKey = randomBytes(32);
export const codeFingerprint = (code: string) => createHmac('sha256', fingerprintKey).update(code).digest('hex');

/** A fresh copy of a JSON body in `e2e-web/fixtures/`. */
export function fixture<T extends Body = Body>(name: string): T {
  return JSON.parse(readFileSync(join(fixtureDir, `${name}.json`), 'utf8')) as T;
}

/** The envelope the server uses for a successful read. */
export const ok = (data: unknown, message = 'Success'): Reply => ({ body: { statusCode: 200, success: true, message, data } });
/** The envelope the server's error handler sends. */
export const fail = (status: number, message: string): Reply => ({ status, body: { statusCode: status, success: false, message, errors: [] } });

const cors = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': '*',
  'access-control-allow-methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
};

/**
 * Answers every request to the reserved test API host from fixtures. Nothing reaches a real
 * backend: requests to any other non-loopback host are aborted, and an API path with no
 * responder gets the server's 404 envelope and is listed in `unexpected`.
 */
export class StaffApi {
  readonly calls: Call[] = [];
  readonly unexpected: string[] = [];
  readonly blocked: string[] = [];
  private readonly routes: { method: string; path: string | RegExp; reply: Responder }[] = [];

  constructor() {
    this.on('GET', '/common/get-current-user', { body: fixture('current-user') });
    this.on('GET', '/staff/mobile/attendance', { body: fixture('attendance') });
    this.on('GET', '/staff/mobile/tasks', { body: fixture('tasks') });
    this.on('GET', '/staff/profile/me', { body: fixture('profile-me') });
    this.on('GET', /^\/task-instance\/\d+$/, { body: fixture('task-instance') });
    this.on('GET', /^\/task-instance\/\d+\/verification$/, { body: fixture('verification') });
    this.on('GET', '/staff/mobile/history', { body: fixture('history') });
    this.on('GET', '/staff/mobile/attendance/month', { body: fixture('attendance-month') });
    this.on('GET', '/staff/mobile/profile', { body: fixture('profile') });
    this.on('POST', requestCodePath, { status: 202, body: fixture('staff-code-request') });
    this.on('POST', verifyCodePath, { body: fixture('staff-code-verify') });
    this.on('POST', '/common/logout', ok(null, 'Logged out'));
  }

  /** Register a responder. The latest registration for a path wins. */
  on(method: string, path: string | RegExp, reply: Responder): this {
    this.routes.unshift({ method, path, reply });
    return this;
  }

  /** Calls to a path (exact string or pattern), optionally of one method. */
  callsTo(path: string | RegExp, method?: string): Call[] {
    return this.calls.filter(call => (method ? call.method === method : true) && matches(path, call.path));
  }

  async install(page: Page): Promise<void> {
    await page.route('**/*', route => this.handle(route));
  }

  private async handle(route: Route): Promise<void> {
    const request = route.request();
    const url = new URL(request.url());
    if (url.href.startsWith(JSQR_CDN)) {
      // expo-camera's web barcode worker imports jsQR from a CDN at start-up. Serve a stand-in that finds no code.
      return route.fulfill({ status: 200, contentType: 'text/javascript', headers: cors, body: 'self.jsQR = function () { return null; };' });
    }
    if (url.origin !== API_ORIGIN) {
      if (['127.0.0.1', 'localhost'].includes(url.hostname) || url.protocol === 'data:' || url.protocol === 'blob:') return route.continue();
      this.blocked.push(url.href);
      return route.abort('blockedbyclient');
    }
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    const path = url.pathname.replace(/^\/api/, '').replace(/\/+$/, '');
    const call: Call = {
      method: request.method(), path, query: Object.fromEntries(url.searchParams),
      body: bodyOf(request, path), authorized: 'authorization' in request.headers(),
    };
    this.calls.push(call);
    const found = this.routes.find(entry => entry.method === call.method && matches(entry.path, path));
    if (!found) this.unexpected.push(`${call.method} ${path}`);
    const reply = found ? (typeof found.reply === 'function' ? await found.reply(call) : found.reply) : fail(404, 'Route not found');
    if (reply.delayMs) await new Promise(resolve => setTimeout(resolve, reply.delayMs));
    try {
      await route.fulfill({ status: reply.status ?? 200, headers: cors, contentType: 'application/json', body: JSON.stringify(reply.body) });
    } catch {
      // The page closed while a delayed reply was waiting.
    }
  }
}

function matches(pattern: string | RegExp, path: string): boolean {
  return typeof pattern === 'string' ? pattern === path : pattern.test(path);
}

function bodyOf(request: Request, path: string): unknown {
  if (path === verifyCodePath) {
    // Capture proof of the submitted value without retaining plaintext in the fixture's call log.
    const { phone, code } = (request.postDataJSON() ?? {}) as { phone?: unknown; code?: unknown };
    return { phone, codeDigest: typeof code === 'string' ? codeFingerprint(code) : null };
  }
  try {
    return request.postDataJSON();
  } catch {
    return request.postData();
  }
}
