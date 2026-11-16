import assert from 'node:assert/strict';
import test from 'node:test';
import { installMocks, setLanguage, allText, findPressable, press } from '../support/nativeHarness.mjs';

const React = (await import('react')).default;
const { create, act } = await import('react-test-renderer');
const { translate } = await import('../../src/i18n/translations.ts');
const harness = globalThis.__nativeHarness;

// Spec 68: a failed photo-QR scan pauses the scanner until the person taps Scan again.
// Boundary state the mocks read: server manifest, capture session, network, camera permission, feed cache, native clock, account.
const S = {};
const netListeners = new Set();
const appListeners = new Set();
const SERVER_TIME = '2026-11-11T10:00:00.000Z';
const at = seconds => new Date(Date.parse(SERVER_TIME) + seconds * 1000).toISOString();
const requirement = (id, state, extra = {}) => ({ id, viewKey: 'FRONT', instructionsSnapshot: 'Show basin, drain and tap.', mandatory: true, state, decisionVersion: 0, currentAttempt: state === 'MISSING' ? null : { id: `attempt-${id}`, state }, ...extra });
function reset({ states = ['PASSED', 'MISSING', 'MISSING'], submittedAt = null } = {}) {
  Object.assign(S, {
    manifest: {
      photoChecking: { available: true }, allowedActions: { createSession: true, renewSession: true, retakeSlots: true, upload: true },
      task: { id: 7, title: 'Morning clean', status: 'IN_PROGRESS', areaNameSnapshot: 'Ground floor washroom', location: { timezone: 'Asia/Karachi' } },
      staffSubmittedAt: submittedAt, sequentialChecks: true, pendingJobs: 0, sessions: [],
      items: [{ id: 'sink', nameSnapshot: 'Sink', typeSnapshot: 'SINK', mandatory: true, requirements: states.map((state, i) => requirement(`r${i}`, state)) }],
    },
    session: {
      id: 'session', taskInstanceId: 7, state: 'ACTIVE', serverTime: SERVER_TIME, clientBootId: 'boot', sequentialChecks: true,
      captureExpiresAt: at(900), uploadExpiresAt: at(1200), requiredContextKeys: [],
      slots: states.map((_, i) => ({ id: `slot${i}`, requirementId: `r${i}`, nonce: `n${i}`, sequence: i, generation: 0, activatedAt: SERVER_TIME, expiresAt: at(272) })),
    },
    uploads: 0, opens: 0, sessionError: null, clockFails: false, switchAccount: false, account: '7_2', failUpload: false, result: { state: 'PASSED' }, submissions: 0, activationHangs: false, manifestFails: false, manifestHangs: false,
    permission: { granted: true, canAskAgain: true }, feed: undefined,
  });
}
reset();

const api = {
  verificationManifest: async () => {
    if (S.manifestHangs) return new Promise(() => {});
    if (S.manifestFails) throw new Error('Task photos could not load.');
    return structuredClone(S.manifest);
  },
  openCaptureSession: async () => {
    S.opens += 1;
    if (S.sessionError) throw new Error(S.sessionError);
    if (S.switchAccount) S.account = '9_9';
    return structuredClone(S.session);
  },
  activatePhoto: async () => (S.activationHangs ? new Promise(() => {}) : structuredClone(S.session)),
  installationId: async () => 'device',
  findUploadedPhoto: async () => null,
  uploadPhoto: async metadata => {
    S.uploads += 1;
    if (S.failUpload) throw new Error('Network error');
    const target = S.manifest.items[0].requirements.find(r => r.id === metadata.requirementId);
    target.state = S.result.state;
    target.currentAttempt = { id: `attempt-${S.uploads}`, state: S.result.state, ...(S.result.instructions ? { instructions: S.result.instructions } : {}) };
    return { attemptId: target.currentAttempt.id, state: S.result.state };
  },
  finishSubmission: async () => { S.submissions += 1; S.manifest.staffSubmittedAt = SERVER_TIME; return {}; },
};

