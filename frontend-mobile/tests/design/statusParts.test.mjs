import assert from 'node:assert/strict';
import test from 'node:test';
import { installMocks, setLanguage, render, allText } from '../support/nativeHarness.mjs';

const React = (await import('react')).default;
// lucide-react-native needs react-native-svg, which does not load under node: stand in an icon element.
installMocks({ '/components/ui/icon': { Icon: props => React.createElement('Icon', props) } });
const { StyleSheet } = await import('react-native');
const { Pill } = await import('../../src/design/Pill.tsx');
const { StatusMarker } = await import('../../src/design/StatusMarker.tsx');
const { Avatar } = await import('../../src/design/Avatar.tsx');
const { colors } = await import('../../src/design/tokens.ts');
const { displayFor } = await import('../../src/design/taskState.ts');
const { translate } = await import('../../src/i18n/translations.ts');

const h = React.createElement;
const styleOf = node => StyleSheet.flatten(node.props.style);
const views = r => r.root.findAll(node => node.type === 'View');
const texts = r => r.root.findAll(node => node.type === 'Text');
const icons = r => r.root.findAll(node => node.type === 'Icon');
const pillView = r => views(r).map(styleOf).find(s => s.borderRadius === 999);

test.afterEach(() => setLanguage('en'));

const tones = {
  neutral: ['canvas', 'pillText'], blue: ['blueWash', 'blueDeep'], green: ['okWash', 'ok'], needsYou: ['yellow', 'ink'],
  needsYouSoft: ['yellowWash', 'yellowInk'], red: ['badWash', 'bad'], late: ['late', 'ink'], warn: ['warnWash', 'warn'],
};
for (const [tone, [fill, text]] of Object.entries(tones)) {
  test(`pill tone ${tone} uses ${fill} and ${text}`, async () => {
    const r = await render(h(Pill, { tone, label: 'Verified' }));
    assert.equal(pillView(r).backgroundColor, colors[fill]);
    assert.equal(styleOf(texts(r)[0]).color, colors[text]);
    assert.equal(texts(r)[0].props.numberOfLines, 1);
    if (tone === 'warn') {
      assert.equal(pillView(r).borderWidth, 1.5);
      assert.equal(pillView(r).borderColor, colors.warn);
    } else assert.equal(pillView(r).borderWidth, undefined);
  });
}

test('late pill uses the late token, not yellow', async () => {
  const r = await render(h(Pill, { tone: 'late', label: 'Late' }));
  assert.equal(pillView(r).backgroundColor, colors.late);
  assert.notEqual(pillView(r).backgroundColor, colors.yellow);
});

test('pill shows a 14 icon, spins when asked, and is Urdu RTL with 9 padding', async () => {
  const r = await render(h(Pill, { tone: 'blue', label: 'Saved, uploading', icon: 'Loader', spinning: true }));
  assert.equal(icons(r)[0].props.size, 14);
  assert.equal(pillView(r).paddingHorizontal, 10);
  setLanguage('ur');
  const u = await render(h(Pill, { tone: 'green', label: 'Verified' }));
  assert.equal(allText(u), translate('Verified', 'ur'));
  assert.equal(pillView(u).flexDirection, 'row-reverse');
  assert.equal(pillView(u).paddingHorizontal, 9);
});

test('a position marker shows 3 on canvas with muted text and is hidden from accessibility', async () => {
  const d = displayFor('notStarted');
  const r = await render(h(StatusMarker, { marker: d.marker, tone: d.markerTone, position: 3, hiddenLabel: d.hiddenLabel }));
  const marker = r.root.findAll(n => n.type === 'View' && n.props.accessibilityElementsHidden === true)[0];
  assert.ok(marker);
  assert.equal(styleOf(marker).width, 34);
  assert.equal(styleOf(marker).backgroundColor, colors.canvas);
  const number = texts(r).find(n => n.children.join('') === '3');
  assert.equal(styleOf(number).color, colors.muted);
  assert.equal(styleOf(number).fontSize, 15);
  assert.match(allText(r), /Not started/);
  assert.equal(icons(r).length, 0);
});

test('hidden label is outside the hidden marker and translated in Urdu', async () => {
  setLanguage('ur');
  const r = await render(h(StatusMarker, { marker: 'position', tone: 'canvas', position: 1, hiddenLabel: 'Not started' }));
  const hidden = r.root.findAll(n => n.type === 'View' && n.props.accessibilityElementsHidden === true)[0];
  assert.equal(hidden.findAll(n => n.type === 'Text' && n.children.join('') === translate('Not started', 'ur')).length, 0);
  assert.ok(texts(r).some(n => n.children.join('') === translate('Not started', 'ur')));
});

const shapes = [
  ['doubleTick', 'ok', 'CheckCheck', 'surface'], ['tick', 'blue', 'Check', 'surface'], ['droplet', 'blueWash', 'Droplets', 'blue'],
  ['camera', 'yellow', 'Camera', 'ink'], ['clock', 'yellow', 'Clock', 'ink'], ['cross', 'badWash', 'X', 'bad'],
];
for (const [marker, tone, icon, glyph] of shapes) {
  test(`${marker} marker on ${tone} uses ${icon} at 18`, async () => {
    const r = await render(h(StatusMarker, { marker, tone }));
    const node = icons(r)[0];
    assert.equal(node.props.name, icon);
    assert.equal(node.props.size, 18);
    assert.equal(node.props.color, colors[glyph]);
    const fill = r.root.findAll(n => n.type === 'View' && n.props.accessibilityElementsHidden === true)[0];
    assert.equal(styleOf(fill).backgroundColor, colors[tone]);
    assert.equal(styleOf(fill).borderRadius, 17);
    assert.equal(styleOf(fill).borderWidth, undefined);
  });
}

test('every displayFor kind renders a marker', async () => {
  for (const kind of ['notStarted', 'inProgress', 'photosNeeded', 'retake', 'overdue', 'submitted', 'waitingForReview', 'verified', 'acceptedWithExceptions', 'missed', 'cancelled']) {
    const d = displayFor(kind);
    const r = await render(h(StatusMarker, { marker: d.marker, tone: d.markerTone, position: 1 }));
    assert.ok(r.root.findAll(n => n.type === 'View' && n.props.accessibilityElementsHidden === true).length === 1, kind);
  }
});

test('avatar renders an icon at 56 percent on tintBg and no text', async () => {
  for (const [size, glyph] of [[44, 25], [38, 21], [76, 43]]) {
    const r = await render(h(Avatar, { size }));
    const circle = views(r).map(styleOf).find(s => s.width === size);
    assert.equal(circle.backgroundColor, colors.tintBg);
    assert.equal(circle.borderRadius, size / 2);
    assert.equal(icons(r)[0].props.name, 'UserRound');
    assert.equal(icons(r)[0].props.size, glyph);
    assert.equal(icons(r)[0].props.color, colors.tintFg);
    assert.equal(texts(r).length, 0);
    assert.equal(r.root.findAll(n => n.type === 'View')[0].props.accessible, false);
  }
});
