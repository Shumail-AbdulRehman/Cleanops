import assert from 'node:assert/strict';
import test from 'node:test';
import { installMocks, setLanguage, render, allText, findPressable, press } from '../support/nativeHarness.mjs';

const React = (await import('react')).default;
const { translate } = await import('../../src/i18n/translations.ts');
const useLanguage = () => {
  const language = globalThis.__nativeHarness.language;
  return { language, isRTL: language === 'ur', t: (text, values) => translate(text, language, values), setLanguage() {} };
};
const nav = { calls: [], listeners: {}, focused: true };
const navigation = {
  navigate: (...args) => nav.calls.push(args),
  addListener: (name, fn) => { nav.listeners[name] = fn; return () => { delete nav.listeners[name]; }; },
  isFocused: () => nav.focused,
};
const refetches = [];
const calls = { tasks: [], attendance: [] };
const range = { earliestMonth: '2026-08', latestMonth: '2026-12' }; // latestMonth is reset to the device month before each test
const scrolls = [];
const ScrollView = React.forwardRef((props, ref) => {
  React.useImperativeHandle(ref, () => ({ scrollTo: arg => scrolls.push(arg) }));
  return React.createElement('ScrollView', props, props.children);
});
installMocks({
  'react-native': { ScrollView },
  '/components/ui/icon': { Icon: props => React.createElement('Icon', props) },
  '@react-native-community/netinfo': { default: { addEventListener: () => () => {} } },
  '/i18n/LanguageProvider': { useLanguage },
  '@react-navigation/native': { useNavigation: () => navigation },
  '@tanstack/react-query': { useQueryClient: () => ({ refetchQueries: async arg => { refetches.push(arg); } }) },
  '/queries/history': {
    useTaskHistory: (staffId, month, filter) => {
      calls.tasks.push({ staffId, month, filter });
      return {
        data: { pages: [{ month, timezone: 'UTC', range, counts: { verified: 1, waiting: 0, missed: 0, total: 1 },
          items: [{ id: 77, areaName: 'Lobby', title: 'Lobby', date: `${month}-05`, shiftStart: `${month}-05T04:00:00.000Z`, shiftEnd: `${month}-05T05:00:00.000Z`,
            timezone: 'UTC', status: 'VERIFIED', reviewState: 'NOT_NEEDED', startedAt: null, submittedAt: null, photos: { received: 0, required: 0 }, location: { id: 1, name: 'HQ' } }],
          nextCursor: null }] },
        isError: false, hasNextPage: false, fetchNextPage() {}, refetch: async () => {}, isFetchingNextPage: false,
      };
    },
    flattenHistoryPages: data => data?.pages.flatMap(page => page.items),
    useAttendanceMonth: (staffId, month) => {
      calls.attendance.push({ staffId, month });
      return { data: { month, timezone: 'UTC', range, counts: { onTime: 0, late: 0, absent: 0 }, records: [] }, isError: false, refetch: async () => {} };
    },
  },
});
const { HistoryScreen } = await import('../../src/screens/history/HistoryScreen.tsx');

const h = React.createElement;
const thisMonth = new Date().toISOString().slice(0, 7);
const monthBefore = month => { const [y, m] = month.split('-').map(Number); const d = new Date(Date.UTC(y, m - 2, 1)); return d.toISOString().slice(0, 7); };
const last = list => list[list.length - 1];

test.beforeEach(() => { range.latestMonth = thisMonth; nav.calls.length = 0; nav.listeners = {}; nav.focused = true; refetches.length = 0; scrolls.length = 0; calls.tasks.length = 0; calls.attendance.length = 0; setLanguage('en'); });

test('Tasks shows by default at the current month, with the title and both switch labels', async () => {
  const r = await render(h(HistoryScreen));
  assert.ok(allText(r).includes('History'));
  assert.ok(allText(r).includes('Lobby'));
  assert.equal(last(calls.tasks).month, thisMonth);
  assert.equal(calls.attendance.length, 0);
  const tabs = r.root.findAll(n => n.type === 'Pressable' && n.props.accessibilityRole === 'tab');
  assert.deepEqual(tabs.map(n => n.props.accessibilityLabel), ['Tasks', 'Attendance']);
  assert.equal(tabs[0].props.accessibilityState.selected, true);
});

