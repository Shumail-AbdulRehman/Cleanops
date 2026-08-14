import assert from "node:assert/strict";
import { test } from "node:test";
import type { OperationOverview } from "./operations.ts";
import { hourlyProgress, type HourlyProgressInput } from "./hourlyProgress.ts";

const input: HourlyProgressInput = {
  hourly: [
    { hour: 9, due: 2, submitted: 1 },
    { hour: 10, due: 5, submitted: 2 },
    { hour: 11, due: 6, submitted: null },
  ],
  asOf: "2026-11-10T05:45:00Z",
  date: "today",
  timezone: "Asia/Karachi",
};

test("maps cumulative chart points without changing or retaining cached point objects", () => {
  const hourly = input.hourly!.map((point) => Object.freeze({ ...point }));
  Object.freeze(hourly);
  const { points } = hourlyProgress({ ...input, hourly });
  assert.deepEqual(points, hourly);
  assert.notEqual(points, hourly);
  points.forEach((point, index) => assert.notEqual(point, hourly[index]));
  points[0].due = 99;
  assert.equal(hourly[0].due, 2);
});

for (const hourly of [undefined, []]) {
  test(`returns an empty result for ${hourly ? "empty" : "absent rolling-deploy"} data`, () => {
    assert.deepEqual(hourlyProgress({ ...input, hourly }), {
      points: [], currentHour: null, current: null, behind: 0,
    });
  });
}

test("the optional wire contract accepts a legacy overview without hourly data", () => {
  const legacy: Pick<OperationOverview, "asOf" | "date" | "hourly"> = {
    asOf: input.asOf, date: input.date,
  };
  assert.deepEqual(hourlyProgress({ ...legacy, timezone: input.timezone }).points, []);
});

test("finds the current local hour from asOf and computes due minus submitted", () => {
  const result = hourlyProgress(input);
  assert.equal(result.currentHour, 10);
  assert.deepEqual(result.current, { hour: 10, due: 5, submitted: 2 });
  assert.equal(result.current, result.points[1]);
  assert.equal(result.behind, 3);
});

for (const [submitted, behind] of [[0, 5], [5, 0], [8, 0], [null, 0]] as const) {
  test(`a current submitted count of ${submitted} produces ${behind} behind`, () => {
    const result = hourlyProgress({ ...input, hourly: [{ hour: 10, due: 5, submitted }] });
    assert.equal(result.behind, behind);
    assert.equal(result.current?.submitted, submitted);
  });
}

test("preserves null future counts, numeric zero and full-day due counts", () => {
  const hourly = [
    { hour: 10, due: 5, submitted: 0 },
    { hour: 11, due: 9, submitted: null },
    { hour: 12, due: 12, submitted: null },
  ];
  const result = hourlyProgress({ ...input, hourly });
  assert.deepEqual(result.points, hourly);
  assert.equal(result.behind, 5);
});

test("uses the next bucket exactly at an hour boundary", () => {
  const before = hourlyProgress({ ...input, asOf: "2026-11-10T04:59:59Z" });
  const at = hourlyProgress({ ...input, asOf: "2026-11-10T05:00:00Z" });
  assert.equal(before.current?.hour, 9);
  assert.equal(at.current?.hour, 10);
});

test("before the first bucket there is a Now hour but no fabricated current count", () => {
  const result = hourlyProgress({ ...input, asOf: "2026-11-10T03:59:59Z" });
  assert.equal(result.currentHour, 8);
  assert.equal(result.current, null);
  assert.equal(result.behind, 0);
});

test("after the last bucket uses the last cumulative count without adding points", () => {
  const result = hourlyProgress({
    ...input,
    asOf: "2026-11-10T18:30:00Z",
    hourly: [{ hour: 9, due: 5, submitted: 4 }],
  });
  assert.equal(result.currentHour, 23);
  assert.equal(result.current?.hour, 9);
  assert.equal(result.behind, 1);
  assert.equal(result.points.length, 1);
});

test("different selected timezones use different local hours for the same snapshot", () => {
  const utc = hourlyProgress({ ...input, timezone: "UTC" });
  assert.equal(utc.currentHour, 5);
  assert.equal(utc.current, null);
  assert.equal(hourlyProgress(input).currentHour, 10);
});

test("resolves fractional-offset timezones without rounding the UTC hour", () => {
  const result = hourlyProgress({ ...input, asOf: "2026-11-10T04:20:00Z", timezone: "Asia/Kathmandu" });
  assert.equal(result.currentHour, 10);
  assert.equal(result.current?.hour, 10);
});

test("an explicit date equal to location-local today gets a current point", () => {
  const result = hourlyProgress({ ...input, date: "2026-11-10" });
  assert.equal(result.currentHour, 10);
  assert.equal(result.behind, 3);
});

test("compares dates in the selected timezone across UTC midnight", () => {
  const nextLocalDay = { ...input, asOf: "2026-11-10T20:00:00Z" };
  const today = hourlyProgress({ ...nextLocalDay, date: "2026-11-11" });
  const yesterday = hourlyProgress({ ...nextLocalDay, date: "2026-11-10" });
  assert.equal(today.currentHour, 1);
  assert.equal(yesterday.currentHour, null);
  assert.equal(yesterday.behind, 0);
});

test("midnight is hour zero and never hour 24", () => {
  const result = hourlyProgress({
    ...input,
    asOf: "2026-11-09T19:00:00Z",
    hourly: [{ hour: 0, due: 2, submitted: 1 }],
  });
  assert.equal(result.currentHour, 0);
  assert.equal(result.current?.hour, 0);
  assert.equal(result.behind, 1);
});

for (const date of ["2026-11-09", "2026-11-11"]) {
  test(`non-today date ${date} retains chart points without a Now marker or behind count`, () => {
    const hourly = [
      { hour: 9, due: 2, submitted: 1 },
      { hour: 10, due: 5, submitted: date === "2026-11-09" ? 4 : null },
    ];
    assert.deepEqual(hourlyProgress({ ...input, date, hourly }), {
      points: hourly, currentHour: null, current: null, behind: 0,
    });
  });
}

for (const asOf of ["2026-03-08T06:30:00Z", "2026-03-08T07:30:00Z"]) {
  test(`uses timezone daylight-saving rules at ${asOf}`, () => {
    const result = hourlyProgress({ ...input, asOf, timezone: "America/New_York" });
    assert.equal(result.currentHour, asOf.includes("06:") ? 1 : 3);
  });
}

test("invalid asOf retains points without inferring a current point from the device clock", () => {
  const result = hourlyProgress({ ...input, asOf: "invalid" });
  assert.deepEqual(result.points, input.hourly);
  assert.equal(result.currentHour, null);
  assert.equal(result.current, null);
  assert.equal(result.behind, 0);
});

test("invalid timezone retains points without falling back to the device timezone", () => {
  const result = hourlyProgress({ ...input, timezone: "Invalid/Timezone" });
  assert.deepEqual(result.points, input.hourly);
  assert.equal(result.currentHour, null);
  assert.equal(result.current, null);
  assert.equal(result.behind, 0);
});
