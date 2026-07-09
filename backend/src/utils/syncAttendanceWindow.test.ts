vi.mock('../services/launchJobs.service.js',()=>({jobAccountAllowed:vi.fn(async()=>true)}));
import { beforeEach, describe, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({
    staff: vi.fn(), find: vi.fn(), update: vi.fn(), create: vi.fn(), remove: vi.fn(), lock: vi.fn(),
}));
vi.mock('../prisma/prisma.js', () => ({ prisma: { $transaction: (run: (tx: unknown) => unknown) => run({ $queryRaw: m.lock,
    staff: { findFirst: m.staff }, attendance: { findUnique: m.find, updateMany: m.update, createMany: m.create, deleteMany: m.remove } }) } }));
import { prepareStaffAttendance, syncTodaysOpenAttendanceWindow } from './syncAttendanceWindow.js';
const now = new Date('2026-10-20T07:00:00Z');
const staff = { id: 7, locationId: 30, shiftStart: new Date('2026-10-20T03:00:00Z'), shiftEnd: new Date('2026-10-20T11:00:00Z'),
    location: { id: 30, isActive: true, timezone: 'Asia/Karachi' } };
const row = { id: 9, status: 'ABSENT', checkInTime: null, checkOutTime: null, checkInImage: null, checkOutImage: null, expectedEnd: new Date(+now + 3600000) };
const tx = { staff: { findFirst: m.staff }, attendance: { findUnique: m.find, updateMany: m.update, createMany: m.create, deleteMany: m.remove } } as unknown as Parameters<typeof prepareStaffAttendance>[0];
beforeEach(() => { vi.resetAllMocks(); m.staff.mockResolvedValue(staff); m.find.mockResolvedValue(row); m.update.mockResolvedValue({ count: 1 }); });
describe('current unrecorded attendance preparation', () => {
    it('prepares only a still-unstarted absence using current site/timezone/shift', async () => {
        expect(await prepareStaffAttendance(tx, 7, now)).toBe('READY');
        expect(m.update).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ checkInTime: null, checkInImage: null, status: 'ABSENT' }), data: expect.objectContaining({ locationId: 30, expectedStart: staff.shiftStart, expectedEnd: staff.shiftEnd }) }));
        expect(m.update.mock.calls[0]![0].data.isLateCheckIn).toBeUndefined();
    });
    it.each([
        { status: 'CHECKED_IN' }, { status: 'LATE' }, { status: 'CHECKED_OUT' }, { checkInTime: now },
        { checkOutTime: now }, { checkInImage: 'retained-private-photo' }, { checkOutImage: 'retained-private-photo' },
        { expectedEnd: new Date(+now - 1) },
    ])('never overwrites recorded, evidence-bearing or elapsed attendance %j', async change => {
        m.find.mockResolvedValue({ ...row, ...change });
        expect(await prepareStaffAttendance(tx, 7, now)).toBe('RECORDED_SHIFT');
        expect(m.update).not.toHaveBeenCalled(); expect(m.create).not.toHaveBeenCalled();
    });
    it('does not manufacture an absence before onboarding', async () => {
        m.find.mockResolvedValue(null); m.staff.mockResolvedValue({...staff, createdAt: now});
        expect(await prepareStaffAttendance(tx, 7, now)).toBe('BEFORE_ONBOARDING');
        expect(m.create).not.toHaveBeenCalled();
    });
    it('creates an absent current-site window if none exists', async () => {
        m.find.mockResolvedValue(null);
        expect(await prepareStaffAttendance(tx, 7, now)).toBe('READY');
        expect(m.create).toHaveBeenCalledWith({ data: [{ staffId: 7, locationId: 30, date: new Date('2026-10-19T19:00:00Z'), expectedStart: staff.shiftStart, expectedEnd: staff.shiftEnd, status: 'ABSENT' }], skipDuplicates: true });
    });
    it.each([null, { ...staff, location: null }, { ...staff, shiftStart: null }, { ...staff, location: { ...staff.location, isActive: false } }])('does not manufacture readiness for unavailable staff/site/shift', async value => {
        m.staff.mockResolvedValue(value);
        expect(await prepareStaffAttendance(tx, 7, now)).toBe('NO_SHIFT'); expect(m.update).not.toHaveBeenCalled();
    });
    it('takes the shared staff lock and disregards stale scheduler location snapshots', async () => {
        m.find.mockResolvedValue(null);
        await syncTodaysOpenAttendanceWindow({ staffId: 7, locationId: 20, shiftStart: null, shiftEnd: null }, now);
        expect(m.lock).toHaveBeenCalledBefore(m.staff);
        expect(m.create.mock.calls[0]![0].data[0].locationId).toBe(30);
        expect(m.staff).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 7, isActive: true, company: { isActive: true, operationalStatus: "ACTIVE" } } }));
    });
});

