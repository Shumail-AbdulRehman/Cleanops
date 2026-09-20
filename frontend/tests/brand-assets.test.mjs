import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { test } from 'node:test';

// Reuse the backend's installed image tool; no new dependency is needed.
const sharp = createRequire(new URL('../../backend/package.json', import.meta.url))('sharp');
const approvedMark = readFileSync(new URL('../../design/saas-onboarding/assets/hygene-ops-mark.svg', import.meta.url), 'utf8');
const mobileAssets = new URL('../../frontend-mobile/assets/', import.meta.url);

for (const path of ['../public/brand/hygene-ops-mark.svg', '../public/favicon.svg']) {
  test(`${path} is the complete approved checkbox SVG without the old mark colour`, () => {
    const svg = readFileSync(new URL(path, import.meta.url), 'utf8');
    assert.equal(svg, approvedMark);
    assert.doesNotMatch(svg, /#4264d9\b/i);
    assert.match(svg, /viewBox="0 0 48 48"/);
  });
}

async function readPng(name) {
  const png = readFileSync(new URL(`hygene-ops-${name}.png`, mobileAssets));
  assert.equal((await sharp(png).metadata()).format, 'png');
  return sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
}

for (const [name, dimension, markSize] of [
  ['icon', 1024, 1024],
  ['adaptive', 1024, 480],
  ['favicon', 48, 48],
  ['mark', 192, 192],
]) {
  test(`mobile ${name} keeps its ${dimension}×${dimension} size and shows the new checkbox`, async () => {
    const { data, info } = await readPng(name);
    assert.equal(info.width, dimension);
    assert.equal(info.height, dimension);

    for (let i = 0; i < data.length; i += 4) {
      assert.ok(!(data[i + 3] && data[i] === 0x42 && data[i + 1] === 0x64 && data[i + 2] === 0xd9), 'old mark colour must be absent');
    }

    // Sample the blue box, white tick and exposed cyan tip in SVG coordinates.
    const pixel = (x, y) => {
      const offset = (dimension - markSize) / 2;
      const px = Math.floor(offset + x * markSize / 48);
      const py = Math.floor(offset + y * markSize / 48);
      return [...data.subarray((py * dimension + px) * 4, (py * dimension + px) * 4 + 4)];
    };
    const [red, green, blue, alpha] = pixel(24, 12);
    assert.ok(blue > green && blue > red && alpha === 255, 'blue checkbox box');
    assert.deepEqual(pixel(20, 33), [255, 255, 255, 255], 'white tick inside the box');
    const tip = pixel(44, 6);
    assert.ok(tip[1] > tip[0] && tip[2] > tip[0] && tip[3] === 255, 'coloured tip outside the box');
    assert.equal(pixel(47, 47)[3], 0, 'transparent space around the mark');
  });
}

test('the complete adaptive mark fits the Android 66dp circular safe zone on its 108dp layer', async () => {
  const { data, info } = await readPng('adaptive');
  const centre = info.width / 2;
  const radius = info.width * 33 / 108;
  let visiblePixels = 0;
  for (let y = 0; y < info.height; y++) {
    for (let x = 0; x < info.width; x++) {
      if (!data[(y * info.width + x) * 4 + 3]) continue;
      visiblePixels++;
      assert.ok(Math.hypot(x + 0.5 - centre, y + 0.5 - centre) <= radius, 'even the tick tip must remain inside the safe zone');
      assert.ok(x >= 232 && y >= 232 && x < 792 && y < 792, 'retain at least the original transparent padding');
    }
  }
  assert.ok(visiblePixels > 50_000, 'safe-zone checks must not pass for an empty image');
});
