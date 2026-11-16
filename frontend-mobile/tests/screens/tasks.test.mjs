import assert from 'node:assert/strict';
import test from 'node:test';
import { installMocks, setLanguage, render, allText, findPressable, press, navigationCalls, resetCalls } from '../support/nativeHarness.mjs';

const React = (await import('react')).default;
const { translate } = await import('../../src/i18n/translations.ts');
// The shared harness t() drops placeholder values; the real translate fills them.
const useLanguage = () => {
  const language = globalThis.__nativeHarness.language;
  return { language, isRTL: language === 'ur', t: (text, values) => translate(text, language, values), setLanguage() {} };
};
const state = { tasks: [], attendance: [], counts: undefined, isPending: false, isError: false, hasNextPage: false, isFetchingNextPage: false, refetchResult: {}, online: true, fetchNext: 0, refetches: 0 };
installMocks({
  '/components/ui/icon': { Icon: props => React.createElement('Icon', props) },
  '@react-native-community/netinfo': { default: { addEventListener: cb => { cb({ isConnected: state.online, isInternetReachable: state.online }); return () => {}; } } },
  '/i18n/LanguageProvider': { useLanguage },
  '/queries/staff': {
    useMyAttendanceQuery: () => ({ data: state.attendance }),
    useTodaysTasksQuery: () => ({
      data: state.isPending ? undefined : state.tasks, counts: state.counts, isPending: state.isPending, isError: state.isError,
      isRefetching: false, hasNextPage: state.hasNextPage, isFetchingNextPage: state.isFetchingNextPage, isFetching: false,
      refetch: async () => { state.refetches += 1; return state.refetchResult; }, fetchNextPage: async () => { state.fetchNext += 1; },
    }),
  },
});
const { TasksScreen } = await import('../../src/screens/TasksScreen.tsx');
const { SnackbarProvider } = await import('../../src/design/Feedback.tsx');
const { colors } = await import('../../src/design/tokens.ts');
const { StyleSheet } = await import('react-native');
const h = React.createElement;

// The screen schedules a long check-out timer; unref it so unmounted-less tests do not hold the process open.
{ const real = globalThis.setTimeout; globalThis.setTimeout = (fn, ms, ...a) => { const id = real(fn, ms, ...a); if (ms >= 60000) id.unref?.(); return id; }; }

const reset = () => {
  Object.assign(state, { tasks: [], attendance: [], counts: undefined, isPending: false, isError: false, hasNextPage: false, isFetchingNextPage: false, refetchResult: {}, online: true, fetchNext: 0, refetches: 0 });
  resetCalls(); setLanguage('en');
};
test.beforeEach(reset);

const task = (id, hour, extra = {}) => ({
  id, title: `Area ${id}`, areaNameSnapshot: `Area ${id}`, status: 'PENDING', date: '2026-11-11',
  shiftStart: `2026-11-11T${String(hour).padStart(2, '0')}:00:00.000Z`, shiftEnd: `2026-11-11T${String(hour + 1).padStart(2, '0')}:00:00.000Z`,
  startedAt: null, completedAt: null, proofImageUrls: [], location: { id: 1, name: 'HQ', timezone: 'UTC' }, ...extra,
});
const DAY = 86400000;
const open = (extra = {}) => ({ id: 1, date: new Date().toISOString(), status: 'CHECKED_IN', expectedStart: new Date(Date.now() - 3600000).toISOString(), expectedEnd: new Date(Date.now() + 4 * 3600000).toISOString(), checkInTime: new Date(Date.now() - 3000000).toISOString(), checkOutTime: null, ...extra });
const rowLabels = r => r.root.findAll(n => n.type === 'Pressable' && /^Area \d/.test(n.props.accessibilityLabel ?? '')).map(n => n.props.accessibilityLabel.split(',')[0]);
const screen = () => h(SnackbarProvider, null, h(TasksScreen));
const lastOptions = () => navigationCalls().filter(c => c.name === 'setOptions').at(-1).args[0];

