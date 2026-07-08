import { describe, expect, it } from "vitest";
import { fromZonedTime } from "date-fns-tz";
import { getZonedDayRangeFromDateInput } from "../utils/dateTime.js";
import { WEEKDAYS } from "../utils/workDays.js";
import { normalizeMonday, projectWeek, type ScheduleTemplate } from "./schedulePreview.service.js";

const tz = "America/New_York";
const template = (id: number, options: Partial<ScheduleTemplate> = {}): ScheduleTemplate => ({
  id, title: `Task ${id}`, recurringType: "DAILY", effectiveDate: new Date("2026-03-01T00:00:00.000Z"),
  recurringEndDate: null, shiftStart: fromZonedTime("2026-03-01T09:00:00", tz),
  shiftEnd: fromZonedTime("2026-03-01T10:00:00", tz), staff: null, ...options,
});

describe("read-only weekly projection", () => {
  it("normalizes valid dates and rejects malformed calendar dates", () => {
    expect(normalizeMonday("2026-03-08", new Date("2026-03-01T00:00:00Z"), tz)).toBe("2026-03-02");
    expect(normalizeMonday("2026-02-30", new Date(), tz)).toBeNull();
    expect(normalizeMonday("2026-03-08x", new Date(), tz)).toBeNull();
  });

  it("uses local calendar days across spring DST rather than 24-hour offsets", () => {
    const result = projectWeek({ weekStart: "2026-03-02", timezone: tz, now: new Date("2026-03-01T12:00:00Z"), templates: [template(1)], instances: [] });
    expect(result.days).toHaveLength(7);
    expect(result.days[0].date).toBe("2026-03-02");
    expect(result.days[6].date).toBe("2026-03-08");
    expect(result.days[5].items[0].startsAt).toBe("2026-03-07T14:00:00.000Z");
    expect(result.days[6].items[0].startsAt).toBe("2026-03-08T13:00:00.000Z");
    expect(result.days[6].items[0].status).toBeNull();
  });

  it("lets a cancelled actual suppress a planned item for the same template/day", () => {
    const zone = "Asia/Karachi";
    const day = getZonedDayRangeFromDateInput("2026-09-18", zone)!.start;
    const actual = { id: 4, templateId: 2, title: "Saved", date: day,
      shiftStart: fromZonedTime("2026-09-18T09:00:00", zone), shiftEnd: fromZonedTime("2026-09-18T10:00:00", zone),
      status: "CANCELLED", staff: null, assignments: [] };
    const task = template(2, { shiftStart: fromZonedTime("2026-09-01T09:00:00", zone),
      shiftEnd: fromZonedTime("2026-09-01T10:00:00", zone), effectiveDate: new Date("2026-09-01T00:00:00Z") });
    const result = projectWeek({ weekStart: "2026-09-14", timezone: zone, now: new Date("2026-09-17T01:00:00Z"), templates: [task], instances: [actual] });
    expect(result.days[4].items).toHaveLength(1);
    expect(result.days[4].items[0]).toMatchObject({ kind: "actual", status: "CANCELLED", instanceId: 4 });
    expect(result.days.slice(0, 3).flatMap((day) => day.items).filter((item) => item.kind === "planned")).toHaveLength(0);
  });

  it("includes an ONCE occurrence shifted from Sunday into Monday by an overnight staff shift", () => {
    const zone = "Asia/Karachi";
    const task = template(3, { recurringType: "ONCE", effectiveDate: getZonedDayRangeFromDateInput("2026-09-13", zone)!.start,
      shiftStart: fromZonedTime("2026-09-13T02:00:00", zone), shiftEnd: fromZonedTime("2026-09-13T04:00:00", zone),
      staff: { id: 9, name: "Amina", shiftStart: fromZonedTime("2026-09-13T22:00:00", zone), shiftEnd: fromZonedTime("2026-09-13T06:00:00", zone) } });
    const result = projectWeek({ weekStart: "2026-09-14", timezone: zone, now: new Date("2026-09-12T00:00:00Z"), templates: [task], instances: [] });
    expect(result.days[0].items).toHaveLength(1);
    expect(result.days[0].items[0]).toMatchObject({ kind: "planned", staffMeaning: "template-default", status: null });
  });

  it("projects Monday and Wednesday repeats using the location's calendar days", () => {
    const zone = "Asia/Karachi";
    const task = template(4, {
      repeatDays: ["MON", "WED"],
      shiftStart: fromZonedTime("2026-09-14T02:00:00", zone),
      shiftEnd: fromZonedTime("2026-09-14T04:00:00", zone),
    });
    const { days } = projectWeek({ weekStart: "2026-09-14", timezone: zone, now: new Date("2026-09-13T00:00:00Z"), templates: [task], instances: [] });
    expect(days.map(({ items }) => items.map(({ kind }) => kind))).toEqual([["planned"], [], ["planned"], [], [], [], []]);
  });

  it("projects all seven days when the stored list includes every weekday", () => {
    const { days } = projectWeek({ weekStart: "2026-03-02", timezone: tz, now: new Date("2026-03-01T12:00:00Z"), templates: [template(5, { repeatDays: WEEKDAYS })], instances: [] });
    expect(days.map(({ items }) => items.map(({ kind }) => kind))).toEqual(Array.from({ length: 7 }, () => ["planned"]));
  });

  it("shows a Monday-only overnight task continuing into Tuesday", () => {
    const zone = "Asia/Karachi";
    const task = template(6, {
      repeatDays: ["MON"],
      shiftStart: fromZonedTime("2026-09-14T22:00:00", zone),
      shiftEnd: fromZonedTime("2026-09-14T02:00:00", zone),
    });
    const { days } = projectWeek({ weekStart: "2026-09-14", timezone: zone, now: new Date("2026-09-13T00:00:00Z"), templates: [task], instances: [] });
    expect(days.map(({ items }) => items.length)).toEqual([1, 1, 0, 0, 0, 0, 0]);
    const [monday, tuesday] = days.map(({ items }) => items[0]);
    expect(monday).toMatchObject({ kind: "planned", continuesFromPreviousDay: false, continuesIntoNextDay: true });
    expect(tuesday).toMatchObject({ key: monday.key, continuesFromPreviousDay: true, continuesIntoNextDay: false });
  });

  it("uses Monday's repeat day when a staff shift moves the task start to Tuesday", () => {
    const zone = "Asia/Karachi";
    const task = template(7, {
      repeatDays: ["MON"],
      shiftStart: fromZonedTime("2026-09-14T02:00:00", zone),
      shiftEnd: fromZonedTime("2026-09-14T04:00:00", zone),
      staff: { id: 9, name: "Amina", shiftStart: fromZonedTime("2026-09-14T22:00:00", zone), shiftEnd: fromZonedTime("2026-09-14T06:00:00", zone) },
    });
    const { days } = projectWeek({ weekStart: "2026-09-14", timezone: zone, now: new Date("2026-09-13T00:00:00Z"), templates: [task], instances: [] });
    expect(days.map(({ items }) => items.map(({ kind }) => kind))).toEqual([[], ["planned"], [], [], [], [], []]);
  });
});
