import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { nowState, type NowInput, type NowTask } from "./nowState";
import type { AttendanceRecord } from "../../types";

const KHI = "Asia/Karachi";
// 2026-11-10 in Karachi (UTC+5); the shift runs 9:00 AM to 5:00 PM.
const at = (hm: string) => new Date(`2026-11-10T${hm}:00+05:00`);
const iso = (hm: string) => at(hm).toISOString();

const record = (over: Partial<AttendanceRecord> = {}): AttendanceRecord => ({
  id: 1,
  date: iso("00:00"),
  status: "ABSENT",
  expectedStart: iso("09:00"),
  expectedEnd: iso("17:00"),
  checkInTime: null,
  checkOutTime: null,
  location: { id: 3, name: "Gulberg Plaza" },
  ...over,
});
const checkedIn = (over: Partial<AttendanceRecord> = {}) =>
  record({ status: "CHECKED_IN", checkInTime: iso("08:58"), ...over });

let nextId = 1;
const task = (over: Partial<NowTask> = {}): NowTask => ({
  id: nextId++,
  title: "Daily clean",
  status: "PENDING",
  shiftStart: iso("09:30"),
  shiftEnd: iso("11:00"),
  areaNameSnapshot: "Ground floor washroom",
  ...over,
});

const input = (over: Partial<NowInput> = {}): NowInput => ({
  hasLocation: true,
  record: record(),
  tasks: [],
  now: at("08:52"),
  online: true,
  failed: false,
  photosAvailable: true,
  timeZone: KHI,
  ...over,
});

test("rule 1: failed load asks to retry", () => {
  const s = nowState(input({ failed: true, hasLocation: false, record: null }));
  assert.equal(s.tone, "quiet");
  assert.deepEqual(s.title, { key: "Today could not load", values: {} });
  assert.equal(s.sub.key, "Check your internet and try again.");
  assert.deepEqual(s.action, { kind: "retry" });
  assert.equal(s.rail, null);
});

test("rule 2: no location", () => {
  const s = nowState(input({ hasLocation: false }));
  assert.equal(s.tone, "quiet");
  assert.equal(s.title.key, "No location assigned");
  assert.equal(s.sub.key, "Ask your manager to give you a location and shift.");
  assert.equal(s.action, null);
});

test("rule 3: no record", () => {
  const s = nowState(input({ record: null }));
  assert.equal(s.tone, "quiet");
  assert.equal(s.title.key, "No shift loaded for today");
  assert.equal(s.sub.key, "Pull down to refresh. If it is still missing, ask your manager.");
  assert.equal(s.action, null);
  assert.equal(s.wait, null);
});

test("a day off names the next shift's local weekday and time without an action", () => {
  const s = nowState(input({
    record: null,
    offToday: true,
    now: new Date("2026-11-09T04:00:00.000Z"),
    nextShiftStart: "2026-11-11T04:00:00.000Z",
  }));
  assert.equal(s.tone, "quiet");
  assert.equal(s.title.key, "Day off today");
  assert.deepEqual(s.sub, {
    key: "Your next shift is {day} at {time}.",
    values: { day: "Wednesday", time: "9:00 AM" },
  });
  assert.equal(s.action, null);
  assert.equal(s.wait, null);
});

test("tomorrow is the next local date even when both instants share a UTC date", () => {
  const s = nowState(input({
    record: null,
    offToday: true,
    now: new Date("2026-11-10T18:30:00.000Z"),
    nextShiftStart: "2026-11-10T19:30:00.000Z",
  }));
  assert.deepEqual(s.sub.values, { day: "tomorrow", time: "12:30 AM" });
});

test("the next shift's weekday comes from its zone, not the UTC instant, and is translated", () => {
  const s = nowState(input({
    record: null,
    offToday: true,
    timeZone: "America/New_York",
    language: "ur",
    now: new Date("2026-11-09T14:00:00.000Z"),
    nextShiftStart: "2026-11-12T03:00:00.000Z",
  }));
  assert.deepEqual(s.sub.values, { day: "بدھ", time: "10:00 PM" });
});

test("a day off without a next shift points to the manager", () => {
  const s = nowState(input({ record: null, offToday: true, nextShiftStart: null }));
  assert.equal(s.title.key, "Day off today");
  assert.equal(s.sub.key, "Ask your manager if you should be working today.");
  assert.equal(s.action, null);
});

