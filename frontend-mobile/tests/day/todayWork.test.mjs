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
installMocks({
  '/components/ui/icon': { Icon: props => React.createElement('Icon', props) },
  '@react-native-community/netinfo': { default: { addEventListener: () => () => {} } },
  '/i18n/LanguageProvider': { useLanguage },
});
const { StyleSheet } = await import('react-native');
const { TodayWork, segmentTones } = await import('../../src/screens/day/TodayWork.tsx');
const { colors } = await import('../../src/design/tokens.ts');

const h = React.createElement;
const styleOf = node => StyleSheet.flatten(node.props.style);
test.afterEach(() => { setLanguage('en'); setWindowSize(390, 844); });

const task = (id, hour, extra = {}) => ({
  id, title: `Area ${id}`, areaNameSnapshot: `Area ${id}`, status: 'PENDING', date: '2026-11-11',
  shiftStart: `2026-11-11T${String(hour).padStart(2, '0')}:00:00.000Z`, shiftEnd: `2026-11-11T${String(hour + 1).padStart(2, '0')}:00:00.000Z`,
  startedAt: null, completedAt: null, proofImageUrls: [], location: { id: 1, name: 'HQ', timezone: 'UTC' }, ...extra,
});
const submitted = { status: 'COMPLETED', completionOutcome: 'SUBMITTED' };
const handlers = () => ({ onOpenTask() {}, onSeeAll() {} });
const segments = r => r.root.findAll(n => n.type === 'View' && styleOf(n).height === 6 && styleOf(n).borderRadius === 3);
const rows = r => r.root.findAll(n => n.type === 'Pressable' && /^Area \d/.test(n.props.accessibilityLabel ?? ''));

test('five tasks with one submitted: "1 of 5 submitted" and three open tasks by time', async () => {
  // The submitted task is the earliest, so open tasks (not the first three) must be chosen.
  const tasks = [task(1, 8, submitted), task(2, 9), task(3, 11), task(4, 12), task(5, 13)];
  const r = await render(h(TodayWork, { tasks, ...handlers() }));
  const text = allText(r);
  assert.ok(text.includes("Today's work"));
  assert.ok(text.includes('1 of 5 submitted'));
  const labels = rows(r).map(n => n.props.accessibilityLabel.split(',')[0]);
  assert.deepEqual(labels, ['Area 2', 'Area 3', 'Area 4']);
});

test('counts from the paged feed win over the visible tasks', async () => {
  const r = await render(h(TodayWork, { tasks: [task(1, 8), task(2, 9)], counts: { total: 80, submitted: 12 }, ...handlers() }));
  assert.ok(allText(r).includes('12 of 80 submitted'));
});

test('all submitted: first three of the day, strip has a segment each', async () => {
  const tasks = [3, 1, 2, 4].map(id => task(id, 7 + id, submitted));
  const r = await render(h(TodayWork, { tasks, ...handlers() }));
  assert.ok(allText(r).includes('4 of 4 submitted'));
  assert.deepEqual(rows(r).map(n => n.props.accessibilityLabel.split(',')[0]), ['Area 1', 'Area 2', 'Area 3']);
  assert.equal(segments(r).length, 4);
  assert.ok(segments(r).every(s => styleOf(s).backgroundColor === colors.blue));
});

test('strip has one segment per task with the right tone tokens, in day order', async () => {
  const tasks = [
    task(1, 8, { status: 'COMPLETED', completionOutcome: 'SUBMITTED' }), // blue
    task(2, 9, { status: 'IN_PROGRESS', verificationState: 'READY_TO_START' }), // half
    task(3, 10, { verificationState: 'REWORK_REQUIRED' }), // yellow
    task(4, 11), // line
    task(5, 12, { status: 'NOT_COMPLETED_INTIME' }), // yellow
  ];
  const r = await render(h(TodayWork, { tasks: [...tasks].reverse(), ...handlers() }));
  const segs = segments(r);
  assert.equal(segs.length, 5);
  assert.equal(styleOf(segs[0]).backgroundColor, colors.blue);
  assert.equal(styleOf(segs[1]).backgroundColor, colors.line);
  assert.equal(segs[1].children.length, 2);
  assert.equal(styleOf(segs[1].children[0]).backgroundColor, colors.blue);
  assert.equal(styleOf(segs[2]).backgroundColor, colors.yellow);
  assert.equal(styleOf(segs[3]).backgroundColor, colors.line);
  assert.equal(styleOf(segs[4]).backgroundColor, colors.yellow);
});

