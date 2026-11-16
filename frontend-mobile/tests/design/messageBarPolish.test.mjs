import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { installMocks, setLanguage, render } from '../support/nativeHarness.mjs';
import { act } from 'react-test-renderer';

const React = (await import('react')).default;
const env = { bottom: 0, fontScale: 1, reduced: false, timing: [] };
installMocks({
  '/components/ui/icon': { Icon: props => React.createElement('Icon', props) },
  '@react-native-community/netinfo': { default: { addEventListener: () => () => {} } },
  'react-native-safe-area-context': { useSafeAreaInsets: () => ({ top: 0, bottom: env.bottom, left: 0, right: 0 }) },
  'react-native': { useWindowDimensions: () => ({ width: 360, height: 700, scale: 1, fontScale: env.fontScale }) },
  'react-native-reanimated': {
    useReducedMotion: () => env.reduced,
    withTiming: (value, config) => { env.timing.push({ value, config }); return value; },
  },
});
const { StyleSheet } = await import('react-native');
const { SnackbarProvider, useSnackbar } = await import('../../src/design/Feedback.tsx');
const { whiteAlpha, tabBarHeight, motion, type, space } = await import('../../src/design/tokens.ts');

const h = React.createElement;
const flat = node => StyleSheet.flatten(node.props.style);
test.afterEach(() => { Object.assign(env, { bottom: 0, fontScale: 1, reduced: false, timing: [] }); setLanguage('en'); });

async function shown() {
  const api = {};
  const Trigger = () => { api.current = useSnackbar(); return null; };
  const r = await render(h(SnackbarProvider, null, h(Trigger)));
  await act(async () => { api.current.show('Try again'); });
  return flat(r.root.findAll(n => n.type === 'View' && n.props.accessibilityLiveRegion === 'polite')[0]);
}

test('translucent white tokens carry the design values', () => {
  assert.equal(whiteAlpha.tick, '#ffffff12');
  assert.equal(whiteAlpha.track, '#ffffff29');
  assert.equal(whiteAlpha.block, '#ffffff38');
  assert.equal(whiteAlpha.rail, '#ffffff42');
});

test('Feedback, DayHeader and LanguageToggle use the tokens, not raw or borrowed values', () => {
  const read = f => readFileSync(new URL(`../../src/${f}`, import.meta.url), 'utf8');
  assert.doesNotMatch(read('design/Feedback.tsx'), /rgba\(/);
  assert.match(read('design/Feedback.tsx'), /whiteAlpha\.block/);
  assert.doesNotMatch(read('screens/day/DayHeader.tsx'), /withAlpha/);
  assert.match(read('screens/day/DayHeader.tsx'), /whiteAlpha\.tick/);
  assert.match(read('screens/day/DayHeader.tsx'), /whiteAlpha\.rail/);
  assert.doesNotMatch(read('design/LanguageToggle.tsx'), /cameraButton/);
  assert.match(read('design/LanguageToggle.tsx'), /whiteAlpha\.track/);
});

test('the message bar fades and rises over 200 ms with easeOut', async () => {
  const style = await shown();
  const run = env.timing.at(-1);
  assert.equal(run.value, 1);
  assert.equal(run.config.duration, motion.duration.snack);
  // The first frame is the start of the entry: transparent and 12 low.
  assert.equal(style.opacity, 0);
  assert.equal(style.transform[0].translateY, 12);
});

test('under reduced motion it only fades, in 120 ms, with no rise', async () => {
  env.reduced = true;
  const style = await shown();
  assert.equal(env.timing.at(-1).config.duration, motion.duration.reducedFade);
  assert.equal(style.opacity, 0);
  assert.equal(style.transform[0].translateY, 0);
});

test('the bar sits 12 above the tab bar for every inset and font scale', async () => {
  for (const [bottom, fontScale] of [[0, 1], [34, 1], [48, 1.4], [24, 2]]) {
    Object.assign(env, { bottom, fontScale });
    const style = await shown();
    const bar = tabBarHeight(bottom, type.label.en.lineHeight, fontScale);
    assert.equal(style.bottom, bar + space.snackAboveBar);
    assert.ok(style.bottom >= bar + 12, 'never overlaps the tab bar');
  }
  assert.equal(tabBarHeight(0, 20, 1), 72);
  assert.ok(tabBarHeight(34, 20, 1) === 106);
});
