import { test } from "node:test";
import assert from "node:assert/strict";
import {
  compareByStart,
  displayFor,
  groupTodayTasks,
  historyDisplay,
  position,
  taskDisplay,
  type GroupableTask,
  type HistoryItemStatus,
  type TaskDisplayKind,
} from "./taskState";

const allKinds: TaskDisplayKind[] = [
  "notStarted",
  "inProgress",
  "photosNeeded",
  "retake",
  "overdue",
  "submitted",
  "waitingForReview",
  "verified",
  "acceptedWithExceptions",
  "missed",
  "cancelled",
];

test("feed rule 1: cancelled wins over everything", () => {
  assert.equal(taskDisplay({ status: "CANCELLED" }), "cancelled");
  assert.equal(taskDisplay({ status: "CANCELLED", completionOutcome: "VERIFIED_COMPLETE", verificationState: "REWORK_REQUIRED" }), "cancelled");
});

test("feed rule 2: missed", () => {
  assert.equal(taskDisplay({ status: "MISSED" }), "missed");
  assert.equal(taskDisplay({ status: "MISSED", verificationState: "REWORK_REQUIRED" }), "missed");
});

test("feed rule 3: completed or any completion outcome is submitted, never verified", () => {
  assert.equal(taskDisplay({ status: "COMPLETED" }), "submitted");
  assert.equal(taskDisplay({ status: "COMPLETED", verificationState: "NEEDS_REVIEW" }), "submitted");
  for (const completionOutcome of ["VERIFIED_COMPLETE", "COMPLETED_WITH_EXCEPTIONS", "LEGACY_RECORDED"]) {
    assert.equal(taskDisplay({ status: "IN_PROGRESS", completionOutcome }), "submitted");
    assert.equal(taskDisplay({ status: "COMPLETED", completionOutcome, verificationState: "VERIFIED" }), "submitted");
  }
  assert.equal(taskDisplay({ status: "NOT_COMPLETED_INTIME", completionOutcome: "VERIFIED_COMPLETE" }), "submitted");
  assert.equal(taskDisplay({ status: "PENDING", completionOutcome: null }), "notStarted");
});

test("feed rule 4: overdue stays overdue whatever the verification state", () => {
  assert.equal(taskDisplay({ status: "NOT_COMPLETED_INTIME" }), "overdue");
  for (const verificationState of ["REWORK_REQUIRED", "PROCESSING", "NEEDS_REVIEW", "CAPTURING"]) {
    assert.equal(taskDisplay({ status: "NOT_COMPLETED_INTIME", verificationState }), "overdue");
  }
});

test("feed rule 5: rework required is retake", () => {
  assert.equal(taskDisplay({ status: "IN_PROGRESS", verificationState: "REWORK_REQUIRED" }), "retake");
});

test("feed rule 6: in progress while capturing or processing is photos needed", () => {
  assert.equal(taskDisplay({ status: "IN_PROGRESS", verificationState: "CAPTURING" }), "photosNeeded");
  assert.equal(taskDisplay({ status: "IN_PROGRESS", verificationState: "PROCESSING" }), "photosNeeded");
});

test("feed rule 7: other in-progress work is in progress", () => {
  assert.equal(taskDisplay({ status: "IN_PROGRESS" }), "inProgress");
  assert.equal(taskDisplay({ status: "IN_PROGRESS", verificationState: "NOT_STARTED" }), "inProgress");
  assert.equal(taskDisplay({ status: "IN_PROGRESS", verificationState: "NEEDS_REVIEW" }), "inProgress");
});

test("feed rule 8: pending is not started", () => {
  assert.equal(taskDisplay({ status: "PENDING" }), "notStarted");
  assert.equal(taskDisplay({ status: "PENDING", verificationState: "NOT_STARTED" }), "notStarted");
  assert.equal(taskDisplay({ status: "PENDING", verificationState: "CAPTURING" }), "notStarted");
});

test("each History status maps to its kind", () => {
  const expected: Record<HistoryItemStatus, TaskDisplayKind> = {
    MISSED: "missed",
    VERIFIED: "verified",
    ACCEPTED_WITH_EXCEPTIONS: "acceptedWithExceptions",
    WAITING_FOR_REVIEW: "waitingForReview",
    SUBMITTED: "submitted",
  };
  for (const [status, kind] of Object.entries(expected)) {
    assert.equal(historyDisplay(status as HistoryItemStatus), kind);
  }
});

