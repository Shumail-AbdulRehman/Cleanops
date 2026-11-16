import assert from 'node:assert/strict';
import test from 'node:test';
import { randomInt } from 'node:crypto';
import { installMocks, render, allText, findPressable, press } from '../support/nativeHarness.mjs';
import { translate } from '../../src/i18n/translations.ts';
import { act } from 'react-test-renderer';

const React = (await import('react')).default;
const h = React.createElement;
let lang = 'en';
const subs = new Set();
const store = { subscribe: f => { subs.add(f); return () => subs.delete(f); }, get: () => lang };
const setLang = value => { lang = value; subs.forEach(f => f()); };
const phone = '+923001234567';
const requestCalls = [];
let verifyCalls = 0;
let requestImpl = async () => ({ phone, expiresInSeconds: 300, resendAfterSeconds: 0 });
let verifyImpl = async () => {};
let server = 'https://example.test/api';
let saveImpl = async address => address;
const listeners = {};
installMocks({
  'react-native': {
    Keyboard: { addListener: (name, fn) => { listeners[name] = fn; return { remove() {} }; } },
    KeyboardAvoidingView: 'KeyboardAvoidingView',
  },
  '/components/ui/icon': { Icon: props => React.createElement('Icon', props) },
  '/assets/hygene-ops-mark.png': 1,
  '/i18n/LanguageProvider': {
    useLanguage: () => {
      const language = React.useSyncExternalStore(store.subscribe, store.get);
      return { language, isRTL: language === 'ur', t: (text, values) => translate(text, language, values), setLanguage: setLang };
    },
  },
  '/auth/AuthContext': {
    useAuth: () => ({
      requestCode: number => { requestCalls.push(number); return requestImpl(number); },
      signInWithCode: (...args) => { verifyCalls++; return verifyImpl(...args); },
    }),
  },
  '/api/client': { changeApiServerAddress: address => saveImpl(address) },
  '/api/serverAddress': { getServerAddress: () => server, loadServerAddress: async () => server },
  '/config': { API_BASE_URL: 'https://example.test/api' },
});
const { LoginScreen } = await import('../../src/screens/LoginScreen.tsx');
const StyleSheet = { flatten: v => (Array.isArray(v) ? Object.assign({}, ...v.flat(Infinity).filter(Boolean)) : v) };
const inputs = r => r.root.findAll(n => n.type === 'TextInput');
const renderers = [];
const mount = async () => {
  const r = await render(h(LoginScreen));
  renderers.push(r);
  return r;
};
const fill = (r, value) => act(async () => { inputs(r)[0].props.onChangeText(value); });
const tap = (r, label) => press(findPressable(r, label));
const openCodeStep = async () => {
  const r = await mount();
  await fill(r, ' 0300 1234567 ');
  await tap(r, 'Send code');
  return r;
};
const candidate = () => randomInt(1_000_000).toString().padStart(6, '0');
const rejection = (code, values) => ({ response: { data: { errors: [{ code, ...values }] } } });
test.afterEach(async () => {
  await act(async () => { renderers.splice(0).forEach(r => r.unmount()); });
  setLang('en');
  requestCalls.length = 0;
  verifyCalls = 0;
  requestImpl = async () => ({ phone, expiresInSeconds: 300, resendAfterSeconds: 0 });
  verifyImpl = async () => {};
  saveImpl = async address => address;
  server = 'https://example.test/api';
});

test('the phone step shows the brand, heading, phone field and Send code action', async () => {
  const r = await mount();
  assert.match(allText(r), /Hygene Ops/);
  assert.equal(r.root.findByProps({ accessibilityRole: 'header' }).props.children, 'Staff sign in');
  assert.equal(inputs(r).length, 1);
  assert.equal(inputs(r)[0].props.accessibilityLabel, 'Phone number');
  assert.equal(inputs(r)[0].props.placeholder, '0300 1234567');
  assert.equal(findPressable(r, 'Send code').props.accessibilityRole, 'button');
  assert.ok(findPressable(r, 'Show connection settings'));
});

test('empty and obviously short numbers show the inline message without requesting a code', async () => {
  const r = await mount();
  await tap(r, 'Send code');
  assert.match(allText(r), /Enter your phone number\./);
  await fill(r, '03');
  await tap(r, 'Send code');
  assert.match(allText(r), /Enter your phone number\./);
  assert.equal(requestCalls.length, 0);
});

test('a successful request shows the code step and uses the server phone to verify once', async () => {
  const r = await openCodeStep();
  assert.deepEqual(requestCalls, ['0300 1234567']);
  assert.match(allText(r), /Enter the 6-digit code we sent to 0300 1234567\./);
  assert.equal(inputs(r)[0].props.accessibilityLabel, '6-digit code');
  const input = candidate();
  verifyImpl = async (number, submitted) => {
    assert.equal(number, phone);
    assert.equal(submitted === input, true);
  };
  await fill(r, input);
  await tap(r, 'Sign in');
  assert.equal(verifyCalls, 1);
  assert.doesNotMatch(allText(r), /Unable to sign in/);
});

test('a short or nonnumeric code shows the inline message without verifying', async () => {
  const r = await openCodeStep();
  await fill(r, 'abcxyz');
  await tap(r, 'Sign in');
  assert.equal(verifyCalls, 0);
  assert.match(allText(r), /Enter the 6-digit code\./);
});

test('a nonregistered phone shows the contract message on the phone step', async () => {
  requestImpl = async () => { throw rejection('PHONE_NOT_REGISTERED'); };
  const r = await openCodeStep();
  assert.equal(inputs(r)[0].props.accessibilityLabel, 'Phone number');
  assert.match(allText(r), /This number is not registered\. Ask your manager to add you\./);
});

