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
const state = { data: undefined, summary: undefined, isPending: false, isError: false, refetches: 0, logouts: 0 };
installMocks({
  '/components/ui/icon': { Icon: props => React.createElement('Icon', props) },
  '/i18n/LanguageProvider': { useLanguage },
  '@react-native-community/netinfo': { default: { addEventListener: () => () => {} } },
  'expo-application': { nativeApplicationVersion: '1.4.2' },
  '/queries/profile': {
    useStaffProfileQuery: () => ({ data: state.data, isPending: state.isPending, isError: state.isError, refetch: async () => { state.refetches += 1; } }),
  },
  '/queries/history': {
    useProfileSummary: () => ({ data: state.summary, isPending: !state.summary, isError: false, refetch: async () => {} }),
  },
  '/auth/AuthContext': {
    useAuth: () => ({ user: { id: 2, companyId: 7, name: 'Auth Name', email: 'auth@example.invalid' }, logout: async () => { state.logouts += 1; } }),
  },
});
const { ProfileScreen } = await import('../../src/screens/profile/ProfileScreen.tsx');
const { StyleSheet } = await import('react-native');
const h = React.createElement;

const profile = (extra = {}) => ({
  id: 41, name: 'Amina Khan', email: 'amina@example.invalid', phone: '+92 300 1234567', role: 'STAFF', isActive: true,
  companyId: 7, locationId: 1, createdAt: '2025-03-14T08:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', shiftStart: null, shiftEnd: null, ...extra,
});
test.beforeEach(() => {
  Object.assign(state, { data: profile(), summary: undefined, isPending: false, isError: false, refetches: 0, logouts: 0 });
  resetCalls(); setLanguage('en');
});
const FSI = '⁨';
const PDI = '⁩';
const textNode = (r, value) => r.root.findAll(n => n.type === 'Text' && n.props.children === value)[0];
const sign = r => findPressable(r, 'Sign out');

test('details render from the profile query: phone, email, number and joined month year', async () => {
  const r = await render(h(ProfileScreen));
  const text = allText(r);
  assert.ok(text.includes('Amina Khan'));
  assert.ok(text.includes('Cleaning staff'));
  assert.ok(text.includes('Phone'));
  assert.ok(text.includes('+92 300 1234567'));
  assert.ok(text.includes('amina@example.invalid'));
  assert.ok(text.includes('Staff number'));
  assert.ok(text.includes('41'));
  assert.ok(text.includes('March 2025'));
  assert.ok(text.includes('Ask your manager to change these.'));
  assert.ok(text.includes('Version 1.4.2'));
  assert.ok(!text.includes('Details could not load.'));
});

test('a null phone shows "Not recorded"', async () => {
  state.data = profile({ phone: null });
  const r = await render(h(ProfileScreen));
  assert.ok(allText(r).includes('Not recorded'));
});

test('a profile with no email uses summary details in English and Urdu', async () => {
  Object.assign(state, {
    data: null,
    summary: {
      id: 41, name: 'Amina Khan', email: null, phone: '+92 300 1234567', joinedAt: '2025-03-14T08:00:00.000Z',
      company: { name: 'Acme Cleaning' }, location: null, usualShift: null, manager: null,
      month: { month: '2026-11', shiftsScheduled: 0, shiftsAttended: 0, onTime: 0, tasksAssigned: 0, tasksSubmitted: 0 },
    },
  });
  const r = await render(h(ProfileScreen));
  const text = allText(r);
  for (const value of ['Amina Khan', 'No email', '+92 300 1234567', 'Staff number', '41', 'March 2025']) assert.ok(text.includes(value), value);
  assert.doesNotMatch(text, /Details could not load|auth@example\.invalid/);

  setLanguage('ur');
  const urdu = await render(h(ProfileScreen));
  assert.ok(allText(urdu).includes('ای میل نہیں ہے'));
  await press(findPressable(urdu, translate('Sign out', 'ur')));
  assert.ok(allText(urdu).includes('دوبارہ سائن ان کے لیے آپ کا فون نمبر اور ایک نیا کوڈ درکار ہوگا۔'));
});

test('phone and email are isolated left-to-right values, in English and in Urdu', async () => {
  for (const lang of ['en', 'ur']) {
    setLanguage(lang);
    const r = await render(h(ProfileScreen));
    for (const value of ['+92 300 1234567', 'amina@example.invalid']) {
      const node = textNode(r, `${FSI}${value}${PDI}`);
      assert.ok(node, `${value} isolated in ${lang}`);
    }
  }
});

test('company line only when companyName is given', async () => {
  assert.ok(!allText(await render(h(ProfileScreen))).includes('Acme Cleaning'));
  assert.ok(allText(await render(h(ProfileScreen, { companyName: 'Acme Cleaning' }))).includes('Acme Cleaning'));
});

