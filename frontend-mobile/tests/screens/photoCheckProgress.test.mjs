import assert from 'node:assert/strict';
import test from 'node:test';
import { installMocks, setLanguage, allText, findPressable, hapticsCalls, resetCalls } from '../support/nativeHarness.mjs';

const React = (await import('react')).default;
const { create, act } = await import('react-test-renderer');
const { translate } = await import('../../src/i18n/translations.ts');
const harness = globalThis.__nativeHarness;

// Spec 72: the photo-check card after the shutter. Each stage follows a real promise the test holds open:
// the on-phone check (`inspectStill`), the bytes sent (`uploadPhoto`'s progress callback), the server's answer.
// Same boundary mocks as fasterPhotoFlow.test.mjs (spec 71).
const S = {};
const SERVER_TIME = '2026-11-11T10:00:00.000Z';
const at = seconds => new Date(Date.parse(SERVER_TIME) + seconds * 1000).toISOString();
const requirement = (id, state) => ({ id, viewKey: 'FRONT', instructionsSnapshot: 'Show basin, drain and tap.', mandatory: true, state, decisionVersion: 0, currentAttempt: state === 'MISSING' ? null : { id: `attempt-${id}`, state } });
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
function reset(states = ['PASSED', 'MISSING', 'MISSING']) {
  Object.assign(S, {
    manifest: {
      photoChecking: { available: true }, allowedActions: { createSession: true, renewSession: true, retakeSlots: true, upload: true },
      task: { id: 7, title: 'Morning clean', status: 'IN_PROGRESS', areaNameSnapshot: 'Ground floor washroom', location: { timezone: 'Asia/Karachi' } },
      staffSubmittedAt: null, sequentialChecks: true, pendingJobs: 0, sessions: [],
      items: [{ id: 'sink', nameSnapshot: 'Sink', typeSnapshot: 'SINK', mandatory: true, requirements: states.map((state, i) => requirement(`r${i}`, state)) }],
    },
    session: {
      id: 'session', taskInstanceId: 7, state: 'ACTIVE', serverTime: SERVER_TIME, clientBootId: 'boot', sequentialChecks: true,
      captureExpiresAt: at(900), uploadExpiresAt: at(1200), requiredContextKeys: [],
      slots: states.map((_, i) => ({ id: `slot${i}`, requirementId: `r${i}`, nonce: `n${i}`, sequence: i, generation: 0, activatedAt: SERVER_TIME, expiresAt: at(272) })),
    },
    result: { state: 'PASSED' }, reduced: false, failOnce: false, inspect: null, upload: null, read: null, progress: null, reads: 0,
  });
}
reset();

const api = {
  verificationManifest: async () => { S.reads += 1; if (S.read) await S.read.promise; return structuredClone(S.manifest); },
  openCaptureSession: async () => structuredClone(S.session),
  activatePhoto: async () => structuredClone(S.session),
  installationId: async () => 'device',
  findUploadedPhoto: async () => null,
  uploadPhoto: async (metadata, _uri, _scope, onProgress) => {
    S.progress = onProgress;
    if (S.failOnce) { S.failOnce = false; throw new Error('Network error'); }
    if (S.upload) await S.upload.promise;
    const target = S.manifest.items[0].requirements.find(r => r.id === metadata.requirementId);
    target.state = S.result.state;
    target.currentAttempt = { id: 'attempt-new', state: S.result.state };
    return { attemptId: 'attempt-new', assetId: null, state: S.result.state, reasonCode: null, instructions: null };
  },
  finishSubmission: async () => ({}),
};

