import assert from 'node:assert/strict';
import test from 'node:test';
import { installMocks, setLanguage, render, allText, findPressable, press } from '../support/nativeHarness.mjs';

const React = (await import('react')).default;
const languageCalls = [];
const state = { language: 'en' };
const { translate } = await import('../../src/i18n/translations.ts');
installMocks({
  '/components/ui/icon': { Icon: props => React.createElement('Icon', props) },
  '/i18n/LanguageProvider': {
    useLanguage: () => ({
      language: state.language, isRTL: state.language === 'ur',
      t: text => translate(text, state.language), setLanguage: l => languageCalls.push(l),
    }),
  },
});
const { StyleSheet } = await import('react-native');
const { TopBar } = await import('../../src/design/TopBar.tsx');
const { SegmentedControl } = await import('../../src/design/SegmentedControl.tsx');
const { LanguageToggle } = await import('../../src/design/LanguageToggle.tsx');
const { colors } = await import('../../src/design/tokens.ts');

const h = React.createElement;
const lang = l => { state.language = l; setLanguage(l); };
test.afterEach(() => { lang('en'); languageCalls.length = 0; });

test('TopBar shows the title and calls onBack', async () => {
  let backs = 0;
  const r = await render(h(TopBar, { title: 'Attendance', onBack: () => { backs += 1; } }));
  assert.match(allText(r), /Attendance/);
  await press(findPressable(r, 'Back'));
  assert.equal(backs, 1);
});

test('TopBar translated-off title stays as entered and trailing renders', async () => {
  const r = await render(h(TopBar, { title: 'Ward 7', translateTitle: false, onBack() {}, trailing: h('Marker', { testID: 'tr' }) }));
  assert.match(allText(r), /Ward 7/);
  assert.equal(r.root.findAll(n => n.props.testID === 'tr').length > 0, true);
});

test('TopBar back icon is mirrored only in Urdu', async () => {
  const flat = r => StyleSheet.flatten(r.root.find(n => n.props.testID === 'top-bar-back-icon').props.style);
  assert.equal(flat(await render(h(TopBar, { title: 'Attendance', onBack() {} })))?.transform, undefined);
  lang('ur');
  const r = await render(h(TopBar, { title: 'Attendance', onBack() {} }));
  assert.deepEqual(flat(r).transform, [{ scaleX: -1 }]);
  assert.equal(StyleSheet.flatten(r.root.findAll(n => n.type === 'View')[0].props.style).flexDirection, 'row-reverse');
});

const options = [{ value: 'a', label: 'Photos' }, { value: 'b', label: 'Tasks' }];
test('SegmentedControl marks the selected tab and reports the pressed value', async () => {
  const seen = [];
  const r = await render(h(SegmentedControl, { options, value: 'a', onChange: v => seen.push(v), accessibilityLabel: 'View' }));
  const tabs = r.root.findAll(n => n.props.accessibilityRole === 'tab' && n.props.onPress);
  assert.deepEqual(tabs.map(t => t.props.accessibilityState.selected), [true, false]);
  assert.equal(r.root.findAll(n => n.props.accessibilityRole === 'tablist').length > 0, true);
  await press(tabs[1]);
  assert.deepEqual(seen, ['b']);
});

test('SegmentedControl reverses order in Urdu', async () => {
  lang('ur');
  const r = await render(h(SegmentedControl, { options, value: 'a', onChange() {}, accessibilityLabel: 'View' }));
  const group = r.root.find(n => n.props.accessibilityRole === 'tablist');
  assert.equal(StyleSheet.flatten(group.props.style).flexDirection, 'row-reverse');
});

for (const appearance of ['onBlue', 'onWhite']) {
  for (const l of ['en', 'ur']) {
    test(`LanguageToggle ${appearance} in ${l} shows both names and switches language`, async () => {
      lang(l);
      const r = await render(h(LanguageToggle, { appearance }));
      assert.match(allText(r), /English/);
      assert.match(allText(r), /اردو/);
      assert.ok(r.root.findAll(n => n.props.accessibilityLabel === 'Language / زبان').length > 0);
      await press(findPressable(r, 'اردو'));
      assert.deepEqual(languageCalls, ['ur']);
      await press(findPressable(r, 'English'));
      assert.deepEqual(languageCalls, ['ur', 'en']);
    });
  }
}

test('LanguageToggle onBlue marks the active segment white with blueDeep text', async () => {
  const r = await render(h(LanguageToggle, { appearance: 'onBlue' }));
  const en = findPressable(r, 'English');
  assert.equal(StyleSheet.flatten(en.props.style).backgroundColor, colors.surface);
  const text = en.findAll(n => n.type === 'Text')[0];
  assert.equal(StyleSheet.flatten(text.props.style).color, colors.blueDeep);
});

test('SegmentedControl fill shares the track, content sizes to labels, neither truncates', async () => {
  const fs = await import('node:fs');
  const src = fs.readFileSync(new URL('../../src/design/SegmentedControl.tsx', import.meta.url), 'utf8');
  assert.ok(!/numberOfLines|ellipsizeMode/.test(src), 'labels must not be set to truncate');
  assert.match(src, /fit = 'fill'/);
  assert.match(src, /segmentFill:\s*\{\s*flex:\s*1\s*\}/);
  const content = src.match(/segmentContent:\s*\{[^}]*\}/)[0];
  assert.match(content, /flexShrink:\s*0/);
  assert.ok(!/flex:\s*1/.test(content));
  assert.match(src, /trackContent:\s*\{\s*flexShrink:\s*0/);
  assert.match(src, /minWidth:\s*space\.touchMin/);
  const lt = fs.readFileSync(new URL('../../src/design/LanguageToggle.tsx', import.meta.url), 'utf8');
  assert.match(lt, /fit="content"/);
});
