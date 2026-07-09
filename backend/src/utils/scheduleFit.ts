import { getZonedClockMinutes, getZonedDayRange } from "./dateTime.js";
import { readDayList, weekdayOfLocalDay, type WeekdayList } from "./workDays.js";

type ClockRange = readonly [start: number, end: number];

type ClockWindow = {
  shiftStart: Date;
  shiftEnd: Date;
};

export type ScheduleWindow = ClockWindow & {
  recurringType: "DAILY" | "ONCE";
  effectiveDate: Date;
  recurringEndDate?: Date | null;
  repeatDays?: WeekdayList | null;
};

export function getClockRanges(start: Date, end: Date, timeZone: string): ClockRange[] {
  const startMinute = getZonedClockMinutes(start, timeZone);
  const endMinute = getZonedClockMinutes(end, timeZone);

  return endMinute > startMinute
    ? [[startMinute, endMinute]]
    : [[startMinute, 1440], [0, endMinute]];
}

export function fitsStaffShift(
  task: ClockWindow,
  staff: { shiftStart?: Date | null; shiftEnd?: Date | null },
  timeZone: string,
): boolean {
  if (!staff.shiftStart || !staff.shiftEnd) return false;

  const shiftRanges = getClockRanges(staff.shiftStart, staff.shiftEnd, timeZone);
  return getClockRanges(task.shiftStart, task.shiftEnd, timeZone).every(([start, end]) =>
    shiftRanges.some(([shiftStart, shiftEnd]) => start >= shiftStart && end <= shiftEnd),
  );
}

function getScheduleDays(schedule: ScheduleWindow, timeZone: string) {
  const { start, end } = getZonedDayRange(schedule.effectiveDate, timeZone);
  if (schedule.recurringType === "ONCE") {
    return { start, end, weekdays: [weekdayOfLocalDay(start, timeZone)] };
  }

  return {
    start,
    end: schedule.recurringEndDate ? getZonedDayRange(schedule.recurringEndDate, timeZone).end : null,
    weekdays: readDayList(schedule.repeatDays),
  };
}

export function schedulesOverlap(first: ScheduleWindow, second: ScheduleWindow, timeZone: string): boolean {
  const secondRanges = getClockRanges(second.shiftStart, second.shiftEnd, timeZone);
  const clocksOverlap = getClockRanges(first.shiftStart, first.shiftEnd, timeZone).some(([start, end]) =>
    secondRanges.some(([otherStart, otherEnd]) => start < otherEnd && otherStart < end),
  );
  if (!clocksOverlap) return false;

  const firstDays = getScheduleDays(first, timeZone);
  const secondDays = getScheduleDays(second, timeZone);
  if (firstDays.end && secondDays.start >= firstDays.end) return false;
  if (secondDays.end && firstDays.start >= secondDays.end) return false;

  return firstDays.weekdays.some((day) => secondDays.weekdays.includes(day));
}

/** Searches the caller's already-filtered list of other active schedules for this worker. */
export function findOverlappingSchedule<T extends ScheduleWindow>(
  candidate: ScheduleWindow,
  schedules: readonly T[],
  timeZone: string,
): T | undefined {
  return schedules.find((schedule) => schedulesOverlap(candidate, schedule, timeZone));
}
