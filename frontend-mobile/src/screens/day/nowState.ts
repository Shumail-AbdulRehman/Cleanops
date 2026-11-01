// The My day decision: one sentence, its tone, the shift line and the single
// next action. Pure; no React or React Native. Every attendance window comes
// from `utils/attendance.ts`; the old `buildAttendanceViewModel` in
// `HomeScreen.tsx` is the reference for the edge cases kept here.
import type { AttendanceRecord, TaskInstance } from "../../types";
import {
  getCheckInOpenAt,
  getLateDeadline,
  getRecommendedCheckoutAt,
  hasOpenCheckout,
} from "../../utils/attendance";
import { clock, localDate, type FormatLanguage } from "../../design/format";
import { compareByStart, taskDisplay, type TaskDisplayKind } from "../../design/taskState";
import { translate } from "../../i18n/translations";

export type NowTone = "blue" | "quiet" | "bad" | "ok";

/**
 * A sentence for `t()`: `key` is the English key and `values` fill its
 * placeholders (times already formatted). `name` repeats the entered name
 * (area, task title or place) held in `values`, so the screen can isolate it
 * and, in Urdu, put it on its own line. Titles name the area as `{area}`.
 */
export type NowText = {
  key: string;
  values: Record<string, string>;
  name?: string;
};

export type NowRail = {
  checkedInAt: Date;
  checkOutAt: Date;
  /** Share of the shift elapsed, 0 to 1. */
  progress: number;
};

export type NowActionKind =
  | "checkIn"
  | "checkInLate"
  | "checkOut"
  | "completeCheckOut"
  | "startCleaning"
  | "takePhotos"
  | "retakePhoto"
  | "retry";

export type NowAction = { kind: NowActionKind; taskId?: number };

export type NowState = {
  tone: NowTone;
  title: NowText;
  sub: NowText;
  rail: NowRail | null;
  action: NowAction | null;
  /** The dock's static status while there is no action yet. */
  wait: { key: string; values: Record<string, string> } | null;
};

export type NowTask = Pick<TaskInstance, "id" | "title" | "status" | "shiftStart" | "shiftEnd"> &
  Partial<Pick<TaskInstance, "verificationState" | "completionOutcome" | "areaNameSnapshot" | "location">>;

export type NowInput = {
  hasLocation: boolean;
  /** The result of `getRelevantAttendanceRecord`. */
  record: AttendanceRecord | null;
  /** Today's task feed. */
  tasks: readonly NowTask[];
  now: Date;
  /** Does not change the decision; the screen swaps the action for the offline status. */
  online: boolean;
  /** Today's data could not load. */
  failed: boolean;
  /** False when task photos cannot be taken (the server says photo capture is off). */
  photosAvailable: boolean;
  /** IANA zone for times; defaults to the device zone. A task's own location zone wins for its times. */
  timeZone?: string;
  offToday?: boolean;
  nextShiftStart?: string | null;
  language?: FormatLanguage;
};

const text = (key: string, values: Record<string, string> = {}, name?: string): NowText =>
  name === undefined ? { key, values } : { key, values, name };

const state = (
  tone: NowTone,
  title: NowText,
  sub: NowText,
  extra: Partial<Pick<NowState, "rail" | "action" | "wait">> = {},
): NowState => ({ tone, title, sub, rail: null, action: null, wait: null, ...extra });

const ms = (value: string | Date) => new Date(value).getTime();

/** Share of the shift elapsed at `now`, clamped to 0..1. */
const shiftProgress = (record: AttendanceRecord, now: Date) => {
  const start = ms(record.expectedStart);
  const span = ms(record.expectedEnd) - start;
  if (!(span > 0)) return now.getTime() >= start ? 1 : 0;
  return Math.min(1, Math.max(0, (now.getTime() - start) / span));
};

const areaOf = (task: NowTask) => task.areaNameSnapshot?.trim() || task.title;

/** First open task of a kind, in day order. */
const firstOf = (tasks: readonly NowTask[], kinds: readonly TaskDisplayKind[]) =>
  [...tasks].sort(compareByStart).find((task) => kinds.includes(taskDisplay(task)));

/** Kinds whose next step is taking task photos. */
const PHOTO_KINDS: readonly TaskDisplayKind[] = ["retake", "overdue", "inProgress", "photosNeeded"];