test("a relevant attendance record takes priority over a day-off flag", () => {
  const existing = input({ record: checkedIn(), now: at("12:00") });
  assert.deepEqual(nowState({ ...existing, offToday: true }), nowState(existing));
});

test("rule 4: checked out says both times", () => {
  const s = nowState(
    input({ record: record({ status: "CHECKED_OUT", checkInTime: iso("08:58"), checkOutTime: iso("17:04") }), now: at("17:10") }),
  );
  assert.equal(s.tone, "ok");
  assert.equal(s.title.key, "Shift finished");
  assert.deepEqual(s.sub, { key: "In {in}. Out {out}. Thank you.", values: { in: "8:58 AM", out: "5:04 PM" } });
  assert.equal(s.action, null);
  assert.equal(s.rail, null);
  // A check-out time wins over an open status.
  assert.equal(nowState(input({ record: checkedIn({ checkOutTime: iso("17:04") }) })).title.key, "Shift finished");
});

test("rule 5: 8:05 before check-in opens has no action", () => {
  const s = nowState(input({ now: at("08:05") }));
  assert.equal(s.tone, "blue");
  assert.deepEqual(s.title, { key: "Check-in opens at {time}", values: { time: "8:30 AM" } });
  assert.deepEqual(s.sub, {
    key: "Your shift starts at {time} at {place}.",
    values: { time: "9:00 AM", place: "Gulberg Plaza" },
    name: "Gulberg Plaza",
  });
  assert.equal(s.action, null);
  assert.equal(s.wait, null);
  assert.equal(s.rail, null);
});

test("rule 5: 8:52 asks to check in", () => {
  const s = nowState(input({ now: at("08:52") }));
  assert.equal(s.tone, "blue");
  assert.equal(s.title.key, "Check in to start your shift");
  assert.deepEqual(s.sub, {
    key: "Take a selfie at {place}. Keep location on.",
    values: { place: "Gulberg Plaza" },
    name: "Gulberg Plaza",
  });
  assert.deepEqual(s.action, { kind: "checkIn" });
  assert.equal(s.rail, null);
  // The window opens exactly at 8:30 and stays on time through 9:15.
  assert.equal(nowState(input({ now: at("08:30") })).action?.kind, "checkIn");
  assert.equal(nowState(input({ now: at("09:15") })).action?.kind, "checkIn");
});

test("rule 5: without a place name the sentence drops it", () => {
  const s = nowState(input({ record: record({ location: undefined }), now: at("08:52") }));
  assert.deepEqual(s.sub, { key: "Take a selfie at your location. Keep location on.", values: {} });
  const before = nowState(input({ record: record({ location: undefined }), now: at("08:05") }));
  assert.deepEqual(before.sub, { key: "Your shift starts at {time}.", values: { time: "9:00 AM" } });
});

test("rule 5: 9:24 is a late check-in", () => {
  const s = nowState(input({ now: at("09:24") }));
  assert.equal(s.tone, "blue");
  assert.equal(s.title.key, "You are late. Check in now.");
  assert.deepEqual(s.sub, {
    key: "Shift started at {time}. This check-in will be marked late.",
    values: { time: "9:00 AM" },
  });
  assert.deepEqual(s.action, { kind: "checkInLate" });
  assert.equal(s.rail, null);
  // Still allowed exactly at shift end.
  assert.equal(nowState(input({ now: at("17:00") })).action?.kind, "checkInLate");
});

test("rule 5: 18:10 without check-in is closed", () => {
  const s = nowState(input({ now: at("18:10") }));
  assert.equal(s.tone, "quiet");
  assert.equal(s.title.key, "Shift time closed");
  assert.deepEqual(s.sub, {
    key: "This shift ended at {time} without a check-in. If this is wrong, tell your manager.",
    values: { time: "5:00 PM" },
  });
  assert.equal(s.action, null);
  assert.equal(s.rail, null);
});

test("rule 6: missed check-out", () => {
  const s = nowState(input({ record: checkedIn({ status: "MISSED_CHECKOUT" }), now: at("19:00"), tasks: [task()] }));
  assert.equal(s.tone, "bad");
  assert.equal(s.title.key, "Check-out is overdue");
  assert.deepEqual(s.sub, {
    key: "Your shift ended at {time}. This late check-out stays on your record.",
    values: { time: "5:00 PM" },
  });
  assert.deepEqual(s.action, { kind: "completeCheckOut" });
});

