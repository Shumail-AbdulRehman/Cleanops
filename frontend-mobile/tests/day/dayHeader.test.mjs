import assert from 'node:assert/strict';
import test from 'node:test';
import { installMocks, setLanguage, setWindowSize, render, allText, findPressable, press } from '../support/nativeHarness.mjs';

const React = (await import('react')).default;
const { act } = await import('react-test-renderer');
const { translate } = await import('../../src/i18n/translations.ts');
// The shared harness t() drops placeholder values; the real provider fills them, so stand in the same.
const useLanguage = () => {
  const language = globalThis.__nativeHarness.language;
  return { language, isRTL: language === 'ur', t: (text, values) => translate(text, language, values), setLanguage() {} };
};
const timings = [];
let reducedMotion = false;
installMocks({
  // lucide-react-native needs react-native-svg, which does not load under node.
  '/components/ui/icon': { Icon: props => React.createElement('Icon', props) },
  '@react-native-community/netinfo': { default: { addEventListener: () => () => {} } },
  '/i18n/LanguageProvider': { useLanguage },
  'react-native-reanimated': {
    useReducedMotion: () => reducedMotion,
    withTiming: (value, config) => { timings.push({ value, config }); return value; },
  },
});
const { StyleSheet } = await import('react-native');
const { DayHeader } = await import('../../src/screens/day/DayHeader.tsx');
const { colors } = await import('../../src/design/tokens.ts');
const { shortDay, clock } = await import('../../src/design/format.ts');
const { nowState } = await import('../../src/screens/day/nowState.ts');
const { NativeFontsReady } = await import('../../src/fonts.ts');

const h = React.createElement;
// render() mounts inside the fonts provider; updates must keep the same root so the header stays mounted.
const wrap = p => h(NativeFontsReady.Provider, { value: true }, h(DayHeader, p));
const styleOf = node => StyleSheet.flatten(node.props.style) ?? {};
const strip = text => text.replace(/[⁨⁩]/g, '');
const texts = r => r.root.findAll(n => n.type === 'Text');
const textOf = node => strip(node.children.join(''));
const byId = (r, id) => r.root.findAll(n => n.props.testID === id && typeof n.type === 'string');
const sky = r => byId(r, 'day-header')[0];
const titleTexts = r => byId(r, 'day-header-title')[0].findAll(n => n.type === 'Text');
const subTexts = r => byId(r, 'day-header-sub')[0].findAll(n => n.type === 'Text');
const avatarCircle = r => r.root.findAll(n => n.type === 'View' && n.props.accessible === false)[0];

test.afterEach(() => { setLanguage('en'); setWindowSize(390, 844); reducedMotion = false; timings.length = 0; });

const TZ = 'UTC';
const today = new Date('2026-11-10T07:00:00.000Z');
const text = (key, values = {}, name) => (name === undefined ? { key, values } : { key, values, name });
const before = {
  tone: 'blue', title: text('Check-in opens at {time}', { time: '8:30 AM' }),
  sub: text('Your shift starts at {time} at {place}.', { time: '9:00 AM', place: 'Gulberg Plaza' }, 'Gulberg Plaza'),
  rail: null, action: null, wait: null,
};
const rail = { checkedInAt: new Date('2026-11-10T08:58:00.000Z'), checkOutAt: new Date('2026-11-10T17:00:00.000Z'), progress: 0.4 };
const next = (area = 'Lobby') => ({
  tone: 'blue', title: text('Next: {area}', { area }, area),
  sub: text('{title}. Finish by {time}.', { title: 'Wash floor', time: '11:00 AM' }, 'Wash floor'),
  rail, action: { kind: 'startCleaning', taskId: 4 }, wait: null,
});
const props = (state, extra = {}) => ({ state, firstName: 'Ayesha', today, timeZone: TZ, onAvatarPress() {}, ...extra });

test('before check-in: greeting, date, full-size sentence, no rail', async () => {
  const r = await render(h(DayHeader, props(before)));
  const all = strip(allText(r));
  assert.ok(all.includes('Salaam, Ayesha'));
  assert.ok(all.includes(shortDay(today, TZ, 'en')));
  assert.ok(all.includes('Check-in opens at 8:30 AM'));
  assert.ok(all.includes('Your shift starts at 9:00 AM at Gulberg Plaza.'));
  assert.equal(byId(r, 'day-header-rail').length, 0);
  assert.equal(styleOf(sky(r)).backgroundColor, colors.blue);
  assert.equal(styleOf(sky(r)).paddingBottom, 46);
  assert.equal(styleOf(titleTexts(r)[0]).fontSize, 31);
  assert.equal(styleOf(subTexts(r)[0]).color, colors.onBlue);
  assert.equal(styleOf(avatarCircle(r)).width, 44);
  assert.ok(r.root.findAll(n => n.props.accessibilityRole === 'tablist').length === 1, 'language switch shown');
});

