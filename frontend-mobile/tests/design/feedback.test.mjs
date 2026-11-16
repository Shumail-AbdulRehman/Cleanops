import assert from 'node:assert/strict';
import test, { mock } from 'node:test';
import { installMocks, setLanguage, render, allText, findPressable, press, resetCalls } from '../support/nativeHarness.mjs';
import { act } from 'react-test-renderer';

const React = (await import('react')).default;
let netState = { isConnected: true, isInternetReachable: true };
const listeners = new Set();
const NetInfo = {
  addEventListener: fn => { listeners.add(fn); fn(netState); return () => listeners.delete(fn); },
};
// lucide-react-native needs react-native-svg, which does not load under node: stand in an icon element.
installMocks({
  '/components/ui/icon': { Icon: props => React.createElement('Icon', props) },
  '@react-native-community/netinfo': { default: NetInfo },
});
const { StyleSheet } = await import('react-native');
const { SnackbarProvider, useSnackbar, OfflineBanner, useOnline, Skeleton, EmptyState, ErrorState } = await import('../../src/design/Feedback.tsx');
const { ActionButton } = await import('../../src/design/ActionButton.tsx');
const { colors, whiteAlpha } = await import('../../src/design/tokens.ts');
const { translate } = await import('../../src/i18n/translations.ts');

const h = React.createElement;
const styleOf = node => StyleSheet.flatten(node.props.style);

test.afterEach(() => {
  setLanguage('en'); resetCalls(); netState = { isConnected: true, isInternetReachable: true }; listeners.clear();
  mock.timers.reset();
});

function Trigger({ api }) { api.current = useSnackbar(); return null; }

test('show renders the translated message, then it disappears after 2.2 seconds', async () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  const api = {};
  const r = await render(h(SnackbarProvider, null, h(Trigger, { api })));
  assert.equal(allText(r), '');
  await act(async () => { api.current.show('Try again'); });
  assert.ok(allText(r).includes('Try again'));
  const bar = r.root.findAll(n => n.type === 'View' && n.props.accessibilityLiveRegion === 'polite')[0];
  assert.equal(styleOf(bar).backgroundColor, colors.ink);
  assert.equal(styleOf(bar).bottom, 84); // tab bar 72 + 12 (spec 65 owns the offset checks)
  await act(async () => { mock.timers.tick(2199); });
  assert.ok(allText(r).includes('Try again'));
  await act(async () => { mock.timers.tick(1); });
  assert.equal(allText(r), '');
});

test('a second show replaces the first and restarts the timer', async () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  const api = {};
  const r = await render(h(SnackbarProvider, null, h(Trigger, { api })));
  await act(async () => { api.current.show('Try again'); });
  await act(async () => { mock.timers.tick(1500); });
  await act(async () => { api.current.show('Internet needed to continue'); });
  assert.ok(!allText(r).includes('Try again'));
  assert.ok(allText(r).includes('Internet needed to continue'));
  await act(async () => { mock.timers.tick(1500); });
  assert.ok(allText(r).includes('Internet needed to continue'));
  await act(async () => { mock.timers.tick(700); });
  assert.equal(allText(r), '');
});

test('useSnackbar without a provider does not throw', async () => {
  const api = {};
  await render(h(Trigger, { api }));
  assert.doesNotThrow(() => api.current.show('Try again'));
});

test('OfflineBanner renders nothing online and both lines offline', async () => {
  const online = await render(h(OfflineBanner));
  assert.equal(online.toJSON(), null);
  netState = { isConnected: true, isInternetReachable: false };
  const r = await render(h(OfflineBanner));
  assert.ok(allText(r).includes('Internet needed to continue'));
  assert.ok(allText(r).includes('You are seeing the last saved information.'));
  netState = { isConnected: false, isInternetReachable: null };
  assert.ok(allText(await render(h(OfflineBanner))).includes('Internet needed'));
});

test('useOnline follows connectivity changes and treats unknown as online', async () => {
  let value;
  function Probe() { value = useOnline(); return null; }
  netState = { isConnected: true, isInternetReachable: null };
  await render(h(Probe));
  assert.equal(value, true);
  await act(async () => { listeners.forEach(fn => fn({ isConnected: false, isInternetReachable: false })); });
  assert.equal(value, false);
});

test('Skeleton uses the tone colours', async () => {
  const a = await render(h(Skeleton, { width: 120, height: 14, radius: 7 }));
  assert.equal(styleOf(a.root.findAll(n => n.type === 'View')[0]).backgroundColor, colors.line);
  const b = await render(h(Skeleton, { height: 14, tone: 'onBlue' }));
  assert.equal(styleOf(b.root.findAll(n => n.type === 'View')[0]).backgroundColor, whiteAlpha.block);
});

test('ErrorState shows defaults and calls onRetry', async () => {
  let calls = 0;
  const r = await render(h(ErrorState, { onRetry: () => { calls += 1; } }));
  assert.ok(allText(r).includes('Something could not load'));
  assert.ok(allText(r).includes('Your saved work is unchanged.'));
  await press(findPressable(r, 'Try again'));
  assert.equal(calls, 1);
});

test('EmptyState renders title, body and its action', async () => {
  let calls = 0;
  const r = await render(h(EmptyState, {
    icon: 'Inbox', title: 'Nothing here', body: 'Check your internet and try again.',
    action: h(ActionButton, { kind: 'outline', label: 'Try again', onPress: () => { calls += 1; } }),
  }));
  assert.ok(allText(r).includes('Nothing here'));
  await press(findPressable(r, 'Try again'));
  assert.equal(calls, 1);
});

test('Urdu shows the Urdu banner text and reverses the row', async () => {
  setLanguage('ur');
  netState = { isConnected: false, isInternetReachable: false };
  const r = await render(h(OfflineBanner));
  assert.ok(allText(r).includes(translate('Internet needed to continue', 'ur')));
  assert.equal(styleOf(r.root.findAll(n => n.type === 'View')[0]).flexDirection, 'row-reverse');
});
