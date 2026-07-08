import { Prisma } from "@prisma/client";
import type { OperationTaskRow } from "./managerOperations.service.js";
import type { OperationsDay } from "./operationsScope.service.js";
import { hourlyProgressSql, type HourlyProgress } from "./operationsHourlyProgress.js";

export type OverviewAggregate = {
  locationId: number;
  present: number;
  scheduled: number;
  totalStaff: number;
  totalTasks: number;
  submitted: number;
  inProgress: number;
  notStarted: number;
  overdue: number;
  reviewCount: number;
  verified: number;
  accepted: number;
};

export type OverviewSnapshot = {
  counts: OverviewAggregate[];
  hourly: HourlyProgress[];
  lateIds: number[];
  unassignedIds: number[];
  taskIds: number[];
  tasks: Array<Omit<OperationTaskRow, "date" | "shiftStart" | "shiftEnd" | "staffSubmittedAt"> & {
    date: string;
    shiftStart: string;
    shiftEnd: string;
    staffSubmittedAt: string | null;
  }>;
  absent: Array<{ id: number; name: string; location: { id: number; name: string; timezone: string } }>;
  reviews: Array<{ id: number; taskInstanceId: number; reasonCode: string }>;
};

// One parameterized statement replaces repeated counts and grouped scans. Dates
// come from the authorized per-location scope, including overnight overlap.
// Keep this inside the overview's repeatable-read transaction.
export function overviewAggregateSql(
  companyId: number,
  days: OperationsDay[],
  now: Date,
) {
  const ranges = Prisma.join(days.map(d => Prisma.sql`(
    ${d.locationId}::integer, ${d.start}::timestamp, ${d.end}::timestamp, ${d.timezone}::text
  )`));
  return Prisma.sql`
    WITH days("locationId", start_at, end_at, timezone) AS (VALUES ${ranges}),
    scoped_tasks AS MATERIALIZED (
      SELECT t.id, t."locationId", t."staffId", t."shiftStart", t."shiftEnd",
        t.status, t."completionOutcome", t."staffSubmittedAt", t."completedAt",
        (t."staffSubmittedAt" IS NOT NULL OR t.status = 'COMPLETED') AS submitted
      FROM "TaskInstance" t
      JOIN days d ON d."locationId" = t."locationId"
      JOIN "Location" l ON l.id = t."locationId" AND l."companyId" = ${companyId}
      WHERE t."isActive" AND t.status <> 'CANCELLED'
        AND ((t.date >= d.start_at AND t.date < d.end_at)
          OR (t."shiftStart" < d.end_at AND t."shiftEnd" > d.start_at))
    ), ${hourlyProgressSql(now)}, classified AS MATERIALIZED (
      SELECT *, (NOT submitted AND ("shiftEnd" < ${now}::timestamp
        OR status IN ('MISSED', 'NOT_COMPLETED_INTIME'))) AS overdue
      FROM scoped_tasks
    ), task_counts AS (
      SELECT "locationId", count(*)::integer AS "totalTasks",
        (count(*) FILTER (WHERE submitted))::integer AS submitted,
        (count(*) FILTER (WHERE NOT submitted AND NOT overdue AND status = 'IN_PROGRESS'))::integer AS "inProgress",
        (count(*) FILTER (WHERE NOT submitted AND NOT overdue AND status = 'PENDING'))::integer AS "notStarted",
        (count(*) FILTER (WHERE overdue))::integer AS overdue,
        (count(*) FILTER (WHERE "completionOutcome" = 'VERIFIED_COMPLETE'))::integer AS verified,
        (count(*) FILTER (WHERE "completionOutcome" = 'COMPLETED_WITH_EXCEPTIONS'))::integer AS accepted
      FROM classified GROUP BY "locationId"
    ), attendance_by_staff AS (
      SELECT a."staffId", bool_or(a."checkInTime" IS NOT NULL) AS present
      FROM "Attendance" a JOIN days d ON d."locationId" = a."locationId"
      WHERE (a.date >= d.start_at AND a.date < d.end_at)
        OR (a."expectedStart" < d.end_at AND a."expectedEnd" > d.start_at)
      GROUP BY a."staffId"
    ), staff_counts AS (
      SELECT s."locationId", count(*)::integer AS "totalStaff",
        (count(*) FILTER (WHERE a."staffId" IS NOT NULL))::integer AS scheduled,
        (count(*) FILTER (WHERE a.present))::integer AS present
      FROM "Staff" s JOIN days d ON d."locationId" = s."locationId"
      LEFT JOIN attendance_by_staff a ON a."staffId" = s.id
      WHERE s."companyId" = ${companyId} AND s."isActive"
      GROUP BY s."locationId"
    ), review_counts AS (
      SELECT e."locationId", count(*)::integer AS "reviewCount"
      FROM "VerificationException" e JOIN scoped_tasks t ON t.id = e."taskInstanceId"
      WHERE e."companyId" = ${companyId} AND e.state IN ('OPEN', 'MANAGER_REVIEW')
      GROUP BY e."locationId"
    ), location_counts AS (
    SELECT d."locationId", COALESCE(s.present, 0)::integer AS present,
      COALESCE(s.scheduled, 0)::integer AS scheduled,
      COALESCE(s."totalStaff", 0)::integer AS "totalStaff",
      COALESCE(t."totalTasks", 0)::integer AS "totalTasks",
      COALESCE(t.submitted, 0)::integer AS submitted,
      COALESCE(t."inProgress", 0)::integer AS "inProgress",
      COALESCE(t."notStarted", 0)::integer AS "notStarted",
      COALESCE(t.overdue, 0)::integer AS overdue,
      COALESCE(r."reviewCount", 0)::integer AS "reviewCount",
      COALESCE(t.verified, 0)::integer AS verified,
      COALESCE(t.accepted, 0)::integer AS accepted
    FROM days d
    LEFT JOIN staff_counts s ON s."locationId" = d."locationId"
    LEFT JOIN task_counts t ON t."locationId" = d."locationId"
    LEFT JOIN review_counts r ON r."locationId" = d."locationId"
    ), preview_ids AS (
      SELECT
        ARRAY(SELECT id FROM classified WHERE overdue ORDER BY "shiftEnd", id LIMIT 3) AS late,
        ARRAY(SELECT id FROM classified WHERE "staffId" IS NULL AND NOT submitted
          AND NOT overdue AND status = 'PENDING' ORDER BY "shiftStart", id LIMIT 2) AS unassigned,
        ARRAY(SELECT id FROM scoped_tasks ORDER BY "shiftStart", id LIMIT 4) AS tasks
    ), review_preview AS MATERIALIZED (
      SELECT e.id, e."taskInstanceId",
        COALESCE((SELECT i."reasonCode" FROM "VerificationIssue" i
          WHERE i."exceptionId" = e.id AND i.state <> 'RESOLVED'
          ORDER BY i.id LIMIT 1), 'REVIEW_REQUIRED') AS "reasonCode"
      FROM "VerificationException" e JOIN scoped_tasks t ON t.id = e."taskInstanceId"
      WHERE e."companyId" = ${companyId} AND e.state IN ('OPEN', 'MANAGER_REVIEW')
      ORDER BY e.priority DESC, e."firstRaisedAt", e.id LIMIT 3
    ), task_preview AS (
      SELECT jsonb_build_object(
        'id', t.id, 'title', t.title, 'date', t.date AT TIME ZONE 'UTC',
        'shiftStart', t."shiftStart" AT TIME ZONE 'UTC', 'shiftEnd', t."shiftEnd" AT TIME ZONE 'UTC',
        'status', t.status, 'staffSubmittedAt', t."staffSubmittedAt" AT TIME ZONE 'UTC',
        'verificationVersion', t."verificationVersion", 'verificationState', t."verificationState",
        'completionOutcome', t."completionOutcome", 'areaNameSnapshot', t."areaNameSnapshot",
        'locationId', t."locationId", 'staffId', t."staffId", 'templateId', t."templateId",
        'location', jsonb_build_object('id', l.id, 'name', l.name, 'timezone', l.timezone),
        'staff', CASE WHEN s.id IS NULL THEN NULL ELSE jsonb_build_object('id', s.id, 'name', s.name) END,
        'assignments', COALESCE((
          SELECT jsonb_agg(latest.assignment) FROM (
            SELECT jsonb_build_object('id', a.id, 'staffId', a."staffId", 'status', a.status,
              'isCurrent', a."isCurrent", 'staff', jsonb_build_object('id', worker.id, 'name', worker.name)) AS assignment
            FROM "TaskAssignment" a JOIN "Staff" worker ON worker.id = a."staffId"
            WHERE a."taskInstanceId" = t.id
            ORDER BY a."assignedAt" DESC, a.id DESC LIMIT 1
          ) latest
        ), '[]'::jsonb),
        'verificationException', CASE WHEN e.id IS NULL THEN NULL ELSE jsonb_build_object('id', e.id, 'state', e.state) END
      ) AS task
      FROM "TaskInstance" t JOIN "Location" l ON l.id = t."locationId"
      LEFT JOIN "Staff" s ON s.id = t."staffId"
      LEFT JOIN "VerificationException" e ON e."taskInstanceId" = t.id
      WHERE t.id IN (
        SELECT unnest(late || unassigned || tasks) FROM preview_ids
        UNION SELECT "taskInstanceId" FROM review_preview
      )
    ), absent_preview AS (
      SELECT s.id, s.name, jsonb_build_object('id', l.id, 'name', l.name, 'timezone', l.timezone) AS location
      FROM "Staff" s JOIN days d ON d."locationId" = s."locationId"
      JOIN "Location" l ON l.id = s."locationId"
      WHERE s."companyId" = ${companyId} AND s."isActive" AND EXISTS (
        SELECT 1 FROM "Attendance" a JOIN days ad ON ad."locationId" = a."locationId"
        WHERE a."staffId" = s.id AND a."checkInTime" IS NULL AND a."checkOutTime" IS NULL
          AND a.status = 'ABSENT' AND a."expectedStart" <= ${now}::timestamp
          AND ((a.date >= ad.start_at AND a.date < ad.end_at)
            OR (a."expectedStart" < ad.end_at AND a."expectedEnd" > ad.start_at))
      )
      ORDER BY s.name, s.id LIMIT 3
    )
    SELECT COALESCE((SELECT jsonb_agg(c) FROM location_counts c), '[]'::jsonb) AS counts,
      COALESCE((SELECT jsonb_agg(h ORDER BY h.hour) FROM hourly_progress h), '[]'::jsonb) AS hourly,
      late AS "lateIds", unassigned AS "unassignedIds", p.tasks AS "taskIds",
      COALESCE((SELECT jsonb_agg(task) FROM task_preview), '[]'::jsonb) AS tasks,
      COALESCE((SELECT jsonb_agg(a) FROM absent_preview a), '[]'::jsonb) AS absent,
      COALESCE((SELECT jsonb_agg(r) FROM review_preview r), '[]'::jsonb) AS reviews
    FROM preview_ids p
  `;
}
