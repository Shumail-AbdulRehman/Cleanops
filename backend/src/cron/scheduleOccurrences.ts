import type { InstanceGenerationInput } from "../services/verification-v2/inventorySnapshot.service.js";
import { getZonedDayRange } from "../utils/dateTime.js";
import { scheduleOccursOnDay } from "../utils/workDays.js";
import { resolveTaskInstanceWindow } from "./taskInstanceWindow.js";

type Schedule = Parameters<typeof scheduleOccursOnDay>[0];
type OccurrenceTemplate = Omit<Schedule, "recurringType"> & {
  recurringType: Schedule["recurringType"] | null;
  id: number;
  title: string;
  locationId: number;
  location: { timezone: string };
  staffId: number | null;
  staff?: { shiftStart: Date | null; shiftEnd: Date | null } | null;
  shiftStart: Date;
  shiftEnd: Date;
  referenceImageUrl?: string | null;
};

export function buildScheduleOccurrences(
  templates: readonly OccurrenceTemplate[],
  now: Date,
): InstanceGenerationInput[] {
  const occurrences: InstanceGenerationInput[] = [];

  for (const template of templates) {
    const { recurringType } = template;
    if (!recurringType) continue;

    const timeZone = template.location.timezone;
    const day = getZonedDayRange(now, timeZone);
    if (!scheduleOccursOnDay({ ...template, recurringType }, day, timeZone)) continue;

    const window = resolveTaskInstanceWindow({
      baseDate: day.start,
      taskShiftStart: template.shiftStart,
      taskShiftEnd: template.shiftEnd,
      staffShiftStart: template.staff?.shiftStart,
      staffShiftEnd: template.staff?.shiftEnd,
      timeZone,
    });

    occurrences.push({
      templateId: template.id,
      baseDate: day.start,
      title: template.title,
      ...window,
      staffId: template.staffId,
      locationId: template.locationId,
      referenceImageUrl: template.referenceImageUrl,
    });
  }

  return occurrences;
}
