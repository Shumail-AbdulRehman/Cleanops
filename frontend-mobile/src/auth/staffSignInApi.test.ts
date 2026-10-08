import assert from 'node:assert/strict';
import { randomInt } from 'node:crypto';
import test from 'node:test';
import { client } from '../api/client';
import { formatStaffPhone, requestStaffCode, staffSignInError, verifyStaffCode } from './staffSignInApi';

const phone = '+923001234567';

test('requests a code by phone and returns the 202 payload', async (t) => {
  const data = { phone, expiresInSeconds: 300, resendAfterSeconds: 60 };
  const post = t.mock.method(client, 'post', async () => ({ status: 202, data: { data } }));

  assert.deepEqual(await requestStaffCode('0300 1234567'), data);
  assert.equal(post.mock.callCount(), 1);
  assert.deepEqual(post.mock.calls[0].arguments, ['/common/staff-login/request-code', { phone: '0300 1234567' }]);
  assert.equal(formatStaffPhone(phone), '0300 1234567');
});

test('verifies the phone and six digits and returns the session payload', async (t) => {
  const candidate = randomInt(1_000_000).toString().padStart(6, '0');
  const data = { id: 2, email: null, role: 'STAFF', accessToken: 'synthetic-access', refreshToken: 'synthetic-refresh' };
  let calls = 0;
  t.mock.method(client, 'post', async (path: string, body: { phone: string; code: string }) => {
    calls++;
    assert.equal(path, '/common/staff-login/verify-code');
    assert.equal(body.phone, phone);
    assert.equal(body.code === candidate, true);
    return { status: 200, data: { data } };
  });

  assert.deepEqual(await verifyStaffCode(phone, candidate), data);
  assert.equal(calls, 1);
});

test('maps each contract code to its English key and interpolation values', () => {
  const cases = {
    INVALID_PHONE: 'Enter a Pakistan mobile number, like 03001234567.',
    PHONE_NOT_REGISTERED: 'This number is not registered. Ask your manager to add you.',
    PHONE_DAILY_LIMIT: "This number has reached today's code limit. Try again tomorrow or ask your manager.",
    SMS_DAILY_LIMIT: 'Sign-in codes are used up for today. Ask your manager.',
    SMS_UNAVAILABLE: 'The code could not be sent. Try again in a few minutes.',
    AUTH_RATE_LIMITED: 'Too many attempts. Try again later.',
    INVALID_REQUEST: 'Enter the 6-digit code.',
    CODE_EXPIRED: 'This code has expired. Ask for a new code.',
    CODE_LOCKED: 'Too many wrong tries. Ask for a new code.',
    APP_UPDATE_REQUIRED: 'Update the Hygene Ops app to sign in with your phone number.',
  };
  for (const [code, key] of Object.entries(cases)) {
    assert.deepEqual(staffSignInError({ response: { data: { errors: [{ code }] } } }), { key });
  }
  assert.deepEqual(staffSignInError({ response: { data: { code: 'AUTH_RATE_LIMITED' } } }), {
    key: cases.AUTH_RATE_LIMITED,
  });
  assert.deepEqual(staffSignInError({
    response: { data: { errors: [{ code: 'CODE_RESEND_WAIT', retryAfterSeconds: 42 }] } },
  }), { key: 'Wait {seconds} seconds before asking for a new code.', values: { seconds: 42 }, retryAfterSeconds: 42 });
  assert.deepEqual(staffSignInError({
    response: { data: { errors: [{ code: 'CODE_WRONG', attemptsLeft: 3 }] } },
  }), { key: 'That code is not right. {n} tries left.', values: { n: 3 } });
});

test('a network error survives the request with its original code', async (t) => {
  const networkError = Object.assign(new Error('Network Error'), { code: 'ERR_NETWORK' });
  t.mock.method(client, 'post', async () => { throw networkError; });
  await assert.rejects(requestStaffCode(phone), (error) => (
    typeof error === 'object' && error !== null && 'code' in error
    && error.code === 'ERR_NETWORK' && error === networkError
  ));
});
