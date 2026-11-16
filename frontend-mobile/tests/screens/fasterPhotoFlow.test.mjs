import assert from 'node:assert/strict';
import test from 'node:test';
import { installMocks, setLanguage, allText, findPressable, hapticsCalls, resetCalls } from '../support/nativeHarness.mjs';

const React = (await import('react')).default;
const { create, act } = await import('react-test-renderer');
const { translate } = await import('../../src/i18n/translations.ts');
const harness = globalThis.__nativeHarness;

// Spec 71: the camera stays open between photos, no manifest read around a normal upload,
// activation waits for the camera, and the quality check reads the resized picture.
// Boundary state the mocks read: server manifest, capture session, camera, network, native modules, account.
const S = {};
const appListeners = new Set();
const SERVER_TIME = '2026-11-11T10:00:00.000Z';
const at = seconds => new Date(Date.parse(SERVER_TIME) + seconds * 1000).toISOString();
const requirement = (id, state) => ({ id, viewKey: 'FRONT', instructionsSnapshot: 'Show basin, drain and tap.', mandatory: true, state, decisionVersion: 0, currentAttempt: state === 'MISSING' ? null : { id: `attempt-${id}`, state } });
function reset({ states = ['PASSED', 'MISSING', 'MISSING'], activated = true } = {}) {
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
      slots: states.map((_, i) => ({ id: `slot${i}`, requirementId: `r${i}`, nonce: `n${i}`, sequence: i, generation: 0, activatedAt: activated ? SERVER_TIME : null, expiresAt: at(272) })),
    },
    reads: 0, uploads: 0, activations: [], cameraMounts: 0, inspected: [], resizes: [], result: { state: 'PASSED' }, failUpload: null,
    photo: { uri: 'camera.jpg', width: 1536, height: 2048 }, sizes: ['4000x3000', '2048x1536', '1920x1440', '1920x1080', '1280x960'], sizeAsks: 0,
  });
}
reset();

const api = {
  verificationManifest: async () => { S.reads += 1; return structuredClone(S.manifest); },
  openCaptureSession: async () => structuredClone(S.session),
  activatePhoto: async (_sessionId, slotId) => {
    S.activations.push(slotId);
    const slot = S.session.slots.find(s => s.id === slotId);
    slot.activatedAt ??= SERVER_TIME;
    return structuredClone(S.session);
  },
  installationId: async () => 'device',
  findUploadedPhoto: async () => null,
  uploadPhoto: async (metadata, uri) => {
    S.uploads += 1; S.uploadedUri = uri;
    if (S.failUpload) {
      const error = new Error(S.failUpload.message);
      if (S.failUpload.status) error.response = { status: S.failUpload.status };
      if (S.failUpload.closeUploads) S.manifest.allowedActions = { ...S.manifest.allowedActions, upload: false };
      throw error;
    }
    const target = S.manifest.items[0].requirements.find(r => r.id === metadata.requirementId);
    target.state = S.result.state;
    target.currentAttempt = { id: `attempt-${S.uploads}`, state: S.result.state };
    S.session.slots.find(s => s.id === metadata.slotId).attemptId = target.currentAttempt.id;
    return { attemptId: target.currentAttempt.id, assetId: null, state: S.result.state, reasonCode: null, instructions: null };
  },
  finishSubmission: async () => ({}),
};

installMocks({
  '/components/ui/icon': { Icon: props => React.createElement('Icon', props) },
  'react-native-svg': { __esModule: true, default: 'Svg', Svg: 'Svg', Path: 'Path', Rect: 'Rect', Circle: 'Circle' },
  'react-native-reanimated': { useAnimatedProps: factory => factory() },
  'react-native': { AppState: { currentState: 'active', addEventListener: (_name, cb) => { appListeners.add(cb); return { remove: () => appListeners.delete(cb) }; } } },
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
  'expo-image-manipulator': { manipulateAsync: async (uri, actions, options) => { S.resizes.push({ uri, actions, options }); return { uri: 'resized.jpg' }; }, SaveFormat: { JPEG: 'jpeg' } },
  'expo-crypto': { randomUUID: () => 'capture', CryptoDigestAlgorithm: { SHA256: 'sha256' }, digest: async () => new Uint8Array(32) },
  '@react-native-community/netinfo': { __esModule: true, default: { addEventListener: () => () => {} }, addEventListener: () => () => {} },
  '@tanstack/react-query': { useQueryClient: () => ({ invalidateQueries: async () => {}, getQueryData: () => undefined }) },
  '/modules/capture-quality': {
    captureClock: () => ({ bootId: 'boot', elapsedMs: 1000 }),
    inspectStill: async uri => { S.inspected.push(uri); return { width: 1350, height: 1800, luminance: 100, laplacianVariance: 30, clipping: 0 }; },
  },
  '/verification/captureAccount': { captureAccount: () => '7_2' },
  '/verification/api': api,
});

