// Spec 56: 'Back to my day' on the Work submitted receipt must pop to the one StaffTabs on My day, never goBack
// (opened through Task details, goBack lands on the task just submitted). Mount and mocks are copied from photoCapture.test.mjs.
import assert from 'node:assert/strict';
import test from 'node:test';
import { installMocks, setLanguage, allText, findPressable, press } from '../support/nativeHarness.mjs';
import { readFileSync } from 'node:fs';

const React = (await import('react')).default;
const { create, act } = await import('react-test-renderer');
const { translate } = await import('../../src/i18n/translations.ts');
const harness = globalThis.__nativeHarness;

// Boundary state the mocks read: server manifest, capture session, network, camera permission, feed cache.
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
    uploads: 0, failUpload: false, result: { state: 'PASSED' }, submissions: 0, activationHangs: false, manifestFails: false, manifestHangs: false,
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
  openCaptureSession: async () => structuredClone(S.session),
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
  '/modules/capture-quality': { captureClock: () => ({ bootId: 'boot', elapsedMs: 1000 }), inspectStill: async () => ({ width: 1800, height: 1200, luminance: 100, laplacianVariance: 30, clipping: 0 }) },
  '/verification/captureAccount': { captureAccount: () => '7_2' },
  '/verification/api': api,
});

const { StyleSheet } = await import('react-native');
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
async function openCamera(r, next = 'Next photo') {
  await tap(r, next);
  await flush(() => r.root.findByType('CameraView').props.onBarcodeScanned({ data: 'room-qr' }));
  await flush(() => r.root.findByType('CameraView').props.onCameraReady());
}
async function shoot(r) { await openCamera(r); await tap(r, 'Take photo'); }

test.beforeEach(() => { reset(); calls = []; });
test.afterEach(async () => {
  for (const r of mounted) await act(async () => r.unmount());
  mounted = [];
  setLanguage('en');
});

test('finished with no other task: Back to my day pops to StaffTabs on My day, once, and never goes back', async () => {
  reset({ states: ['PASSED'], submittedAt: SERVER_TIME });
  S.feed = { pages: [{ tasks: [{ id: 7, status: 'COMPLETED' }] }] };
  const r = await mount();
  assert.ok(text(r).includes('Back to my day'), text(r));
  await press(findPressable(r, 'Back to my day'));
  assert.deepEqual(calls.filter(c => c[0] === 'popTo'), [['popTo', 'StaffTabs', { screen: 'Shift' }]]);
  assert.deepEqual(calls.at(-1), ['popTo', 'StaffTabs', { screen: 'Shift' }]);
  assert.equal(calls.some(c => c[0] === 'goBack' || c[0] === 'navigate' || c[0] === 'push'), false);
});

test('the SubmissionReceipt in VerificationScreen is never given goBack', () => {
  const source = readFileSync(new URL('../../src/screens/verification/VerificationScreen.tsx', import.meta.url), 'utf8');
  const receipt = source.slice(source.indexOf('<SubmissionReceipt'), source.indexOf('/>', source.indexOf('<SubmissionReceipt')));
  assert.match(receipt, /onDone=\{\(\)=>navigation\.popTo\(stackRoutes\.staffTabs,\{screen:tabRoutes\.myDay\}\)\}/);
  assert.doesNotMatch(receipt, /goBack/);
});
