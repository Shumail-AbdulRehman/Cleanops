// Defensive parsers for the Part 2 staff responses (ARCHITECTURE.md#api).
// Each takes the envelope's `data` value. A body that is not an object, or
// lacks a page-level field, gives null so the screen shows its error state.
// A malformed list item is dropped and counted in `dropped`. Unknown fields
// (for example image fields) are never copied. Absent nullable fields become
// null; a nullable field that is present with the wrong type is malformed.
import type { Weekday } from '../queries/profile';
import {
  ATTENDANCE_DAY_STATES,
  REVIEW_STATES,
  TASK_HISTORY_STATUSES,
  type AttendanceMonth,
  type AttendanceMonthCounts,
  type AttendanceMonthRecord,
  type HistoryRange,
  type NamedLocation,
  type ProfileMonthFigures,
  type ProfileSummary,
  type TaskHistoryCounts,
  type TaskHistoryItem,
  type TaskHistoryPage,
} from './types';

export type ParsedTaskHistoryPage = TaskHistoryPage & { dropped: number };
export type ParsedAttendanceMonth = AttendanceMonth & { dropped: number };

type Data = Record<string, unknown>;

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const DATE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const CLOCK = /^([01]\d|2[0-3]):[0-5]\d$/;
const WEEKDAYS = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'] as const satisfies readonly Weekday[];

const isObject = (value: unknown): value is Data =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const text = (value: unknown): string | undefined =>
  typeof value === 'string' && value.length > 0 ? value : undefined;

const month = (value: unknown): string | undefined =>
  typeof value === 'string' && MONTH.test(value) ? value : undefined;

const date = (value: unknown): string | undefined =>
  typeof value === 'string' && DATE.test(value) ? value : undefined;

const instant = (value: unknown): string | undefined =>
  typeof value === 'string' && value.length > 0 && !Number.isNaN(Date.parse(value)) ? value : undefined;

const clock = (value: unknown): string | undefined =>
  typeof value === 'string' && CLOCK.test(value) ? value : undefined;

const id = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : undefined;

const count = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : undefined;

const oneOf = <T extends string>(allowed: readonly T[], value: unknown): T | undefined =>
  typeof value === 'string' && (allowed as readonly string[]).includes(value) ? (value as T) : undefined;

// Absent or null gives null; otherwise the parsed value, or undefined when malformed.
const nullable = <T>(value: unknown, parse: (value: unknown) => T | undefined): T | null | undefined =>
  value === null || value === undefined ? null : parse(value);

const has = (...values: unknown[]) => values.every((value) => value !== undefined);

const range = (value: unknown): HistoryRange | undefined => {
  if (!isObject(value)) return undefined;
  const earliestMonth = month(value.earliestMonth);
  const latestMonth = month(value.latestMonth);
  if (earliestMonth === undefined || latestMonth === undefined) return undefined;
  return { earliestMonth, latestMonth };
};

const namedLocation = (value: unknown): NamedLocation | undefined => {
  if (!isObject(value)) return undefined;
  const locationId = id(value.id);
  const name = text(value.name);
  if (locationId === undefined || name === undefined) return undefined;
  return { id: locationId, name };
};

// Parses every entry of a list, keeping the good ones and counting the rest.
const parseList = <T>(values: unknown[], parse: (value: unknown) => T | null) => {
  const items: T[] = [];
  for (const value of values) {
    const item = parse(value);
    if (item !== null) items.push(item);
  }
  return { items, dropped: values.length - items.length };
};

const taskCounts = (value: unknown): TaskHistoryCounts | undefined => {
  if (!isObject(value)) return undefined;
  const verified = count(value.verified);
  const waiting = count(value.waiting);
  const missed = count(value.missed);
  const total = count(value.total);
  if (verified === undefined || waiting === undefined || missed === undefined || total === undefined) return undefined;
  return { verified, waiting, missed, total };
};

const photoCounts = (value: unknown): TaskHistoryItem['photos'] | undefined => {
  if (!isObject(value)) return undefined;
  const received = count(value.received);
  const required = count(value.required);
  if (received === undefined || required === undefined) return undefined;
  return { received, required };
};

export function parseTaskHistoryItem(value: unknown): TaskHistoryItem | null {
  if (!isObject(value)) return null;
  const item = {
    id: id(value.id),
    areaName: text(value.areaName),
    title: text(value.title),
    date: date(value.date),
    shiftStart: instant(value.shiftStart),
    shiftEnd: instant(value.shiftEnd),
    timezone: text(value.timezone),
    status: oneOf(TASK_HISTORY_STATUSES, value.status),
    reviewState: oneOf(REVIEW_STATES, value.reviewState),
    startedAt: nullable(value.startedAt, instant),
    submittedAt: nullable(value.submittedAt, instant),
    photos: photoCounts(value.photos),
    location: namedLocation(value.location),
  };
  return has(...Object.values(item)) ? (item as TaskHistoryItem) : null;
}