installMocks({
  '/components/ui/icon': { Icon: props => React.createElement('Icon', props) },
  'react-native-svg': { __esModule: true, default: 'Svg', Svg: 'Svg', Path: 'Path', Rect: 'Rect', Circle: 'Circle' },
  'react-native-reanimated': { useAnimatedProps: factory => factory(), useReducedMotion: () => S.reduced },
  'react-native': { AppState: { currentState: 'active', addEventListener: () => ({ remove: () => {} }) } },
  '/i18n/LanguageProvider': {
    useLanguage: () => ({
      language: harness.language, isRTL: harness.language === 'ur', setLanguage: () => {},
      t: (text, values) => translate(text, harness.language, values),
    }),
  },
  'expo-camera': {
    CameraView: 'CameraView',
    useCameraPermissions: () => [{ granted: true, canAskAgain: true }, async () => ({ granted: true, canAskAgain: true }), async () => ({ granted: true, canAskAgain: true })],
  },
  'expo-file-system': { File: class { constructor(uri) { this.uri = uri; } exists = true; async bytes() { return new Uint8Array([1]); } delete() {} } },
  'expo-image-manipulator': { manipulateAsync: async () => ({ uri: 'resized.jpg' }), SaveFormat: { JPEG: 'jpeg' } },
  'expo-crypto': { randomUUID: () => 'capture', CryptoDigestAlgorithm: { SHA256: 'sha256' }, digest: async () => new Uint8Array(32) },
  '@react-native-community/netinfo': { __esModule: true, default: { addEventListener: () => () => {} }, addEventListener: () => () => {} },
  '@tanstack/react-query': { useQueryClient: () => ({ invalidateQueries: async () => {}, getQueryData: () => undefined }) },
  '/modules/capture-quality': {
    captureClock: () => ({ bootId: 'boot', elapsedMs: 1000 }),
    inspectStill: async () => { if (S.inspect) await S.inspect.promise; return { width: 1350, height: 1800, luminance: 100, laplacianVariance: 30, clipping: 0 }; },
  },
  '/verification/captureAccount': { captureAccount: () => '7_2' },
  '/verification/api': api,
});

const { NativeFontsReady } = await import('../../src/fonts.ts');
const { SnackbarProvider } = await import('../../src/design/Feedback.tsx');
const { VerificationScreen } = await import('../../src/screens/verification/VerificationScreen.tsx');
const { checkPercent, checkOutcome, checkAt, withUploadProgress } = await import('../../src/verification/photoCheck.ts');

const h = React.createElement;
const plain = value => String(value ?? '').replace(/[⁨⁩]/g, '');
const text = r => plain(allText(r));
const flush = async fn => act(async () => { await fn?.(); for (let i = 0; i < 6; i += 1) await Promise.resolve(); });
const navigation = { goBack() {}, navigate() {}, popTo() {}, setOptions() {} };
let mounted = [];
async function mount() {
  let r;
  await flush(() => {
    r = create(h(NativeFontsReady.Provider, { value: true }, h(SnackbarProvider, null, h(VerificationScreen, { route: { params: { taskId: 7 } }, navigation }))), {
      createNodeMock: node => node.type === 'CameraView' ? { takePictureAsync: async () => ({ uri: 'camera.jpg', width: 1536, height: 2048 }), getAvailablePictureSizesAsync: async () => [] } : null,
    });
  });
  mounted.push(r);
  return r;
}
const camera = r => r.root.findByType('CameraView');
async function openCamera(r) {
  await flush(() => findPressable(r, translate('Next photo', harness.language)).props.onPress());
  await flush(() => camera(r).props.onBarcodeScanned({ data: 'room-qr' }));
  await flush(() => camera(r).props.onCameraReady());
}
/** Presses the shutter without waiting for the photo's work, which the test releases step by step. */
const shoot = r => flush(() => findPressable(r, translate('Take photo', harness.language)).props.onPress());
const byId = (r, id) => r.root.findAll(n => n.props.testID === id && typeof n.type === 'function');
const has = (r, id) => r.root.findAll(n => n.props.testID === id).length > 0;
const percent = r => { const node = byId(r, 'photo-check-percent')[0]; return node ? Number(plain(node.props.children).replace('%', '')) : null; };
const glyph = r => r.root.findAll(n => typeof n.props.testID === 'string' && n.props.testID.startsWith('photo-check-glyph-'))[0]?.props.testID.replace('photo-check-glyph-', '');
const liveLines = r => r.root.findAll(n => typeof n.type === 'function' && n.props.accessibilityLiveRegion === 'polite').map(n => plain(n.props.children));

test.beforeEach(() => { reset(); resetCalls(); });
test.afterEach(async () => {
  for (const r of mounted) await act(async () => r.unmount());
  mounted = [];
  setLanguage('en');
});

