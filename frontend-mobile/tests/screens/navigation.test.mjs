import assert from 'node:assert/strict';
import test from 'node:test';
import { installMocks, setLanguage, render, allText, findPressable, press } from '../support/nativeHarness.mjs';

const React = (await import('react')).default;
const { translate } = await import('../../src/i18n/translations.ts');
const h = React.createElement;
const { act } = await import('react-test-renderer');

// The shared harness t() drops placeholder values; the real translate fills them.
const useLanguage = () => {
  const language = globalThis.__nativeHarness.language;
  return { language, isRTL: language === 'ur', t: (text, values) => translate(text, language, values), setLanguage() {} };
};

const signedIn = { id: 2, companyId: 7, name: 'Synthetic staff', email: 'staff@example.invalid' };
const state = { auth: {}, logouts: 0, reduceMotion: false, motionListener: null, fontScale: 1 };

// Navigators stand in as plain elements: each screen keeps its name and options and renders its component,
// so the test reads the declared structure and still mounts the probes below.
const navigation = { navigate() {}, goBack() {}, setOptions() {}, addListener: () => () => {} };
const navigator = kind => ({
  Navigator: ({ screenOptions, initialRouteName, backBehavior, children }) =>
    h(`${kind}Navigator`, { screenOptions, initialRouteName, backBehavior }, children),
  Screen: ({ name, component, options, initialParams }) => h(`${kind}Screen`, { name, options, initialParams },
    kind === 'Tab' ? options.tabBarIcon({ focused: name === 'Shift', color: '', size: 24 }) : null,
    kind === 'Tab' ? options.tabBarLabel({ focused: name === 'Shift', color: '', position: 'below-icon', children: options.title }) : null,
    h(component, { navigation, route: { name, params: initialParams } })),
});

let useSnackbar = () => ({ show() {} });
const probe = name => () => h('Text', null, `screen:${name}`);
function TasksProbe() {
  const { show } = useSnackbar();
  return h('Pressable', { accessibilityLabel: 'probe-show', onPress: () => show('Tasks could not refresh. Try again.') },
    h('Text', null, 'screen:Tasks'));
}

installMocks({
  'react-native': {
    useWindowDimensions: () => ({ width: 360, height: 700, scale: 1, fontScale: state.fontScale }),
    AccessibilityInfo: {
      announceForAccessibility() {}, isScreenReaderEnabled: async () => false,
      isReduceMotionEnabled: async () => state.reduceMotion,
      addEventListener: (event, listener) => { if (event === 'reduceMotionChanged') state.motionListener = listener; return { remove() {} }; },
    },
  },
  '@react-navigation/bottom-tabs': { createBottomTabNavigator: () => navigator('Tab') },
  '@react-navigation/native-stack': { createNativeStackNavigator: () => navigator('Stack') },
  '@react-native-community/netinfo': { default: { addEventListener: () => () => {} } },
  '/components/ui/icon': { Icon: props => h('Icon', props) },
  '/assets/hygene-ops-mark.png': 1,
  '/i18n/LanguageProvider': { useLanguage },
  '/auth/AuthContext': { useAuth: () => state.auth },
  '/queries/staff': { useTodaysTasksQuery: () => ({ data: [], counts: undefined }) },
  '/screens/HomeScreen': { HomeScreen: probe('Shift') },
  '/screens/TasksScreen': { TasksScreen: TasksProbe },
  '/screens/profile/ProfileScreen': { ProfileScreen: probe('Profile') },
  '/screens/history/HistoryScreen': { HistoryScreen: probe('History') },
  '/screens/history/HistoryTaskScreen': { HistoryTaskScreen: probe('HistoryTask') },
  '/screens/HelpScreen': { HelpScreen: probe('HelpGuide') },
  '/screens/LoginScreen': { LoginScreen: probe('Login') },
  '/screens/StartTaskScreen': { StartTaskScreen: probe('StartTask') },
  '/screens/profile/TaskAlertsScreen': { TaskAlertsScreen: probe('TaskAlerts') },
  '/screens/task/TaskDetailScreen': { TaskDetailScreen: probe('TaskDetail') },
  '/screens/verification/SpatialDiagnosticScreen': { SpatialDiagnosticScreen: probe('SpatialDiagnostic') },
  '/screens/verification/VerificationScreen': { VerificationScreen: probe('Verification') },
});
({ useSnackbar } = await import('../../src/design/Feedback.tsx'));
const { StaffTabs } = await import('../../src/navigation/StaffTabs.tsx');
const { AppNavigator } = await import('../../src/navigation/AppNavigator.tsx');
const { colors, space } = await import('../../src/design/tokens.ts');
const { StyleSheet } = await import('react-native');

const settle = () => new Promise(resolve => setTimeout(resolve, 0));
const screens = (r, kind) => r.root.findAll(n => n.type === `${kind}Screen`);
const names = (r, kind) => screens(r, kind).map(n => n.props.name);
const stackOptions = r => r.root.findByType('StackNavigator').props.screenOptions;