test("rule 7: checked in shows the rail", () => {
  const s = nowState(input({ record: checkedIn(), now: at("13:00"), tasks: [task()] }));
  assert.ok(s.rail);
  assert.equal(s.rail.checkedInAt.toISOString(), iso("08:58"));
  assert.equal(s.rail.checkOutAt.toISOString(), iso("17:00"));
  assert.equal(s.rail.progress, 0.5);
  const late = nowState(input({ record: checkedIn({ status: "LATE" }), now: at("18:00"), tasks: [] }));
  assert.equal(late.rail?.progress, 1);
});

test("rule 7: retake beats overdue beats cleaning beats next", () => {
  const next = task({ id: 50, shiftStart: iso("09:30"), shiftEnd: iso("11:00"), areaNameSnapshot: "Lobby", title: "Mop and dust" });
  const cleaning = task({ id: 40, status: "IN_PROGRESS", areaNameSnapshot: "Kitchen" });
  const photos = task({ id: 41, status: "IN_PROGRESS", verificationState: "CAPTURING", areaNameSnapshot: "Pantry" });
  const overdue = task({ id: 30, status: "NOT_COMPLETED_INTIME", shiftEnd: iso("10:00"), areaNameSnapshot: "Stairs" });
  const retake = task({ id: 20, status: "IN_PROGRESS", verificationState: "REWORK_REQUIRED", areaNameSnapshot: "Toilets" });
  const done = task({ id: 10, status: "COMPLETED", areaNameSnapshot: "Done room" });
  const base = { record: checkedIn(), now: at("13:00") };

  const r = nowState(input({ ...base, tasks: [done, next, cleaning, overdue, retake] }));
  assert.equal(r.tone, "blue");
  assert.deepEqual(r.title, { key: "Retake a photo: {area}", values: { area: "Toilets" }, name: "Toilets" });
  assert.equal(r.sub.key, "One photo needs to be taken again.");
  assert.deepEqual(r.action, { kind: "retakePhoto", taskId: 20 });
  assert.ok(r.rail);

  const o = nowState(input({ ...base, tasks: [done, next, cleaning, overdue] }));
  assert.deepEqual(o.title, { key: "Overdue: {area}", values: { area: "Stairs" }, name: "Stairs" });
  assert.deepEqual(o.sub, { key: "This should have finished by {time}. Finish it now.", values: { time: "10:00 AM" } });
  assert.deepEqual(o.action, { kind: "takePhotos", taskId: 30 });

  const c = nowState(input({ ...base, tasks: [done, next, cleaning] }));
  assert.deepEqual(c.title, { key: "Cleaning: {area}", values: { area: "Kitchen" }, name: "Kitchen" });
  assert.equal(c.sub.key, "When it is clean, take the task photos.");
  assert.deepEqual(c.action, { kind: "takePhotos", taskId: 40 });

  const p = nowState(input({ ...base, tasks: [done, next, photos] }));
  assert.deepEqual(p.action, { kind: "takePhotos", taskId: 41 });

  const n = nowState(input({ ...base, tasks: [done, next] }));
  assert.deepEqual(n.title, { key: "Next: {area}", values: { area: "Lobby" }, name: "Lobby" });
  assert.deepEqual(n.sub, {
    key: "{title}. Finish by {time}.",
    values: { title: "Mop and dust", time: "11:00 AM" },
    name: "Mop and dust",
  });
  assert.deepEqual(n.action, { kind: "startCleaning", taskId: 50 });
  assert.equal(n.wait, null);
});

test("rule 7: next is the first not-started task by time", () => {
  const later = task({ id: 1, shiftStart: iso("14:00"), shiftEnd: iso("15:00"), areaNameSnapshot: "Later" });
  const sooner = task({ id: 2, shiftStart: iso("11:00"), shiftEnd: iso("12:00"), areaNameSnapshot: "Sooner" });
  const s = nowState(input({ record: checkedIn(), now: at("10:00"), tasks: [later, sooner] }));
  assert.deepEqual(s.action, { kind: "startCleaning", taskId: 2 });
  // Without an area snapshot the title is the area and is not said twice.
  const plain = nowState(input({ record: checkedIn(), now: at("10:00"), tasks: [task({ id: 9, areaNameSnapshot: undefined })] }));
  assert.deepEqual(plain.title, { key: "Next: {area}", values: { area: "Daily clean" }, name: "Daily clean" });
  assert.deepEqual(plain.sub, { key: "Finish by {time}.", values: { time: "11:00 AM" } });
});

