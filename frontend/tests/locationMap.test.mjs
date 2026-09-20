import test from "node:test";
import assert from "node:assert/strict";
import { parseCoordinates } from "../src/pages/Location/mapsSdk.ts";
test("map position requires both explicit valid coordinates and preserves zero", () => {
  assert.equal(parseCoordinates("", "0"), null);
  assert.equal(parseCoordinates("0", " "), null);
  assert.equal(parseCoordinates("91", "73"), null);
  assert.equal(parseCoordinates("33", "181"), null);
  assert.equal(parseCoordinates("NaN", "0"), null);
  assert.equal(parseCoordinates("Infinity", "0"), null);
  assert.deepEqual(parseCoordinates("0", "0"), { lat: 0, lng: 0 });
  assert.deepEqual(parseCoordinates("33.721500", "73.056000"), { lat: 33.7215, lng: 73.056 });
});
