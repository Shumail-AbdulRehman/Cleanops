import test from 'node:test';
import assert from 'node:assert/strict';
import { parseAttendanceMonth, parseProfileSummary, parseTaskHistoryPage } from './parse';

const range = { earliestMonth: '2025-12', latestMonth: '2026-11' };

const historyItem = (overrides: Record<string, unknown> = {}) => ({
  id: 41,
  areaName: 'Lobby',
  title: 'Lobby clean',
  date: '2026-11-10',
  shiftStart: '2026-11-10T04:00:00.000Z',
  shiftEnd: '2026-11-10T12:00:00.000Z',
  timezone: 'Asia/Karachi',
  status: 'VERIFIED',
  reviewState: 'NOT_NEEDED',
  startedAt: '2026-11-10T04:05:00.000Z',
  submittedAt: '2026-11-10T05:00:00.000Z',
  photos: { received: 3, required: 3 },
  location: { id: 9, name: 'Head office' },
  ...overrides,
});

const historyBody = (overrides: Record<string, unknown> = {}) => ({
  month: '2026-11',
  timezone: 'Asia/Karachi',
  range,
  counts: { verified: 1, waiting: 1, missed: 1, total: 3 },
  items: [
    historyItem(),
    historyItem({ id: 40, status: 'WAITING_FOR_REVIEW', reviewState: 'OPEN' }),
    historyItem({ id: 39, status: 'MISSED', startedAt: null, submittedAt: null, photos: { received: 0, required: 3 } }),
  ],
  nextCursor: 'opaque-cursor',
  ...overrides,
});

const attendanceRecord = (overrides: Record<string, unknown> = {}) => ({
  id: 7,
  date: '2026-11-10',
  expectedStart: '2026-11-10T04:00:00.000Z',
  expectedEnd: '2026-11-10T12:00:00.000Z',
  checkInTime: '2026-11-10T04:20:00.000Z',
  checkOutTime: '2026-11-10T12:01:00.000Z',
  lateMinutes: 20,
  location: { id: 9, name: 'Head office' },
  state: 'LATE',
  ...overrides,
});

const attendanceBody = (overrides: Record<string, unknown> = {}) => ({
  month: '2026-11',
  timezone: 'Asia/Karachi',
  range,
  counts: { onTime: 1, late: 1, absent: 1, missedCheckout: 0 },
  records: [
    attendanceRecord(),
    attendanceRecord({ id: 6, date: '2026-11-09', lateMinutes: null, state: 'ON_TIME' }),
    attendanceRecord({ id: 5, date: '2026-11-08', checkInTime: null, checkOutTime: null, lateMinutes: null, state: 'ABSENT' }),
  ],
  ...overrides,
});

const profileBody = (overrides: Record<string, unknown> = {}) => ({
  id: 12,
  name: 'Ayesha Khan',
  email: 'ayesha@example.com',
  phone: '+923001234567',
  joinedAt: '2026-01-01T00:00:00.000Z',
  company: { name: 'Clean Co' },
  location: { id: 9, name: 'Head office', address: '1 Mall Road', timezone: 'Asia/Karachi' },
  usualShift: { start: '09:00', end: '17:00' },
  manager: { name: 'Bilal Ahmed' },
  month: { month: '2026-11', shiftsScheduled: 10, shiftsAttended: 9, onTime: 8, tasksAssigned: 30, tasksSubmitted: 28 },
  ...overrides,
});

test('a full task history page parses field for field', () => {
  const body = historyBody();
  const parsed = parseTaskHistoryPage(body);
  assert.deepEqual(parsed, { ...body, dropped: 0 });
});

test('a full attendance month parses field for field', () => {
  const body = attendanceBody();
  assert.deepEqual(parseAttendanceMonth(body), { ...body, dropped: 0 });
});

test('a full profile summary parses field for field', () => {
  const body = profileBody();
  assert.deepEqual(parseProfileSummary(body), body);
});

test('a profile summary keeps valid work days in canonical order', () => {
  const shift = { start: '09:00', end: '17:00' };
  const body = profileBody({ usualShift: { ...shift, days: ['WED', 'MON'] } });
  assert.deepEqual(parseProfileSummary(body)?.usualShift, { ...shift, days: ['MON', 'WED'] });
});

