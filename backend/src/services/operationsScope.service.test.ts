import { describe, it, expect } from "vitest";
import {
  locationDay,
  taskDayWhere,
  attendanceDayWhere,
  pageBounds,
  operationsQuery,
} from "./operationsScope.service.js";
describe("operational local-day contract", () => {
  it("accepts the off attendance filter and rejects unknown filters", () => {
    expect(operationsQuery.parse({ attendance: "off" }).attendance).toBe("off");
    expect(operationsQuery.safeParse({ attendance: "unknown" }).success).toBe(false);
  });
  it("uses Karachi midnight rather than the UTC date, including carry-over windows", () => {
    const day = locationDay(
      { id: 2, timezone: "Asia/Karachi" },
      "today",
      new Date("2026-10-11T19:15:00Z"),
    );
    expect(day.localDate).toBe("2026-10-12");
    expect(day.start.toISOString()).toBe("2026-10-11T19:00:00.000Z");
    expect(day.end.toISOString()).toBe("2026-10-12T19:00:00.000Z");
    expect(taskDayWhere([day])).toMatchObject({
      OR: [
        {
          locationId: 2,
          OR: [
            { date: { gte: day.start, lt: day.end } },
            { shiftStart: { lt: day.end }, shiftEnd: { gt: day.start } },
          ],
        },
      ],
    });
    expect(attendanceDayWhere([day])).toMatchObject({
      OR: [{ locationId: 2 }],
    });
  });
  it("pairs each timezone range with its location and handles a 25-hour DST day", () => {
    const d = locationDay(
      { id: 3, timezone: "America/New_York" },
      "2026-11-01",
    );
    expect(+d.end - +d.start).toBe(25 * 3600000);
    const k = locationDay({ id: 2, timezone: "Asia/Karachi" }, "2026-11-01");
    expect(taskDayWhere([d, k]).OR).toHaveLength(2);
    expect(d.start).not.toEqual(k.start);
  });
  it("rejects malformed dates and clamps an exhausted page, including empty lists", () => {
    expect(() =>
      locationDay({ id: 1, timezone: "Asia/Karachi" }, "2026-02-30"),
    ).toThrow();
    expect(pageBounds(40, 3, 20)).toEqual({
      total: 40,
      page: 2,
      pageSize: 20,
      totalPages: 2,
    });
    expect(pageBounds(0, 3, 20).page).toBe(1);
    expect(operationsQuery.safeParse({ pageSize: 500 }).success).toBe(false);
  });
});
