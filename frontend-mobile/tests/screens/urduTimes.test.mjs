import assert from 'node:assert/strict';
import test from 'node:test';
import { installMocks, setLanguage, render, allText, findPressable, press } from '../support/nativeHarness.mjs';

const React = (await import('react')).default;
const { translate } = await import('../../src/i18n/translations.ts');
// The shared harness t() drops placeholder values; the real provider fills them.
const useLanguage = () => {
  const language = globalThis.__nativeHarness.language;
  return { language, isRTL: language === 'ur', t: (text, values) => translate(text, language, values), setLanguage() {} };
};
const state = { cached: [], month: null };
installMocks({
  '/components/ui/icon': { Icon: props => React.createElement('Icon', props) },
  '@react-native-community/netinfo': { default: { addEventListener: () => () => {} } },
  'react-native-svg': { __esModule: true, default: 'Svg', Svg: 'Svg', Path: 'Path', Ellipse: 'Ellipse' },
  'react-native-reanimated': { useReducedMotion: () => false, useAnimatedProps: factory => factory() },
  '/i18n/LanguageProvider': { useLanguage },
  '@react-navigation/native': { useRoute: () => ({ params: { taskId: 1, month: '2026-11' } }) },
  '@tanstack/react-query': { useQueryClient: () => ({ getQueriesData: () => state.cached }) },
  '/queries/history': {
    historyKeys: { tasks: (id, month, filter) => ['staff', id, 'history', 'tasks', month, filter] },
    flattenHistoryPages: data => data?.pages.flatMap(page => page.items),
    useTaskHistory: () => ({ data: undefined, isError: false, refetch: async () => {} }),
    useAttendanceMonth: () => ({ refetch: async () => {}, ...state.month }),
  },
});
const { HistoryTaskScreen } = await import('../../src/screens/history/HistoryTaskScreen.tsx');
const { AttendanceHistoryView } = await import('../../src/screens/history/AttendanceHistoryView.tsx');
const { AttendanceReceipt } = await import('../../src/screens/day/AttendanceReceipt.tsx');
const { SubmissionReceipt } = await import('../../src/screens/verification/SubmissionReceipt.tsx');

const h = React.createElement;
const iso = (hh, mm = 0) => `2026-11-03T${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:00.000Z`;
const wrap = value => `⁨${value}⁩`;

test.afterEach(() => setLanguage('en'));

test('Urdu: finished-task Scheduled, Started and Submitted values are isolated', async () => {
  setLanguage('ur');
  state.cached = [[['k'], { pages: [{ items: [{
    id: 1, areaName: 'Area 1', title: 'Clean area 1', date: '2026-11-03', shiftStart: iso(11), shiftEnd: iso(12), timezone: 'UTC',
    status: 'VERIFIED', reviewState: 'CLOSED', startedAt: iso(11, 2), submittedAt: iso(11, 40), photos: { received: 4, required: 4 }, location: { id: 1, name: 'HQ' },
  }] }] }]];
  const r = await render(h(HistoryTaskScreen));
  const text = allText(r);
  for (const value of ['11:00 AM – 12:00 PM', '11:02 AM', '11:40 AM']) assert.ok(text.includes(wrap(value)), value);
});

test('Urdu: attendance day-sheet In, Out and Shift values are isolated', async () => {
  setLanguage('ur');
  const location = { id: 1, name: 'Gulberg Plaza' };
  const records = [{ id: 1, date: '2026-11-04', expectedStart: '2026-11-04T09:00:00.000Z', expectedEnd: '2026-11-04T17:00:00.000Z',
    checkInTime: '2026-11-04T09:21:00.000Z', checkOutTime: '2026-11-04T17:02:00.000Z', lateMinutes: 21, location, state: 'LATE' }];
  state.month = { isError: false, data: { month: '2026-11', timezone: 'UTC', range: { earliestMonth: '2026-09', latestMonth: '2026-11' },
    counts: { onTime: 0, late: 1, absent: 0, missedCheckout: 0 }, records } };
  const r = await render(h(AttendanceHistoryView, { staffId: 5, month: '2026-11', onMonthChange() {} }));
  await press(r.root.findAll(n => n.type === 'Pressable' && (n.props.accessibilityLabel ?? '').includes('4')).find(n => /9:21/.test(n.props.accessibilityLabel)));
  const text = allText(r);
  for (const value of ['9:21 AM', '5:02 PM', '9:00 AM – 5:00 PM']) assert.ok(text.includes(wrap(value)), value);
});

test('Urdu: the check-out receipt subtitle is isolated', async () => {
  setLanguage('ur');
  const record = { id: 9, date: '2026-11-11T00:00:00.000Z', status: 'CHECKED_OUT', expectedStart: '2026-11-11T09:00:00.000Z', expectedEnd: '2026-11-11T17:00:00.000Z',
    checkInTime: '2026-11-11T09:12:00.000Z', checkOutTime: '2026-11-11T17:16:00.000Z', location: { id: 7, name: 'Gulberg Plaza' } };
  const r = await render(h(AttendanceReceipt, { record, result: { mode: 'check-out', at: record.checkOutTime, late: false }, tasksSubmitted: 3, tasksTotal: 4, place: 'Gulberg Plaza', timeZone: 'UTC', onDone: () => {} }));
  assert.ok(allText(r).includes(wrap('5:16 PM')));
});

test('Urdu: the Work submitted subtitle isolates the time', async () => {
  setLanguage('ur');
  const r = await render(h(SubmissionReceipt, { taskId: 42, areaName: 'Toilet', submittedAt: '2026-11-11T10:41:00.000Z', timeZone: 'UTC', photosReceived: 3, photosRequired: 4, hasNextTask: false, onNext() {}, onDone() {} }));
  assert.ok(allText(r).includes(wrap('10:41 AM')));
});