test.beforeEach(() => {
  setLanguage('en');
  globalThis.__DEV__ = false;
  Object.assign(state, {
    auth: { user: signedIn, isBootstrapping: false, passwordChangeRequired: false, logout: async () => { state.logouts += 1; } },
    logouts: 0, reduceMotion: false, motionListener: null, fontScale: 1,
  });
});

test('tabs are exactly My day, Tasks, History and Profile, with Shift and Tasks route names kept', async () => {
  const r = await render(h(StaffTabs));
  assert.deepEqual(names(r, 'Tab'), ['Shift', 'Tasks', 'History', 'Profile']);
  assert.equal(r.root.findByType('TabNavigator').props.initialRouteName, 'Shift');
  const text = allText(r);
  for (const label of ['My day', 'Tasks', 'History', 'Profile']) assert.ok(text.includes(label), label);
  assert.ok(!text.includes('Help'), 'no Help tab');
  assert.deepEqual(screens(r, 'Tab').map(n => n.props.options.title), ['My day', 'Tasks', 'History', 'Profile']);
  const icons = r.root.findAll(n => n.type === 'Icon').map(n => n.props.name);
  assert.deepEqual(icons, ['Clock', 'ListChecks', 'RotateCcwClock', 'UserRound']);
  for (const name of ['Shift', 'Tasks', 'History', 'Profile']) assert.ok(text.includes(`screen:${name}`), `${name} mounts its screen`);
});

test('tab labels are translated in Urdu and the bar is mirrored, My day still the start and back target', async () => {
  setLanguage('ur');
  const r = await render(h(StaffTabs));
  assert.deepEqual(names(r, 'Tab'), ['Profile', 'History', 'Tasks', 'Shift']);
  const nav = r.root.findByType('TabNavigator').props;
  assert.equal(nav.initialRouteName, 'Shift');
  assert.equal(nav.backBehavior, 'initialRoute');
  const text = allText(r);
  for (const label of ['My day', 'Tasks', 'History', 'Profile']) {
    const urdu = translate(label, 'ur');
    assert.notEqual(urdu, label);
    assert.ok(text.includes(urdu), urdu);
  }
  assert.ok(!text.includes('My day'));
});

test('the bar grows for taller Urdu labels and larger text so labels are never cut', async () => {
  const heightOf = async () => StyleSheet.flatten((await render(h(StaffTabs))).root.findByType('TabNavigator').props.screenOptions.tabBarStyle).height;
  const english = await heightOf();
  setLanguage('ur');
  const urdu = await heightOf();
  assert.ok(urdu > english, `${urdu} > ${english}`);
  state.fontScale = 2;
  assert.ok((await heightOf()) > urdu, 'font scaling grows the bar');
});

test('tab bar style: white bar with a top hairline, active blueDeep on a blueWash pip, inactive muted, blue badge', async () => {
  const r = await render(h(StaffTabs));
  const options = r.root.findByType('TabNavigator').props.screenOptions;
  assert.equal(options.headerShown, false);
  assert.equal(options.animation, 'none');
  assert.equal(options.tabBarAllowFontScaling, true);
  assert.equal(options.tabBarStyle.backgroundColor, colors.surface);
  assert.equal(options.tabBarStyle.borderTopColor, colors.line);
  assert.ok(options.tabBarStyle.borderTopWidth > 0);
  assert.ok(options.tabBarStyle.height >= space.tabMinHeight + options.tabBarStyle.paddingTop);
  assert.ok(StyleSheet.flatten(options.tabBarItemStyle).minHeight >= 60);
  assert.deepEqual(StyleSheet.flatten(options.tabBarBadgeStyle), { backgroundColor: colors.blue, color: colors.surface });

  const active = r.root.findByProps({ testID: 'tab-pip-active' });
  const pip = StyleSheet.flatten(active.props.style);
  assert.equal(pip.width, 62);
  assert.equal(pip.height, 32);
  assert.equal(pip.backgroundColor, colors.blueWash);
  const inactive = r.root.findAllByProps({ testID: 'tab-pip' }).map(n => StyleSheet.flatten(n.props.style));
  assert.equal(inactive.length, 3);
  for (const style of inactive) assert.equal(style.backgroundColor, undefined);

  const icons = r.root.findAll(n => n.type === 'Icon');
  assert.equal(icons[0].props.color, colors.blueDeep);
  assert.equal(icons[1].props.color, colors.muted);
  const label = text => r.root.findAll(n => n.type === 'Text' && n.props.children === text)[0];
  assert.equal(StyleSheet.flatten(label('My day').props.style).color, colors.blueDeep);
  assert.equal(StyleSheet.flatten(label('Tasks').props.style).color, colors.muted);
});

