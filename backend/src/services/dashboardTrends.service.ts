import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../prisma/prisma.js";
import { addUtcDays } from "../utils/dateTime.js";
import { locationDay, operationsScope } from "./operationsScope.service.js";
import type { VerificationActor } from "./verification-v2/authorization.service.js";

export const trendsQuery = z.object({
  locationId: z.coerce.number().int().positive().optional(),
  date: z.string().default("today"),
  asOf: z.iso.datetime().optional(),
});

function moveDay(day: string, offset: number) {
  return addUtcDays(new Date(`${day}T12:00:00Z`), offset).toISOString().slice(0, 10);
}

export function trendRanges(
  location: { id: number; timezone: string },
  date: string,
  now: Date,
) {
  const day = locationDay(location, date, now);
  const currentFrom = moveDay(day.localDate, -6);
  const previousFrom = moveDay(day.localDate, -13);
  const previousTo = moveDay(day.localDate, -7);
  return {
    locationId: location.id,
    current: { dateFrom: currentFrom, dateTo: day.localDate },
    previous: { dateFrom: previousFrom, dateTo: previousTo },
    start: locationDay(location, previousFrom, now).start,
    currentStart: locationDay(location, currentFrom, now).start,
    end: day.end,
  };
}

type TrendCounts = {
  locationId: number;
  currentSubmitted: number;
  currentScheduled: number;
  previousSubmitted: number;
  previousScheduled: number;
};

export async function dashboardTrends(
  actor: VerificationActor,
  raw: unknown,
  now = new Date(),
) {
  const q = trendsQuery.parse(raw);
  const anchor = q.asOf ? new Date(q.asOf) : now;
  const scope = await operationsScope(actor, q.locationId, q.date, anchor);
  const ranges = scope.selected.map((l) => trendRanges(l, q.date, anchor));
  if (!ranges.length) return { rows: [] };

  // Match the location statistics' date-anchor and submission semantics. Scan
  // both weeks once, without loading tasks, assignments, staff or templates.
  const values = Prisma.join(ranges.map((r) => Prisma.sql`(
    ${r.locationId}::integer, ${r.start}::timestamp,
    ${r.currentStart}::timestamp, ${r.end}::timestamp
  )`));
  const counts = await prisma.$queryRaw<TrendCounts[]>(Prisma.sql`
    WITH ranges("locationId", start_at, current_start, end_at) AS (VALUES ${values})
    SELECT r."locationId",
      (count(t.id) FILTER (WHERE t.date >= r.current_start))::integer AS "currentScheduled",
      (count(t.id) FILTER (WHERE t.date < r.current_start))::integer AS "previousScheduled",
      (count(t.id) FILTER (WHERE t.date >= r.current_start AND
        (t.status = 'COMPLETED' OR (t."staffSubmittedAt" IS NOT NULL
          AND t.status IN ('IN_PROGRESS', 'NOT_COMPLETED_INTIME')))))::integer AS "currentSubmitted",
      (count(t.id) FILTER (WHERE t.date < r.current_start AND
        (t.status = 'COMPLETED' OR (t."staffSubmittedAt" IS NOT NULL
          AND t.status IN ('IN_PROGRESS', 'NOT_COMPLETED_INTIME')))))::integer AS "previousSubmitted"
    FROM ranges r
    JOIN "Location" l ON l.id = r."locationId" AND l."companyId" = ${actor.companyId}
    LEFT JOIN "TaskInstance" t ON t."locationId" = r."locationId"
      AND t."isActive" AND t.status <> 'CANCELLED'
      AND t.date >= r.start_at AND t.date < r.end_at
    GROUP BY r."locationId"
  `);
  const byLocation = new Map(counts.map((row) => [row.locationId, row]));
  return {
    rows: ranges.map((r) => {
      const count = byLocation.get(r.locationId);
      return {
        locationId: r.locationId,
        current: { ...r.current, submitted: count?.currentSubmitted ?? 0, scheduled: count?.currentScheduled ?? 0 },
        previous: { ...r.previous, submitted: count?.previousSubmitted ?? 0, scheduled: count?.previousScheduled ?? 0 },
      };
    }),
  };
}
