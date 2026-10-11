import type { TaskInstance } from "../types";

/**
 * How a task looks everywhere in the staff app: marker, pill, group and
 * whether it needs the person. Pure; no React or React Native.
 */
export type TaskDisplayKind =
  | "notStarted"
  | "inProgress"
  | "photosNeeded"
  | "retake"
  | "overdue"
  | "submitted"
  | "waitingForReview"
  | "verified"
  | "acceptedWithExceptions"
  | "missed"
  | "cancelled";

/** History item status from the Part 2 contract (ARCHITECTURE.md#api). */
export type HistoryItemStatus =
  | "MISSED"
  | "VERIFIED"
  | "ACCEPTED_WITH_EXCEPTIONS"
  | "WAITING_FOR_REVIEW"
  | "SUBMITTED";

export type PillTone = "neutral" | "blue" | "green" | "needsYou" | "needsYouSoft" | "red";

export type MarkerShape = "position" | "droplet" | "camera" | "clock" | "tick" | "doubleTick" | "cross";

/** Marker fill, as a colour token name from `tokens.ts`. */
export type MarkerTone = "canvas" | "blueWash" | "yellow" | "blue" | "ok" | "badWash";

export type TaskDisplay = {
  readonly kind: TaskDisplayKind;
  /** English key for `t()`, or null when no pill is shown. */
  readonly pillLabel: string | null;
  readonly pillTone: PillTone;
  readonly marker: MarkerShape;
  readonly markerTone: MarkerTone;
  readonly needsYou: boolean;
  readonly open: boolean;
  /** English key for screen readers when there is no pill, else null. */
  readonly hiddenLabel: string | null;
};

export type FeedTask = Pick<TaskInstance, "status" | "verificationState" | "completionOutcome">;
export type OrderedTask = Pick<TaskInstance, "id" | "shiftStart">;
export type GroupableTask = FeedTask & OrderedTask;

/** Kind of a task from today's feed. The feed never says verified. */
export function taskDisplay(task: FeedTask): TaskDisplayKind {
  if (task.status === "CANCELLED") return "cancelled";
  if (task.status === "MISSED") return "missed";
  if (task.status === "COMPLETED" || task.completionOutcome) return "submitted";
  if (task.status === "NOT_COMPLETED_INTIME") return "overdue";
  if (task.verificationState === "REWORK_REQUIRED") return "retake";
  if (task.status === "IN_PROGRESS") {
    if (task.verificationState === "CAPTURING" || task.verificationState === "PROCESSING") return "photosNeeded";
    return "inProgress";
  }
  return "notStarted";
}

const historyKinds: Readonly<Record<HistoryItemStatus, TaskDisplayKind>> = Object.freeze({
  MISSED: "missed",
  VERIFIED: "verified",
  ACCEPTED_WITH_EXCEPTIONS: "acceptedWithExceptions",
  WAITING_FOR_REVIEW: "waitingForReview",
  SUBMITTED: "submitted",
});

/** Kind of a History item. */
export function historyDisplay(status: HistoryItemStatus): TaskDisplayKind {
  return historyKinds[status];
}

function entry(
  kind: TaskDisplayKind,
  pillLabel: string | null,
  pillTone: PillTone,
  marker: MarkerShape,
  markerTone: MarkerTone,
  needsYou: boolean,
  open: boolean,
): TaskDisplay {
  return Object.freeze({
    kind,
    pillLabel,
    pillTone,
    marker,
    markerTone,
    needsYou,
    open,
    hiddenLabel: pillLabel === null ? "Not started" : null,
  });
}

const displays: Readonly<Record<TaskDisplayKind, TaskDisplay>> = Object.freeze({
  notStarted: entry("notStarted", null, "neutral", "position", "canvas", false, true),
  inProgress: entry("inProgress", "In progress", "blue", "droplet", "blueWash", false, true),
  photosNeeded: entry("photosNeeded", "Photos needed", "needsYouSoft", "camera", "yellow", true, true),
  retake: entry("retake", "Retake photo", "needsYou", "camera", "yellow", true, true),
  overdue: entry("overdue", "Overdue", "needsYou", "clock", "yellow", true, true),
  submitted: entry("submitted", "Submitted", "blue", "tick", "blue", false, false),
  waitingForReview: entry("waitingForReview", "Waiting for review", "blue", "tick", "blue", false, false),
  verified: entry("verified", "Verified", "green", "doubleTick", "ok", false, false),
  acceptedWithExceptions: entry("acceptedWithExceptions", "Accepted with exceptions", "green", "tick", "ok", false, false),
  missed: entry("missed", "Missed", "red", "cross", "badWash", false, false),
  cancelled: entry("cancelled", "Cancelled", "neutral", "cross", "canvas", false, false),
});

/** Marker, pill and flags for a kind. */
export function displayFor(kind: TaskDisplayKind): TaskDisplay {
  return displays[kind];
}

function startTime(task: OrderedTask): number {
  const time = Date.parse(task.shiftStart);
  return Number.isNaN(time) ? Number.POSITIVE_INFINITY : time;
}

/** Day order: `shiftStart`, then `id`, so equal start times stay stable. */
export function compareByStart(a: OrderedTask, b: OrderedTask): number {
  const byTime = startTime(a) - startTime(b);
  if (byTime !== 0 && !Number.isNaN(byTime)) return byTime;
  return a.id - b.id;
}

export type TodayGroups<T> = { needsYou: T[]; toDo: T[]; done: T[] };

/** Tasks screen groups, each ordered by start time. */
export function groupTodayTasks<T extends GroupableTask>(tasks: readonly T[]): TodayGroups<T> {
  const groups: TodayGroups<T> = { needsYou: [], toDo: [], done: [] };
  for (const task of [...tasks].sort(compareByStart)) {
    const kind = taskDisplay(task);
    if (kind === "inProgress" || displays[kind].needsYou) groups.needsYou.push(task);
    else if (kind === "notStarted") groups.toDo.push(task);
    else groups.done.push(task);
  }
  return groups;
}

/** 1-based position of `task` in the day ordered by `shiftStart` then `id`. */
export function position(task: OrderedTask, tasks: readonly OrderedTask[]): number {
  let before = 0;
  for (const other of tasks) {
    if (other.id !== task.id && compareByStart(other, task) < 0) before += 1;
  }
  return before + 1;
}
