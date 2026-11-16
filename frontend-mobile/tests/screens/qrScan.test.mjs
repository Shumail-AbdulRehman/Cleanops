import assert from 'node:assert/strict';
import test from 'node:test';
import { installMocks, setLanguage, render, allText, findPressable, press, hapticsCalls, resetCalls } from '../support/nativeHarness.mjs';

const React = (await import('react')).default;
const { act } = await import('react-test-renderer');
const { translate } = await import('../../src/i18n/translations.ts');

const harness = globalThis.__nativeHarness;
const pending = { id: 7, title: 'Morning clean', areaNameSnapshot: 'East washroom', status: 'PENDING', verificationVersion: 2,
  shiftStart: '2026-11-11T09:00:00.000Z', shiftEnd: '2026-11-11T10:00:00.000Z', startedAt: null, location: { timezone: 'UTC' } };
const s = {
  query: null, reduced: false, os: 'android', permission: null, requests: 0, settings: 0,
  appListeners: new Set(), calls: [], settle: null, repeats: [], refetches: 0,
};
function reset() {
  s.query = { data: { ...pending }, isPending: false, isError: false, error: null, refetch: async () => { s.refetches += 1; } };
  s.reduced = false; s.os = 'android'; s.permission = { granted: true, canAskAgain: true };
  s.requests = 0; s.settings = 0; s.calls = []; s.settle = null; s.repeats = []; s.refetches = 0;
}
reset();

installMocks({
  // lucide needs react-native-svg, which does not load under node.
  '/ui/icon': { Icon: props => React.createElement('Icon', props) },
  '@react-native-community/netinfo': { default: { addEventListener: () => () => {}, fetch: async () => ({ isConnected: true }) } },
  'react-native': {
    Platform: { get OS() { return s.os; }, select: map => map[s.os] ?? map.default },
    Linking: { openSettings: async () => { s.settings += 1; }, openURL: async () => {} },
    AppState: { currentState: 'active', addEventListener: (_name, listener) => {
      s.appListeners.add(listener); return { remove: () => s.appListeners.delete(listener) };
    } },
  },
  'react-native-reanimated': {
    useReducedMotion: () => s.reduced,
    withRepeat: (value, count, reverse) => { s.repeats.push({ value, count, reverse }); return value; },
    withTiming: (value, config) => (config?.duration === 1900 ? { to: value, config } : value),
  },
  'expo-camera': {
    CameraView: 'CameraView',
    useCameraPermissions: () => [s.permission, async () => { s.requests += 1; return { granted: true }; }],
  },
  '@tanstack/react-query': { useQuery: () => s.query, useQueryClient: () => ({ setQueryData() {}, invalidateQueries: async () => {} }) },
  '/api/client': { client: { get: async () => { throw new Error('Unexpected network call'); } } },
  '/api/startCleaning': { startCleaning: (_cache, _key, taskId, areaQr) => {
    s.calls.push({ taskId, areaQr });
    return new Promise((resolve, reject) => { s.settle = { resolve, reject }; });
  } },
  '/queries/staff': { staffQueryKeys: { tasksToday: id => ['staff', id, 'today'] } },
  // The default harness t() drops placeholder values; this screen fills {area}, {time}, {end}.
  '/i18n/LanguageProvider': {
    useLanguage: () => ({
      language: harness.language, isRTL: harness.language === 'ur', setLanguage: () => {},
      t: (text, values) => translate(text, harness.language, values),
    }),
  },
});
const { StyleSheet } = await import('react-native');
const { StartTaskScreen } = await import('../../src/screens/StartTaskScreen.tsx');

const h = React.createElement;
const plain = value => value.replace(/[⁨⁩]/g, '');
const text = r => plain(allText(r));
const texts = r => r.root.findAll(n => n.type === 'Text').map(n => plain(n.children.filter(c => typeof c === 'string').join('')));
const flush = work => act(async () => { await work?.(); await Promise.resolve(); });
const cameraDelay = () => flush(() => new Promise(resolve => setTimeout(resolve, 400)));
const cameras = r => r.root.findAll(n => n.type === 'CameraView');
const modal = r => r.root.findAll(n => n.type === 'Modal')[0];

