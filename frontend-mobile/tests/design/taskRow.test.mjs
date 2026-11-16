import assert from 'node:assert/strict';
import test from 'node:test';
import { installMocks, setLanguage, setWindowSize, render, allText, findPressable, press } from '../support/nativeHarness.mjs';

const React = (await import('react')).default;
installMocks({ '/components/ui/icon': { Icon: props => React.createElement('Icon', props) } });
const { StyleSheet } = await import('react-native');
const { TaskRow } = await import('../../src/design/TaskRow.tsx');
const { colors } = await import('../../src/design/tokens.ts');
const { translate } = await import('../../src/i18n/translations.ts');

const h = React.createElement;
const styleOf = node => StyleSheet.flatten(node.props.style);
const icons = r => r.root.findAll(node => node.type === 'Icon');
const START = '2026-11-11T07:30:00.000Z'; // 12:30 PM in Asia/Karachi
const END = '2026-11-11T08:30:00.000Z';
const base = { name: 'Lobby', kind: 'notStarted', position: 3, start: START, end: END, timeZone: 'Asia/Karachi', onPress() {} };

test.afterEach(() => { setLanguage('en'); setWindowSize(390, 844); });

test('a not-started row shows its position and no pill', async () => {
  const r = await render(h(TaskRow, base));
  assert.ok(r.root.findAll(n => n.type === 'Text' && n.children.join('') === '3').length === 1);
  assert.ok(!allText(r).includes('Retake photo'));
  assert.ok(r.root.findAll(n => n.type === 'View' && styleOf(n).borderRadius === 999).length === 0);
});

test('a retake row shows the Retake photo pill', async () => {
  const r = await render(h(TaskRow, { ...base, kind: 'retake' }));
  assert.ok(allText(r).includes('Retake photo'));
});

test('the time reads 12:30 – 1:30 PM in Asia/Karachi', async () => {
  const r = await render(h(TaskRow, base));
  assert.ok(allText(r).includes('12:30 – 1:30 PM'));
});

test('compact sets min height 64; default is 76', async () => {
  const c = await render(h(TaskRow, { ...base, compact: true }));
  assert.ok(c.root.findAll(n => n.type === 'View' && styleOf(n).minHeight === 64 && styleOf(n).paddingVertical === 8).length === 1);
  const n = await render(h(TaskRow, base));
  assert.ok(n.root.findAll(v => v.type === 'View' && styleOf(v).minHeight === 76 && styleOf(v).paddingVertical === 13).length === 1);
});

test('wide window shows the chevron, with padding 20 and separator inset 68', async () => {
  const r = await render(h(TaskRow, base));
  assert.equal(icons(r).length, 1);
  assert.equal(icons(r)[0].props.name, 'ChevronRight');
  assert.ok(r.root.findAll(v => v.type === 'View' && styleOf(v).paddingHorizontal === 20 && styleOf(v).gap === 14).length === 1);
  assert.ok(r.root.findAll(v => v.type === 'View' && styleOf(v).left === 68 && styleOf(v).backgroundColor === colors.line).length === 1);
});

test('at width 360 the chevron is absent, padding 16, gap 12, separator inset 62', async () => {
  setWindowSize(360, 700);
  const r = await render(h(TaskRow, base));
  assert.equal(icons(r).length, 0);
  assert.ok(r.root.findAll(v => v.type === 'View' && styleOf(v).paddingHorizontal === 16 && styleOf(v).gap === 12).length === 1);
  assert.ok(r.root.findAll(v => v.type === 'View' && styleOf(v).left === 62).length === 1);
});

test('separator false draws no hairline', async () => {
  const r = await render(h(TaskRow, { ...base, separator: false }));
  assert.equal(r.root.findAll(v => v.type === 'View' && styleOf(v).backgroundColor === colors.line).length, 0);
});

test('accessibility label has name, status and time; pressing calls onPress', async () => {
  let pressed = 0;
  const r = await render(h(TaskRow, { ...base, kind: 'retake', onPress: () => { pressed += 1; } }));
  const node = r.root.findAll(n => n.type === 'Pressable')[0];
  assert.equal(node.props.accessibilityRole, 'button');
  assert.equal(node.props.accessibilityLabel, 'Lobby, Retake photo, 12:30 – 1:30 PM');
  await press(findPressable(r, node.props.accessibilityLabel));
  assert.equal(pressed, 1);
  const plain = await render(h(TaskRow, base));
  assert.match(plain.root.findAll(n => n.type === 'Pressable')[0].props.accessibilityLabel, /^Lobby, Not started, /);
});

test('pressed row uses the soft background', async () => {
  const r = await render(h(TaskRow, base));
  const node = r.root.findAll(n => n.type === 'Pressable')[0];
  assert.equal(styleOf(node).backgroundColor, colors.surface);
  const { act } = await import('react');
  await act(async () => { node.props.onPressIn(); });
  assert.equal(styleOf(r.root.findAll(n => n.type === 'Pressable')[0]).backgroundColor, colors.soft);
});

test('Urdu keeps the name untranslated, translates the pill, reverses the row and mirrors the arrow', async () => {
  setLanguage('ur');
  const r = await render(h(TaskRow, { ...base, kind: 'retake' }));
  const text = allText(r);
  assert.ok(text.includes('Lobby'));
  assert.ok(text.includes(translate('Retake photo', 'ur')));
  assert.ok(r.root.findAll(v => v.type === 'View' && styleOf(v).flexDirection === 'row-reverse' && styleOf(v).minHeight === 76).length === 1);
  assert.equal(icons(r).at(-1).props.name, 'ChevronLeft');
  assert.ok(r.root.findAll(v => v.type === 'View' && styleOf(v).right === 68).length === 1);
});
