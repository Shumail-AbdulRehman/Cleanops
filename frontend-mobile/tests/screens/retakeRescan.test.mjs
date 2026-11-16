import assert from 'node:assert/strict';
import test from 'node:test';
import { allText, findPressable, installMocks, press } from '../support/nativeHarness.mjs';

const React = (await import('react')).default;
const { act, create } = await import('react-test-renderer');
const serverTime = Date.parse('2026-11-21T10:00:00.000Z');
const at = offset => new Date(serverTime + offset).toISOString();
const calls = [];
const uploads = [];
let requirements, manifestSessions, activeSessionId, clock, failAfterOpen, failRead, renderer;

const requirement = (id, state, decisionVersion) => ({
  id, state, decisionVersion, mandatory: true, viewKey: 'FRONT', instructionsSnapshot: 'Show the basin.',
  currentAttempt: state === 'MISSING' ? null : { id: `attempt-${id}`, state },
});

installMocks({
  '/components/ui/icon': { Icon: 'Icon' },
  'react-native-svg': { __esModule: true, default: 'Svg', Svg: 'Svg', Path: 'Path', Rect: 'Rect', Circle: 'Circle' },
  'react-native-reanimated': { useAnimatedProps: factory => factory() },
  'expo-camera': {
    useCameraPermissions: () => [{ granted: true }, readPermission, readPermission],
  },
  '@react-native-community/netinfo': { addEventListener: () => () => {} },
  'expo-file-system': { File: class { exists = true; async bytes() { return new Uint8Array([1]); } delete() {} } },
  'expo-image-manipulator': { manipulateAsync: async () => ({ uri: 'resized.jpg' }), SaveFormat: { JPEG: 'jpeg' } },
  'expo-crypto': { randomUUID: () => 'capture', CryptoDigestAlgorithm: { SHA256: 'sha256' }, digest: async () => new Uint8Array(32) },
  '/modules/capture-quality': {
    captureClock: () => ({ bootId: 'boot', elapsedMs: clock }),
    inspectStill: async () => ({ width: 1800, height: 1350, luminance: 100, laplacianVariance: 30, clipping: 0 }),
  },
  '/verification/captureAccount': { captureAccount: () => '7_2' },
  '/verification/api': {
    verificationManifest: async () => {
      if (failRead) {
        failRead = false;
        throw new Error('Task photos could not load.');
      }
      return structuredClone({
        photoChecking: { available: true }, allowedActions: { createSession: true, renewSession: true, upload: true },
        task: { id: 7, status: 'IN_PROGRESS', areaNameSnapshot: 'Washroom', location: { timezone: 'Asia/Karachi' } },
        items: [{ id: 'sink', nameSnapshot: 'Sink', typeSnapshot: 'SINK', mandatory: true, requirements }],
        sessions: manifestSessions,
      });
    },
    openCaptureSession: async (taskId, qr, previous, _progress, targets) => {
      calls.push({ taskId, qr, previous, targets });
      if (!targets && previous !== activeSessionId) throw new Error('SESSION_EXISTS');
      activeSessionId = `session-${calls.length}`;
      if (failAfterOpen) {
        failAfterOpen = false;
        failRead = true;
        manifestSessions = [];
      } else {
        manifestSessions = [{ id: activeSessionId, state: 'ACTIVE', slots: [] }];
      }
      const target = requirements.find(r => r.id === (targets?.[0].requirementId ?? 'front'));
      target.state = 'MISSING';
      target.decisionVersion += 1;
      target.instructionsSnapshot = `Show the basin from ${activeSessionId}.`;
      return {
        id: activeSessionId, state: 'ACTIVE', serverTime: at(clock), captureExpiresAt: at(clock + 1000),
        slots: [{ id: `slot-${activeSessionId}`, requirementId: target.id, nonce: 'slot-nonce', sequence: 0, generation: target.decisionVersion }],
      };
    },
    installationId: async () => 'device',
    uploadPhoto: async metadata => {
      uploads.push(metadata);
      requirements.find(r => r.id === metadata.requirementId).state = 'PASSED';
      return { attemptId: 'new-attempt', state: 'PASSED' };
    },
  },
});

