// Spec 67: layouts that broke only on the Android phone.
// - NativeWind's native interop drops a `Pressable` style callback, so every rendered Pressable must get a plain style.
// - Scrolled content must not run under the status bar: a fixed band of the top inset sits above the scroll view.
// - The attendance flow on My day is full screen: the tab bar hides.
// - The selfie oval never covers the title and hint.
import assert from 'node:assert/strict';
import test from 'node:test';
import { installMocks, setLanguage, setWindowSize, render, findPressable, press } from '../support/nativeHarness.mjs';

const React = (await import('react')).default;
const { act } = await import('react-test-renderer');
const { translate } = await import('../../src/i18n/translations.ts');
const h = React.createElement;

const INSET = 24;
const env = {
  inset: INSET,
  hook: { phase: 'idle', mode: null, result: null, error: null, accuracyMeters: null },
  online: true,
  routeParams: undefined,
  setParams: [],
  attendance: [],
};
const navigation = {
  navigate() {}, goBack() {}, replace() {}, reset() {}, setOptions() {}, popTo() {},
  setParams: params => { env.setParams.push(params); env.routeParams = { ...env.routeParams, ...params }; },
  addListener: () => () => {}, isFocused: () => true,
};
const useLanguage = () => {
  const language = globalThis.__nativeHarness.language;
  return { language, isRTL: language === 'ur', t: (text, values) => translate(text, language, values), setLanguage() {} };
};
const records = [{
  id: 9, date: '2026-11-12', expectedStart: '2026-11-12T04:00:00.000Z', expectedEnd: '2026-11-12T12:00:00.000Z',
  checkInTime: '2026-11-12T07:29:00.000Z', checkOutTime: null, lateMinutes: null, location: { id: 1, name: 'HQ' }, state: 'ON_SHIFT',
}];
const range = { earliestMonth: '2026-11', latestMonth: '2026-11' };

installMocks({
  'react-native': {
    Keyboard: { addListener: () => ({ remove() {} }) },
    KeyboardAvoidingView: 'KeyboardAvoidingView',
  },
  'react-native-safe-area-context': { useSafeAreaInsets: () => ({ top: env.inset, bottom: 0, left: 0, right: 0 }) },
  'react-native-svg': { __esModule: true, default: 'Svg', Svg: 'Svg', Path: 'Path', Ellipse: 'Ellipse', Circle: 'Circle' },
  'react-native-reanimated': { useAnimatedProps: factory => factory() },
  '/components/ui/icon': { Icon: props => h('Icon', props) },
  '/assets/hygene-ops-mark.png': 1,
  '/i18n/LanguageProvider': { useLanguage },
  '@react-native-community/netinfo': {
    default: { addEventListener: cb => { cb({ isConnected: env.online, isInternetReachable: env.online }); return () => {}; } },
  },
  '@react-navigation/native': { useNavigation: () => navigation, useRoute: () => ({ params: env.routeParams }) },
  '@react-navigation/bottom-tabs': {
    createBottomTabNavigator: () => ({ Navigator: () => null, Screen: () => null }),
    BottomTabBar: props => h('BottomTabBar', props),
  },
  '@tanstack/react-query': { useQueryClient: () => ({ refetchQueries: async () => {}, getQueryData() {} }) },
  'expo-application': { nativeApplicationVersion: '1.0.0' },
  '/auth/AuthContext': {
    useAuth: () => ({ user: { id: 2, companyId: 7, locationId: 7, name: 'Ayesha Khan', email: 'a@example.invalid' }, login: async () => {}, logout: async () => {} }),
  },
  '/api/client': { changeApiServerAddress: async address => address },
  '/api/serverAddress': { getServerAddress: () => 'https://example.test/api', loadServerAddress: async () => 'https://example.test/api' },
  '/config': { API_BASE_URL: 'https://example.test/api' },
  '/launch/LaunchRecovery': { LaunchRecovery: () => null },
  '/queries/profile': {
    useStaffProfileQuery: () => ({
      data: { id: 41, name: 'Amina Khan', email: 'amina@example.invalid', phone: '0300', createdAt: '2025-03-14T08:00:00.000Z' },
      isPending: false, isError: false, refetch: async () => {},
    }),
  },
  '/queries/history': {
    useProfileSummary: () => ({
      data: { company: { name: 'Acme' }, location: { timezone: 'Asia/Karachi' },
        month: { shiftsScheduled: 2, shiftsAttended: 2, onTime: 1, tasksAssigned: 4, tasksSubmitted: 3 } },
      isPending: false, isError: false, refetch: async () => {},
    }),
    useTaskHistory: () => ({ data: { pages: [] }, isError: false, hasNextPage: false, fetchNextPage() {}, refetch: async () => {} }),
    flattenHistoryPages: () => [],
    useAttendanceMonth: (_staffId, month) => ({
      data: { month, timezone: 'UTC', range, counts: { onTime: 1, late: 0, absent: 0, missedCheckout: 0 }, records },
      isError: false, refetch: async () => {},
    }),
  },
  '/queries/staff': {
    staffQueryKeys: { attendance: id => ['staff', id, 'attendance'], tasksToday: id => ['staff', id, 'tasks'] },
    useMyAttendanceQuery: () => ({ data: env.attendance, isPending: false, isError: false, isRefetching: false, refetch: async () => ({}) }),
    useTodaysTasksQuery: () => ({ data: [], counts: undefined, isPending: false, isError: false, isRefetching: false, refetch: async () => ({}) }),
  },
  '/day/useAttendanceAction': {
    useAttendanceAction: () => ({ ...env.hook, start() {}, retryLocation() {}, continueAnyway() {}, cancel() {}, submitSelfie: async () => {} }),
  },
});

