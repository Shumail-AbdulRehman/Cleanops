import { test } from "node:test";
import assert from "node:assert/strict";
import { addMonths, clock, compareMonths, countdown, dayLabel, dayMonth, duration, localDate, minutesBetween, monthTitle, shortDay, timeRange } from "./format";

const KHI = "Asia/Karachi"; // UTC+5
// 2026-11-10 09:30 / 11:00 / 12:30 / 13:30 Karachi
const at = (hm: string) => `2026-11-10T${hm}:00+05:00`;

test("clock", () => {
  assert.equal(clock(at("09:30"), KHI), "9:30 AM");
  assert.equal(clock(at("21:05"), KHI), "9:05 PM");
});

test("timeRange across and within a meridiem", () => {
  assert.equal(timeRange(at("09:30"), at("11:00"), KHI), "9:30 – 11:00 AM");
  assert.equal(timeRange(at("09:30"), at("13:00"), KHI), "9:30 AM – 1:00 PM");
  assert.equal(timeRange(at("12:30"), at("13:30"), KHI), "12:30 – 1:30 PM");
  assert.equal(timeRange(at("09:00"), at("11:30"), KHI), "9:00 – 11:30 AM");
  assert.equal(timeRange(at("11:00"), at("12:30"), KHI), "11:00 AM – 12:30 PM");
});

test("localDate respects the zone near midnight UTC", () => {
  assert.equal(localDate("2026-11-09T19:30:00Z", KHI), "2026-11-10");
  assert.equal(localDate("2026-11-09T18:59:00Z", KHI), "2026-11-09");
  assert.equal(localDate("2026-11-09T19:30:00Z", "UTC"), "2026-11-09");
});

test("shortDay", () => {
  assert.equal(shortDay("2026-11-10T05:00:00Z", KHI, "en"), "Tue, 10 Nov");
  const ur = shortDay("2026-11-10T05:00:00Z", KHI, "ur");
  assert.equal(ur, "منگل، 10 نومبر");
  assert.ok(ur.includes("نومبر"));
  assert.equal(shortDay("2026-11-09T19:30:00Z", KHI, "en"), "Tue, 10 Nov");
});

test("dayLabel", () => {
  const t = (k: string) => `T(${k})`;
  assert.equal(dayLabel("2026-11-10", "2026-11-10", "en", t), "T(Today)");
  assert.equal(dayLabel("2026-11-09", "2026-11-10", "en", t), "T(Yesterday)");
  assert.equal(dayLabel("2026-11-07", "2026-11-10", "en", t), "T(Saturday)");
  assert.equal(dayLabel("2026-10-31", "2026-11-01", "en", (k) => k), "Yesterday");
});

test("dayMonth and monthTitle", () => {
  assert.equal(dayMonth("2026-11-09", "en"), "9 Nov");
  assert.equal(dayMonth("2026-11-09", "ur"), "9 نومبر");
  assert.equal(monthTitle("2026-11", "en"), "November 2026");
  assert.equal(monthTitle("2026-11", "ur"), "نومبر 2026");
  assert.ok(monthTitle("2026-10", "ur").includes("اکتوبر"));
});

test("addMonths and compareMonths", () => {
  assert.equal(addMonths("2026-11", -1), "2026-10");
  assert.equal(addMonths("2026-01", -1), "2025-12");
  assert.equal(addMonths("2026-12", 1), "2027-01");
  assert.equal(addMonths("2026-03", -15), "2024-12");
  assert.ok(compareMonths("2026-10", "2026-11") < 0);
  assert.ok(compareMonths("2027-01", "2026-12") > 0);
  assert.equal(compareMonths("2026-05", "2026-05"), 0);
});

test("duration", () => {
  assert.equal(duration(484, "en"), "8h 4m");
  assert.equal(duration(484, "ur"), "8 گھنٹے 4 منٹ");
  assert.equal(duration(60, "en"), "1h");
  assert.equal(duration(45, "en"), "45m");
  assert.equal(duration(0, "en"), "0m");
});

test("countdown and minutesBetween", () => {
  assert.equal(countdown(272), "4:32");
  assert.equal(countdown(65), "1:05");
  assert.equal(countdown(9), "0:09");
  assert.equal(minutesBetween(at("09:30"), at("11:00")), 90);
});
