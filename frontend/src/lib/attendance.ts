export interface AttendanceLike {
  status: string;
  date?: string | Date | null;
  expectedStart?: string | Date | null;
  checkInTime?: string | Date | null;
  checkOutTime?: string | Date | null;
}

const utcDayFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: "UTC",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const getUtcDayKey = (value: string | Date) =>
  utcDayFormatter.format(new Date(value));

const getDayKey = (value: string | Date, timeZone: string) =>
  timeZone === "UTC"
    ? getUtcDayKey(value)
    : new Intl.DateTimeFormat("en-CA", {
        timeZone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(new Date(value));

export const getAttendanceDisplayStatus = (
  attendance: AttendanceLike | null | undefined,
  referenceDate = new Date(),
  timeZone = "UTC",
) => {
  if (!attendance) return "ABSENT";

  const attendanceDate = attendance.date ?? attendance.expectedStart;

  const isSameUtcDay =
    !!attendanceDate &&
    getDayKey(attendanceDate, timeZone) === getDayKey(referenceDate, timeZone);

  if (
    attendance.status === "ABSENT" &&
    isSameUtcDay &&
    attendance.expectedStart &&
    !attendance.checkInTime &&
    !attendance.checkOutTime &&
    new Date(attendance.expectedStart) > referenceDate
  ) {
    return "SHIFT_NOT_STARTED";
  }

  return attendance.status;
};
