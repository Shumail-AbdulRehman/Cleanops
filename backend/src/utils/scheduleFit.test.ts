import { fromZonedTime } from "date-fns-tz";
import { describe, expect, it } from "vitest";
import {
  findOverlappingSchedule,
  fitsStaffShift,
  getClockRanges,
  schedulesOverlap,
  type ScheduleWindow,
} from "./scheduleFit.js";

const timeZone = "Asia/Karachi";
const localDateTime = (value: string) => fromZonedTime(value, timeZone);
const clock = (time: string) => localDateTime(`1970-01-01T${time}`);
const window = (start: string, end: string) => ({ shiftStart: clock(start), shiftEnd: clock(end) });
const daily = (overrides: Partial<ScheduleWindow> = {}): ScheduleWindow => ({
  ...window("10:00", "12:00"),
  recurringType: "DAILY",
  effectiveDate: localDateTime("2026-11-16T00:00"),
  ...overrides,
});

describe("getClockRanges", () => {
  it("reads stored times as location wall clocks", () => {
    expect(getClockRanges(clock("09:00"), clock("17:00"), timeZone)).toEqual([[540, 1020]]);
  });

  it("splits an overnight window at midnight", () => {
    expect(getClockRanges(clock("23:00"), clock("02:00"), timeZone)).toEqual([[1380, 1440], [0, 120]]);
  });
});

describe("fitsStaffShift", () => {
  it.each([
    ["16:00", "10:00", "09:00", "17:00", false],
    ["10:00", "12:00", "09:00", "17:00", true],
    ["23:00", "02:00", "22:00", "06:00", true],
    ["22:00", "06:00", "22:00", "06:00", true],
    ["01:00", "06:01", "22:00", "06:00", false],
  ])("task %s–%s in staff shift %s–%s fits: %s", (taskStart, taskEnd, staffStart, staffEnd, expected) => {
    expect(fitsStaffShift(window(taskStart, taskEnd), window(staffStart, staffEnd), timeZone)).toBe(expected);
  });

  it("requires both staff shift times", () => {
    const task = window("10:00", "12:00");

    expect(fitsStaffShift(task, {}, timeZone)).toBe(false);
    expect(fitsStaffShift(task, { shiftStart: clock("09:00"), shiftEnd: null }, timeZone)).toBe(false);
    expect(fitsStaffShift(task, { shiftStart: null, shiftEnd: clock("17:00") }, timeZone)).toBe(false);
  });
});

describe("schedulesOverlap", () => {
  it("finds a clash for two daily 10:00–12:00 schedules", () => {
    expect(schedulesOverlap(daily(), daily(), timeZone)).toBe(true);
  });

  it("does not clash with disjoint repeat weekdays", () => {
    expect(schedulesOverlap(daily({ repeatDays: ["MON"] }), daily({ repeatDays: ["TUE"] }), timeZone)).toBe(false);
  });

  it("uses the work-day defaults for missing and empty legacy repeat days", () => {
    const sunday = daily({ repeatDays: ["SUN"] });

    expect(schedulesOverlap(daily({ repeatDays: null }), sunday, timeZone)).toBe(true);
    expect(schedulesOverlap(daily({ repeatDays: [] }), sunday, timeZone)).toBe(true);
  });

  it("includes the end day when a Monday one-off meets a Monday repeat", () => {
    const monday = daily({
      recurringType: "ONCE",
      effectiveDate: localDateTime("2026-11-23T00:00"),
      repeatDays: ["TUE"],
    });
    const weekly = daily({ repeatDays: ["MON"], recurringEndDate: localDateTime("2026-11-23T00:00") });

    expect(schedulesOverlap(monday, weekly, timeZone)).toBe(true);
    expect(schedulesOverlap(monday, daily({ ...weekly, recurringEndDate: localDateTime("2026-11-16T00:00") }), timeZone)).toBe(false);
    expect(schedulesOverlap(monday, daily({ ...weekly, repeatDays: ["TUE"] }), timeZone)).toBe(false);
  });

  it("compares date bounds by local calendar day", () => {
    const first = daily({ recurringEndDate: localDateTime("2026-11-23T00:00") });
    const second = daily({ effectiveDate: localDateTime("2026-11-23T23:00") });

    expect(schedulesOverlap(first, second, timeZone)).toBe(true);
    expect(schedulesOverlap(second, first, timeZone)).toBe(true);
  });

  it("keeps an open-ended daily schedule eligible on later matching days", () => {
    const first = daily({ repeatDays: ["MON"], recurringEndDate: null });
    const second = daily({ recurringType: "ONCE", effectiveDate: localDateTime("2027-01-04T00:00") });

    expect(schedulesOverlap(first, second, timeZone)).toBe(true);
  });

  it("limits a one-off to its own local date even if another shares its weekday", () => {
    const first = daily({ recurringType: "ONCE", recurringEndDate: localDateTime("2026-11-30T00:00") });
    const sameDay = { ...first, effectiveDate: localDateTime("2026-11-16T23:00") };
    const nextMonday = { ...first, effectiveDate: localDateTime("2026-11-23T00:00") };

    expect(schedulesOverlap(first, sameDay, timeZone)).toBe(true);
    expect(schedulesOverlap(first, nextMonday, timeZone)).toBe(false);
  });

  it("detects overlap on either side of midnight", () => {
    const overnight = daily(window("22:00", "02:00"));

    expect(schedulesOverlap(overnight, daily(window("23:00", "01:00")), timeZone)).toBe(true);
    expect(schedulesOverlap(overnight, daily(window("01:00", "03:00")), timeZone)).toBe(true);
  });

  it("allows touching clock windows", () => {
    expect(schedulesOverlap(daily(window("09:00", "10:00")), daily(window("10:00", "11:00")), timeZone)).toBe(false);
    expect(schedulesOverlap(daily(window("22:00", "00:00")), daily(window("00:00", "02:00")), timeZone)).toBe(false);
  });
});

describe("findOverlappingSchedule", () => {
  it("returns the first overlapping schedule with its title", () => {
    const earlier = { ...daily(window("08:00", "10:00")), title: "Opening" };
    const first = { ...daily(), title: "Kitchen" };
    const second = { ...daily(), title: "Hallway" };

    expect(findOverlappingSchedule(daily(), [earlier, first, second], timeZone)).toBe(first);
    expect(findOverlappingSchedule(daily(), [earlier], timeZone)).toBeUndefined();
  });
});