test('a retake and a not-started task land under "Needs you" and "To do"; the title counts submissions', async () => {
  state.attendance = [open()];
  state.tasks = [task(1, 9), task(2, 8, { verificationState: 'REWORK_REQUIRED' }), task(3, 7, { status: 'COMPLETED', completionOutcome: 'SUBMITTED' })];
  const r = await render(screen());
  const text = allText(r);
  assert.ok(text.indexOf('Needs you') < text.indexOf('To do') && text.indexOf('To do') < text.indexOf('Done today'));
  assert.ok(text.includes("Today's work") && text.includes('1 of 3 submitted'));
  assert.deepEqual(rowLabels(r), ['Area 2', 'Area 1', 'Area 3']);
});

test('pressing a row opens the task detail with its id', async () => {
  state.attendance = [open()];
  state.tasks = [task(7, 9)];
  const r = await render(screen());
  await press(r.root.findAll(n => n.type === 'Pressable' && n.props.accessibilityLabel?.startsWith('Area 7'))[0]);
  assert.deepEqual(navigationCalls().filter(c => c.name === 'navigate').at(-1).args, ['TaskDetail', { taskId: 7 }]);
});

test('before check-in the reminder and a "Check in" dock show; the dock opens My day', async () => {
  state.attendance = [open({ status: 'ABSENT', checkInTime: null, expectedStart: new Date(Date.now() - 600000).toISOString() })];
  state.tasks = [task(1, 9)];
  const r = await render(screen());
  assert.ok(allText(r).includes('Check in before starting a task.'));
  await press(findPressable(r, 'Check in'));
  assert.deepEqual(navigationCalls().filter(c => c.name === 'navigate').at(-1).args, ['Shift']);
});

test('check-in not open yet: reminder but no dock', async () => {
  state.attendance = [open({ status: 'ABSENT', checkInTime: null, expectedStart: new Date(Date.now() + 5 * 3600000).toISOString(), expectedEnd: new Date(Date.now() + 9 * 3600000).toISOString() })];
  state.tasks = [task(1, 9)];
  const r = await render(screen());
  assert.ok(allText(r).includes('Check in before starting a task.'));
  assert.equal(findPressable(r, 'Check in'), undefined);
});

test('checked in before check-out time: no reminder and no dock', async () => {
  state.attendance = [open()];
  state.tasks = [task(1, 9)];
  const r = await render(screen());
  assert.ok(!allText(r).includes('Check in before'));
  assert.equal(findPressable(r, 'Check out'), undefined);
  assert.equal(findPressable(r, 'Check in'), undefined);
});

test('check-out time has come: "Check out" dock opens My day; a missed check-out says "Complete check-out"', async () => {
  state.attendance = [open({ expectedEnd: new Date(Date.now() - 60000).toISOString(), checkInTime: new Date(Date.now() - 4 * 3600000).toISOString() })];
  state.tasks = [task(1, 9)];
  let r = await render(screen());
  await press(findPressable(r, 'Check out'));
  assert.deepEqual(navigationCalls().filter(c => c.name === 'navigate').at(-1).args, ['Shift']);
  state.attendance = [open({ status: 'MISSED_CHECKOUT', expectedEnd: new Date(Date.now() - DAY).toISOString(), checkInTime: new Date(Date.now() - DAY - 3600000).toISOString() })];
  r = await render(screen());
  assert.ok(findPressable(r, 'Complete check-out'));
});

test('the "Check out" dock appears when the time arrives, with no other change, and unmounting clears the timer', async (ctx) => {
  ctx.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: Date.now() });
  const end = Date.now() + 10 * 60000;
  state.attendance = [open({ expectedEnd: new Date(end).toISOString(), checkInTime: new Date(Date.now() - 4 * 3600000).toISOString() })];
  state.tasks = [task(1, 9)];
  const r = await render(screen());
  assert.equal(findPressable(r, 'Check out'), undefined);
  const { act } = await import('react-test-renderer');
  await act(async () => { ctx.mock.timers.tick(9 * 60000); });
  assert.equal(findPressable(r, 'Check out'), undefined);
  await act(async () => { ctx.mock.timers.tick(2 * 60000); });
  assert.ok(findPressable(r, 'Check out'));
  // A second screen unmounted before the time never fires its timer.
  const again = await render(screen());
  await act(async () => { again.unmount(); });
  await act(async () => { ctx.mock.timers.tick(60000); });
});

