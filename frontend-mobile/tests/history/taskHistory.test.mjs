import assert from 'node:assert/strict';
import test from 'node:test';
import { installMocks, setLanguage, render, allText, findPressable, press } from '../support/nativeHarness.mjs';

const React = (await import('react')).default;
const { translate } = await import('../../src/i18n/translations.ts');
const useLanguage = () => {
  const language = globalThis.__nativeHarness.language;
  return { language, isRTL: language === 'ur', t: (text, values) => translate(text, language, values), setLanguage() {} };
};
const state = { calls: [], result: null, fetchNext: 0, refetch: 0 };
installMocks({
  '/components/ui/icon': { Icon: props => React.createElement('Icon', props) },
  '@react-native-community/netinfo': { default: { addEventListener: () => () => {} } },
  '/i18n/LanguageProvider': { useLanguage },
  '/queries/history': {
    useTaskHistory: (staffId, month, filter) => {
      state.calls.push({ staffId, month, filter });
      return { fetchNextPage: () => { state.fetchNext += 1; }, refetch: async () => { state.refetch += 1; }, isFetchingNextPage: false, ...state.result };
    },
    flattenHistoryPages: data => data?.pages.flatMap(page => page.items),
  },
});
const { StyleSheet } = await import('react-native');
const { TaskHistoryView } = await import('../../src/screens/history/TaskHistoryView.tsx');
const { colors } = await import('../../src/design/tokens.ts');
const { localDate } = await import('../../src/design/format.ts');

const h = React.createElement;
const styleOf = node => StyleSheet.flatten(node.props.style) ?? {};
const range = { earliestMonth: '2026-09', latestMonth: '2026-11' };
const iso = offset => new Date(Date.now() + offset * 86400000).toISOString();
const ymd = offset => localDate(iso(offset), 'UTC');
const item = (id, offset, status, extra = {}) => ({
  id, areaName: `Area ${id}`, title: `Area ${id}`, date: ymd(offset), shiftStart: `${ymd(offset)}T04:00:00.000Z`, shiftEnd: `${ymd(offset)}T05:00:00.000Z`,
  timezone: 'UTC', status, reviewState: 'NOT_NEEDED', startedAt: null, submittedAt: null, photos: { received: 0, required: 0 }, location: { id: 1, name: 'HQ' }, ...extra,
});
const page = (items, extra = {}) => ({ month: '2026-11', timezone: 'UTC', range, counts: { verified: 31, waiting: 7, missed: 4, total: 42 }, items, nextCursor: null, ...extra });
const ready = (items, extra = {}, query = {}) => { state.result = { data: { pages: [page(items, extra)] }, isError: false, hasNextPage: false, ...query }; };
const base = { staffId: 5, month: '2026-11', onMonthChange() {}, onOpenTask() {} };
const rows = r => r.root.findAll(n => n.type === 'Pressable' && /^Area \d/.test(n.props.accessibilityLabel ?? ''));
const icons = r => r.root.findAll(n => n.type === 'Icon').map(n => n.props.name);

test.beforeEach(() => { state.calls.length = 0; state.fetchNext = 0; state.refetch = 0; setLanguage('en'); });

test('legend shows the three counts in words and the bar parts are proportional', async () => {
  ready([item(1, 0, 'VERIFIED')]);
  const r = await render(h(TaskHistoryView, base));
  const text = allText(r);
  assert.ok(text.includes('Verified') && text.includes('31'));
  assert.ok(text.includes('Waiting') && text.includes('7'));
  assert.ok(text.includes('Missed') && text.includes('4'));
  assert.ok(findPressable(r, 'Verified 31') === undefined); // legend is not a button
  const bar = r.root.findAll(n => n.type === 'View' && styleOf(n).height === 10 && styleOf(n).borderRadius === 5 && styleOf(n).overflow === 'hidden')[0];
  const parts = bar.children.map(c => styleOf(c));
  assert.deepEqual(parts.map(p => p.flex), [31, 7, 4]);
  assert.deepEqual(parts.map(p => p.backgroundColor), [colors.ok, colors.blue, colors.bad]);
});

test('selecting Missed re-queries with filter missed and marks the chip selected', async () => {
  ready([item(1, 0, 'MISSED')]);
  const r = await render(h(TaskHistoryView, base));
  assert.equal(state.calls.at(-1).filter, 'all');
  assert.equal(state.calls.at(-1).month, '2026-11');
  await press(findPressable(r, 'Missed'));
  assert.equal(state.calls.at(-1).filter, 'missed');
  assert.equal(findPressable(r, 'Missed').props.accessibilityState.selected, true);
  assert.equal(findPressable(r, 'All').props.accessibilityState.selected, false);
  assert.equal(styleOf(findPressable(r, 'Missed')).backgroundColor, colors.ink);
  assert.equal(styleOf(findPressable(r, 'Missed')).height, 44);
});

test('rows group under Today and Yesterday with the day-month, and a row press opens the item', async () => {
  const a = item(1, 0, 'VERIFIED'); const b = item(2, 0, 'WAITING_FOR_REVIEW'); const c = item(3, -1, 'MISSED');
  ready([a, b, c]);
  let opened = null;
  const r = await render(h(TaskHistoryView, { ...base, onOpenTask: x => { opened = x; } }));
  const text = allText(r);
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const dm = offset => { const [, m, d] = ymd(offset).split('-').map(Number); return `${d} ${months[m - 1]}`; };
  assert.ok(text.includes('Today') && text.includes(dm(0)));
  assert.ok(text.includes('Yesterday') && text.includes(dm(-1)));
  assert.ok(text.indexOf('Today') < text.indexOf('Area 1') && text.indexOf('Area 2') < text.indexOf('Yesterday') && text.indexOf('Yesterday') < text.indexOf('Area 3'));
  await press(rows(r)[2]);
  assert.equal(opened, c);
});

