import { describe, expect, it } from "vitest";
import { getZonedDayRange } from "../utils/dateTime.js";
import { WEEKDAYS } from "../utils/workDays.js";
import { buildScheduleOccurrences } from "./scheduleOccurrences.js";
import { resolveTaskInstanceWindow } from "./taskInstanceWindow.js";

type Template = Parameters<typeof buildScheduleOccurrences>[0][number];

const monday = new Date("2026-11-23T05:00:00Z");
const tuesday = new Date("2026-11-24T05:00:00Z");
const wednesday = new Date("2026-11-25T05:00:00Z");
const mondayStart = new Date("2026-11-22T19:00:00Z");
const tuesdayStart = new Date("2026-11-23T19:00:00Z");

const daily: Template = {
  id: 1,
  title: "Clean washroom",
  isActive: true,
  recurringType: "DAILY",
  effectiveDate: mondayStart,
  recurringEndDate: null,
  repeatDays: WEEKDAYS,
  locationId: 2,
  location: { timezone: "Asia/Karachi" },
  staffId: null,
  staff: null,
  shiftStart: new Date("2026-11-23T04:00:00Z"),
  shiftEnd: new Date("2026-11-23T05:00:00Z"),
  referenceImageUrl: "/washroom.jpg",
};

const overnight: Template = {
  ...daily,
  id: 2,
  staffId: 3,
  staff: {
    shiftStart: new Date("2026-11-23T17:00:00Z"),
    shiftEnd: new Date("2026-11-24T01:00:00Z"),
  },
  shiftStart: new Date("2026-11-23T21:00:00Z"),
  shiftEnd: new Date("2026-11-23T22:00:00Z"),
};

function legacyDailyInputs(templates: readonly Template[], now: Date) {
  return templates.flatMap((template) => {
    const timeZone = template.location.timezone;
    const { start: localToday, end: localTomorrow } = getZonedDayRange(now, timeZone);
    if (template.effectiveDate > localTomorrow) return [];
    if (template.recurringEndDate && template.recurringEndDate < localToday) return [];

    const window = resolveTaskInstanceWindow({
      baseDate: localToday,
      taskShiftStart: template.shiftStart,
      taskShiftEnd: template.shiftEnd,
      staffShiftStart: template.staff?.shiftStart,
      staffShiftEnd: template.staff?.shiftEnd,
      timeZone,
    });

    return [{
      templateId: template.id,
      baseDate: localToday,
      title: template.title,
      ...window,
      staffId: template.staffId,
      locationId: template.locationId,
      referenceImageUrl: template.referenceImageUrl,
    }];
  });
}

describe("buildScheduleOccurrences", () => {
  it("generates a Monday/Wednesday schedule on those two days", () => {
    const template: Template = { ...daily, repeatDays: ["MON", "WED"] };

    expect(buildScheduleOccurrences([template], monday)).toHaveLength(1);
    expect(buildScheduleOccurrences([template], tuesday)).toEqual([]);
    expect(buildScheduleOccurrences([template], wednesday)).toHaveLength(1);
  });

  it("uses each location's weekday at the same instant", () => {
    const karachi: Template = { ...daily, repeatDays: ["MON"] };
    const losAngeles: Template = {
      ...karachi,
      id: 3,
      location: { timezone: "America/Los_Angeles" },
    };

    expect(buildScheduleOccurrences([karachi, losAngeles], new Date("2026-11-22T20:00:00Z")))
      .toMatchObject([{ templateId: karachi.id, baseDate: mondayStart }]);
  });

  it("keeps the old daily inputs for all-seven schedules through a full week", () => {
    const templates = [daily, overnight];
    for (let day = 23; day <= 29; day++) {
      const now = new Date(Date.UTC(2026, 10, day, 5));
      const rows = buildScheduleOccurrences(templates, now);

      expect(rows).toHaveLength(2);
      expect(rows).toEqual(legacyDailyInputs(templates, now));
    }
  });

  it("treats missing and empty repeat days as all seven", () => {
    const templates: Template[] = [
      { ...daily, repeatDays: undefined },
      { ...overnight, repeatDays: [] },
    ];

    expect(buildScheduleOccurrences(templates, tuesday)).toEqual(legacyDailyInputs(templates, tuesday));
  });

  it("generates a one-time schedule only on its date and ignores repeat days", () => {
    const template: Template = {
      ...daily,
      recurringType: "ONCE",
      effectiveDate: tuesdayStart,
      repeatDays: ["MON"],
    };

    expect(buildScheduleOccurrences([template], monday)).toEqual([]);
    expect(buildScheduleOccurrences([template], tuesday)).toMatchObject([{ baseDate: tuesdayStart }]);
    expect(buildScheduleOccurrences([template], wednesday)).toEqual([]);
  });

  it("uses the overnight shift's base weekday even when the task date is the next day", () => {
    const template: Template = { ...overnight, repeatDays: ["MON"] };

    expect(buildScheduleOccurrences([template], monday)).toMatchObject([{
      baseDate: mondayStart,
      date: tuesdayStart,
      shiftStart: new Date("2026-11-23T21:00:00Z"),
      shiftEnd: new Date("2026-11-23T22:00:00Z"),
    }]);
    expect(buildScheduleOccurrences([template], tuesday)).toEqual([]);
  });

  it("skips inactive, ended, not-yet-effective and non-recurring schedules", () => {
    const templates: Template[] = [
      { ...daily, isActive: false },
      { ...daily, recurringEndDate: new Date(mondayStart.getTime() - 1) },
      { ...daily, effectiveDate: new Date(tuesdayStart.getTime() + 1) },
      { ...daily, recurringType: null },
    ];

    expect(buildScheduleOccurrences(templates, monday)).toEqual([]);
  });

  it("keeps the inclusive daily date boundaries", () => {
    const templates: Template[] = [
      { ...daily, effectiveDate: tuesdayStart },
      { ...overnight, recurringEndDate: mondayStart },
    ];

    expect(buildScheduleOccurrences(templates, monday)).toHaveLength(2);
    expect(buildScheduleOccurrences(templates, monday)).toEqual(legacyDailyInputs(templates, monday));
  });
});
