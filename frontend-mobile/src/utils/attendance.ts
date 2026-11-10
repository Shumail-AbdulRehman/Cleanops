import type { AttendanceRecord, AttendanceStatus } from "../types";

const MINUTE_MS = 60 * 1000;
const KARACHI_OFFSET_MS = 5 * 60 * 60 * 1000;

// Mirrors the current backend attendance controller.
export const EARLY_CHECKIN_MINUTES = 30;
export const LATE_CHECKIN_GRACE_MINUTES = 15;
export const MIN_CHECKOUT_MINUTES = 30;

const OPEN_CHECKOUT_STATUSES = new Set<AttendanceStatus>([
  "CHECKED_IN",
  "LATE",
  "MISSED_CHECKOUT",
]);

const parseTime = (value: string) => new Date(value).getTime();

const getStartOfKarachiDay = (date: Date) => {
  const shifted = new Date(date.getTime() + KARACHI_OFFSET_MS);

  return new Date(
    Date.UTC(
      shifted.getUTCFullYear(),
      shifted.getUTCMonth(),
      shifted.getUTCDate(),
      0,
      0,
      0,
      0
    ) - KARACHI_OFFSET_MS
  );
};

const getKarachiDayRange = (date: Date) => {
  const start = getStartOfKarachiDay(date);
  return {
    start,
    end: new Date(start.getTime() + 24 * 60 * 60 * 1000),
  };
};

export const getCheckInOpenAt = (record: AttendanceRecord) =>
  new Date(parseTime(record.expectedStart) - EARLY_CHECKIN_MINUTES * MINUTE_MS);

export const getLateDeadline = (record: AttendanceRecord) =>
  new Date(parseTime(record.expectedStart) + LATE_CHECKIN_GRACE_MINUTES * MINUTE_MS);

export const getMinimumCheckoutAt = (record: AttendanceRecord) => {
  if (!record.checkInTime) {
    return null;
  }

  return new Date(parseTime(record.checkInTime) + MIN_CHECKOUT_MINUTES * MINUTE_MS);
};

export const getRecommendedCheckoutAt = (record: AttendanceRecord) => {
  const minimumCheckoutAt = getMinimumCheckoutAt(record);
  const shiftEnd = new Date(record.expectedEnd);

  if (!minimumCheckoutAt) {
    return shiftEnd;
  }

  return minimumCheckoutAt.getTime() > shiftEnd.getTime() ? minimumCheckoutAt : shiftEnd;
};

export const getRelevantAttendanceRecord = (
  records: AttendanceRecord[],
  now: Date = new Date()
) => {
  if (!records.length) {
    return null;
  }

  const openCheckoutRecord = [...records]
    .filter((record) => !record.checkOutTime && OPEN_CHECKOUT_STATUSES.has(record.status))
    .sort((left, right) => parseTime(right.expectedEnd) - parseTime(left.expectedEnd))[0];

  if (openCheckoutRecord) {
    return openCheckoutRecord;
  }

  const currentOrUpcomingShift = [...records]
    .filter((record) => record.status === "ABSENT" && parseTime(record.expectedEnd) >= now.getTime())
    .sort(
      (left, right) =>
        Math.abs(parseTime(left.expectedStart) - now.getTime()) -
        Math.abs(parseTime(right.expectedStart) - now.getTime())
    )[0];

  if (currentOrUpcomingShift) {
    return currentOrUpcomingShift;
  }

  const { start, end } = getKarachiDayRange(now);
  const todayRecord = [...records]
    .filter((record) => {
      const recordDate = parseTime(record.date);
      return recordDate >= start.getTime() && recordDate < end.getTime();
    })
    .sort((left, right) => parseTime(right.expectedEnd) - parseTime(left.expectedEnd))[0];

  if (todayRecord) {
    return todayRecord;
  }

  return null;
};

export const canCheckInNow = (record: AttendanceRecord, now: Date = new Date()) => {
  if (record.status !== "ABSENT") {
    return false;
  }

  const opensAt = getCheckInOpenAt(record).getTime();
  const endsAt = parseTime(record.expectedEnd);

  return now.getTime() >= opensAt && now.getTime() <= endsAt;
};

export const hasOpenCheckout = (record: AttendanceRecord) =>
  !record.checkOutTime && OPEN_CHECKOUT_STATUSES.has(record.status);
