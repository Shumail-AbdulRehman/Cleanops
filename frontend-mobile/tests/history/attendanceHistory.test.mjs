import assert from 'node:assert/strict';
import test from 'node:test';
import { installMocks, setLanguage, setWindowSize, render, allText, findPressable, press } from '../support/nativeHarness.mjs';

const React = (await import('react')).default;
const { translate } = await import('../../src/i18n/translations.ts');
// The harness t() drops placeholder values; stand in the real translate like todayWork.test.mjs does.
const useLanguage = () => {
  const language = globalThis.__nativeHarness.language;
  return { language, isRTL: language === 'ur', t: (text, values) => translate(text, language, values), setLanguage() {} };
};
const state = { calls: [], result: null, refetch: 0 };
installMocks({
  '/components/ui/icon': { Icon: props => React.createElement('Icon', props) },
  '@react-native-community/netinfo': { default: { addEventListener: () => () => {} } },
  '/i18n/LanguageProvider': { useLanguage },
  '/queries/history': {
    useAttendanceMonth: (staffId, month) => {
      state.calls.push({ staffId, month });
      return { refetch: async () => { state.refetch += 1; }, ...state.result };
    },
  },
});
const { StyleSheet } = await import('react-native');
const { AttendanceHistoryView } = await import('../../src/screens/history/AttendanceHistoryView.tsx');
const { AttendanceCalendar } = await import('../../src/screens/history/AttendanceCalendar.tsx');
const { colors } = await import('../../src/design/tokens.ts');
const { Pill } = await import('../../src/design/Pill.tsx');

const h = React.createElement;
const styleOf = node => StyleSheet.flatten(node.props.style) ?? {};
const range = { earliestMonth: '2026-09', latestMonth: '2026-11' };
const location = { id: 1, name: 'Gulberg Plaza' };
const rec = (id, day, st, extra = {}) => {
  const date = `2026-11-${String(day).padStart(2, '0')}`;
  return { id, date, expectedStart: `${date}T09:00:00.000Z`, expectedEnd: `${date}T17:00:00.000Z`, checkInTime: `${date}T09:00:00.000Z`, checkOutTime: `${date}T17:02:00.000Z`, lateMinutes: null, location, state: st, ...extra };
};
const records = [
  rec(1, 2, 'ON_TIME'),
  rec(2, 4, 'LATE', { checkInTime: '2026-11-04T09:21:00.000Z', lateMinutes: 21 }),
  rec(3, 5, 'ABSENT', { checkInTime: null, checkOutTime: null }),
  rec(4, 6, 'MISSED_CHECKOUT', { checkOutTime: null }),
  rec(5, 7, 'ON_SHIFT', { checkOutTime: null }),
];
const ready = (recs = records, extra = {}) => {
  state.result = { isError: false, data: { month: '2026-11', timezone: 'UTC', range, counts: { onTime: 1, late: 1, absent: 1, missedCheckout: 1 }, records: recs, ...extra } };
};
const base = { staffId: 5, month: '2026-11', onMonthChange() {} };
const cellOf = (r, label) => r.root.findAll(n => n.type === 'View' && n.props.accessibilityLabel === label)[0];
const rows = r => r.root.findAll(n => n.type === 'Pressable' && /, (On time|Late|Absent|Missed check-out|On shift)$/.test(n.props.accessibilityLabel ?? '') || (n.type === 'Pressable' && /(شفٹ|وقت)/.test(n.props.accessibilityLabel ?? '')));

test.beforeEach(() => { state.calls.length = 0; state.refetch = 0; setLanguage('en'); setWindowSize(390, 844); });
test.afterEach(() => { setLanguage('en'); setWindowSize(390, 844); });

