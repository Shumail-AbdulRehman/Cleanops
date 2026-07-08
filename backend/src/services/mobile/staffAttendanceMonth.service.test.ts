import { beforeEach, describe, expect, it, vi } from 'vitest';
const db = vi.hoisted(() => ({ staff: { findFirst: vi.fn() }, attendance: { findMany: vi.fn() } }));
vi.mock('../../prisma/prisma.js', () => ({ prisma: db }));
import { classifyAttendanceDay, staffAttendanceMonth } from './staffAttendanceMonth.service.js';

const actor = { id: 7, companyId: 42, role: 'STAFF' as const };
// 2026-11-20T10:00Z is 15:00 on 20 November in Karachi (UTC+5).
const now = new Date('2026-11-20T10:00:00Z');
const location = { id: 3, name: 'Main hall', timezone: 'Asia/Karachi' };
type Row = Record<string, unknown> & { id: number };
// Karachi day anchors: local midnight is 19:00Z on the previous UTC day. Shift 09:00-17:00 local.
const day = (id: number, dayOfMonth: number, overrides: Partial<Row> = {}): Row => ({
  id, date: new Date(Date.UTC(2026, 10, dayOfMonth - 1, 19)),
  expectedStart: new Date(Date.UTC(2026, 10, dayOfMonth, 4)), expectedEnd: new Date(Date.UTC(2026, 10, dayOfMonth, 12)),
  checkInTime: new Date(Date.UTC(2026, 10, dayOfMonth, 3, 55)), checkOutTime: new Date(Date.UTC(2026, 10, dayOfMonth, 12, 5)),
  status: 'CHECKED_OUT', isLateCheckIn: false, lateMinutes: null, location,
  ...overrides,
});
const late = { isLateCheckIn: true, lateMinutes: 25, checkInTime: new Date('2026-11-01T04:25:00Z') };

const month = (input: Record<string, unknown> = {}) => staffAttendanceMonth(actor, input, now);
const stateOf = (row: Row) => classifyAttendanceDay(row as unknown as Parameters<typeof classifyAttendanceDay>[0], now);

beforeEach(() => {
  vi.resetAllMocks();
  db.staff.findFirst.mockResolvedValue({ id: 7, companyId: 42, createdAt: new Date('2025-01-01T00:00:00Z'), locationId: 3, location: { ...location, isActive: true } });
  db.attendance.findMany.mockResolvedValue([]);
});

describe('staffAttendanceMonth', () => {
  it('scopes the one attendance read to the actor, an active staff account, the tenant and the month', async () => {
    await month();
    expect(db.attendance.findMany).toHaveBeenCalledTimes(1);
    const { where } = db.attendance.findMany.mock.calls[0]![0];
    expect(where).toEqual({
      staffId: 7,
      staff: { companyId: 42, role: 'STAFF', isActive: true, company: { isActive: true } },
      location: { companyId: 42 },
      date: { gte: new Date('2026-10-31T19:00:00Z'), lt: new Date('2026-11-30T19:00:00Z') },
    });
  });

  it('reads the chosen month bounds', async () => {
    await month({ month: '2026-10' });
    const { where } = db.attendance.findMany.mock.calls[0]![0];
    expect(where.date).toEqual({ gte: new Date('2026-09-30T19:00:00Z'), lt: new Date('2026-10-31T19:00:00Z') });
  });

  it('never selects an image field', async () => {
    await month();
    const { select } = db.attendance.findMany.mock.calls[0]![0];
    expect(select).not.toHaveProperty('checkInImage');
    expect(select).not.toHaveProperty('checkOutImage');
    expect(Object.keys(select).sort()).toEqual(['checkInTime', 'checkOutTime', 'date', 'expectedEnd', 'expectedStart', 'id', 'isLateCheckIn', 'lateMinutes', 'location', 'status'].sort());
    expect(select.location).toEqual({ select: { id: true, name: true, timezone: true } });
  });

  it('rejects a manager before any read', async () => {
    await expect(staffAttendanceMonth({ ...actor, role: 'MANAGER' }, {}, now)).rejects.toMatchObject({ statusCode: 403 });
    expect(db.staff.findFirst).not.toHaveBeenCalled();
    expect(db.attendance.findMany).not.toHaveBeenCalled();
  });

  it('rejects a month outside the history range without reading attendance', async () => {
    await expect(month({ month: '2024-01' })).rejects.toMatchObject({ statusCode: 400, message: 'Choose a month from your history' });
    expect(db.attendance.findMany).not.toHaveBeenCalled();
  });

  it('shapes a record with a local date, instants and no image field', async () => {
    db.attendance.findMany.mockResolvedValue([{ ...day(1, 3), checkInImage: 'secret.jpg', checkOutImage: 'secret2.jpg' }]);
    const result = await month();
    expect(result).toMatchObject({ month: '2026-11', timezone: 'Asia/Karachi', range: { earliestMonth: '2025-11', latestMonth: '2026-11' } });
    expect(result.records).toEqual([{
      id: 1, date: '2026-11-03',
      expectedStart: '2026-11-03T04:00:00.000Z', expectedEnd: '2026-11-03T12:00:00.000Z',
      checkInTime: '2026-11-03T03:55:00.000Z', checkOutTime: '2026-11-03T12:05:00.000Z',
      lateMinutes: null, location: { id: 3, name: 'Main hall' }, state: 'ON_TIME',
    }]);
    expect(JSON.stringify(result)).not.toMatch(/image|url|secret/i);
  });
});

