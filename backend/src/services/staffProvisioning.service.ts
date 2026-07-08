import { Prisma } from '@prisma/client';
import { randomBytes } from 'node:crypto';
import { ApiError } from '../utils/ApiError.js';
import { getZonedDayRange } from '../utils/dateTime.js';
import { INVALID_PAKISTAN_PHONE_MESSAGE, normalizePakistanPhone } from '../utils/pakistanPhone.js';
import { readDayList, weekdayOfLocalDay, type WeekdayList } from '../utils/workDays.js';
import type { StaffRecordInput } from '../validations/staffRecord.validation.js';
import type { VerificationTransaction } from './verification-v2/transaction.js';

/** Batch callers pre-lock their validated identities in the same order as a single insert. */
export async function lockStaffIdentities(tx: VerificationTransaction, records: Pick<StaffRecordInput, 'phone' | 'email'>[]) {
  const keys = records.flatMap(({ phone, email }) => [
    Prisma.sql`hashtextextended(${phone}, 1543)`,
    ...(email ? [Prisma.sql`hashtextextended(lower(${email}), 1542)`] : []),
  ]);
  if (keys.length === 0) return;
  await tx.$queryRaw`
    SELECT pg_advisory_xact_lock(key)::text
    FROM (SELECT DISTINCT key FROM unnest(ARRAY[${Prisma.join(keys)}]) AS identities(key) ORDER BY key) AS ordered
  `;
}

/** Caller owns authorization and capacity transaction; Prisma create hashes passwords. */
export async function insertStaff(tx: VerificationTransaction, companyId: number, input: StaffRecordInput) {
  const phone = normalizePakistanPhone(input.phone);
  if (!phone) throw new ApiError(400, INVALID_PAKISTAN_PHONE_MESSAGE, [{ code: 'INVALID_PHONE' }]);
  const email = input.email?.trim() || undefined;
  await lockStaffIdentities(tx, [{ phone, email }]);
  if (await tx.staff.findUnique({ where: { phone }, select: { id: true } })) {
    throw new ApiError(409, 'This phone number is already used by another staff member.', [{ code: 'PHONE_IN_USE' }]);
  }
  if (email && await tx.staff.findFirst({ where: { email: { equals: email, mode: 'insensitive' } }, select: { id: true } })) {
    throw new ApiError(409, 'This email is already used by another staff member.', [{ code: 'EMAIL_IN_USE' }]);
  }
  return tx.staff.create({ data: {
    name: input.name, email: email ?? null, phone, password: randomBytes(32).toString('hex'),
    companyId, locationId: input.locationId ?? null, shiftStart: input.shiftStart ?? null,
    shiftEnd: input.shiftEnd ?? null, mustChangePassword: false,
    ...(input.workDays !== undefined ? { workDays: input.workDays } : {}),
  } });
}

/** Reject removed days still used by an active schedule fixed to this staff member. */
export async function assertNoWorkDayConflicts(
  tx: VerificationTransaction,
  staff: { id: number; name: string },
  removed: WeekdayList,
  now = new Date(),
) {
  const templates = await tx.taskTemplate.findMany({
    where: { staffId: staff.id, isActive: true, recurringType: { in: ['DAILY', 'ONCE'] } },
    orderBy: { id: 'asc' },
    select: {
      title: true,
      recurringType: true,
      repeatDays: true,
      effectiveDate: true,
      recurringEndDate: true,
      location: { select: { timezone: true } },
    },
  });

  const conflicts = templates.filter((template) => {
    if (template.recurringType === 'DAILY') {
      return (!template.recurringEndDate ||
        template.recurringEndDate >= getZonedDayRange(now, template.location.timezone).start) &&
        readDayList(template.repeatDays).some((day) => removed.includes(day));
    }
    const timeZone = template.location.timezone;
    return template.effectiveDate >= getZonedDayRange(now, timeZone).start &&
      removed.includes(weekdayOfLocalDay(template.effectiveDate, timeZone));
  });

  if (conflicts.length) {
    const titles = conflicts.map(({ title }) => `"${title}"`).join(', ');
    const message = `${staff.name} has schedules on the days you removed: ${titles}. Change those schedules first.`;
    throw new ApiError(409, message, [{ code: 'WORK_DAYS_CONFLICT', field: 'workDays', message }]);
  }
}