async function readPermission() { return { granted: true }; }

const { NativeFontsReady } = await import('../../src/fonts.ts');
const { SnackbarProvider } = await import('../../src/design/Feedback.tsx');
const { VerificationScreen } = await import('../../src/screens/verification/VerificationScreen.tsx');

async function mount() {
  const camera = { takePictureAsync: async () => ({ uri: 'camera.jpg', width: 1800, height: 1350 }) };
  const screen = React.createElement(VerificationScreen, { route: { params: { taskId: 7 } }, navigation: { setOptions() {} } });
  await act(async () => {
    renderer = create(React.createElement(NativeFontsReady.Provider, { value: true },
      React.createElement(SnackbarProvider, null, screen)), { createNodeMock: node => node.type === 'CameraView' ? camera : null });
  });
}

const camera = () => renderer.root.findByType('CameraView');
async function tap(label) {
  const button = findPressable(renderer, label);
  assert.ok(button, `Missing ${label} in ${allText(renderer)}`);
  await press(button);
}

async function scan() {
  const handler = camera().props.onBarcodeScanned;
  assert.equal(typeof handler, 'function');
  await act(async () => handler({ data: 'room-qr' }));
}

async function rescanExpiredWindow() {
  clock += 1001;
  await tap('Close');
  await tap('Next photo');
  await scan();
}

test.beforeEach(() => {
  requirements = [requirement('front', 'RECAPTURE_REQUIRED', 2)];
  activeSessionId = 'previous';
  manifestSessions = [{ id: activeSessionId, state: 'ACTIVE', slots: [] }];
  clock = 0;
  failAfterOpen = false;
  failRead = false;
  calls.length = 0;
  uploads.length = 0;
});

test.afterEach(async () => { await act(async () => renderer?.unmount()); });

test('a retake and two rescans before upload use the newest manifest and session', async () => {
  await mount();
  await tap('Retake photo');
  activeSessionId = 'fresh-manifest-session';
  manifestSessions = [{ id: 'previous', state: 'EXPIRED', slots: [] }, { id: activeSessionId, state: 'PAUSED', slots: [] }];
  await scan();
  await rescanExpiredWindow();
  await rescanExpiredWindow();
  assert.deepEqual(calls, ['fresh-manifest-session', 'session-1', 'session-2'].map(previous => ({
    taskId: 7, qr: 'room-qr', previous, targets: undefined,
  })));
  assert.match(allText(renderer), /Show the basin from session-3\./);
  assert.equal(uploads.length, 0);
  await act(async () => camera().props.onCameraReady());
  await tap('Take photo');
  assert.equal(uploads.length, 1);
  assert.equal(uploads[0].sessionId, 'session-3');
  assert.equal(uploads[0].slotId, 'slot-session-3');
});

test('a failed results read after renewal keeps the new session id for the retry', async () => {
  await mount();
  await tap('Retake photo');
  await scan();
  failAfterOpen = true;
  await rescanExpiredWindow();
  assert.match(allText(renderer), /Task photos could not load\./);
  assert.equal(camera().props.onBarcodeScanned, undefined);
  await tap('Scan again');
  await scan();
  assert.deepEqual(calls.map(call => call.previous), ['previous', 'session-1', 'session-2']);
  assert.match(allText(renderer), /Show the basin from session-3\./);
});

test('cleaning rework targets only dirty requirements at their fresh generation', async () => {
  requirements.push(requirement('dirty', 'CLEANING_REQUIRED', 3));
  await mount();
  await tap('Clean, then scan QR');
  requirements[1].decisionVersion = 4;
  await scan();
  assert.deepEqual(calls.map(call => call.targets), [[{ requirementId: 'dirty', expectedGeneration: 4 }]]);
});
