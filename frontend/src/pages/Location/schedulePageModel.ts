import { formatInTimeZone } from "date-fns-tz";
import {
  normalizeDays,
  scheduleOccursOn,
  WEEKDAYS,
  type ScheduleOccurrence,
  type Weekday,
} from "@/lib/workDays";
import type { LocationStaff, TaskTemplate } from "./types";

export interface SchedulePageContext {
  timeZone: string;
  today: string;
  areas?: readonly NonNullable<TaskTemplate["area"]>[];
}

export interface ScheduleTimes {
  start: string | null;
  end: string | null;
  duration: { hours: number; minutes: number } | null;
  overnight: boolean;
}

export interface ScheduleWorker {
  id: number;
  name: string | null;
  workDays: Weekday[] | null;
  shiftText: string | null;
}

export interface ScheduleRow extends ScheduleTimes {
  id: number;
  title: string;
  areaId: number | null;
  areaName: string | null;
  fixturesChoice: NonNullable<TaskTemplate["inventorySelection"]>;
  worker: ScheduleWorker | null;
  weekdays: Weekday[];
  recurringType: ScheduleOccurrence["recurringType"];
  effectiveDate: string | null;
  onceDate: string | null;
  futureStartDate: string | null;
  inactive: boolean;
  needsReview: boolean;
}

export interface ScheduleCalendarDay {
  date: string;
  weekday: Weekday;
}

export interface ScheduleCoverageDay extends ScheduleCalendarDay {
  jobs: number;
  staffOn: number;
  open: number;
  load: number;
  isToday: boolean;
}

export type ScheduleGroupBy = "time" | "area" | "staff";

export interface ScheduleFilters {
  search?: string;
  staff?: number | "unassigned";
  areaId?: number;
  chip?: "all" | "needsAttention" | "inactive";
  weekday?: Weekday;
}

export interface ScheduleGroup {
  key: string;
  labelKey: "Morning" | "Afternoon" | "Evening" | "Night" | "No area" | "Unassigned" | null;
  label: string | null;
  rangeText: string | null;
  rows: ScheduleRow[];
}

export interface ScheduleList {
  groups: ScheduleGroup[];
  counts: { all: number; needsAttention: number; inactive: number };
}

export interface ScheduleStaffWeekCell extends ScheduleCalendarDay {
  dayOff: boolean;
  jobs: ScheduleRow[];
}

export interface ScheduleStaffWeekRow {
  worker: ScheduleWorker | null;
  count: number;
  days: ScheduleStaffWeekCell[];
}

export interface ScheduleDetails {
  facts: ScheduleRow;
  nextDays: Array<ScheduleCalendarDay & Pick<ScheduleTimes, "start" | "end">>;
}

const MINUTES_PER_DAY = 24 * 60;
const TIME_GROUPS = [
  { key: "morning", labelKey: "Morning", from: 6 * 60, rangeText: "06:00–11:59" },
  { key: "afternoon", labelKey: "Afternoon", from: 12 * 60, rangeText: "12:00–16:59" },
  { key: "evening", labelKey: "Evening", from: 17 * 60, rangeText: "17:00–21:59" },
  { key: "night", labelKey: "Night", from: 22 * 60, rangeText: "22:00–05:59" },
] as const;

function formatInstant(value: string | null, timeZone: string, pattern: string): string | null {
  if (!value) return null;
  const instant = new Date(value);
  return Number.isFinite(instant.getTime()) ? formatInTimeZone(instant, timeZone, pattern) : null;
}

