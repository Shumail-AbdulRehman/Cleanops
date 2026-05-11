import { prisma } from "../prisma/prisma.js";
import { getKarachiDayRange, resolveAttendanceWindow } from "./karachiTime.js";

export const syncTodaysOpenAttendanceWindow = async ({
  staffId,
  locationId,
  shiftStart,
  shiftEnd,
}: {
  staffId: number;
  locationId: number | null;
  shiftStart: Date | null;
  shiftEnd: Date | null;
}) => {


  if (!locationId || !shiftStart || !shiftEnd) {
    return;
  }

  const { start: today, end: tomorrow } = getKarachiDayRange();
  const { date, expectedStart, expectedEnd } = resolveAttendanceWindow({
    baseDate: today,
    shiftStart,
    shiftEnd,
  });

  await prisma.attendance.updateMany({
    where: {
      staffId,
      date: { gte: today, lt: tomorrow },
      status:{
        in:[ "ABSENT","CHECKED_IN","LATE"]
      },
      checkOutTime: null,
    },
    data: {
      locationId,
      date,
      expectedStart,
      expectedEnd,
      isLateCheckIn: false,
      lateMinutes: null,
    },
  });
};
