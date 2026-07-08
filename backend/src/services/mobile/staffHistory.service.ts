import { Prisma } from '@prisma/client';
import { formatInTimeZone } from 'date-fns-tz';
import { z } from 'zod';
import { prisma } from '../../prisma/prisma.js';
import { ApiError } from '../../utils/ApiError.js';
import { isValidTimeZone } from '../../utils/dateTime.js';
import type { VerificationActor } from '../verification-v2/authorization.service.js';
import { staffMonthContext } from './staffMonth.js';

export const HISTORY_FILTERS = ['all', 'verified', 'waiting', 'missed'] as const;
export type HistoryFilter = typeof HISTORY_FILTERS[number];
export type TaskHistoryStatus = 'MISSED' | 'VERIFIED' | 'ACCEPTED_WITH_EXCEPTIONS' | 'WAITING_FOR_REVIEW' | 'SUBMITTED';
export type ReviewState = 'NOT_NEEDED' | 'OPEN' | 'CLOSED';

/** Assignment statuses that make a task part of the actor's history even after it moved to someone else. */
export const HISTORY_ASSIGNMENT_STATUSES = ['STARTED', 'COMPLETED', 'MISSED', 'FAILED'] as const;
const REFRESH_HISTORY = 'Refresh your history';

const inputSchema = z.object({
  month: z.string().max(32).optional(),
  filter: z.enum(HISTORY_FILTERS).default('all'),
  cursor: z.string().min(1).max(512).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(30),
});
const cursorSchema = z.object({
  month: z.string(), filter: z.enum(HISTORY_FILTERS),
  date: z.iso.datetime(), shiftStart: z.iso.datetime(), id: z.number().int().positive(),
});
type HistoryCursor = z.infer<typeof cursorSchema>;

const historyTaskSelect = (actorId: number) => ({
  id: true, title: true, areaNameSnapshot: true, date: true, shiftStart: true, shiftEnd: true,
  status: true, staffSubmittedAt: true, startedAt: true, completionOutcome: true, staffId: true,
  location: { select: { id: true, name: true, timezone: true } },
  // Only the actor's own assignments; the current one first, then the newest.
  assignments: { where: { staffId: actorId }, select: { status: true, isCurrent: true },
    orderBy: [{ isCurrent: 'desc' }, { id: 'desc' }] },
  verificationException: { select: { state: true } },
  // Mandatory evidence on mandatory items only (the same rule as staff submission).
  verificationItems: { where: { mandatory: true },
    select: { requirements: { where: { mandatory: true }, select: { state: true } } } },
}) satisfies Prisma.TaskInstanceSelect;
type HistoryTask = Prisma.TaskInstanceGetPayload<{ select: ReturnType<typeof historyTaskSelect> }>;

export type StaffHistoryDb = Pick<typeof prisma, 'staff' | 'taskInstance'>;

const encodeCursor = (cursor: HistoryCursor) => Buffer.from(JSON.stringify(cursor)).toString('base64url');
function decodeCursor(input: string, month: string, filter: HistoryFilter) {
  let cursor: HistoryCursor;
  try { cursor = cursorSchema.parse(JSON.parse(Buffer.from(input, 'base64url').toString('utf8'))); }
  catch { throw new ApiError(400, REFRESH_HISTORY); }
  if (cursor.month !== month || cursor.filter !== filter) throw new ApiError(400, REFRESH_HISTORY);
  return cursor;
}

/**
 * Applies the `ARCHITECTURE.md#api` status rules from the actor's point of view.
 * A submission or outcome only counts as the actor's when the task is still
 * theirs or their own assignment completed, so another staff member's result
 * on a reassigned task never appears in this history. Returns null for work
 * that is still open (it lives in the Tasks tab) or is not the actor's.
 */
export function classifyHistoryTask(task: Pick<HistoryTask, 'status' | 'staffId' | 'staffSubmittedAt' | 'completionOutcome' | 'assignments' | 'verificationException'>, actorId: number) {
  const ownsTask = task.staffId === actorId;
  const responsible = ownsTask || task.assignments.some(a => (HISTORY_ASSIGNMENT_STATUSES as readonly string[]).includes(a.status));
  if (!responsible) return null;
  const assignment = task.assignments[0];
  const ownsOutcome = ownsTask || assignment?.status === 'COMPLETED';
  const submitted = ownsOutcome && (task.staffSubmittedAt !== null || task.status === 'COMPLETED');
  const exceptionState = task.verificationException?.state;
  const reviewState: ReviewState = !exceptionState ? 'NOT_NEEDED' : exceptionState === 'RESOLVED' ? 'CLOSED' : 'OPEN';
  let status: TaskHistoryStatus | null = null;
  if (!submitted && ((ownsTask && task.status === 'MISSED') || assignment?.status === 'MISSED' || assignment?.status === 'FAILED')) status = 'MISSED';
  else if (ownsOutcome && task.completionOutcome === 'VERIFIED_COMPLETE') status = 'VERIFIED';
  else if (ownsOutcome && task.completionOutcome === 'COMPLETED_WITH_EXCEPTIONS') status = 'ACCEPTED_WITH_EXCEPTIONS';
  else if (submitted && exceptionState && exceptionState !== 'RESOLVED') status = 'WAITING_FOR_REVIEW';
  else if (submitted) status = 'SUBMITTED';
  return status ? { status, reviewState } : null;
}

