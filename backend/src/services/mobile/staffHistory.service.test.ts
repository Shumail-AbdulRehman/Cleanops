import { beforeEach, describe, expect, it, vi } from 'vitest';
const db = vi.hoisted(() => ({ staff: { findFirst: vi.fn() }, taskInstance: { findMany: vi.fn() } }));
vi.mock('../../prisma/prisma.js', () => ({ prisma: db }));
import { staffTaskHistory } from './staffHistory.service.js';

const actor = { id: 7, companyId: 42, role: 'STAFF' as const };
const now = new Date('2026-11-20T10:00:00Z');
const location = { id: 3, name: 'Main hall', timezone: 'Asia/Karachi' };
type Row = Record<string, unknown> & { id: number };
// Karachi day anchors: local midnight is 19:00Z on the previous UTC day.
const task = (id: number, day: number, overrides: Partial<Row> = {}): Row => ({
  id, title: `Task ${id}`, areaNameSnapshot: `Area ${id}`,
  date: new Date(Date.UTC(2026, 10, day - 1, 19)),
  shiftStart: new Date(Date.UTC(2026, 10, day, 4)), shiftEnd: new Date(Date.UTC(2026, 10, day, 6)),
  status: 'COMPLETED', staffSubmittedAt: new Date(Date.UTC(2026, 10, day, 5)), startedAt: new Date(Date.UTC(2026, 10, day, 4, 10)),
  completionOutcome: null, staffId: 7, location,
  assignments: [{ status: 'COMPLETED', isCurrent: true }], verificationException: null,
  verificationItems: [{ requirements: [{ state: 'PASSED' }, { state: 'MISSING' }] }],
  ...overrides,
});

const history = (input: Record<string, unknown> = {}) => staffTaskHistory(actor, input, now);
const statusById = (items: { id: number; status: string; reviewState: string }[]) =>
  Object.fromEntries(items.map(item => [item.id, [item.status, item.reviewState]]));

beforeEach(() => {
  vi.resetAllMocks();
  db.staff.findFirst.mockResolvedValue({ id: 7, companyId: 42, createdAt: new Date('2025-01-01T00:00:00Z'), locationId: 3, location: { ...location, isActive: true } });
  db.taskInstance.findMany.mockResolvedValue([]);
});

