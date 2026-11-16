import assert from 'node:assert/strict';
import test from 'node:test';
import { installMocks, setLanguage, setWindowSize, render, allText } from '../support/nativeHarness.mjs';

installMocks();
const React = (await import('react')).default;
const { StyleSheet } = await import('react-native');
const { StaffText, NameLine, LabeledName, isolate } = await import('../../src/design/StaffText.tsx');
const { type, colors } = await import('../../src/design/tokens.ts');
const { translate } = await import('../../src/i18n/translations.ts');

const h = React.createElement;
const texts = renderer => renderer.root.findAll(node => node.type === 'Text');
const styleOf = node => StyleSheet.flatten(node.props.style);
const textOf = node => node.children.join('');

test.afterEach(() => { setLanguage('en'); setWindowSize(390); });

test('body in English uses the English token size, line height and Inter regular', async () => {
  setLanguage('en');
  const [node] = texts(await render(h(StaffText, { role: 'body' }, 'Check in')));
  const style = styleOf(node);
  assert.equal(style.fontSize, 16);
  assert.equal(style.lineHeight, 23);
  assert.equal(style.fontSize, type.body.en.size);
  assert.equal(style.fontFamily, 'HygeneInter');
  assert.equal(style.color, colors.ink);
  assert.equal(style.textAlign, 'left');
  assert.equal(style.writingDirection, 'ltr');
  assert.deepEqual(style.fontVariant, ['tabular-nums']);
  assert.equal(textOf(node), 'Check in');
});

test('body in Urdu translates and uses the Urdu token size, line height and Noto face', async () => {
  setLanguage('ur');
  const [node] = texts(await render(h(StaffText, { role: 'body' }, 'Check in')));
  const style = styleOf(node);
  assert.equal(style.fontSize, 17);
  assert.equal(style.fontSize, type.body.ur.size);
  assert.equal(style.lineHeight, type.body.ur.lineHeight);
  assert.equal(style.fontFamily, 'HygeneArabic');
  assert.equal(textOf(node), translate('Check in', 'ur'));
  assert.notEqual(textOf(node), 'Check in');
  assert.equal(style.writingDirection, 'rtl');
});

test('a Latin-only child in Urdu keeps the Inter face and English line height', async () => {
  setLanguage('ur');
  const [node] = texts(await render(h(StaffText, { role: 'body', translate: false }, 'Lobby and reception')));
  const style = styleOf(node);
  assert.equal(style.fontFamily, 'HygeneInter');
  assert.equal(style.lineHeight, type.body.en.lineHeight);
});

test('translate false leaves English text untranslated under Urdu', async () => {
  setLanguage('ur');
  const renderer = await render(h(StaffText, { role: 'body', translate: false }, 'Check in'));
  assert.equal(allText(renderer), 'Check in');
});

test('title roles follow tokens: Urdu nowTitle is smaller but taller than English, and compact applies', async () => {
  setLanguage('ur');
  let [node] = texts(await render(h(StaffText, { role: 'nowTitle' }, 'Check in')));
  assert.equal(styleOf(node).fontSize, type.nowTitle.ur.size);
  assert.equal(styleOf(node).lineHeight, type.nowTitle.ur.lineHeight);
  assert.equal(styleOf(node).fontFamily, 'HygeneArabicBold');
  [node] = texts(await render(h(StaffText, { role: 'nowTitle', compact: true }, 'Check in')));
  assert.equal(styleOf(node).fontSize, type.nowTitle.ur.compact.size);
  setLanguage('en');
  [node] = texts(await render(h(StaffText, { role: 'nowTitle' }, 'Check in')));
  assert.equal(styleOf(node).fontSize, type.nowTitle.en.size);
  assert.equal(styleOf(node).fontFamily, 'HygeneManropeExtraBold');
});

test('nowTitleLong defaults to the role max lines', async () => {
  const [node] = texts(await render(h(StaffText, { role: 'nowTitleLong', translate: false }, 'A very long entered area name here')));
  assert.equal(node.props.numberOfLines, 3);
});

test('input and badge keep the Latin face in Urdu', async () => {
  setLanguage('ur');
  const [input] = texts(await render(h(StaffText, { role: 'input', translate: false }, '0300')));
  assert.equal(styleOf(input).fontFamily, 'HygeneInter');
  const [badge] = texts(await render(h(StaffText, { role: 'badge', translate: false }, '3')));
  assert.equal(styleOf(badge).fontFamily, 'HygeneInterBold');
});

