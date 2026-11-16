import assert from 'node:assert/strict';
import test from 'node:test';
import { installMocks, setLanguage, render, allText, findPressable, press, hapticsCalls, resetCalls } from '../support/nativeHarness.mjs';

const React = (await import('react')).default;
// lucide-react-native needs react-native-svg, which does not load under node: stand in an icon element.
installMocks({ '/components/ui/icon': { Icon: props => React.createElement('Icon', props) } });
const { StyleSheet } = await import('react-native');
const { ActionButton, ActionDock, DockStatus } = await import('../../src/design/ActionButton.tsx');
const { colors, space } = await import('../../src/design/tokens.ts');
const { translate } = await import('../../src/i18n/translations.ts');

const h = React.createElement;
const styleOf = node => StyleSheet.flatten(node.props.style);
const views = r => r.root.findAll(node => node.type === 'View');

test.afterEach(() => { setLanguage('en'); resetCalls(); });

test('next renders the label, calls onPress and one light haptic', async () => {
  let calls = 0;
  const r = await render(h(ActionButton, { kind: 'next', label: 'Check in', onPress: () => { calls += 1; } }));
  assert.match(allText(r), /Check in/);
  const button = findPressable(r, 'Check in');
  await press(button);
  assert.equal(calls, 1);
  assert.deepEqual(hapticsCalls().map(c => [c.name, c.args[0]]), [['impactAsync', 'light']]);
  const fill = views(r).map(styleOf).find(s => s.height === space.actionHeight);
  assert.equal(fill.backgroundColor, colors.yellow);
});

test('form has no haptic by default, blue fill and white label', async () => {
  let calls = 0;
  const r = await render(h(ActionButton, { kind: 'form', label: 'Sign in', onPress: () => { calls += 1; } }));
  await press(findPressable(r, 'Sign in'));
  assert.equal(calls, 1);
  assert.equal(hapticsCalls().length, 0);
  assert.equal(views(r).map(styleOf).find(s => s.height === space.actionHeight).backgroundColor, colors.blue);
  const label = r.root.findAll(node => node.type === 'Text')[0];
  assert.equal(styleOf(label).color, colors.surface);
});

test('ghost is 52 high with no fill and a blueDeep label', async () => {
  const r = await render(h(ActionButton, { kind: 'ghost', label: 'Try again', onPress: () => {} }));
  const style = views(r).map(styleOf).find(s => s.height === space.ghostHeight);
  assert.equal(style.backgroundColor, undefined);
  assert.equal(styleOf(r.root.findAll(node => node.type === 'Text')[0]).color, colors.blueDeep);
});

test('busy ignores a press, reports busy and keeps the label', async () => {
  let calls = 0;
  const r = await render(h(ActionButton, { kind: 'next', label: 'Check in', busy: true, onPress: () => { calls += 1; } }));
  const button = findPressable(r, 'Check in');
  await press(button);
  assert.equal(calls, 0);
  assert.equal(hapticsCalls().length, 0);
  assert.equal(button.props.accessibilityState.busy, true);
  assert.equal(r.root.findAll(node => node.type === 'ActivityIndicator').length, 1);
  assert.match(allText(r), /Check in/);
});

test('accessibilityLabel overrides the translated label', async () => {
  const r = await render(h(ActionButton, { kind: 'outline', label: 'Check in', accessibilityLabel: 'Check in now', onPress: () => {} }));
  assert.ok(findPressable(r, 'Check in now'));
});

test('ActionDock shows the hint above the child', async () => {
  const r = await render(h(ActionDock, { hint: 'Check in' }, h(ActionButton, { kind: 'next', label: 'Check in', onPress: () => {} })));
  const text = allText(r);
  assert.ok(text.indexOf('Check in') < text.lastIndexOf('Check in'));
  const dock = styleOf(r.root.findAll(node => node.type === 'View')[0]);
  assert.equal(dock.backgroundColor, colors.surface);
  assert.equal(dock.paddingBottom, space.dockPadBottom);
});

test('DockStatus is not pressable, announces politely and shows its label', async () => {
  const r = await render(h(DockStatus, { label: 'Internet needed to continue' }));
  assert.equal(r.root.findAll(node => node.type === 'Pressable').length, 0);
  const node = r.root.findAll(node => node.props.accessibilityLiveRegion === 'polite' && node.type === 'View')[0];
  assert.equal(node.props.accessibilityRole, 'text');
  assert.match(allText(r), /Internet needed to continue/);
});

test('DockStatus becomes pressable only when given onPress', async () => {
  const r = await render(h(DockStatus, { label: 'Waiting', onPress: () => {} }));
  assert.equal(r.root.findAll(node => node.type === 'Pressable').length, 1);
});

test('Urdu reverses the row and shows the Urdu label', async () => {
  setLanguage('ur');
  const r = await render(h(ActionButton, { kind: 'next', label: 'Check in', icon: 'LogIn', onPress: () => {} }));
  assert.ok(allText(r).includes(translate('Check in', 'ur')));
  assert.equal(views(r).map(styleOf).find(s => s.height === space.actionHeight).flexDirection, 'row-reverse');
  const s = await render(h(DockStatus, { label: 'Waiting', icon: 'Clock' }));
  assert.ok(views(s).map(styleOf).some(x => x.flexDirection === 'row-reverse'));
});