test('a profile summary drops invalid work days and keeps the shift', () => {
  const shift = { start: '09:00', end: '17:00' };
  for (const days of [null, 'MON', [], ['MON', 'MON'], ['MON', 'FUNDAY'], ['MON', 3]]) {
    const body = profileBody({ usualShift: { ...shift, days } });
    assert.deepEqual(parseProfileSummary(body)?.usualShift, shift);
  }
});

test('a body that is not an object returns null', () => {
  for (const hostile of [null, undefined, 'error', 42, [], true]) {
    assert.equal(parseTaskHistoryPage(hostile), null);
    assert.equal(parseAttendanceMonth(hostile), null);
    assert.equal(parseProfileSummary(hostile), null);
  }
});

test('a body missing items, records or month returns null', () => {
  const { items: _items, ...noItems } = historyBody();
  assert.equal(parseTaskHistoryPage(noItems), null);
  assert.equal(parseTaskHistoryPage(historyBody({ items: 'nope' })), null);
  const { month: _month, ...noMonth } = historyBody();
  assert.equal(parseTaskHistoryPage(noMonth), null);

  const { records: _records, ...noRecords } = attendanceBody();
  assert.equal(parseAttendanceMonth(noRecords), null);
  const { month: _attMonth, ...noAttMonth } = attendanceBody();
  assert.equal(parseAttendanceMonth(noAttMonth), null);

  const { month: _profileMonth, ...noProfileMonth } = profileBody();
  assert.equal(parseProfileSummary(noProfileMonth), null);
});

test('an older server 404 body leads to null, not a crash', () => {
  const notFound = { success: false, message: 'Route not found' };
  assert.equal(parseTaskHistoryPage(notFound), null);
  assert.equal(parseAttendanceMonth(notFound), null);
  assert.equal(parseProfileSummary(notFound), null);
});

test('month strings must be YYYY-MM and dates YYYY-MM-DD', () => {
  assert.equal(parseTaskHistoryPage(historyBody({ month: '2026-11-01' })), null);
  assert.equal(parseTaskHistoryPage(historyBody({ month: '2026-13' })), null);
  assert.equal(parseAttendanceMonth(attendanceBody({ month: 'November' })), null);
  assert.equal(parseTaskHistoryPage(historyBody({ range: { earliestMonth: '2026', latestMonth: '2026-11' } })), null);

  const page = parseTaskHistoryPage(historyBody({ items: [historyItem({ date: '10/11/2026' }), historyItem()] }));
  assert.equal(page?.items.length, 1);
  assert.equal(page?.dropped, 1);
  const month = parseAttendanceMonth(attendanceBody({ records: [attendanceRecord({ date: '2026-11-10T00:00:00Z' })] }));
  assert.deepEqual(month?.records, []);
  assert.equal(month?.dropped, 1);
});

test('one malformed task item among three is dropped and counted', () => {
  const body = historyBody({ items: [historyItem(), historyItem({ id: '40' }), historyItem({ id: 39 })] });
  const parsed = parseTaskHistoryPage(body);
  assert.deepEqual(parsed?.items.map((item) => item.id), [41, 39]);
  assert.equal(parsed?.dropped, 1);
});

test('hostile items are dropped without failing the page', () => {
  const body = historyBody({
    items: [null, 'x', [], historyItem({ photos: null }), historyItem({ location: { id: 9 } }), historyItem({ startedAt: 12 }), historyItem()],
  });
  const parsed = parseTaskHistoryPage(body);
  assert.equal(parsed?.items.length, 1);
  assert.equal(parsed?.dropped, 6);
});

test('an unknown task status or review state is dropped, never shown as something else', () => {
  const parsed = parseTaskHistoryPage(historyBody({
    items: [historyItem({ status: 'IN_PROGRESS' }), historyItem({ id: 40, reviewState: 'PENDING' }), historyItem({ id: 39 })],
  }));
  assert.deepEqual(parsed?.items.map((item) => item.id), [39]);
  assert.equal(parsed?.dropped, 2);
});

