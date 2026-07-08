import { beforeEach, describe, expect, it, vi } from 'vitest';
const db = vi.hoisted(() => ({
  staff: { findFirst: vi.fn() },
  managerLocation: { findFirst: vi.fn() },
  attendance: { count: vi.fn() },
  taskInstance: { count: vi.fn() },
}));
vi.mock('../../prisma/prisma.js', () => ({ prisma: db }));
import { staffProfileSummary } from './staffProfileSummary.service.js';
import { WEEKDAYS } from '../../utils/workDays.js';

const actor = { id: 7, companyId: 42, role: 'STAFF' as const };
// 2026-11-20T10:00Z is 15:00 on 20 November in Karachi (UTC+5).
const now = new Date('2026-11-20T10:00:00Z');
const karachiNovember = { gte: new Date('2026-10-31T19:00:00Z'), lt: new Date('2026-11-30T19:00:00Z') };
const location = { id: 3, name: 'Main hall', address: '12 Mall Road', timezone: 'Asia/Karachi', isActive: true };
const createdAt = new Date('2025-01-01T00:00:00Z');
const workDays = ['MON', 'WED'];
const monthRow = (loc: typeof location | null) => ({ id: 7, companyId: 42, createdAt, locationId: loc?.id ?? null, location: loc });
const profileRow = (loc: typeof location | null, overrides: Record<string, unknown> = {}) => ({
  id: 7, name: 'Ayesha Khan', email: 'ayesha@example.com', phone: '+92 300 0000000', createdAt,
  // 04:00Z and 12:00Z are 09:00 and 17:00 in Karachi.
  shiftStart: new Date('1970-01-01T04:00:00Z'), shiftEnd: new Date('1970-01-01T12:00:00Z'),
  workDays, company: { name: 'Clean Co' }, location: loc,
  ...overrides,
});
/** `staffMonthContext` reads first with its own select; the profile read selects `name`. */
const givenStaff = (loc: typeof location | null, overrides: Record<string, unknown> = {}) =>
  db.staff.findFirst.mockImplementation(async (args: { select: Record<string, unknown> }) =>
    'name' in args.select ? profileRow(loc, overrides) : monthRow(loc));

const profileCall = () => db.staff.findFirst.mock.calls.find(([args]) => 'name' in args.select)![0];
const attendanceWheres = () => db.attendance.count.mock.calls.map(([args]) => args.where);
const taskWheres = () => db.taskInstance.count.mock.calls.map(([args]) => args.where);

beforeEach(() => {
  vi.resetAllMocks();
  givenStaff(location);
  db.managerLocation.findFirst.mockResolvedValue({ manager: { name: 'Bilal Ahmed' } });
  db.attendance.count.mockResolvedValue(0);
  db.taskInstance.count.mockResolvedValue(0);
});