test('November 2026 starts on Sunday: six leading empty cells, then 30 days', async () => {
  const r = await render(h(AttendanceCalendar, { month: '2026-11', records, todayYmd: '2026-11-07', width: 390 }));
  const numbered = r.root.findAll(n => n.type === 'View' && /^\d+ November/.test(n.props.accessibilityLabel ?? ''));
  assert.equal(numbered.length, 30);
  const week = numbered[0].parent;
  assert.equal(week.children.length, 7);
  const empties = week.children.filter(c => c.children.length === 0);
  assert.equal(empties.length, 6);
  assert.equal(week.children.indexOf(numbered[0]), 6);
});

test('a late day uses the late token, no cell uses yellow, other states follow the design', async () => {
  const r = await render(h(AttendanceCalendar, { month: '2026-11', records, todayYmd: '2026-11-09', width: 390 }));
  const late = cellOf(r, '4 November, Late');
  assert.equal(styleOf(late).backgroundColor, colors.late);
  assert.equal(styleOf(cellOf(r, '2 November, On time')).backgroundColor, colors.blueWash);
  assert.equal(styleOf(cellOf(r, '7 November, On shift')).backgroundColor, colors.blueWash);
  const absent = styleOf(cellOf(r, '5 November, Absent'));
  assert.deepEqual([absent.backgroundColor, absent.borderColor, absent.borderWidth], [colors.badWash, colors.bad, 1.5]);
  const missed = styleOf(cellOf(r, '6 November, Missed check-out'));
  assert.deepEqual([missed.backgroundColor, missed.borderColor], [colors.warnWash, colors.warn]);
  assert.equal(styleOf(cellOf(r, '9 November')).backgroundColor, colors.blue); // today
  const yellows = [colors.yellow, colors.yellowPress, colors.yellowWash];
  const cells = r.root.findAll(n => n.type === 'View' && /^\d+ November/.test(n.props.accessibilityLabel ?? ''));
  assert.ok(cells.every(c => !yellows.includes(styleOf(c).backgroundColor)));
});

test('legend shows four counts in words', async () => {
  ready();
  const r = await render(h(AttendanceHistoryView, base));
  const text = allText(r);
  for (const word of ['On time', 'Late', 'Absent', 'Missed check-out']) assert.ok(text.includes(word));
  const legend = r.root.findAll(n => n.type === 'View' && /^(On time|Late|Absent|Missed check-out) 1$/.test(n.props.accessibilityLabel ?? ''));
  assert.equal(legend.length, 4);
  assert.equal(state.calls.at(-1).month, '2026-11');
});

test('records are newest first with in – out times and the right pill tones', async () => {
  ready();
  const r = await render(h(AttendanceHistoryView, base));
  const labels = rows(r).map(n => n.props.accessibilityLabel);
  assert.equal(labels.length, 5);
  assert.ok(labels[0].includes('7 Nov') && labels[0].endsWith('On shift') && labels[0].includes('9:00 AM') && !labels[0].includes('–'));
  assert.ok(labels[3].includes('4 Nov') && labels[3].includes('9:21 AM – 5:02 PM') && labels[3].endsWith('Late'));
  assert.ok(labels[2].endsWith('Absent') && !labels[2].includes('AM'));
  assert.ok(rows(r).every(n => StyleSheet.flatten(n.props.style).height === 68));
  const tones = r.root.findAllByType(Pill).map(p => [p.props.label, p.props.tone]);
  assert.deepEqual(tones, [['On shift', 'blue'], ['Missed check-out', 'warn'], ['Absent', 'red'], ['Late', 'late'], ['On time', 'green']]);
});

test('pressing a late record opens the sheet with Late by 21 min and its times', async () => {
  ready();
  const r = await render(h(AttendanceHistoryView, base));
  assert.ok(!allText(r).includes('Late by'));
  await press(rows(r).find(n => n.props.accessibilityLabel.includes('4 Nov')));
  const text = allText(r);
  assert.ok(text.includes('Late by 21 min'));
  assert.ok(text.includes('Wednesday, 4 Nov'));
  for (const word of ['In', 'Out', 'Shift', 'Location']) assert.ok(text.includes(word));
  assert.ok(text.includes('9:21 AM') && text.includes('5:00 PM') && text.includes('9:00 AM – 5:00 PM') && text.includes('Gulberg Plaza'));
  await press(findPressable(r, 'Close'));
  assert.ok(!allText(r).includes('Late by 21 min'));
});

