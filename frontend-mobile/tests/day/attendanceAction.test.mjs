import { installMocks, render } from '../support/nativeHarness.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { act } from 'react-test-renderer';

// Boundary state shared with the module mocks below.
const now = new Date('2026-11-11T09:10:00.000Z');
const baseShift = {
  id: 456, date: '2026-11-11T00:00:00.000Z', status: 'ABSENT',
  expectedStart: '2026-11-11T09:00:00.000Z', expectedEnd: '2026-11-11T17:00:00.000Z',
  checkInTime: null, checkOutTime: null, location: { id: 7, name: 'Assigned site' },
};
const env = {};
function reset(overrides = {}) {
  Object.assign(env, {
    server: [{ ...baseShift }], calls: [], uploads: [], invalidated: [], cached: [],
    cameraGranted: true, locationGranted: true, readError: null,
    fixes: [{ coords: { latitude: 24.86, longitude: 67.01, accuracy: 12 }, timestamp: Date.now() }],
    watchOptions: [], uploadGate: null, uploadError: null,
    onUpload: () => {
      const at = '2026-11-11T09:12:00.000Z';
      env.server = env.server.map(row => (env.lastPath === '/attendance/check-out'
        ? { ...row, checkOutTime: at, status: 'CHECKED_OUT' }
        : { ...row, checkInTime: at, status: 'LATE' }));
    },
  }, overrides);
}
reset();

installMocks({
  'expo-camera': {
    useCameraPermissions: () => [null, async () => { env.calls.push('camera'); return { granted: env.cameraGranted }; }],
  },
  'expo-location': {
    requestForegroundPermissionsAsync: async () => { env.calls.push('location'); return { granted: env.locationGranted }; },
    watchPositionAsync: async (options) => { env.watchOptions.push(options); return { remove() {} }; },
    Accuracy: { Balanced: 3, High: 4, Highest: 6 },
  },
  '@tanstack/react-query': {
    infiniteQueryOptions: options => options,
    useQueryClient: () => ({
      setQueryData: (key, value) => { env.cached.push({ key, value }); },
      invalidateQueries: async ({ queryKey }) => { env.invalidated.push(queryKey); },
      getQueryData: () => undefined,
    }),
  },
  '/launch/launchApi': {
    readAttendance: async () => {
      env.calls.push('read');
      if (env.readError) throw env.readError;
      return env.server.map(row => ({ ...row }));
    },
  },
  '/api/client': {
    client: {}, accountRequest: scope => ({ _scope: scope }),
    uploadFormData: async (path, form, timeout) => {
      env.calls.push('upload');
      env.lastPath = path;
      env.uploads.push({ path, timeout, fields: Object.fromEntries(form.entries()) });
      if (env.uploadGate) await env.uploadGate;
      if (env.uploadError) throw env.uploadError;
      env.onUpload();
      return {};
    },
  },
  '/verification/location': {
    currentLocation: async (subscribe) => {
      env.calls.push('locate');
      await subscribe(() => {}, () => {});
      const fix = await env.fixes.shift();
      if (fix instanceof Error) throw fix;
      return fix;
    },
  },
  '/utils/upload': {
    createImagePart: (uri, name, type) => `image:${uri}:${name}:${type}`,
  },
});

const { useAttendanceAction, WEAK_SIGNAL_METERS } = await import('../../src/screens/day/useAttendanceAction.ts');
const { staffQueryKeys } = await import('../../src/queries/staff.ts');

let api;
function Probe(props) { api = useAttendanceAction(props); return null; }

async function mount(props = {}) {
  return render(React.createElement(Probe, { staffId: 2, records: env.server.map(row => ({ ...row })), now, online: true, ...props }));
}
const run = fn => act(async () => { await fn(); });
async function withHook(props, body) {
  const renderer = await mount(props);
  try { await body(renderer); } finally { await act(async () => renderer.unmount()); }
}

test('starts idle with nothing in progress', async () => {
  reset();
  await withHook({}, async () => {
    assert.equal(api.phase, 'idle');
    assert.equal(api.mode, null);
    assert.equal(api.result, null);
    assert.equal(api.error, null);
    assert.equal(WEAK_SIGNAL_METERS, 50);
  });
});

test('start while offline sets the internet error and calls nothing', async () => {
  reset();
  await withHook({ online: false }, async () => {
    await run(() => api.start('check-in'));
    assert.equal(api.phase, 'error');
    assert.equal(api.error, 'Internet needed to continue');
    assert.deepEqual(env.calls, []);
  });
});

test('a missing shift asks for a refresh without reading the server', async () => {
  reset();
  await withHook({ records: [] }, async () => {
    await run(() => api.start('check-in'));
    assert.equal(api.phase, 'error');
    assert.equal(api.error, 'Refresh to load your shift before continuing.');
    assert.deepEqual(env.calls, []);
  });
});

