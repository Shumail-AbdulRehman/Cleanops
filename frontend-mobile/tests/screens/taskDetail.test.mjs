import assert from 'node:assert/strict';
import test from 'node:test';
import { installMocks, setLanguage, render, allText, findPressable, press, navigationCalls, resetCalls } from '../support/nativeHarness.mjs';

const React = (await import('react')).default;
const { translate } = await import('../../src/i18n/translations.ts');
// The shared harness t() drops placeholder values; the real provider fills them, so stand in the same.
const useLanguage = () => {
  const language = globalThis.__nativeHarness.language;
  return { language, isRTL: language === 'ur', t: (text, values) => translate(text, language, values), setLanguage() {} };
};

// Per-test data, read live by the mocks.
const data = { feed: [], detail: undefined, detailError: false, manifest: undefined, manifestError: false, attendance: [] };
const iso = (h, m = 0) => `2026-11-11T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00.000Z`;
const makeTask = (extra = {}) => ({
  id: 7, title: 'Clean the washroom', areaNameSnapshot: 'Block A', status: 'PENDING', date: '2026-11-11',
  shiftStart: iso(9), shiftEnd: iso(11), startedAt: null, completedAt: null, proofImageUrls: [],
  location: { id: 1, name: 'HQ', timezone: 'UTC' }, template: { id: 1, description: 'Mop twice <b>please</b>' }, ...extra,
});
const checkedInRecord = () => ({
  id: 1, date: '2026-11-11', expectedStart: new Date(Date.now() - 3600_000).toISOString(), expectedEnd: new Date(Date.now() + 3600_000).toISOString(),
  checkInTime: new Date(Date.now() - 1800_000).toISOString(), checkOutTime: null, status: 'CHECKED_IN', location: { id: 1, name: 'HQ' },
});
const manifestFor = (extra = {}) => ({
  photoChecking: { available: true },
  task: { id: 7, title: 'x', status: 'PENDING', verificationVersion: 2, verificationState: 'NOT_STARTED', areaNameSnapshot: 'Block A' },
  items: [
    { id: '1', nameSnapshot: 'Toilet', typeSnapshot: 'TOILET', mandatory: true, requirements: [
      { id: 'r1', mandatory: true, instructionsSnapshot: 'a' }, { id: 'r2', mandatory: true, instructionsSnapshot: 'b' }, { id: 'r3', mandatory: false, instructionsSnapshot: 'c' }] },
    { id: '2', nameSnapshot: 'Mirror', typeSnapshot: 'MIRROR', mandatory: true, requirements: [{ id: 'r4', mandatory: true, instructionsSnapshot: 'd' }] },
  ],
  session: null, ...extra,
});

installMocks({
  '/components/ui/icon': { Icon: props => React.createElement('Icon', props) },
  '@react-native-community/netinfo': { default: { addEventListener: () => () => {} } },
  '/i18n/LanguageProvider': { useLanguage },
  '@react-navigation/native': {
    useRoute: () => ({ params: { taskId: 7 } }),
    // The shared harness navigation has no popTo; record it the same way.
    useNavigation: () => Object.fromEntries(['navigate', 'goBack', 'popTo', 'replace', 'reset', 'setOptions'].map(name => [name, (...args) => navigationCalls().push({ name, args })]).concat([['addListener', () => () => {}]])),
  },
  '/verification/api': { verificationManifest: async () => { throw new Error('unused'); } },
  '@tanstack/react-query': {
    infiniteQueryOptions: options => options,
    useQuery: ({ queryKey }) => {
      const last = queryKey[queryKey.length - 1];
      const base = { refetch: async () => ({}), isError: false, isPending: false, data: undefined };
      if (last === 'manifest') return data.manifestError ? { ...base, isError: true } : { ...base, data: data.manifest };
      if (last === 'attendance') return { ...base, data: data.attendance };
      return data.detailError ? { ...base, isError: true } : { ...base, data: data.detail };
    },
    useInfiniteQuery: () => ({ data: { pages: [{ tasks: data.feed, counts: {}, nextCursor: null }] }, refetch: async () => ({}), hasNextPage: false, fetchNextPage() {} }),
    useQueryClient: () => ({ invalidateQueries: async () => {}, setQueryData() {}, getQueryData() {} }),
  },
});
const { StyleSheet } = await import('react-native');
const { TaskDetailScreen, stepFor } = await import('../../src/screens/task/TaskDetailScreen.tsx');
const { colors } = await import('../../src/design/tokens.ts');
const h = React.createElement;
const styleOf = node => StyleSheet.flatten(node.props.style);
const byTestId = (r, id) => r.root.findAll(n => n.props.testID === id && typeof n.type === 'string');