let mounted = null;
async function mount() {
  const nav = [];
  const navigation = {
    goBack: () => nav.push(['goBack']), replace: (...args) => nav.push(['replace', ...args]),
    setOptions: options => nav.push(['setOptions', options]),
  };
  const r = await render(h(StartTaskScreen, { route: { params: { taskId: 7 } }, navigation }));
  mounted = r;
  return { r, nav };
}
async function readyCamera(r) {
  await cameraDelay();
  const camera = cameras(r)[0].props;
  await flush(() => camera.onCameraReady());
  return camera;
}

test.afterEach(async () => {
  if (mounted) await flush(() => mounted.unmount());
  mounted = null; setLanguage('en'); resetCalls(); reset();
});

test('scanning state: dark screen, header hidden, title, the area, viewfinder and hint', async () => {
  const { r, nav } = await mount();
  assert.deepEqual(nav[0], ['setOptions', { headerShown: false }]);
  const t = text(r);
  assert.ok(t.includes('Scan the task QR'));
  assert.ok(t.includes('Find the code for East washroom.'));
  assert.ok(t.includes('Hold the QR inside the frame. It scans by itself.'));
  assert.ok(t.includes('Opening camera…'), 'status before the camera mounts');
  const title = r.root.findAll(n => n.type === 'Text' && n.props.accessibilityRole === 'header')[0];
  assert.equal(plain(title.children.join('')), 'Scan the task QR');
  const frame = r.root.findAll(n => n.props.testID === 'photo-viewfinder')[0];
  assert.equal(StyleSheet.flatten(frame.props.style).width, 236);
  await readyCamera(r);
  assert.ok(!text(r).includes('Opening camera…'));
  await press(findPressable(r, 'Back'));
  assert.deepEqual(nav.at(-1), ['goBack']);
});

test('the scan line moves up and down over 1.9 s, and stays still in the middle under reduced motion', async () => {
  const { r } = await mount();
  assert.equal(s.repeats.length, 1);
  assert.equal(s.repeats[0].count, -1);
  assert.equal(s.repeats[0].reverse, true);
  assert.equal(s.repeats[0].value.config.duration, 1900);
  await flush(() => r.unmount()); mounted = null;
  s.repeats = []; s.reduced = true;
  const again = await mount();
  assert.equal(s.repeats.length, 0);
  const line = again.r.root.findAll(n => n.props.testID === 'photo-scan-line')[0];
  const { transform } = StyleSheet.flatten(line.props.style);
  assert.equal(transform[0].translateY, 0.5 * (236 - 3));
});

test('a double scan calls startCleaning once and shows the busy card', async () => {
  const { r } = await mount();
  const camera = await readyCamera(r);
  await flush(() => { camera.onBarcodeScanned({ data: 'qr-1' }); camera.onBarcodeScanned({ data: 'qr-1' }); });
  assert.equal(s.calls.length, 1);
  assert.deepEqual(s.calls[0], { taskId: 7, areaQr: 'qr-1' });
  assert.ok(text(r).includes('Confirming…'));
  assert.equal(cameras(r).length, 0, 'scanner stops while confirming');
  assert.equal(findPressable(r, 'Restart scanner'), undefined);
});

test('a wrong-task QR opens the sheet with the area; Scan again restarts the camera', async () => {
  const { r, nav } = await mount();
  const camera = await readyCamera(r);
  await flush(() => camera.onBarcodeScanned({ data: 'other-task' }));
  await flush(() => s.settle.reject({ response: { data: {
    message: 'This QR code belongs to another task or is no longer valid. Scan the QR code generated for this task.',
    errors: [{ code: 'AREA_QR_MISMATCH' }],
  } } }));
  assert.ok(modal(r), 'sheet is open');
  const t = text(r);
  assert.ok(t.includes('This QR is for another task'));
  assert.ok(t.includes('Find the code for East washroom, then scan again.'));
  assert.equal(cameras(r).length, 0);
  assert.equal(nav.filter(([name]) => name === 'replace').length, 0);
  await press(findPressable(r, 'Scan again'));
  assert.equal(modal(r), undefined);
  const retry = await readyCamera(r);
  await flush(() => retry.onBarcodeScanned({ data: 'right-qr' }));
  assert.deepEqual(s.calls[1], { taskId: 7, areaQr: 'right-qr' });
});

