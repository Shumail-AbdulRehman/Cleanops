import assert from 'node:assert/strict';
import test, { mock } from 'node:test';
import { installMocks, setLanguage, render, allText, findPressable, press, navigationCalls, resetCalls } from '../support/nativeHarness.mjs';

// Times below are Pakistan local times; clock() formats in the device zone.
process.env.TZ = 'Asia/Karachi';

const React = (await import('react')).default;
const { act } = await import('react-test-renderer');
const { translate } = await import('../../src/i18n/translations.ts');
const harness = globalThis.__nativeHarness;

// Shared boundary state read by the module mocks.
const env = {};
const calls = [];
const record = name => (...args) => { calls.push([name, ...args]); };
function reset() {
  Object.assign(env, {
    attendance: [], tasks: [], counts: undefined, online: true,
    attendancePending: false, tasksPending: false, attendanceError: false, tasksError: false,
    refetchError: null, back: null, announced: [],
    hook: { phase: 'idle', mode: null, result: null, error: null, accuracyMeters: null },
  });
  calls.length = 0;
  resetCalls();
  setLanguage('en');
}
reset();

installMocks({
  '/ui/icon': { Icon: props => React.createElement('Icon', props) },
  'react-native-svg': { __esModule: true, default: 'Svg', Svg: 'Svg', Path: 'Path', Ellipse: 'Ellipse' },
  'react-native-reanimated': { useAnimatedProps: factory => factory() },
  'react-native': {
    BackHandler: { addEventListener: (_name, handler) => { env.back = handler; return { remove() { env.back = null; } }; } },
    AccessibilityInfo: {
      announceForAccessibility: text => { env.announced.push(text); }, isScreenReaderEnabled: async () => false,
      isReduceMotionEnabled: async () => false, addEventListener: () => ({ remove() {} }),
    },
  },
  '@react-native-community/netinfo': {
    default: { addEventListener: cb => { cb({ isConnected: env.online, isInternetReachable: env.online }); return () => {}; } },
  },
  '/i18n/LanguageProvider': {
    // The shared harness t() drops placeholder values; the real translate fills them.
    useLanguage: () => ({
      language: harness.language, isRTL: harness.language === 'ur', setLanguage() {},
      t: (text, values) => translate(text, harness.language, values),
    }),
  },
  '/auth/AuthContext': { useAuth: () => ({ user: { id: 2, companyId: 7, locationId: 7, name: 'Ayesha Khan' } }) },
  '/queries/staff': {
    staffQueryKeys: { attendance: id => ['staff', id, 'attendance'], tasksToday: id => ['staff', id, 'tasks'] },
    useMyAttendanceQuery: () => ({
      data: env.attendancePending || env.attendanceError ? undefined : env.attendance,
      isPending: env.attendancePending, isError: env.attendanceError, isRefetching: false,
      refetch: async () => { calls.push(['refetchAttendance']); return { error: env.refetchError }; },
    }),
    useTodaysTasksQuery: () => ({
      data: env.tasksPending || env.tasksError ? undefined : env.tasks, counts: env.counts,
      isPending: env.tasksPending, isError: env.tasksError, isRefetching: false,
      refetch: async () => { calls.push(['refetchTasks']); return { error: null }; },
    }),
  },
  // The hook is spec 16's; here it is a stand-in whose phase each test sets.
  '/day/useAttendanceAction': {
    useAttendanceAction: () => ({
      ...env.hook,
      start: record('start'), retryLocation: record('retryLocation'), continueAnyway: record('continueAnyway'),
      cancel: record('cancel'), submitSelfie: record('submitSelfie'),
    }),
  },
});
const { HomeScreen } = await import('../../src/screens/HomeScreen.tsx');
const { SnackbarProvider } = await import('../../src/design/Feedback.tsx');
const { StyleSheet } = await import('react-native');

const h = React.createElement;
const plain = s => s.replace(/[⁨⁩]/g, '');
const text = r => plain(allText(r));
const texts = r => r.root.findAll(n => n.type === 'Text').map(n => plain(n.children.filter(c => typeof c === 'string').join('')));
const styleOf = node => StyleSheet.flatten(node.props.style) ?? {};
const navigations = () => navigationCalls().filter(c => c.name === 'navigate').map(c => c.args);
const starts = () => calls.filter(c => c[0] === 'start');