test.beforeEach(() => {
  Object.assign(data, { feed: [makeTask()], detail: undefined, detailError: false, manifest: manifestFor(), manifestError: false, attendance: [checkedInRecord()] });
  resetCalls();
});
test.afterEach(() => setLanguage('en'));

test('pending task: step 1 is current and "Start cleaning" opens StartTask', async () => {
  const r = await render(h(TaskDetailScreen));
  const text = allText(r);
  assert.ok(text.includes('Task 7') && text.includes('Block A') && text.includes('Clean the washroom'));
  assert.ok(text.includes('Not started'));
  assert.ok(text.includes('9:00 – 11:00 AM'), text);
  assert.equal(styleOf(byTestId(r, 'step-circle-1')[0]).backgroundColor, colors.yellow);
  assert.equal(styleOf(byTestId(r, 'step-circle-2')[0]).backgroundColor, colors.canvas);
  await press(findPressable(r, 'Start cleaning'));
  const call = navigationCalls().find(c => c.name === 'navigate');
  assert.deepEqual(call.args, ['StartTask', { taskId: 7 }]);
});

test('in progress: step 1 done (blue), step 2 yellow, and "Take task photos" opens Verification with the QR requirement', async () => {
  data.feed = [makeTask({ status: 'IN_PROGRESS', startedAt: iso(9, 5) })];
  const r = await render(h(TaskDetailScreen));
  assert.equal(styleOf(byTestId(r, 'step-circle-1')[0]).backgroundColor, colors.blue);
  assert.equal(styleOf(byTestId(r, 'step-circle-2')[0]).backgroundColor, colors.yellow);
  assert.equal(styleOf(byTestId(r, 'step-line-2')[0]).backgroundColor, colors.blue);
  assert.equal(styleOf(byTestId(r, 'step-line-3')[0]).backgroundColor, colors.line);
  assert.ok(allText(r).includes('In progress'));
  assert.equal(findPressable(r, 'Start cleaning'), undefined);
  await press(findPressable(r, 'Take task photos'));
  assert.deepEqual(navigationCalls().find(c => c.name === 'navigate').args, ['Verification', { taskId: 7, requirePhotoQr: true }]);
});

test('step mapping: photos needed, retake and overdue are step 3; submitted is all done', () => {
  assert.deepEqual(stepFor('notStarted'), { current: 1, allDone: false });
  assert.deepEqual(stepFor('inProgress'), { current: 2, allDone: false });
  for (const kind of ['photosNeeded', 'retake', 'overdue']) assert.deepEqual(stepFor(kind), { current: 3, allDone: false });
  assert.deepEqual(stepFor('submitted'), { current: 4, allDone: true });
});

test('retake shows step 3 and the photos button', async () => {
  data.feed = [makeTask({ status: 'IN_PROGRESS', verificationState: 'REWORK_REQUIRED' })];
  const r = await render(h(TaskDetailScreen));
  assert.equal(styleOf(byTestId(r, 'step-circle-3')[0]).backgroundColor, colors.yellow);
  assert.ok(findPressable(r, 'Take task photos'));
});

test('submitted task: every step done, no button', async () => {
  data.feed = [makeTask({ status: 'COMPLETED', completionOutcome: 'SUBMITTED' })];
  const r = await render(h(TaskDetailScreen));
  for (const n of [1, 2, 3, 4]) assert.equal(styleOf(byTestId(r, `step-circle-${n}`)[0]).backgroundColor, colors.blue);
  assert.equal(findPressable(r, 'Take task photos'), undefined);
  assert.equal(findPressable(r, 'Start cleaning'), undefined);
  assert.equal(findPressable(r, 'Check in'), undefined);
  assert.ok(allText(r).includes('Submitted'));
});

test('before check-in: yellow note and "Check in" to My day, no start button', async () => {
  data.attendance = [];
  const r = await render(h(TaskDetailScreen));
  assert.ok(allText(r).includes('Check in before starting a task.'));
  const note = r.root.findAll(n => typeof n.type === 'string' && n.props.style && styleOf(n).backgroundColor === colors.yellowWash);
  assert.ok(note.length > 0);
  assert.equal(findPressable(r, 'Start cleaning'), undefined);
  await press(findPressable(r, 'Check in'));
  assert.deepEqual(navigationCalls().find(c => c.name === 'popTo').args, ['StaffTabs', { screen: 'Shift' }]);
  assert.equal(navigationCalls().some(c => c.name === 'navigate'), false);
});

test('photos unavailable on a started task: red note and no button', async () => {
  data.feed = [makeTask({ status: 'IN_PROGRESS' })];
  data.manifest = manifestFor({ photoChecking: { available: false } });
  const r = await render(h(TaskDetailScreen));
  const text = allText(r);
  assert.ok(text.includes('Task photos are unavailable'));
  assert.ok(text.includes('Results already received are kept. Ask your manager what to do next.'));
  assert.ok(r.root.findAll(n => typeof n.type === 'string' && n.props.style && styleOf(n).backgroundColor === colors.badWash).length > 0);
  assert.equal(findPressable(r, 'Take task photos'), undefined);
});