test('an already recorded check-in goes straight to done without the camera', async () => {
  reset();
  await withHook({}, async () => {
    env.server = [{ ...baseShift, checkInTime: '2026-11-11T09:01:00.000Z', status: 'CHECKED_IN' }];
    await run(() => api.start('check-in'));
    assert.equal(api.phase, 'done');
    assert.deepEqual(api.result, { mode: 'check-in', at: '2026-11-11T09:01:00.000Z', late: false });
    assert.deepEqual(env.calls, ['read']);
    assert.deepEqual(env.cached[0].key, staffQueryKeys.attendance(2));
    assert.equal(env.cached[0].value[0].checkInTime, '2026-11-11T09:01:00.000Z');
  });
});

test('a network failure while re-reading shows the internet message', async () => {
  reset({ readError: Object.assign(new Error('Network Error'), { code: 'ERR_NETWORK' }) });
  await withHook({}, async () => {
    await run(() => api.start('check-in'));
    assert.equal(api.phase, 'error');
    assert.equal(api.error, 'Internet needed to continue');
    assert.deepEqual(env.calls, ['read']);
  });
});

test('camera refused gives needsPermission and never asks for location', async () => {
  reset({ cameraGranted: false });
  await withHook({}, async () => {
    await run(() => api.start('check-in'));
    assert.equal(api.phase, 'needsPermission');
    assert.equal(api.error, 'Allow camera access to capture an attendance image.');
    assert.deepEqual(env.calls, ['read', 'camera']);
  });
});

test('location refused gives needsPermission after the camera, and a later start can retry', async () => {
  reset({ locationGranted: false });
  await withHook({}, async () => {
    await run(() => api.start('check-in'));
    assert.equal(api.phase, 'needsPermission');
    assert.equal(api.error, 'Allow location access to mark attendance.');
    assert.deepEqual(env.calls, ['read', 'camera', 'location']);
    env.locationGranted = true;
    await run(() => api.start('check-in'));
    assert.equal(api.phase, 'selfie');
  });
});

test('a good fix opens the selfie with a highest-accuracy watch', async () => {
  reset();
  await withHook({}, async () => {
    await run(() => api.start('check-in'));
    assert.equal(api.phase, 'selfie');
    assert.equal(api.mode, 'check-in');
    assert.equal(api.accuracyMeters, 12);
    assert.deepEqual(env.calls, ['read', 'camera', 'location', 'locate']);
    assert.deepEqual(env.watchOptions, [{ accuracy: 6, timeInterval: 1000, distanceInterval: 0 }]);
  });
});

test('accuracy 86 m gives weakSignal and continueAnyway opens the selfie', async () => {
  reset({ fixes: [{ coords: { latitude: 24.86, longitude: 67.01, accuracy: 86 }, timestamp: Date.now() }] });
  await withHook({}, async () => {
    await run(() => api.start('check-in'));
    assert.equal(api.phase, 'weakSignal');
    assert.equal(api.accuracyMeters, 86);
    await run(() => api.continueAnyway());
    assert.equal(api.phase, 'selfie');
    assert.equal(api.accuracyMeters, 86);
    await run(() => api.submitSelfie('file:///selfie.jpg'));
    assert.equal(env.uploads[0].fields.accuracy, '86');
  });
});

test('retryLocation looks again and uses the new fix', async () => {
  reset({
    fixes: [
      { coords: { latitude: 1, longitude: 2, accuracy: 86 }, timestamp: Date.now() },
      { coords: { latitude: 24.86, longitude: 67.01, accuracy: 9 }, timestamp: Date.now() },
    ],
  });
  await withHook({}, async () => {
    await run(() => api.start('check-in'));
    assert.equal(api.phase, 'weakSignal');
    await run(() => api.retryLocation());
    assert.equal(api.phase, 'selfie');
    assert.equal(api.accuracyMeters, 9);
    assert.deepEqual(env.calls, ['read', 'camera', 'location', 'locate', 'locate']);
    await run(() => api.submitSelfie('file:///selfie.jpg'));
    assert.equal(env.uploads[0].fields.latitude, '24.86');
  });
});

test('a location failure shows the location message', async () => {
  reset({ fixes: [new Error('Location is unavailable. Check that precise location is on, then try again.')] });
  await withHook({}, async () => {
    await run(() => api.start('check-in'));
    assert.equal(api.phase, 'error');
    assert.equal(api.error, 'Location is unavailable. Check that precise location is on, then try again.');
  });
});

test('submitSelfie uploads the check-in with location and image, then done and both invalidations', async () => {
  reset();
  await withHook({}, async () => {
    await run(() => api.start('check-in'));
    await run(() => api.submitSelfie('file:///selfie.jpg'));
    assert.equal(env.uploads.length, 1);
    const [upload] = env.uploads;
    assert.equal(upload.path, '/attendance/check-in');
    assert.equal(upload.timeout, 60000);
    assert.deepEqual(upload.fields, {
      latitude: '24.86', longitude: '67.01', accuracy: '12',
      image: 'image:file:///selfie.jpg:check-in.jpg:image/jpeg',
    });
    assert.equal(api.phase, 'done');
    assert.deepEqual(api.result, { mode: 'check-in', at: '2026-11-11T09:12:00.000Z', late: true });
    assert.deepEqual(env.invalidated, [staffQueryKeys.attendance(2), staffQueryKeys.tasksToday(2)]);
    // Reconciled: read before acting, read before the write, read after it.
    assert.deepEqual(env.calls, ['read', 'camera', 'location', 'locate', 'read', 'upload', 'read']);
  });
});

