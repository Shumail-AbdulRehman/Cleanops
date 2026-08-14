import type { OperationHourlyProgress, OperationOverview } from "./operations.ts";

export type HourlyProgressInput = Pick<
  OperationOverview,
  "hourly" | "asOf" | "date"
> & { timezone: string };

export type HourlyProgressResult = {
  points: OperationHourlyProgress[];
  /** Clock hour for the Now marker; null for empty data or a non-today date. */
  currentHour: number | null;
  /** Latest cumulative point at or before now; null before the first bucket. */
  current: OperationHourlyProgress | null;
  behind: number;
};

/**
 * Prepare the server's ordered, cumulative buckets for a chart. Use the selected
 * location's timezone (explicitly chosen by the caller for an all-location view).
 * Keep server nulls, including its conservative mixed-timezone masking. Never
 * recompute buckets from tasks or use the browser clock for an API snapshot.
 */
export function hourlyProgress({
  hourly,
  asOf,
  date,
  timezone,
}: HourlyProgressInput): HourlyProgressResult {
  const points = (hourly ?? []).map(({ hour, due, submitted }) => ({
    hour,
    due,
    submitted,
  }));
  const result: HourlyProgressResult = {
    points,
    currentHour: null,
    current: null,
    behind: 0,
  };
  if (!points.length) return result;

  const instant = new Date(asOf);
  if (!Number.isFinite(instant.getTime())) return result;

  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      hourCycle: "h23",
    }).formatToParts(instant);
  } catch {
    // An unusable timezone must not silently fall back to the device timezone.
    return result;
  }
  const field = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)!.value;
  const localDate = `${field("year")}-${field("month")}-${field("day")}`;
  if (date !== "today" && date !== localDate) return result;

  const currentHour = Number(field("hour"));
  const current = points.findLast((point) => point.hour <= currentHour) ?? null;
  return {
    points,
    currentHour,
    current,
    // A masked submission count is unknown; it cannot justify an attention pill.
    behind:
      current && current.submitted !== null
        ? Math.max(0, current.due - current.submitted)
        : 0,
  };
}
