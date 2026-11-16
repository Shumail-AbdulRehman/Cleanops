import assert from 'node:assert/strict';
import test from 'node:test';
import { installMocks, setLanguage, render, allText, findPressable, press, hapticsCalls, resetCalls } from '../support/nativeHarness.mjs';

const React = (await import('react')).default;
const { act } = await import('react-test-renderer');

// Reduced motion is switched per test; every withTiming call is recorded with its config.
let reduced = false;
const timings = [];
installMocks({
  // lucide-react-native needs react-native-svg, which does not load under node: stand in an icon element.
  '/components/ui/icon': { Icon: props => React.createElement('Icon', props) },
  'react-native-reanimated': {
    useReducedMotion: () => reduced,
    withTiming: (value, config) => { timings.push({ value, config }); return value; },
  },
});
const { StyleSheet } = await import('react-native');
const { NativeFontsReady } = await import('../../src/fonts.ts');
const { BottomSheet } = await import('../../src/design/BottomSheet.tsx');
const { ConfirmDialog } = await import('../../src/design/ConfirmDialog.tsx');
const { ActionButton } = await import('../../src/design/ActionButton.tsx');
const { colors, motion } = await import('../../src/design/tokens.ts');
const { translate } = await import('../../src/i18n/translations.ts');

const h = React.createElement;
const styleOf = node => StyleSheet.flatten(node.props.style);
const modalOf = r => r.root.findAll(node => node.type === 'Modal')[0];
const sheetOf = r => r.root.findAll(node => node.type === 'View' && node.props.accessibilityViewIsModal === true)[0];
const update = async (r, element) => { await act(async () => { r.update(h(NativeFontsReady.Provider, { value: true }, element)); }); };

const counter = () => { const fn = () => { fn.calls += 1; }; fn.calls = 0; return fn; };

const sheet = (props = {}) => h(BottomSheet, {
  visible: true,
  glyph: 'Navigation',
  title: 'GPS signal is weak',
  body: 'Move near a window and try again.',
  actions: [
    h(ActionButton, { kind: 'next', label: 'Try again', onPress: props.onTry ?? (() => {}) }),
    h(ActionButton, { kind: 'ghost', label: 'Close', onPress: props.onClose ?? (() => {}) }),
  ],
  ...props,
});

test.afterEach(() => { setLanguage('en'); resetCalls(); reduced = false; timings.length = 0; });

test('a hidden sheet renders nothing', async () => {
  const r = await render(sheet({ visible: false, onDismiss: () => {} }));
  assert.equal(r.toJSON(), null);
  const d = await render(h(ConfirmDialog, { visible: false, title: 'Sign out of this phone?', confirmLabel: 'Sign out', onConfirm: () => {}, onCancel: () => {} }));
  assert.equal(d.toJSON(), null);
});

test('a visible sheet renders title, body, glyph and both actions, which call their handlers', async () => {
  const onTry = counter();
  const onClose = counter();
  const r = await render(sheet({ onDismiss: () => {}, onTry, onClose }));
  const text = allText(r);
  assert.match(text, /GPS signal is weak/);
  assert.match(text, /Move near a window and try again\./);
  const modal = modalOf(r);
  assert.equal(modal.props.transparent, true);
  assert.equal(modal.props.statusBarTranslucent, true);
  await press(findPressable(r, 'Try again'));
  await press(findPressable(r, 'Close'));
  assert.equal(onTry.calls, 1);
  assert.equal(onClose.calls, 1);
  const icon = r.root.findAll(node => node.type === 'Icon').find(node => node.props.name === 'Navigation');
  assert.equal(icon.props.size, 26);
  assert.equal(icon.props.color, colors.yellowInk);
  const tile = r.root.findAll(node => node.type === 'View').map(styleOf).filter(Boolean).find(s => s.width === 50 && s.height === 50);
  assert.equal(tile.backgroundColor, colors.yellowWash);
  const sheetStyle = styleOf(sheetOf(r));
  assert.equal(sheetStyle.backgroundColor, colors.surface);
  assert.equal(sheetStyle.borderTopLeftRadius, 26);
  const header = r.root.findAll(node => node.type === 'View' && node.props.accessibilityRole === 'header')[0];
  assert.ok(header.findAll(node => node.type === 'Text').some(node => node.children.join('') === 'GPS signal is weak'), 'title is the header');
});

