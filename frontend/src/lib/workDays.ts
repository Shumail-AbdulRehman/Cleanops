import type { Language } from "@/i18n/translations";

export const WEEKDAYS = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"] as const;
export type Weekday = typeof WEEKDAYS[number];

export const WEEKDAY_LABELS = {
  MON: { short: "Mon", full: "Monday" },
  TUE: { short: "Tue", full: "Tuesday" },
  WED: { short: "Wed", full: "Wednesday" },
  THU: { short: "Thu", full: "Thursday" },
  FRI: { short: "Fri", full: "Friday" },
  SAT: { short: "Sat", full: "Saturday" },
  SUN: { short: "Sun", full: "Sunday" },
} as const satisfies Record<Weekday, { short: string; full: string }>;

type DayList = readonly Weekday[] | null | undefined;

export function normalizeDays(days?: DayList): Weekday[] {
  return WEEKDAYS.filter(day => days == null || days.includes(day));
}

export function isEveryDay(days?: DayList): boolean {
  return normalizeDays(days).length === WEEKDAYS.length;
}

export function formatDays(days: DayList, t: (key: string) => string, language: Language): string {
  const selected = normalizeDays(days);
  if (selected.length === WEEKDAYS.length) return t("Every day");

  const ranges: string[] = [];
  for (let start = 0; start < selected.length;) {
    let end = start + 1;
    const weekdayIndex = WEEKDAYS.indexOf(selected[start]);
    while (end < selected.length && selected[end] === WEEKDAYS[weekdayIndex + end - start]) {
      end++;
    }
    const names = selected.slice(start, end).map(day => t(WEEKDAY_LABELS[day].short));
    if (names.length >= 3) {
      ranges.push(`${names[0]}–${names[names.length - 1]}`);
    } else {
      ranges.push(...names);
    }
    start = end;
  }
  return ranges.join(language === "ur" ? "، " : ", ");
}

export interface ScheduleOccurrence {
  recurringType: "DAILY" | "ONCE";
  effectiveDate?: string | null;
  recurringEndDate?: string | null;
  repeatDays?: DayList;
  isActive?: boolean;
}

/** Projects a template on a location-local calendar date for the read-only week grid. */
export function scheduleOccursOn(template: ScheduleOccurrence, day: string): boolean {
  const effective = template.effectiveDate?.slice(0, 10);
  if (template.isActive === false || !effective || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return false;

  // UTC holds the supplied calendar fields without a host timezone conversion.
  const calendar = new Date(`${day}T12:00:00Z`);
  if (Number.isNaN(calendar.getTime()) || calendar.toISOString().slice(0, 10) !== day) return false;
  if (template.recurringType === "ONCE") return day === effective;

  const until = template.recurringEndDate?.slice(0, 10);
  if (day < effective || (until && day > until)) return false;
  const weekday = WEEKDAYS[(calendar.getUTCDay() + 6) % WEEKDAYS.length];
  return !template.repeatDays?.length || template.repeatDays.includes(weekday);
}
