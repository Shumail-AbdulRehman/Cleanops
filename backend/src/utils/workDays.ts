import { formatInTimeZone } from "date-fns-tz";
import { z } from "zod";
import {
  getZonedClockMinutes,
  getZonedDayRange,
  resolveZonedAttendanceWindow,
} from "./dateTime.js";

export const WEEKDAYS = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"] as const;
export type Weekday = (typeof WEEKDAYS)[number];
export type WeekdayList = readonly Weekday[];

type OptionalDays = WeekdayList | null | undefined;

export const normalizeDays = (days: WeekdayList): Weekday[] =>
  WEEKDAYS.filter((day) => days.includes(day));

export const isAllSevenDays = (days: WeekdayList): boolean =>
  WEEKDAYS.every((day) => days.includes(day));

export const readDayList = (days?: OptionalDays): Weekday[] =>
  days?.length ? normalizeDays(days) : [...WEEKDAYS];

const weekdayArray = z.array(z.enum(WEEKDAYS)).min(1);

const dayListSchema = (code: string, message: string) =>
  z.unknown().transform((value, ctx) => {
    const parsed = weekdayArray.safeParse(value);
    if (parsed.success) return normalizeDays(parsed.data);
    ctx.addIssue({ code: "custom", message, params: { code } });
    return z.NEVER;
  });

export const workDaysSchema = dayListSchema("INVALID_WORK_DAYS", "Choose at least one work day.");
export const repeatDaysSchema = dayListSchema("INVALID_REPEAT_DAYS", "Choose at least one day for this schedule.");

export const weekdayOfLocalDay = (localDayStart: Date, timeZone: string): Weekday => {
  const isoWeekday = Number(formatInTimeZone(localDayStart, timeZone, "i"));
  return WEEKDAYS[isoWeekday - 1]!;
};

export const isWorkDay = (workDays: OptionalDays, localDayStart: Date, timeZone: string): boolean =>
  readDayList(workDays).includes(weekdayOfLocalDay(localDayStart, timeZone));

type CoveringShiftInput = {
  shiftStart: Date;
  shiftEnd: Date;
  instant: Date;
  timeZone: string;
};

export const coveringShiftDay = ({
  shiftStart,
  shiftEnd,
  instant,
  timeZone,
}: CoveringShiftInput): Date => {
  const today = getZonedDayRange(instant, timeZone);
  const startMinutes = getZonedClockMinutes(shiftStart, timeZone);
  const endMinutes = getZonedClockMinutes(shiftEnd, timeZone);
  if (endMinutes < startMinutes && getZonedClockMinutes(instant, timeZone) < endMinutes) {
    return getZonedDayRange(new Date(today.start.getTime() - 1), timeZone).start;
  }
  return today.start;
};

export const worksCoveringShift = (input: CoveringShiftInput & { workDays?: OptionalDays }): boolean =>
  isWorkDay(input.workDays, coveringShiftDay(input), input.timeZone);

type Schedule = {
  isActive: boolean;
  recurringType: "DAILY" | "ONCE";
  effectiveDate: Date;
  recurringEndDate?: Date | null;
  repeatDays?: OptionalDays;
};

export const matchesScheduleWeekday = (
  schedule: Pick<Schedule, "recurringType" | "repeatDays">,
  localDayStart: Date,
  timeZone: string,
): boolean =>
  schedule.recurringType === "ONCE" ||
  readDayList(schedule.repeatDays).includes(weekdayOfLocalDay(localDayStart, timeZone));

export const scheduleOccursOnDay = (
  schedule: Schedule,
  day: ReturnType<typeof getZonedDayRange>,
  timeZone: string,
): boolean => {
  if (!schedule.isActive) return false;
  if (schedule.recurringType === "ONCE") {
    return schedule.effectiveDate >= day.start && schedule.effectiveDate < day.end;
  }
  if (schedule.effectiveDate > day.end) return false;
  if (schedule.recurringEndDate && schedule.recurringEndDate < day.start) return false;
  return matchesScheduleWeekday(schedule, day.start, timeZone);
};

export const isDaySubset = (days: OptionalDays, availableDays: OptionalDays): boolean => {
  const available = readDayList(availableDays);
  return readDayList(days).every((day) => available.includes(day));
};

export const removedDays = (previousDays: OptionalDays, nextDays: OptionalDays): Weekday[] => {
  const next = readDayList(nextDays);
  return readDayList(previousDays).filter((day) => !next.includes(day));
};

export const nextWorkShiftStart = ({
  shiftStart,
  shiftEnd,
  workDays,
  timeZone,
  now,
}: {
  shiftStart?: Date | null;
  shiftEnd?: Date | null;
  workDays?: OptionalDays;
  timeZone?: string | null;
  now: Date;
}): Date | null => {
  if (!timeZone || !shiftStart || !shiftEnd) return null;

  let day = getZonedDayRange(now, timeZone);
  for (let daysAhead = 0; daysAhead <= 7; daysAhead += 1) {
    if (isWorkDay(workDays, day.start, timeZone)) {
      const { expectedStart } = resolveZonedAttendanceWindow({
        baseDate: day.start,
        shiftStart,
        shiftEnd,
        timeZone,
      });
      if (expectedStart > now) return expectedStart;
    }
    day = getZonedDayRange(day.end, timeZone);
  }
  return null;
};

export const formatWeekdays = (days: OptionalDays): string =>
  readDayList(days).map((day) => day[0] + day.slice(1).toLowerCase()).join(", ");
