import assert from 'node:assert/strict';
import test from 'node:test';
import { installMocks, setLanguage, setWindowSize, render, allText, findPressable } from '../support/nativeHarness.mjs';

const React = (await import('react')).default;
const { translate } = await import('../../src/i18n/translations.ts');
// The shared harness t() drops placeholder values; the real provider fills them, so stand in the same.
const useLanguage = () => {
  const language = globalThis.__nativeHarness.language;
  return { language, isRTL: language === 'ur', t: (text, values) => translate(text, language, values), setLanguage() {} };
};
installMocks({
  '/components/ui/icon': { Icon: props => React.createElement('Icon', props) },
  '/i18n/LanguageProvider': { useLanguage },
});
const { StyleSheet } = await import('react-native');
const { VerificationProgress, PHOTO_TEXT_MIN_WIDTH } = await import('../../src/screens/verification/VerificationProgress.tsx');

const h = React.createElement;
const styleOf = node => StyleSheet.flatten(node.props.style);
test.afterEach(() => { setLanguage('en'); setWindowSize(390, 844); });

const manifest = {
  task: { id: 1, title: 'Cleaning', status: 'IN_PROGRESS', areaNameSnapshot: 'Block A' },
  items: [{
    id: 'i0', nameSnapshot: 'Mirror', typeSnapshot: 'MIRROR', mandatory: true,
    requirements: [{ id: 'r0', viewKey: 'FRONT', instructionsSnapshot: 'Whole mirror', mandatory: true, state: 'PROCESSING', currentAttempt: null }],
  }],
  session: null,
};
const mount = (props = {}) => render(h(VerificationProgress, { manifest, local: null, rows: [], online: true, lastUpdated: null, onSelect: () => {}, ...props }));
const rowOf = r => r.root.findAll(n => n.type === 'View' && styleOf(n)?.flexWrap === 'wrap')[0];
const textColumn = r => r.root.findAll(n => n.type === 'View' && styleOf(n)?.minWidth !== undefined)[0];

test('the text column has a minimum width and the row lets the pill wrap under the text', async () => {
  const r = await mount();
  const column = styleOf(textColumn(r));
  assert.equal(column.minWidth, PHOTO_TEXT_MIN_WIDTH);
  assert.ok(column.minWidth >= 100);
  assert.equal(column.flexGrow, 1);
  assert.equal(styleOf(rowOf(r)).flexWrap, 'wrap');
});

test('in Urdu the row is reversed and a wrapped pill keeps the start side of the text column', async () => {
  setLanguage('ur');
  const r = await mount();
  assert.equal(styleOf(rowOf(r)).flexDirection, 'row-reverse');
  const wrapper = r.root.findAll(n => n.type === 'View' && typeof n.props.onLayout === 'function')[0];
  assert.equal(styleOf(wrapper)?.alignSelf, undefined);
  const { act } = await import('react-test-renderer');
  act(() => wrapper.props.onLayout({ nativeEvent: { layout: { x: 0, y: 60, width: 100, height: 28 } } }));
  const moved = r.root.findAll(n => n.type === 'View' && typeof n.props.onLayout === 'function')[0];
  assert.equal(styleOf(moved).alignSelf, 'flex-start');
  assert.equal(styleOf(moved).marginRight, 42 + 14);
  assert.equal(styleOf(moved).marginLeft, undefined);
});

test('row side padding is 16 at 360 and 20 at 390', async () => {
  setWindowSize(360, 700);
  assert.equal(styleOf(findPressable(await mount(), 'Mirror, Uploaded, checking')).paddingHorizontal, 16);
  setWindowSize(390, 844);
  assert.equal(styleOf(findPressable(await mount(), 'Mirror, Uploaded, checking')).paddingHorizontal, 20);
});

test('the accessibility label is unchanged', async () => {
  const r = await mount();
  assert.equal(findPressable(r, 'Mirror, Uploaded, checking').props.accessibilityLabel, 'Mirror, Uploaded, checking');
});

test('the footer time is isolated in Urdu', async () => {
  setLanguage('ur');
  const r = await mount({ lastUpdated: new Date(2026, 10, 12, 13, 5).getTime() });
  const footer = allText(r).split(' ').join(' ');
  assert.match(footer, /⁨[^⁨⁩]+⁩/);
  assert.ok(footer.includes(' · ⁨'), footer);
});
