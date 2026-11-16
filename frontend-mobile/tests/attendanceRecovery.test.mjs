import assert from 'node:assert/strict';
import test from 'node:test';
import { installMocks, render, allText, findPressable, press } from './support/nativeHarness.mjs';

// Drives the real My day screen with the real attendance hook (spec 16); only the boundaries are mocked.
const React = (await import('react')).default;
const { act } = await import('react-test-renderer');
const { translate } = await import('../src/i18n/translations.ts');

const now = Date.now();
const shift = { id: 456, date: new Date(now).toISOString(), status: 'CHECKED_IN', expectedStart: new Date(now - 3 * 3600000).toISOString(), expectedEnd: new Date(now - 60000).toISOString(), checkInTime: new Date(now - 2 * 3600000).toISOString(), checkOutTime: null, location: { id: 7, name: 'Assigned site' } };
let records = [shift], uploads = [], failRead = false, permissions = 0, cameraGranted = true, locationGranted = true, settingsOpened = 0;
const cache = { invalidateQueries: async () => {}, setQueryData() {}, getQueryData() {} };
const permission = async () => { permissions++; return { granted: permissions === 1 ? cameraGranted : locationGranted }; };
const harness = globalThis.__nativeHarness;

installMocks({
  '/ui/icon': { Icon: props => React.createElement('Icon', props) },
  'react-native-svg': { __esModule: true, default: 'Svg', Svg: 'Svg', Path: 'Path', Ellipse: 'Ellipse' },
  'react-native-reanimated': { useAnimatedProps: factory => factory() },
  'react-native': { Linking: { openSettings: async () => { settingsOpened++; }, openURL: async () => {} } },
  'expo-camera': { CameraView: 'CameraView', useCameraPermissions: () => [null, permission] },
  'expo-location': { requestForegroundPermissionsAsync: permission, Accuracy: { Highest: 1 } },
  '@react-native-community/netinfo': { default: { addEventListener: () => () => {} } },
  '@tanstack/react-query': { useQueryClient: () => cache },
  '/launch/launchApi': { readAttendance: async () => { if (failRead) throw new Error('offline'); return records; } },
  '/auth/AuthContext': { useAuth: () => ({ user: { id: 2, companyId: 3, locationId: 7, name: 'Synthetic staff' } }) },
  '/api/client': {
    uploadFormData: async (path, form) => {
      uploads.push({ path, id: form.get('attendanceId') });
      records = [{ ...shift, checkOutTime: new Date(now).toISOString(), status: 'CHECKED_OUT' }];
      throw new Error('response lost');
    },
  },
  '/queries/staff': {
    staffQueryKeys: { attendance: id => [id, 'attendance'], tasksToday: id => [id, 'tasks'] },
    useMyAttendanceQuery: () => ({ data: records, refetch: async () => ({}), isPending: false, isRefetching: false }),
    useTodaysTasksQuery: () => ({ data: [], counts: { total: 0, submitted: 0 }, refetch: async () => ({}), isPending: false, isRefetching: false }),
  },
  '/verification/location': { currentLocation: async () => ({ coords: { latitude: 24, longitude: 67, accuracy: 10 } }) },
  '/utils/upload': { createImagePart: () => 'synthetic-image' },
  '/components/AttendanceCamera': { AttendanceCamera: 'AttendanceCamera' },
  '/i18n/LanguageProvider': {
    useLanguage: () => ({ language: harness.language, isRTL: false, setLanguage() {}, t: (text, values) => translate(text, harness.language, values) }),
  },
});
const { HomeScreen } = await import('../src/screens/HomeScreen.tsx');

const mount = () => render(React.createElement(HomeScreen));
const checkout = renderer => findPressable(renderer, 'Check out');
const cameras = renderer => renderer.root.findAllByType('AttendanceCamera');

test('actual home screen sends exact selected checkout ID and reconciles a lost write response', async () => {
  records = [shift]; uploads = []; permissions = 0; failRead = false;
  const renderer = await mount();
  try {
    assert.ok(checkout(renderer));
    await press(checkout(renderer));
    const camera = renderer.root.findByType('AttendanceCamera');
    await act(async () => camera.props.onCapture('synthetic-selfie.jpg'));
    assert.deepEqual(uploads, [{ path: '/attendance/check-out', id: '456' }]);
    assert.equal(cameras(renderer).length, 0);
    // The confirmed check-out shows its receipt (was the "Check-out recorded." notice).
    assert.ok(allText(renderer).includes('Checked out'));
    assert.ok(!allText(renderer).includes('Attendance not saved'));
  } finally { await act(async () => renderer.unmount()); }
});

test('home screen reconciles before camera permission and never opens camera when disconnected', async () => {
  records = [shift]; uploads = []; permissions = 0; failRead = true;
  const renderer = await mount();
  try {
    await press(checkout(renderer));
    assert.equal(cameras(renderer).length, 0);
    assert.equal(permissions, 0);
    assert.equal(uploads.length, 0);
    assert.ok(allText(renderer).includes('Attendance not saved'));
  } finally { failRead = false; await act(async () => renderer.unmount()); }
});

for (const denied of ['camera', 'location']) test(`attendance ${denied} denial exposes Settings and an explicit retry without uploading`, async () => {
  records = [shift]; uploads = []; permissions = 0; failRead = false; settingsOpened = 0;
  cameraGranted = denied !== 'camera'; locationGranted = denied !== 'location';
  const renderer = await mount();
  try {
    await press(checkout(renderer));
    assert.equal(cameras(renderer).length, 0); assert.equal(uploads.length, 0);
    assert.equal(permissions, denied === 'camera' ? 1 : 2);
    const settings = findPressable(renderer, 'Open settings');
    assert.ok(settings); await press(settings); assert.equal(settingsOpened, 1);
    cameraGranted = true; locationGranted = true; permissions = 0;
    await press(checkout(renderer));
    assert.equal(cameras(renderer).length, 1); assert.equal(uploads.length, 0);
  } finally { cameraGranted = true; locationGranted = true; await act(async () => renderer.unmount()); }
});
