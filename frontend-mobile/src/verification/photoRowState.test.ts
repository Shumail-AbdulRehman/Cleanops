import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { checkedPhotoState } from "./policy";
import { nextPhotoAction, photoRow, photoSummary, type PhotoRowKind } from "./photoRowState";

type Expected = [state: string, kind: PhotoRowKind, label: string, tone: string, icon: string | null, done: boolean, needsYou: boolean];

const table: Expected[] = [
  ["SAVED", "sending", "Saved, uploading", "blue", "spinner", false, false],
  ["UPLOADING", "sending", "Saved, uploading", "blue", "spinner", false, false],
  ["RETRY_WAIT", "uploadAgain", "Upload again", "red", "cloudUpload", false, true],
  ["AUTH_REQUIRED", "uploadAgain", "Upload again", "red", "cloudUpload", false, true],
  ["BLOCKED", "uploadAgain", "Upload again", "red", "cloudUpload", false, true],
  ["SERVER_ACCEPTED", "checking", "Uploaded, checking", "blue", "hourglass", false, false],
  ["PROCESSING", "checking", "Uploaded, checking", "blue", "hourglass", false, false],
  ["PASSED", "uploaded", "Uploaded", "green", "tick", true, false],
  ["MANAGER_ACCEPTED", "uploaded", "Uploaded", "green", "tick", true, false],
  ["WAIVED", "notNeeded", "Not needed", "neutral", "minus", true, false],
  ["REVIEW_REQUIRED", "review", "Waiting for review", "blue", "hourglass", true, false],
  ["PRIVACY_HOLD", "review", "Waiting for review", "blue", "hourglass", true, false],
  ["SERVICE_FAILURE", "review", "Waiting for review", "blue", "hourglass", true, false],
  ["RECAPTURE_REQUIRED", "retake", "Retake photo", "needsYou", "camera", false, true],
  ["CLEANING_REQUIRED", "clean", "Needs cleaning", "needsYou", "droplet", false, true],
  ["MISSING", "needed", "Photo needed", "neutral", null, false, false],
  ["AVAILABLE", "needed", "Photo needed", "neutral", null, false, false],
  ["SOMETHING_NEW", "needed", "Photo needed", "neutral", null, false, false],
  ["", "needed", "Photo needed", "neutral", null, false, false],
  ["toString", "needed", "Photo needed", "neutral", null, false, false],
];

const queueStates = ["SAVED", "UPLOADING", "RETRY_WAIT", "AUTH_REQUIRED", "BLOCKED", "SERVER_ACCEPTED", "PROCESSING", "FINAL"];
const serverStates = [
  "MISSING", "AVAILABLE", "PROCESSING", "PASSED", "MANAGER_ACCEPTED", "WAIVED", "RECAPTURE_REQUIRED",
  "CLEANING_REQUIRED", "REVIEW_REQUIRED", "PRIVACY_HOLD", "SERVICE_FAILURE",
];

test("every state maps to its kind, label, tone, icon, done and needs-you", () => {
  for (const [state, kind, label, tone, icon, done, needsYou] of table) {
    const row = photoRow(state);
    assert.deepEqual(
      { kind: row.kind, label: row.label, tone: row.tone, icon: row.icon, done: row.done, needsYou: row.needsYou },
      { kind, label, tone, icon, done, needsYou },
      state,
    );
    assert.equal(row.spinning, kind === "sending", `${state} spinning`);
  }
});

test("no queue state reads as uploaded or done", () => {
  for (const state of queueStates) {
    const row = photoRow(state);
    assert.notEqual(row.kind, "uploaded", state);
    assert.notEqual(row.label, "Uploaded", state);
    assert.equal(row.done, false, state);
  }
});

test("done agrees with checkedPhotoState for every server state", () => {
  for (const state of serverStates) assert.equal(photoRow(state).done, checkedPhotoState(state), state);
});

test("a photo check failure waits for review, is done and never reads as dirty", () => {
  const row = photoRow("SERVICE_FAILURE");
  assert.equal(row.kind, "review");
  assert.equal(row.done, true);
  assert.equal(row.needsYou, false);
  assert.notEqual(row.label, "Needs cleaning");
  assert.notEqual(row.icon, "droplet");
});

test("rows are frozen", () => {
  assert.ok(Object.isFrozen(photoRow("PASSED")));
});

const photos = (...states: string[]) => states.map((state) => ({ state }));

test("photoSummary counts done, needs-you, sending and checking", () => {
  assert.deepEqual(
    photoSummary(photos("PASSED", "WAIVED", "SERVICE_FAILURE", "SAVED", "UPLOADING", "PROCESSING", "RECAPTURE_REQUIRED", "RETRY_WAIT", "MISSING")),
    { total: 9, done: 3, needsYou: 2, sending: 2, checking: 1 },
  );
  assert.deepEqual(photoSummary([]), { total: 0, done: 0, needsYou: 0, sending: 0, checking: 0 });
});

test("nextPhotoAction submits only when every photo is done", () => {
  assert.deepEqual(nextPhotoAction(photos("PASSED", "WAIVED", "REVIEW_REQUIRED", "SERVICE_FAILURE")), { action: "submit", index: null });
  assert.notEqual(nextPhotoAction(photos("PASSED", "MISSING")).action, "submit");
  assert.notEqual(nextPhotoAction(photos("PASSED", "SAVED")).action, "submit");
  assert.notEqual(nextPhotoAction(photos("PASSED", "PROCESSING")).action, "submit");
  assert.deepEqual(nextPhotoAction([]), { action: "next", index: null });
});

test("nextPhotoAction waits when the only open photos are sending or checking", () => {
  assert.deepEqual(nextPhotoAction(photos("PASSED", "UPLOADING", "PROCESSING")), { action: "waitUpload", index: 1 });
  assert.deepEqual(nextPhotoAction(photos("SERVER_ACCEPTED")), { action: "waitUpload", index: 0 });
  assert.deepEqual(nextPhotoAction(photos("SAVED", "MISSING")), { action: "next", index: 1 });
});

test("nextPhotoAction targets the clean, retake and upload rows in that order", () => {
  assert.deepEqual(nextPhotoAction(photos("PASSED", "CLEANING_REQUIRED", "MISSING")), { action: "clean", index: 1 });
  assert.deepEqual(nextPhotoAction(photos("PASSED", "RECAPTURE_REQUIRED", "CLEANING_REQUIRED")), { action: "clean", index: 2 });
  assert.deepEqual(nextPhotoAction(photos("PASSED", "MISSING", "RECAPTURE_REQUIRED")), { action: "retake", index: 2 });
  assert.deepEqual(nextPhotoAction(photos("RETRY_WAIT", "RECAPTURE_REQUIRED")), { action: "retake", index: 1 });
  assert.deepEqual(nextPhotoAction(photos("PASSED", "BLOCKED", "MISSING")), { action: "uploadAgain", index: 1 });
  assert.deepEqual(nextPhotoAction(photos("PASSED", "UPLOADING", "AVAILABLE", "MISSING")), { action: "next", index: 2 });
});

test("the module imports nothing from React or React Native", () => {
  const source = readFileSync(fileURLToPath(new URL("./photoRowState.ts", import.meta.url).href), "utf8");
  assert.doesNotMatch(source, /from\s+["']react(-native)?["']/);
  assert.doesNotMatch(source, /from\s+["'](react|react-native|expo)[^"']*["']/);
});
