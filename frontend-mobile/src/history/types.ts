// Client types for the Part 2 staff endpoints, field for field from
// specs-mobile-redesign/ARCHITECTURE.md#api. Months are `YYYY-MM`, dates
// `YYYY-MM-DD` (location timezone), instants ISO strings.

export const TASK_HISTORY_STATUSES = [
  'MISSED',
  'VERIFIED',
  'ACCEPTED_WITH_EXCEPTIONS',
  'WAITING_FOR_REVIEW',
  'SUBMITTED',
] as const;
export type TaskHistoryStatus = (typeof TASK_HISTORY_STATUSES)[number];

export const REVIEW_STATES = ['NOT_NEEDED', 'OPEN', 'CLOSED'] as const;
export type ReviewState = (typeof REVIEW_STATES)[number];

export const HISTORY_FILTERS = ['all', 'verified', 'waiting', 'missed'] as const;
export type HistoryFilter = (typeof HISTORY_FILTERS)[number];

export const ATTENDANCE_DAY_STATES = [
  'UPCOMING',
  'ABSENT',
  'MISSED_CHECKOUT',
  'ON_SHIFT',
  'LATE',
  'ON_TIME',
] as const;
export type AttendanceDayState = (typeof ATTENDANCE_DAY_STATES)[number];

export type HistoryRange = {
  earliestMonth: string;
  latestMonth: string;
};

export type NamedLocation = {
  id: number;
  name: string;
};

export type TaskHistoryItem = {
  id: number;
  areaName: string;
  title: string;
  date: string;
  shiftStart: string;
  shiftEnd: string;
  timezone: string;
  status: TaskHistoryStatus;
  reviewState: ReviewState;
  startedAt: string | null;
  submittedAt: string | null;
  photos: { received: number; required: number };
  location: NamedLocation;
};

export type TaskHistoryCounts = {
  verified: number;
  waiting: number;
  missed: number;
  total: number;
};

export type TaskHistoryPage = {
  month: string;
  timezone: string;
  range: HistoryRange;
  counts: TaskHistoryCounts;
  items: TaskHistoryItem[];
  nextCursor: string | null;
};

export type AttendanceMonthRecord = {
  id: number;
  date: string;
  expectedStart: string;
  expectedEnd: string;
  checkInTime: string | null;
  checkOutTime: string | null;
  lateMinutes: number | null;
  location: NamedLocation;
  state: AttendanceDayState;
};

export type AttendanceMonthCounts = {
  onTime: number;
  late: number;
  absent: number;
  missedCheckout: number;
};

export type AttendanceMonth = {
  month: string;
  timezone: string;
  range: HistoryRange;
  counts: AttendanceMonthCounts;
  records: AttendanceMonthRecord[];
};

export type ProfileMonthFigures = {
  month: string;
  shiftsScheduled: number;
  shiftsAttended: number;
  onTime: number;
  tasksAssigned: number;
  tasksSubmitted: number;
};

export type ProfileSummary = {
  id: number;
  name: string;
  email: string | null;
  phone: string | null;
  joinedAt: string;
  company: { name: string };
  location: { id: number; name: string; address: string; timezone: string } | null;
  usualShift: { start: string; end: string } | null;
  manager: { name: string } | null;
  month: ProfileMonthFigures;
};
