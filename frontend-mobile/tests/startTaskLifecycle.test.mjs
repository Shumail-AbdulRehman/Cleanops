import assert from 'node:assert/strict';
import test from 'node:test';
import { installMocks, render, allText, findPressable } from './support/nativeHarness.mjs';

const React = (await import('react')).default;
const { act } = await import('react-test-renderer');

// Moved onto the shared harness when spec 34 restyled the screen (ActionButton, BottomSheet); same steps and assertions.
const listeners = new Set();
const calls = [], navigation = [];
let resolveStart, rejectStart;
const task = { id: 7, title: 'Morning clean', areaNameSnapshot: 'East washroom',
  status: 'PENDING', verificationVersion: 2, shiftStart: new Date().toISOString(),
  shiftEnd: new Date(Date.now() + 3600000).toISOString(), location: { timezone: 'UTC' } };
const cache = { setQueryData() {} };
installMocks({
  '/ui/icon': { Icon: props => React.createElement('Icon', props) },
  '@react-native-community/netinfo': { default: { addEventListener: () => () => {}, fetch: async () => ({ isConnected: true }) } },
  'react-native': { AppState: { currentState: 'active', addEventListener: (_name, listener) => {
    listeners.add(listener); return { remove: () => listeners.delete(listener) };
  } }, Platform: { OS: 'android', select: map => map.android ?? map.default }, Linking: { openSettings: async () => {} } },
  'expo-camera': { CameraView: 'CameraView', useCameraPermissions: () => [{ granted: true }, async () => ({ granted: true })] },
  '@tanstack/react-query': { useQuery: () => ({ data: task }), useQueryClient: () => cache },
  '/api/client': { client: { get: async () => { throw new Error('Unexpected network call'); } } },
  '/api/startCleaning': { startCleaning: async (_cache, _key, taskId, areaQr) => {
    calls.push({ taskId, areaQr });
    return new Promise((resolve, reject) => { resolveStart = resolve; rejectStart = reject; });
  } },
  '/queries/staff': { staffQueryKeys: { tasksToday: id => ['staff', id, 'today'] } },
});
const flush = async work => act(async () => { await work?.(); await Promise.resolve(); });
const cameraDelay = () => flush(() => new Promise(resolve => setTimeout(resolve, 400)));
const click = (renderer, label) => flush(() => findPressable(renderer, label).props.onPress());

test('start scanner rejects duplicate/background callbacks, retries wrong QR, and keeps cleaning separate from finish', async () => {
  let renderer;
  try {
    const { StartTaskScreen } = await import('../src/screens/StartTaskScreen.tsx');
    renderer = await render(React.createElement(StartTaskScreen, {
      route: { params: { taskId: 7 } }, navigation: { goBack() {}, setOptions() {}, replace: (...args) => navigation.push(args) },
    }));
    await cameraDelay();
    const stale = renderer.root.findByType('CameraView').props;
    await flush(() => {
      stale.onCameraReady();
      for (const listener of listeners) listener('background');
      stale.onBarcodeScanned({ data: 'background-qr' });
    });
    assert.equal(calls.length, 0);
    assert.equal(renderer.root.findAllByType('CameraView').length, 0);
    await flush(() => { for (const listener of listeners) listener('active'); });
    await cameraDelay();
    const scanner = renderer.root.findByType('CameraView').props;
    await flush(() => {
      scanner.onCameraReady();
      scanner.onBarcodeScanned({ data: 'wrong-qr' });
      scanner.onBarcodeScanned({ data: 'wrong-qr' });
    });
    assert.equal(calls.length, 1);
    await flush(() => rejectStart({ response: { data: { message: 'This is not the assigned area.' } } }));
    assert.equal(renderer.root.findAllByType('CameraView').length, 0);
    assert.ok(allText(renderer).includes('This is not the assigned area.'));
    assert.equal(navigation.length, 0);
    await click(renderer, 'Scan again');
    await cameraDelay();
    await flush(() => {
      const retry = renderer.root.findByType('CameraView').props;
      retry.onCameraReady(); retry.onBarcodeScanned({ data: 'correct-area-qr' });
    });
    assert.deepEqual(calls[1], { taskId: 7, areaQr: 'correct-area-qr' });
    await flush(() => resolveStart({ ...task, status: 'IN_PROGRESS', startedAt: new Date().toISOString() }));
    assert.equal(renderer.root.findAllByType('CameraView').length, 0);
    assert.ok(allText(renderer).includes('Cleaning started'));
    assert.equal(navigation.length, 0, 'Starting must leave the worker in the cleaning period');
    await click(renderer, 'Cleaning is finished');
    assert.deepEqual(navigation, [['Verification', { taskId: 7, requirePhotoQr: true }]], 'Finish receives no start QR/session authority');
  } finally {
    if (renderer) await flush(() => renderer.unmount());
  }
});
