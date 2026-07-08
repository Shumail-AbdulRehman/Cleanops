import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../../prisma/prisma.js';
import { ApiError } from '../../utils/ApiError.js';
import { getZonedDayRange } from '../../utils/dateTime.js';
import type { VerificationActor } from '../verification-v2/authorization.service.js';
import { staffTaskPresentation } from '../verification-v2/sequentialPolicy.js';

export const mobileTaskSelect = {
  id: true, title: true, status: true, date: true, shiftStart: true, shiftEnd: true,
  startedAt: true, completedAt: true, staffSubmittedAt: true, verificationVersion: true,
  verificationState: true, areaNameSnapshot: true,
  location: { select: { id: true, name: true, timezone: true } },
  template: { select: { id: true, description: true } },
} satisfies Prisma.TaskInstanceSelect;
type MobileTask = Prisma.TaskInstanceGetPayload<{ select: typeof mobileTaskSelect }>;
export function mobileTaskSummary(t: Omit<MobileTask, 'template'> & { template?: MobileTask['template'] }) {
  return staffTaskPresentation({
    id: t.id, title: t.title, status: t.status, date: t.date,
    shiftStart: t.shiftStart, shiftEnd: t.shiftEnd, startedAt: t.startedAt,
    completedAt: t.completedAt, staffSubmittedAt: t.staffSubmittedAt,
    verificationVersion: t.verificationVersion, verificationState: t.verificationState,
    areaNameSnapshot: t.areaNameSnapshot, proofImageUrls: [],
    location: { id: t.location.id, name: t.location.name, timezone: t.location.timezone },
    ...(t.template ? { template: { id: t.template.id, description: t.template.description } } : {}),
  });
}
const cursorSchema = z.object({ priority: z.number().int().min(0).max(3), start: z.iso.datetime(), id: z.number().int().positive(), day: z.iso.datetime() });
export function mobileTaskCursor(input: string | undefined) {
  if (!input) return null;
  try { return cursorSchema.parse(JSON.parse(Buffer.from(input, 'base64url').toString('utf8'))); }
  catch { throw new ApiError(400, 'Invalid task cursor. Refresh your tasks.'); }
}
const priority = (t: { staffSubmittedAt: Date | null; status: string }) => t.staffSubmittedAt || t.status === 'COMPLETED' ? 2 : t.status === 'IN_PROGRESS' ? 0 : ['PENDING', 'NOT_COMPLETED_INTIME'].includes(t.status) ? 1 : 3;
export async function staffMobileTasks(actor: VerificationActor, input: unknown, now = new Date()) {
  if (actor.role !== 'STAFF') throw new ApiError(403, 'Staff account required');
  const q = z.object({ cursor: z.string().min(1).max(512).optional(), limit: z.coerce.number().int().min(1).max(50).default(50) }).parse(input);
  const cursor = mobileTaskCursor(q.cursor);
  const staff = await prisma.staff.findFirst({
    where: { id: actor.id, companyId: actor.companyId, isActive: true, company: { isActive: true } },
    select: { locationId: true, location: { select: { timezone: true, isActive: true } } },
  });
  if (!staff) throw new ApiError(403, 'Active staff account required');
  const counts = { total: 0, submitted: 0, pending: 0, inProgress: 0 };
  if (!staff.locationId || !staff.location?.isActive) return { tasks: [], counts, nextCursor: null };
  const { start, end } = getZonedDayRange(now, staff.location.timezone);
  // A cursor never extends yesterday's feed into today's local-day window.
  if (cursor && cursor.day !== start.toISOString()) throw new ApiError(409, 'The task day changed. Refresh your tasks.');
  const after = cursor ? Prisma.sql`WHERE (priority,"shiftStart",id)>(${cursor.priority},${new Date(cursor.start)},${cursor.id})` : Prisma.empty;
  // Read only IDs and counters over the indexed staff subset. Fetch card fields
  // for one page below; no inventory, photos, assignment history or AI metadata.
  const [result] = await prisma.$queryRaw<Array<{ ids: number[] | null; counts: typeof counts }>>(Prisma.sql`
    WITH eligible AS MATERIALIZED (
      SELECT t.id,t.status,t."staffSubmittedAt",t."shiftStart",
        CASE WHEN t."staffSubmittedAt" IS NOT NULL OR t.status='COMPLETED' THEN 2
             WHEN t.status='IN_PROGRESS' THEN 0
             WHEN t.status IN ('PENDING','NOT_COMPLETED_INTIME') THEN 1 ELSE 3 END AS priority
      FROM "TaskInstance" t
      WHERE t."staffId"=${actor.id} AND t."locationId"=${staff.locationId} AND t."isActive"
        AND EXISTS (SELECT 1 FROM "Location" l WHERE l.id=t."locationId" AND l."companyId"=${actor.companyId} AND l."isActive")
        AND ((t.date>=${start} AND t.date<${end}) OR
          (t."verificationVersion"=2 AND t."staffSubmittedAt" IS NULL AND t.status IN ('PENDING','IN_PROGRESS','NOT_COMPLETED_INTIME')
           AND EXISTS (SELECT 1 FROM "TaskAssignment" a WHERE a."taskInstanceId"=t.id AND a."staffId"=${actor.id} AND a."isCurrent" AND a.status IN ('ASSIGNED','STARTED'))))
    ), page AS (
      SELECT id,priority,"shiftStart" FROM eligible ${after}
      ORDER BY priority,"shiftStart",id LIMIT ${q.limit + 1}
    )
    SELECT (SELECT array_agg(id ORDER BY priority,"shiftStart",id) FROM page) AS ids,
      json_build_object('total',count(*)::int,
        'submitted',count(*) FILTER (WHERE "staffSubmittedAt" IS NOT NULL OR status='COMPLETED')::int,
        'pending',count(*) FILTER (WHERE "staffSubmittedAt" IS NULL AND status='PENDING')::int,
        'inProgress',count(*) FILTER (WHERE "staffSubmittedAt" IS NULL AND status='IN_PROGRESS')::int) AS counts
    FROM eligible`);
  const ids = result!.ids ?? [];
  const rows = ids.length ? await prisma.taskInstance.findMany({
    where: { id: { in: ids.slice(0, q.limit) }, staffId: actor.id, isActive: true,
      locationId: staff.locationId, location: { companyId: actor.companyId, isActive: true } },
    select: mobileTaskSelect,
  }) : [];
  const byId = new Map(rows.map(row => [row.id, row]));
  const tasks = ids.slice(0, q.limit).flatMap(id => byId.has(id) ? [byId.get(id)!] : []);
  const last = tasks.at(-1);
  return { tasks: tasks.map(mobileTaskSummary), counts: result!.counts,
    nextCursor: ids.length > q.limit && last ? Buffer.from(JSON.stringify({ priority: priority(last), start: last.shiftStart.toISOString(), id: last.id, day: start.toISOString() })).toString('base64url') : null };
}
export async function staffMobileAttendance(actor: VerificationActor) {
  if (actor.role !== 'STAFF') throw new ApiError(403, 'Staff account required');
  return prisma.attendance.findMany({
    where: { staffId: actor.id, staff: { companyId: actor.companyId, isActive: true } },
    orderBy: [{ date: 'desc' }, { id: 'desc' }], take: 30,
    select: { id: true, date: true, status: true, expectedStart: true, expectedEnd: true,
      checkInTime: true, checkOutTime: true, location: { select: { id: true, name: true } } },
  });
}
