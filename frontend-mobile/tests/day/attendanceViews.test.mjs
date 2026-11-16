import assert from 'node:assert/strict';
import test from 'node:test';
import { installMocks, setLanguage, render, allText, findPressable, press } from '../support/nativeHarness.mjs';

const React = (await import('react')).default;
const { act } = await import('react-test-renderer');
const { translate } = await import('../../src/i18n/translations.ts');

const flags = { reduced: false, settings: 0 };
const harness = globalThis.__nativeHarness;
installMocks({
  // lucide and react-native-svg do not load under node: stand in plain elements.
  '/ui/icon': { Icon: props => React.createElement('Icon', props) },
  'react-native-svg': { __esModule: true, default: 'Svg', Svg: 'Svg', Path: 'Path', Ellipse: 'Ellipse' },
  'react-native-reanimated': { useReducedMotion: () => flags.reduced, useAnimatedProps: factory => factory() },
  'react-native': { Linking: { openSettings: async () => { flags.settings += 1; }, openURL: async () => {} } },
  // The default harness t() drops placeholder values; these screens fill {m}, {n}, {place}.
  '/i18n/LanguageProvider': {
    useLanguage: () => ({
      language: harness.language, isRTL: harness.language === 'ur', setLanguage: () => {},
      t: (text, values) => translate(text, harness.language, values),
    }),
  },
});
const { StyleSheet } = await import('react-native');
const { colors } = await import('../../src/design/tokens.ts');
const { AttendanceLocating } = await import('../../src/screens/day/AttendanceLocating.tsx');
const { AttendanceSheets, UnsubmittedWorkSheet } = await import('../../src/screens/day/AttendanceSheets.tsx');
const { AttendanceReceipt } = await import('../../src/screens/day/AttendanceReceipt.tsx');

const h = React.createElement;
const plain = s => s.replace(/[⁨⁩]/g, '');
const text = r => plain(allText(r));
const styleOf = node => StyleSheet.flatten(node.props.style) ?? {};
const texts = r => r.root.findAll(n => n.type === 'Text').map(n => plain(n.children.filter(c => typeof c === 'string').join('')));

function recorder() {
  const calls = [];
  const fn = name => (...args) => { calls.push([name, ...args]); };
  return {
    calls,
    handlers: { start: fn('start'), retryLocation: fn('retryLocation'), continueAnyway: fn('continueAnyway'), cancel: fn('cancel') },
  };
}
const sheets = (props, rec) => h(AttendanceSheets, {
  phase: 'idle', mode: 'check-in', error: null, accuracyMeters: null, place: 'Gulberg Plaza', ...rec.handlers, ...props,
});

test.afterEach(() => { setLanguage('en'); flags.reduced = false; flags.settings = 0; });

test('locating view shows its title, the place on its own line, a ring, and goes back', async () => {
  let back = 0;
  const r = await render(h(AttendanceLocating, { place: 'Gulberg Plaza', onBack: () => { back += 1; } }));
  const all = texts(r);
  assert.ok(all.includes('Finding your location…'));
  assert.ok(all.includes('Stay still for a moment.'));
  assert.ok(all.includes('Gulberg Plaza'), 'place is a line of its own');
  const title = r.root.findAll(n => n.type === 'Text' && n.props.accessibilityLiveRegion === 'polite');
  assert.equal(plain(title[0].children.join('')), 'Finding your location…');
  assert.equal(r.root.findAll(n => n.props.testID === 'locate-ring').length, 1);
  await press(findPressable(r, 'Back'));
  assert.equal(back, 1);
});

test('locating ring is static (absent) under reduced motion; no place line when there is none', async () => {
  flags.reduced = true;
  const r = await render(h(AttendanceLocating, { place: null, onBack: () => {} }));
  assert.equal(r.root.findAll(n => n.props.testID === 'locate-ring').length, 0);
  assert.equal(texts(r).length, 2);
});

