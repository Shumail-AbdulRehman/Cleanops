import assert from 'node:assert/strict';
import test from 'node:test';
import {createSessionStorage, SECURE_SESSION_KEY} from './sessionStorage';

function storage(native = true) {
  const oldKey = '@cleanops-staff/auth';
  const legacy = new Map<string, string>();
  const secure = new Map<string, string>();
  let rejectWrite = false;
  const valid = (key: string) => { if (!/^[\w.-]+$/.test(key)) throw new Error('Invalid SecureStore key'); };
  const session = createSessionStorage(native, oldKey, {
    getItem: async key => legacy.get(key) ?? null,
    setItem: async (key, value) => { legacy.set(key, value); },
    removeItem: async key => { legacy.delete(key); },
  }, {
    getItemAsync: async key => { valid(key); return secure.get(key) ?? null; },
    setItemAsync: async (key, value) => { valid(key); if (rejectWrite) throw new Error('Device locked'); secure.set(key, value); },
    deleteItemAsync: async key => { valid(key); secure.delete(key); },
  });
  return {session, legacy, secure, oldKey, failWrite: () => { rejectWrite = true; }};
}

test('native login persists and reopens with Android-compatible SecureStore keys', async () => {
  const s = storage();
  assert.equal(await s.session.read(), null);
  await s.session.write('test-session');
  assert.equal(s.secure.get(SECURE_SESSION_KEY), 'test-session');
  assert.equal(await s.session.read(), 'test-session');
  await s.session.write(null);
  assert.equal(await s.session.read(), null);
});

test('legacy account recovery migrates only after successful secure persistence', async () => {
  const s = storage();
  s.legacy.set(s.oldKey, 'legacy-session');
  assert.equal(await s.session.read(), 'legacy-session');
  s.failWrite();
  await assert.rejects(s.session.write('legacy-session'), /Device locked/);
  assert.equal(s.legacy.get(s.oldKey), 'legacy-session');
});

test('secure account takes precedence and successful migration or logout removes legacy auth only', async () => {
  const s = storage();
  s.legacy.set(s.oldKey, 'legacy-session');
  s.legacy.set('@cleanops-staff/api-address', 'test-server');
  await s.session.write('new-session');
  assert.equal(s.legacy.has(s.oldKey), false);
  s.legacy.set(s.oldKey, 'stale-session');
  assert.equal(await s.session.read(), 'new-session');
  await s.session.write(null);
  assert.equal(await s.session.read(), null);
  assert.equal(s.legacy.get('@cleanops-staff/api-address'), 'test-server');
});

test('web sessions keep their existing AsyncStorage key', async () => {
  const s = storage(false);
  await s.session.write('web-session');
  assert.equal(await s.session.read(), 'web-session');
  assert.equal(s.secure.size, 0);
  await s.session.write(null);
  assert.equal(await s.session.read(), null);
});
