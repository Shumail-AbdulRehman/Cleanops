import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../prisma/prisma.js';
import { addUtcDays } from '../utils/dateTime.js';
import { locationDay, operationsScope } from './operationsScope.service.js';
import type { VerificationActor } from './verification-v2/authorization.service.js';

export const performanceQuery = z.object({
  locationId: z.coerce.number().int().positive().optional(),
  date: z.string().default('today'),
  period: z.coerce.number().refine(value => value === 7 || value === 30, 'Choose 7 or 30 days.').default(7),
});
const fields = ['scheduledShifts', 'present', 'late', 'missing', 'tasks', 'submitted', 'verified', 'accepted', 'inProgress', 'overdue', 'notStarted', 'reviews'] as const;
type Field = typeof fields[number];
export type PerformanceCounts = Record<Field, number>;
export type PerformanceRow = PerformanceCounts & { locationId: number; offset: number; staff: number };
const emptyCounts = (): PerformanceCounts => Object.fromEntries(fields.map(key => [key, 0])) as PerformanceCounts;
export const performanceRate = (value: number, total: number) => total > 0 ? Math.round(value / total * 1000) / 10 : null;
const rates = (counts: PerformanceCounts) => ({ ...counts, attendanceRate: performanceRate(counts.present, counts.scheduledShifts), submissionRate: performanceRate(counts.submitted, counts.tasks) });
const add = (rows: PerformanceCounts[]) => rows.reduce((sum, row) => {
  for (const key of fields) sum[key] += row[key];
  return sum;
}, emptyCounts());
export function performanceWindows(locations: {id:number;timezone:string}[], date:string, period:number, now:Date) {
  return locations.flatMap(location => {
    const anchor = locationDay(location, date, now).localDate;
    return Array.from({ length: period * 2 }, (_, index) => {
      const offset = index - (period * 2 - 1);
      const day = addUtcDays(new Date(`${anchor}T12:00:00Z`), offset).toISOString().slice(0, 10);
      return { ...locationDay(location, day, now), offset };
    });
  });
}
export function summarizePerformance(locations: {id:number;name:string;timezone:string}[], rows:PerformanceRow[], period:number) {
  const current = rows.filter(row => row.offset > -period), previous = rows.filter(row => row.offset <= -period);
  const totals = rates(add(current)), prior = rates(add(previous));
  const delta = (a:number|null,b:number|null) => a === null || b === null ? null : Math.round((a-b)*10)/10;
  const sites = locations.map(location => {
    const local = current.filter(row => row.locationId === location.id);
    const today = local.find(row => row.offset === 0) ?? emptyCounts();
    const status = today.missing || today.overdue || today.reviews ? 'ATTENTION'
      : today.inProgress ? 'IN_PROGRESS' : today.tasks || today.scheduledShifts ? 'ON_TRACK' : 'NO_ACTIVITY';
    return { location, ...rates(add(local)), staff: local[0]?.staff ?? 0, today: { ...today, status } };
  });
  return {
    summary: { ...totals, previous: prior, attendanceChange:delta(totals.attendanceRate,prior.attendanceRate), submissionChange:delta(totals.submissionRate,prior.submissionRate),
      totalLocations:locations.length, activeLocations:sites.filter(site => site.tasks || site.scheduledShifts).length, totalStaff:sites.reduce((sum,site)=>sum+site.staff,0) },
    series: Array.from({length:period},(_,index)=>({offset:index-period+1,...rates(add(current.filter(row=>row.offset===index-period+1)))})),
    sites,
  };
}