test('an unknown attendance state is dropped', () => {
  const parsed = parseAttendanceMonth(attendanceBody({
    records: [attendanceRecord({ state: 'HOLIDAY' }), attendanceRecord({ id: 6 }), attendanceRecord({ id: 5, state: 'late' })],
  }));
  assert.deepEqual(parsed?.records.map((record) => record.id), [6]);
  assert.equal(parsed?.dropped, 2);
});

test('nextCursor absent becomes null', () => {
  const { nextCursor: _cursor, ...body } = historyBody();
  const parsed = parseTaskHistoryPage(body);
  assert.notEqual(parsed, null);
  assert.equal(parsed?.nextCursor, null);
  assert.equal(parseTaskHistoryPage(historyBody({ nextCursor: 5 })), null);
});

test('missing optional item fields become null, never undefined', () => {
  const { startedAt: _s, submittedAt: _t, ...task } = historyItem({ status: 'MISSED' });
  const page = parseTaskHistoryPage(historyBody({ items: [task] }));
  assert.equal(page?.items[0]?.startedAt, null);
  assert.equal(page?.items[0]?.submittedAt, null);

  const { checkInTime: _i, checkOutTime: _o, lateMinutes: _l, ...record } = attendanceRecord({ state: 'ABSENT' });
  const month = parseAttendanceMonth(attendanceBody({ records: [record] }));
  assert.equal(month?.records[0]?.checkInTime, null);
  assert.equal(month?.records[0]?.checkOutTime, null);
  assert.equal(month?.records[0]?.lateMinutes, null);
});

test('an attendance record with image fields does not carry them through', () => {
  const parsed = parseAttendanceMonth(attendanceBody({
    records: [attendanceRecord({ checkInImage: 'https://x/in.jpg', checkOutImage: 'https://x/out.jpg' })],
  }));
  const record = parsed?.records[0] as Record<string, unknown>;
  assert.equal(parsed?.dropped, 0);
  assert.equal('checkInImage' in record, false);
  assert.equal('checkOutImage' in record, false);
  assert.deepEqual(record, attendanceRecord());
});

test('unknown task fields such as photo URLs or scores are not carried through', () => {
  const parsed = parseTaskHistoryPage(historyBody({
    extra: 'x',
    items: [historyItem({ photoUrls: ['https://x/a.jpg'], aiScore: 0.9, managerNote: 'note' })],
  }));
  assert.deepEqual(parsed?.items[0], historyItem());
  assert.equal('extra' in (parsed as object), false);
});

test('a profile with no email parses field for field', () => {
  const body = profileBody({ email: null });
  assert.deepEqual(parseProfileSummary(body), body);
});

test('a profile without a manager parses with manager: null', () => {
  const { manager: _manager, ...body } = profileBody();
  const parsed = parseProfileSummary(body);
  assert.notEqual(parsed, null);
  assert.equal(parsed?.manager, null);
  assert.equal(parseProfileSummary(profileBody({ manager: null }))?.manager, null);
});

test('a profile with no location, shift or phone keeps nulls and drops unknown manager fields', () => {
  const parsed = parseProfileSummary(profileBody({
    phone: null,
    location: null,
    usualShift: undefined,
    manager: { name: 'Bilal Ahmed', email: 'b@example.com', phone: '123' },
  }));
  assert.equal(parsed?.phone, null);
  assert.equal(parsed?.location, null);
  assert.equal(parsed?.usualShift, null);
  assert.deepEqual(parsed?.manager, { name: 'Bilal Ahmed' });
});

test('a profile with malformed fields returns null', () => {
  assert.equal(parseProfileSummary(profileBody({ email: 12 })), null);
  assert.equal(parseProfileSummary(profileBody({ company: null })), null);
  assert.equal(parseProfileSummary(profileBody({ usualShift: { start: '9am', end: '17:00' } })), null);
  assert.equal(parseProfileSummary(profileBody({ month: { month: '2026-11', shiftsScheduled: -1 } })), null);
  assert.equal(parseProfileSummary(profileBody({ id: '12' })), null);
});