function readTime(value: string | null, timeZone: string): string | null {
  if (value && /^(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(value)) return value.slice(0, 5);
  return formatInstant(value, timeZone, "HH:mm");
}

function minutesAt(time: string): number {
  return Number(time.slice(0, 2)) * 60 + Number(time.slice(3));
}

export function getScheduleTimes(
  shifts: Pick<TaskTemplate, "shiftStart" | "shiftEnd">,
  timeZone: string,
): ScheduleTimes {
  const start = readTime(shifts.shiftStart, timeZone);
  const end = readTime(shifts.shiftEnd, timeZone);
  if (start === null || end === null) return { start, end, duration: null, overnight: false };

  const difference = minutesAt(end) - minutesAt(start);
  const overnight = difference <= 0;
  const duration = difference + (overnight ? MINUTES_PER_DAY : 0);
  return { start, end, duration: { hours: Math.floor(duration / 60), minutes: duration % 60 }, overnight };
}

function occurrenceFor(template: TaskTemplate, timeZone: string): ScheduleOccurrence {
  return {
    recurringType: template.recurringType ?? "DAILY",
    effectiveDate: template.effectiveDate || formatInstant(template.shiftStart, timeZone, "yyyy-MM-dd"),
    recurringEndDate: template.recurringEndDate,
    repeatDays: template.repeatDays,
    isActive: template.isActive,
  };
}

export function occursOnDate(template: TaskTemplate, date: string, timeZone: string): boolean {
  return scheduleOccursOn(occurrenceFor(template, timeZone), date);
}

function calendarDay(date: string, offset = 0): ScheduleCalendarDay {
  // UTC carries local calendar fields without adding or removing hours at DST boundaries.
  const calendar = new Date(`${date}T00:00:00Z`);
  calendar.setUTCDate(calendar.getUTCDate() + offset);
  return {
    date: calendar.toISOString().slice(0, 10),
    weekday: WEEKDAYS[(calendar.getUTCDay() + 6) % WEEKDAYS.length],
  };
}

function weekDays(weekStart: string): ScheduleCalendarDay[] {
  return WEEKDAYS.map((_, offset) => calendarDay(weekStart, offset));
}

export function buildScheduleCoverage(
  templates: readonly TaskTemplate[],
  staff: readonly LocationStaff[],
  context: SchedulePageContext,
  weekStart: string,
): ScheduleCoverageDay[] {
  const schedules = templates.map(template => ({
    occurrence: occurrenceFor(template, context.timeZone),
    unassigned: template.staffId == null,
  }));
  const staffDays = staff.filter(person => person.isActive).map(person => normalizeDays(person.workDays));
  const counts = weekDays(weekStart).map(day => {
    const occurring = schedules.filter(({ occurrence }) => scheduleOccursOn(occurrence, day.date));
    return {
      ...day,
      jobs: occurring.length,
      staffOn: staffDays.filter(days => days.includes(day.weekday)).length,
      open: occurring.filter(({ unassigned }) => unassigned).length,
      isToday: day.date === context.today,
    };
  });
  const busiest = Math.max(...counts.map(day => day.jobs));
  return counts.map(day => ({ ...day, load: busiest === 0 ? 0 : day.jobs / busiest }));
}

function workerFor(id: number, person: LocationStaff | undefined, name: string | null, timeZone: string): ScheduleWorker {
  const start = person ? readTime(person.shiftStart, timeZone) : null;
  const end = person ? readTime(person.shiftEnd, timeZone) : null;
  return {
    id,
    name: person?.name ?? name,
    workDays: person ? normalizeDays(person.workDays) : null,
    shiftText: start && end ? `${start}–${end}` : null,
  };
}

interface ScheduleEntry {
  occurrence: ScheduleOccurrence;
  row: ScheduleRow;
}

function scheduleEntry(
  template: TaskTemplate,
  people: ReadonlyMap<number, LocationStaff>,
  context: SchedulePageContext,
): ScheduleEntry {
  const occurrence = occurrenceFor(template, context.timeZone);
  const effectiveDate = occurrence.effectiveDate?.slice(0, 10) ?? null;
  const onceDate = occurrence.recurringType === "ONCE" ? effectiveDate : null;
  const areaId = template.areaId ?? template.area?.id ?? null;
  const worker = template.staffId == null ? null : workerFor(
    template.staffId, people.get(template.staffId), template.staff?.name ?? null, context.timeZone,
  );

  return {
    occurrence,
    row: {
      id: template.id,
      title: template.title,
      areaId,
      areaName: template.area?.name ?? context.areas?.find(area => area.id === areaId)?.name ?? null,
      fixturesChoice: template.inventorySelection ?? "ALL",
      worker,
      ...getScheduleTimes(template, context.timeZone),
      weekdays: occurrence.recurringType === "ONCE"
        ? onceDate && scheduleOccursOn({ ...occurrence, isActive: true }, onceDate) ? [calendarDay(onceDate).weekday] : []
        : normalizeDays(occurrence.repeatDays?.length ? occurrence.repeatDays : undefined),
      recurringType: occurrence.recurringType,
      effectiveDate,
      onceDate,
      futureStartDate: effectiveDate && effectiveDate > context.today ? effectiveDate : null,
      inactive: occurrence.isActive === false,
      needsReview: template.setupStatus === "NEEDS_REVIEW",
    },
  };
}

function sortMinutes(start: string | null): number {
  if (start === null) return MINUTES_PER_DAY;
  return (minutesAt(start) - TIME_GROUPS[0].from + MINUTES_PER_DAY) % MINUTES_PER_DAY;
}

function sortedEntries(
  templates: readonly TaskTemplate[],
  staff: readonly LocationStaff[],
  context: SchedulePageContext,
): ScheduleEntry[] {
  const people = new Map(staff.map(person => [person.id, person]));
  return templates.map(template => scheduleEntry(template, people, context))
    .sort((a, b) => sortMinutes(a.row.start) - sortMinutes(b.row.start));
}

function needsAttention(row: ScheduleRow): boolean {
  return row.worker === null || row.needsReview;
}

function groupFor(row: ScheduleRow, groupBy: ScheduleGroupBy): Omit<ScheduleGroup, "rows"> {
  if (groupBy === "time") {
    if (row.start === null) return { key: "no-time", labelKey: null, label: null, rangeText: null };
    const minutes = minutesAt(row.start);
    const time = TIME_GROUPS.findLast(group => minutes >= group.from) ?? TIME_GROUPS[3];
    return { key: time.key, labelKey: time.labelKey, label: null, rangeText: time.rangeText };
  }
  if (groupBy === "area") {
    return {
      key: row.areaId === null ? "no-area" : `area:${row.areaId}`,
      label: row.areaName,
      labelKey: row.areaId === null ? "No area" : null,
      rangeText: null,
    };
  }
  return {
    key: row.worker ? `staff:${row.worker.id}` : "unassigned",
    label: row.worker?.name ?? null,
    labelKey: row.worker ? null : "Unassigned",
    rangeText: null,
  };
}

function groupRows(rows: readonly ScheduleRow[], groupBy: ScheduleGroupBy): ScheduleGroup[] {
  const groups = new Map<string, ScheduleGroup>();
  for (const row of rows) {
    const group = groupFor(row, groupBy);
    const existing = groups.get(group.key);
    if (existing) existing.rows.push(row);
    else groups.set(group.key, { ...group, rows: [row] });
  }
  const result = Array.from(groups.values());
  if (groupBy === "time") return result;
  return result.sort((a, b) => {
    if (a.labelKey === "No area" || b.labelKey === "Unassigned") return 1;
    if (b.labelKey === "No area" || a.labelKey === "Unassigned") return -1;
    return (a.label ?? "").localeCompare(b.label ?? "", "en");
  });
}

export function buildScheduleList(
  templates: readonly TaskTemplate[],
  staff: readonly LocationStaff[],
  context: SchedulePageContext,
  filters: ScheduleFilters = {},
  groupBy: ScheduleGroupBy = "time",
): ScheduleList {
  const rows = sortedEntries(templates, staff, context).map(({ row }) => row);
  const search = filters.search?.trim().toLowerCase();
  const filtered = rows.filter(row => {
    const workerName = row.worker === null ? "Unassigned" : row.worker.name;
    const workerId = row.worker?.id ?? "unassigned";
    return (!search || [row.title, row.areaName, workerName].some(name => name?.toLowerCase().includes(search)))
      && (filters.staff === undefined || filters.staff === workerId)
      && (filters.areaId === undefined || filters.areaId === row.areaId)
      && (filters.chip !== "needsAttention" || needsAttention(row))
      && (filters.chip !== "inactive" || row.inactive)
      && (filters.weekday === undefined || row.weekdays.includes(filters.weekday));
  });

  return {
    groups: groupRows(filtered, groupBy),
    counts: { all: rows.length, needsAttention: rows.filter(needsAttention).length, inactive: rows.filter(row => row.inactive).length },
  };
}

function jobsOn(entries: readonly ScheduleEntry[], date: string): ScheduleRow[] {
  return entries.filter(({ occurrence }) => scheduleOccursOn(occurrence, date)).map(({ row }) => row);
}

export function buildStaffWeek(
  templates: readonly TaskTemplate[],
  staff: readonly LocationStaff[],
  context: SchedulePageContext,
  weekStart: string,
): ScheduleStaffWeekRow[] {
  const entries = sortedEntries(templates, staff, context);
  const byWorker = new Map<number | null, ScheduleEntry[]>();
  for (const entry of entries) {
    const workerId = entry.row.worker?.id ?? null;
    const assigned = byWorker.get(workerId);
    if (assigned) assigned.push(entry);
    else byWorker.set(workerId, [entry]);
  }
  const people = staff.filter(person => person.isActive)
    .sort((a, b) => a.name.localeCompare(b.name, "en"))
    .map(person => workerFor(person.id, person, null, context.timeZone));
  const week = weekDays(weekStart);

  return [null, ...people].map(worker => {
    const assigned = byWorker.get(worker?.id ?? null) ?? [];
    const days = week.map(day => ({
      ...day,
      dayOff: worker?.workDays?.includes(day.weekday) === false,
      jobs: jobsOn(assigned, day.date),
    }));
    const count = days.reduce((total, day) => total + day.jobs.length, 0);
    return { worker, count, days };
  }).filter(row => row.worker !== null || row.count > 0);
}

export function buildDayAgenda(
  templates: readonly TaskTemplate[],
  staff: readonly LocationStaff[],
  context: SchedulePageContext,
  date: string,
): ScheduleRow[] {
  return jobsOn(sortedEntries(templates, staff, context), date);
}

export function buildScheduleDetails(
  template: TaskTemplate,
  staff: readonly LocationStaff[],
  context: SchedulePageContext,
): ScheduleDetails {
  const people = new Map(staff.map(person => [person.id, person]));
  const { row: facts, occurrence } = scheduleEntry(template, people, context);
  const nextDays: ScheduleDetails["nextDays"] = [];
  for (let offset = 0; offset <= 60 && nextDays.length < 3; offset++) {
    const day = calendarDay(context.today, offset);
    if (scheduleOccursOn(occurrence, day.date)) nextDays.push({ ...day, start: facts.start, end: facts.end });
  }
  return { facts, nextDays };
}
