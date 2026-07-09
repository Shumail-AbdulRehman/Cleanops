import { jobAccountAllowed } from '../services/launchJobs.service.js';
import { prisma } from '../prisma/prisma.js';
import type { VerificationTransaction } from '../services/verification-v2/transaction.js';
import { getZonedDayRange, resolveZonedAttendanceWindow } from './dateTime.js';
import { coveringShiftDay, isAllSevenDays, isWorkDay, readDayList } from './workDays.js';

type AttendanceDay = 'today' | 'next';

/** Caller holds the staff row lock shared with attendance writes and transfers. */
export async function prepareStaffAttendance(
    tx: VerificationTransaction, staffId: number, now = new Date(), day?: AttendanceDay,
) {
    const staff = await tx.staff.findFirst({ where: { id: staffId, isActive: true, company: { isActive: true, operationalStatus: "ACTIVE" } }, include: { location: true } });
    if (!staff?.location || !staff.location.isActive || !staff.shiftStart || !staff.shiftEnd) return 'NO_SHIFT' as const;
    if (!await jobAccountAllowed(staff.companyId, 'MANAGE_WORK', tx, now)) return 'ACCOUNT_RESTRICTED' as const;

    const { shiftStart, shiftEnd } = staff;
    const timeZone = staff.location.timezone;
    const everyDay = isAllSevenDays(readDayList(staff.workDays));
    let baseDate = now;
    if (day === 'next') {
        baseDate = getZonedDayRange(now, timeZone).end;
    } else if (!day && !everyDay) {
        // Keep the incumbent calendar-day behavior for all-seven schedules.
        baseDate = coveringShiftDay({ shiftStart, shiftEnd, instant: now, timeZone });
    }
    const { date, expectedStart, expectedEnd } = resolveZonedAttendanceWindow({
        baseDate, shiftStart, shiftEnd, timeZone,
    });
    const workDay = everyDay || isWorkDay(staff.workDays, date, timeZone);
    const existing = await tx.attendance.findUnique({ where: { staffId_date: { staffId, date } } });
    if (existing) {
        const untouched = existing.status === 'ABSENT' && !existing.checkInTime && !existing.checkOutTime &&
            !existing.checkInImage && !existing.checkOutImage;
        const untouchedWhere = {
            id: existing.id, status: 'ABSENT' as const, checkInTime: null, checkOutTime: null,
            checkInImage: null, checkOutImage: null,
        };
        if (!workDay) {
            if (untouched && existing.expectedEnd > now) {
                await tx.attendance.deleteMany({ where: { ...untouchedWhere, expectedEnd: { gt: now } } });
            }
            return 'DAY_OFF' as const;
        }
        // Never relocate evidence, alter recorded clocks, erase lateness or move
        // an already elapsed absence. One existing recorded shift/day is retained.
        if (!untouched || existing.expectedEnd < now) return 'RECORDED_SHIFT' as const;
        await tx.attendance.updateMany({ where: { ...untouchedWhere, expectedEnd: { gte: now } },
            data: { locationId: staff.location.id, expectedStart, expectedEnd } });
    } else {
        if (!workDay) return 'DAY_OFF' as const;
        // A new hire must not acquire an absence for a shift predating their account.
        if (staff.createdAt && expectedStart < staff.createdAt) return 'BEFORE_ONBOARDING' as const;
        await tx.attendance.createMany({ data: [{ staffId, locationId: staff.location.id, date, expectedStart, expectedEnd, status: 'ABSENT' }], skipDuplicates: true });
    }
    return 'READY' as const;
}

// Retain incumbent call shape. Read current persistence rather than scheduler or
// editor snapshots; missing timeZone on old callers no longer silently does nothing.
export async function syncTodaysOpenAttendanceWindow(
    input: { staffId: number; locationId: number | null; shiftStart: Date | null; shiftEnd: Date | null; timeZone?: string | null },
    now?: Date,
    day?: AttendanceDay,
) {
    return prisma.$transaction(async tx => {
        await tx.$queryRaw`SELECT id FROM "Staff" WHERE id=${input.staffId} FOR UPDATE`;
        return prepareStaffAttendance(tx, input.staffId, now, day);
    });
}