// Fake only Date so "now" is a fixed time on 11 Nov 2026 (Karachi is UTC+5, no DST).
const at = hhmm => new Date(`2026-11-11T${hhmm}:00.000+05:00`);
let mounted = [];
async function screen(hhmm) {
  mock.timers.reset();
  mock.timers.enable({ apis: ['Date'], now: at(hhmm) });
  const r = await render(h(SnackbarProvider, null, h(HomeScreen)));
  mounted.push(r);
  return r;
}
test.afterEach(async () => {
  for (const r of mounted) await act(async () => r.unmount());
  mounted = [];
  mock.timers.reset();
  reset();
});

// A 9:00 AM to 5:00 PM shift at Gulberg Plaza.
const shift = (extra = {}) => ({
  id: 456, date: '2026-11-11T00:00:00.000Z', status: 'ABSENT',
  expectedStart: at('09:00').toISOString(), expectedEnd: at('17:00').toISOString(),
  checkInTime: null, checkOutTime: null, location: { id: 7, name: 'Gulberg Plaza' }, ...extra,
});
const onShift = (extra = {}) => shift({ status: 'CHECKED_IN', checkInTime: at('08:58').toISOString(), ...extra });
const task = (id, from, extra = {}) => ({
  id, title: `Washroom ${id}`, areaNameSnapshot: `Ladies washroom ${id}`, status: 'PENDING', date: '2026-11-11',
  shiftStart: at(from).toISOString(), shiftEnd: new Date(at(from).getTime() + 3600000).toISOString(),
  startedAt: null, completedAt: null, proofImageUrls: [], ...extra,
});
const submitted = (id, from) => task(id, from, { status: 'COMPLETED', completionOutcome: 'SUBMITTED' });

test('8:52 before the shift: the dock says "Check in" and pressing it starts check-in', async () => {
  env.attendance = [shift()];
  env.tasks = [task(1, '10:00')];
  const r = await screen('08:52');
  assert.ok(text(r).includes('Check in to start your shift'));
  await press(findPressable(r, 'Check in'));
  assert.deepEqual(starts(), [['start', 'check-in']]);
  assert.equal(findPressable(r, 'Check out'), undefined);
});

test('late: "Check in late" starts check-in; a missed check-out offers "Complete check-out"', async () => {
  env.attendance = [shift()];
  const late = await screen('09:24');
  await press(findPressable(late, 'Check in late'));
  assert.deepEqual(starts(), [['start', 'check-in']]);
  env.attendance = [onShift({ status: 'MISSED_CHECKOUT' })];
  const missed = await screen('18:10');
  await press(findPressable(missed, 'Complete check-out'));
  assert.deepEqual(starts(), [['start', 'check-in'], ['start', 'check-out']]);
});

test('on shift with a pending task, "Start cleaning" opens the task details with its id', async () => {
  env.attendance = [onShift()];
  env.tasks = [submitted(1, '09:00'), task(31, '10:00')];
  const r = await screen('10:05');
  assert.ok(text(r).includes('Next: Ladies washroom 31'));
  await press(findPressable(r, 'Start cleaning'));
  assert.deepEqual(navigations().at(-1), ['TaskDetail', { taskId: 31 }]);
  assert.equal(findPressable(r, 'Check out'), undefined, 'no check-out before its time');
});

test('cleaning and retake open the photo screen with the photo QR required', async () => {
  env.attendance = [onShift()];
  env.tasks = [task(5, '10:00', { status: 'IN_PROGRESS' })];
  const cleaning = await screen('10:20');
  await press(findPressable(cleaning, 'Take task photos'));
  assert.deepEqual(navigations().at(-1), ['Verification', { taskId: 5, requirePhotoQr: true }]);
  env.tasks = [task(6, '10:00', { verificationState: 'REWORK_REQUIRED' })];
  const retake = await screen('10:20');
  await press(findPressable(retake, 'Retake photo'));
  assert.deepEqual(navigations().at(-1), ['Verification', { taskId: 6, requirePhotoQr: true }]);
});