test('segmentTones: verified is green, and more than 12 tasks collapse into 12 proportional segments', () => {
  assert.deepEqual(segmentTones(['verified', 'acceptedWithExceptions', 'missed']), ['green', 'green', 'plain']);
  const kinds = Array.from({ length: 24 }, (_, i) => (i === 5 ? 'retake' : 'verified'));
  const tones = segmentTones(kinds);
  assert.equal(tones.length, 12);
  assert.equal(tones[2], 'yellow');
  assert.equal(tones.filter(t => t === 'green').length, 11);
});

test('See all tasks calls onSeeAll; a row press calls onOpenTask with that task', async () => {
  let seen = 0; let opened = null;
  const tasks = [task(1, 8), task(2, 9)];
  const r = await render(h(TodayWork, { tasks, onSeeAll: () => { seen += 1; }, onOpenTask: x => { opened = x; } }));
  await press(findPressable(r, 'See all tasks'));
  assert.equal(seen, 1);
  await press(rows(r)[1]);
  assert.equal(opened, tasks[1]);
  assert.equal(r.root.findAll(n => n.type === 'Icon').some(n => n.props.name === 'ArrowRight'), true);
  const see = findPressable(r, 'See all tasks');
  assert.equal(styleOf(see).minHeight, 52);
});

test('sheet overlaps the top area by 26 with top radius 28 and padding 20, or 12 when compact', async () => {
  const r = await render(h(TodayWork, { tasks: [task(1, 8)], ...handlers() }));
  const sheet = r.root.findAll(n => n.type === 'View' && styleOf(n).marginTop === -26)[0];
  assert.equal(styleOf(sheet).borderTopLeftRadius, 28);
  assert.equal(styleOf(sheet).paddingTop, 20);
  const c = await render(h(TodayWork, { tasks: [task(1, 8)], compact: true, ...handlers() }));
  assert.equal(styleOf(c.root.findAll(n => n.type === 'View' && styleOf(n).marginTop === -26)[0]).paddingTop, 12);
  assert.ok(c.root.findAll(n => n.type === 'View' && styleOf(n).minHeight === 64).length >= 1);
});

test('no tasks: a short empty sheet with no heading', async () => {
  const r = await render(h(TodayWork, { tasks: [], ...handlers() }));
  assert.equal(allText(r), '');
  assert.equal(rows(r).length, 0);
});

test('loading shows four skeleton rows and no real rows', async () => {
  const r = await render(h(TodayWork, { tasks: [task(1, 8)], loading: true, ...handlers() }));
  assert.equal(r.root.findAll(n => n.type === 'View' && styleOf(n).borderRadius === 17).length, 4);
  assert.equal(rows(r).length, 0);
  assert.equal(allText(r), '');
});

test('Urdu: translated heading and count, reversed rows, mirrored arrow and half tick', async () => {
  setLanguage('ur');
  const tasks = [task(1, 8, submitted), task(2, 9, { status: 'IN_PROGRESS', verificationState: 'READY_TO_START' }), task(3, 10)];
  const r = await render(h(TodayWork, { tasks, ...handlers() }));
  const text = allText(r);
  assert.ok(text.includes(translate("Today's work", 'ur')));
  assert.ok(text.includes(translate('{n} of {t} submitted', 'ur', { n: 1, t: 3 })));
  assert.ok(text.includes(translate('See all tasks', 'ur')));
  assert.ok(r.root.findAll(n => n.type === 'Icon').some(n => n.props.name === 'ArrowLeft'));
  assert.ok(r.root.findAll(n => n.type === 'View' && styleOf(n).height === 6 && styleOf(n).flexDirection === 'row-reverse').length === 1);
  assert.ok(r.root.findAll(n => n.type === 'View' && styleOf(n).gap === 5 && styleOf(n).flexDirection === 'row-reverse').length >= 1);
});