test('weak signal sheet: title, accuracy, both actions and dismiss cancels', async () => {
  const rec = recorder();
  const r = await render(sheets({ phase: 'weakSignal', accuracyMeters: 86.4 }, rec));
  const t = text(r);
  assert.ok(t.includes('GPS signal is weak'));
  assert.ok(t.includes('Accuracy is ±86 m. Move near a window or outdoors, then try again.'));
  await press(findPressable(r, 'Try again'));
  await press(findPressable(r, 'Continue anyway'));
  await act(async () => { r.root.findByType('Modal').props.onRequestClose(); });
  assert.deepEqual(rec.calls, [['retryLocation'], ['continueAnyway'], ['cancel']]);
});

test('error while checking in shows "Attendance not saved" with the server message', async () => {
  const rec = recorder();
  const message = 'You must be within 100 meters of the assigned location.';
  const r = await render(sheets({ phase: 'error', mode: 'check-out', error: message }, rec));
  const t = text(r);
  assert.ok(t.includes('Attendance not saved'));
  assert.ok(t.includes(message));
  await press(findPressable(r, 'Try again'));
  await press(findPressable(r, 'Cancel'));
  assert.deepEqual(rec.calls, [['start', 'check-out'], ['cancel']]);
  const glyph = r.root.findAll(n => n.type === 'Icon')[0];
  assert.equal(glyph.props.name, 'MapPin');
  assert.equal(glyph.props.color, colors.bad);
});

test('not-at-location sheet (reserved) names the place in English and calls retry and cancel', async () => {
  const rec = recorder();
  const r = await render(sheets({ phase: 'notAtLocation', error: 'You are not at your assigned location.' }, rec));
  const t = text(r);
  assert.ok(t.includes('You are not at Gulberg Plaza'));
  assert.ok(t.includes('Go to your assigned location, then try again.'));
  assert.ok(!t.includes('You are not at your assigned location.'), 'a repeated server message is not shown twice');
  await press(findPressable(r, 'Try again'));
  await press(findPressable(r, 'Cancel'));
  assert.deepEqual(rec.calls, [['start', 'check-in'], ['cancel']]);
});

test('Urdu wrong-place title keeps the place out of the sentence, on its own line, in RTL rows', async () => {
  setLanguage('ur');
  const rec = recorder();
  const r = await render(sheets({ phase: 'notAtLocation' }, rec));
  const all = texts(r);
  assert.ok(all.includes(translate('You are not at your assigned location', 'ur')));
  assert.ok(all.includes('Gulberg Plaza'), 'place is its own line');
  assert.ok(!all.some(s => s.includes('Gulberg Plaza') && s !== 'Gulberg Plaza'), 'no sentence contains the place');
  const head = r.root.findAll(n => n.type === 'View' && styleOf(n).flexDirection === 'row-reverse');
  assert.ok(head.length > 0);
  assert.ok(text(r).includes(translate('Try again', 'ur')));
});

test('permission sheet opens settings and cancels; Cancel cancels', async () => {
  const rec = recorder();
  const r = await render(sheets({ phase: 'needsPermission', error: 'Allow camera access to capture an attendance image.' }, rec));
  const t = text(r);
  assert.ok(t.includes('Camera is needed'));
  assert.ok(t.includes('Allow camera and location in phone settings to mark attendance.'));
  await press(findPressable(r, 'Open settings'));
  assert.equal(flags.settings, 1);
  await press(findPressable(r, 'Cancel'));
  assert.deepEqual(rec.calls, [['cancel'], ['cancel']]);
});

test('no sheet for phases without a problem, or an error with no mode', async () => {
  for (const phase of ['idle', 'checkingServer', 'locating', 'selfie', 'saving', 'done']) {
    const r = await render(sheets({ phase }, recorder()));
    assert.equal(r.toJSON(), null, phase);
  }
  const r = await render(sheets({ phase: 'error', mode: null, error: 'x' }, recorder()));
  assert.equal(r.toJSON(), null);
});

test('unsubmitted work sheet reads the count and offers both actions', async () => {
  const calls = [];
  const props = { onBack: () => calls.push('back'), onCheckOutAnyway: () => calls.push('out') };
  const r = await render(h(UnsubmittedWorkSheet, { count: 4, ...props }));
  const t = text(r);
  assert.ok(t.includes('4 tasks are not submitted'));
  assert.ok(t.includes('You can still check out, or go back and finish your work.'));
  await press(findPressable(r, 'Go back to my work'));
  await press(findPressable(r, 'Check out anyway'));
  await act(async () => { r.root.findByType('Modal').props.onRequestClose(); });
  assert.deepEqual(calls, ['back', 'out', 'back']);
  const one = await render(h(UnsubmittedWorkSheet, { count: 1, ...props }));
  assert.ok(text(one).includes('1 task is not submitted'));
});