installMocks({
  // lucide and react-native-svg do not load under node: stand in plain elements.
  '/components/ui/icon': { Icon: props => React.createElement('Icon', props) },
  'react-native-svg': { __esModule: true, default: 'Svg', Svg: 'Svg', Path: 'Path', Rect: 'Rect', Circle: 'Circle' },
  'react-native-reanimated': { useAnimatedProps: factory => factory() },
  'react-native': { AppState: { currentState: 'active', addEventListener: (_name, cb) => { appListeners.add(cb); return { remove: () => appListeners.delete(cb) }; } } },
  // The default harness t() drops placeholder values; this screen fills {time}, {area} and {n}.
  '/i18n/LanguageProvider': {
    useLanguage: () => ({
      language: harness.language, isRTL: harness.language === 'ur', setLanguage: () => {},
      t: (text, values) => translate(text, harness.language, values),
    }),
  },
  'expo-camera': {
    CameraView: 'CameraView',
    useCameraPermissions: () => {
      const [status, setStatus] = React.useState(S.permission);
      const request = React.useCallback(async () => { setStatus({ ...S.permission }); return S.permission; }, []);
      const read = React.useCallback(async () => { setStatus({ ...S.permission }); return S.permission; }, []);
      return [status, request, read];
    },
  },
  'expo-file-system': { File: class { constructor(uri) { this.uri = uri; } exists = true; async bytes() { return new Uint8Array([1]); } delete() {} } },
  'expo-image-manipulator': { manipulateAsync: async () => ({ uri: 'resized.jpg' }), SaveFormat: { JPEG: 'jpeg' } },
  'expo-crypto': { randomUUID: () => 'capture', CryptoDigestAlgorithm: { SHA256: 'sha256' }, digest: async () => new Uint8Array(32) },
  '@react-native-community/netinfo': { __esModule: true, default: { addEventListener: cb => { netListeners.add(cb); return () => netListeners.delete(cb); } }, addEventListener: cb => { netListeners.add(cb); return () => netListeners.delete(cb); } },
  '@tanstack/react-query': { useQueryClient: () => ({ invalidateQueries: async () => {}, getQueryData: () => S.feed }) },
  '/modules/capture-quality': {
    captureClock: () => { if (S.clockFails) throw new Error('Photo verification requires the Hygene Ops native development or production build.'); return { bootId: 'boot', elapsedMs: 1000 }; }, inspectStill: async () => ({ width: 1800, height: 1200, luminance: 100, laplacianVariance: 30, clipping: 0 }) },
  '/verification/captureAccount': { captureAccount: () => S.account },
  '/verification/api': api,
});

const { NativeFontsReady } = await import('../../src/fonts.ts');
const { SnackbarProvider } = await import('../../src/design/Feedback.tsx');
const { VerificationScreen } = await import('../../src/screens/verification/VerificationScreen.tsx');

const h = React.createElement;
const plain = s => s.replace(/[⁨⁩]/g, '');
const text = r => plain(allText(r));
const flush = async fn => act(async () => { await fn?.(); for (let i = 0; i < 5; i += 1) await Promise.resolve(); });
let calls = [];
const navigation = {
  goBack: () => calls.push(['goBack']),
  navigate: (...args) => calls.push(['navigate', ...args]),
  popTo: (...args) => calls.push(['popTo', ...args]),
  setOptions: options => calls.push(['setOptions', options]),
};
let mounted = [];
async function mount() {
  let r;
  await flush(() => {
    r = create(h(NativeFontsReady.Provider, { value: true }, h(SnackbarProvider, null, h(VerificationScreen, { route: { params: { taskId: 7 } }, navigation }))),
      { createNodeMock: node => (node.type === 'CameraView' ? { takePictureAsync: async () => ({ uri: 'camera.jpg' }) } : null) });
  });
  mounted.push(r);
  return r;
}
const tap = async (r, label) => { const node = findPressable(r, label); assert.ok(node, `no button "${label}" in: ${text(r)}`); await flush(() => node.props.onPress()); };
const camera = r => r.root.findByType('CameraView');
async function openScanner(r, next = 'Next photo') { await tap(r, next); return camera(r).props.onBarcodeScanned; }