test('all work submitted at 3:40: the dock shows "Check-out opens at 5:00 PM" and no button', async () => {
  env.attendance = [onShift()];
  env.tasks = [submitted(1, '09:00'), submitted(2, '11:00')];
  const r = await screen('15:40');
  assert.ok(texts(r).includes('All work submitted'));
  const status = r.root.findAll(n => n.type === 'View' && n.props.accessibilityLiveRegion === 'polite' && n.props.accessibilityRole === 'text');
  assert.equal(status.length, 1);
  assert.ok(texts(r).includes('Check-out opens at 5:00 PM'));
  for (const label of ['Check out', 'Check in', 'Start cleaning', 'Try again']) assert.equal(findPressable(r, label), undefined, label);
});

test('5:02 with open work: the task stays first, the outline "Check out" warns, then "Check out anyway" starts check-out', async () => {
  env.attendance = [onShift()];
  env.tasks = [submitted(1, '09:00'), task(2, '15:00'), task(3, '16:00')];
  const r = await screen('17:02');
  const main = findPressable(r, 'Start cleaning');
  const outline = findPressable(r, 'Check out');
  assert.ok(main && outline);
  assert.ok(text(r).indexOf('Start cleaning') < text(r).lastIndexOf('Check out'), 'task action above check-out');
  await press(outline);
  assert.ok(text(r).includes('2 tasks are not submitted'));
  assert.deepEqual(starts(), [], 'the warning comes first');
  await press(findPressable(r, 'Go back to my work'));
  assert.ok(!text(r).includes('2 tasks are not submitted'));
  await press(findPressable(r, 'Check out'));
  await press(findPressable(r, 'Check out anyway'));
  assert.deepEqual(starts(), [['start', 'check-out']]);
  assert.ok(!text(r).includes('2 tasks are not submitted'));
});

test('5:02 with no open work: the main action is check-out with no warning', async () => {
  env.attendance = [onShift()];
  env.tasks = [submitted(1, '09:00')];
  const r = await screen('17:02');
  assert.ok(text(r).includes('Time to check out'));
  await press(findPressable(r, 'Check out'));
  assert.deepEqual(starts(), [['start', 'check-out']]);
  assert.ok(!text(r).includes('not submitted'));
});

test('offline: banner and the dock status replace the action', async () => {
  env.online = false;
  env.attendance = [shift()];
  const r = await screen('08:52');
  const all = texts(r);
  assert.equal(all.filter(s => s === 'Internet needed to continue').length, 2, 'banner and dock status');
  assert.ok(all.includes('You are seeing the last saved information.'));
  assert.equal(findPressable(r, 'Check in'), undefined);
});

test('first load shows the header and work skeletons and no dock', async () => {
  env.attendancePending = true; env.tasksPending = true;
  const r = await screen('08:52');
  assert.equal(r.root.findAll(n => n.props.testID === 'day-header-loading' && typeof n.type === 'string').length, 1);
  assert.equal(findPressable(r, 'Check in'), undefined);
  assert.ok(!text(r).includes("Today's work"));
});

test('a failed load says so and "Try again" refetches both queries', async () => {
  env.attendanceError = true;
  const r = await screen('10:00');
  assert.ok(text(r).includes('Today could not load'));
  await press(findPressable(r, 'Try again'));
  assert.deepEqual(calls.map(c => c[0]).sort(), ['refetchAttendance', 'refetchTasks']);
});

test('a failed pull to refresh shows the message bar', async () => {
  env.attendance = [onShift()];
  env.refetchError = new Error('timeout');
  const r = await screen('10:00');
  const scroll = r.root.findAll(n => n.type === 'ScrollView')[0];
  await act(async () => { await scroll.props.refreshControl.props.onRefresh(); });
  assert.ok(text(r).includes('Today could not refresh. Try again.'));
});

test('avatar opens Profile, "See all tasks" opens Tasks, a task row opens its details', async () => {
  env.attendance = [onShift()];
  env.tasks = [task(8, '10:00')];
  const r = await screen('09:30');
  await press(findPressable(r, 'Profile'));
  await press(findPressable(r, 'See all tasks'));
  await press(r.root.findAll(n => n.type === 'Pressable' && n.props.accessibilityLabel?.startsWith('Ladies washroom 8'))[0]);
  assert.deepEqual(navigations(), [['Profile'], ['Tasks'], ['TaskDetail', { taskId: 8 }]]);
});