test("pill words, tones and markers match the design system", () => {
  const expected: Record<TaskDisplayKind, [string | null, string, string, string]> = {
    notStarted: [null, "neutral", "position", "canvas"],
    inProgress: ["In progress", "blue", "droplet", "blueWash"],
    photosNeeded: ["Photos needed", "needsYouSoft", "camera", "yellow"],
    retake: ["Retake photo", "needsYou", "camera", "yellow"],
    overdue: ["Overdue", "needsYou", "clock", "yellow"],
    submitted: ["Submitted", "blue", "tick", "blue"],
    waitingForReview: ["Waiting for review", "blue", "tick", "blue"],
    verified: ["Verified", "green", "doubleTick", "ok"],
    acceptedWithExceptions: ["Accepted with exceptions", "green", "tick", "ok"],
    missed: ["Missed", "red", "cross", "badWash"],
    cancelled: ["Cancelled", "neutral", "cross", "canvas"],
  };
  for (const kind of allKinds) {
    const display = displayFor(kind);
    const [pillLabel, pillTone, marker, markerTone] = expected[kind];
    assert.equal(display.kind, kind);
    assert.equal(display.pillLabel, pillLabel, kind);
    assert.equal(display.pillTone, pillTone, kind);
    assert.equal(display.marker, marker, kind);
    assert.equal(display.markerTone, markerTone, kind);
  }
});

test("needsYou is true only for photos needed, retake and overdue", () => {
  const needing = allKinds.filter((kind) => displayFor(kind).needsYou);
  assert.deepEqual(needing, ["photosNeeded", "retake", "overdue"]);
});

test("open covers exactly the unfinished kinds", () => {
  const open = allKinds.filter((kind) => displayFor(kind).open);
  assert.deepEqual(open, ["notStarted", "inProgress", "photosNeeded", "retake", "overdue"]);
});

test("hidden label only when there is no pill", () => {
  assert.equal(displayFor("notStarted").hiddenLabel, "Not started");
  for (const kind of allKinds.filter((k) => k !== "notStarted")) {
    assert.equal(displayFor(kind).pillLabel === null, false, kind);
    assert.equal(displayFor(kind).hiddenLabel, null, kind);
  }
});

test("display entries are frozen", () => {
  assert.ok(Object.isFrozen(displayFor("verified")));
});

const at = (hhmm: string) => `2026-11-11T${hhmm}:00.000Z`;
const task = (id: number, start: string, status: GroupableTask["status"], verificationState?: string, completionOutcome?: string | null): GroupableTask => ({
  id,
  shiftStart: at(start),
  status,
  verificationState,
  completionOutcome,
});

test("groupTodayTasks orders by time and puts in-progress work under needs you", () => {
  const tasks = [
    task(1, "15:00", "PENDING"),
    task(2, "09:00", "COMPLETED"),
    task(3, "13:00", "IN_PROGRESS"),
    task(4, "11:00", "NOT_COMPLETED_INTIME", "PROCESSING"),
    task(5, "08:00", "PENDING"),
    task(6, "12:00", "IN_PROGRESS", "REWORK_REQUIRED"),
    task(7, "07:00", "MISSED"),
    task(8, "10:00", "IN_PROGRESS", "CAPTURING"),
    task(9, "06:00", "CANCELLED"),
    task(10, "05:00", "IN_PROGRESS", undefined, "VERIFIED_COMPLETE"),
  ];
  const groups = groupTodayTasks(tasks);
  assert.deepEqual(groups.needsYou.map((t) => t.id), [8, 4, 6, 3]);
  assert.deepEqual(groups.toDo.map((t) => t.id), [5, 1]);
  assert.deepEqual(groups.done.map((t) => t.id), [10, 9, 7, 2]);
  assert.equal(tasks[0].id, 1, "input is not reordered");
});

test("groupTodayTasks returns empty groups for an empty day", () => {
  assert.deepEqual(groupTodayTasks([]), { needsYou: [], toDo: [], done: [] });
});

test("groupTodayTasks breaks equal start times by id", () => {
  const groups = groupTodayTasks([task(30, "09:00", "PENDING"), task(10, "09:00", "PENDING"), task(20, "09:00", "PENDING")]);
  assert.deepEqual(groups.toDo.map((t) => t.id), [10, 20, 30]);
});

test("ordering compares instants, not strings", () => {
  const early = { id: 2, shiftStart: "2026-11-11T09:00:00+05:00" }; // 04:00Z
  const late = { id: 1, shiftStart: "2026-11-11T05:00:00.000Z" };
  assert.ok(compareByStart(early, late) < 0);
});

test("position is 1-based by start time and stable when two tasks share a start time", () => {
  const tasks = [
    { id: 9, shiftStart: at("11:00") },
    { id: 4, shiftStart: at("09:00") },
    { id: 2, shiftStart: at("09:00") },
    { id: 7, shiftStart: at("08:00") },
  ];
  assert.equal(position(tasks[3], tasks), 1);
  assert.equal(position(tasks[2], tasks), 2);
  assert.equal(position(tasks[1], tasks), 3);
  assert.equal(position(tasks[0], tasks), 4);
  const reversed = [...tasks].reverse();
  for (const t of tasks) assert.equal(position(t, reversed), position(t, tasks));
  assert.deepEqual(tasks.map((t) => position(t, tasks)).sort(), [1, 2, 3, 4]);
});

test("position of a task missing from the list is where it would fall", () => {
  const tasks = [{ id: 1, shiftStart: at("08:00") }, { id: 2, shiftStart: at("12:00") }];
  assert.equal(position({ id: 3, shiftStart: at("10:00") }, tasks), 2);
});
