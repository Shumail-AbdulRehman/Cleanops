import assert from 'node:assert/strict';
import test from 'node:test';
import { installMocks, setLanguage, render, allText, findPressable, press, navigationCalls, resetCalls } from '../support/nativeHarness.mjs';

const React = (await import('react')).default;
const { translate } = await import('../../src/i18n/translations.ts');
const useLanguage = () => {
  const language = globalThis.__nativeHarness.language;
  return { language, isRTL: language === 'ur', t: (text, values) => translate(text, language, values), setLanguage() {} };
};
const state = { params: { taskId: 1, month: '2026-11' }, cached: [], queryCalls: [], result: {}, refetch: 0 };
installMocks({
  '/components/ui/icon': { Icon: props => React.createElement('Icon', props) },
  '@react-native-community/netinfo': { default: { addEventListener: () => () => {} } },
  '/i18n/LanguageProvider': { useLanguage },
  '@react-navigation/native': { useRoute: () => ({ params: state.params }) },
  '@tanstack/react-query': { useQueryClient: () => ({ getQueriesData: () => state.cached }) },
  '/queries/history': {
    historyKeys: { tasks: (id, month, filter) => ['staff', id, 'history', 'tasks', month, filter] },
    flattenHistoryPages: data => data?.pages.flatMap(page => page.items),
    useTaskHistory: (staffId, month, filter, enabled) => {
      state.queryCalls.push({ staffId, month, filter, enabled });
      return { data: undefined, isError: false, refetch: async () => { state.refetch += 1; }, ...state.result };
    },
  },
});
const { StyleSheet } = await import('react-native');
const { HistoryTaskScreen } = await import('../../src/screens/history/HistoryTaskScreen.tsx');
const { Pill } = await import('../../src/design/Pill.tsx');
const { colors } = await import('../../src/design/tokens.ts');

const h = React.createElement;
const styleOf = node => StyleSheet.flatten(node.props.style) ?? {};
const item = (id, status, extra = {}) => ({
  id, areaName: `Area ${id}`, title: `Clean area ${id}`, date: '2026-11-03', shiftStart: '2026-11-03T04:00:00.000Z', shiftEnd: '2026-11-03T05:00:00.000Z',
  timezone: 'UTC', status, reviewState: 'NOT_NEEDED', startedAt: '2026-11-03T04:10:00.000Z', submittedAt: '2026-11-03T04:40:00.000Z',
  photos: { received: 4, required: 4 }, location: { id: 1, name: 'HQ' }, ...extra,
});
const cache = (...items) => { state.cached = [[['k'], { pages: [{ items }] }]]; };
const markers = r => r.root.findAll(n => n.type === 'View' && styleOf(n).width === 28 && styleOf(n).borderRadius === 14);
const icons = r => r.root.findAll(n => n.type === 'Icon').map(n => n.props.name);
const pills = r => r.root.findAllByType(Pill).map(p => [p.props.label, p.props.tone]);

test.beforeEach(() => {
  state.params = { taskId: 1, month: '2026-11' }; state.cached = []; state.queryCalls.length = 0; state.result = {}; state.refetch = 0;
  setLanguage('en'); resetCalls();
});

test('a verified item shows four done steps and three separate states', async () => {
  cache(item(1, 'VERIFIED', { reviewState: 'CLOSED' }));
  const r = await render(h(HistoryTaskScreen));
  const text = allText(r);
  for (const word of ['Task details', 'Area 1', 'Clean area 1', 'What happened', 'Scheduled', 'Started', 'Photos received', 'Submitted', '4 / 4', '4:10 AM', '4:40 AM', 'Status', 'Review closed']) assert.ok(text.includes(word), word);
  assert.ok(text.includes('4:00 – 5:00 AM'));
  assert.ok(text.includes('3 Nov'));
  assert.deepEqual(markers(r).map(m => styleOf(m).backgroundColor), [colors.blue, colors.blue, colors.blue, colors.blue]);
  assert.ok(!icons(r).includes('Minus'));
  assert.deepEqual(pills(r), [['Verified', 'green'], ['Yes', 'blue'], ['Verified', 'green'], ['Yes', 'green']]);
  assert.ok(text.includes('Submitted means you finished. Verified means your manager or the check confirmed it.'));
  assert.equal(state.queryCalls.at(-1).enabled, false);
});