const { StyleSheet } = await import('react-native');
const { gutterFor, colors } = await import('../../src/design/tokens.ts');
const { HistoryScreen } = await import('../../src/screens/history/HistoryScreen.tsx');
const { ProfileScreen } = await import('../../src/screens/profile/ProfileScreen.tsx');
const { ProfileMonth } = await import('../../src/screens/profile/ProfileMonth.tsx');
const { ConfirmDialog } = await import('../../src/design/ConfirmDialog.tsx');
const { HomeScreen } = await import('../../src/screens/HomeScreen.tsx');
const { SnackbarProvider } = await import('../../src/design/Feedback.tsx');
const { LoginScreen } = await import('../../src/screens/LoginScreen.tsx');
const { StaffTabBar } = await import('../../src/navigation/StaffTabs.tsx');
const { AttendanceCamera, faceGuideFrame } = await import('../../src/components/AttendanceCamera.tsx');

const flat = style => StyleSheet.flatten(style) ?? {};
const pressables = r => r.root.findAll(n => n.type === 'Pressable');
const label = text => translate(text, globalThis.__nativeHarness.language);

/** Styles of every view and scroll view except the band, flattened, in tree order. */
function layoutStyles(r) {
  return r.root.findAll(n => (n.type === 'View' || n.type === 'ScrollView') && n.props.testID !== 'status-band')
    .map(n => JSON.stringify([flat(n.props.style), flat(n.props.contentContainerStyle)]));
}

/**
 * The fixed band sits before (outside) the scroll view with height INSET, and the inset reaches
 * nothing else: every other style is the same with an inset of 24 as with 0.
 */
async function assertBand(element, name) {
  const r = await render(element);
  const band = r.root.findAll(n => n.type === 'View' && n.props.testID === 'status-band')[0];
  assert.ok(band, `${name}: a status-bar band`);
  assert.equal(flat(band.props.style).height, INSET, `${name}: band height is the top inset`);
  const siblings = band.parent.children;
  const scrollIndex = siblings.findIndex(n => n.type === 'ScrollView');
  assert.ok(scrollIndex > siblings.indexOf(band), `${name}: band sits before (outside) the scroll view`);
  const withInset = layoutStyles(r);
  env.inset = 0;
  const flatTop = await render(element);
  env.inset = INSET;
  assert.deepEqual(withInset, layoutStyles(flatTop), `${name}: only the band uses the top inset`);
  await act(async () => flatTop.unmount());
  return r;
}

/** Every rendered Pressable has a plain style: Android drops a style callback. */
function assertPlainStyles(r, name) {
  for (const node of pressables(r)) {
    assert.notEqual(typeof node.props.style, 'function', `${name}: ${node.props.accessibilityLabel} has a plain style`);
  }
}

test.beforeEach(() => {
  setLanguage('en');
  setWindowSize(360, 700);
  env.hook = { phase: 'idle', mode: null, result: null, error: null, accuracyMeters: null };
  env.online = true;
  env.inset = INSET;
  env.routeParams = undefined;
  env.setParams.length = 0;
  env.attendance = [];
});

