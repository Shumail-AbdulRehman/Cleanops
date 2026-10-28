import test from 'node:test';
import assert from 'node:assert/strict';
import { parseStaffProfile, fetchStaffProfile, profileQueryKey, type ProfileHttp } from './profile';

const body = {
  id: 12, name: 'Ayesha Khan', email: 'ayesha@example.com', phone: '+923001234567', role: 'STAFF',
  isActive: true, companyId: 3, locationId: 9, createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-02-01T00:00:00.000Z', shiftStart: '2026-11-11T04:00:00.000Z', shiftEnd: '2026-11-11T12:00:00.000Z',
  extraField: 'ignored',
};

test('a full profile body parses and drops unknown fields', () => {
  const parsed = parseStaffProfile(body);
  const { extraField: _extra, ...expected } = body;
  assert.equal(parsed?.offToday, undefined);
  assert.deepEqual(parsed, expected);
  assert.equal('extraField' in (parsed as object), false);
});

test('the optional work days, day-off flag and shift instant parse', () => {
  const nextShiftStart = '2026-11-11T04:00:00.000Z';
  const parsed = parseStaffProfile({ ...body, workDays: ['WED', 'MON'], offToday: true, nextShiftStart });
  assert.deepEqual(parsed?.workDays, ['MON', 'WED']);
  assert.equal(parsed?.offToday, true);
  assert.equal(parsed?.nextShiftStart, nextShiftStart);
  const withoutNextShift = parseStaffProfile({ ...body, offToday: false, nextShiftStart: null });
  assert.equal(withoutNextShift?.offToday, false);
  assert.equal(withoutNextShift?.nextShiftStart, null);
});

test('invalid optional work-day fields are ignored without discarding the profile', () => {
  for (const workDays of [[], ['NODAY'], ['MON', 'MON'], 'MON']) {
    const parsed = parseStaffProfile({ ...body, workDays, offToday: 'true', nextShiftStart: '2026-02-30T09:00:00Z' });
    assert.deepEqual(parsed, parseStaffProfile(body));
  }
  assert.equal(parseStaffProfile({ ...body, nextShiftStart: '2026-11-11' })?.nextShiftStart, undefined);
});

test('nullable fields keep null', () => {
  const parsed = parseStaffProfile({ ...body, phone: null, locationId: null, shiftStart: null, shiftEnd: null });
  assert.equal(parsed?.phone, null);
  assert.equal(parsed?.locationId, null);
  assert.equal(parsed?.shiftStart, null);
  assert.equal(parsed?.shiftEnd, null);
});

test('a body missing name, or with a wrong type, returns null', () => {
  const { name: _name, ...withoutName } = body;
  assert.equal(parseStaffProfile(withoutName), null);
  assert.equal(parseStaffProfile({ ...body, id: '12' }), null);
  assert.equal(parseStaffProfile({ ...body, phone: 5 }), null);
  assert.equal(parseStaffProfile(null), null);
  assert.equal(parseStaffProfile('profile'), null);
  assert.equal(parseStaffProfile([body]), null);
});

test('the fetcher calls the profile path once with the abort signal and parses the envelope', async () => {
  const calls: Array<{ url: string; signal?: AbortSignal }> = [];
  const http: ProfileHttp = {
    get: async (url, config) => {
      calls.push({ url, signal: config?.signal });
      return { data: { success: true, message: 'ok', data: body } };
    },
  };
  const controller = new AbortController();
  const profile = await fetchStaffProfile(http, controller.signal);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, '/staff/profile/me');
  assert.equal(calls[0].signal, controller.signal);
  assert.equal(profile?.name, 'Ayesha Khan');
});

test('the fetcher returns null for a malformed envelope', async () => {
  const http: ProfileHttp = { get: async () => ({ data: { success: true, data: { id: 1 } } }) };
  assert.equal(await fetchStaffProfile(http), null);
});

test('the query key includes the staff id', () => {
  assert.deepEqual(profileQueryKey(12), ['staff', 12, 'profile']);
  assert.deepEqual(profileQueryKey(undefined), ['staff', undefined, 'profile']);
});