test('accepted with exceptions shows the exceptions pill in the Verified row', async () => {
  cache(item(1, 'ACCEPTED_WITH_EXCEPTIONS', { reviewState: 'CLOSED' }));
  const r = await render(h(HistoryTaskScreen));
  assert.deepEqual(pills(r).slice(0, 3), [['Accepted with exceptions', 'green'], ['Yes', 'blue'], ['Accepted with exceptions', 'green']]);
});

test('a waiting item shows Verified Not yet and Review closed Not yet', async () => {
  cache(item(1, 'WAITING_FOR_REVIEW', { reviewState: 'OPEN' }));
  const r = await render(h(HistoryTaskScreen));
  assert.deepEqual(pills(r), [['Waiting for review', 'blue'], ['Yes', 'blue'], ['Not yet', 'neutral'], ['Not yet', 'neutral']]);
});

test('review not needed shows Not needed while not verified', async () => {
  cache(item(1, 'SUBMITTED', { reviewState: 'NOT_NEEDED' }));
  const r = await render(h(HistoryTaskScreen));
  assert.deepEqual(pills(r).slice(2), [['Not yet', 'neutral'], ['Not needed', 'neutral']]);
});

test('a missed item shows Not done in red and minus markers', async () => {
  cache(item(1, 'MISSED', { startedAt: null, submittedAt: null, photos: { received: 0, required: 4 } }));
  const r = await render(h(HistoryTaskScreen));
  const text = allText(r);
  assert.ok(text.includes('Not recorded') && text.includes('Not done'));
  assert.deepEqual(pills(r).slice(0, 2), [['Missed', 'red'], ['Not done', 'red']]);
  assert.deepEqual(markers(r).map(m => styleOf(m).backgroundColor), [colors.blue, colors.canvas, colors.canvas, colors.canvas]);
  assert.equal(icons(r).filter(n => n === 'Minus').length, 3);
});

test('an uncached item refetches the month with filter all and then shows', async () => {
  state.result = { data: undefined };
  const loading = await render(h(HistoryTaskScreen));
  assert.deepEqual(state.queryCalls.at(-1), { staffId: 2, month: '2026-11', filter: 'all', enabled: true });
  assert.ok(!allText(loading).includes('What happened'));
  state.result = { data: { pages: [{ items: [item(1, 'VERIFIED')] }] } };
  const r = await render(h(HistoryTaskScreen));
  assert.ok(allText(r).includes('What happened'));
});

test('a task missing after the refetch shows the not-found state and Back goes back', async () => {
  state.result = { data: { pages: [{ items: [item(9, 'VERIFIED')] }] } };
  const r = await render(h(HistoryTaskScreen));
  assert.ok(allText(r).includes('This task is not in your history.'));
  assert.ok(!allText(r).includes('What happened'));
  await press(r.root.findAll(n => n.type === 'Pressable' && n.props.accessibilityLabel === 'Back')[1]);
  assert.ok(navigationCalls().some(c => c.name === 'goBack'));
});

test('a failed refetch offers Try again', async () => {
  state.result = { isError: true };
  const r = await render(h(HistoryTaskScreen));
  await press(findPressable(r, 'Try again'));
  assert.equal(state.refetch, 1);
});

test('the top bar back button goes back', async () => {
  cache(item(1, 'VERIFIED'));
  const r = await render(h(HistoryTaskScreen));
  await press(findPressable(r, 'Back'));
  assert.ok(navigationCalls().some(c => c.name === 'goBack'));
});

test('Urdu translates the footnote and leaves the area name untranslated, rows reversed', async () => {
  setLanguage('ur');
  cache(item(1, 'VERIFIED', { reviewState: 'CLOSED' }));
  const r = await render(h(HistoryTaskScreen));
  const text = allText(r);
  assert.ok(text.includes(translate('Submitted means you finished. Verified means your manager or the check confirmed it.', 'ur')));
  assert.ok(text.includes('Area 1') && text.includes('Clean area 1'));
  assert.ok(text.includes(translate('What happened', 'ur')) && text.includes(translate('Review closed', 'ur')));
  const step = r.root.findAll(n => n.type === 'View' && styleOf(n).gap === 14 && styleOf(n).flexDirection)[0];
  assert.equal(styleOf(step).flexDirection, 'row-reverse');
});