test('signed in, the stack declares the tabs and every Part 1 screen; new screens hide the navigator header', async () => {
  const r = await render(h(AppNavigator));
  const declared = names(r, 'Stack');
  assert.deepEqual(declared, ['StaffTabs', 'TaskDetail', 'HelpGuide', 'TaskAlerts', 'HistoryTask', 'Verification', 'StartTask']);
  assert.ok(!declared.includes('Login'));
  assert.ok(!declared.includes('SpatialDiagnostic'), 'diagnostic only in dev builds');
  const byName = Object.fromEntries(screens(r, 'Stack').map(n => [n.props.name, n.props]));
  for (const name of ['StaffTabs', 'TaskDetail', 'HelpGuide', 'TaskAlerts']) {
    assert.equal(byName[name].options.headerShown, false, name);
  }
  assert.deepEqual(byName.Verification.initialParams, { requirePhotoQr: true });
  assert.equal(byName.Verification.options.title, 'Task photos');
  assert.equal(byName.StartTask.options.title, 'Start cleaning');
  assert.deepEqual(names(r, 'Tab'), ['Shift', 'Tasks', 'History', 'Profile']);
});

test('dev builds keep the spatial diagnostic screen', async () => {
  globalThis.__DEV__ = true;
  const r = await render(h(AppNavigator));
  assert.ok(names(r, 'Stack').includes('SpatialDiagnostic'));
});

test('signed out, the stack declares only Login', async () => {
  state.auth = { ...state.auth, user: null };
  const r = await render(h(AppNavigator));
  assert.deepEqual(names(r, 'Stack'), ['Login']);
  assert.equal(screens(r, 'Stack')[0].props.options.headerShown, false);
  assert.ok(allText(r).includes('screen:Login'));
});

test('stack pushes slide by default and fade when reduce motion is on', async () => {
  let r = await render(h(AppNavigator));
  await settle();
  assert.equal(stackOptions(r).animation, 'default');

  state.reduceMotion = true;
  r = await render(h(AppNavigator));
  await settle();
  assert.equal(stackOptions(r).animation, 'fade');
});

test('a reduce motion change while open switches the push animation', async () => {
  const r = await render(h(AppNavigator));
  await settle();
  await act(async () => { state.motionListener(true); });
  assert.equal(stackOptions(r).animation, 'fade');
});

test('session restore shows the mark, "Loading your day" and one spinner, in English and Urdu', async () => {
  state.auth = { ...state.auth, isBootstrapping: true };
  let r = await render(h(AppNavigator));
  assert.ok(allText(r).includes('Loading your day'));
  assert.equal(r.root.findAll(n => n.type === 'ActivityIndicator').length, 1);
  assert.equal(r.root.findAll(n => n.type === 'Image').length, 1);
  assert.equal(r.root.findAll(n => n.type === 'StackNavigator').length, 0);

  setLanguage('ur');
  r = await render(h(AppNavigator));
  assert.ok(allText(r).includes(translate('Loading your day', 'ur')));
});

test('a legacy session shows only the sign-in notice and Sign out, without the app', async () => {
  state.auth = { ...state.auth, passwordChangeRequired: true };
  const r = await render(h(AppNavigator));
  const text = allText(r);
  assert.ok(text.includes('Sign in again'), 'heading');
  assert.ok(text.includes('Your sign-in has changed. Sign out, then sign in with your phone number and a new code.'));
  assert.doesNotMatch(text, /password|access code/i);
  assert.ok(!text.includes('Back to sign in'));
  assert.equal(r.root.findAll(n => n.type === 'StackNavigator').length, 0);
  assert.equal(r.root.findAll(n => n.type === 'TextInput').length, 0);
  assert.equal(r.root.findAll(n => n.type === 'ScrollView').length, 1);
  assert.equal(findPressable(r, 'Back'), undefined, 'no back button');

  await press(findPressable(r, 'Sign out'));
  assert.equal(state.logouts, 1);
});

test('the legacy session notice translates into Urdu with a right-to-left heading row', async () => {
  setLanguage('ur');
  state.auth = { ...state.auth, passwordChangeRequired: true };
  const r = await render(h(AppNavigator));
  const text = allText(r);
  assert.ok(text.includes('دوبارہ سائن ان کریں'));
  assert.ok(text.includes('آپ کا سائن ان بدل گیا ہے۔ سائن آؤٹ کریں، پھر اپنے فون نمبر اور نئے کوڈ سے سائن ان کریں۔'));
  assert.ok(text.includes(translate('Sign out', 'ur')));
  const heading = r.root.findAll(n => n.type === 'View' && StyleSheet.flatten(n.props.style)?.height === 56)[0];
  assert.equal(StyleSheet.flatten(heading.props.style).flexDirection, 'row-reverse');
});

test('a message shown through useSnackbar inside the navigator renders, in English and Urdu', async () => {
  let r = await render(h(AppNavigator));
  assert.ok(!allText(r).includes('Tasks could not refresh. Try again.'));
  await press(findPressable(r, 'probe-show'));
  assert.ok(allText(r).includes('Tasks could not refresh. Try again.'));
  assert.equal(r.root.findAll(n => n.props.accessibilityRole === 'alert').length > 0, true);
  await act(async () => r.unmount());

  setLanguage('ur');
  r = await render(h(AppNavigator));
  await press(findPressable(r, 'probe-show'));
  assert.ok(allText(r).includes(translate('Tasks could not refresh. Try again.', 'ur')));
  await act(async () => r.unmount());
});