export function parseTaskHistoryPage(value: unknown): ParsedTaskHistoryPage | null {
  if (!isObject(value) || !Array.isArray(value.items)) return null;
  const pageMonth = month(value.month);
  const timezone = text(value.timezone);
  const pageRange = range(value.range);
  const counts = taskCounts(value.counts);
  const nextCursor = nullable(value.nextCursor, text);
  if (pageMonth === undefined || timezone === undefined || pageRange === undefined) return null;
  if (counts === undefined || nextCursor === undefined) return null;
  const { items, dropped } = parseList(value.items, parseTaskHistoryItem);
  return { month: pageMonth, timezone, range: pageRange, counts, items, nextCursor, dropped };
}

const attendanceCounts = (value: unknown): AttendanceMonthCounts | undefined => {
  if (!isObject(value)) return undefined;
  const onTime = count(value.onTime);
  const late = count(value.late);
  const absent = count(value.absent);
  const missedCheckout = count(value.missedCheckout);
  if (onTime === undefined || late === undefined || absent === undefined || missedCheckout === undefined) return undefined;
  return { onTime, late, absent, missedCheckout };
};

export function parseAttendanceMonthRecord(value: unknown): AttendanceMonthRecord | null {
  if (!isObject(value)) return null;
  const record = {
    id: id(value.id),
    date: date(value.date),
    expectedStart: instant(value.expectedStart),
    expectedEnd: instant(value.expectedEnd),
    checkInTime: nullable(value.checkInTime, instant),
    checkOutTime: nullable(value.checkOutTime, instant),
    lateMinutes: nullable(value.lateMinutes, count),
    location: namedLocation(value.location),
    state: oneOf(ATTENDANCE_DAY_STATES, value.state),
  };
  return has(...Object.values(record)) ? (record as AttendanceMonthRecord) : null;
}

export function parseAttendanceMonth(value: unknown): ParsedAttendanceMonth | null {
  if (!isObject(value) || !Array.isArray(value.records)) return null;
  const pageMonth = month(value.month);
  const timezone = text(value.timezone);
  const pageRange = range(value.range);
  const counts = attendanceCounts(value.counts);
  if (pageMonth === undefined || timezone === undefined || pageRange === undefined || counts === undefined) return null;
  const { items: records, dropped } = parseList(value.records, parseAttendanceMonthRecord);
  return { month: pageMonth, timezone, range: pageRange, counts, records, dropped };
}

const profileMonth = (value: unknown): ProfileMonthFigures | undefined => {
  if (!isObject(value)) return undefined;
  const figures = {
    month: month(value.month),
    shiftsScheduled: count(value.shiftsScheduled),
    shiftsAttended: count(value.shiftsAttended),
    onTime: count(value.onTime),
    tasksAssigned: count(value.tasksAssigned),
    tasksSubmitted: count(value.tasksSubmitted),
  };
  return has(...Object.values(figures)) ? (figures as ProfileMonthFigures) : undefined;
};

const profileLocation = (value: unknown): ProfileSummary['location'] | undefined => {
  if (!isObject(value)) return undefined;
  const location = {
    id: id(value.id),
    name: text(value.name),
    address: typeof value.address === 'string' ? value.address : undefined,
    timezone: text(value.timezone),
  };
  return has(...Object.values(location)) ? (location as NonNullable<ProfileSummary['location']>) : undefined;
};

const usualShift = (value: unknown) => {
  if (!isObject(value)) return undefined;
  const start = clock(value.start);
  const end = clock(value.end);
  if (start === undefined || end === undefined) return undefined;
  const shift = { start, end };
  const rawDays = value.days;
  if (!Array.isArray(rawDays) || rawDays.length === 0) return shift;
  const days = WEEKDAYS.filter(day => rawDays.includes(day));
  return days.length === rawDays.length ? { ...shift, days } : shift;
};

const company = (value: unknown): ProfileSummary['company'] | undefined => {
  if (!isObject(value)) return undefined;
  const name = text(value.name);
  return name === undefined ? undefined : { name };
};

const manager = (value: unknown): ProfileSummary['manager'] | undefined => {
  if (!isObject(value)) return undefined;
  const name = text(value.name);
  return name === undefined ? undefined : { name };
};

export function parseProfileSummary(value: unknown): ProfileSummary | null {
  if (!isObject(value)) return null;
  const summary = {
    id: id(value.id),
    name: text(value.name),
    email: value.email === null ? null : text(value.email),
    phone: nullable(value.phone, (phone) => (typeof phone === 'string' ? phone : undefined)),
    joinedAt: instant(value.joinedAt),
    company: company(value.company),
    location: nullable(value.location, profileLocation),
    usualShift: nullable(value.usualShift, usualShift),
    manager: nullable(value.manager, manager),
    month: profileMonth(value.month),
  };
  return has(...Object.values(summary)) ? (summary as ProfileSummary) : null;
}
