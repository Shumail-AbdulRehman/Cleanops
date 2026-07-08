import { Prisma } from '@prisma/client';
import { formatInTimeZone } from 'date-fns-tz';
import { z } from 'zod';
import { prisma } from '../../prisma/prisma.js';
import { ApiError } from '../../utils/ApiError.js';
import { isValidTimeZone } from '../../utils/dateTime.js';
import type { VerificationActor } from '../verification-v2/authorization.service.js';
import { staffMonthContext } from './staffMonth.js';

export const ATTENDANCE_DAY_STATES = ['UPCOMING', 'ABSENT', 'MISSED_CHECKOUT', 'ON_SHIFT', 'LATE', 'ON_TIME'] as const;
export type AttendanceDayState = typeof ATTENDANCE_DAY_STATES[number];
export type AttendanceMonthCounts = { onTime: number; late: number; absent: number; missedCheckout: number };

const inputSchema = z.object({ month: z.string().max(32).optional() });

/** Never add `checkInImage` or `checkOutImage`: the staff app shows no attendance photo. */
export const attendanceMonthSelect = {
  id: true, date: true, expectedStart: true, expectedEnd: true,
  checkInTime: true, checkOutTime: true, status: true, isLateCheckIn: true, lateMinutes: true,
  location: { select: { id: true, name: true, timezone: true } },
} as const satisfies Prisma.AttendanceSelect;
type AttendanceMonthRow = Prisma.AttendanceGetPayload<{ select: typeof attendanceMonthSelect }>;
type ClassifiableRow = Pick<AttendanceMonthRow, 'expectedStart' | 'expectedEnd' | 'checkInTime' | 'checkOutTime' | 'status' | 'isLateCheckIn'>;

export type StaffAttendanceMonthDb = Pick<typeof prisma, 'staff' | 'attendance'>;

/** A check-in the record marks as late. A row without a check-in is never late. */
export const hasLateCheckIn = (row: ClassifiableRow) =>
  row.checkInTime !== null && (row.isLateCheckIn || row.status === 'LATE');

/**
 * One display state per attendance day, `ARCHITECTURE.md#api` rule order, first
 * match wins. A shift that has started but not ended without a check-in yet is
 * `UPCOMING`: the staff member can still check in, so it is neither absent nor
 * on time.
 */
export function classifyAttendanceDay(row: ClassifiableRow, now: Date): AttendanceDayState {
  const at = now.getTime();
  const checkedIn = row.checkInTime !== null;
  if (!checkedIn && row.expectedStart.getTime() > at) return 'UPCOMING';
  if (!checkedIn && row.expectedEnd.getTime() < at) return 'ABSENT';
  if (row.status === 'MISSED_CHECKOUT') return 'MISSED_CHECKOUT';
  if (!checkedIn) return 'UPCOMING';
  if (row.checkOutTime === null && row.expectedEnd.getTime() > at) return 'ON_SHIFT';
  if (hasLateCheckIn(row)) return 'LATE';
  return 'ON_TIME';
}

/**
 * Read model for `GET /attendance/month`: the actor's own attendance in one
 * month with a display state per day and the month's counts. One attendance
 * read (at most one row per day). Never selects or returns a photo. The route
 * adds the response envelope.
 */
export async function staffAttendanceMonth(actor: VerificationActor, input: unknown, now = new Date(), db: StaffAttendanceMonthDb = prisma) {
  if (actor.role !== 'STAFF') throw new ApiError(403, 'Staff account required');
  const q = inputSchema.parse(input ?? {});
  const context = await staffMonthContext(actor, q.month, now, db);

  const rows = await db.attendance.findMany({
    where: {
      staffId: actor.id,
      staff: { companyId: actor.companyId, role: 'STAFF', isActive: true, company: { isActive: true } },
      location: { companyId: actor.companyId },
      date: { gte: context.start, lt: context.end },
    },
    select: attendanceMonthSelect,
  });

  const counts: AttendanceMonthCounts = { onTime: 0, late: 0, absent: 0, missedCheckout: 0 };
  const records = rows
    .slice()
    .sort((a, b) => (b.date.getTime() - a.date.getTime()) || (b.id - a.id))
    .map(row => {
      const state = classifyAttendanceDay(row, now);
      const late = hasLateCheckIn(row);
      if (late) counts.late += 1;
      if (state === 'ON_TIME' || (state === 'ON_SHIFT' && !late)) counts.onTime += 1;
      else if (state === 'ABSENT') counts.absent += 1;
      else if (state === 'MISSED_CHECKOUT') counts.missedCheckout += 1;
      const zone = isValidTimeZone(row.location.timezone) ? row.location.timezone : context.timezone;
      return {
        id: row.id,
        date: formatInTimeZone(row.date, zone, 'yyyy-MM-dd'),
        expectedStart: row.expectedStart.toISOString(),
        expectedEnd: row.expectedEnd.toISOString(),
        checkInTime: row.checkInTime?.toISOString() ?? null,
        checkOutTime: row.checkOutTime?.toISOString() ?? null,
        lateMinutes: late ? row.lateMinutes ?? null : null,
        location: { id: row.location.id, name: row.location.name },
        state,
      };
    });

  return { month: context.month, timezone: context.timezone, range: context.range, counts, records };
}