const { NativeFontsReady } = await import('../../src/fonts.ts');
const { SnackbarProvider } = await import('../../src/design/Feedback.tsx');
const { VerificationScreen, photoPictureSize } = await import('../../src/screens/verification/VerificationScreen.tsx');

const h = React.createElement;
const text = r => allText(r).replace(/[⁨⁩]/g, '');
const flush = async fn => act(async () => { await fn?.(); for (let i = 0; i < 5; i += 1) await Promise.resolve(); });
const navigation = { goBack() {}, navigate() {}, popTo() {}, setOptions() {} };
let mounted = [];
async function mount() {
  let r;
  await flush(() => {
    r = create(h(NativeFontsReady.Provider, { value: true }, h(SnackbarProvider, null, h(VerificationScreen, { route: { params: { taskId: 7 } }, navigation }))), {
      createNodeMock: node => {
        if (node.type !== 'CameraView') return null;
        S.cameraMounts += 1;
        return { takePictureAsync: async () => ({ ...S.photo }), getAvailablePictureSizesAsync: async () => { S.sizeAsks += 1; return S.sizes; } };
      },
    });
  });
  mounted.push(r);
  return r;
}
const tap = async (r, label) => { const node = findPressable(r, label); assert.ok(node, `no button "${label}" in: ${text(r)}`); await flush(() => node.props.onPress()); };
const camera = r => r.root.findByType('CameraView');
async function openCamera(r, next = 'Next photo') {
  await tap(r, next);
  await flush(() => camera(r).props.onBarcodeScanned({ data: 'room-qr' }));
  await flush(() => camera(r).props.onCameraReady());
}
const shutter = r => findPressable(r, 'Take photo');

test.beforeEach(() => { reset(); resetCalls(); });
test.afterEach(async () => {
  for (const r of mounted) await act(async () => r.unmount());
  mounted = [];
  setLanguage('en');
});

test('photoPictureSize picks the smallest 4:3 size of at least 1800 px and about 3 MP, else null', () => {
  assert.equal(photoPictureSize(['4000x3000', '2048x1536', '1920x1440', '1920x1080', '1280x960']), '1920x1440');
  assert.equal(photoPictureSize(['1536x2048', '4000x3000']), '1536x2048');
  assert.equal(photoPictureSize(['4000x3000', '1920x1080', '1280x960']), null, 'nothing fits: keep the full-size picture');
  assert.equal(photoPictureSize(['High', 'Photo']), null);
  assert.equal(photoPictureSize(undefined), null);
});

test('the Android scanner asks the sizes once and the task camera, not the scanner, gets the chosen size', async () => {
  const r = await mount();
  await tap(r, 'Next photo');
  assert.equal(camera(r).props.pictureSize, undefined, 'the scanner keeps its default size');
  await flush(() => camera(r).props.onCameraReady());
  await flush(() => camera(r).props.onBarcodeScanned({ data: 'room-qr' }));
  assert.equal(camera(r).props.pictureSize, '1920x1440');
  await flush(() => camera(r).props.onCameraReady());
  assert.equal(S.sizeAsks, 1);
});

test('an accepted photo keeps the camera mounted, confirms it and makes the next photo ready without a tap or a manifest read', async () => {
  reset({ states: ['PASSED', 'MISSING', 'MISSING'], activated: false });
  S.session.slots[1].activatedAt = SERVER_TIME;
  const r = await mount();
  await openCamera(r);
  const mounts = S.cameraMounts, reads = S.reads;
  await tap(r, 'Take photo');
  assert.equal(S.uploads, 1);
  assert.equal(S.reads, reads, 'no manifest read before or after the upload');
  assert.equal(S.cameraMounts, mounts, 'the camera was not remounted');
  assert.ok(camera(r));
  assert.equal(r.root.findAllByType('Modal').length, 0);
  const t = text(r);
  assert.ok(t.includes('Sink photo done'), t);
  assert.equal(t.includes('Task photos'), false, 'no list screen');
  assert.ok(hapticsCalls().some(c => c.name === 'notificationAsync' && c.args[0] === 'success'));
  assert.deepEqual(S.activations, ['slot2'], 'the next item is activated with no tap');
  assert.equal(r.root.findAll(n => n.props.testID === 'photo-segment-done').length, 2);
  assert.equal(shutter(r).props.disabled, false, 'the next photo can be taken');
  await tap(r, 'Take photo');
  assert.equal(S.uploads, 2, 'the second photo is the next item');
});

test('a waiting-for-review photo also stays on the camera with no sheet', async () => {
  S.result = { state: 'REVIEW_REQUIRED' };
  const r = await mount();
  await openCamera(r);
  const reads = S.reads;
  await tap(r, 'Take photo');
  assert.equal(S.reads, reads);
  assert.ok(camera(r));
  assert.equal(r.root.findAllByType('Modal').length, 0);
  assert.ok(text(r).includes('Sink photo done'));
});