const record = {
  id: 9, date: '2026-11-11T00:00:00.000Z', status: 'LATE',
  expectedStart: '2026-11-11T09:00:00.000Z', expectedEnd: '2026-11-11T17:00:00.000Z',
  checkInTime: '2026-11-11T09:12:00.000Z', checkOutTime: null, location: { id: 7, name: 'Gulberg Plaza' },
};
const receipt = props => h(AttendanceReceipt, {
  record, tasksSubmitted: 3, tasksTotal: 4, place: 'Gulberg Plaza', timeZone: 'UTC', onDone: () => {}, ...props,
});
const pillFill = (r, label) => {
  const labelNode = r.root.findAll(n => n.type === 'Text' && plain(n.children.join('')) === label)[0];
  assert.ok(labelNode, label);
  let node = labelNode.parent;
  while (node && !(node.type === 'View' && styleOf(node).backgroundColor)) node = node.parent;
  return styleOf(node).backgroundColor;
};

test('check-in receipt shows Late with the late tone, location and shift, and its action', async () => {
  let done = 0;
  const r = await render(receipt({ result: { mode: 'check-in', at: record.checkInTime, late: true }, onDone: () => { done += 1; } }));
  const t = text(r);
  for (const s of ['Checked in', '9:12 AM', 'Late', 'Location', 'Gulberg Plaza', 'Shift', '9:00 AM – 5:00 PM']) assert.ok(t.includes(s), s);
  assert.equal(pillFill(r, 'Late'), colors.late);
  await press(findPressable(r, "See today's work"));
  assert.equal(done, 1);
  const onTime = await render(receipt({ result: { mode: 'check-in', at: record.checkInTime, late: false }, record: { ...record, status: 'CHECKED_IN' } }));
  assert.equal(pillFill(onTime, 'On time'), colors.okWash);
});

test('check-out receipt shows time worked and no pill; a missed check-out shows the warn pill and no time worked', async () => {
  const out = { ...record, status: 'CHECKED_OUT', checkOutTime: '2026-11-11T17:16:00.000Z' };
  const result = { mode: 'check-out', at: out.checkOutTime, late: false };
  const r = await render(receipt({ result, record: out }));
  const t = text(r);
  for (const s of ['Checked out', '5:16 PM', 'In', '9:12 AM', 'Out', 'Time worked', '8h 4m', 'Tasks submitted', '3 of 4', 'Location']) assert.ok(t.includes(s), s);
  for (const s of ['Late', 'On time', 'Missed check-out']) assert.ok(!t.includes(s), s);
  assert.ok(findPressable(r, 'Back to my day'));
  const missed = await render(receipt({ result, record: { ...out, status: 'MISSED_CHECKOUT' } }));
  const m = text(missed);
  assert.ok(m.includes('Missed check-out'));
  assert.ok(!m.includes('Time worked'));
  assert.equal(pillFill(missed, 'Missed check-out'), colors.warnWash);
});

test('Urdu check-out receipt translates labels, keeps the place, reverses fact rows', async () => {
  setLanguage('ur');
  const out = { ...record, status: 'CHECKED_OUT', checkOutTime: '2026-11-11T17:16:00.000Z' };
  const r = await render(receipt({ result: { mode: 'check-out', at: out.checkOutTime, late: false }, record: out }));
  const t = text(r);
  for (const s of ['Checked out', 'Time worked', 'Back to my day']) assert.ok(t.includes(translate(s, 'ur')), s);
  assert.ok(t.includes(translate('{n} of {t}', 'ur', { n: 3, t: 4 })));
  assert.ok(t.includes('Gulberg Plaza'));
  assert.ok(r.root.findAll(n => n.type === 'View' && styleOf(n).flexDirection === 'row-reverse').length > 0);
});
