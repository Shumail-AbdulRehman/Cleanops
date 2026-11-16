import assert from 'node:assert/strict';
import test from 'node:test';
import { installMocks, setLanguage, render, allText, findPressable, press, resetCalls } from '../support/nativeHarness.mjs';
import { act } from 'react-test-renderer';

const React = (await import('react')).default;
installMocks({ '/components/ui/icon': { Icon: props => React.createElement('Icon', props) } });
const { StyleSheet } = await import('react-native');
const { Field } = await import('../../src/design/Field.tsx');
const { colors, space } = await import('../../src/design/tokens.ts');

const h = React.createElement;
const styleOf = node => StyleSheet.flatten(node.props.style);
const input = r => r.root.findAll(node => node.type === 'TextInput')[0];
const box = r => r.root.findAll(node => node.type === 'View' && styleOf(node)?.height === space.fieldHeight)[0];
const base = { label: 'Email', value: '', onChangeText: () => {} };

test.afterEach(() => { setLanguage('en'); resetCalls(); });

test('label renders translated and typing calls onChangeText', async () => {
  const seen = [];
  const r = await render(h(Field, { ...base, label: 'New password', kind: 'text', onChangeText: v => seen.push(v) }));
  assert.match(allText(r), /New password/);
  await act(async () => { input(r).props.onChangeText('abc'); });
  assert.deepEqual(seen, ['abc']);
  setLanguage('ur');
  const u = await render(h(Field, { ...base, label: 'Show password' }));
  assert.match(allText(u), /پاس ورڈ دکھائیں/);
});

test('email kind sets keyboard and capitalisation; box is 60 high with the idle border', async () => {
  const r = await render(h(Field, { ...base, kind: 'email' }));
  const i = input(r);
  assert.equal(i.props.keyboardType, 'email-address');
  assert.equal(i.props.autoCapitalize, 'none');
  assert.equal(i.props.autoCorrect, false);
  assert.equal(i.props.secureTextEntry, false);
  const s = styleOf(box(r));
  assert.equal(s.borderColor, colors.lineStrong);
  assert.equal(s.borderWidth, 1.5);
  assert.equal(s.backgroundColor, colors.surface);
});

test('phone uses the phone keypad and telephone autofill in an Urdu layout', async () => {
  setLanguage('ur');
  const r = await render(h(Field, { ...base, label: 'Phone number', kind: 'phone' }));
  const { props } = input(r);
  assert.equal(props.keyboardType, 'phone-pad');
  assert.equal(props.autoComplete, 'tel');
  assert.equal(props.autoCorrect, false);
  assert.equal(styleOf(input(r)).writingDirection, 'ltr');
  assert.equal(styleOf(input(r)).textAlign, 'left');
  assert.equal(r.root.findAllByType('Pressable').length, 0);
});

test('otp uses SMS autofill, stays visible and caps input at six characters', async () => {
  setLanguage('ur');
  const r = await render(h(Field, { ...base, label: '6-digit code', kind: 'otp', maxLength: 128 }));
  const { props } = input(r);
  assert.equal(props.keyboardType, 'number-pad');
  assert.equal(props.autoComplete, 'sms-otp');
  assert.equal(props.maxLength, 6);
  assert.equal(props.secureTextEntry, false);
  assert.equal(styleOf(input(r)).writingDirection, 'ltr');
  assert.equal(styleOf(input(r)).textAlign, 'left');
  assert.equal(r.root.findAllByType('Pressable').length, 0);
});

test('focus gives a 2 blue border', async () => {
  const r = await render(h(Field, base));
  await act(async () => { input(r).props.onFocus(); });
  const s = styleOf(box(r));
  assert.equal(s.borderColor, colors.blue);
  assert.equal(s.borderWidth, 2);
  await act(async () => { input(r).props.onBlur(); });
  assert.equal(styleOf(box(r)).borderColor, colors.lineStrong);
});

test('password starts hidden and the eye toggles with its label', async () => {
  const r = await render(h(Field, { ...base, label: 'New password', kind: 'password' }));
  assert.equal(input(r).props.secureTextEntry, true);
  assert.equal(input(r).props.maxLength, 128);
  await press(findPressable(r, 'Show password'));
  assert.equal(input(r).props.secureTextEntry, false);
  const hide = findPressable(r, 'Hide password');
  assert.ok(hide);
  assert.equal(styleOf(hide).width, 44);
  await press(hide);
  assert.equal(input(r).props.secureTextEntry, true);
});

test('code is secure; url and text have no eye', async () => {
  const c = await render(h(Field, { ...base, kind: 'code' }));
  assert.equal(input(c).props.secureTextEntry, true);
  const u = await render(h(Field, { ...base, kind: 'url' }));
  assert.equal(input(u).props.keyboardType, 'url');
  assert.equal(u.root.findAll(node => node.type === 'Pressable').length, 0);
});

test('error shows below with the bad border, icon and a polite live region', async () => {
  const r = await render(h(Field, { ...base, error: 'Wrong password' }));
  assert.match(allText(r), /Wrong password/);
  const s = styleOf(box(r));
  assert.equal(s.borderColor, colors.bad);
  assert.equal(s.borderWidth, 2);
  assert.equal(r.root.findAll(node => node.type === 'Icon' && node.props.name === 'CircleAlert').length, 1);
  assert.equal(r.root.findAll(node => node.type === 'Text' && node.props.accessibilityLiveRegion === 'polite').length, 1);
});

test('input is left-to-right in Urdu, aligned right, and the row reverses', async () => {
  setLanguage('ur');
  const r = await render(h(Field, { ...base, kind: 'password', accessibilityLabel: 'Email' }));
  const s = styleOf(input(r));
  assert.equal(s.writingDirection, 'ltr');
  assert.equal(s.textAlign, 'right');
  assert.equal(styleOf(box(r)).flexDirection, 'row-reverse');
  assert.equal(input(r).props.accessibilityLabel, 'Email');
});

test('submit, return key, editable and autoFocus pass through', async () => {
  let calls = 0;
  const r = await render(h(Field, { ...base, returnKeyType: 'done', onSubmitEditing: () => { calls += 1; }, editable: false, autoFocus: true }));
  const i = input(r);
  i.props.onSubmitEditing();
  assert.equal(calls, 1);
  assert.equal(i.props.returnKeyType, 'done');
  assert.equal(i.props.editable, false);
  assert.equal(i.props.autoFocus, true);
});