for (const [state, title] of [['RECAPTURE_REQUIRED', 'Take this photo again'], ['CLEANING_REQUIRED', 'This still needs cleaning'], ['SERVICE_FAILURE', 'Photo check could not finish']]) {
  test(`${state} still reads the manifest and goes to the list and its sheet`, async () => {
    S.result = { state };
    const r = await mount();
    await openCamera(r);
    const reads = S.reads;
    await tap(r, 'Take photo');
    assert.equal(S.reads, reads + 1, 'the list is read fresh');
    assert.equal(r.root.findAllByType('CameraView').length, 0);
    assert.ok(text(r).includes(title), text(r));
    assert.equal(text(r).includes('Sink photo done'), false);
  });
}

test('the last photo still goes to the list with "Photo uploaded"', async () => {
  reset({ states: ['PASSED', 'PASSED', 'MISSING'] });
  const r = await mount();
  await openCamera(r);
  await tap(r, 'Take photo');
  assert.equal(r.root.findAllByType('CameraView').length, 0);
  assert.ok(text(r).includes('Photo uploaded'));
  assert.ok(findPressable(r, 'Submit work'));
});

test('a failed upload still shows the saved-photo page', async () => {
  S.failUpload = { message: 'Network error' };
  const r = await mount();
  await openCamera(r);
  const reads = S.reads;
  await tap(r, 'Take photo');
  assert.equal(S.reads, reads, 'no manifest read for a network failure');
  assert.equal(r.root.findAllByType('CameraView').length, 0);
  assert.ok(text(r).includes('This photo is saved on your phone and has not uploaded yet.'), text(r));
  assert.ok(text(r).includes('Photo did not upload'));
});

test('a server refusal re-reads authority and says when uploads are closed; otherwise it keeps the server message', async () => {
  S.failUpload = { status: 409, message: 'Upload window closed', closeUploads: true };
  let r = await mount();
  await openCamera(r);
  await tap(r, 'Take photo');
  assert.ok(text(r).includes('Photo upload is unavailable. Check the result before retrying. Your received photos are kept.'), text(r));
  await act(async () => r.unmount()); mounted = [];
  reset();
  S.failUpload = { status: 409, message: 'Photo bytes do not match commitment' };
  r = await mount();
  await openCamera(r);
  await tap(r, 'Take photo');
  assert.ok(text(r).includes('Photo bytes do not match commitment'), text(r));
});

test('slot activation waits for the camera to be ready', async () => {
  reset({ activated: false });
  const r = await mount();
  await tap(r, 'Next photo');
  await flush(() => camera(r).props.onBarcodeScanned({ data: 'room-qr' }));
  assert.ok(shutter(r));
  assert.deepEqual(S.activations, [], 'no activation while the camera starts');
  await flush(() => camera(r).props.onCameraReady());
  assert.deepEqual(S.activations, ['slot1']);
});

test('the quality check reads the resized picture; the upload keeps 1800 px and JPEG 0.85', async () => {
  const r = await mount();
  await openCamera(r);
  await tap(r, 'Take photo');
  assert.deepEqual(S.resizes, [{ uri: 'camera.jpg', actions: [{ resize: { height: 1800 } }], options: { compress: 0.85, format: 'jpeg' } }]);
  assert.deepEqual(S.inspected, ['resized.jpg']);
  assert.equal(S.uploadedUri, 'resized.jpg');
});

test('a landscape picture resizes by width, and a small picture is still refused by its own size', async () => {
  S.photo = { uri: 'camera.jpg', width: 2048, height: 1536 };
  let r = await mount();
  await openCamera(r);
  await tap(r, 'Take photo');
  assert.deepEqual(S.resizes[0].actions, [{ resize: { width: 1800 } }]);
  await act(async () => r.unmount()); mounted = [];
  reset();
  S.photo = { uri: 'camera.jpg', width: 640, height: 480 };
  r = await mount();
  await openCamera(r);
  await tap(r, 'Take photo');
  assert.equal(S.uploads, 0);
  assert.ok(text(r).includes('Photo is too small. Move closer and retake.'), text(r));
});

test('Urdu shows the confirmation in Urdu', async () => {
  setLanguage('ur');
  const r = await mount();
  await openCamera(r, translate('Next photo', 'ur'));
  await tap(r, translate('Take photo', 'ur'));
  const { translateText } = await import('../../src/i18n/translations.ts');
  const line = translate('{item} photo done', 'ur', { item: translateText('Sink', 'ur') });
  assert.notEqual(line, 'Sink photo done');
  assert.ok(text(r).includes(line.replace(/[⁨⁩]/g, '')), text(r));
});