test('after check-in: rail shows both times, the date is gone, compact sizes', async () => {
  const r = await render(h(DayHeader, props(next())));
  const all = strip(allText(r));
  assert.equal(byId(r, 'day-header-rail').length, 1);
  assert.ok(all.includes(`Checked in ${clock(rail.checkedInAt, TZ)}`));
  assert.ok(all.includes(`Check-out ${clock(rail.checkOutAt, TZ)}`));
  assert.ok(!all.includes(shortDay(today, TZ, 'en')));
  assert.equal(styleOf(sky(r)).paddingBottom, 32);
  assert.equal(styleOf(titleTexts(r)[0]).fontSize, 26);
  assert.equal(styleOf(avatarCircle(r)).width, 38);
  assert.ok(all.includes('Next: Lobby'));
  assert.ok(all.includes('Wash floor. Finish by 11:00 AM.'));
  const fill = r.root.findAll(n => n.type === 'View' && styleOf(n).width === '40%');
  assert.equal(fill.length, 1);
  assert.equal(styleOf(fill[0]).left, 0);
});

test('tones: quiet uses night2, bad uses badDeep, ok uses ok; secondary text is onDarkSoft', async () => {
  for (const [tone, token] of [['quiet', 'night2'], ['bad', 'badDeep'], ['ok', 'ok']]) {
    const r = await render(h(DayHeader, props({ ...before, tone, title: text('Shift time closed'), sub: text('Check your internet and try again.') })));
    assert.equal(styleOf(sky(r)).backgroundColor, colors[token], tone);
    assert.equal(styleOf(subTexts(r)[0]).color, colors.onDarkSoft, tone);
  }
});

test('decorative tick is hidden from accessibility and mirrored in Urdu', async () => {
  const tick = r => r.root.findAll(n => n.type === 'Icon' && n.props.size === 250)[0].parent.parent;
  const en = await render(h(DayHeader, props(before)));
  assert.equal(tick(en).props.accessibilityElementsHidden, true);
  assert.equal(styleOf(tick(en)).right, -46);
  setLanguage('ur');
  const ur = await render(h(DayHeader, props(before)));
  assert.equal(styleOf(tick(ur)).left, -46);
  assert.deepEqual(styleOf(tick(ur)).transform, [{ scaleX: -1 }]);
});

test('Urdu next task: label and task name are separate texts, rows reverse, task title on its own line', async () => {
  setLanguage('ur');
  const r = await render(h(DayHeader, props(next())));
  const title = titleTexts(r).map(textOf);
  assert.deepEqual(title, [translate('Next: {area}', 'ur').replace('{area}', '').trim(), 'Lobby']);
  assert.ok(strip(allText(r)).includes(translate('Salaam, {name}', 'ur', { name: 'Ayesha' })));
  const greetingRow = r.root.findAll(n => n.type === 'View' && styleOf(n).minHeight === 44)[0];
  assert.equal(styleOf(greetingRow).flexDirection, 'row-reverse');
  assert.deepEqual(subTexts(r).map(textOf), ['Wash floor', translate('Finish by {time}.', 'ur', { time: '11:00 AM' })]);
  assert.ok(strip(allText(r)).includes(translate('Checked in {time}', 'ur', { time: clock(rail.checkedInAt, TZ) })));
  const fill = r.root.findAll(n => n.type === 'View' && styleOf(n).width === '40%')[0];
  assert.equal(styleOf(fill).right, 0);
});

test('Urdu before check-in: the sentence without the place, then the place on its own line with a pin, and the Urdu date', async () => {
  setLanguage('ur');
  const r = await render(h(DayHeader, props(before)));
  assert.deepEqual(subTexts(r).map(textOf), [translate('Your shift starts at {time}.', 'ur', { time: '9:00 AM' }), 'Gulberg Plaza']);
  assert.equal(byId(r, 'day-header-sub')[0].findAll(n => n.type === 'Icon' && n.props.name === 'MapPin').length, 1);
  assert.ok(strip(allText(r)).includes(shortDay(today, TZ, 'ur')));
});