test('glyph tones map to the design tiles', async () => {
  const r = await render(sheet({ glyphTone: 'red', onDismiss: () => {} }));
  const tile = r.root.findAll(node => node.type === 'View').map(styleOf).filter(Boolean).find(s => s.width === 50 && s.height === 50);
  assert.equal(tile.backgroundColor, colors.badWash);
  assert.equal(r.root.findAll(node => node.type === 'Icon')[0].props.color, colors.bad);
});

test('Android back and the scrim call onDismiss', async () => {
  const onDismiss = counter();
  const r = await render(sheet({ onDismiss }));
  await act(async () => { modalOf(r).props.onRequestClose(); });
  assert.equal(onDismiss.calls, 1);
  const scrim = r.root.findAll(node => node.type === 'Pressable' && node.props.onPress === onDismiss)[0];
  assert.ok(scrim, 'scrim is pressable');
  await press(scrim);
  assert.equal(onDismiss.calls, 2);
  assert.equal(sheetOf(r).props.onAccessibilityEscape, onDismiss);
});

test('without onDismiss, back does nothing and the scrim is not pressable', async () => {
  const onTry = counter();
  const r = await render(sheet({ onTry }));
  await act(async () => { modalOf(r).props.onRequestClose(); });
  assert.equal(onTry.calls, 0);
  assert.equal(r.toJSON() !== null, true, 'sheet stays shown');
  // Only the two action buttons are pressable.
  assert.equal(r.root.findAll(node => node.type === 'Pressable').length, 2);
});

test('a warning haptic fires once per opening, not on re-render', async () => {
  const warnings = () => hapticsCalls().filter(c => c.name === 'notificationAsync');
  const r = await render(sheet({ visible: false, haptic: 'warning' }));
  assert.equal(warnings().length, 0);
  await update(r, sheet({ visible: true, haptic: 'warning' }));
  await update(r, sheet({ visible: true, haptic: 'warning', body: 'Still weak.' }));
  assert.deepEqual(warnings().map(c => c.args[0]), ['warning']);
  await update(r, sheet({ visible: false, haptic: 'warning' }));
  await update(r, sheet({ visible: true, haptic: 'warning' }));
  assert.equal(warnings().length, 2);
  const plain = await render(sheet({}));
  assert.ok(plain);
  assert.equal(warnings().length, 2, 'no haptic without the prop');
});

test('the sheet slides up from below over 280 ms with the drawer curve', async () => {
  const r = await render(sheet({ onDismiss: () => {} }));
  assert.equal(styleOf(sheetOf(r)).transform[0].translateY, 844, 'starts below the window');
  const slide = timings.find(t => t.config.duration === motion.duration.sheet);
  assert.ok(slide, 'slide configured');
  assert.equal(slide.value, 0);
  assert.ok(timings.some(t => t.config.duration === motion.duration.scrim && t.value === 1), 'scrim fades in');
});

test('under reduced motion no slide animation is configured; the sheet fades over 120 ms', async () => {
  reduced = true;
  const r = await render(sheet({ onDismiss: () => {} }));
  assert.equal(timings.some(t => t.config.duration === motion.duration.sheet), false);
  assert.equal(styleOf(sheetOf(r)).transform[0].translateY, 0);
  assert.ok(timings.some(t => t.config.duration === motion.duration.reducedFade && t.value === 1));
  const d = await render(h(ConfirmDialog, { visible: true, title: 'Sign out of this phone?', confirmLabel: 'Sign out', onConfirm: () => {}, onCancel: () => {} }));
  assert.equal(timings.some(t => t.config.duration === motion.duration.dialog), false);
  assert.equal(styleOf(sheetOf(d)).transform[0].scale, 1);
});

