import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('../../prisma/prisma.js', () => ({ prisma: {} }));
import { staffMonthContext, type StaffMonthDb } from './staffMonth.js';

const findFirst = vi.fn();
const db = { staff: { findFirst } } as unknown as StaffMonthDb;
const staffActor = { id: 7, companyId: 42, role: 'STAFF' as const };
// 2026-11-30T20:00Z is already 1 December in Karachi (UTC+5).
const now = new Date('2026-11-30T20:00:00Z');
const staffRow = (createdAt: string, timezone: string | null = 'Asia/Karachi') => ({
  id: 7, companyId: 42, createdAt: new Date(createdAt), locationId: timezone ? 3 : null,
  location: timezone ? { id: 3, name: 'Main', timezone, isActive: true } : null,
});

beforeEach(() => { vi.resetAllMocks(); });

describe('staffMonthContext', () => {
  it('scopes the staff read to the actor, the tenant and an active account and company', async () => {
    findFirst.mockResolvedValue(staffRow('2025-01-10T00:00:00Z'));
    await staffMonthContext(staffActor, undefined, now, db);
    expect(findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 7, companyId: 42, isActive: true, company: { isActive: true } },
    }));
  });

  it('defaults to the current month in Asia/Karachi and returns its UTC bounds', async () => {
    findFirst.mockResolvedValue(staffRow('2025-01-10T00:00:00Z'));
    const context = await staffMonthContext(staffActor, undefined, now, db);
    expect(context.timezone).toBe('Asia/Karachi');
    expect(context.month).toBe('2026-12');
    expect(context.range).toEqual({ earliestMonth: '2025-12', latestMonth: '2026-12' });
    expect(context.start.toISOString()).toBe('2026-11-30T19:00:00.000Z');
    expect(context.end.toISOString()).toBe('2026-12-31T19:00:00.000Z');
  });

  it('uses Asia/Karachi when the staff member has no location', async () => {
    findFirst.mockResolvedValue(staffRow('2025-01-10T00:00:00Z', null));
    const context = await staffMonthContext(staffActor, '', now, db);
    expect(context.timezone).toBe('Asia/Karachi');
    expect(context.month).toBe('2026-12');
  });

  it('uses the location timezone for the current month', async () => {
    findFirst.mockResolvedValue(staffRow('2025-01-10T00:00:00Z', 'UTC'));
    const context = await staffMonthContext(staffActor, undefined, now, db);
    expect(context.month).toBe('2026-11');
    expect(context.start.toISOString()).toBe('2026-11-01T00:00:00.000Z');
  });

  it('accepts a month inside the range', async () => {
    findFirst.mockResolvedValue(staffRow('2026-03-15T00:00:00Z'));
    const context = await staffMonthContext(staffActor, '2026-03', now, db);
    expect(context.month).toBe('2026-03');
    expect(context.range.earliestMonth).toBe('2026-03');
  });

  it('rejects a month before the staff member was created', async () => {
    findFirst.mockResolvedValue(staffRow('2026-03-15T00:00:00Z'));
    await expect(staffMonthContext(staffActor, '2026-02', now, db))
      .rejects.toMatchObject({ statusCode: 400, message: 'Choose a month from your history' });
  });

  it('rejects a month more than 12 months back', async () => {
    findFirst.mockResolvedValue(staffRow('2020-01-01T00:00:00Z'));
    await expect(staffMonthContext(staffActor, '2025-12', now, db)).resolves.toMatchObject({ month: '2025-12' });
    await expect(staffMonthContext(staffActor, '2025-11', now, db))
      .rejects.toMatchObject({ statusCode: 400, message: 'Choose a month from your history' });
  });

  it.each(['2027-01', '2026-13', '2026-1', 'december', 202612])('rejects %s', async month => {
    findFirst.mockResolvedValue(staffRow('2020-01-01T00:00:00Z'));
    await expect(staffMonthContext(staffActor, month, now, db)).rejects.toMatchObject({ statusCode: 400 });
  });

  it.each(['MANAGER', 'ADMIN'] as const)('rejects a %s actor with 403 before any read', async role => {
    await expect(staffMonthContext({ ...staffActor, role }, undefined, now, db))
      .rejects.toMatchObject({ statusCode: 403, message: 'Staff account required' });
    expect(findFirst).not.toHaveBeenCalled();
  });

  it('rejects a staff actor without an active staff row', async () => {
    findFirst.mockResolvedValue(null);
    await expect(staffMonthContext(staffActor, undefined, now, db))
      .rejects.toMatchObject({ statusCode: 403, message: 'Active staff account required' });
  });
});
