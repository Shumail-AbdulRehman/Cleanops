export interface ScheduleItem {
  key: string; kind: 'actual' | 'planned'; instanceId: number | null; templateId: number | null;
  title: string; startsAt: string; endsAt: string; status: string | null;
  staff: { id: number; name: string } | null;
  verificationVersion?:number;verificationState?:string;completionOutcome?:string|null;areaNameSnapshot?:string;
  staffMeaning: 'actual' | 'template-default' | 'unassigned';
  continuesFromPreviousDay: boolean; continuesIntoNextDay: boolean;
}
export interface LocationSchedule {
  location: { id: number; name: string; timezone: string };
  weekStart: string; weekEndExclusive: string; asOf: string;
  days: Array<{ date: string; items: ScheduleItem[] }>;
}
export function normalizeWeek(value: string | null): string | undefined {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const date = new Date(`${value}T00:00:00Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) return undefined;
  date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
  return date.toISOString().slice(0, 10);
}
export function moveWeek(value: string, offset: number): string {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + offset * 7);
  return date.toISOString().slice(0, 10);
}