describe('staffProfileSummary', () => {
  it('guards the staff read like getStaffSelfProfile and selects no credential field', async () => {
    await staffProfileSummary(actor, now);
    const { where, select } = profileCall();
    expect(where).toEqual({ id: 7, companyId: 42, role: 'STAFF', isActive: true, company: { isActive: true } });
    expect(Object.keys(select).sort()).toEqual(['company', 'createdAt', 'email', 'id', 'location', 'name', 'phone', 'shiftEnd', 'shiftStart', 'workDays']);
    for (const field of ['password', 'refreshToken', 'credentialVersion', 'credentialTokens', 'mustChangePassword', 'pushDevices']) {
      expect(select).not.toHaveProperty(field);
    }
    expect(select.company).toEqual({ select: { name: true } });
    expect(select.location).toEqual({ select: { id: true, name: true, address: true, timezone: true, isActive: true } });
  });

  it('returns the profile shape from the contract', async () => {
    const result = await staffProfileSummary(actor, now);
    expect(result).toEqual({
      id: 7, name: 'Ayesha Khan', email: 'ayesha@example.com', phone: '+92 300 0000000',
      joinedAt: '2025-01-01T00:00:00.000Z',
      company: { name: 'Clean Co' },
      location: { id: 3, name: 'Main hall', address: '12 Mall Road', timezone: 'Asia/Karachi' },
      usualShift: { start: '09:00', end: '17:00', days: workDays },
      manager: { name: 'Bilal Ahmed' },
      month: { month: '2026-11', shiftsScheduled: 0, shiftsAttended: 0, onTime: 0, tasksAssigned: 0, tasksSubmitted: 0 },
    });
  });

  it('looks the manager up by the staff location and company and returns only the name', async () => {
    db.managerLocation.findFirst.mockResolvedValue({ manager: { id: 9, name: 'Bilal Ahmed', email: 'b@example.com', phone: '123', password: 'hash' } });
    const result = await staffProfileSummary(actor, now);
    expect(db.managerLocation.findFirst).toHaveBeenCalledTimes(1);
    expect(db.managerLocation.findFirst.mock.calls[0]![0]).toEqual({
      where: { locationId: 3, location: { companyId: 42 }, manager: { isActive: true, companyId: 42 } },
      select: { manager: { select: { name: true } } },
    });
    expect(result.manager).toEqual({ name: 'Bilal Ahmed' });
    expect(JSON.stringify(result)).not.toMatch(/b@example\.com|"123"|hash/);
  });

  it('returns a null manager when no active manager is linked', async () => {
    db.managerLocation.findFirst.mockResolvedValue(null);
    expect((await staffProfileSummary(actor, now)).manager).toBeNull();
  });

  it('with no location gives null location and manager and the Asia/Karachi month', async () => {
    givenStaff(null);
    // 2026-11-30T20:00Z is already 1 December in Karachi.
    const result = await staffProfileSummary(actor, new Date('2026-11-30T20:00:00Z'));
    expect(result.location).toBeNull();
    expect(result.manager).toBeNull();
    expect(db.managerLocation.findFirst).not.toHaveBeenCalled();
    expect(result.month.month).toBe('2026-12');
    expect(result.usualShift).toEqual({ start: '09:00', end: '17:00', days: workDays });
    expect(attendanceWheres()[0].date).toEqual({ gte: new Date('2026-11-30T19:00:00Z'), lt: new Date('2026-12-31T19:00:00Z') });
  });

  it('reads the usual shift in the location timezone', async () => {
    // Read on the stored instant's own date, as getZonedClockMinutes does (London is UTC+0 in November).
    givenStaff({ ...location, timezone: 'Europe/London' },
      { shiftStart: new Date('2026-11-02T08:30:00Z'), shiftEnd: new Date('2026-11-02T16:45:00Z') });
    const result = await staffProfileSummary(actor, now);
    expect(result.usualShift).toEqual({ start: '08:30', end: '16:45', days: workDays });
    expect(result.location!.timezone).toBe('Europe/London');
  });

  it('returns canonical days and defaults a missing list to all seven days', async () => {
    givenStaff(location, { workDays: ['WED', 'MON', 'WED'] });
    expect((await staffProfileSummary(actor, now)).usualShift?.days).toEqual(workDays);
    givenStaff(location, { workDays: undefined });
    expect((await staffProfileSummary(actor, now)).usualShift?.days).toEqual(WEEKDAYS);
  });

  it('returns a null usual shift when either end is missing, and a null phone', async () => {
    givenStaff(location, { shiftEnd: null, phone: null });
    const result = await staffProfileSummary(actor, now);
    expect(result.usualShift).toBeNull();
    expect(result.phone).toBeNull();
  });

  it('counts attendance for the actor, company and month, excluding shifts that have not started', async () => {
    db.attendance.count.mockResolvedValueOnce(14).mockResolvedValueOnce(12).mockResolvedValueOnce(10);
    const result = await staffProfileSummary(actor, now);
    expect(db.attendance.count).toHaveBeenCalledTimes(3);
    const base = {
      staffId: 7,
      staff: { companyId: 42, role: 'STAFF', isActive: true, company: { isActive: true } },
      location: { companyId: 42 },
      date: karachiNovember,
      expectedStart: { lte: now },
    };
    const [scheduled, attended, onTime] = attendanceWheres();
    expect(scheduled).toEqual({ ...base, OR: [{ checkInTime: { not: null } }, { expectedEnd: { lt: now } }] });
    expect(attended).toEqual({ ...base, checkInTime: { not: null } });
    expect(onTime).toEqual({ ...base, checkInTime: { not: null }, isLateCheckIn: false, status: { not: 'LATE' } });
    expect(result.month).toMatchObject({ shiftsScheduled: 14, shiftsAttended: 12, onTime: 10 });
  });

  it('does not count a started shift with no check-in yet until the staff member checks in', async () => {
    // Evaluates the scalar filters these count queries use against crafted rows
    // (relation scopes are asserted above, so they are skipped here).
    type Filter = { not?: unknown; lte?: Date; lt?: Date; gte?: Date };
    const matches = (row: Record<string, unknown>, where: Record<string, unknown>): boolean =>
      Object.entries(where).every(([key, filter]) => {
        if (key === 'OR') return (filter as Record<string, unknown>[]).some(part => matches(row, part));
        if (key === 'staff' || key === 'location') return true;
        const value = row[key];
        if (filter === null || typeof filter !== 'object' || filter instanceof Date) return value === filter;
        const f = filter as Filter;
        if ('not' in f && value === f.not) return false;
        const at = value instanceof Date ? value.getTime() : NaN;
        if (f.lte && !(at <= f.lte.getTime())) return false;
        if (f.lt && !(at < f.lt.getTime())) return false;
        if (f.gte && !(at >= f.gte.getTime())) return false;
        return true;
      });
    // Karachi 20 November, shift 09:00-17:00 local; now is 15:00 local, so the shift is in progress.
    const shift = {
      staffId: 7, date: new Date('2026-11-19T19:00:00Z'),
      expectedStart: new Date('2026-11-20T04:00:00Z'), expectedEnd: new Date('2026-11-20T12:00:00Z'),
      checkInTime: null as Date | null, status: 'ABSENT', isLateCheckIn: false,
    };
    const countWith = (rows: Record<string, unknown>[]) =>
      db.attendance.count.mockImplementation(async ({ where }: { where: Record<string, unknown> }) =>
        rows.filter(row => matches(row, where)).length);

    countWith([shift]);
    const before = await staffProfileSummary(actor, now);
    expect(before.month).toMatchObject({ shiftsScheduled: 0, shiftsAttended: 0, onTime: 0 });

    countWith([{ ...shift, checkInTime: new Date('2026-11-20T03:58:00Z'), status: 'CHECKED_IN' }]);
    const after = await staffProfileSummary(actor, now);
    expect(after.month).toMatchObject({ shiftsScheduled: 1, shiftsAttended: 1, onTime: 1 });

    // Once the shift has ended without a check-in it counts as scheduled and not attended.
    countWith([shift]);
    const ended = await staffProfileSummary(actor, new Date('2026-11-20T12:30:00Z'));
    expect(ended.month).toMatchObject({ shiftsScheduled: 1, shiftsAttended: 0, onTime: 0 });
  });

  it('counts the actor’s active, non-cancelled tasks in the month and those submitted', async () => {
    db.taskInstance.count.mockResolvedValueOnce(30).mockResolvedValueOnce(21);
    const result = await staffProfileSummary(actor, now);
    expect(db.taskInstance.count).toHaveBeenCalledTimes(2);
    const base = { staffId: 7, location: { companyId: 42 }, isActive: true, status: { not: 'CANCELLED' }, date: karachiNovember };
    const [assigned, submitted] = taskWheres();
    expect(assigned).toEqual(base);
    expect(submitted).toEqual({ ...base, OR: [{ staffSubmittedAt: { not: null } }, { status: 'COMPLETED' }] });
    expect(result.month).toMatchObject({ tasksAssigned: 30, tasksSubmitted: 21 });
  });

  it('rejects a manager before any read', async () => {
    await expect(staffProfileSummary({ ...actor, role: 'MANAGER' }, now)).rejects.toMatchObject({ statusCode: 403 });
    expect(db.staff.findFirst).not.toHaveBeenCalled();
    expect(db.managerLocation.findFirst).not.toHaveBeenCalled();
    expect(db.attendance.count).not.toHaveBeenCalled();
    expect(db.taskInstance.count).not.toHaveBeenCalled();
  });

  it('is 403 when the active staff profile is not found, without counting', async () => {
    db.staff.findFirst.mockImplementation(async (args: { select: Record<string, unknown> }) =>
      'name' in args.select ? null : monthRow(location));
    await expect(staffProfileSummary(actor, now)).rejects.toMatchObject({ statusCode: 403 });
    expect(db.attendance.count).not.toHaveBeenCalled();
    expect(db.taskInstance.count).not.toHaveBeenCalled();
  });
});
