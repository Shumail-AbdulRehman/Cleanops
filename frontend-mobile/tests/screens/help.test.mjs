import assert from 'node:assert/strict';
import test from 'node:test';
import { installMocks, setLanguage, render, allText, findPressable, press, navigationCalls, resetCalls } from '../support/nativeHarness.mjs';

const React = (await import('react')).default;
installMocks({
  '/components/ui/icon': { Icon: props => React.createElement('Icon', props) },
});
const { HelpScreen } = await import('../../src/screens/HelpScreen.tsx');
const { StyleSheet } = await import('react-native');
const h = React.createElement;

const noteRow = r => r.root.findAll(n => n.props.testID === 'help-note')[0];

test.afterEach(() => { setLanguage('en'); resetCalls(); });

test('English help shows the four answers, the permissions answer and the manager note', async () => {
  const r = await render(h(HelpScreen));
  const text = allText(r);
  assert.match(text, /Help/);
  assert.match(text, /How to check in Go to your location\. Tap the yellow button\. Take a selfie\./);
  assert.match(text, /How to finish a task Scan the QR\. Clean\. Scan the same QR\. Take every photo\. Submit\./);
  assert.match(text, /The QR will not scan Turn on the light and hold the phone steady\. If it still fails, ask your manager\./);
  assert.match(text, /I did not get the code Wait one minute and tap Send a new code\. If it still does not come, ask your manager to check your phone number\./);
  assert.match(text, /Permissions Camera and location are required for attendance\. Task photos also require current server authority\. Turning on permissions does not renew expired authority\./);
  assert.match(text, /Ask your manager about your shift, task QR or your phone number\./);
  const rules = r.root.findAll(n => n.type === 'View' && StyleSheet.flatten(n.props.style)?.height === 1);
  assert.equal(rules.length, 4);
});

test('help has no sign-out, alerts, password or account controls; its only action is Back', async () => {
  const r = await render(h(HelpScreen));
  const text = allText(r);
  assert.doesNotMatch(text, /password|access code/i);
  for (const phrase of ['Sign out', 'Task alerts', 'Retry phone alerts', 'Open settings', 'Your account', 'Call']) {
    assert.doesNotMatch(text, new RegExp(phrase));
  }
  const pressables = r.root.findAll(n => n.type === 'Pressable' && typeof n.props.onPress === 'function');
  assert.equal(pressables.length, 1);
  assert.equal(pressables[0].props.accessibilityLabel, 'Back');
});

test('Back calls goBack once and the screen makes no other navigation', async () => {
  const r = await render(h(HelpScreen));
  await press(findPressable(r, 'Back'));
  assert.deepEqual(navigationCalls().map(c => c.name), ['goBack']);
});

test('Urdu translates the title, questions, answers and note, and the note row runs right to left', async () => {
  setLanguage('ur');
  const r = await render(h(HelpScreen));
  const text = allText(r);
  assert.match(text, /مدد/);
  assert.match(text, /کام کیسے مکمل کریں/);
  assert.match(text, /کیو آر اسکین نہیں ہو رہا/);
  assert.match(text, /مجھے کوڈ نہیں ملا/);
  assert.match(text, /ایک منٹ انتظار کریں اور نیا کوڈ بھیجیں دبائیں۔ اگر پھر بھی کوڈ نہ ملے تو اپنے منیجر سے فون نمبر چیک کروائیں۔/);
  assert.match(text, /اپنی شفٹ، کام کے کیو آر یا فون نمبر کے بارے میں اپنے منیجر سے پوچھیں۔/);
  assert.equal(StyleSheet.flatten(noteRow(r).props.style).flexDirection, 'row-reverse');
  const question = r.root.findAll(n => n.type === 'Text' && n.props.children === 'کام کیسے مکمل کریں')[0];
  assert.equal(StyleSheet.flatten(question.props.style).writingDirection, 'rtl');
  assert.equal(StyleSheet.flatten(question.props.style).textAlign, 'right');
});

test('English note row runs left to right', async () => {
  const r = await render(h(HelpScreen));
  assert.equal(StyleSheet.flatten(noteRow(r).props.style).flexDirection, 'row');
});

test('help still renders its answers before the bundled fonts load (system face fallback)', async () => {
  const r = await render(h(HelpScreen), { fontsReady: false });
  assert.match(allText(r), /How to check in/);
  assert.match(allText(r), /Permissions/);
});