test('a 30-character name uses the long title role, compact after check-in', async () => {
  const area = 'North wing staff washroom area';
  assert.equal(area.length, 30);
  const open = await render(h(DayHeader, props({ ...next(area), rail: null })));
  assert.equal(styleOf(titleTexts(open)[0]).fontSize, 27);
  assert.equal(titleTexts(open)[0].props.numberOfLines, 3);
  const compact = await render(h(DayHeader, props(next(area))));
  assert.equal(styleOf(titleTexts(compact)[0]).fontSize, 23);
  const short = await render(h(DayHeader, props(next('Lobby'))));
  assert.equal(styleOf(titleTexts(short)[0]).fontSize, 26);
});

test('pressing the avatar calls onAvatarPress', async () => {
  let pressed = 0;
  const r = await render(h(DayHeader, props(before, { onAvatarPress: () => { pressed += 1; } })));
  const avatar = findPressable(r, 'Profile');
  assert.ok(avatar);
  assert.equal(avatar.props.accessibilityRole, 'button');
  await press(avatar);
  assert.equal(pressed, 1);
  setLanguage('ur');
  const u = await render(h(DayHeader, props(before)));
  assert.ok(findPressable(u, translate('Profile', 'ur')));
});

test('loading renders skeletons on blue and no sentence', async () => {
  const r = await render(h(DayHeader, props(before, { loading: true })));
  assert.equal(byId(r, 'day-header-loading').length, 1);
  assert.equal(byId(r, 'day-header-title').length, 0);
  assert.equal(texts(r).length, 0);
  assert.equal(styleOf(sky(r)).backgroundColor, colors.blue);
  const blocks = r.root.findAll(n => n.type === 'View' && n.props.accessibilityElementsHidden === true && styleOf(n).height > 0 && styleOf(n).height < 50);
  assert.equal(blocks.length, 6);
  assert.equal(findPressable(r, 'Profile'), undefined);
});

test('the sentence fades up 8 over 220 ms when the title changes; reduced motion fades only', async () => {
  const r = await render(h(DayHeader, props(before)));
  assert.equal(timings.length, 0, 'no motion on first mount');
  await act(async () => { r.update(wrap(props({ ...before, title: text('Check in to start your shift') }))); });
  assert.ok(timings.some(c => c.value === 0 && c.config.duration === 220));
  assert.ok(timings.every(c => c.config.duration === 220));
  timings.length = 0;
  await act(async () => { r.update(wrap(props({ ...before, title: text('Check in to start your shift'), sub: text('Other sub') }))); });
  assert.equal(timings.length, 0, 'a new sub alone does not replay the motion');
  reducedMotion = true;
  await act(async () => { r.update(wrap(props({ ...before, title: text('You are late. Check in now.') }))); });
  assert.ok(timings.length > 0 && timings.every(c => c.config.duration === 120));
  const animated = byId(r, 'day-header-title')[0].parent.parent;
  assert.deepEqual(styleOf(animated).transform, [{ translateY: 0 }]);
});

test('at 360 wide the rail times never truncate (no line limit, rail may wrap), with the narrow gutter', async () => {
  setWindowSize(360, 700);
  for (const language of ['en', 'ur']) {
    setLanguage(language);
    const r = await render(h(DayHeader, props(next())));
    assert.equal(styleOf(sky(r)).paddingHorizontal, 16);
    const railTexts = byId(r, 'day-header-rail')[0].findAll(n => n.type === 'Text');
    assert.equal(railTexts.length, 2);
    assert.ok(railTexts.every(n => n.props.numberOfLines === undefined && n.props.ellipsizeMode === undefined));
    const row = byId(r, 'day-header-rail')[0].findAll(n => n.type === 'View' && styleOf(n).justifyContent === 'space-between')[0];
    assert.equal(styleOf(row).flexDirection, language === 'ur' ? 'row-reverse' : 'row');
    assert.equal(styleOf(row).justifyContent, 'space-between');
    assert.equal(styleOf(row).flexWrap, 'wrap');
  }
});

test('works with a real nowState result after check-in', async () => {
  const record = {
    id: 1, staffId: 2, date: '2026-11-10', status: 'CHECKED_IN', expectedStart: '2026-11-10T09:00:00.000Z', expectedEnd: '2026-11-10T17:00:00.000Z',
    checkInTime: '2026-11-10T08:58:00.000Z', checkOutTime: null, location: { id: 1, name: 'HQ' },
  };
  const state = nowState({ hasLocation: true, record, tasks: [], now: new Date('2026-11-10T12:00:00.000Z'), online: true, failed: false, photosAvailable: true, timeZone: TZ });
  const r = await render(h(DayHeader, props(state)));
  assert.equal(byId(r, 'day-header-rail').length, 1);
  assert.ok(strip(allText(r)).includes(translate(state.title.key, 'en')));
});
