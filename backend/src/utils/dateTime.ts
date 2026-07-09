// Date/time helpers.
//
// Storage convention: every DateTime in the database is a real UTC instant.
// Wall-clock meaning comes from the owning Location's IANA timezone
// (e.g. "Asia/Karachi"): a shift of 09:00 at a Karachi location is stored as
// 04:00Z, and day anchors ("date" columns) are the start of the location's
// local day expressed as a UTC instant (19:00Z previous day for Karachi).
//
// The zoned helpers below implement that convention; the plain UTC helpers are
// kept for call sites that genuinely operate in UTC.

import { formatInTimeZone, fromZonedTime } from "date-fns-tz";

export const DEFAULT_TIME_ZONE = "UTC";

export const isValidTimeZone = (timeZone: string) => {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return true;
  } catch {
    return false;
  }
};

/** Wall-clock minutes (0-1439) of an instant read in the given timezone. */
export const getZonedClockMinutes = (date: Date, timeZone: string) => {
  const [hours, minutes] = formatInTimeZone(date, timeZone, "HH:mm").split(":").map(Number);
  return hours * 60 + minutes;
};

const DATE_INPUT_REGEX = /^(\d{4})-(\d{2})-(\d{2})$/;

const isValidDateInput = (value: string) => {
  const match = DATE_INPUT_REGEX.exec(value);
  if (!match) return null;

  const year = Number(match[1]);
  const monthIndex = Number(match[2]) - 1;
  const day = Number(match[3]);
  if (monthIndex < 0 || monthIndex > 11 || day < 1 || day > 31) return null;

  const probe = new Date(Date.UTC(year, monthIndex, day));
  if (
    probe.getUTCFullYear() !== year ||
    probe.getUTCMonth() !== monthIndex ||
    probe.getUTCDate() !== day
  ) {
    return null;
  }

  return { year, monthIndex, day };
};