test('a wrong or expired code shows the contract message on the code step', async () => {
  const r = await openCodeStep();
  verifyImpl = async () => { throw rejection('CODE_WRONG', { attemptsLeft: 3 }); };
  await fill(r, candidate());
  await tap(r, 'Sign in');
  assert.match(allText(r), /That code is not right\. 3 tries left\./);
  verifyImpl = async () => { throw rejection('CODE_EXPIRED'); };
  await tap(r, 'Sign in');
  assert.match(allText(r), /This code has expired\. Ask for a new code\./);
  assert.equal(inputs(r)[0].props.accessibilityLabel, '6-digit code');
});

test('resend stays disabled until the server wait ends and announces only the initial count', async t => {
  t.mock.timers.enable({ apis: ['Date', 'setInterval'] });
  requestImpl = async () => ({ phone, expiresInSeconds: 300, resendAfterSeconds: 2 });
  const r = await openCodeStep();
  const disabled = () => r.root.findAll(n => n.type === 'View' && n.props.accessibilityRole === 'button'
    && n.props.accessibilityLabel === 'Send a new code' && n.props.accessibilityState?.disabled);
  const announcements = () => r.root.findAll(n => n.type === 'Text' && n.props.accessibilityLiveRegion === 'polite');
  assert.equal(disabled().length, 1);
  assert.match(allText(r), /You can ask for a new code in 2 seconds\./);
  assert.equal(announcements().length, 1);
  await tap(r, 'Send a new code');
  assert.equal(requestCalls.length, 1);

  await act(async () => { t.mock.timers.tick(1000); });
  assert.equal(disabled().length, 1);
  assert.match(allText(r), /You can ask for a new code in 1 seconds\./);
  assert.equal(announcements().length, 0);
  await act(async () => { t.mock.timers.tick(1000); });
  assert.equal(disabled().length, 0);
  await tap(r, 'Send a new code');
  assert.deepEqual(requestCalls, ['0300 1234567', phone]);
  assert.equal(disabled().length, 1);
});

test('Change number returns to the phone step and keeps what was entered', async () => {
  const r = await openCodeStep();
  await tap(r, 'Change number');
  assert.equal(inputs(r)[0].props.accessibilityLabel, 'Phone number');
  assert.equal(inputs(r)[0].props.value, ' 0300 1234567 ');
  assert.ok(findPressable(r, 'Send code'));
});

test('the button is busy while requesting and a second tap is ignored', async () => {
  let release;
  requestImpl = () => new Promise(resolve => { release = resolve; });
  const r = await mount();
  await fill(r, '0300 1234567');
  await tap(r, 'Send code');
  assert.equal(findPressable(r, 'Send code').props.accessibilityState.busy, true);
  await tap(r, 'Send code');
  assert.equal(requestCalls.length, 1);
  await act(async () => { release({ phone, expiresInSeconds: 300, resendAfterSeconds: 0 }); });
  assert.ok(findPressable(r, 'Sign in'));
});

test('a local connection failure keeps the server-address hint', async () => {
  server = 'http://192.168.1.10:8080/api';
  requestImpl = async () => { throw { code: 'ERR_NETWORK' }; };
  const r = await openCodeStep();
  assert.match(allText(r), /Server: http:\/\/192\.168\.1\.10:8080\/api/);
  assert.match(allText(r), /Check that your phone and server are on the same network/);
});

test('connection settings expand, show the address and an invalid save shows the error', async () => {
  saveImpl = async () => { throw new Error('Enter a valid server address.'); };
  const r = await mount();
  await press(findPressable(r, 'Show connection settings'));
  assert.match(allText(r), /https:\/\/example\.test\/api/);
  await press(findPressable(r, 'Change server address'));
  await act(async () => { inputs(r)[1].props.onChangeText('nope'); });
  await press(findPressable(r, 'Save address'));
  assert.match(allText(r), /Enter a valid server address\./);
  await press(findPressable(r, 'Cancel'));
  assert.ok(findPressable(r, 'Change server address'));
  assert.ok(findPressable(r, 'Hide connection settings'));
});

test('a valid server address is saved and shown', async () => {
  saveImpl = async address => `${address}/ok`;
  const r = await mount();
  await press(findPressable(r, 'Show connection settings'));
  await press(findPressable(r, 'Change server address'));
  await act(async () => { inputs(r)[1].props.onChangeText('http://10.0.0.2:8080/api'); });
  await press(findPressable(r, 'Save address'));
  assert.match(allText(r), /http:\/\/10\.0\.0\.2:8080\/api\/ok/);
});

test('the language toggle switches to Urdu, translates the title and reverses rows', async () => {
  const r = await mount();
  await press(findPressable(r, 'اردو'));
  const text = allText(r);
  assert.match(text, /عملے کا سائن ان/);
  assert.match(text, /سائن ان/);
  const rows = r.root.findAll(n => n.type === 'View' && StyleSheet.flatten(n.props.style)?.flexDirection === 'row-reverse');
  assert.ok(rows.length > 0);
});

test('the keyboard height is added to the bottom padding on Android', async () => {
  const r = await mount();
  const scroll = () => r.root.findByType('ScrollView').props.contentContainerStyle.paddingBottom;
  const before = scroll();
  await act(async () => listeners.keyboardDidShow({ endCoordinates: { height: 300 } }));
  assert.equal(scroll(), before + 300);
});