test('check-out sends the selected attendanceId', async () => {
  reset();
  const open = { ...baseShift, status: 'CHECKED_IN', checkInTime: '2026-11-11T09:01:00.000Z' };
  env.server = [open];
  await withHook({ records: [open] }, async () => {
    await run(() => api.start('check-out'));
    assert.equal(api.phase, 'selfie');
    await run(() => api.submitSelfie('file:///out.jpg'));
    const [upload] = env.uploads;
    assert.equal(upload.path, '/attendance/check-out');
    assert.equal(upload.fields.attendanceId, '456');
    assert.equal(upload.fields.image, 'image:file:///out.jpg:check-out.jpg:image/jpeg');
    assert.equal(api.phase, 'done');
    assert.deepEqual(api.result, { mode: 'check-out', at: '2026-11-11T09:12:00.000Z', late: false });
  });
});

test('a second start or cancel while saving is ignored', async () => {
  reset();
  let release;
  env.uploadGate = new Promise(resolve => { release = resolve; });
  await withHook({}, async () => {
    await run(() => api.start('check-in'));
    let saving;
    await act(async () => { saving = api.submitSelfie('file:///selfie.jpg'); });
    assert.equal(api.phase, 'saving');
    const before = env.calls.length;
    await run(() => api.start('check-in'));
    await run(() => api.cancel());
    assert.equal(env.calls.length, before);
    assert.equal(api.phase, 'saving');
    await act(async () => { release(); await saving; });
    assert.equal(api.phase, 'done');
    assert.equal(env.uploads.length, 1);
  });
});

test('success is never inferred from the photo: an unconfirmed upload is an error', async () => {
  reset({ onUpload: () => {} });
  await withHook({}, async () => {
    await run(() => api.start('check-in'));
    await run(() => api.submitSelfie('file:///selfie.jpg'));
    assert.equal(api.phase, 'error');
    assert.equal(api.error, 'Attendance is not confirmed. Refresh before trying again.');
    assert.equal(api.result, null);
    assert.deepEqual(env.invalidated, []);
  });
});

test('a lost upload response that the server recorded still reaches done', async () => {
  reset({
    onUpload: () => {
      env.server = env.server.map(row => ({ ...row, checkInTime: '2026-11-11T09:12:00.000Z', status: 'CHECKED_IN' }));
      throw new Error('response lost');
    },
  });
  await withHook({}, async () => {
    await run(() => api.start('check-in'));
    await run(() => api.submitSelfie('file:///selfie.jpg'));
    assert.equal(api.phase, 'done');
    assert.deepEqual(api.result, { mode: 'check-in', at: '2026-11-11T09:12:00.000Z', late: false });
    assert.equal(env.uploads.length, 1);
  });
});

test('a geofence rejection keeps the server message in error', async () => {
  const rejection = Object.assign(new Error('Request failed with status code 400'), {
    response: { status: 400, data: { message: "You are outside your site's attendance area. Move closer and try again." } },
  });
  reset({ uploadError: rejection });
  await withHook({}, async () => {
    await run(() => api.start('check-in'));
    await run(() => api.submitSelfie('file:///selfie.jpg'));
    assert.equal(api.phase, 'error');
    assert.equal(api.error, "You are outside your site's attendance area. Move closer and try again.");
  });
});

test('cancel returns to idle from the selfie and from weak signal', async () => {
  reset({
    fixes: [
      { coords: { latitude: 1, longitude: 2, accuracy: 12 }, timestamp: Date.now() },
      { coords: { latitude: 1, longitude: 2, accuracy: 86 }, timestamp: Date.now() },
    ],
  });
  await withHook({}, async () => {
    await run(() => api.start('check-in'));
    assert.equal(api.phase, 'selfie');
    await run(() => api.cancel());
    assert.equal(api.phase, 'idle');
    assert.equal(api.mode, null);
    await run(() => api.submitSelfie('file:///late.jpg'));
    assert.equal(env.uploads.length, 0);
    await run(() => api.start('check-in'));
    assert.equal(api.phase, 'weakSignal');
    await run(() => api.cancel());
    assert.equal(api.phase, 'idle');
    await run(() => api.continueAnyway());
    assert.equal(api.phase, 'idle');
  });
});

test('cancel while locating drops the late fix', async () => {
  let deliver;
  reset({ fixes: [new Promise(resolve => { deliver = resolve; })] });
  await withHook({}, async () => {
    let pending;
    await act(async () => { pending = api.start('check-in'); });
    assert.equal(api.phase, 'locating');
    await run(() => api.cancel());
    assert.equal(api.phase, 'idle');
    await act(async () => {
      deliver({ coords: { latitude: 1, longitude: 2, accuracy: 5 }, timestamp: Date.now() });
      await pending;
    });
    assert.equal(api.phase, 'idle');
    await run(() => api.submitSelfie('file:///late.jpg'));
    assert.equal(env.uploads.length, 0);
  });
});