const toDateInput = (year: number, monthIndex: number, day: number) =>
  `${String(year).padStart(4, "0")}-${String(monthIndex + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;

const nextDateInput = (year: number, monthIndex: number, day: number) => {
  const next = new Date(Date.UTC(year, monthIndex, day + 1));
  return toDateInput(next.getUTCFullYear(), next.getUTCMonth(), next.getUTCDate());
};

/** UTC instants bounding the local day described by a YYYY-MM-DD input in the given timezone. */
export const getZonedDayRangeFromDateInput = (value: string, timeZone: string) => {
  const parts = isValidDateInput(value);
  if (!parts) return null;

  const start = fromZonedTime(`${value}T00:00:00`, timeZone);
  const end = fromZonedTime(`${nextDateInput(parts.year, parts.monthIndex, parts.day)}T00:00:00`, timeZone);
  return { start, end };
};

/** UTC instants bounding the local day that contains `date` in the given timezone. */
export const getZonedDayRange = (date: Date = new Date(), timeZone: string = DEFAULT_TIME_ZONE) => {
  const localDate = formatInTimeZone(date, timeZone, "yyyy-MM-dd");
  return getZonedDayRangeFromDateInput(localDate, timeZone)!;
};

/** UTC instants bounding a calendar month in the given timezone. monthIndex is 0-based. */
export const getZonedMonthRange = (year: number, monthIndex: number, timeZone: string) => {
  if (monthIndex < 0 || monthIndex > 11) return null;

  const start = fromZonedTime(`${toDateInput(year, monthIndex, 1)}T00:00:00`, timeZone);
  const endYear = monthIndex === 11 ? year + 1 : year;
  const endMonthIndex = monthIndex === 11 ? 0 : monthIndex + 1;
  const end = fromZonedTime(`${toDateInput(endYear, endMonthIndex, 1)}T00:00:00`, timeZone);
  return { start, end };
};

/**
 * Places the wall clock of `timeSource` (read in `timeZone`) onto the local day
 * of `localDayStart` (a day anchor produced by getZonedDayRange), returning the
 * corresponding UTC instant.
 */
export const withZonedClockOnLocalDay = (localDayStart: Date, timeSource: Date, timeZone: string) => {
  const localDate = formatInTimeZone(localDayStart, timeZone, "yyyy-MM-dd");
  const wallClock = formatInTimeZone(timeSource, timeZone, "HH:mm:ss");
  return fromZonedTime(`${localDate}T${wallClock}`, timeZone);
};

/**
 * Resolves the attendance window for one local day: the operational date anchor
 * (local-day start as a UTC instant) plus the expected start/end instants,
 * handling overnight shifts by rolling the end into the next local day.
 */
export const resolveZonedAttendanceWindow = ({
  baseDate,
  shiftStart,
  shiftEnd,
  timeZone,
}: {
  baseDate: Date;
  shiftStart: Date;
  shiftEnd: Date;
  timeZone: string;
}) => {
  const dayStart = getZonedDayRange(baseDate, timeZone)!.start;
  const expectedStart = withZonedClockOnLocalDay(dayStart, shiftStart, timeZone);
  let expectedEnd = withZonedClockOnLocalDay(dayStart, shiftEnd, timeZone);

  if (expectedEnd <= expectedStart) {
    const localDate = formatInTimeZone(dayStart, timeZone, "yyyy-MM-dd");
    const parts = isValidDateInput(localDate)!;
    const nextDay = nextDateInput(parts.year, parts.monthIndex, parts.day);
    const wallClock = formatInTimeZone(shiftEnd, timeZone, "HH:mm:ss");
    expectedEnd = fromZonedTime(`${nextDay}T${wallClock}`, timeZone);
  }

  return {
    date: dayStart,
    expectedStart,
    expectedEnd,
  };
};

export const addUtcDays = (date: Date, days: number) => {
  const result = new Date(date);
  result.setUTCDate(result.getUTCDate() + days);
  return result;
};

export const getStartOfUtcDay = (date: Date) => {
  return new Date(
    Date.UTC(
      date.getUTCFullYear(),
      date.getUTCMonth(),
      date.getUTCDate(),
      0,
      0,
      0,
      0,
    ),
  );
};

export const getUtcDayRange = (date: Date = new Date()) => {
  const start = getStartOfUtcDay(date);
  return {
    start,
    end: addUtcDays(start, 1),
  };
};

export const getUtcDayRangeFromDateInput = (value: string) => {
  const parts = isValidDateInput(value);
  if (!parts) return null;

  const start = new Date(Date.UTC(parts.year, parts.monthIndex, parts.day, 0, 0, 0, 0));

  return {
    start,
    end: addUtcDays(start, 1),
  };
};

export const getUtcMonthRange = (year: number, monthIndex: number) => {
  if (monthIndex < 0 || monthIndex > 11) {
    return null;
  }

  const start = new Date(Date.UTC(year, monthIndex, 1, 0, 0, 0, 0));
  const end = new Date(
    Date.UTC(
      monthIndex === 11 ? year + 1 : year,
      monthIndex === 11 ? 0 : monthIndex + 1,
      1,
      0,
      0,
      0,
      0,
    ),
  );

  return { start, end };
};

export const getUtcClockMinutes = (date: Date) =>
  date.getUTCHours() * 60 + date.getUTCMinutes();

export const withUtcClockOnBaseDate = (baseDate: Date, timeSource: Date) => {
  return new Date(
    Date.UTC(
      baseDate.getUTCFullYear(),
      baseDate.getUTCMonth(),
      baseDate.getUTCDate(),
      timeSource.getUTCHours(),
      timeSource.getUTCMinutes(),
      timeSource.getUTCSeconds(),
      0,
    ),
  );
};

export const resolveAttendanceWindow = ({
  baseDate,
  shiftStart,
  shiftEnd,
}: {
  baseDate: Date;
  shiftStart: Date;
  shiftEnd: Date;
}) => {
  const expectedStart = withUtcClockOnBaseDate(baseDate, shiftStart);
  const expectedEnd = withUtcClockOnBaseDate(baseDate, shiftEnd);

  if (expectedEnd <= expectedStart) {
    expectedEnd.setUTCDate(expectedEnd.getUTCDate() + 1);
  }

  return {
    date: new Date(baseDate),
    expectedStart,
    expectedEnd,
  };
};

export const getStartOfStoredUtcDateAsUtcDay = (date: Date) =>
  new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 0, 0, 0, 0),
  );
