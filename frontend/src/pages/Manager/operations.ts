import { client } from "@/api/client";
import { useQuery } from "@tanstack/react-query";
import { useSelector } from "react-redux";
import type { RootState } from "@/store/store";
import type { WorkerAssignment } from "../Task/taskAssignee";
export type LocationScope = { id: number; name: string; timezone: string };
export type OperationTask = {
  id: number;
  title: string;
  shiftStart: string;
  shiftEnd: string;
  status: string;
  rawStatus: string;
  staffSubmittedAt: string | null;
  verificationVersion: number;
  verificationState: string;
  completionOutcome: string | null;
  areaNameSnapshot: string | null;
  locationId: number;
  staffId: number | null;
  templateId: number | null;
  carryOver: boolean;
  location: LocationScope;
  staff: { id: number; name: string } | null;
  assignments?: WorkerAssignment[];
  verificationException: { id: number; state: string } | null;
};
export type OperationStaff = {
  id: number;
  name: string;
  location: LocationScope;
  localDate: string;
  carryOver: boolean;
  attendance: {
    id: number;
    status: string;
    expectedStart: string;
    expectedEnd: string;
    checkInTime: string | null;
    checkOutTime: string | null;
  } | null;
  attendances: OperationStaff["attendance"][];
  tasks: OperationTask[];
  taskCount: number;
  submittedCount: number;
};
export type OperationsBase = {
  locations: LocationScope[];
  selected: LocationScope[];
  days: Array<{ locationId: number; localDate: string; timezone: string }>;
  asOf: string;
  date: string;
};
export type OperationHourlyProgress = {
  /** Location-local clock hour, from 0 through 23. Counts are cumulative. */
  hour: number;
  due: number;
  /** Null means not yet observed, rather than zero submissions. */
  submitted: number | null;
};
export type OperationOverview = OperationsBase & {
  /** Optional while older API instances remain in a rolling deployment. */
  hourly?: OperationHourlyProgress[];
  metrics: {
    present: number;
    scheduled: number;
    totalStaff: number;
    totalTasks: number;
    submitted: number;
    reviewCount: number;
    verified: number;
    accepted: number;
  };
  chart: {
    submitted: number;
    inProgress: number;
    notStarted: number;
    overdue: number;
  };
  attention: Array<{
    key: string;
    kind: string;
    caseId?: number;
    staff?: { id: number; name: string };
    task?: OperationTask;
    location?: LocationScope;
    reasonCode: string;
  }>;
  tasks: OperationTask[];
  /** Every selected location, including empty ones; no four-row limit. */
  comparison: Array<{
    location: LocationScope;
    present: number;
    scheduled: number;
    tasks: number;
    submitted: number;
    reviews: number;
  }>;
};
export type OperationsPage<T> = OperationsBase & {
  rows: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
};
export function useOperations<T>(
  kind: "overview" | "staff" | "tasks",
  filters: Record<string, string>,
  enabled = true,
) {
  const scope = useSelector(
    (s: RootState) =>
      `${s.auth.user?.companyId}:${s.auth.user?.role}:${s.auth.user?.id}`,
  );
  return useQuery({
    queryKey: ["operations", scope, kind, filters],
    queryFn: async ({ signal }) =>
      (
        await client.get<{ data: T }>(`/manager/operations/${kind}`, {
          params: filters,
          signal,
        })
      ).data.data,
    enabled,
    // Only bounded API responses live in memory; no localStorage persistence.
    // Overview gets a short reuse window. Today remains more responsive.
    staleTime: kind === "overview" ? 30000 : 15000,
    gcTime: kind === "overview" ? 120000 : 60000,
    refetchInterval: kind === "overview" ? 60000 : 30000,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
  });
}
export function scopeParams(params: URLSearchParams) {
  return Object.fromEntries(
    ["locationId", "date"]
      .map((k) => [k, params.get(k) ?? (k === "date" ? "today" : "")])
      .filter(([, v]) => v),
  );
}
export function dailyLink(
  params: URLSearchParams,
  extra: Record<string, string> = {},
) {
  return (
    "/today-status?" + new URLSearchParams({ ...scopeParams(params), ...extra })
  );
}
export function locationTaskLink(task: { id: number; locationId: number }) {
  return `/locations/${task.locationId}?tab=instances&taskId=${task.id}#location-task-history`;
}
export function reviewLink(params: URLSearchParams) {
  const scope = scopeParams(params);
  const date = scope.date ?? "today";
  return (
    "/exceptions?" +
    new URLSearchParams({
      ...scope,
      queue: "needs-me",
      period: date === "today" ? "today" : "date",
    })
  );
}
export function workLabel(task: OperationTask) {
  if (task.staffSubmittedAt || task.status === "COMPLETED")
    return "Work submitted";
  if (task.status === "MISSED" || task.status === "NOT_COMPLETED_INTIME")
    return "Overdue";
  if (task.status === "IN_PROGRESS") return "In progress";
  if (task.status === "CANCELLED") return "Cancelled";
  return "Not started";
}
export function localTime(
  date: string,
  timezone: string,
  language = "en",
  full = false,
) {
  return new Intl.DateTimeFormat(language === "ur" ? "ur-PK" : "en-PK", {
    timeZone: timezone,
    ...(full ? { day: "numeric", month: "short" } : {}),
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(date));
}
