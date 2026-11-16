import assert from 'node:assert/strict';
import test from 'node:test';
import { installMocks, setLanguage, render, allText, findPressable, press, navigationCalls, resetCalls } from '../support/nativeHarness.mjs';

const React = (await import('react')).default;
const { translate } = await import('../../src/i18n/translations.ts');
const h = React.createElement;
const useLanguage = () => {
  const language = globalThis.__nativeHarness.language;
  return { language, isRTL: language === 'ur', t: (text, values) => translate(text, language, values), setLanguage() {} };
};
const state = { summary: {}, details: undefined };
const navigator = kind => ({
  Navigator: ({ children }) => h(`${kind}Navigator`, null, children),
  Screen: ({ name, component, options }) => h(`${kind}Screen`, { name, options }, h(component, { navigation: {}, route: { name } })),
});
const probe = name => () => h('Text', null, `screen:${name}`);
const summaryData = {
  id: 41, name: 'Amina Khan', email: 'a@example.invalid', phone: null, joinedAt: '2025-03-14',
  company: { name: 'Acme Cleaning' },
  location: { id: 1, name: 'North Tower', address: '1 Main Road', timezone: 'Asia/Karachi' },
  usualShift: { start: '08:00', end: '16:00' }, manager: { name: 'Sara Ali' },
  month: { month: '2026-11', shiftsScheduled: 8, shiftsAttended: 8, onTime: 7, tasksAssigned: 42, tasksSubmitted: 38 },
};
let refetches = 0;
installMocks({
  '@react-navigation/bottom-tabs': { createBottomTabNavigator: () => navigator('Tab') },
  '@react-navigation/native-stack': { createNativeStackNavigator: () => navigator('Stack') },
  '@react-native-community/netinfo': { default: { addEventListener: () => () => {} } },
  'expo-application': { nativeApplicationVersion: '1.0.0' },
  '/components/ui/icon': { Icon: props => h('Icon', props) },
  '/assets/hygene-ops-mark.png': 1,
  '/i18n/LanguageProvider': { useLanguage },
  '/auth/AuthContext': { useAuth: () => ({ user: { id: 2, companyId: 7, name: 'Auth Name', email: 'auth@example.invalid' }, isBootstrapping: false, passwordChangeRequired: false, logout: async () => {} }) },
  '/queries/staff': { useTodaysTasksQuery: () => ({ data: [], counts: undefined }) },
  '/launchApi': { replaceOwnPassword: async () => {}, completeStaffHandoff: async () => {} },
  '/queries/profile': { useStaffProfileQuery: () => ({ data: state.details, isPending: false, isError: false, refetch: async () => {} }) },
  '/queries/history': { useProfileSummary: () => ({ ...state.summary, refetch: async () => { refetches += 1; } }) },
  '/screens/HomeScreen': { HomeScreen: probe('Shift') },
  '/screens/TasksScreen': { TasksScreen: probe('Tasks') },
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
const { StaffTabs } = await import('../../src/navigation/StaffTabs.tsx');
const { AppNavigator } = await import('../../src/navigation/AppNavigator.tsx');
const { ProfileScreen } = await import('../../src/screens/profile/ProfileScreen.tsx');

const names = (r, kind) => r.root.findAll(n => n.type === `${kind}Screen`).map(n => n.props.name);
const details = { id: 41, name: 'Amina Khan', email: 'amina@example.invalid', phone: '+92 300 1234567', createdAt: '2025-03-14T08:00:00.000Z' };

test.beforeEach(() => {
  globalThis.__DEV__ = false;
  state.summary = { data: summaryData, isPending: false, isError: false };
  state.details = details;
  refetches = 0; resetCalls(); setLanguage('en');
});

test('the tab navigator declares Shift, Tasks, History, Profile in that order', async () => {
  const r = await render(h(StaffTabs));
  assert.deepEqual(names(r, 'Tab'), ['Shift', 'Tasks', 'History', 'Profile']);
});

test('the stack declares HistoryTask with its header hidden', async () => {
  const r = await render(h(AppNavigator));
  assert.ok(names(r, 'Stack').includes('HistoryTask'));
  assert.equal(r.root.findAll(n => n.type === 'StackScreen' && n.props.name === 'HistoryTask')[0].props.options.headerShown, false);
});

test('Profile shows the company under the name, the month and work sections, and See my history opens the History tab', async () => {
  const r = await render(h(ProfileScreen));
  const text = allText(r);
  for (const s of ['Acme Cleaning', 'This month', '38 of 42', 'My work', 'North Tower', 'Sara Ali', 'My details']) assert.ok(text.includes(s), s);
  assert.ok(text.indexOf('Acme Cleaning') < text.indexOf('This month'));
  await press(findPressable(r, 'See my history'));
  assert.deepEqual(navigationCalls().map(c => [c.name, c.args[0]]), [['navigate', 'History']]);
});

test('a failed summary shows the section error lines, keeps details and settings, and Try again refetches', async () => {
  state.summary = { data: undefined, isPending: false, isError: true };
  const r = await render(h(ProfileScreen));
  const text = allText(r);
  assert.ok(text.includes('Figures could not load.'));
  assert.ok(text.includes('My work'));
  assert.ok(text.includes('amina@example.invalid'));
  assert.ok(text.includes('Settings and help'));
  assert.ok(!text.includes('Acme Cleaning'));
  const retries = r.root.findAll(n => n.props.accessibilityLabel === 'Try again' && typeof n.props.onPress === 'function');
  await press(retries[0]);
  assert.equal(refetches, 1);
});

test('a pending summary shows skeletons, not errors', async () => {
  state.summary = { data: undefined, isPending: true, isError: false };
  const r = await render(h(ProfileScreen));
  assert.ok(!allText(r).includes('Figures could not load.'));
  assert.equal(r.root.findAll(n => n.props?.testID === 'month-skeleton').length, 3);
});
