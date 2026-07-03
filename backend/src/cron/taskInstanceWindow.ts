import { formatInTimeZone, fromZonedTime } from "date-fns-tz";
import {
  getZonedClockMinutes,
  withZonedClockOnLocalDay,
} from "../utils/dateTime.js";

type ShiftWindowInput = {
  baseDate: Date;
  taskShiftStart: Date;
  taskShiftEnd: Date;
  staffShiftStart?: Date | null;
  staffShiftEnd?: Date | null;
  timeZone: string;
};

/** UTC instant of the start of the local day after the one anchored by `localDayStart`. */
const nextLocalDayStart = (localDayStart: Date, timeZone: string) => {
  const [year, month, day] = formatInTimeZone(localDayStart, timeZone, "yyyy-MM-dd")
    .split("-")
    .map(Number);
  const next = new Date(Date.UTC(year, month - 1, day + 1));
  const nextDate = formatInTimeZone(next, "UTC", "yyyy-MM-dd");
  return fromZonedTime(`${nextDate}T00:00:00`, timeZone);
};

export const resolveTaskInstanceWindow = ({
  baseDate,
  taskShiftStart,
  taskShiftEnd,
  staffShiftStart,
  staffShiftEnd,
  timeZone,
}: ShiftWindowInput) => {
  const taskStartMin = getZonedClockMinutes(taskShiftStart, timeZone);
  const taskEndMin = getZonedClockMinutes(taskShiftEnd, timeZone);

  let startDay = baseDate;

  if (staffShiftStart && staffShiftEnd) {
    const staffStartMin = getZonedClockMinutes(staffShiftStart, timeZone);
    const staffEndMin = getZonedClockMinutes(staffShiftEnd, timeZone);
    const isOvernightStaffShift = staffEndMin < staffStartMin;

    if (isOvernightStaffShift && taskStartMin < staffEndMin) {
      startDay = nextLocalDayStart(startDay, timeZone);
    }
  }

  const resolvedShiftStart = withZonedClockOnLocalDay(startDay, taskShiftStart, timeZone);

  let resolvedShiftEnd = withZonedClockOnLocalDay(startDay, taskShiftEnd, timeZone);

  if (taskEndMin <= taskStartMin || resolvedShiftEnd < resolvedShiftStart) {
    resolvedShiftEnd = withZonedClockOnLocalDay(
      nextLocalDayStart(startDay, timeZone),
      taskShiftEnd,
      timeZone,
    );
  }

  return {
    date: startDay,
    shiftStart: resolvedShiftStart,
    shiftEnd: resolvedShiftEnd,
  };
};
