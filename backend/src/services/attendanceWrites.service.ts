import { assertAccountAction, assertAccountCompletion, recordWorkEntitlement } from './accountAccess.service.js';
import type { Prisma } from "@prisma/client";
import { prisma } from "../prisma/prisma.js";
import { ApiError } from "../utils/ApiError.js";
import { getDistanceMeters } from "../utils/geofencing.js";
import { getZonedDayRange, getZonedDayRangeFromDateInput } from "../utils/dateTime.js";
import { storeAttendancePhoto } from "./attendanceMedia.service.js";
import type { VerificationActor } from "./verification-v2/authorization.service.js";
import type { CheckOutInput } from "../validations/attendance.validation.js";

type Db = typeof prisma;
const OPEN_STATUSES = ["CHECKED_IN", "LATE", "MISSED_CHECKOUT"] as const;

/** Bind each calendar interval to its owning site; never union unrelated zones. */
export function attendanceDateScope(locations: { id: number; timezone: string }[], from?: string, to?: string): Prisma.AttendanceWhereInput {
  const ranges = (locations.length ? locations : [{ id: 0, timezone: "UTC" }]).map(location => {
    const start = from ? getZonedDayRangeFromDateInput(from, location.timezone) : null;
    const end = to ? getZonedDayRangeFromDateInput(to, location.timezone) : null;
    if ((from && !start) || (to && !end) || (start && end && start.start > end.start))
      throw new ApiError(400, "Choose valid dates in YYYY-MM-DD order");
    return { locationId: location.id, date: { ...(start ? { gte: start.start } : {}), ...(end ? { lt: end.end } : {}) } };
  });
  return { OR: locations.length ? ranges : [] };
}

/** Compare-and-swap is the write boundary; stale device/auth snapshots cannot write. */
export async function recordAttendance(
  actor: VerificationActor, kind: "check-in" | "check-out", input: CheckOutInput,
  bytes: Buffer, now = new Date(), db: Db = prisma,
  store = storeAttendancePhoto,
) {
  if (actor.role !== "STAFF") throw new ApiError(403, "Staff account required");
  const staff = await db.staff.findFirst({
    where: { id: actor.id, companyId: actor.companyId, role: "STAFF", isActive: true, company: { isActive: true } },
    include: { location: true },
  });
  if (!staff) throw new ApiError(403, "Active staff account required");
  const location = staff.location;
  if (!location || !staff.locationId) throw new ApiError(400, "You are not assigned to a location");
  if (!location.isActive || location.companyId !== actor.companyId) throw new ApiError(403, "Your assigned location is unavailable");
  const locationId = location.id;
  const boundary: Prisma.AttendanceWhereInput = {
    staffId: actor.id, locationId,
    staff: { id: actor.id, companyId: actor.companyId, role: "STAFF", locationId, isActive: true, company: { isActive: true } },
    location: { companyId: actor.companyId, isActive: true },
  };
  const { start, end } = getZonedDayRange(now, location.timezone);
  const previousStart = getZonedDayRange(new Date(+start - 1), location.timezone).start;
  const row = await db.attendance.findFirst({
    where: {
      ...boundary,
      ...(kind === "check-in" ? {
        expectedStart: { lte: new Date(+now + 30 * 60_000) }, expectedEnd: { gte: now },
      } : input.attendanceId ? { id: input.attendanceId } : {
        date: { gte: previousStart, lt: end }, checkInTime: { not: null }, checkOutTime: null,
        status: { in: [...OPEN_STATUSES] },
      }),
    }, orderBy: { expectedStart: "desc" },
  });
  if (!row) throw new ApiError(409, "No eligible shift found. Refresh your attendance before retrying.");
  if ((kind === "check-in" && row.checkInTime) || (kind === "check-out" && row.checkOutTime)) return { record: row, replayed: true };
  if (kind === "check-in" ? row.status !== "ABSENT" : !row.checkInTime || !(OPEN_STATUSES as readonly string[]).includes(row.status) || row.date < previousStart || row.date >= end)
    throw new ApiError(409, "This shift needs attendance follow-up. Contact your manager.");
  if (kind === "check-out" && +now - +row.checkInTime! < 30 * 60_000)
    throw new ApiError(400, "Wait at least 30 minutes after check-in before checking out");
  const distance = getDistanceMeters(input.latitude, input.longitude, Number(location.latitude), Number(location.longitude));
  const allowedRadius = location.radiusMeters + Math.min(input.accuracy ?? 0, 200);
  if (!Number.isFinite(distance) || distance > allowedRadius)
    throw new ApiError(400, "You are outside your site's attendance area. Move closer and try again.");
  // Authorize before provider storage, then recheck in the winning write transaction.
  if(kind==='check-in') await assertAccountAction(actor,'START_WORK',db,now);
  else await assertAccountCompletion(actor,{kind:'attendance',id:row.id},db,now);
  const reference = await store(bytes, actor.companyId, actor.id);
  const late = +now > +row.expectedStart + 15 * 60_000;
  const data: Prisma.AttendanceUpdateManyMutationInput = kind === "check-in" ? {
    checkInTime: now, checkInImage: reference, status: late ? "LATE" : "CHECKED_IN",
    isLateCheckIn: late, lateMinutes: late ? Math.floor((+now - +row.expectedStart) / 60_000) : null,
  } : {
    checkOutTime: now, checkOutImage: reference,
    status: row.status === "MISSED_CHECKOUT" ? "MISSED_CHECKOUT" : "CHECKED_OUT",
  };
  const written = await db.$transaction(async tx => {
    // Share the workforce transfer lock only during the write, never during upload.
    await tx.$queryRaw`SELECT id FROM "Staff" WHERE id=${actor.id} FOR UPDATE`;
    if(kind==='check-in') await assertAccountAction(actor,'START_WORK',tx,now);
    else await assertAccountCompletion(actor,{kind:'attendance',id:row.id},tx,now);
    const changed = await tx.attendance.updateMany({
    where: { ...boundary, id: row.id, status: row.status, expectedStart: row.expectedStart, expectedEnd: row.expectedEnd,
      checkOutTime: null, ...(kind === "check-in" ? { checkInTime: null } : { checkInTime: row.checkInTime }) },
    data,
    });
    if(changed.count && kind==='check-in') await recordWorkEntitlement(actor,{kind:'attendance',id:row.id},tx,now);
    return changed;
  });
  // Only a confirmed zero-row update proves this new upload is unused. Do not
  // delete uploads after an ambiguous write failure; the record may have saved.
  if (!written.count) {
    await db.deletedMedia.createMany({ data: [{ url: reference }], skipDuplicates: true })
      .catch(() => { console.warn("Unused attendance upload cleanup could not be queued"); });
  }
  const persisted = await db.attendance.findFirst({ where: { ...boundary, id: row.id } });
  if (!persisted) throw new ApiError(409, "Your shift or account changed. Refresh your attendance.");
  if (!written.count && !(kind === "check-in" ? persisted.checkInTime : persisted.checkOutTime))
    throw new ApiError(409, "Your shift changed. Refresh your attendance before retrying.");
  return { record: persisted, replayed: !written.count };
}