test('manifest items render with photo counts from mandatory requirements', async () => {
  const r = await render(h(TaskDetailScreen));
  const text = allText(r);
  assert.ok(text.includes('What to clean'));
  assert.ok(text.includes('Toilet') && text.includes('2 photos'), text);
  assert.ok(text.includes('Mirror') && text.includes('1 photo') && !text.includes('1 photos'));
  const icons = r.root.findAll(n => n.type === 'Icon').map(n => n.props.name);
  assert.ok(icons.includes('Toilet') && icons.includes('RectangleVertical'));
});

test('a failed manifest read hides the section and shows no error', async () => {
  data.manifest = undefined;
  data.manifestError = true;
  const r = await render(h(TaskDetailScreen));
  const text = allText(r);
  assert.ok(!text.includes('What to clean'));
  assert.ok(!text.includes('Try again'));
  assert.ok(text.includes('Block A'));
});

test('manager note renders untranslated, even in Urdu', async () => {
  setLanguage('ur');
  const r = await render(h(TaskDetailScreen));
  const text = allText(r);
  assert.ok(text.includes('Mop twice <b>please</b>'));
  assert.ok(text.includes(translate('Note from your manager', 'ur')));
});

test('Urdu: the time line and a Latin manager note are isolated so they keep their order', async () => {
  setLanguage('ur');
  data.feed = [makeTask({ template: { id: 1, description: 'Refill the soap dispensers.' } })];
  const r = await render(h(TaskDetailScreen));
  const text = allText(r);
  assert.ok(text.includes('\u20689:00 – 11:00 AM\u2069'), text);
  assert.ok(text.includes('\u2068Refill the soap dispensers.\u2069'), text);
});

test('step lines sit behind the circles and step labels never truncate', async () => {
  data.feed = [makeTask({ status: 'IN_PROGRESS' })];
  const r = await render(h(TaskDetailScreen));
  for (const n of [2, 3, 4]) {
    const step = byTestId(r, 'step-line-' + n)[0].parent;
    const kids = step.children.filter(c => typeof c !== 'string');
    assert.ok(kids.findIndex(c => c.props.testID === 'step-line-' + n) < kids.findIndex(c => c.props.testID === 'step-circle-' + n));
    assert.equal(styleOf(byTestId(r, 'step-line-' + n)[0]).zIndex, 0);
    assert.equal(styleOf(byTestId(r, 'step-line-' + n)[0]).marginHorizontal, styleOf(byTestId(r, 'step-circle-' + n)[0]).width / 2);
    assert.equal(styleOf(byTestId(r, 'step-circle-' + n)[0]).position, 'relative');
    assert.ok(styleOf(byTestId(r, 'step-circle-' + n)[0]).zIndex > 0);
    const labels = step.findAll(t => t.type === 'Text' && !t.props.testID);
    assert.ok(labels.every(l => l.props.numberOfLines === undefined));
  }
});

test('Urdu mirrors the step path and the lines', async () => {
  data.feed = [makeTask({ status: 'IN_PROGRESS' })];
  const en = await render(h(TaskDetailScreen));
  const list = en.root.findAll(n => n.props.accessibilityRole === 'list')[0];
  assert.equal(styleOf(list).flexDirection, 'row');
  assert.equal(styleOf(byTestId(en, 'step-line-2')[0]).right, '50%');
  setLanguage('ur');
  const ur = await render(h(TaskDetailScreen));
  const urList = ur.root.findAll(n => n.props.accessibilityRole === 'list')[0];
  assert.equal(styleOf(urList).flexDirection, 'row-reverse');
  assert.equal(styleOf(byTestId(ur, 'step-line-2')[0]).left, '50%');
  assert.ok(allText(ur).includes(translate('Scan QR', 'ur')));
  assert.ok(findPressable(ur, translate('Take task photos', 'ur')));
});

test('a task missing from the feed loads from the detail read; failure shows the error state', async () => {
  data.feed = [];
  data.detail = makeTask({ title: 'From detail' });
  let r = await render(h(TaskDetailScreen));
  assert.ok(allText(r).includes('From detail'));
  data.detail = undefined;
  data.detailError = true;
  r = await render(h(TaskDetailScreen));
  assert.ok(allText(r).includes('Try again'));
});

test('back button goes back', async () => {
  const r = await render(h(TaskDetailScreen));
  await press(findPressable(r, 'Back'));
  assert.ok(navigationCalls().some(c => c.name === 'goBack'));
});
