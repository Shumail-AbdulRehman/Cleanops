import test from "node:test";
import assert from "node:assert/strict";
import { getPreciseCurrentPosition } from "../src/pages/Location/currentPosition.ts";

function device() {
  const cleared = [];
  let success, failure;
  return {
    cleared,
    geolocation: {
      watchPosition(onSuccess, onError, options) {
        success = onSuccess;
        failure = onError;
        assert.equal(options.enableHighAccuracy, true);
        assert.equal(options.maximumAge, 0);
        return 7;
      },
      clearWatch(id) {
        cleared.push(id);
      },
    },
    position(accuracy) {
      success({
        coords: { latitude: 33.623245, longitude: 73.089024, accuracy },
      });
    },
    error(code) {
      failure({ code });
    },
  };
}

test("ignores a coarse network estimate and waits for an accurate reading", async () => {
  const gps = device();
  const request = getPreciseCurrentPosition(
    gps.geolocation,
    new AbortController().signal,
  );
  gps.position(193047);
  assert.deepEqual(gps.cleared, []);
  gps.position(50);
  assert.equal((await request).coords.accuracy, 50);
  assert.deepEqual(gps.cleared, [7]);
});

test("rejects coarse-only readings with useful units and cleans up the watcher", async () => {
  const gps = device();
  const request = getPreciseCurrentPosition(
    gps.geolocation,
    new AbortController().signal,
    10,
  );
  gps.position(193047);
  await assert.rejects(request, /±193\.0 km.*Coordinates were not filled in/);
  assert.deepEqual(gps.cleared, [7]);
});

test("unknown accuracy cannot silently pass the accuracy limit", async () => {
  const gps = device();
  const request = getPreciseCurrentPosition(
    gps.geolocation,
    new AbortController().signal,
    10,
  );
  gps.position(null);
  gps.position(NaN);
  await assert.rejects(request, /Could not get an accurate location/);
  assert.deepEqual(gps.cleared, [7]);
});

test("permission denial is immediate and actionable", async () => {
  const gps = device();
  const request = getPreciseCurrentPosition(
    gps.geolocation,
    new AbortController().signal,
  );
  gps.error(1);
  await assert.rejects(request, /permission was denied/);
  assert.deepEqual(gps.cleared, [7]);
});

test("cancellation prevents a late reading from completing the request", async () => {
  const gps = device();
  const controller = new AbortController();
  const request = getPreciseCurrentPosition(gps.geolocation, controller.signal);
  controller.abort();
  gps.position(5);
  await assert.rejects(request, { name: "AbortError" });
  assert.deepEqual(gps.cleared, [7]);
});

test("temporary unavailability can recover before the deadline", async () => {
  const gps = device();
  const request = getPreciseCurrentPosition(
    gps.geolocation,
    new AbortController().signal,
  );
  gps.error(2);
  gps.position(12);
  assert.equal((await request).coords.accuracy, 12);
});
