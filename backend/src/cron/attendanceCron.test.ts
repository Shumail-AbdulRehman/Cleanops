import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runAttendanceCron } from './attendanceCron.js';

const m = vi.hoisted(() => ({
    list: vi.fn(), staff: vi.fn(), find: vi.fn(), create: vi.fn(), schedule: vi.fn(),
}));

vi.mock('node-cron', () => ({ default: { schedule: m.schedule } }));
vi.mock('../services/launchJobs.service.js', () => ({ jobAccountAllowed: vi.fn(async () => true) }));
vi.mock('../prisma/prisma.js', () => ({
    prisma: {
        staff: { findMany: m.list },
        $transaction: (run: (tx: unknown) => unknown) => run({
            $queryRaw: vi.fn(),
            staff: { findFirst: m.staff },
            attendance: { findUnique: m.find, createMany: m.create },
        }),
    },
}));

const midnightStaff = {
    id: 7,
    locationId: 30,
    shiftStart: new Date('2026-10-19T19:00:00Z'),
    shiftEnd: new Date('2026-10-20T03:00:00Z'),
    location: { id: 30, isActive: true, timezone: 'Asia/Karachi' },
    workDays: ['TUE'],
};

describe('hourly attendance preparation', () => {
    beforeEach(() => {
        m.list.mockReset().mockResolvedValue([midnightStaff]);
        m.staff.mockReset().mockResolvedValue(midnightStaff);
        m.find.mockReset().mockResolvedValue(null);
        m.create.mockReset().mockResolvedValue({ count: 1 });
        vi.spyOn(console, 'log').mockImplementation(() => {});
        vi.spyOn(console, 'error').mockImplementation(() => {});
    });
    afterEach(() => vi.restoreAllMocks());

    it('schedules the job at minute 2 of each hour', () => {
        expect(m.schedule).toHaveBeenCalledWith('2 * * * *', expect.any(Function), { noOverlap: true });
    });

    it('prepares Tuesday midnight at 22:02 Monday in Karachi', async () => {
        await runAttendanceCron(new Date('2026-10-19T17:02:00Z'));
        expect(m.create).toHaveBeenCalledExactlyOnceWith({
            data: [{
                staffId: 7, locationId: 30, status: 'ABSENT',
                date: new Date('2026-10-19T19:00:00Z'),
                expectedStart: new Date('2026-10-19T19:00:00Z'),
                expectedEnd: new Date('2026-10-20T03:00:00Z'),
            }],
            skipDuplicates: true,
        });
    });

    it('prepares the 04:00 shift at 02:02 the same day in Karachi', async () => {
        const earlyStaff = { ...midnightStaff, shiftStart: new Date('2026-10-19T23:00:00Z') };
        m.list.mockResolvedValue([earlyStaff]);
        m.staff.mockResolvedValue(earlyStaff);

        await runAttendanceCron(new Date('2026-10-19T21:02:00Z'));
        expect(m.create).toHaveBeenCalledExactlyOnceWith({
            data: [expect.objectContaining({
                date: new Date('2026-10-19T19:00:00Z'),
                expectedStart: earlyStaff.shiftStart,
            })],
            skipDuplicates: true,
        });
    });

    it('prepares Monday while skipping the midnight shift on Tuesday off', async () => {
        m.staff.mockResolvedValue({ ...midnightStaff, workDays: ['MON'] });

        await runAttendanceCron(new Date('2026-10-19T17:02:00Z'));
        expect(m.create).toHaveBeenCalledExactlyOnceWith({
            data: [expect.objectContaining({ date: new Date('2026-10-18T19:00:00Z') })],
            skipDuplicates: true,
        });
    });

    it('leaves the next local day alone when its shift is more than two hours away', async () => {
        await runAttendanceCron(new Date('2026-10-19T16:02:00Z'));
        expect(m.find).toHaveBeenCalledExactlyOnceWith({
            where: { staffId_date: { staffId: 7, date: new Date('2026-10-18T19:00:00Z') } },
        });
        expect(m.create).not.toHaveBeenCalled();
    });

    it('logs one staff failure and continues with the next staff member', async () => {
        const failingStaff = { ...midnightStaff, id: 8 };
        const failure = new Error('Preparation failed');
        m.list.mockResolvedValue([failingStaff, midnightStaff]);
        m.staff.mockRejectedValueOnce(failure);

        await runAttendanceCron(new Date('2026-10-19T17:02:00Z'));
        expect(console.error).toHaveBeenCalledWith('Attendance preparation error for staff', 8, failure);
        expect(m.create).toHaveBeenCalledExactlyOnceWith({
            data: [expect.objectContaining({ staffId: 7 })],
            skipDuplicates: true,
        });
        expect(console.log).toHaveBeenCalledWith('Attendance preparation checked 2 eligible staff');
    });
});