test('Task alerts and Help navigate to their routes, with no Change password row', async () => {
  const r = await render(h(ProfileScreen));
  assert.ok(!allText(r).includes('Change password'));
  for (const label of ['Task alerts', 'Help']) await press(findPressable(r, label));
  assert.deepEqual(navigationCalls().map(c => c.name), ['navigate', 'navigate']);
  assert.deepEqual(navigationCalls().map(c => c.args[0]), ['TaskAlerts', 'HelpGuide']);
});

test('language row shows the English and Urdu toggle', async () => {
  const r = await render(h(ProfileScreen));
  assert.ok(r.root.findAll(n => n.props.accessibilityLabel === 'Language / زبان').length > 0);
  assert.ok(allText(r).includes('اردو'));
});

test('sign out opens the dialog; cancel does not log out; only confirm does', async () => {
  const r = await render(h(ProfileScreen));
  assert.ok(!allText(r).includes('Sign out of this phone?'));
  await press(sign(r));
  assert.ok(allText(r).includes('Sign out of this phone?'));
  assert.ok(allText(r).includes('You will need your phone number and a new code to sign in again.'));
  await press(findPressable(r, 'Cancel'));
  assert.equal(state.logouts, 0);
  assert.ok(!allText(r).includes('Sign out of this phone?'));
  await press(sign(r));
  assert.equal(state.logouts, 0);
  const confirm = r.root.findAll(n => n.type === 'Pressable' && n.props.accessibilityLabel === 'Sign out' && typeof n.props.onPress === 'function').pop();
  await press(confirm);
  assert.equal(state.logouts, 1);
});

test('slots render after the header in order when given, nothing extra when not', async () => {
  const plain = allText(await render(h(ProfileScreen)));
  assert.ok(!plain.includes('TOP-SLOT') && !plain.includes('WORK-SLOT'));
  const r = await render(h(ProfileScreen, { topSlot: h('Text', null, 'TOP-SLOT'), workSlot: h('Text', null, 'WORK-SLOT') }));
  const text = allText(r);
  assert.ok(text.indexOf('Cleaning staff') < text.indexOf('TOP-SLOT'));
  assert.ok(text.indexOf('TOP-SLOT') < text.indexOf('WORK-SLOT'));
  assert.ok(text.indexOf('WORK-SLOT') < text.indexOf('My details'));
});

test('loading shows skeleton rows and no values', async () => {
  Object.assign(state, { data: undefined, isPending: true });
  const r = await render(h(ProfileScreen));
  const text = allText(r);
  assert.ok(text.includes('My details'));
  assert.ok(!text.includes('amina@example.invalid') && !text.includes('Details could not load.'));
  assert.ok(r.root.findAll(n => n.type === 'View' && n.props.accessibilityElementsHidden === true).length >= 4);
});

test('a failed read shows the signed-in name and email, the message and a working Try again', async () => {
  Object.assign(state, { data: undefined, isError: true });
  const r = await render(h(ProfileScreen));
  const text = allText(r);
  assert.ok(text.includes('Auth Name'));
  assert.ok(text.includes('auth@example.invalid'));
  assert.ok(text.includes('Details could not load.'));
  assert.ok(!text.includes('Staff number'));
  await press(findPressable(r, 'Try again'));
  assert.equal(state.refetches, 1);
});

test('Urdu translates labels but not the name; rows run right to left', async () => {
  setLanguage('ur');
  const r = await render(h(ProfileScreen));
  const text = allText(r);
  for (const word of ['صفائی عملہ', 'میری تفصیل', 'فون', 'عملہ نمبر', 'شمولیت', 'مدد', 'ورژن 1.4.2']) assert.ok(text.includes(word), word);
  assert.ok(!text.includes('پاس ورڈ بدلیں'));
  assert.ok(text.includes('Amina Khan'));
  assert.ok(text.includes('نومبر') === false && text.includes('مارچ 2025'));
  const row = findPressable(r, 'مدد');
  assert.equal(StyleSheet.flatten(row.props.style).flexDirection, 'row-reverse');
  assert.ok(row.findAll(n => n.type === 'Icon' && n.props.name === 'ChevronLeft').length === 1);
});

test('English rows run left to right with a right chevron; pressable rows are at least 60 high', async () => {
  const r = await render(h(ProfileScreen));
  const row = findPressable(r, 'Help');
  const style = StyleSheet.flatten(row.props.style);
  assert.equal(style.flexDirection, 'row');
  assert.ok(style.minHeight >= 60);
  assert.equal(row.findAll(n => n.type === 'Icon' && n.props.name === 'ChevronRight').length, 1);
});