describe('attendance on chosen work days', () => {
    beforeEach(() => {
        m.staff.mockResolvedValue({ ...staff, workDays: ['MON', 'WED'] });
        m.find.mockResolvedValue(null);
    });

    it('does not create an absence on Tuesday', async () => {
        expect(await prepareStaffAttendance(tx, 7, now)).toBe('DAY_OFF');
        expect(m.create).not.toHaveBeenCalled();
    });

    it('creates the usual absence on Monday', async () => {
        expect(await prepareStaffAttendance(tx, 7, new Date('2026-10-19T07:00:00Z'))).toBe('READY');
        expect(m.create).toHaveBeenCalledWith({
            data: [{
                staffId: 7, locationId: 30, status: 'ABSENT',
                date: new Date('2026-10-18T19:00:00Z'),
                expectedStart: new Date('2026-10-19T03:00:00Z'),
                expectedEnd: new Date('2026-10-19T11:00:00Z'),
            }],
            skipDuplicates: true,
        });
    });

    it('removes only an untouched Tuesday absence while its shift is still open', async () => {
        m.find.mockResolvedValue(row);
        expect(await prepareStaffAttendance(tx, 7, now)).toBe('DAY_OFF');
        expect(m.remove).toHaveBeenCalledWith({
            where: {
                id: row.id, status: 'ABSENT', checkInTime: null, checkOutTime: null,
                checkInImage: null, checkOutImage: null, expectedEnd: { gt: now },
            },
        });
        expect(m.update).not.toHaveBeenCalled();
        expect(m.create).not.toHaveBeenCalled();
    });

    it.each([
        { status: 'CHECKED_IN' }, { checkInTime: now }, { checkOutTime: now },
        { checkInImage: 'retained-photo' }, { checkOutImage: 'retained-photo' },
        { expectedEnd: new Date(now.getTime() - 1) }, { expectedEnd: now },
    ])('keeps protected Tuesday attendance %j', async (change) => {
        m.find.mockResolvedValue({ ...row, ...change });
        expect(await prepareStaffAttendance(tx, 7, now)).toBe('DAY_OFF');
        expect(m.remove).not.toHaveBeenCalled();
        expect(m.update).not.toHaveBeenCalled();
        expect(m.create).not.toHaveBeenCalled();
    });

    it.each([
        { workDays: ['MON', 'WED'], expectedDay: '2026-10-18T19:00:00Z' },
        { workDays: ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'], expectedDay: '2026-10-19T19:00:00Z' },
    ])('prepares the correct date after midnight for $workDays', async ({ workDays, expectedDay }) => {
        m.staff.mockResolvedValue({
            ...staff, workDays,
            shiftStart: new Date('2026-10-19T17:00:00Z'),
            shiftEnd: new Date('2026-10-20T01:00:00Z'),
        });
        expect(await prepareStaffAttendance(tx, 7, new Date('2026-10-19T22:00:00Z'))).toBe('READY');
        expect(m.find).toHaveBeenCalledWith({ where: { staffId_date: { staffId: 7, date: new Date(expectedDay) } } });
    });

    it('uses the location date when Tuesday in UTC is still Monday in Los Angeles', async () => {
        m.staff.mockResolvedValue({
            ...staff,
            workDays: ['MON'],
            location: { ...staff.location, timezone: 'America/Los_Angeles' },
            shiftStart: new Date('2026-10-19T23:00:00Z'),
            shiftEnd: new Date('2026-10-20T06:00:00Z'),
        });
        expect(await prepareStaffAttendance(tx, 7, new Date('2026-10-20T01:00:00Z'))).toBe('READY');
        expect(m.find).toHaveBeenCalledWith({
            where: { staffId_date: { staffId: 7, date: new Date('2026-10-19T07:00:00Z') } },
        });
    });

    it('passes the next calendar day through the locked sync', async () => {
        expect(await syncTodaysOpenAttendanceWindow({ ...staff, staffId: 7 }, now, 'next')).toBe('READY');
        expect(m.lock).toHaveBeenCalledBefore(m.staff);
        expect(m.find).toHaveBeenCalledWith({
            where: { staffId_date: { staffId: 7, date: new Date('2026-10-20T19:00:00Z') } },
        });
    });
});