test.beforeEach(() => { reset(); calls = []; });
test.afterEach(async () => {
  for (const r of mounted) await act(async () => r.unmount());
  mounted = [];
  setLanguage('en');
});

const NATIVE = 'Photo verification requires the Hygene Ops native development or production build.';

test('a failed session open keeps the error, pauses scanning and only Scan again resumes it', async () => {
  S.sessionError = NATIVE;
  const r = await mount();
  const scan = await openScanner(r);
  await flush(() => scan({ data: 'room-qr' }));
  assert.equal(S.opens, 1);
  assert.ok(text(r).includes(NATIVE), text(r));
  assert.ok(findPressable(r, 'Scan again'), text(r));
  assert.equal(camera(r).props.onBarcodeScanned, undefined);
  assert.equal(camera(r).props.barcodeScannerSettings, undefined);
  // The QR is still in view: a late event from the old handler must not open a session again.
  await flush(() => scan({ data: 'room-qr' }));
  await flush(() => scan({ data: 'room-qr' }));
  assert.equal(S.opens, 1);
  assert.ok(text(r).includes(NATIVE), 'the error stays visible until the person acts');
  await tap(r, 'Scan again');
  assert.equal(text(r).includes(NATIVE), false);
  assert.equal(findPressable(r, 'Scan again'), undefined);
  assert.ok(text(r).includes('Hold the QR inside the frame. It scans by itself.'), text(r));
  S.sessionError = null;
  await flush(() => camera(r).props.onBarcodeScanned({ data: 'room-qr' }));
  assert.equal(S.opens, 2);
  assert.ok(findPressable(r, 'Take photo'), text(r));
});

test('a native clock failure after the scan also pauses scanning', async () => {
  S.clockFails = true;
  const r = await mount();
  const scan = await openScanner(r);
  await flush(() => scan({ data: 'room-qr' }));
  assert.equal(S.opens, 1);
  assert.ok(text(r).includes(NATIVE), text(r));
  assert.equal(camera(r).props.onBarcodeScanned, undefined);
  await flush(() => scan({ data: 'room-qr' }));
  assert.equal(S.opens, 1);
  assert.ok(findPressable(r, 'Scan again'));
});

test('a scan that stops without an error message still pauses and says so', async () => {
  S.switchAccount = true;
  const r = await mount();
  const scan = await openScanner(r);
  await flush(() => scan({ data: 'room-qr' }));
  await flush(() => scan({ data: 'room-qr' }));
  assert.equal(S.opens, 1);
  assert.ok(text(r).includes('The scan did not finish. Tap Scan again to try once more.'), text(r));
  assert.ok(findPressable(r, 'Scan again'));
});

test('closing the paused scanner and opening it again resumes scanning', async () => {
  S.sessionError = NATIVE;
  const r = await mount();
  const first = await openScanner(r);
  await flush(() => first({ data: 'room-qr' }));
  await tap(r, 'Back');
  S.sessionError = null;
  const scan = await openScanner(r);
  assert.equal(typeof scan, 'function');
  await flush(() => scan({ data: 'room-qr' }));
  assert.equal(S.opens, 2);
});

test('Urdu shows the paused scanner in Urdu', async () => {
  setLanguage('ur');
  S.switchAccount = true;
  const r = await mount();
  const scan = await openScanner(r, translate('Next photo', 'ur'));
  await flush(() => scan({ data: 'room-qr' }));
  const line = translate('The scan did not finish. Tap Scan again to try once more.', 'ur');
  assert.notEqual(line, 'The scan did not finish. Tap Scan again to try once more.');
  assert.ok(text(r).includes(line), text(r));
  assert.ok(findPressable(r, translate('Scan again', 'ur')), text(r));
});
