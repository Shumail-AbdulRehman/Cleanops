import test from 'node:test';
import assert from 'node:assert/strict';
import {
  fetchAttendanceMonth, fetchProfileSummary, fetchTaskHistory, flattenHistoryPages, historyKeys, shouldRetry,
  HISTORY_UNAVAILABLE_MESSAGE, type HistoryHttp,
} from './history';

const range = { earliestMonth: '2026-01', latestMonth: '2026-11' };
const location = { id: 9, name: 'Main Branch' };
const taskItem = {
  id: 1, areaName: 'Kitchen', title: 'Wipe counters', date: '2026-11-10', shiftStart: '2026-11-10T04:00:00.000Z',
  shiftEnd: '2026-11-10T12:00:00.000Z', timezone: 'Asia/Karachi', status: 'SUBMITTED', reviewState: 'NOT_NEEDED',
  startedAt: null, submittedAt: null, photos: { received: 1, required: 2 }, location,
};
const taskBody = {
  month: '2026-11', timezone: 'Asia/Karachi', range, counts: { verified: 1, waiting: 0, missed: 0, total: 1 },
  items: [taskItem], nextCursor: 'c2',
};
const attendanceBody = {
  month: '2026-11', timezone: 'Asia/Karachi', range, counts: { onTime: 1, late: 0, absent: 0, missedCheckout: 0 },
  records: [{ id: 5, date: '2026-11-10', expectedStart: '2026-11-10T04:00:00.000Z', expectedEnd: '2026-11-10T12:00:00.000Z',
    checkInTime: '2026-11-10T04:00:00.000Z', checkOutTime: null, lateMinutes: 0, location, state: 'ON_TIME' }],
};
const profileBody = {
  id: 1, name: 'Ayesha', email: 'a@example.com', phone: null, joinedAt: '2026-01-01T00:00:00.000Z', company: { name: 'Acme' },
  location: { id: 9, name: 'Main Branch', address: '1 Road', timezone: 'Asia/Karachi' }, usualShift: { start: '09:00', end: '17:00' },
  manager: null,
  month: { month: '2026-11', shiftsScheduled: 10, shiftsAttended: 9, onTime: 8, tasksAssigned: 20, tasksSubmitted: 18 },
};

function stub(data: unknown) {
  const calls: Array<{ url: string; config: unknown }> = [];
  const http: HistoryHttp = { get: async (url, config) => { calls.push({ url, config }); return { data: { data } }; } };
  return { http, calls };
}
const failing = (status: number): HistoryHttp => ({ get: async () => { throw { response: { status } }; } });

test('fetchTaskHistory calls its path with only the given params', async () => {
  const full = stub(taskBody);
  const page = await fetchTaskHistory(full.http, { month: '2026-11', filter: 'waiting', cursor: 'c1' });
  assert.equal(full.calls[0].url, '/staff/mobile/history');
  assert.deepEqual((full.calls[0].config as { params: unknown }).params, { month: '2026-11', filter: 'waiting', cursor: 'c1' });
  assert.equal(page.items.length, 1);
  assert.equal(page.nextCursor, 'c2');
  const bare = stub(taskBody);
  await fetchTaskHistory(bare.http, { month: '2026-11', cursor: null });
  assert.deepEqual((bare.calls[0].config as { params: unknown }).params, { month: '2026-11' });
});

test('fetchAttendanceMonth and fetchProfileSummary call their exact paths', async () => {
  const a = stub(attendanceBody);
  assert.equal((await fetchAttendanceMonth(a.http, '2026-11')).records.length, 1);
  assert.equal(a.calls[0].url, '/staff/mobile/attendance/month');
  assert.deepEqual((a.calls[0].config as { params: unknown }).params, { month: '2026-11' });
  const none = stub(attendanceBody);
  await fetchAttendanceMonth(none.http);
  assert.deepEqual((none.calls[0].config as { params: unknown }).params, {});
  const p = stub(profileBody);
  assert.equal((await fetchProfileSummary(p.http)).name, 'Ayesha');
  assert.equal(p.calls[0].url, '/staff/mobile/profile');
  assert.deepEqual((p.calls[0].config as { params: unknown }).params, {});
});

test('an unparseable body throws the history unavailable message', async () => {
  assert.equal(HISTORY_UNAVAILABLE_MESSAGE, 'History is unavailable. Try again.');
  for (const run of [
    () => fetchTaskHistory(stub({ nope: true }).http, { month: '2026-11' }),
    () => fetchAttendanceMonth(stub(null).http, '2026-11'),
    () => fetchProfileSummary(stub('x').http),
  ]) await assert.rejects(run, { message: 'History is unavailable. Try again.' });
});

test('a 404 maps to the same error and is never retried', async () => {
  await assert.rejects(() => fetchProfileSummary(failing(404)), (error: Error) => {
    assert.equal(error.message, 'History is unavailable. Try again.');
    assert.equal(shouldRetry(0, error), false);
    return true;
  });
  assert.equal(shouldRetry(0, { response: { status: 404 } }), false);
});

test('shouldRetry retries a network error once and then stops', async () => {
  const network = new Error('Network Error');
  assert.equal(shouldRetry(0, network), true);
  assert.equal(shouldRetry(1, network), false);
  await assert.rejects(() => fetchTaskHistory(failing(500), { month: '2026-11' }), (e: unknown) => (e as { response: { status: number } }).response.status === 500);
});

test('keys include staff id, month and filter', () => {
  assert.deepEqual(historyKeys.tasks(3, '2026-11', 'missed').slice(0, 2), ['staff', 3]);
  assert.ok(historyKeys.tasks(3, '2026-11', 'missed').includes('2026-11'));
  assert.ok(historyKeys.tasks(3, '2026-11', 'missed').includes('missed'));
  assert.notDeepEqual(historyKeys.tasks(3, '2026-11', 'all'), historyKeys.tasks(3, '2026-11', 'missed'));
  assert.notDeepEqual(historyKeys.tasks(3, '2026-10', 'all'), historyKeys.tasks(3, '2026-11', 'all'));
  assert.notDeepEqual(historyKeys.tasks(4, '2026-11', 'all'), historyKeys.tasks(3, '2026-11', 'all'));
  assert.deepEqual(historyKeys.attendance(3, '2026-11').slice(0, 2), ['staff', 3]);
  assert.ok(historyKeys.attendance(3, '2026-11').includes('2026-11'));
  assert.deepEqual(historyKeys.profile(3).slice(0, 2), ['staff', 3]);
});

test('flattenHistoryPages dedupes by id', async () => {
  const page = await fetchTaskHistory(stub(taskBody).http, { month: '2026-11' });
  const data = { pages: [page, page], pageParams: [null, 'c2'] };
  assert.equal(flattenHistoryPages(data)?.length, 1);
  assert.equal(flattenHistoryPages(undefined), undefined);
});