test('verified shows the green Verified pill and waiting the blue Waiting for review pill', async () => {
  ready([item(1, 0, 'VERIFIED'), item(2, 0, 'WAITING_FOR_REVIEW')]);
  const r = await render(h(TaskHistoryView, base));
  const [v, w] = rows(r).map(n => n.props.accessibilityLabel);
  assert.ok(v.includes('Verified'));
  assert.ok(w.includes('Waiting for review'));
  const { Pill } = await import('../../src/design/Pill.tsx');
  const pills = r.root.findAllByType(Pill);
  assert.deepEqual(pills.map(p => [p.props.label, p.props.tone]), [['Verified', 'green'], ['Waiting for review', 'blue']]);
});

test('the previous arrow is hidden at the earliest month, next at the latest', async () => {
  ready([item(1, 0, 'VERIFIED')]);
  const earliest = await render(h(TaskHistoryView, { ...base, month: '2026-09' }));
  assert.equal(findPressable(earliest, 'Previous month'), undefined);
  assert.ok(findPressable(earliest, 'Next month'));
  const latest = await render(h(TaskHistoryView, base));
  assert.equal(findPressable(latest, 'Next month'), undefined);
  let changed = null;
  const mid = await render(h(TaskHistoryView, { ...base, month: '2026-10', onMonthChange: m => { changed = m; } }));
  assert.equal(styleOf(findPressable(mid, 'Previous month')).width, 48);
  await press(findPressable(mid, 'Previous month'));
  assert.equal(changed, '2026-09');
  await press(findPressable(mid, 'Next month'));
  assert.equal(changed, '2026-11');
  assert.ok(allText(mid).includes('October 2026'));
});

test('Load earlier tasks calls fetchNextPage while there is a next page, and is absent otherwise', async () => {
  ready([item(1, 0, 'VERIFIED')], { nextCursor: 'c' }, { hasNextPage: true });
  const r = await render(h(TaskHistoryView, base));
  await press(findPressable(r, 'Load earlier tasks'));
  assert.equal(state.fetchNext, 1);
  ready([item(1, 0, 'VERIFIED')]);
  const none = await render(h(TaskHistoryView, base));
  assert.equal(findPressable(none, 'Load earlier tasks'), undefined);
});

test('an error shows the retry state and Try again refetches', async () => {
  state.result = { data: undefined, isError: true, error: new Error('x'), hasNextPage: false };
  const r = await render(h(TaskHistoryView, base));
  assert.ok(allText(r).includes('Something could not load'));
  await press(findPressable(r, 'Try again'));
  assert.equal(state.refetch, 1);
  assert.equal(rows(r).length, 0);
});

test('loading shows five skeleton rows, no legend and no text rows', async () => {
  state.result = { data: undefined, isError: false, hasNextPage: false };
  const r = await render(h(TaskHistoryView, base));
  assert.equal(r.root.findAll(n => n.type === 'View' && styleOf(n).minHeight === 76).length, 5);
  assert.equal(rows(r).length, 0);
  assert.ok(!allText(r).includes('Verified'));
});

test('empty month says no finished tasks; empty filter says try another filter', async () => {
  ready([], { counts: { verified: 0, waiting: 0, missed: 0, total: 0 } });
  const r = await render(h(TaskHistoryView, base));
  assert.ok(allText(r).includes('Nothing here yet'));
  assert.ok(allText(r).includes('No finished tasks this month.'));
  await press(findPressable(r, 'Missed'));
  assert.ok(allText(r).includes('Try another filter.'));
});

test('Urdu: translated chips and month, reversed rows, mirrored arrows', async () => {
  setLanguage('ur');
  ready([item(1, 0, 'VERIFIED')]);
  const r = await render(h(TaskHistoryView, { ...base, month: '2026-10' }));
  const text = allText(r);
  assert.ok(text.includes(translate('Missed', 'ur')));
  assert.ok(text.includes(translate('Today', 'ur')));
  assert.ok(text.includes('اکتوبر 2026'));
  const prev = findPressable(r, translate('Previous month', 'ur'));
  assert.ok(prev && findPressable(r, translate('Next month', 'ur')));
  const bar = r.root.findAll(n => n.type === 'View' && styleOf(n).justifyContent === 'space-between' && styleOf(n).paddingTop === 10)[0];
  assert.equal(styleOf(bar).flexDirection, 'row-reverse');
  assert.deepEqual(prev.findAll(n => n.type === 'Icon').map(n => n.props.name), ['ChevronRight']);
  assert.ok(findPressable(r, translate('Next month', 'ur')).findAll(n => n.type === 'Icon').some(n => n.props.name === 'ChevronLeft'));
  assert.ok(icons(r).includes('ChevronLeft'));
});

test('onRange is called with the server range once, not again on re-render', async () => {
  ready([item(1, 0, 'VERIFIED')]);
  const seen = [];
  const props = { ...base, onRange: x => seen.push(x) };
  const r = await render(h(TaskHistoryView, props));
  assert.deepEqual(seen, [range]);
  await press(findPressable(r, 'Missed')); // re-render with the same range
  assert.equal(seen.length, 1);
});