test('switching to Attendance shows the calendar view for the same month', async () => {
  const r = await render(h(HistoryScreen));
  await press(findPressable(r, 'Attendance'));
  assert.equal(last(calls.attendance).month, thisMonth);
  assert.ok(!allText(r).includes('Lobby'));
});

test('a month changed in one view carries over to the other and back', async () => {
  const r = await render(h(HistoryScreen));
  const earlier = monthBefore(thisMonth);
  await press(findPressable(r, 'Previous month'));
  assert.equal(last(calls.tasks).month, earlier);
  await press(findPressable(r, 'Attendance'));
  assert.equal(last(calls.attendance).month, earlier);
  await press(findPressable(r, 'Previous month'));
  const earliest = monthBefore(earlier);
  await press(findPressable(r, 'Tasks'));
  assert.equal(last(calls.tasks).month, earliest);
});

test('pressing a task row navigates to HistoryTask with the id and the chosen month', async () => {
  const r = await render(h(HistoryScreen));
  await press(findPressable(r, 'Previous month'));
  const row = r.root.findAll(n => n.type === 'Pressable' && /^Lobby/.test(n.props.accessibilityLabel ?? ''))[0];
  await press(row);
  assert.deepEqual(nav.calls, [['HistoryTask', { taskId: 77, month: monthBefore(thisMonth) }]]);
});

test('pull to refresh refetches the visible view only', async () => {
  const r = await render(h(HistoryScreen));
  const control = () => r.root.findAll(n => n.type === 'ScrollView')[0].props.refreshControl;
  await React.act(async () => { await control().props.onRefresh(); });
  assert.deepEqual(refetches[0].queryKey, ['staff', 2, 'history', 'tasks']);
  await press(findPressable(r, 'Attendance'));
  await React.act(async () => { await control().props.onRefresh(); });
  assert.deepEqual(refetches[1].queryKey, ['staff', 2, 'history', 'attendance']);
  assert.equal(control().props.refreshing, false);
});

test('tapping the tab again scrolls to top only while focused', async () => {
  await render(h(HistoryScreen));
  assert.equal(typeof nav.listeners.tabPress, 'function');
  nav.listeners.tabPress();
  assert.deepEqual(scrolls, [{ y: 0, animated: true }]);
  nav.focused = false;
  nav.listeners.tabPress();
  assert.equal(scrolls.length, 1);
});

test('Urdu translates the title and switch labels and reverses the switch', async () => {
  setLanguage('ur');
  const r = await render(h(HistoryScreen));
  const tabs = r.root.findAll(n => n.type === 'Pressable' && n.props.accessibilityRole === 'tab');
  assert.deepEqual(tabs.map(n => n.props.accessibilityLabel), [translate('Tasks', 'ur'), translate('Attendance', 'ur')]);
  assert.ok(allText(r).includes(translate('History', 'ur')));
  const track = r.root.findAll(n => n.type === 'View' && n.props.accessibilityRole === 'tablist')[0];
  assert.equal([].concat(track.props.style).flat(Infinity).filter(Boolean).pop().flexDirection, 'row-reverse');
});

test('a server latestMonth that differs from the device month is adopted on the first response', async () => {
  range.latestMonth = monthBefore(thisMonth);
  const r = await render(h(HistoryScreen));
  assert.equal(last(calls.tasks).month, monthBefore(thisMonth));
  await press(findPressable(r, 'Attendance'));
  assert.equal(last(calls.attendance).month, monthBefore(thisMonth));
});

test('a month the user already picked is not overridden by the server range', async () => {
  const r = await render(h(HistoryScreen));
  const earlier = monthBefore(thisMonth);
  await press(findPressable(r, 'Previous month'));
  range.latestMonth = monthBefore(earlier);
  await press(findPressable(r, 'Attendance'));
  assert.equal(last(calls.attendance).month, earlier);
});
