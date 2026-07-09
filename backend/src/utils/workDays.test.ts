import { describe, expect, it } from "vitest";
import { getZonedDayRange } from "./dateTime.js";
import {
  WEEKDAYS,
  coveringShiftDay,
  formatWeekdays,
  isAllSevenDays,
  isDaySubset,
  isWorkDay,
  matchesScheduleWeekday,
  nextWorkShiftStart,
  normalizeDays,
  readDayList,
  removedDays,
  repeatDaysSchema,
  scheduleOccursOnDay,
  weekdayOfLocalDay,
  workDaysSchema,
  worksCoveringShift,
} from "./workDays.js";

const timeZone = "Asia/Karachi";
const monday = new Date("2026-11-22T19:00:00.000Z");
const tuesday = new Date("2026-11-23T19:00:00.000Z");
const wednesday = new Date("2026-11-24T19:00:00.000Z");
const dayShift = {
  shiftStart: new Date("2026-11-23T09:00:00+05:00"),
  shiftEnd: new Date("2026-11-23T17:00:00+05:00"),
  timeZone,
};
const overnightShift = {
  shiftStart: new Date("2026-11-23T22:00:00+05:00"),
  shiftEnd: new Date("2026-11-24T06:00:00+05:00"),
  timeZone,
};

describe("weekday lists", () => {
  it("normalizes to canonical order without duplicates", () => {
    expect(normalizeDays(["WED", "MON", "MON"])).toEqual(["MON", "WED"]);
    expect(isAllSevenDays(["SUN", ...WEEKDAYS])).toBe(true);
    expect(isAllSevenDays(["MON", "MON"])).toBe(false);
    expect(formatWeekdays(["WED", "MON", "MON"])).toBe("Mon, Wed");
  });

  it("uses all seven days for absent or empty stored lists", () => {
    expect(readDayList()).toEqual(WEEKDAYS);
    expect(readDayList(null)).toEqual(WEEKDAYS);
    expect(readDayList([])).toEqual(WEEKDAYS);
    expect(isWorkDay(undefined, monday, timeZone)).toBe(true);
    expect(isWorkDay([], tuesday, timeZone)).toBe(true);
    expect(isWorkDay(["MON"], tuesday, timeZone)).toBe(false);
  });

  it("compares subsets and reports removed days in canonical order", () => {
    expect(isDaySubset(["WED", "MON"], ["MON", "TUE", "WED"])).toBe(true);
    expect(isDaySubset(["WED", "MON"], ["MON"])).toBe(false);
    expect(isDaySubset(["MON"], undefined)).toBe(true);
    expect(isDaySubset([], ["MON"])).toBe(false);
    expect(removedDays(["MON", "TUE"], ["MON"])).toEqual(["TUE"]);
    expect(removedDays(["WED", "TUE", "MON", "TUE"], ["MON"])).toEqual(["TUE", "WED"]);
    expect(removedDays(undefined, ["MON"])).toEqual(WEEKDAYS.slice(1));
    expect(removedDays(["MON"], [])).toEqual([]);
  });
});

describe.each([
  { schema: workDaysSchema, code: "INVALID_WORK_DAYS", message: "Choose at least one work day." },
  { schema: repeatDaysSchema, code: "INVALID_REPEAT_DAYS", message: "Choose at least one day for this schedule." },
])("$code request validation", ({ schema, code, message }) => {
  it("accepts and normalizes valid lists", () => {
    expect(schema.parse(["WED", "MON", "MON"])).toEqual(["MON", "WED"]);
  });

  it.each([
    { name: "an empty array", input: [] },
    { name: "an unknown weekday", input: ["FUNDAY"] },
    { name: "a non-array", input: "MON" },
  ])("rejects $name with a custom issue", ({ input }) => {
    const parsed = schema.safeParse(input);
    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues).toEqual([
      { code: "custom", message, params: { code }, path: [] },
    ]);
  });
});

describe("local weekdays and covering shifts", () => {
  it("uses the local calendar date for a Monday anchor and a Sunday UTC instant", () => {
    const instant = new Date("2026-11-22T20:30:00.000Z");
    expect(weekdayOfLocalDay(monday, timeZone)).toBe("MON");
    expect(weekdayOfLocalDay(instant, timeZone)).toBe("MON");
    expect(weekdayOfLocalDay(instant, "UTC")).toBe("SUN");
  });

  it("uses Monday work days for the Tuesday morning portion of Monday's overnight shift", () => {
    const input = { ...overnightShift, instant: new Date("2026-11-24T02:00:00+05:00") };
    expect(coveringShiftDay(input)).toEqual(monday);
    expect(worksCoveringShift({ ...input, workDays: ["MON"] })).toBe(true);
    expect(worksCoveringShift({ ...input, workDays: ["TUE"] })).toBe(false);
  });

  it("switches to the current day at the overnight end clock", () => {
    const input = { ...overnightShift, instant: new Date("2026-11-24T06:00:00+05:00") };
    expect(coveringShiftDay(input)).toEqual(tuesday);
  });

  it("uses the current day for a daytime shift", () => {
    const input = { ...dayShift, instant: new Date("2026-11-24T10:00:00+05:00") };
    expect(coveringShiftDay(input)).toEqual(tuesday);
  });
});