test('calendarHead in Urdu uses the narrow sizes below 375 wide', async () => {
  setLanguage('ur');
  setWindowSize(360);
  const [node] = texts(await render(h(StaffText, { role: 'calendarHead' }, 'Monday')));
  assert.equal(styleOf(node).fontSize, type.calendarHead.ur.narrow.size);
});

test('align start is right in Urdu and left in English; end mirrors; center stays', async () => {
  setLanguage('ur');
  let [node] = texts(await render(h(StaffText, { role: 'meta', align: 'start' }, 'Check in')));
  assert.equal(styleOf(node).textAlign, 'right');
  [node] = texts(await render(h(StaffText, { role: 'meta', align: 'end' }, 'Check in')));
  assert.equal(styleOf(node).textAlign, 'left');
  setLanguage('en');
  [node] = texts(await render(h(StaffText, { role: 'meta', align: 'end' }, 'Check in')));
  assert.equal(styleOf(node).textAlign, 'right');
  [node] = texts(await render(h(StaffText, { role: 'meta', align: 'center' }, 'Check in')));
  assert.equal(styleOf(node).textAlign, 'center');
});

test('font scaling stays on and is capped at 1.4 only for action, label, badge and calendarHead', async () => {
  for (const role of ['action', 'label', 'badge', 'calendarHead']) {
    const [node] = texts(await render(h(StaffText, { role }, 'Check in')));
    assert.equal(node.props.allowFontScaling, true);
    assert.equal(node.props.maxFontSizeMultiplier, 1.4, role);
  }
  const [body] = texts(await render(h(StaffText, { role: 'body' }, 'Check in')));
  assert.equal(body.props.allowFontScaling, true);
  assert.equal(body.props.maxFontSizeMultiplier, undefined);
});

test('colour, accessibility role and live region pass through; layout style is kept', async () => {
  const [node] = texts(await render(h(StaffText, {
    role: 'label', color: 'blueDeep', accessibilityRole: 'header', accessibilityLiveRegion: 'polite', style: { marginTop: 4 },
  }, 'Check in')));
  assert.equal(styleOf(node).color, colors.blueDeep);
  assert.equal(styleOf(node).marginTop, 4);
  assert.equal(node.props.accessibilityRole, 'header');
  assert.equal(node.props.accessibilityLiveRegion, 'polite');
});

test('before fonts load the system face is used with a matching weight', async () => {
  const [node] = texts(await render(h(StaffText, { role: 'action' }, 'Check in'), { fontsReady: false }));
  assert.equal(styleOf(node).fontFamily, 'sans-serif');
  assert.equal(styleOf(node).fontWeight, '800');
});

test('isolate wraps text in first-strong isolate marks', () => {
  assert.equal(isolate('9:30 AM'), '⁨9:30 AM⁩');
});

test('NameLine renders the isolated name untranslated, aligned to start', async () => {
  setLanguage('ur');
  const [node] = texts(await render(h(NameLine, { role: 'rowTitle', name: 'Check in' })));
  assert.equal(textOf(node), isolate('Check in'));
  assert.equal(styleOf(node).textAlign, 'right');
});

test('LabeledName in English renders one text with the isolated name in the label', async () => {
  setLanguage('en');
  const renderer = await render(h(LabeledName, { role: 'body', labelKey: 'Next: {area}', name: 'Lobby and reception' }));
  const nodes = texts(renderer);
  assert.equal(nodes.length, 1);
  assert.equal(textOf(nodes[0]), `Next: ${isolate('Lobby and reception')}`);
});

test('LabeledName in Urdu renders the label then the isolated name on its own line', async () => {
  setLanguage('ur');
  const renderer = await render(h(LabeledName, { role: 'body', labelKey: 'Next: {area}', name: 'Lobby and reception' }));
  const nodes = texts(renderer);
  assert.equal(nodes.length, 2);
  const label = textOf(nodes[0]);
  assert.equal(label, translate('Next: {area}', 'ur').replace('{area}', '').trim());
  assert.ok(label.endsWith(':'));
  assert.ok(!label.includes('Lobby'));
  assert.equal(textOf(nodes[1]), isolate('Lobby and reception'));
  assert.equal(styleOf(nodes[0]).fontFamily, 'HygeneArabic');
  assert.equal(styleOf(nodes[1]).fontFamily, 'HygeneInter');
});
