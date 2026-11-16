import assert from 'node:assert/strict';
import test from 'node:test';
import { installMocks, setLanguage, setWindowSize, render, allText, findPressable, press } from '../support/nativeHarness.mjs';

const React = (await import('react')).default;
const { translate } = await import('../../src/i18n/translations.ts');
// The shared harness t() drops placeholder values; the real provider fills them, so stand in the same.
const useLanguage = () => {
  const language = globalThis.__nativeHarness.language;
  return { language, isRTL: language === 'ur', t: (text, values) => translate(text, language, values), setLanguage() {} };
};
let profile;
installMocks({
  '/components/ui/icon': { Icon: props => React.createElement('Icon', props) },
  '@react-native-community/netinfo': { default: { addEventListener: () => () => {} } },
  '/i18n/LanguageProvider': { useLanguage },
  '/queries/profile': { useStaffProfileQuery: () => ({ data: profile }) },
});
const { StyleSheet } = await import('react-native');
const { ProfileMonth } = await import('../../src/screens/profile/ProfileMonth.tsx');
const { ProfileWork } = await import('../../src/screens/profile/ProfileWork.tsx');

const h = React.createElement;
test.afterEach(() => { profile = undefined; setLanguage('en'); setWindowSize(390, 844); });

const month = (extra = {}) => ({ month: '2026-11', shiftsScheduled: 8, shiftsAttended: 8, onTime: 7, tasksAssigned: 42, tasksSubmitted: 38, ...extra });
const fills = r => r.root.findAll(n => n.props?.testID === 'meter-fill');
const tracks = r => r.root.findAll(n => n.props?.testID === 'meter-track');

test('month values read with named totals and three bars', async () => {
  let history = 0;
  const r = await render(h(ProfileMonth, { summary: month(), onSeeHistory: () => { history += 1; } }));
  const text = allText(r);
  for (const s of ['This month', 'Shifts attended', 'Arrived on time', 'Tasks submitted', '8 of 8 scheduled', '7 of 8 attended', '38 of 42']) {
    assert.ok(text.includes(s), s);
  }
  assert.equal(tracks(r).length, 3);
  const flat = fills(r).map(n => StyleSheet.flatten(n.props.style));
  assert.deepEqual(flat.map(s => s.height), [6, 6, 6]);
  assert.deepEqual(flat.map(s => s.width), ['100%', '88%', '90%']);
  press(findPressable(r, 'See my history'));
  assert.equal(history, 1);
});

test('zero denominators show the empty wording and no bar', async () => {
  const r = await render(h(ProfileMonth, { summary: month({ shiftsScheduled: 0, shiftsAttended: 0, onTime: 0, tasksAssigned: 0, tasksSubmitted: 0 }), onSeeHistory() {} }));
  const text = allText(r);
  assert.ok(text.includes('No shifts yet'));
  assert.ok(text.includes('No tasks yet'));
  assert.ok(!/0 of 0/.test(text));
  assert.ok(!text.includes('%'));
  assert.equal(tracks(r).length, 0);
});

test('zero scheduled but attended-on-time row only drops its own bar', async () => {
  const r = await render(h(ProfileMonth, { summary: month({ shiftsScheduled: 0, shiftsAttended: 0, onTime: 0 }), onSeeHistory() {} }));
  assert.equal(tracks(r).length, 1);
  assert.ok(allText(r).includes('38 of 42'));
});

test('loading shows three skeleton rows; error offers Try again', async () => {
  const loading = await render(h(ProfileMonth, { loading: true, onSeeHistory() {} }));
  assert.equal(loading.root.findAll(n => n.props?.testID === 'month-skeleton').length, 3);
  assert.ok(!allText(loading).includes('See my history'));
  let retried = 0;
  const failed = await render(h(ProfileMonth, { error: true, onRetry: () => { retried += 1; }, onSeeHistory() {} }));
  assert.ok(allText(failed).includes('Figures could not load.'));
  press(findPressable(failed, 'Try again'));
  assert.equal(retried, 1);
});

