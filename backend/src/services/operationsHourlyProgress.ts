import { Prisma } from "@prisma/client";

export type HourlyProgress = {
  hour: number;
  due: number;
  submitted: number | null;
};

// CTEs for overviewAggregateSql: consume its authorized scoped_tasks and days,
// rather than reading TaskInstance again or defining another scoping rule.
// Legacy COMPLETED tasks still count in metrics: prefer their completedAt when
// staffSubmittedAt is absent, otherwise use their due time capped at now.
// In a mixed-timezone scope, show submitted only through the hour reached by
// every task-bearing location, so a partial sum cannot look like a full count.
export function hourlyProgressSql(now: Date) {
  return Prisma.sql`
    hourly_task_hours AS MATERIALIZED (
      SELECT EXTRACT(HOUR FROM timezone(d.timezone, t."shiftEnd" AT TIME ZONE 'UTC'))::integer AS due_hour,
        CASE WHEN t.submitted THEN EXTRACT(HOUR FROM timezone(d.timezone,
          COALESCE(t."staffSubmittedAt", t."completedAt", LEAST(t."shiftEnd", ${now}::timestamp))
            AT TIME ZONE 'UTC'))::integer END AS submitted_hour,
        CASE WHEN d.end_at <= ${now}::timestamp THEN 23
          WHEN d.start_at > ${now}::timestamp THEN -1
          ELSE EXTRACT(HOUR FROM timezone(d.timezone, ${now}::timestamp AT TIME ZONE 'UTC'))::integer
        END AS known_hour
      FROM scoped_tasks t JOIN days d ON d."locationId" = t."locationId"
    ), hourly_events AS (
      SELECT due_hour AS hour, 1 AS due, 0 AS submitted, known_hour FROM hourly_task_hours
      UNION ALL
      SELECT submitted_hour, 0, 1, known_hour FROM hourly_task_hours WHERE submitted_hour IS NOT NULL
    ), hourly_limits AS (
      SELECT min(hour) AS first_hour, max(hour) AS last_hour, min(known_hour) AS known_hour
      FROM hourly_events
    ), hourly_buckets AS (
      SELECT hour, sum(due) AS due, sum(submitted) AS submitted FROM hourly_events GROUP BY hour
    ), hourly_progress AS (
      SELECT h.hour,
        (sum(COALESCE(b.due, 0)) OVER (ORDER BY h.hour))::integer AS due,
        CASE WHEN h.hour <= l.known_hour
          THEN (sum(COALESCE(b.submitted, 0)) OVER (ORDER BY h.hour))::integer
          ELSE NULL END AS submitted
      FROM hourly_limits l
      CROSS JOIN LATERAL generate_series(l.first_hour, l.last_hour) AS h(hour)
      LEFT JOIN hourly_buckets b ON b.hour = h.hour
    )
  `;
}