const matchesFilter = (status: TaskHistoryStatus, filter: HistoryFilter) =>
  filter === 'all'
  || (filter === 'verified' && (status === 'VERIFIED' || status === 'ACCEPTED_WITH_EXCEPTIONS'))
  || (filter === 'waiting' && (status === 'WAITING_FOR_REVIEW' || status === 'SUBMITTED'))
  || (filter === 'missed' && status === 'MISSED');

/** Positive when `a` comes after `b` in the history order: date desc, shiftStart desc, id desc. */
const compareDesc = (a: { date: Date; shiftStart: Date; id: number }, b: { date: Date; shiftStart: Date; id: number }) =>
  (b.date.getTime() - a.date.getTime()) || (b.shiftStart.getTime() - a.shiftStart.getTime()) || (b.id - a.id);

/**
 * Read-only month of the actor's finished and missed tasks for `GET /history`.
 * One task read covers the month: counts need every row and a staff member has
 * at most a few hundred tasks a month. Returns no photos, scores, issue reasons
 * or notes. The route adds the response envelope.
 */
export async function staffTaskHistory(actor: VerificationActor, input: unknown, now = new Date(), db: StaffHistoryDb = prisma) {
  if (actor.role !== 'STAFF') throw new ApiError(403, 'Staff account required');
  const q = inputSchema.parse(input ?? {});
  const context = await staffMonthContext(actor, q.month, now, db);
  const cursor = q.cursor ? decodeCursor(q.cursor, context.month, q.filter) : null;

  const tasks = await db.taskInstance.findMany({
    where: {
      location: { companyId: actor.companyId },
      isActive: true,
      status: { not: 'CANCELLED' },
      date: { gte: context.start, lt: context.end },
      OR: [
        { staffId: actor.id },
        { assignments: { some: { staffId: actor.id, status: { in: [...HISTORY_ASSIGNMENT_STATUSES] } } } },
      ],
    },
    select: historyTaskSelect(actor.id),
  });

  const counts = { verified: 0, waiting: 0, missed: 0, total: 0 };
  const rows = tasks.flatMap(task => {
    const classified = classifyHistoryTask(task, actor.id);
    if (!classified) return [];
    counts.total += 1;
    if (matchesFilter(classified.status, 'verified')) counts.verified += 1;
    else if (matchesFilter(classified.status, 'waiting')) counts.waiting += 1;
    else counts.missed += 1;
    return matchesFilter(classified.status, q.filter) ? [{ task, ...classified }] : [];
  }).sort((a, b) => compareDesc(a.task, b.task));

  const after = cursor ? { date: new Date(cursor.date), shiftStart: new Date(cursor.shiftStart), id: cursor.id } : null;
  const remaining = after ? rows.filter(row => compareDesc(row.task, after) > 0) : rows;
  const page = remaining.slice(0, q.limit);
  const last = page.at(-1)?.task;

  return {
    month: context.month,
    timezone: context.timezone,
    range: context.range,
    counts,
    items: page.map(({ task, status, reviewState }) => {
      const zone = isValidTimeZone(task.location.timezone) ? task.location.timezone : context.timezone;
      const required = task.verificationItems.flatMap(item => item.requirements);
      return {
        id: task.id,
        areaName: task.areaNameSnapshot || task.title,
        title: task.title,
        date: formatInTimeZone(task.date, zone, 'yyyy-MM-dd'),
        shiftStart: task.shiftStart.toISOString(),
        shiftEnd: task.shiftEnd.toISOString(),
        timezone: task.location.timezone,
        status,
        reviewState,
        startedAt: task.startedAt?.toISOString() ?? null,
        submittedAt: task.staffSubmittedAt?.toISOString() ?? null,
        photos: { received: required.filter(r => r.state !== 'MISSING').length, required: required.length },
        location: { id: task.location.id, name: task.location.name },
      };
    }),
    nextCursor: remaining.length > q.limit && last
      ? encodeCursor({ month: context.month, filter: q.filter, date: last.date.toISOString(), shiftStart: last.shiftStart.toISOString(), id: last.id })
      : null,
  };
}
