import type { PillTone } from "../design/taskState";
import { checkedPhotoState } from "./policy";

/**
 * How one required photo looks in the redesigned photo list, and what the
 * dock asks for next. Pure; no React or React Native.
 *
 * The input `state` is the one `photoStatuses()` (presentation.ts) chose: a
 * local queue state while the upload is still ours, otherwise the server's
 * requirement state. A queue state never maps to "Uploaded", and only
 * server states that `checkedPhotoState` accepts count as done.
 */
export type PhotoRowKind =
  | "sending"
  | "uploadAgain"
  | "checking"
  | "uploaded"
  | "notNeeded"
  | "review"
  | "retake"
  | "clean"
  | "needed";

/** Icon names map to lucide: spinner LoaderCircle, cloudUpload CloudUpload, hourglass Hourglass, tick Check, minus Minus, camera Camera, droplet Droplet. */
export type PhotoRowIcon = "spinner" | "cloudUpload" | "hourglass" | "tick" | "minus" | "camera" | "droplet";

export type PhotoRowTone = Extract<PillTone, "neutral" | "blue" | "green" | "needsYou" | "red">;

export type PhotoRow = {
  readonly kind: PhotoRowKind;
  /** English key; render through `t()`. */
  readonly label: string;
  readonly tone: PhotoRowTone;
  readonly icon: PhotoRowIcon | null;
  readonly done: boolean;
  readonly needsYou: boolean;
  /** The icon turns (reduced motion permitting) while the photo is sending. */
  readonly spinning: boolean;
};

type RowLook = Omit<PhotoRow, "kind" | "done">;

const looks: Readonly<Record<PhotoRowKind, RowLook>> = {
  sending: { label: "Saved, uploading", tone: "blue", icon: "spinner", needsYou: false, spinning: true },
  uploadAgain: { label: "Upload again", tone: "red", icon: "cloudUpload", needsYou: true, spinning: false },
  checking: { label: "Uploaded, checking", tone: "blue", icon: "hourglass", needsYou: false, spinning: false },
  uploaded: { label: "Uploaded", tone: "green", icon: "tick", needsYou: false, spinning: false },
  notNeeded: { label: "Not needed", tone: "neutral", icon: "minus", needsYou: false, spinning: false },
  review: { label: "Waiting for review", tone: "blue", icon: "hourglass", needsYou: false, spinning: false },
  retake: { label: "Retake photo", tone: "needsYou", icon: "camera", needsYou: true, spinning: false },
  clean: { label: "Needs cleaning", tone: "needsYou", icon: "droplet", needsYou: true, spinning: false },
  needed: { label: "Photo needed", tone: "neutral", icon: null, needsYou: false, spinning: false },
};

const kindByState: Readonly<Record<string, PhotoRowKind>> = {
  SAVED: "sending",
  UPLOADING: "sending",
  RETRY_WAIT: "uploadAgain",
  AUTH_REQUIRED: "uploadAgain",
  BLOCKED: "uploadAgain",
  SERVER_ACCEPTED: "checking",
  PROCESSING: "checking",
  PASSED: "uploaded",
  MANAGER_ACCEPTED: "uploaded",
  WAIVED: "notNeeded",
  REVIEW_REQUIRED: "review",
  PRIVACY_HOLD: "review",
  SERVICE_FAILURE: "review",
  RECAPTURE_REQUIRED: "retake",
  CLEANING_REQUIRED: "clean",
};

/** Row look for a photo state. `MISSING`, `AVAILABLE` and unknown states read "Photo needed". */
export function photoRow(state: string): PhotoRow {
  const kind = Object.prototype.hasOwnProperty.call(kindByState, state) ? kindByState[state] : "needed";
  // Done comes from the shared policy, never from this file's own list.
  const done = kind !== "needed" && checkedPhotoState(state);
  return Object.freeze({ kind, ...looks[kind], done });
}

export type PhotoSummary = {
  readonly total: number;
  readonly done: number;
  readonly needsYou: number;
  readonly sending: number;
  readonly checking: number;
};

type StatedPhoto = { readonly state: string };

/** Counts for the header ("{n} of {t} photos done") and the dock. Takes `photoStatuses()` entries. */
export function photoSummary(photos: readonly StatedPhoto[]): PhotoSummary {
  let done = 0;
  let needsYou = 0;
  let sending = 0;
  let checking = 0;
  for (const photo of photos) {
    const row = photoRow(photo.state);
    if (row.done) done += 1;
    if (row.needsYou) needsYou += 1;
    if (row.kind === "sending") sending += 1;
    if (row.kind === "checking") checking += 1;
  }
  return { total: photos.length, done, needsYou, sending, checking };
}

export type PhotoAction = "submit" | "waitUpload" | "clean" | "retake" | "uploadAgain" | "next";

export type NextPhotoAction = {
  readonly action: PhotoAction;
  /** Index into the input of the row the action is about; null for `submit` and for an empty list. */
  readonly index: number | null;
};

/**
 * What the dock offers next. Submit only when there is at least one photo
 * and every one is done (the server still decides). Cleaning wins over a
 * retake, a retake over an upload, as the current screen does; otherwise the
 * first photo still needed.
 */
export function nextPhotoAction(photos: readonly StatedPhoto[]): NextPhotoAction {
  const rows = photos.map((photo) => photoRow(photo.state));
  if (rows.length === 0) return { action: "next", index: null };
  const open = rows.map((row, index) => ({ row, index })).filter(({ row }) => !row.done);
  if (open.length === 0) return { action: "submit", index: null };
  if (open.every(({ row }) => row.kind === "sending" || row.kind === "checking")) {
    return { action: "waitUpload", index: open[0].index };
  }
  const firstOf = (kind: PhotoRowKind) => open.find(({ row }) => row.kind === kind);
  const clean = firstOf("clean");
  if (clean) return { action: "clean", index: clean.index };
  const retake = firstOf("retake");
  if (retake) return { action: "retake", index: retake.index };
  const uploadAgain = firstOf("uploadAgain");
  if (uploadAgain) return { action: "uploadAgain", index: uploadAgain.index };
  const needed = firstOf("needed");
  return { action: "next", index: needed ? needed.index : open[0].index };
}