test('an on-shift record shows Still on shift and the state pill', async () => {
  ready();
  const r = await render(h(AttendanceHistoryView, base));
  await press(rows(r).find(n => n.props.accessibilityLabel.includes('7 Nov')));
  const text = allText(r);
  assert.ok(text.includes('Still on shift'));
  assert.ok(r.root.findAllByType(Pill).some(p => p.props.label === 'On shift' && p.props.tone === 'blue'));
  assert.ok(!text.includes('Late by'));
});

test('no rendered element receives an image source', async () => {
  ready();
  const r = await render(h(AttendanceHistoryView, base));
  await press(rows(r)[0]);
  const bad = r.root.findAll(n => n.type === 'Image' || n.props.source !== undefined || n.props.uri !== undefined || n.props.imageUrl !== undefined);
  assert.equal(bad.length, 0);
});

test('month arrows follow the range and call onMonthChange', async () => {
  ready();
  let changed = null;
  const r = await render(h(AttendanceHistoryView, { ...base, onMonthChange: m => { changed = m; } }));
  assert.equal(findPressable(r, 'Next month'), undefined);
  await press(findPressable(r, 'Previous month'));
  assert.equal(changed, '2026-10');
});

test('loading, empty and error states', async () => {
  state.result = { data: undefined, isError: false };
  const loading = await render(h(AttendanceHistoryView, base));
  assert.ok(allText(loading).includes('November 2026'));
  assert.equal(rows(loading).length, 0);
  ready([], { counts: { onTime: 0, late: 0, absent: 0, missedCheckout: 0 } });
  const empty = await render(h(AttendanceHistoryView, base));
  assert.ok(allText(empty).includes('No shifts this month.'));
  state.result = { data: undefined, isError: true };
  const error = await render(h(AttendanceHistoryView, base));
  await press(findPressable(error, 'Try again'));
  assert.equal(state.refetch, 1);
});

test('Urdu: day names render, rows run right to left, and every name has room at 360', async () => {
  setLanguage('ur');
  setWindowSize(360, 700);
  ready();
  const r = await render(h(AttendanceHistoryView, base));
  const text = allText(r);
  for (const name of ['پیر', 'منگل', 'بدھ', 'جمعرات', 'جمعہ', 'ہفتہ', 'اتوار']) assert.ok(text.includes(name), name);
  const head = r.root.findAll(n => n.type === 'View' && n.props.accessibilityElementsHidden && styleOf(n).flexDirection === 'row-reverse')[0];
  assert.ok(head);
  const cellWidth = styleOf(head.children[0]).width;
  assert.equal(cellWidth, Math.floor((360 - 16 - 18) / 7));
  const names = r.root.findAll(n => n.type === 'Text' && n.props.numberOfLines === 1 && styleOf(n).fontSize === 13);
  assert.equal(names.length, 7); // narrow Urdu size 13 below 375 wide
  // Names may be wider than their column (spec 58): the label area is at least 58 wide, so "جمعرات" is never cut.
  assert.ok(head.children.every(column => styleOf(column.children[0]).width >= 58));
  assert.ok(findPressable(r, 'پچھلا مہینہ'));
  assert.ok(rows(r).every(n => StyleSheet.flatten(n.props.style).flexDirection === 'row-reverse'));
  assert.ok(allText(r).includes('وقت پر'));
});

test('onRange is called with the server range once, not again on re-render', async () => {
  ready();
  const seen = [];
  const props = { ...base, onRange: x => seen.push(x) };
  const r = await render(h(AttendanceHistoryView, props));
  assert.deepEqual(seen, [range]);
  await press(rows(r)[0]); // re-render with the same range
  assert.equal(seen.length, 1);
});