test('locating: the full-screen locating view; its back and Android back cancel', async () => {
  env.attendance = [shift()];
  env.hook = { ...env.hook, phase: 'locating', mode: 'check-in' };
  const r = await screen('08:52');
  assert.ok(texts(r).includes('Finding your location…'));
  assert.ok(texts(r).includes('Gulberg Plaza'));
  assert.ok(!text(r).includes('Check in to start your shift'), 'My day is replaced');
  await press(findPressable(r, 'Back'));
  assert.equal(env.back(), true);
  assert.deepEqual(calls.filter(c => c[0] === 'cancel').length, 2);
});

test('weak signal, permission and error phases open their sheet over My day', async () => {
  env.attendance = [shift()];
  env.hook = { ...env.hook, phase: 'weakSignal', mode: 'check-in', accuracyMeters: 86 };
  const weak = await screen('08:52');
  assert.ok(text(weak).includes('GPS signal is weak') && text(weak).includes('Check in to start your shift'));
  await press(findPressable(weak, 'Continue anyway'));
  assert.deepEqual(calls.at(-1), ['continueAnyway']);

  env.hook = { ...env.hook, phase: 'needsPermission', error: 'Allow camera access to capture an attendance image.' };
  const permission = await screen('08:52');
  assert.ok(text(permission).includes('Camera is needed'));
  assert.ok(findPressable(permission, 'Open settings'));

  env.hook = { ...env.hook, phase: 'error', mode: 'check-in', error: 'You must be within 100 meters of the assigned location.' };
  const failed = await screen('08:52');
  assert.ok(text(failed).includes('Attendance not saved'));
  assert.ok(text(failed).includes('You must be within 100 meters of the assigned location.'));
  calls.length = 0;
  await press(findPressable(failed, 'Try again'));
  assert.deepEqual(calls, [['start', 'check-in']]);
});

test('selfie and saving show the camera wired to the hook', async () => {
  env.attendance = [onShift()];
  for (const phase of ['selfie', 'saving']) {
    env.hook = { ...env.hook, phase, mode: 'check-out' };
    const r = await screen('17:05');
    assert.ok(text(r).includes('Check-out selfie'), phase);
    assert.ok(!text(r).includes("Today's work"), phase);
  }
  calls.length = 0;
  await press(findPressable(mounted[0], 'Cancel'));
  assert.deepEqual(calls, [['cancel']]);
});

test('done shows the receipt; its action returns to My day and refetches', async () => {
  env.attendance = [onShift({ checkInTime: at('08:58').toISOString() })];
  env.hook = { ...env.hook, phase: 'done', mode: 'check-in', result: { mode: 'check-in', at: at('08:58').toISOString(), late: false } };
  const r = await screen('08:58');
  assert.ok(texts(r).includes('Checked in'));
  assert.ok(texts(r).includes('On time'));
  assert.ok(texts(r).includes('Gulberg Plaza'));
  await press(findPressable(r, "See today's work"));
  assert.deepEqual(calls.map(c => c[0]).sort(), ['cancel', 'refetchAttendance', 'refetchTasks']);
});

test('the sentence is announced when it changes, not on first render', async () => {
  env.attendance = [shift()];
  const r = await screen('08:52');
  assert.deepEqual(env.announced, []);
  env.attendance = [onShift()];
  env.tasks = [task(9, '10:00')];
  await act(async () => { r.update(h((await import('../../src/fonts.ts')).NativeFontsReady.Provider, { value: true }, h(SnackbarProvider, null, h(HomeScreen)))); });
  assert.equal(env.announced.length, 1);
  assert.ok(plain(env.announced[0]).startsWith('Next: Ladies washroom 9'));
});

test('Urdu: the next-task label and the area are separate lines in right-to-left rows', async () => {
  setLanguage('ur');
  env.attendance = [onShift()];
  env.tasks = [task(31, '10:00')];
  const r = await screen('10:05');
  const title = r.root.findAll(n => n.props.testID === 'day-header-title' && typeof n.type === 'string')[0];
  const lines = title.findAll(n => n.type === 'Text').map(n => plain(n.children.join('')));
  assert.deepEqual(lines, [translate('Next: {area}', 'ur').replace(/\s*\{area\}\s*/, '').trim(), 'Ladies washroom 31']);
  assert.ok(findPressable(r, translate('Start cleaning', 'ur')));
  assert.ok(r.root.findAll(n => n.type === 'View' && styleOf(n).flexDirection === 'row-reverse').length > 0);
});
