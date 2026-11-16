import assert from 'node:assert/strict';
import test from 'node:test';
import { installMocks, setLanguage, render, allText, findPressable, press, resetCalls } from '../support/nativeHarness.mjs';

const React = (await import('react')).default;
const harness = globalThis.__nativeHarness;
const { translate } = await import('../../src/i18n/translations.ts');
// lucide and react-native-svg do not load under node: stand in plain elements.
installMocks({
  '/components/ui/icon': { Icon: props => React.createElement('Icon', props) },
  'react-native-svg': { __esModule: true, default: 'Svg', Svg: 'Svg', Path: 'Path' },
  'react-native-reanimated': { useReducedMotion: () => false, useAnimatedProps: factory => factory() },
  // The default harness t() drops placeholder values; this screen fills {id} and {time}.
  '/i18n/LanguageProvider': {
    useLanguage: () => {
      return {
        language: harness.language, isRTL: harness.language === 'ur', setLanguage: () => {},
        t: (text, values) => translate(text, harness.language, values),
      };
    },
  },
});
const { StyleSheet } = await import('react-native');
const { colors } = await import('../../src/design/tokens.ts');
const { SubmissionReceipt } = await import('../../src/screens/verification/SubmissionReceipt.tsx');

const h = React.createElement;
const plain = s => s.replace(/[⁨⁩]/g, '');
const text = r => plain(allText(r));
const texts = r => r.root.findAll(n => n.type === 'Text').map(n => plain(n.children.filter(c => typeof c === 'string').join('')));
const styleOf = node => StyleSheet.flatten(node.props.style) ?? {};

const base = {
  taskId: 42,
  areaName: 'Toilet',
  submittedAt: '2026-11-11T16:12:00.000Z',
  timeZone: 'UTC',
  photosReceived: 3,
  photosRequired: 4,
  hasNextTask: true,
  onNext: () => {},
  onDone: () => {},
};

function handlers() {
  const calls = [];
  return { calls, onNext: () => calls.push('onNext'), onDone: () => calls.push('onDone') };
}

test.afterEach(() => { setLanguage('en'); resetCalls(); });

test('shows the title, the time subtitle and the four facts in English', async () => {
  const r = await render(h(SubmissionReceipt, base));
  const all = texts(r);
  assert.ok(all.includes('Work submitted'));
  assert.ok(all.includes('Submitted at 4:12 PM. Your manager may still review it.'));
  assert.ok(all.includes('Task 42'));
  assert.ok(all.includes('Toilet'), 'area name shown as given');
  assert.ok(all.includes('Photos received'));
  assert.ok(all.includes('3 / 4'));
  assert.ok(all.includes('Submitted'));
  assert.ok(all.includes('Verified'));
});

test('Submitted and Verified are separate pills: "Yes" blue, "Not yet" neutral', async () => {
  const r = await render(h(SubmissionReceipt, base));
  // Walk up from each answer's text to the pill that holds it (the first View with a fill).
  const pillOf = label => {
    let node = r.root.findAll(x => x.type === 'Text' && plain(x.children.join('')) === label)[0];
    while (node && !(node.type === 'View' && styleOf(node).backgroundColor)) node = node.parent;
    return node;
  };
  const yes = pillOf('Yes');
  const notYet = pillOf('Not yet');
  assert.ok(yes && notYet, 'each answer sits in its own pill');
  assert.notEqual(yes, notYet);
  assert.equal(styleOf(yes).backgroundColor, colors.blueWash);
  assert.equal(styleOf(notYet).backgroundColor, colors.canvas);
});

test('with a next task the action says "Next task" and calls onNext only', async () => {
  const h1 = handlers();
  const r = await render(h(SubmissionReceipt, { ...base, onNext: h1.onNext, onDone: h1.onDone, hasNextTask: true }));
  assert.ok(texts(r).includes('Next task'));
  assert.equal(findPressable(r, 'Back to my day'), undefined);
  await press(findPressable(r, 'Next task'));
  assert.deepEqual(h1.calls, ['onNext']);
});

test('without a next task the action says "Back to my day" and calls onDone only', async () => {
  const h1 = handlers();
  const r = await render(h(SubmissionReceipt, { ...base, onNext: h1.onNext, onDone: h1.onDone, hasNextTask: false }));
  assert.ok(texts(r).includes('Back to my day'));
  assert.equal(findPressable(r, 'Next task'), undefined);
  await press(findPressable(r, 'Back to my day'));
  assert.deepEqual(h1.calls, ['onDone']);
});

test('Urdu translates the labels and keeps the area name untranslated', async () => {
  setLanguage('ur');
  const r = await render(h(SubmissionReceipt, base));
  const all = texts(r);
  assert.ok(all.includes(translate('Work submitted', 'ur')));
  assert.ok(all.includes(translate('Photos received', 'ur')));
  assert.ok(all.includes(translate('Next task', 'ur')));
  assert.ok(all.includes('Toilet'), 'entered area name is not translated');
  assert.ok(!all.includes(translate('Toilet', 'ur')));
  assert.ok(all.includes('3 / 4'));
  assert.ok(all.includes(translate('Yes', 'ur')));
  assert.ok(all.includes(translate('Not yet', 'ur')));
  assert.ok(allText(r).includes(translate('Submitted at {time}. Your manager may still review it.', 'ur', { time: '\u20684:12 PM\u2069' })));
});

test('Urdu next-step row is right to left', async () => {
  setLanguage('ur');
  const r = await render(h(SubmissionReceipt, base));
  const rows = r.root.findAll(n => n.type === 'View' && styleOf(n).minHeight === 48);
  assert.ok(rows.length >= 4);
  assert.ok(rows.every(n => styleOf(n).flexDirection === 'row-reverse'));
});