export async function companyPerformance(actor:VerificationActor,raw:unknown,now=new Date()) {
  const query=performanceQuery.parse(raw);
  const scope=await operationsScope(actor,query.locationId,query.date,now);
  const windows=performanceWindows(scope.selected,query.date,query.period,now);
  let rows:PerformanceRow[]=[];
  if(windows.length){
    const values=Prisma.join(windows.map(day=>Prisma.sql`(${day.locationId}::integer,${day.offset}::integer,${day.start}::timestamp,${day.end}::timestamp)`));
    // Each occurrence belongs to exactly one location-local calendar day. Do not
    // duplicate overnight work on both sides of midnight or average site rates.
    rows=await prisma.$queryRaw<PerformanceRow[]>(Prisma.sql`
      WITH days("locationId",offset_day,start_at,end_at) AS (VALUES ${values}),
      task_counts AS (
        SELECT d."locationId",d.offset_day,count(t.id)::integer AS tasks,
          (count(t.id) FILTER(WHERE t."staffSubmittedAt" IS NOT NULL OR t.status='COMPLETED'))::integer AS submitted,
          (count(t.id) FILTER(WHERE t."completionOutcome"='VERIFIED_COMPLETE'))::integer AS verified,
          (count(t.id) FILTER(WHERE t."completionOutcome"='COMPLETED_WITH_EXCEPTIONS'))::integer AS accepted,
          (count(t.id) FILTER(WHERE t."staffSubmittedAt" IS NULL AND t.status<>'COMPLETED'
            AND (t."shiftEnd"<${now}::timestamp OR t.status IN ('MISSED','NOT_COMPLETED_INTIME'))))::integer AS overdue,
          (count(t.id) FILTER(WHERE t."staffSubmittedAt" IS NULL AND t.status='IN_PROGRESS' AND t."shiftEnd">=${now}::timestamp))::integer AS "inProgress",
          (count(t.id) FILTER(WHERE t."staffSubmittedAt" IS NULL AND t.status='PENDING' AND t."shiftEnd">=${now}::timestamp))::integer AS "notStarted",
          (count(e.id) FILTER(WHERE e.state IN ('OPEN','MANAGER_REVIEW')))::integer AS reviews
        FROM days d JOIN "Location" l ON l.id=d."locationId" AND l."companyId"=${actor.companyId}
        LEFT JOIN "TaskInstance" t ON t."locationId"=d."locationId" AND t."isActive" AND t.status<>'CANCELLED'
          AND t.date>=d.start_at AND t.date<d.end_at
        LEFT JOIN "VerificationException" e ON e."taskInstanceId"=t.id AND e."companyId"=${actor.companyId}
        GROUP BY d."locationId",d.offset_day
      ), attendance_counts AS (
        SELECT d."locationId",d.offset_day,count(a.id)::integer AS "scheduledShifts",
          (count(a.id) FILTER(WHERE a."checkInTime" IS NOT NULL))::integer AS present,
          (count(a.id) FILTER(WHERE a."checkInTime" IS NOT NULL AND a."isLateCheckIn"))::integer AS late,
          (count(a.id) FILTER(WHERE a."checkInTime" IS NULL AND a."expectedStart"<=${now}::timestamp))::integer AS missing
        FROM days d JOIN "Location" l ON l.id=d."locationId" AND l."companyId"=${actor.companyId}
        LEFT JOIN "Attendance" a ON a."locationId"=d."locationId" AND a.date>=d.start_at AND a.date<d.end_at
        GROUP BY d."locationId",d.offset_day
      ), staff_counts AS (
        SELECT s."locationId",count(*)::integer AS staff FROM "Staff" s
        WHERE s."companyId"=${actor.companyId} AND s."isActive" GROUP BY s."locationId"
      )
      SELECT t.*,t.offset_day AS "offset",a."scheduledShifts",a.present,a.late,a.missing,COALESCE(s.staff,0)::integer AS staff
      FROM task_counts t JOIN attendance_counts a USING("locationId",offset_day)
      LEFT JOIN staff_counts s USING("locationId") ORDER BY t."locationId",t.offset_day
    `);
  }
  const summarized=summarizePerformance(scope.selected,rows,query.period);
  const reference=scope.days[0];
  return { ...scope, period:query.period, ...summarized,
    dateFrom: reference ? windows.find(day=>day.locationId===reference.locationId&&day.offset===1-query.period)!.localDate : null,
    dateTo:reference?.localDate??null,
    series:summarized.series.map(point=>({...point,date:reference?addUtcDays(new Date(`${reference.localDate}T12:00:00Z`),point.offset).toISOString().slice(0,10):null})),
  };
}