test('any other failure says the start was not confirmed, with the server message; back on the sheet restarts', async () => {
  const { r } = await mount();
  const camera = await readyCamera(r);
  await flush(() => camera.onBarcodeScanned({ data: 'qr' }));
  await flush(() => s.settle.reject({ response: { data: { message: 'Task area changed. Refresh the task and scan again.' } } }));
  const t = text(r);
  assert.ok(t.includes("Couldn't confirm the start"));
  assert.ok(t.includes('Task area changed. Refresh the task and scan again.'));
  assert.ok(!t.includes('This QR is for another task'));
  await act(async () => { modal(r).props.onRequestClose(); });
  assert.equal(modal(r), undefined);
  await cameraDelay();
  assert.equal(cameras(r).length, 1);
});

test('a camera that never gets ready shows the restart message in the sheet', async () => {
  const { r } = await mount();
  await cameraDelay();
  await flush(() => cameras(r)[0].props.onMountError());
  assert.ok(text(r).includes('Camera could not open. Restart the scanner.'));
  await press(findPressable(r, 'Scan again'));
  await cameraDelay();
  assert.equal(cameras(r).length, 1);
});

test('success shows Cleaning started once with a success haptic, and Cleaning is finished opens the photos', async () => {
  const { r, nav } = await mount();
  const camera = await readyCamera(r);
  await flush(() => camera.onBarcodeScanned({ data: 'qr' }));
  await flush(() => s.settle.resolve({ ...pending, status: 'IN_PROGRESS', startedAt: '2026-11-11T09:05:00.000Z' }));
  const t = text(r);
  assert.ok(t.includes('Cleaning started'));
  assert.ok(t.includes('Started at 9:05 AM. Finish by 10:00 AM.'));
  assert.ok(t.includes('Clean everything on this list. Then scan the same QR to take photos.'));
  assert.ok(texts(r).includes('East washroom'), 'top bar shows the area');
  assert.equal(cameras(r).length, 0);
  assert.equal(hapticsCalls().filter(c => c.name === 'notificationAsync' && c.args[0] === 'success').length, 1);
  assert.equal(nav.filter(([name]) => name === 'replace').length, 0, 'starting leaves the worker in the cleaning period');
  await press(findPressable(r, 'Cleaning is finished'));
  assert.deepEqual(nav.at(-1), ['replace', 'Verification', { taskId: 7, requirePhotoQr: true }]);
});

test('the torch button toggles its label, its state and the camera torch', async () => {
  const { r } = await mount();
  await readyCamera(r);
  const on = findPressable(r, 'Torch on');
  assert.equal(on.props.accessibilityState.selected, false);
  assert.equal(cameras(r)[0].props.enableTorch, false);
  await press(on);
  const off = findPressable(r, 'Torch off');
  assert.ok(off);
  assert.equal(off.props.accessibilityState.selected, true);
  assert.equal(cameras(r)[0].props.enableTorch, true);
  await press(off);
  assert.ok(findPressable(r, 'Torch on'));
});

test('Restart scanner remounts the camera', async () => {
  const { r } = await mount();
  await readyCamera(r);
  const before = cameras(r)[0];
  await press(findPressable(r, 'Restart scanner'));
  await cameraDelay();
  assert.equal(cameras(r).length, 1);
  assert.notEqual(cameras(r)[0], before);
});

test('Urdu: the header time range is isolated so it keeps its order', async () => {
  setLanguage('ur');
  s.query.data = { ...pending, status: 'COMPLETED' };
  const { r } = await mount();
  assert.ok(allText(r).includes('\u20689:00 – 10:00 AM\u2069'), allText(r));
});

