import assert from 'node:assert/strict';
import test from 'node:test';
import { installMocks, setLanguage, setWindowSize, render, allText, findPressable, press, navigationCalls, hapticsCalls, resetCalls } from "./nativeHarness.mjs";

installMocks({ 'react-native': { useWindowDimensions: () => ({ width: 360, height: 700, scale: 1, fontScale: 1 }) } });
const { View, Text, Pressable, useWindowDimensions } = await import('react-native');
const { useLanguage } = await import('../../src/i18n/LanguageProvider');
const { useAuth } = await import('../../src/auth/AuthContext');
const { useNavigation } = await import('@react-navigation/native');
const Haptics = await import('expo-haptics');
const React = (await import('react')).default;
const { translate } = await import('../../src/i18n/translations.ts');
let pressed = 0;
function Probe() {
  const { t, isRTL } = useLanguage(); const { user } = useAuth(); const navigation = useNavigation(); const { width } = useWindowDimensions();
  return React.createElement(View, null,
    React.createElement(Text, null, t('Check in')),
    React.createElement(Text, null, `${user.name}|${isRTL}|${width}`),
    React.createElement(Pressable, { accessibilityLabel: 'Go', onPress: () => { pressed++; navigation.navigate('Tasks', { id: 1 }); Haptics.selectionAsync(); } }, React.createElement(Text, null, 'Go now')));
}

test('English renders, press calls handler, navigation and haptics are recorded', async () => {
  setLanguage('en'); resetCalls();
  const renderer = await render(React.createElement(Probe));
  assert.match(allText(renderer), /Check in/);
  assert.match(allText(renderer), /Synthetic staff\|false\|360/);
  await press(findPressable(renderer, 'Go'));
  await press(findPressable(renderer, 'Go now'));
  assert.equal(pressed, 2);
  assert.deepEqual(navigationCalls()[0], { name: 'navigate', args: ['Tasks', { id: 1 }] });
  assert.equal(hapticsCalls()[0].name, 'selectionAsync');
});

test('Urdu renders the real translation', async () => {
  setLanguage('ur');
  const renderer = await render(React.createElement(Probe));
  const urdu = translate('Check in', 'ur');
  assert.notEqual(urdu, 'Check in');
  assert.ok(allText(renderer).includes(urdu));
  assert.match(allText(renderer), /\|true\|/);
  setLanguage('en');
});

test('useWindowDimensions can be overridden to 360 wide', async () => {
  const renderer = await render(React.createElement(Probe));
  assert.match(allText(renderer), /\|360 /);
});

test('setWindowSize is ignored when a test overrides useWindowDimensions, and resetCalls clears records', async () => {
  setWindowSize(320, 600);
  const renderer = await render(React.createElement(Probe));
  assert.match(allText(renderer), /\|360 /);
  resetCalls();
  assert.equal(navigationCalls().length, 0);
  assert.equal(hapticsCalls().length, 0);
});