describe('staffTaskHistory', () => {
  it('scopes the one task read to the tenant, the month, live tasks and the actor', async () => {
    await history();
    expect(db.taskInstance.findMany).toHaveBeenCalledTimes(1);
    const { where, select } = db.taskInstance.findMany.mock.calls[0]![0];
    expect(where).toEqual({
      location: { companyId: 42 },
      isActive: true,
      status: { not: 'CANCELLED' },
      date: { gte: new Date('2026-10-31T19:00:00Z'), lt: new Date('2026-11-30T19:00:00Z') },
      OR: [
        { staffId: 7 },
        { assignments: { some: { staffId: 7, status: { in: ['STARTED', 'COMPLETED', 'MISSED', 'FAILED'] } } } },
      ],
    });
    expect(select.assignments.where).toEqual({ staffId: 7 });
    expect(select).not.toHaveProperty('proofImageUrls');
    expect(select).not.toHaveProperty('referenceImageUrl');
    expect(select).not.toHaveProperty('evidenceAssets');
  });

  it('rejects a manager before any read', async () => {
    await expect(staffTaskHistory({ ...actor, role: 'MANAGER' }, {}, now)).rejects.toMatchObject({ statusCode: 403 });
    expect(db.staff.findFirst).not.toHaveBeenCalled();
    expect(db.taskInstance.findMany).not.toHaveBeenCalled();
  });

  it('produces every status and review state and drops open work', async () => {
    db.taskInstance.findMany.mockResolvedValue([
      task(1, 10, { status: 'MISSED', staffSubmittedAt: null, startedAt: null, assignments: [{ status: 'MISSED', isCurrent: true }] }),
      task(2, 11, { completionOutcome: 'VERIFIED_COMPLETE' }),
      task(3, 12, { completionOutcome: 'COMPLETED_WITH_EXCEPTIONS', verificationException: { state: 'RESOLVED' } }),
      task(4, 13, { status: 'IN_PROGRESS', verificationException: { state: 'MANAGER_REVIEW' } }),
      task(5, 14, { completionOutcome: 'LEGACY_RECORDED' }),
      task(6, 15, { status: 'IN_PROGRESS', staffSubmittedAt: null, assignments: [{ status: 'STARTED', isCurrent: true }] }),
      task(7, 16, { status: 'PENDING', staffSubmittedAt: null, startedAt: null, assignments: [{ status: 'ASSIGNED', isCurrent: true }] }),
      task(8, 17, { status: 'PENDING', staffSubmittedAt: null, staffId: null, assignments: [{ status: 'FAILED', isCurrent: false }] }),
    ]);
    const result = await history();
    expect(statusById(result.items)).toEqual({
      1: ['MISSED', 'NOT_NEEDED'],
      2: ['VERIFIED', 'NOT_NEEDED'],
      3: ['ACCEPTED_WITH_EXCEPTIONS', 'CLOSED'],
      4: ['WAITING_FOR_REVIEW', 'OPEN'],
      5: ['SUBMITTED', 'NOT_NEEDED'],
      8: ['MISSED', 'NOT_NEEDED'],
    });
    expect(result.counts).toEqual({ verified: 2, waiting: 2, missed: 2, total: 6 });
  });

  it('excludes a task reassigned away from the actor and never shows another staff member\'s result', async () => {
    db.taskInstance.findMany.mockResolvedValue([
      task(1, 10, { staffId: 9, assignments: [{ status: 'REASSIGNED', isCurrent: false }], completionOutcome: 'VERIFIED_COMPLETE' }),
      task(2, 11, { staffId: 9, assignments: [{ status: 'FAILED', isCurrent: false }], completionOutcome: 'VERIFIED_COMPLETE' }),
    ]);
    const result = await history();
    expect(statusById(result.items)).toEqual({ 2: ['MISSED', 'NOT_NEEDED'] });
    expect(result.counts.total).toBe(1);
  });

  it('shapes an item with local date, instants and photo counts only', async () => {
    db.taskInstance.findMany.mockResolvedValue([task(5, 14, { areaNameSnapshot: null })]);
    const result = await history();
    expect(result).toMatchObject({ month: '2026-11', timezone: 'Asia/Karachi', range: { earliestMonth: '2025-11', latestMonth: '2026-11' }, nextCursor: null });
    expect(result.items[0]).toEqual({
      id: 5, areaName: 'Task 5', title: 'Task 5', date: '2026-11-14',
      shiftStart: '2026-11-14T04:00:00.000Z', shiftEnd: '2026-11-14T06:00:00.000Z', timezone: 'Asia/Karachi',
      status: 'SUBMITTED', reviewState: 'NOT_NEEDED',
      startedAt: '2026-11-14T04:10:00.000Z', submittedAt: '2026-11-14T05:00:00.000Z',
      photos: { received: 1, required: 2 }, location: { id: 3, name: 'Main hall' },
    });
  });

  it('counts ignore the filter', async () => {
    db.taskInstance.findMany.mockResolvedValue([
      task(1, 10, { status: 'MISSED', staffSubmittedAt: null, assignments: [] }),
      task(2, 11, { completionOutcome: 'VERIFIED_COMPLETE' }),
      task(3, 12),
    ]);
    const missed = await history({ filter: 'missed' });
    expect(missed.items.map(i => i.id)).toEqual([1]);
    expect(missed.counts).toEqual({ verified: 1, waiting: 1, missed: 1, total: 3 });
    const verified = await history({ filter: 'verified' });
    expect(verified.items.map(i => i.id)).toEqual([2]);
    expect(verified.counts).toEqual(missed.counts);
  });

  it('pages newest first with an opaque cursor and no repeats', async () => {
    db.taskInstance.findMany.mockResolvedValue([
      task(1, 10), task(2, 12), task(3, 12, { shiftStart: new Date(Date.UTC(2026, 10, 12, 8)) }), task(4, 11), task(5, 12),
    ]);
    const first = await history({ limit: 2 });
    expect(first.items.map(i => i.id)).toEqual([3, 5]);
    expect(first.nextCursor).toEqual(expect.any(String));
    const second = await history({ limit: 2, cursor: first.nextCursor });
    expect(second.items.map(i => i.id)).toEqual([2, 4]);
    const third = await history({ limit: 2, cursor: second.nextCursor });
    expect(third.items.map(i => i.id)).toEqual([1]);
    expect(third.nextCursor).toBeNull();
  });

  it('rejects a cursor for another month or filter, or a broken cursor', async () => {
    db.taskInstance.findMany.mockResolvedValue([task(1, 10), task(2, 11), task(3, 12)]);
    const { nextCursor } = await history({ limit: 2 });
    await expect(history({ month: '2026-10', cursor: nextCursor })).rejects.toMatchObject({ statusCode: 400, message: 'Refresh your history' });
    await expect(history({ filter: 'waiting', cursor: nextCursor })).rejects.toMatchObject({ statusCode: 400, message: 'Refresh your history' });
    await expect(history({ cursor: 'not-a-cursor' })).rejects.toMatchObject({ statusCode: 400, message: 'Refresh your history' });
  });

  it('never returns a field named like an image, url, score or note', async () => {
    db.taskInstance.findMany.mockResolvedValue([
      task(1, 10, { proofImageUrls: ['https://x/y.jpg'], referenceImageUrl: 'https://x/z.jpg', aiScore: 9, managerNote: 'n' }),
      task(2, 11, { completionOutcome: 'VERIFIED_COMPLETE' }),
    ]);
    const result = await history({ limit: 1 });
    const keys: string[] = [];
    const walk = (value: unknown) => {
      if (Array.isArray(value)) value.forEach(walk);
      else if (value && typeof value === 'object') Object.entries(value).forEach(([key, child]) => { keys.push(key); walk(child); });
    };
    walk(result);
    expect(keys.length).toBeGreaterThan(10);
    expect(keys.filter(key => /image|url|score|note/i.test(key))).toEqual([]);
  });
});