test('Urdu: the area sits on its own line, rows reverse, labels are Urdu', async () => {
  setLanguage('ur');
  const { r } = await mount();
  const lines = texts(r);
  assert.ok(lines.includes(translate('Scan the task QR', 'ur')));
  assert.ok(lines.includes('اس کام کا کوڈ تلاش کریں:'));
  assert.ok(lines.includes('East washroom'), 'area is a line of its own');
  assert.ok(!lines.some(line => line.includes('East washroom') && line !== 'East washroom'));
  const back = findPressable(r, 'واپس');
  assert.ok(back);
  const topRow = r.root.findAll(n => n.type === 'View' && StyleSheet.flatten(n.props.style)?.flexDirection === 'row-reverse');
  assert.ok(topRow.length > 0);
  assert.ok(findPressable(r, translate('Torch on', 'ur')));
  const camera = await readyCamera(r);
  await flush(() => camera.onBarcodeScanned({ data: 'other' }));
  await flush(() => s.settle.reject({ response: { data: { message: 'x', errors: [{ code: 'AREA_QR_MISMATCH' }] } } }));
  const sheet = texts(r);
  assert.ok(sheet.includes('یہ کیو آر کسی اور کام کا ہے'));
  assert.ok(sheet.includes('اس کام کا کوڈ تلاش کریں، پھر دوبارہ اسکین کریں:'));
  assert.equal(sheet.filter(line => line === 'East washroom').length, 2, 'area on its own line in the sheet too');
});

test('missing camera permission is asked once, then offers Allow camera or Open camera settings', async () => {
  s.permission = { granted: false, canAskAgain: true };
  const first = await mount();
  assert.equal(s.requests, 1, 'asked once on open');
  assert.ok(text(first.r).includes('Allow camera access to scan the task QR code.'));
  assert.equal(cameras(first.r).length, 0);
  assert.equal(findPressable(first.r, 'Torch on'), undefined);
  await press(findPressable(first.r, 'Allow camera'));
  assert.equal(s.requests, 2);
  await flush(() => first.r.unmount()); mounted = null;
  s.permission = { granted: false, canAskAgain: false };
  const second = await mount();
  assert.equal(s.requests, 2, 'not asked again when Android will not show the prompt');
  await press(findPressable(second.r, 'Open camera settings'));
  assert.equal(s.settings, 1);
});

test('web shows the installed-app message instead of a scanner', async () => {
  s.os = 'web';
  const { r } = await mount();
  assert.ok(text(r).includes('Open the installed Hygene Ops Staff app to scan the task QR.'));
  assert.equal(findPressable(r, 'Restart scanner'), undefined);
  await cameraDelay();
  assert.equal(cameras(r).length, 0);
});

test('a version 1 task asks for area inventory setup and never scans', async () => {
  s.query.data = { ...pending, verificationVersion: 1 };
  const { r } = await mount();
  assert.ok(text(r).includes('This task needs area inventory setup. Ask your manager to repair or replace it.'));
  assert.ok(texts(r).includes('Morning clean'));
  await cameraDelay();
  assert.equal(cameras(r).length, 0);
});

test('loading shows skeletons; a load error shows the message and retries', async () => {
  s.query = { ...s.query, data: undefined, isPending: true };
  const loading = await mount();
  assert.equal(loading.r.root.findAll(n => n.props.testID === 'start-task-loading').length, 1);
  assert.ok(texts(loading.r).includes('Start cleaning'));
  await flush(() => loading.r.unmount()); mounted = null;
  s.query = { ...s.query, isPending: false, isError: true, error: { response: { data: { message: 'Task not found' } } } };
  const failed = await mount();
  assert.ok(text(failed.r).includes('Task not found'));
  await press(findPressable(failed.r, 'Try again'));
  assert.equal(s.refetches, 1);
  await press(findPressable(failed.r, 'Back'));
});
