import { fixture, ok, type Reply } from './api';

type Json = Record<string, unknown>;
type TaskFeed = { tasks: Json[]; counts: Json; nextCursor: string | null };

/** Today's shift record (09:00 to 17:00 Karachi) with changes. Shaped like `GET /staff/mobile/attendance` rows. */
export function shift(changes: Json = {}): Json {
  const [today] = fixture('attendance').data as Json[];
  return { ...today, ...changes };
}

/** `GET /staff/mobile/attendance` with today's shift first and yesterday's finished shift after it. */
export function attendance(...today: Json[]): Reply {
  const [, yesterday] = fixture('attendance').data as Json[];
  return ok([...today, yesterday]);
}

/** A task from today's feed with changes. Submitted tasks look as the server presents them to staff. */
export function task(id: number, area: string, changes: Json = {}): Json {
  const [base] = (fixture('tasks').data as TaskFeed).tasks;
  const next: Json = { ...base, id, areaNameSnapshot: area, title: `${area} clean`, ...changes };
  if (next.staffSubmittedAt) Object.assign(next, { status: 'COMPLETED', verificationState: 'COMPLETED', completionOutcome: null });
  return next;
}

/** `GET /staff/mobile/tasks` for these tasks, with the counters the server computes. */
export function feed(...tasks: Json[]): Reply {
  const submitted = (t: Json) => Boolean(t.staffSubmittedAt) || t.status === 'COMPLETED';
  return ok({
    tasks,
    counts: {
      total: tasks.length,
      submitted: tasks.filter(submitted).length,
      pending: tasks.filter(t => !submitted(t) && t.status === 'PENDING').length,
      inProgress: tasks.filter(t => !submitted(t) && t.status === 'IN_PROGRESS').length,
    },
    nextCursor: null,
  });
}

export const checkedIn = (changes: Json = {}) => shift({ status: 'CHECKED_IN', checkInTime: '2026-11-12T03:58:00.000Z', ...changes });
export const submittedAt = '2026-11-12T05:40:00.000Z';