for (const language of ['en', 'ur']) {
  const row = language === 'ur' ? 'row-reverse' : 'row';

  test(`History (${language}): fixed band; attendance rows are one row with the side gutter`, async () => {
    setLanguage(language);
    const r = await assertBand(h(HistoryScreen), 'History');
    await press(findPressable(r, label('Attendance')));
    assertPlainStyles(r, 'History');
    const rows = pressables(r).filter(n => /HQ|On shift|شفٹ/.test(n.props.accessibilityLabel ?? ''));
    assert.equal(rows.length, 1);
    const style = flat(rows[0].props.style);
    assert.equal(style.flexDirection, row);
    assert.equal(style.marginHorizontal, gutterFor(360));
    assert.equal(style.alignItems, 'center');
    // The pill sits in a box the row centres (the pill itself aligns to the top).
    const pillBox = rows[0].findByProps({ testID: 'attendance-row-pill' });
    assert.notEqual(flat(pillBox.props.style).alignSelf, 'flex-start');
  });

  test(`Profile (${language}): fixed white band; settings rows, Sign out and "See my history" are rows`, async () => {
    setLanguage(language);
    const r = await assertBand(h(ProfileScreen), 'Profile');
    assert.equal(flat(r.root.findByProps({ testID: 'status-band' }).props.style).backgroundColor, colors.surface);
    assertPlainStyles(r, 'Profile');
    for (const name of ['Task alerts', 'Help', 'Sign out']) {
      const node = findPressable(r, label(name));
      assert.ok(node, name);
      assert.equal(flat(node.props.style).flexDirection, row, name);
      assert.ok(flat(node.props.style).minHeight >= 60, name);
    }
    const more = findPressable(r, label('See my history'));
    assert.equal(flat(more.props.style).flexDirection, row);
    // The pressed wash still shows, from state.
    await act(async () => { findPressable(r, label('Help')).props.onPressIn(); });
    assert.equal(flat(findPressable(r, label('Help')).props.style).backgroundColor, colors.soft);
    await act(async () => { findPressable(r, label('Help')).props.onPressOut(); });
    assert.equal(flat(findPressable(r, label('Help')).props.style).backgroundColor, undefined);
  });

  test(`My day (${language}): fixed band in the sky colour, night when offline; the header carries no inset`, async () => {
    setLanguage(language);
    const r = await assertBand(h(SnackbarProvider, null, h(HomeScreen)), 'My day');
    const sky = flat(r.root.findByProps({ testID: 'day-header' }).props.style);
    assert.equal(flat(r.root.findByProps({ testID: 'status-band' }).props.style).backgroundColor, sky.backgroundColor);
    assert.ok(!sky.paddingTop, 'the header does not pad by the inset');
    assertPlainStyles(r, 'My day');
    await act(async () => r.unmount());

    env.online = false;
    const offline = await render(h(SnackbarProvider, null, h(HomeScreen)));
    const bands = offline.root.findAll(n => n.type === 'View' && n.props.testID === 'status-band');
    assert.equal(bands.length, 1, 'one band offline too');
    assert.equal(flat(bands[0].props.style).backgroundColor, colors.night2);
    await act(async () => offline.unmount());
  });

  test(`Sign in (${language}): fixed band above the scroll view`, async () => {
    setLanguage(language);
    const r = await assertBand(h(LoginScreen), 'Sign in');
    assertPlainStyles(r, 'Sign in');
  });

  test(`Confirm dialog (${language}): buttons have a plain style and keep the pressed wash`, async () => {
    setLanguage(language);
    const r = await render(h(ConfirmDialog, { visible: true, title: 'Sign out of this phone?', body: 'Body', confirmLabel: 'Sign out', destructive: true, onCancel() {}, onConfirm() {} }));
    assertPlainStyles(r, 'Dialog');
    const cancel = findPressable(r, label('Cancel'));
    const before = flat(cancel.props.style).backgroundColor;
    await act(async () => { cancel.props.onPressIn(); });
    assert.notEqual(flat(findPressable(r, label('Cancel')).props.style).backgroundColor, before);
  });
}