test('an empty feed shows the empty state', async () => {
  state.attendance = [open()];
  const r = await render(screen());
  assert.ok(allText(r).includes('No tasks today'));
  assert.ok(allText(r).includes('Your manager has not given you work for today.'));
});

test('an error shows retry and retry refetches', async () => {
  state.isError = true; state.attendance = [open()];
  const r = await render(screen());
  await press(findPressable(r, 'Try again'));
  assert.equal(state.refetches, 1);
});

test('offline and never loaded: reconnect message and the offline banner', async () => {
  state.online = false; state.tasks = undefined; state.attendance = [open()];
  state.isPending = false;
  const r = await render(screen());
  const text = allText(r);
  assert.ok(text.includes('Today has not loaded yet. Reconnect and refresh.'));
  assert.ok(text.includes('Internet needed to continue'));
});

test('loading shows skeletons, not the empty state', async () => {
  state.isPending = true;
  const r = await render(screen());
  assert.ok(!allText(r).includes('No tasks today'));
  assert.ok(r.root.findAll(n => n.type === 'View' && n.props.importantForAccessibility === 'no-hide-descendants').length >= 10);
});

test('the Tasks screen no longer sets the tab badge (StaffTabs owns it, spec 61)', async () => {
  state.attendance = [open()];
  state.tasks = [task(1, 9, { verificationState: 'REWORK_REQUIRED' }), task(2, 10)];
  await render(screen());
  const calls = navigationCalls().filter(c => c.name === 'setOptions');
  assert.ok(calls.every(c => !('tabBarBadge' in (c.args[0] ?? {})) && !('tabBarBadgeStyle' in (c.args[0] ?? {}))));
});

test('"Load more tasks" calls fetchNextPage, shows busy text while fetching, and is hidden offline', async () => {
  state.attendance = [open()]; state.tasks = [task(1, 9)]; state.hasNextPage = true;
  let r = await render(screen());
  await press(findPressable(r, 'Load more tasks'));
  assert.equal(state.fetchNext, 1);
  state.isFetchingNextPage = true;
  r = await render(screen());
  assert.equal(findPressable(r, 'Loading tasks…').props.accessibilityState.busy, true);
  state.online = false; state.isFetchingNextPage = false;
  r = await render(screen());
  assert.equal(findPressable(r, 'Load more tasks'), undefined);
});

test('Urdu headings translate and rows run right to left', async () => {
  setLanguage('ur');
  state.attendance = [open()];
  state.tasks = [task(1, 9, { verificationState: 'REWORK_REQUIRED' }), task(2, 10), task(3, 7, { status: 'COMPLETED', completionOutcome: 'SUBMITTED' })];
  const r = await render(screen());
  const text = allText(r);
  for (const word of ['آپ کی توجہ چاہیے', 'باقی کام', 'آج مکمل', 'آج کا کام']) assert.ok(text.includes(word), word);
  assert.ok(text.includes('3 میں سے 1 جمع'));
  const row = r.root.findAll(n => n.type === 'Pressable' && /^Area 2/.test(n.props.accessibilityLabel ?? ''))[0];
  const dirs = row.findAll(n => n.type === 'View' && StyleSheet.flatten(n.props.style)?.flexDirection === 'row-reverse');
  assert.ok(dirs.length > 0);
});

test('a failed refresh shows the message bar instead of an alert', async () => {
  state.attendance = [open()]; state.tasks = [task(1, 9)]; state.refetchResult = { error: new Error('x') };
  const r = await render(screen());
  const control = r.root.findAll(n => n.type === 'ScrollView')[0].props.refreshControl;
  const { act } = await import('react-test-renderer');
  await act(async () => { await control.props.onRefresh(); });
  assert.ok(allText(r).includes('Tasks could not refresh. Try again.'));
});
