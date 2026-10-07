import assert from "node:assert/strict";
import test from "node:test";
import AsyncStorage from '@react-native-async-storage/async-storage';
import { configureApiAuth, uploadFormData } from "./client";

// Spec 72: with a progress callback the same upload goes through XMLHttpRequest, which reports the bytes sent.

type Sent = { method: string; url: string; headers: Record<string, string>; body: unknown };
const sent: Sent[] = [];
let script: (xhr: FakeXhr) => void = () => {};

class FakeXhr {
  status = 0; responseText = ''; method = ''; url = ''; headers: Record<string, string> = {}; responseHeaders: Record<string, string> = {};
  upload: { onprogress: ((event: { lengthComputable: boolean; loaded: number; total: number }) => void) | null } = { onprogress: null };
  onload: (() => void) | null = null; onerror: (() => void) | null = null; onabort: (() => void) | null = null;
  open(method: string, url: string) { this.method = method; this.url = url; }
  setRequestHeader(name: string, value: string) { this.headers[name] = value; }
  getResponseHeader(name: string) { return this.responseHeaders[name] ?? null; }
  abort() { this.onabort?.(); }
  send(body: unknown) { sent.push({ method: this.method, url: this.url, headers: this.headers, body }); queueMicrotask(() => script(this)); }
  answer(status: number, json: unknown, headers: Record<string, string> = {}) { this.status = status; this.responseText = JSON.stringify(json); this.responseHeaders = headers; this.onload?.(); }
}

function setup(t: { mock: { method: (...args: any[]) => unknown } }) {
  t.mock.method(AsyncStorage, 'getItem', async () => null);
  t.mock.method(AsyncStorage, 'setItem', async () => {});
  configureApiAuth({ getScope: () => null, getTokens: async () => ({ accessToken: 'token', refreshToken: null }), setTokens: async () => {}, clearSession: async () => {} });
  sent.length = 0;
  const saved = { xhr: (globalThis as any).XMLHttpRequest, fetch: globalThis.fetch };
  (globalThis as any).XMLHttpRequest = FakeXhr;
  return () => { (globalThis as any).XMLHttpRequest = saved.xhr; globalThis.fetch = saved.fetch; };
}

test('progress callback: the same POST, headers and body; the bytes sent reported 0 to 1; the JSON answer returned', async t => {
  const restore = setup(t);
  try {
    const fractions: number[] = [];
    script = xhr => {
      xhr.upload.onprogress?.({ lengthComputable: true, loaded: 250, total: 1000 });
      xhr.upload.onprogress?.({ lengthComputable: false, loaded: 0, total: 0 });
      xhr.upload.onprogress?.({ lengthComputable: true, loaded: 1200, total: 1000 });
      xhr.answer(200, { data: { attemptId: 'a1' } });
    };
    const form = new FormData();
    const result = await uploadFormData<{ data: { attemptId: string } }>('/capture-session/s/attempts', () => form, 1000, () => true, f => fractions.push(f));
    assert.deepEqual(result, { data: { attemptId: 'a1' } });
    assert.deepEqual(fractions, [0.25, 1], 'unknown totals are skipped; never above 1');
    assert.equal(sent.length, 1);
    assert.equal(sent[0].method, 'POST');
    assert.match(sent[0].url, /\/capture-session\/s\/attempts$/);
    assert.equal(sent[0].headers['X-Hygene-Workflow'], '2');
    assert.equal(sent[0].headers.Authorization, 'Bearer token');
    assert.equal(sent[0].body, form);
  } finally { restore(); }
});

test('progress path keeps the error shapes: server refusal with status, network failure, timeout', async t => {
  const restore = setup(t);
  try {
    script = xhr => xhr.answer(409, { message: 'Upload window closed' }, { 'Retry-After': '5' });
    await assert.rejects(uploadFormData('/x', () => new FormData(), 1000, () => true, () => {}), (error: any) =>
      error.message === 'Upload window closed' && error.response.status === 409 && error.response.headers['retry-after'] === '5');
    script = xhr => xhr.onerror?.();
    await assert.rejects(uploadFormData('/x', () => new FormData(), 1000, () => true, () => {}), TypeError);
    script = () => { /* never answers */ };
    await assert.rejects(uploadFormData('/x', () => new FormData(), 20, () => true, () => {}), /Upload timed out/);
  } finally { restore(); }
});

test('a throwing progress callback never breaks the upload; without a callback fetch is used as before', async t => {
  const restore = setup(t);
  try {
    script = xhr => { xhr.upload.onprogress?.({ lengthComputable: true, loaded: 1, total: 2 }); xhr.answer(200, { ok: true }); };
    assert.deepEqual(await uploadFormData('/x', () => new FormData(), 1000, () => true, () => { throw new Error('display'); }), { ok: true });
    let fetched = 0;
    globalThis.fetch = (async () => { fetched += 1; return new Response(JSON.stringify({ ok: 1 }), { status: 200 }); }) as typeof fetch;
    sent.length = 0;
    assert.deepEqual(await uploadFormData('/x', () => new FormData()), { ok: 1 });
    assert.equal(fetched, 1);
    assert.equal(sent.length, 0, 'no XMLHttpRequest without a progress callback');
  } finally { restore(); }
});
