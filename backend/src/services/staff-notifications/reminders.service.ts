import { prisma } from "../../prisma/prisma.js";
import {
  resolveZonedAttendanceWindow,
  addUtcDays,
} from "../../utils/dateTime.js";
import { isWorkDay, type WeekdayList } from "../../utils/workDays.js";
import { formatInTimeZone, fromZonedTime } from "date-fns-tz";
import type { Source } from "./policy.js";
export type ShiftStaff = {
  id: number;
  companyId: number;
  locationId: number | null;
  shiftStart: Date | null;
  shiftEnd: Date | null;
  workDays?: WeekdayList;
  location: { timezone: string } | null;
};
export type Window = Source & {
  id?: number;
  expectedStart: Date;
  expectedEnd: Date;
};
export function scheduledWindows(staff: ShiftStaff, now: Date): Window[] {
  const { location, shiftStart, shiftEnd, workDays } = staff;
  if (!location || !shiftStart || !shiftEnd) return [];
  const { timezone: timeZone } = location;
  const day = formatInTimeZone(now, timeZone, "yyyy-MM-dd");
  return [0, 1]
    .map((offset) => {
      const label = addUtcDays(new Date(day + "T12:00:00Z"), offset)
        .toISOString()
        .slice(0, 10);
      return {
        staffId: staff.id,
        ...resolveZonedAttendanceWindow({
          baseDate: fromZonedTime(label + "T12:00:00", timeZone),
          shiftStart,
          shiftEnd,
          timeZone,
        }),
      };
    })
    .filter((window) => isWorkDay(workDays, window.date, timeZone));
}
export function reminderKind(window: Window, now: Date, grace = 10) {
  if (window.checkOutTime || window.expectedEnd <= now) return null;
  if (
    !window.checkInTime &&
    +now >= +window.expectedStart - 600000 &&
    now < window.expectedStart
  )
    return "SHIFT_APPROACHING";
  if (
    !window.checkInTime &&
    +now >= +window.expectedStart + grace * 60000 &&
    +now < +window.expectedStart + (grace + 30) * 60000
  )
    return "MISSING_CHECK_IN";
  if (window.checkInTime && +now >= +window.expectedEnd - 600000)
    return "CHECKOUT_APPROACHING";
  return null;
}
export async function collectAttendanceReminders(now = new Date()) {
  const parsed = Number(process.env.STAFF_CHECKIN_GRACE_MINUTES ?? 10);
  const grace =
    Number.isInteger(parsed) && parsed >= 0 && parsed <= 120 ? parsed : 10;
  let cursor = 0,
    created = 0;
  for (;;) {
    const staff = await prisma.staff.findMany({
      where: {
        id: { gt: cursor },
        isActive: true,
        locationId: { not: null },
        company: { isActive: true, operationalStatus: "ACTIVE" },
        location: { isActive: true },
      },
      orderBy: { id: "asc" },
      take: 100,
      select: {
        id: true,
        companyId: true,
        locationId: true,
        shiftStart: true,
        shiftEnd: true,
        workDays: true,
        location: { select: { timezone: true } },
        attendances: {
          where: {
            expectedEnd: { gt: now },
            expectedStart: { gte: new Date(+now - 48 * 3600000) },
          },
          orderBy: { expectedStart: "desc" },
          take: 4,
          select: {
            id: true,
            staffId: true,
            locationId: true,
            expectedStart: true,
            expectedEnd: true,
            checkInTime: true,
            checkOutTime: true,
          },
        },
      },
    });
    if (!staff.length) break;
    const events = [];
    for (const person of staff) {
      const windows = new Map(
        scheduledWindows(person, now).map((w) => [
          w.expectedStart.toISOString(),
          w,
        ]),
      );
      for (const w of person.attendances)
        if (w.locationId === person.locationId) {
          for (const [key, scheduled] of windows)
            if (
              scheduled.expectedStart < w.expectedEnd &&
              w.expectedStart < scheduled.expectedEnd
            )
              windows.delete(key);
          windows.set(w.expectedStart.toISOString(), w);
        }
      for (const window of windows.values()) {
        const kind = reminderKind(window, now, grace);
        if (!kind) continue;
        const start = window.expectedStart.toISOString();
        const expiresAt =
          kind === "SHIFT_APPROACHING"
            ? window.expectedStart
            : kind === "CHECKOUT_APPROACHING"
              ? window.expectedEnd
              : new Date(
                  Math.min(
                    +window.expectedEnd,
                    +window.expectedStart + (grace + 30) * 60000,
                  ),
                );
        events.push({
          staffId: person.id,
          companyId: person.companyId,
          kind,
          eventKey: `reminder:${kind}:${person.id}:${start}`,
          attendanceId: window.id ?? null,
          data: { windowStart: start, graceMinutes: grace },
          expiresAt,
        });
      }
    }
    if (events.length)
      created += (
        await prisma.staffNotification.createMany({
          data: events,
          skipDuplicates: true,
        })
      ).count;
    cursor = staff.at(-1)!.id;
  }
  return created;
}
export async function attendanceNotificationSource(
  staff: ShiftStaff,
  attendanceId: number | null,
  windowStart: string,
) {
  if (!staff.locationId) return null;
  const scheduled = scheduledWindows(staff, new Date(windowStart)).find(
    (w) => w.expectedStart.toISOString() === windowStart,
  );
  const existing = await prisma.attendance.findFirst({
    where: {
      staffId: staff.id,
      locationId: staff.locationId,
      ...(attendanceId
        ? { id: attendanceId }
        : scheduled
          ? {
              expectedStart: { lt: scheduled.expectedEnd },
              expectedEnd: { gt: scheduled.expectedStart },
            }
          : { expectedStart: new Date(windowStart) }),
    },
    select: {
      staffId: true,
      expectedStart: true,
      expectedEnd: true,
      checkInTime: true,
      checkOutTime: true,
    },
  });
  if (existing) return existing;
  // Before midnight a next-day attendance row may not exist yet. Reconstruct the
  // current schedule and bind to its exact window; shift edits invalidate it.
  return scheduled ?? null;
}