test("rule 7: all submitted at 3:40 waits for check-out", () => {
  const s = nowState(input({ record: checkedIn(), now: at("15:40"), tasks: [task({ status: "COMPLETED" })] }));
  assert.equal(s.tone, "blue");
  assert.equal(s.title.key, "All work submitted");
  assert.equal(s.sub.key, "Manager review may still be needed.");
  assert.equal(s.action, null);
  assert.deepEqual(s.wait, { key: "Check-out opens at {time}", values: { time: "5:00 PM" } });
  assert.ok(s.rail);
});

test("rule 7: an empty feed says no tasks today", () => {
  const s = nowState(input({ record: checkedIn(), now: at("15:40"), tasks: [] }));
  assert.equal(s.title.key, "No tasks today");
  assert.equal(s.sub.key, "Your manager has not given you work for today.");
  assert.deepEqual(s.wait, { key: "Check-out opens at {time}", values: { time: "5:00 PM" } });
  assert.equal(s.action, null);
});

test("rule 7: 5:02 with no open work offers check-out", () => {
  const s = nowState(input({ record: checkedIn(), now: at("17:02"), tasks: [task({ status: "COMPLETED" }), task({ status: "MISSED" })] }));
  assert.equal(s.tone, "blue");
  assert.equal(s.title.key, "Time to check out");
  assert.equal(s.sub.key, "Take a fresh selfie to close your shift.");
  assert.deepEqual(s.action, { kind: "checkOut" });
  assert.equal(s.wait, null);
  assert.ok(s.rail);
});

test("rule 7: check-out waits for the minimum time after a late check-in", () => {
  const rec = checkedIn({ status: "LATE", checkInTime: iso("16:50") });
  const s = nowState(input({ record: rec, now: at("17:02"), tasks: [] }));
  assert.deepEqual(s.wait, { key: "Check-out opens at {time}", values: { time: "5:20 PM" } });
  assert.equal(s.rail?.checkOutAt.toISOString(), iso("17:20"));
  assert.deepEqual(nowState(input({ record: rec, now: at("17:20"), tasks: [] })).action, { kind: "checkOut" });
});

test("rule 7: photos unavailable while a task is in progress", () => {
  const s = nowState(
    input({ record: checkedIn(), now: at("13:00"), photosAvailable: false, tasks: [task({ id: 7, status: "IN_PROGRESS" })] }),
  );
  assert.equal(s.tone, "quiet");
  assert.equal(s.title.key, "Task photos are unavailable");
  assert.equal(s.sub.key, "Results already received are kept. Ask your manager what to do next.");
  assert.equal(s.action, null);
  assert.equal(s.wait, null);
  assert.ok(s.rail);
  // Starting a task needs no photos, so it is still offered.
  const next = nowState(input({ record: checkedIn(), now: at("10:00"), photosAvailable: false, tasks: [task({ id: 8 })] }));
  assert.deepEqual(next.action, { kind: "startCleaning", taskId: 8 });
});

test("rule 8: open work at check-out time keeps the task, not check-out", () => {
  const s = nowState(input({ record: checkedIn(), now: at("17:02"), tasks: [task({ id: 60, areaNameSnapshot: "Lobby" })] }));
  assert.equal(s.title.key, "Next: {area}");
  assert.deepEqual(s.action, { kind: "startCleaning", taskId: 60 });
  assert.equal(s.wait, null);
});

test("online does not change the decision", () => {
  const args = { record: checkedIn(), now: at("13:00"), tasks: [task({ id: 70 })] };
  assert.deepEqual(nowState(input({ ...args, online: false })), nowState(input({ ...args, online: true })));
});

test("nowState imports nothing from React or React Native", () => {
  const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "nowState.ts"), "utf8");
  assert.doesNotMatch(source, /from\s+["'](react|react-native)["']/);
  assert.doesNotMatch(source, /from\s+["']react-native[^"']*["']/);
});
