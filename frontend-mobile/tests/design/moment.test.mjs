import assert from 'node:assert/strict';
import test from 'node:test';
import { installMocks, setLanguage, render, allText, hapticsCalls, resetCalls } from '../support/nativeHarness.mjs';

const React = (await import('react')).default;
const flags = { reduced: false, timings: 0 };
// lucide and react-native-svg do not load under node: stand in plain elements.
installMocks({
  '/components/ui/icon': { Icon: props => React.createElement('Icon', props) },
  'react-native-svg': {
    __esModule: true, default: 'Svg', Svg: 'Svg', Path: 'Path',
  },
  'react-native-reanimated': {
    useReducedMotion: () => flags.reduced,
    useAnimatedProps: factory => factory(),
    withTiming: value => { flags.timings += 1; return value; },
  },
});
const { Moment } = await import('../../src/design/Moment.tsx');
const { NativeFontsReady } = await import('../../src/fonts.ts');
const { colors } = await import('../../src/design/tokens.ts');
const { translate } = await import('../../src/i18n/translations.ts');

const h = React.createElement;
const props = {
  badge: 'green', title: 'Work submitted', subtitle: '4:12 PM', pill: { tone: 'green', label: 'Verified' },
  facts: [{ label: 'Location', value: 'Main Office' }, { label: 'Time', value: '4:12 PM' }],
  action: h('Pressable', { accessibilityLabel: 'Done', onPress: () => {} }),
};
const nodes = (r, type) => r.root.findAll(n => n.type === type);

test.beforeEach(() => { flags.reduced = false; flags.timings = 0; resetCalls(); });
test.afterEach(() => setLanguage('en'));

test('shows title, subtitle, pill and every fact', async () => {
  const r = await render(h(Moment, props));
  const text = allText(r);
  for (const s of ['Work submitted', '4:12 PM', 'Verified', 'Location', 'Main Office', 'Time']) assert.ok(text.includes(s), s);
  assert.ok(r.root.findAll(n => n.props.accessibilityLabel === 'Done').length > 0);
});

test('badge colour follows the prop and the tick is drawn with svg', async () => {
  const g = await render(h(Moment, props));
  const badge = nodes(g, 'View').find(n => n.props.style && [].concat(n.props.style).flat(Infinity).some(s => s && s.width === 96));
  assert.ok(badge);
  assert.ok([].concat(badge.props.style).flat(Infinity).some(s => s && s.backgroundColor === colors.ok));
  assert.equal(nodes(g, 'Path').length, 1);
  const b = await render(h(Moment, { ...props, badge: 'blue', icon: 'Send' }));
  assert.equal(nodes(b, 'Icon')[0].props.name, 'Send');
  assert.equal(nodes(b, 'Path').length, 0);
});

test('entered-name value is not translated under Urdu, labels are', async () => {
  setLanguage('ur');
  const r = await render(h(Moment, { ...props, facts: [{ label: 'Location', value: 'Verified' }] }));
  const text = allText(r);
  assert.ok(text.includes(translate('Location', 'ur')));
  assert.ok(text.includes('Verified'));
  assert.ok(!nodes(r, 'Text').some(n => n.children.join('') === translate('Verified', 'ur') && n.props.accessibilityRole !== undefined));
  const row = nodes(r, 'View').find(n => [].concat(n.props.style).flat(Infinity).some(s => s && s.minHeight === 48));
  assert.ok([].concat(row.props.style).flat(Infinity).some(s => s && s.flexDirection === 'row-reverse'));
});

test('one success haptic on mount, not again on re-render', async () => {
  const r = await render(h(Moment, props));
  assert.deepEqual(hapticsCalls().map(c => [c.name, c.args[0]]), [['notificationAsync', 'success']]);
  const { act } = await import('react-test-renderer');
  await act(async () => { r.update(h(NativeFontsReady.Provider, { value: true }, h(Moment, { ...props, subtitle: '5:00 PM' }))); });
  assert.equal(hapticsCalls().length, 1);
});

test('reduced motion starts no timing animation but still fires one haptic', async () => {
  flags.reduced = true;
  const r = await render(h(Moment, props));
  assert.equal(flags.timings, 0);
  assert.equal(hapticsCalls().length, 1);
  assert.ok(allText(r).includes('Work submitted'));
  flags.reduced = false;
  await render(h(Moment, props));
  assert.ok(flags.timings > 0);
});

test('title is a live region only when live is set', async () => {
  const on = await render(h(Moment, { ...props, live: true }));
  assert.ok(nodes(on, 'Text').some(n => n.props.accessibilityLiveRegion === 'polite' && n.children.join('') === 'Work submitted'));
  const off = await render(h(Moment, props));
  assert.ok(!nodes(off, 'Text').some(n => n.props.accessibilityLiveRegion === 'polite'));
});