const work = (extra = {}) => ({
  location: { id: 1, name: 'Harbour Mall', address: '12 Dock Road', timezone: 'Asia/Karachi' },
  usualShift: { start: '09:00', end: '17:00' },
  manager: { name: 'Sana Iqbal' },
  ...extra,
});

test('work shows location, address, usual shift and manager', async () => {
  const r = await render(h(ProfileWork, { summary: work() }));
  const text = allText(r);
  for (const s of ['My work', 'Assigned location', 'Harbour Mall', '12 Dock Road', 'Usual shift', '9:00 AM – 5:00 PM', 'Work days', 'Every day', 'Manager', 'Sana Iqbal']) {
    assert.ok(text.includes(s), s);
  }
  assert.ok(text.indexOf('Work days') > text.indexOf('Usual shift'));
});

test('work shows chosen summary days and describes the full week as every day', async () => {
  profile = { workDays: ['TUE', 'FRI'] };
  const shift = work().usualShift;
  const chosen = await render(h(ProfileWork, { summary: work({ usualShift: { ...shift, days: ['MON', 'WED'] } }) }));
  assert.ok(allText(chosen).includes('Mon, Wed'));
  const full = await render(h(ProfileWork, { summary: work({ usualShift: { ...shift, days: ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'] } }) }));
  assert.ok(allText(full).includes('Every day'));
});

test('work uses the cached profile work days if the summary omits them', async () => {
  profile = { workDays: ['TUE', 'FRI'] };
  const r = await render(h(ProfileWork, { summary: work() }));
  assert.ok(allText(r).includes('Tue, Fri'));
});

test('nulls show the empty wording and nothing offers a call', async () => {
  const r = await render(h(ProfileWork, { summary: work({ location: null, usualShift: null, manager: null }) }));
  const text = allText(r);
  for (const s of ['No location assigned', 'Not set', 'No manager assigned']) assert.ok(text.includes(s), s);
  const full = await render(h(ProfileWork, { summary: work() }));
  assert.ok(!/call|phone/i.test(allText(full)));
  assert.equal(full.root.findAll(n => n.type === 'Pressable').length, 0);
  assert.equal(full.root.findAll(n => /^(Phone|Call)$/.test(n.props?.name ?? '')).length, 0);
});

test('work loading shows skeleton rows', async () => {
  const r = await render(h(ProfileWork, { loading: true }));
  assert.equal(r.root.findAll(n => n.props?.testID === 'work-skeleton').length, 3);
});

test('Urdu translates labels, mirrors rows and keeps names', async () => {
  setLanguage('ur');
  const r = await render(h(ProfileMonth, { summary: month(), onSeeHistory() {} }));
  const text = allText(r);
  assert.ok(text.includes(translate('This month', 'ur')));
  assert.ok(text.includes(translate('{n} of {t} scheduled', 'ur', { n: 8, t: 8 })));
  assert.ok(!text.includes('This month'));
  const rowsRtl = r.root.findAll(n => n.type === 'View' && StyleSheet.flatten(n.props.style)?.flexDirection === 'row-reverse');
  assert.ok(rowsRtl.length > 0);
  assert.ok(r.root.findAll(n => n.type === 'Icon' && n.props.name === 'ArrowLeft').length === 1);
  const w = await render(h(ProfileWork, { summary: work({ usualShift: { ...work().usualShift, days: ['MON', 'WED'] } }) }));
  const wt = allText(w);
  assert.ok(wt.includes('Harbour Mall') && wt.includes('Sana Iqbal'));
  assert.ok(wt.includes(translate('Assigned location', 'ur')));
  assert.ok(!wt.includes('Assigned location'));
  assert.ok(wt.includes(translate('Work days', 'ur')));
  assert.ok(wt.includes('پیر، بدھ'));
});
