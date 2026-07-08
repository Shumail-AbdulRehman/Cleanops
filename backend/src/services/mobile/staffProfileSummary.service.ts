import { Prisma } from '@prisma/client';
import { formatInTimeZone } from 'date-fns-tz';
import { prisma } from '../../prisma/prisma.js';
import { ApiError } from '../../utils/ApiError.js';
import { readDayList } from '../../utils/workDays.js';
import type { VerificationActor } from '../verification-v2/authorization.service.js';
import { staffMonthContext } from './staffMonth.js';

/**
 * The guard from `getStaffSelfProfile`. The select never names `password`,
 * `refreshToken`, `credentialVersion`, `credentialTokens` or any other
 * credential field.
 */
export const profileSummaryStaffSelect = {
  id: true, name: true, email: true, phone: true, createdAt: true, shiftStart: true, shiftEnd: true, workDays: true,
  company: { select: { name: true } },
  location: { select: { id: true, name: true, address: true, timezone: true, isActive: true } },
} as const satisfies Prisma.StaffSelect;

export type StaffProfileMonth = {
  month: string;
  shiftsScheduled: number;
  shiftsAttended: number;
  onTime: number;
  tasksAssigned: number;
  tasksSubmitted: number;
};

export type StaffProfileSummaryDb = Pick<typeof prisma, 'staff' | 'managerLocation' | 'attendance' | 'taskInstance'>;

/**
 * Read model for `GET /profile` (`ARCHITECTURE.md#api`): the actor's own
 * profile plus their location's manager name and this month's attendance and
 * task figures. Read-only; the month figures are `count` queries. The route
 * adds the response envelope.
 */
export async function staffProfileSummary(actor: VerificationActor, now = new Date(), db: StaffProfileSummaryDb = prisma) {
  if (actor.role !== 'STAFF') throw new ApiError(403, 'Staff account required');
  const context = await staffMonthContext(actor, undefined, now, db);

  const staff = await db.staff.findFirst({
    where: { id: actor.id, companyId: actor.companyId, role: 'STAFF', isActive: true, company: { isActive: true } },
    select: profileSummaryStaffSelect,
  });
  if (!staff) throw new ApiError(403, 'Active staff account required');

  const monthBounds = { gte: context.start, lt: context.end };
  const attendanceWhere = {
    staffId: actor.id,
    staff: { companyId: actor.companyId, role: 'STAFF', isActive: true, company: { isActive: true } },
    location: { companyId: actor.companyId },
    date: monthBounds,
    // A shift that has not started yet is not counted.
    expectedStart: { lte: now },
  } satisfies Prisma.AttendanceWhereInput;
  // Lead-approved (agrees with spec 12's UPCOMING): a started shift with no
  // check-in yet is not scheduled until it ends or the staff member checks in.
  const scheduledWhere = {
    ...attendanceWhere,
    OR: [{ checkInTime: { not: null } }, { expectedEnd: { lt: now } }],
  } satisfies Prisma.AttendanceWhereInput;
  const attendedWhere = { ...attendanceWhere, checkInTime: { not: null } } satisfies Prisma.AttendanceWhereInput;
  const taskWhere = {
    staffId: actor.id,
    location: { companyId: actor.companyId },
    isActive: true,
    status: { not: 'CANCELLED' },
    date: monthBounds,
  } satisfies Prisma.TaskInstanceWhereInput;

  const [managerLink, shiftsScheduled, shiftsAttended, onTime, tasksAssigned, tasksSubmitted] = await Promise.all([
    staff.location
      ? db.managerLocation.findFirst({
        where: {
          locationId: staff.location.id,
          location: { companyId: actor.companyId },
          manager: { isActive: true, companyId: actor.companyId },
        },
        select: { manager: { select: { name: true } } },
      })
      : null,
    db.attendance.count({ where: scheduledWhere }),
    db.attendance.count({ where: attendedWhere }),
    db.attendance.count({ where: { ...attendedWhere, isLateCheckIn: false, status: { not: 'LATE' } } }),
    db.taskInstance.count({ where: taskWhere }),
    db.taskInstance.count({ where: { ...taskWhere, OR: [{ staffSubmittedAt: { not: null } }, { status: 'COMPLETED' }] } }),
  ]);

  const usualShift = staff.shiftStart && staff.shiftEnd
    ? {
      start: formatInTimeZone(staff.shiftStart, context.timezone, 'HH:mm'),
      end: formatInTimeZone(staff.shiftEnd, context.timezone, 'HH:mm'),
      days: readDayList(staff.workDays),
    }
    : null;
  const month: StaffProfileMonth = { month: context.month, shiftsScheduled, shiftsAttended, onTime, tasksAssigned, tasksSubmitted };

  return {
    id: staff.id,
    name: staff.name,
    email: staff.email,
    phone: staff.phone ?? null,
    joinedAt: staff.createdAt.toISOString(),
    company: { name: staff.company.name },
    location: staff.location
      ? { id: staff.location.id, name: staff.location.name, address: staff.location.address, timezone: context.timezone }
      : null,
    usualShift,
    manager: managerLink ? { name: managerLink.manager.name } : null,
    month,
  };
}

export type StaffProfileSummary = Awaited<ReturnType<typeof staffProfileSummary>>;