function checkedInState(record: AttendanceRecord, input: NowInput): NowState {
  const { tasks, now, photosAvailable, timeZone } = input;
  const checkOutAt = getRecommendedCheckoutAt(record);
  const rail: NowRail = {
    checkedInAt: new Date(record.checkInTime ?? record.expectedStart),
    checkOutAt,
    progress: shiftProgress(record, now),
  };
  const on = (tone: NowTone, title: NowText, sub: NowText, extra: Partial<NowState> = {}) =>
    state(tone, title, sub, { rail, ...extra });
  const zoneOf = (task: NowTask) => task.location?.timezone || timeZone;

  if (!photosAvailable && firstOf(tasks, PHOTO_KINDS)) {
    return on(
      "quiet",
      text("Task photos are unavailable"),
      text("Results already received are kept. Ask your manager what to do next."),
    );
  }

  let task = firstOf(tasks, ["retake"]);
  if (task) {
    const area = areaOf(task);
    return on("blue", text("Retake a photo: {area}", { area }, area), text("One photo needs to be taken again."), {
      action: { kind: "retakePhoto", taskId: task.id },
    });
  }

  task = firstOf(tasks, ["overdue"]);
  if (task) {
    const area = areaOf(task);
    return on(
      "blue",
      text("Overdue: {area}", { area }, area),
      text("This should have finished by {time}. Finish it now.", { time: clock(task.shiftEnd, zoneOf(task)) }),
      { action: { kind: "takePhotos", taskId: task.id } },
    );
  }

  task = firstOf(tasks, ["inProgress", "photosNeeded"]);
  if (task) {
    const area = areaOf(task);
    return on("blue", text("Cleaning: {area}", { area }, area), text("When it is clean, take the task photos."), {
      action: { kind: "takePhotos", taskId: task.id },
    });
  }

  task = firstOf(tasks, ["notStarted"]);
  if (task) {
    const area = areaOf(task);
    const time = clock(task.shiftEnd, zoneOf(task));
    // Without an area snapshot the area is the title; do not say it twice.
    const sub =
      area === task.title
        ? text("Finish by {time}.", { time })
        : text("{title}. Finish by {time}.", { title: task.title, time }, task.title);
    return on("blue", text("Next: {area}", { area }, area), sub, {
      action: { kind: "startCleaning", taskId: task.id },
    });
  }

  if (now.getTime() >= checkOutAt.getTime()) {
    return on("blue", text("Time to check out"), text("Take a fresh selfie to close your shift."), {
      action: { kind: "checkOut" },
    });
  }

  const wait = { key: "Check-out opens at {time}", values: { time: clock(checkOutAt, timeZone) } };
  if (tasks.length === 0) {
    return on("blue", text("No tasks today"), text("Your manager has not given you work for today."), { wait });
  }
  return on("blue", text("All work submitted"), text("Manager review may still be needed."), { wait });
}

function absentState(record: AttendanceRecord, now: Date, timeZone?: string): NowState {
  const at = now.getTime();
  const openAt = getCheckInOpenAt(record);
  const start = clock(record.expectedStart, timeZone);
  const end = clock(record.expectedEnd, timeZone);
  const place = record.location?.name?.trim();

  if (at < openAt.getTime()) {
    return state(
      "blue",
      text("Check-in opens at {time}", { time: clock(openAt, timeZone) }),
      place
        ? text("Your shift starts at {time} at {place}.", { time: start, place }, place)
        : text("Your shift starts at {time}.", { time: start }),
    );
  }

  if (at > ms(record.expectedEnd)) {
    return state(
      "quiet",
      text("Shift time closed"),
      text("This shift ended at {time} without a check-in. If this is wrong, tell your manager.", { time: end }),
    );
  }

  if (at > getLateDeadline(record).getTime()) {
    return state(
      "blue",
      text("You are late. Check in now."),
      text("Shift started at {time}. This check-in will be marked late.", { time: start }),
      { action: { kind: "checkInLate" } },
    );
  }

  return state(
    "blue",
    text("Check in to start your shift"),
    place
      ? text("Take a selfie at {place}. Keep location on.", { place }, place)
      : text("Take a selfie at your location. Keep location on."),
    { action: { kind: "checkIn" } },
  );
}

const noShift = () =>
  state(
    "quiet",
    text("No shift loaded for today"),
    text("Pull down to refresh. If it is still missing, ask your manager."),
  );

const DAY_KEYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const localCalendarDay = (instant: string | Date, timeZone?: string) =>
  new Date(`${localDate(instant, timeZone)}T00:00:00Z`);
const getDayKey = (localDay: Date) => DAY_KEYS[localDay.getUTCDay()];

function dayOffState({ now, nextShiftStart, timeZone, language = "en" }: NowInput): NowState {
  const title = text("Day off today");
  if (!nextShiftStart) return state("quiet", title, text("Ask your manager if you should be working today."));

  const nextDayInZone = localCalendarDay(nextShiftStart, timeZone);
  const tomorrowInZone = localCalendarDay(now, timeZone);
  tomorrowInZone.setUTCDate(tomorrowInZone.getUTCDate() + 1);
  const key = nextDayInZone.getTime() === tomorrowInZone.getTime() ? "tomorrow" : getDayKey(nextDayInZone);
  return state("quiet", title, text("Your next shift is {day} at {time}.", {
    day: translate(key, language),
    time: clock(nextShiftStart, timeZone),
  }));
}

/** Decide My day's sentence and next step. First matching rule wins. */
export function nowState(input: NowInput): NowState {
  const { hasLocation, record, now, failed, timeZone } = input;

  if (failed) {
    return state("quiet", text("Today could not load"), text("Check your internet and try again."), {
      action: { kind: "retry" },
    });
  }
  if (!hasLocation) {
    return state("quiet", text("No location assigned"), text("Ask your manager to give you a location and shift."));
  }
  if (!record) return input.offToday === true ? dayOffState(input) : noShift();

  if (record.checkOutTime || record.status === "CHECKED_OUT") {
    return state(
      "ok",
      text("Shift finished"),
      text("In {in}. Out {out}. Thank you.", {
        in: record.checkInTime ? clock(record.checkInTime, timeZone) : "—",
        out: clock(record.checkOutTime ?? record.expectedEnd, timeZone),
      }),
    );
  }

  if (record.status === "ABSENT") return absentState(record, now, timeZone);

  if (record.status === "MISSED_CHECKOUT") {
    return state(
      "bad",
      text("Check-out is overdue"),
      text("Your shift ended at {time}. This late check-out stays on your record.", {
        time: clock(record.expectedEnd, timeZone),
      }),
      { action: { kind: "completeCheckOut" } },
    );
  }

  if (hasOpenCheckout(record)) return checkedInState(record, input);

  // Not reachable for the statuses the server sends today.
  return noShift();
}