describe("schedule occurrences", () => {
  const daily = {
    recurringType: "DAILY",
    isActive: true,
    effectiveDate: monday,
    repeatDays: ["MON", "WED"],
  } as const;
  const mondayRange = getZonedDayRange(monday, timeZone);
  const tuesdayRange = getZonedDayRange(tuesday, timeZone);

  it("uses the repeat days of the base day for daily schedules", () => {
    expect(scheduleOccursOnDay(daily, mondayRange, timeZone)).toBe(true);
    expect(scheduleOccursOnDay(daily, tuesdayRange, timeZone)).toBe(false);
    expect(matchesScheduleWeekday(daily, wednesday, timeZone)).toBe(true);
    expect(matchesScheduleWeekday(daily, tuesday, timeZone)).toBe(false);
    expect(scheduleOccursOnDay({ ...daily, repeatDays: [] }, tuesdayRange, timeZone)).toBe(true);
  });

  it("includes the daily end day and skips later days", () => {
    const ending = { ...daily, recurringEndDate: monday };
    expect(scheduleOccursOnDay(ending, mondayRange, timeZone)).toBe(true);
    expect(scheduleOccursOnDay(ending, getZonedDayRange(wednesday, timeZone), timeZone)).toBe(false);
  });

  it("preserves the daily effective-date cutoff at the next local midnight", () => {
    expect(scheduleOccursOnDay({ ...daily, effectiveDate: tuesday }, mondayRange, timeZone)).toBe(true);
    const afterCutoff = new Date(tuesday.getTime() + 1);
    expect(scheduleOccursOnDay({ ...daily, effectiveDate: afterCutoff }, mondayRange, timeZone)).toBe(false);
  });

  it("limits once schedules to the effective day and ignores repeat days and the recurring end", () => {
    const once = { ...daily, recurringType: "ONCE", effectiveDate: tuesday, recurringEndDate: monday } as const;
    expect(matchesScheduleWeekday(once, tuesday, timeZone)).toBe(true);
    expect(scheduleOccursOnDay(once, mondayRange, timeZone)).toBe(false);
    expect(scheduleOccursOnDay(once, tuesdayRange, timeZone)).toBe(true);
    expect(scheduleOccursOnDay(once, getZonedDayRange(wednesday, timeZone), timeZone)).toBe(false);
  });

  it("skips inactive schedules", () => {
    expect(scheduleOccursOnDay({ ...daily, isActive: false }, mondayRange, timeZone)).toBe(false);
    expect(scheduleOccursOnDay({ ...daily, isActive: false, recurringType: "ONCE" }, mondayRange, timeZone)).toBe(false);
  });
});

describe("next work shift", () => {
  it.each([
    ["08:00", "2026-11-23"],
    ["09:00", "2026-11-30"],
    ["10:00", "2026-11-30"],
  ])("returns the first Monday shift strictly after Monday %s", (clock, expectedDate) => {
    const now = new Date(`2026-11-23T${clock}:00+05:00`);
    expect(nextWorkShiftStart({ ...dayShift, workDays: ["MON"], now }))
      .toEqual(new Date(`${expectedDate}T09:00:00+05:00`));
  });

  it("keeps the local start clock across a daylight saving change", () => {
    expect(nextWorkShiftStart({
      shiftStart: new Date("2026-10-26T09:00:00-04:00"),
      shiftEnd: new Date("2026-10-26T17:00:00-04:00"),
      now: new Date("2026-10-26T10:00:00-04:00"),
      workDays: ["MON"],
      timeZone: "America/New_York",
    })).toEqual(new Date("2026-11-02T09:00:00-05:00"));
  });

  it("returns null without a location timezone or both shift clocks", () => {
    const now = new Date("2026-11-23T08:00:00+05:00");
    expect(nextWorkShiftStart({ ...dayShift, now, timeZone: null })).toBeNull();
    expect(nextWorkShiftStart({ ...dayShift, now, shiftStart: null })).toBeNull();
    expect(nextWorkShiftStart({ ...dayShift, now, shiftEnd: null })).toBeNull();
  });
});
