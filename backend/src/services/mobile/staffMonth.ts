import { formatInTimeZone } from 'date-fns-tz';
import { prisma } from '../../prisma/prisma.js';
import { ApiError } from '../../utils/ApiError.js';
import { getZonedMonthRange, isValidTimeZone } from '../../utils/dateTime.js';
import type { VerificationActor } from '../verification-v2/authorization.service.js';

/** Timezone used when the staff member has no location (the `Location.timezone` schema default). */
export const STAFF_FALLBACK_TIME_ZONE = 'Asia/Karachi';
/** How many months before the current month a staff member may look back. */
export const STAFF_HISTORY_MONTHS_BACK = 12;
export const STAFF_MONTH_ERROR = 'Choose a month from your history';

const MONTH_PATTERN = /^(\d{4})-(0[1-9]|1[0-2])$/;

export const staffMonthStaffSelect = {
  id: true, companyId: true, createdAt: true, locationId: true,
  location: { select: { id: true, name: true, timezone: true, isActive: true } },
} as const;

export type StaffMonthDb = Pick<typeof prisma, 'staff'>;
export type StaffMonthRange = { earliestMonth: string; latestMonth: string };

const monthMinus = (month: string, count: number) => {
  const [year, monthNumber] = month.split('-').map(Number) as [number, number];
  const shifted = new Date(Date.UTC(year, monthNumber - 1 - count, 1));
  return `${String(shifted.getUTCFullYear()).padStart(4, '0')}-${String(shifted.getUTCMonth() + 1).padStart(2, '0')}`;
};

/**
 * Loads the active staff row for the actor and resolves which month a staff
 * read covers: the timezone (location, else Asia/Karachi), the allowed month
 * range and the UTC instants bounding the chosen month. Shared by the history,
 * attendance month and profile summary services; keep the signature stable.
 */
export async function staffMonthContext(actor: VerificationActor, monthInput: unknown, now = new Date(), db: StaffMonthDb = prisma) {
  if (actor.role !== 'STAFF') throw new ApiError(403, 'Staff account required');
  const staff = await db.staff.findFirst({
    where: { id: actor.id, companyId: actor.companyId, isActive: true, company: { isActive: true } },
    select: staffMonthStaffSelect,
  });
  if (!staff) throw new ApiError(403, 'Active staff account required');

  const locationZone = staff.location?.timezone;
  const timezone = locationZone && isValidTimeZone(locationZone) ? locationZone : STAFF_FALLBACK_TIME_ZONE;
  const latestMonth = formatInTimeZone(now, timezone, 'yyyy-MM');
  const createdMonth = formatInTimeZone(staff.createdAt, timezone, 'yyyy-MM');
  const oldestAllowed = monthMinus(latestMonth, STAFF_HISTORY_MONTHS_BACK);
  // YYYY-MM strings order the same way as the months they name.
  let earliestMonth = createdMonth > oldestAllowed ? createdMonth : oldestAllowed;
  if (earliestMonth > latestMonth) earliestMonth = latestMonth;
  const range: StaffMonthRange = { earliestMonth, latestMonth };

  let month = latestMonth;
  if (monthInput !== undefined && monthInput !== null && monthInput !== '') {
    if (typeof monthInput !== 'string' || !MONTH_PATTERN.test(monthInput)
      || monthInput < earliestMonth || monthInput > latestMonth) throw new ApiError(400, STAFF_MONTH_ERROR);
    month = monthInput;
  }
  const [, year, monthNumber] = MONTH_PATTERN.exec(month)!;
  const bounds = getZonedMonthRange(Number(year), Number(monthNumber) - 1, timezone);
  if (!bounds) throw new ApiError(400, STAFF_MONTH_ERROR);
  return { staff, timezone, month, range, start: bounds.start, end: bounds.end };
}

export type StaffMonthContext = Awaited<ReturnType<typeof staffMonthContext>>;
