import assert from 'node:assert/strict';
import test from 'node:test';
import { installMocks, setLanguage, render, allText, findPressable, press, navigationCalls, resetCalls } from '../support/nativeHarness.mjs';
import { translate } from '../../src/i18n/translations.ts';
import { act } from 'react-test-renderer';

const React = (await import('react')).default;
const h = React.createElement;
const state = { camera: true, location: false, register: async () => 'enabled', cameraThrows: false };
const registerCalls = [];
const settingsCalls = [];
let settingsImpl = async () => {};
let lang = 'en';
installMocks({
  'react-native': { Linking: { openSettings: () => { settingsCalls.push(1); return settingsImpl(); } } },
  '/components/ui/icon': { Icon: props => React.createElement('Icon', props) },
  'expo-camera': { Camera: { getCameraPermissionsAsync: async () => { if (state.cameraThrows) throw new Error('x'); return { granted: state.camera }; } } },
  'expo-location': { getForegroundPermissionsAsync: async () => ({ granted: state.location }) },
  '@react-navigation/native': { useFocusEffect: cb => React.useEffect(cb, [cb]) },
  '/notifications/native': { registerPhoneAlerts: (...args) => { registerCalls.push(args); return state.register(); } },
  '/i18n/LanguageProvider': {
    useLanguage: () => ({ language: lang, isRTL: lang === 'ur', t: (text, values) => translate(text, lang, values), setLanguage() {} }),
  },
});
const { StyleSheet } = await import('react-native');
const { TaskAlertsScreen } = await import('../../src/screens/profile/TaskAlertsScreen.tsx');
const settle = () => act(async () => { await Promise.resolve(); await Promise.resolve(); });
const mount = async () => { const r = await render(h(TaskAlertsScreen)); await settle(); return r; };
test.afterEach(() => {
  lang = 'en'; setLanguage('en'); resetCalls();
  registerCalls.length = 0; settingsCalls.length = 0; settingsImpl = async () => {};
  Object.assign(state, { camera: true, location: false, register: async () => 'enabled', cameraThrows: false });
});

test('before any check the note says registration was not checked and shows no trailer', async () => {
  const r = await mount();
  const text = allText(r);
  assert.match(text, /Task alerts/);
  assert.match(text, /Alert registration has not been checked on this screen\. Your assigned work stays available\./);
  assert.doesNotMatch(text, /Registered does not prove/);
  assert.equal(registerCalls.length, 0);
});

test('a granted camera and a denied location show Allowed and Not allowed', async () => {
  const r = await mount();
  const text = allText(r);
  assert.match(text, /Permissions/);
  assert.match(text, /Camera Allowed/);
  assert.match(text, /Location Not allowed/);
});

test('each permission pill sits in a slot centred in its row', async () => {
  const r = await mount();
  const slots = r.root.findAll(n => n.props.testID === 'permission-pill' && typeof n.type === 'string');
  assert.equal(slots.length, 2);
  for (const slot of slots) {
    const style = StyleSheet.flatten(slot.props.style);
    assert.equal(style.alignSelf, 'center');
    const row = slot.parent;
    assert.equal(StyleSheet.flatten(row.props.style).alignItems, 'center');
  }
});

test('a failing permission read shows Not allowed and never prompts', async () => {
  state.cameraThrows = true;
  const r = await mount();
  assert.match(allText(r), /Camera Not allowed/);
});

test('retry registers once even when pressed twice and shows the enabled message with the trailer', async () => {
  let done;
  state.register = () => new Promise(res => { done = res; });
  const r = await mount();
  await act(async () => { findPressable(r, 'Retry phone alerts').props.onPress(); findPressable(r, 'Retry phone alerts').props.onPress(); });
  assert.equal(registerCalls.length, 1);
  assert.deepEqual(registerCalls[0], ['7_2', 'en', true]);
  assert.equal(findPressable(r, 'Retry phone alerts').props.accessibilityState.busy, true);
  await act(async () => { done('enabled'); });
  const text = allText(r);
  assert.match(text, /Phone alerts registered\./);
  assert.match(text, /Registered does not prove every alert will arrive\. Your work always stays in this app\./);
  assert.doesNotMatch(text, /has not been checked/);
  assert.notEqual(findPressable(r, 'Retry phone alerts').props.accessibilityState?.busy, true);
});

test('denied and unavailable show their existing messages', async () => {
  for (const [value, re] of [['denied', /Phone alerts are denied\. Open settings to allow them\./], ['unavailable', /Phone alerts are unavailable on this device or app configuration\./], ['retry', /Phone alerts could not be confirmed\. Check your connection and retry\./]]) {
    state.register = async () => value;
    const r = await mount();
    await press(findPressable(r, 'Retry phone alerts'));
    assert.match(allText(r), re);
  }
});

test('a thrown error shows the could-not-confirm message and unlocks retry', async () => {
  state.register = async () => { throw new Error('offline'); };
  const r = await mount();
  await press(findPressable(r, 'Retry phone alerts'));
  assert.match(allText(r), /Phone alerts could not be confirmed\. Check your connection and retry\./);
  await press(findPressable(r, 'Retry phone alerts'));
  assert.equal(registerCalls.length, 2);
});

test('Open settings calls Linking.openSettings and shows the fallback when it fails', async () => {
  const r = await mount();
  await press(findPressable(r, 'Open settings'));
  assert.equal(settingsCalls.length, 1);
  assert.doesNotMatch(allText(r), /Open this app in your phone settings\./);
  settingsImpl = async () => { throw new Error('no'); };
  await press(findPressable(r, 'Open settings'));
  await settle();
  assert.equal(settingsCalls.length, 2);
  assert.match(allText(r), /Open this app in your phone settings\./);
});

test('the back button goes back', async () => {
  const r = await mount();
  await press(findPressable(r, 'Back'));
  assert.ok(navigationCalls().some(c => c.name === 'goBack'));
});

test('Urdu shows translated labels and rows run right to left', async () => {
  lang = 'ur'; setLanguage('ur');
  const r = await mount();
  const text = allText(r);
  assert.match(text, /کام کی اطلاعات/);
  assert.match(text, /اجازتیں/);
  assert.match(text, /اجازت ہے/);
  await press(r.root.findAll(n => n.type === 'Pressable' && n.props.onPress && n.props.accessibilityState?.busy !== undefined && n.props.accessibilityLabel !== undefined && n.props.accessibilityLabel !== translate('Open settings', 'ur') && n.props.accessibilityLabel !== translate('Back', 'ur'))[0]);
  assert.deepEqual(registerCalls.at(-1), ['7_2', 'ur', true]);
  assert.ok(r.root.findAll(n => n.type === 'View' && n.props.style && [].concat(n.props.style).flat(Infinity).some(s => s && s.flexDirection === 'row-reverse')).length > 0);
});