test('percent bands: quality under 15, upload 15 to 60 from the bytes, AI 60 to 94 at most, endings 100', () => {
  const at0 = { since: 0, fraction: 0 };
  assert.equal(checkPercent({ ...at0, stage: 'quality' }, 0), 0);
  assert.equal(checkPercent({ ...at0, stage: 'quality' }, 600_000), 14);
  assert.deepEqual([0, 0.25, 0.5, 0.999, 1].map(fraction => checkPercent({ since: 0, fraction, stage: 'upload' }, 0)), [15, 26, 37, 59, 60]);
  assert.equal(checkPercent({ ...at0, stage: 'ai' }, 0), 60);
  const ai = [1000, 5000, 20_000, 3_600_000].map(now => checkPercent({ ...at0, stage: 'ai' }, now));
  assert.deepEqual([...ai].sort((a, b) => a - b), ai, 'grows with time');
  assert.ok(ai.every(p => p > 60 && p <= 94), String(ai));
  for (const stage of ['received', 'retake', 'clean', 'failed']) assert.equal(checkPercent({ ...at0, stage }, 0), 100);
  assert.deepEqual(['PASSED', 'REVIEW_REQUIRED', 'PRIVACY_HOLD', 'RECAPTURE_REQUIRED', 'CLEANING_REQUIRED', 'SERVICE_FAILURE'].map(checkOutcome),
    ['received', 'received', 'received', 'retake', 'clean', 'failed']);
});

test('stages only move forward; all bytes sent starts the AI stage; small byte steps do not redraw', () => {
  const quality = { id: 1, stage: 'quality', since: 0, fraction: 0 };
  const upload = checkAt(quality, 'upload', 10);
  assert.equal(upload.stage, 'upload');
  assert.equal(checkAt(upload, 'quality', 20), upload, 'never back to quality');
  assert.equal(withUploadProgress(quality, 0.5, 20), quality, 'bytes only move the upload stage');
  const half = withUploadProgress(upload, 0.5, 20);
  assert.equal(half.fraction, 0.5);
  assert.equal(withUploadProgress(half, 0.505, 21), half, 'same shown percent: same object');
  const ai = withUploadProgress(half, 1, 30);
  assert.deepEqual([ai.stage, ai.since], ['ai', 30]);
  assert.equal(checkAt(ai, 'upload', 40), ai, 'a re-sent request cannot go back to uploading');
  assert.equal(checkAt(ai, 'received', 50).stage, 'received');
  assert.equal(checkAt(null, 'upload', 0), null);
});

test('the card follows the real work in order: quality, upload with real bytes, AI, then the done card', async () => {
  S.inspect = deferred(); S.upload = deferred();
  const r = await mount();
  await openCamera(r);
  await shoot(r);
  assert.ok(text(r).includes('Checking photo quality'), text(r));
  assert.equal(glyph(r), 'quality');
  assert.ok(percent(r) < 15);
  assert.equal(has(r, 'photo-check-sweep'), true, 'the scan line sweeps while the phone checks');

  await flush(() => S.inspect.resolve());
  assert.ok(text(r).includes('Uploading photo'), text(r));
  assert.equal(percent(r), 15);
  assert.equal(has(r, 'photo-check-sweep'), false);
  await flush(() => S.progress(0.5));
  assert.equal(percent(r), 37, 'half the bytes sent');
  await flush(() => S.progress(0.25));
  assert.equal(percent(r), 37, 'never goes back');

  await flush(() => S.progress(1));
  assert.ok(text(r).includes('Checking with AI'), text(r));
  assert.equal(glyph(r), 'ai');
  assert.ok(percent(r) >= 60 && percent(r) < 95);
  const bar = r.root.findAll(n => n.props.testID === 'photo-check-bar')[0];
  assert.equal(bar.props.accessibilityRole, 'progressbar');
  assert.ok(bar.props.accessibilityValue.now < 100);

  await flush(() => S.upload.resolve());
  assert.ok(text(r).includes('Sink photo done'), text(r));
  assert.equal(has(r, 'photo-done'), true);
  assert.equal(glyph(r), 'received', 'green tick');
  assert.equal(percent(r), 100);
  assert.ok(hapticsCalls().some(c => c.name === 'notificationAsync' && c.args[0] === 'success'));
  assert.ok(camera(r), 'spec 71: the camera stays open');
});