describe('classifyAttendanceDay', () => {
  it('a past row with no check-in is ABSENT', () => {
    expect(stateOf(day(1, 5, { checkInTime: null, checkOutTime: null, status: 'ABSENT' }))).toBe('ABSENT');
  });

  it('a MISSED_CHECKOUT row stays MISSED_CHECKOUT even when it was late', () => {
    expect(stateOf(day(1, 5, { ...late, checkOutTime: null, status: 'MISSED_CHECKOUT' }))).toBe('MISSED_CHECKOUT');
  });

  it('a checked-in row whose shift has not ended is ON_SHIFT, late or not', () => {
    expect(stateOf(day(1, 20, { checkInTime: new Date('2026-11-20T03:58:00Z'), checkOutTime: null, status: 'CHECKED_IN' }))).toBe('ON_SHIFT');
    expect(stateOf(day(1, 20, { ...late, checkInTime: new Date('2026-11-20T04:25:00Z'), checkOutTime: null, status: 'LATE' }))).toBe('ON_SHIFT');
  });

  it('a late row is LATE through either the flag or the status', () => {
    expect(stateOf(day(1, 6, late))).toBe('LATE');
    expect(stateOf(day(1, 6, { status: 'LATE' }))).toBe('LATE');
  });

  it('a future row is UPCOMING', () => {
    expect(stateOf(day(1, 25, { checkInTime: null, checkOutTime: null, status: 'ABSENT' }))).toBe('UPCOMING');
  });

  it('a shift in progress without a check-in yet is UPCOMING, not absent or on time', () => {
    expect(stateOf(day(1, 20, { checkInTime: null, checkOutTime: null, status: 'ABSENT' }))).toBe('UPCOMING');
  });

  it('a past checked-in row not yet marked missed checkout keeps its check-in state', () => {
    expect(stateOf(day(1, 6, { checkOutTime: null, status: 'CHECKED_IN' }))).toBe('ON_TIME');
  });
});

describe('staffAttendanceMonth counts', () => {
  it('counts match a crafted month and records are newest first', async () => {
    db.attendance.findMany.mockResolvedValue([
      day(1, 2),                                                                               // ON_TIME
      day(2, 3, late),                                                                         // LATE
      day(3, 4, { checkInTime: null, checkOutTime: null, status: 'ABSENT' }),                  // ABSENT
      day(4, 5, { ...late, checkOutTime: null, status: 'MISSED_CHECKOUT' }),                   // MISSED_CHECKOUT, late
      day(5, 6, { checkOutTime: null, status: 'MISSED_CHECKOUT' }),                            // MISSED_CHECKOUT
      day(6, 9),                                                                               // ON_TIME
      day(7, 10, { status: 'LATE', lateMinutes: 12 }),                                         // LATE
      day(8, 11, { checkInTime: null, checkOutTime: null, status: 'ABSENT' }),                 // ABSENT
      day(9, 20, { checkInTime: new Date('2026-11-20T03:58:00Z'), checkOutTime: null, status: 'CHECKED_IN' }), // ON_SHIFT on time
      day(10, 21, { checkInTime: null, checkOutTime: null, status: 'ABSENT' }),                // UPCOMING
      day(11, 22, { checkInTime: null, checkOutTime: null, status: 'ABSENT' }),                // UPCOMING
    ]);
    const result = await month();
    expect(result.counts).toEqual({ onTime: 3, late: 3, absent: 2, missedCheckout: 2 });
    expect(result.records.map(r => [r.id, r.state])).toEqual([
      [11, 'UPCOMING'], [10, 'UPCOMING'], [9, 'ON_SHIFT'], [8, 'ABSENT'], [7, 'LATE'], [6, 'ON_TIME'],
      [5, 'MISSED_CHECKOUT'], [4, 'MISSED_CHECKOUT'], [3, 'ABSENT'], [2, 'LATE'], [1, 'ON_TIME'],
    ]);
    expect(result.records.find(r => r.id === 2)!.lateMinutes).toBe(25);
    expect(result.records.find(r => r.id === 7)!.lateMinutes).toBe(12);
  });

  it('a late ON_SHIFT row counts as late, not on time', async () => {
    db.attendance.findMany.mockResolvedValue([
      day(1, 20, { ...late, checkInTime: new Date('2026-11-20T04:25:00Z'), checkOutTime: null, status: 'LATE' }),
    ]);
    const result = await month();
    expect(result.records[0]!.state).toBe('ON_SHIFT');
    expect(result.counts).toEqual({ onTime: 0, late: 1, absent: 0, missedCheckout: 0 });
  });

  it('a row with no check-in is never late, and lateMinutes is null when the check-in was not late', async () => {
    db.attendance.findMany.mockResolvedValue([
      day(1, 4, { checkInTime: null, checkOutTime: null, status: 'ABSENT', isLateCheckIn: true, lateMinutes: 30 }),
      day(2, 5, { lateMinutes: 0 }),
    ]);
    const result = await month();
    expect(result.counts).toEqual({ onTime: 1, late: 0, absent: 1, missedCheckout: 0 });
    expect(result.records.map(r => r.lateMinutes)).toEqual([null, null]);
  });

  it('dates a row in its own location timezone', async () => {
    // 2026-11-10T19:00Z is 11 November in Karachi but still 10 November in London.
    db.attendance.findMany.mockResolvedValue([day(1, 11, { location: { id: 4, name: 'London', timezone: 'Europe/London' } })]);
    const result = await month();
    expect(result.records[0]!.date).toBe('2026-11-10');
    expect(result.records[0]!.location).toEqual({ id: 4, name: 'London' });
  });
});