test('ProfileMonth on its own: "See my history" is a row with a plain style', async () => {
  const r = await render(h(ProfileMonth, { summary: { shiftsScheduled: 2, shiftsAttended: 2, onTime: 1, tasksAssigned: 4, tasksSubmitted: 3 }, onSeeHistory() {} }));
  assertPlainStyles(r, 'ProfileMonth');
  assert.equal(flat(findPressable(r, 'See my history').props.style).flexDirection, 'row');
});

test('My day: locating, the selfie camera and the receipt ask for full screen; idle clears it', async () => {
  const phases = [
    { phase: 'locating', mode: 'check-in' },
    { phase: 'selfie', mode: 'check-in' },
    { phase: 'saving', mode: 'check-in' },
    { phase: 'done', mode: 'check-in', result: { mode: 'check-in', at: '2026-11-12T07:29:00.000Z', late: false } },
  ];
  for (const extra of phases) {
    env.hook = { ...env.hook, ...extra };
    env.routeParams = undefined;
    env.setParams.length = 0;
    const r = await render(h(SnackbarProvider, null, h(HomeScreen)));
    assert.deepEqual(env.setParams, [{ fullScreen: true }], extra.phase);
    await act(async () => r.unmount());
  }
  env.hook = { phase: 'idle', mode: null, result: null, error: null, accuracyMeters: null };
  env.routeParams = { fullScreen: true };
  env.setParams.length = 0;
  const idle = await render(h(SnackbarProvider, null, h(HomeScreen)));
  assert.deepEqual(env.setParams, [{ fullScreen: false }]);
  env.setParams.length = 0;
  env.routeParams = undefined;
  const plain = await render(h(SnackbarProvider, null, h(HomeScreen)));
  assert.deepEqual(env.setParams, [], 'no param churn on a normal My day');
  await act(async () => { idle.unmount(); plain.unmount(); });
});

test('the tab bar renders nothing while the focused tab is full screen', () => {
  const props = (params, index = 0) => ({
    state: { index, routes: [{ key: 'a', name: 'Shift', params }, { key: 'b', name: 'Tasks' }] },
    descriptors: {}, navigation: {}, insets: { top: 0, bottom: 0, left: 0, right: 0 },
  });
  assert.equal(StaffTabBar(props({ fullScreen: true })), null);
  assert.equal(StaffTabBar(props({ fullScreen: false })).type({}).type, 'BottomTabBar');
  assert.equal(StaffTabBar(props(undefined)).type({}).type, 'BottomTabBar');
  assert.notEqual(StaffTabBar(props({ fullScreen: true }, 1)), null, 'only the focused route counts');
});

test('faceGuideFrame keeps the oval below the title block and in proportion', () => {
  const ratio = 306 / 236;
  for (const [width, height, top] of [[360, 450, 134], [360, 565, 134], [390, 700, 120], [320, 380, 150], [360, 300, 134]]) {
    const { cx, cy, rx, ry } = faceGuideFrame(width, height, top);
    assert.equal(cx, width / 2);
    assert.ok(Math.abs(ry / rx - ratio) < 1e-9, 'proportions kept');
    assert.ok(rx <= 118 && rx <= width * 0.36 + 1e-9, 'never wider than the design');
    assert.ok(cy - ry >= top, `oval top ${cy - ry} is below the text ${top} at ${width}x${height}`);
  }
  // A tall area keeps the design's centre at 44%.
  const tall = faceGuideFrame(390, 760, 120);
  assert.equal(tall.cy, 760 * 0.44);
  assert.equal(tall.ry, 118 * ratio);
});

test('the selfie camera places its oval under the measured title block', async () => {
  const r = await render(h(AttendanceCamera, { mode: 'check-in', onCapture: async () => {}, onCancel() {} }));
  const top = r.root.findByProps({ testID: 'camera-top' });
  const area = top.parent;
  await act(async () => { area.props.onLayout({ nativeEvent: { layout: { x: 0, y: 0, width: 360, height: 430 } } }); });
  await act(async () => { top.props.onLayout({ nativeEvent: { layout: { x: 0, y: 0, width: 360, height: 150 } } }); });
  const oval = r.root.findAll(n => n.type === 'Ellipse')[0];
  assert.ok(oval.props.cy - oval.props.ry >= 150, `oval top ${oval.props.cy - oval.props.ry} under the text`);
  assert.equal(flat(r.root.findAll(n => n.type === 'View')[0].props.style).paddingTop, INSET, 'camera starts under the status bar');
  assertPlainStyles(r, 'Camera');
});