test('custom children render between the heading and the actions; no glyph tile without a glyph', async () => {
  const r = await render(h(BottomSheet, {
    visible: true,
    onDismiss: () => {},
    title: 'Tuesday',
    children: h('View', { testID: 'day-facts' }),
    actions: h(ActionButton, { kind: 'outline', label: 'Close', onPress: () => {} }),
  }));
  assert.ok(r.root.findAll(node => node.props.testID === 'day-facts').length === 1);
  assert.equal(r.root.findAll(node => node.type === 'Icon').length, 0);
  assert.ok(findPressable(r, 'Close'));
});

test('Urdu sheet shows Urdu text and reverses the heading row', async () => {
  setLanguage('ur');
  const r = await render(sheet({ onDismiss: () => {} }));
  const urduTitle = translate('GPS signal is weak', 'ur');
  assert.notEqual(urduTitle, 'GPS signal is weak');
  assert.ok(allText(r).includes(urduTitle));
  assert.ok(findPressable(r, translate('Try again', 'ur')));
  assert.ok(r.root.findAll(node => node.type === 'View').map(styleOf).filter(Boolean).some(s => s.flexDirection === 'row-reverse' && s.gap === 14));
});

test('ConfirmDialog calls onConfirm and onCancel; back cancels; destructive confirm is red', async () => {
  const onConfirm = counter();
  const onCancel = counter();
  const r = await render(h(ConfirmDialog, {
    visible: true,
    title: 'Sign out of this phone?',
    body: 'You will need your email and password to sign in again.',
    confirmLabel: 'Sign out',
    cancelLabel: 'Cancel',
    destructive: true,
    onConfirm,
    onCancel,
  }));
  const text = allText(r);
  assert.match(text, /Sign out of this phone\?/);
  assert.match(text, /You will need your email and password/);
  await press(findPressable(r, 'Sign out'));
  assert.equal(onConfirm.calls, 1);
  await press(findPressable(r, 'Cancel'));
  assert.equal(onCancel.calls, 1);
  await act(async () => { modalOf(r).props.onRequestClose(); });
  assert.equal(onCancel.calls, 2);
  const label = findPressable(r, 'Sign out').findAll(node => node.type === 'Text')[0];
  assert.equal(styleOf(label).color, colors.bad);
  const cancelLabel = findPressable(r, 'Cancel').findAll(node => node.type === 'Text')[0];
  assert.equal(styleOf(cancelLabel).color, colors.blueDeep);
  const card = styleOf(sheetOf(r));
  assert.equal(card.borderRadius, 26);
  assert.equal(card.transform[0].scale, 0.96, 'opens from 0.96');
  assert.ok(timings.some(t => t.config.duration === motion.duration.dialog && t.value === 1));
});

test('ConfirmDialog is not red unless destructive, and its buttons sit on the left in Urdu', async () => {
  const r = await render(h(ConfirmDialog, { visible: true, title: 'Sign out of this phone?', confirmLabel: 'Sign out', onConfirm: () => {}, onCancel: () => {} }));
  const label = findPressable(r, 'Sign out').findAll(node => node.type === 'Text')[0];
  assert.equal(styleOf(label).color, colors.blueDeep);
  assert.ok(findPressable(r, 'Cancel'), 'cancel label defaults to Cancel');
  setLanguage('ur');
  const u = await render(h(ConfirmDialog, { visible: true, title: 'Sign out of this phone?', confirmLabel: 'Sign out', onConfirm: () => {}, onCancel: () => {} }));
  assert.ok(allText(u).includes(translate('Sign out of this phone?', 'ur')));
  assert.ok(findPressable(u, translate('Cancel', 'ur')));
  const row = u.root.findAll(node => node.type === 'View').map(styleOf).filter(Boolean).find(s => s.justifyContent === 'flex-end' && s.marginTop === 18);
  assert.equal(row.flexDirection, 'row-reverse');
});
