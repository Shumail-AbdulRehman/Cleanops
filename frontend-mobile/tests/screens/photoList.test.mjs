import assert from 'node:assert/strict';
import test from 'node:test';
import { installMocks, setLanguage, render, allText, findPressable, press } from '../support/nativeHarness.mjs';

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
const { VerificationProgress } = await import('../../src/screens/verification/VerificationProgress.tsx');
const { colors } = await import('../../src/design/tokens.ts');

const h = React.createElement;
const styleOf = node => StyleSheet.flatten(node.props.style);
test.afterEach(() => setLanguage('en'));

const names = ['Toilet', 'Sink', 'Mirror', 'Floor', 'Bin', 'Shower', 'Door'];
const manifestFor = (states, extra = {}, task = {}) => ({
  task: { id: 1, title: 'Cleaning', status: 'IN_PROGRESS', areaNameSnapshot: 'Block A', ...task },
  items: states.map((state, i) => ({
    id: `i${i}`, nameSnapshot: names[i], typeSnapshot: i === 0 ? 'TOILET' : 'OTHER', mandatory: true,
    requirements: [{ id: `r${i}`, viewKey: 'FRONT', instructionsSnapshot: 'Show the whole item.', mandatory: true, state, currentAttempt: state === 'RECAPTURE_REQUIRED' ? { id: 'a', state, instructions: 'The photo is blurry. Hold the phone still.' } : null }],
  })),
  session: null,
  ...extra,
});
const mount = (manifest, props = {}) => render(h(VerificationProgress, { manifest, local: null, rows: [], online: true, lastUpdated: null, ...props }));

test('passed photo shows green "Uploaded" and the header counts three done of seven', async () => {
  const r = await mount(manifestFor(['PASSED', 'PASSED', 'MANAGER_ACCEPTED', 'MISSING', 'MISSING', 'MISSING', 'MISSING']));
  const text = allText(r);
  assert.ok(text.includes('3 of 7 photos done'), text);
  assert.ok(text.includes('Uploaded'));
  const label = r.root.findAll(n => n.type === 'Text' && n.props.children === 'Uploaded')[0];
  assert.equal(styleOf(label).color, colors.ok);
  assert.ok(text.includes('Block A'));
});

test('progress bar fill is blue and proportional', async () => {
  const r = await mount(manifestFor(['PASSED', 'MISSING']));
  const fill = r.root.findAll(n => n.type === 'View' && styleOf(n).width === '50%')[0];
  assert.equal(styleOf(fill).backgroundColor, colors.blue);
  const track = r.root.findAll(n => n.type === 'View' && styleOf(n).height === 8)[0];
  assert.equal(styleOf(track).flexDirection, 'row');
});

test('a saved queue row shows "Saved, uploading" with a spinning icon', async () => {
  const manifest = manifestFor(['MISSING']);
  const local = { session: { id: 's', slots: [{ id: 'sl', requirementId: 'r0', generation: 0 }] }, manifest };
  const rows = [{ id: 'q', slotId: 'sl', state: 'SAVED', metadata: { slotId: 'sl' } }];
  const r = await mount(manifest, { local, rows });
  assert.ok(allText(r).includes('Saved, uploading'));
  assert.ok(allText(r).includes('0 of 1 photos done'));
  const icon = r.root.findAll(n => n.type === 'Icon' && n.props.name === 'LoaderCircle');
  assert.equal(icon.length, 1);
});

test('a processing row shows "Uploaded, checking"', async () => {
  const r = await mount(manifestFor(['PROCESSING']));
  assert.ok(allText(r).includes('Uploaded, checking'));
  assert.equal(r.root.findAll(n => n.type === 'Icon' && n.props.name === 'Hourglass').length, 1);
});

test('a recapture row shows "Retake photo" and its correction text', async () => {
  const r = await mount(manifestFor(['RECAPTURE_REQUIRED']));
  const text = allText(r);
  assert.ok(text.includes('Retake photo'));
  assert.ok(text.includes('The photo is blurry. Hold the phone still.'));
});

test('offline shows the upload note; online does not', async () => {
  const note = 'Internet needed to upload. Reconnect, then tap Upload again.';
  assert.ok(allText(await mount(manifestFor(['MISSING']), { online: false })).includes(note));
  assert.ok(!allText(await mount(manifestFor(['MISSING']))).includes(note));
});

test('footer shows "Results updated" with the time only when known', async () => {
  assert.ok(!allText(await mount(manifestFor(['MISSING']))).includes('Results updated'));
  assert.ok(allText(await mount(manifestFor(['MISSING']), { lastUpdated: Date.UTC(2026, 10, 11, 9, 5) })).includes('Results updated ·'));
});

test('a finished task renders only the "Work submitted" header, no rows', async () => {
  const r = await mount(manifestFor(['PASSED', 'PASSED'], {}, { status: 'COMPLETED' }));
  const text = allText(r);
  assert.ok(text.includes('Work submitted'));
  assert.ok(!text.includes('Uploaded'));
  assert.ok(!text.includes('photos done'));
});

test('rows are pressable only with onSelect and report their index', async () => {
  const manifest = manifestFor(['PASSED', 'MISSING']);
  assert.equal(findPressable(await mount(manifest), 'Sink, Photo needed'), undefined);
  const picked = [];
  const r = await mount(manifest, { onSelect: i => picked.push(i) });
  await press(findPressable(r, 'Sink, Photo needed'));
  assert.deepEqual(picked, [1]);
});

test('Urdu translates the fixture names and labels but not the area name, and rows reverse', async () => {
  setLanguage('ur');
  const manifest = manifestFor(['PASSED', 'MISSING'], {}, { areaNameSnapshot: 'Block A' });
  manifest.items[0].nameSnapshot = 'Room entrance';
  const r = await mount(manifest);
  const text = allText(r);
  assert.ok(text.includes(translate('Room entrance', 'ur')));
  assert.notEqual(translate('Room entrance', 'ur'), 'Room entrance');
  assert.ok(text.includes(translate('Uploaded', 'ur')));
  assert.ok(text.includes(translate('{n} of {t} photos done', 'ur', { n: 1, t: 2 })));
  assert.ok(text.includes('Block A'));
  assert.ok(r.root.findAll(n => n.type === 'View' && styleOf(n).flexDirection === 'row-reverse').length > 0);
});
