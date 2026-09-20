import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeWeek, moveWeek } from '../src/pages/Location/scheduleTypes.ts';
test('week links reject malformed and impossible dates', () => {
  for (const input of [null, '', '2026-02-30', 'garbage', '2026-1-01']) assert.equal(normalizeWeek(input), undefined);
});
test('week links normalize Sunday and cross year boundaries in calendar days', () => {
  assert.equal(normalizeWeek('2026-09-20'), '2026-09-14');
  assert.equal(normalizeWeek('2026-01-01'), '2025-12-29');
  assert.equal(moveWeek('2025-12-29', 1), '2026-01-05');
  assert.equal(moveWeek('2026-03-09', -1), '2026-03-02');
});
