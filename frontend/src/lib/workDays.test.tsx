import { describe, expect, it } from "vitest";
import { translate } from "@/i18n/translations";
import { formatDays, isEveryDay, normalizeDays, scheduleOccursOn, WEEKDAYS, type ScheduleOccurrence } from "./workDays";

const en = (key: string) => translate(key, "en");
const ur = (key: string) => translate(key, "ur");

describe("web day lists", () => {
  it("defaults missing days to every day and keeps an explicit empty selection", () => {
    expect(normalizeDays()).toEqual(WEEKDAYS);
    expect(isEveryDay(null)).toBe(true);
    expect(normalizeDays([])).toEqual([]);
    expect(isEveryDay([])).toBe(false);
  });

  it("orders days and ignores duplicates when checking for every day", () => {
    expect(normalizeDays(["SUN", "WED", "MON", "WED"])).toEqual(["MON", "WED", "SUN"]);
    expect(isEveryDay([...WEEKDAYS].reverse())).toBe(true);
    expect(isEveryDay(["MON", "MON", "TUE", "WED", "THU", "FRI", "SAT"])).toBe(false);
  });

  it("formats all seven and a missing list as Every day", () => {
    expect(formatDays(WEEKDAYS, en, "en")).toBe("Every day");
    expect(formatDays(undefined, en, "en")).toBe("Every day");
    expect(formatDays(undefined, ur, "ur")).toBe("ہر روز");
  });

  it("formats runs of at least three days as ranges", () => {
    expect(formatDays(WEEKDAYS.slice(0, 6), en, "en")).toBe("Mon–Sat");
    expect(formatDays(["FRI", "TUE", "MON", "WED"], en, "en")).toBe("Mon–Wed, Fri");
  });

  it("lists shorter runs and uses the language's separator", () => {
    expect(formatDays(["MON", "WED"], en, "en")).toBe("Mon, Wed");
    expect(formatDays(["MON", "TUE"], en, "en")).toBe("Mon, Tue");
    expect(formatDays(["MON", "WED"], ur, "ur")).toBe("پیر، بدھ");
    expect(formatDays(["MON", "TUE", "WED", "FRI"], ur, "ur")).toBe("پیر–بدھ، جمعہ");
  });
});

describe("read-only schedule occurrences", () => {
  const daily: ScheduleOccurrence = {
    recurringType: "DAILY",
    effectiveDate: "2026-11-23T00:00:00.000Z",
    recurringEndDate: "2026-11-25",
    repeatDays: ["MON", "WED"],
  };

  it("matches chosen weekdays within the inclusive date bounds", () => {
    expect(scheduleOccursOn(daily, "2026-11-23")).toBe(true);
    expect(scheduleOccursOn(daily, "2026-11-24")).toBe(false);
    expect(scheduleOccursOn(daily, "2026-11-25")).toBe(true);
    expect(scheduleOccursOn(daily, "2026-11-18")).toBe(false);
    expect(scheduleOccursOn(daily, "2026-11-30")).toBe(false);
  });

  it("matches a once schedule only on its effective date regardless of repeat days", () => {
    const once = { ...daily, recurringType: "ONCE" as const, repeatDays: ["WED"] as const };
    expect(scheduleOccursOn(once, "2026-11-23")).toBe(true);
    expect(scheduleOccursOn(once, "2026-11-25")).toBe(false);
  });

  it("preserves daily occurrences for missing, empty and all-seven repeat lists", () => {
    expect(scheduleOccursOn({ ...daily, repeatDays: undefined }, "2026-11-24")).toBe(true);
    expect(scheduleOccursOn({ ...daily, repeatDays: [] }, "2026-11-24")).toBe(true);
    expect(scheduleOccursOn({ ...daily, repeatDays: WEEKDAYS }, "2026-11-24")).toBe(true);
  });

  it("excludes inactive templates and invalid calendar days", () => {
    expect(scheduleOccursOn({ ...daily, isActive: false }, "2026-11-23")).toBe(false);
    expect(scheduleOccursOn({ ...daily, effectiveDate: null }, "2026-11-23")).toBe(false);
    const unbounded = { ...daily, repeatDays: WEEKDAYS, recurringEndDate: null };
    expect(scheduleOccursOn(unbounded, "2026-11-29")).toBe(true);
    expect(scheduleOccursOn(unbounded, "2026-11-31")).toBe(false);
    expect(scheduleOccursOn(unbounded, "2026-11-29T00:00:00Z")).toBe(false);
  });
});