test('the percentage never reaches 100 before the answer, however long the AI takes', async () => {
  S.upload = deferred();
  const realNow = Date.now;
  let offset = 0;
  Date.now = () => realNow() + offset;
  try {
    const r = await mount();
    await openCamera(r);
    await shoot(r);
    await flush(() => S.progress(1));
    assert.ok(text(r).includes('Checking with AI'));
    offset = 10 * 60_000;
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 320)); });
    assert.equal(percent(r), 94);
    await flush(() => S.upload.resolve());
    assert.equal(percent(r), 100);
  } finally { Date.now = realNow; }
});

test('a fast step is skipped, not waited for: no bytes reported still ends at the answer', async () => {
  const r = await mount();
  await openCamera(r);
  await shoot(r);
  assert.equal(typeof S.progress, 'function', 'a new photo asks for progress');
  assert.ok(text(r).includes('Sink photo done'), text(r));
  assert.equal(has(r, 'photo-check'), false, 'the check card is gone once the work is done');
});

test('a retake answer shows the amber ending at 100%, then the existing list and sheet', async () => {
  S.result = { state: 'RECAPTURE_REQUIRED' };
  const r = await mount();
  await openCamera(r);
  S.read = deferred();
  await shoot(r);
  assert.ok(text(r).includes('Take this photo again'), text(r));
  assert.equal(glyph(r), 'retake');
  assert.equal(percent(r), 100);
  assert.ok(camera(r), 'the ending plays while the list is read, not after');
  await flush(() => S.read.resolve());
  assert.equal(r.root.findAllByType('CameraView').length, 0);
  assert.ok(text(r).includes('Retake photo'), text(r));
  assert.equal(has(r, 'photo-check'), false);
});

test('Upload again from the saved-photo page shows no check card and asks for no progress', async () => {
  S.failOnce = true;
  const r = await mount();
  await openCamera(r);
  await shoot(r);
  assert.ok(text(r).includes('This photo is saved on your phone and has not uploaded yet.'), text(r));
  S.progress = 'unset';
  await flush(() => r.root.findAll(n => n.props.label === 'Upload again' && typeof n.props.onPress === 'function')[0].props.onPress());
  assert.equal(S.progress, undefined);
  assert.equal(has(r, 'photo-check'), false);
});

test('reduced motion: no sweep; the stages and the percentage still show', async () => {
  S.reduced = true; S.inspect = deferred(); S.upload = deferred();
  const r = await mount();
  await openCamera(r);
  await shoot(r);
  assert.ok(text(r).includes('Checking photo quality'));
  assert.equal(has(r, 'photo-check-sweep'), false);
  await flush(() => S.inspect.resolve());
  await flush(() => S.progress(1));
  assert.ok(text(r).includes('Checking with AI'));
  assert.ok(percent(r) >= 60);
  await flush(() => S.upload.resolve());
  assert.ok(text(r).includes('Sink photo done'));
});

test('one polite announcement per stage: the stage line is the live region, the percentage is hidden', async () => {
  S.upload = deferred();
  const r = await mount();
  await openCamera(r);
  await shoot(r);
  await flush(() => S.progress(0.5));
  assert.ok(liveLines(r).includes('Uploading photo'), String(liveLines(r)));
  assert.equal(liveLines(r).some(line => /%/.test(line)), false);
  const hidden = r.root.findAll(n => n.props.accessibilityElementsHidden === true && n.findAll(c => c.props.testID === 'photo-check-percent').length > 0);
  assert.ok(hidden.length > 0, 'the percentage is not read out on every change');
  await flush(() => S.upload.resolve());
});

test('Urdu labels for every stage', async () => {
  setLanguage('ur');
  for (const key of ['Checking photo quality', 'Uploading photo', 'Checking with AI', 'Photo uploaded', 'Take this photo again', 'This still needs cleaning', 'Photo check could not finish']) {
    assert.notEqual(translate(key, 'ur'), key, key);
  }
  S.inspect = deferred(); S.upload = deferred();
  const r = await mount();
  await openCamera(r);
  await shoot(r);
  assert.ok(text(r).includes(translate('Checking photo quality', 'ur')), text(r));
  await flush(() => S.inspect.resolve());
  assert.ok(text(r).includes(translate('Uploading photo', 'ur')));
  await flush(() => S.progress(1));
  assert.ok(text(r).includes(translate('Checking with AI', 'ur')));
  await flush(() => S.upload.resolve());
});
