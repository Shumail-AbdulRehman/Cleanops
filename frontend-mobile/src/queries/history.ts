import { infiniteQueryOptions, useInfiniteQuery, useQuery, type InfiniteData } from '@tanstack/react-query';
import { client } from '../api/client';
import type { ApiEnvelope } from '../types';
import type { AttendanceMonth, HistoryFilter, ProfileSummary, TaskHistoryItem } from '../history/types';
import {
  parseAttendanceMonth,
  parseProfileSummary,
  parseTaskHistoryPage,
  type ParsedAttendanceMonth,
  type ParsedTaskHistoryPage,
} from '../history/parse';

export const HISTORY_UNAVAILABLE_MESSAGE = 'History is unavailable. Try again.';

export class HistoryUnavailableError extends Error {
  readonly notFound: boolean;
  constructor(notFound = false) {
    super(HISTORY_UNAVAILABLE_MESSAGE);
    this.name = 'HistoryUnavailableError';
    this.notFound = notFound;
  }
}

export type HistoryHttp = {
  get: (url: string, config?: { params?: Record<string, string>; signal?: AbortSignal }) => Promise<{ data: unknown }>;
};

export type TaskHistoryRequest = { month?: string; filter?: HistoryFilter; cursor?: string | null };

const statusOf = (error: unknown): number | undefined => {
  const status = (error as { response?: { status?: unknown } } | null)?.response?.status;
  return typeof status === 'number' ? status : undefined;
};

/** A 404 means the server predates Part 2: never retry it. Anything else retries once. */
export function shouldRetry(failureCount: number, error: unknown): boolean {
  if (error instanceof HistoryUnavailableError && error.notFound) return false;
  if (statusOf(error) === 404) return false;
  return failureCount < 1;
}

async function load<T>(
  http: HistoryHttp, path: string, params: Record<string, string>, signal: AbortSignal | undefined,
  parse: (value: unknown) => T | null,
): Promise<T> {
  let response: { data: unknown };
  try {
    response = await http.get(path, { params, signal });
  } catch (error) {
    if (statusOf(error) === 404) throw new HistoryUnavailableError(true);
    throw error;
  }
  const parsed = parse((response.data as ApiEnvelope<unknown> | null)?.data);
  if (!parsed) throw new HistoryUnavailableError();
  return parsed;
}

export function fetchTaskHistory(
  http: HistoryHttp, { month, filter, cursor }: TaskHistoryRequest, signal?: AbortSignal,
): Promise<ParsedTaskHistoryPage> {
  const params: Record<string, string> = {};
  if (month) params.month = month;
  if (filter) params.filter = filter;
  if (cursor) params.cursor = cursor;
  return load(http, '/staff/mobile/history', params, signal, parseTaskHistoryPage);
}

export function fetchAttendanceMonth(http: HistoryHttp, month?: string, signal?: AbortSignal): Promise<ParsedAttendanceMonth> {
  return load(http, '/staff/mobile/attendance/month', month ? { month } : {}, signal, parseAttendanceMonth);
}

export function fetchProfileSummary(http: HistoryHttp, signal?: AbortSignal): Promise<ProfileSummary> {
  return load(http, '/staff/mobile/profile', {}, signal, parseProfileSummary);
}

export const historyKeys = {
  tasks: (staffId: number | undefined, month: string | undefined, filter: HistoryFilter | undefined) =>
    ['staff', staffId, 'history', 'tasks', month, filter] as const,
  attendance: (staffId: number | undefined, month: string | undefined) =>
    ['staff', staffId, 'history', 'attendance', month] as const,
  profile: (staffId: number | undefined) => ['staff', staffId, 'history', 'profile'] as const,
};

export function flattenHistoryPages(data: InfiniteData<ParsedTaskHistoryPage> | undefined): TaskHistoryItem[] | undefined {
  if (!data) return undefined;
  return [...new Map(data.pages.flatMap((page) => page.items).map((item) => [item.id, item])).values()];
}

export function taskHistoryOptions(
  staffId: number | undefined, month: string | undefined, filter: HistoryFilter | undefined, enabled = true,
) {
  return infiniteQueryOptions({
    queryKey: historyKeys.tasks(staffId, month, filter),
    enabled: Boolean(staffId) && Boolean(month) && enabled,
    initialPageParam: null as string | null,
    queryFn: ({ pageParam, signal }) => fetchTaskHistory(client, { month, filter, cursor: pageParam }, signal),
    getNextPageParam: (page) => page.nextCursor,
    staleTime: 60 * 1000,
    retry: shouldRetry,
  });
}

export const useTaskHistory = (
  staffId: number | undefined, month: string | undefined, filter: HistoryFilter | undefined, enabled = true,
) => useInfiniteQuery(taskHistoryOptions(staffId, month, filter, enabled));

export const useAttendanceMonth = (staffId: number | undefined, month: string | undefined, enabled = true) => useQuery<AttendanceMonth>({
  queryKey: historyKeys.attendance(staffId, month),
  queryFn: ({ signal }) => fetchAttendanceMonth(client, month, signal),
  enabled: Boolean(staffId) && Boolean(month) && enabled,
  staleTime: 60 * 1000,
  retry: shouldRetry,
});

export const useProfileSummary = (staffId: number | undefined, enabled = true) => useQuery<ProfileSummary>({
  queryKey: historyKeys.profile(staffId),
  queryFn: ({ signal }) => fetchProfileSummary(client, signal),
  enabled: Boolean(staffId) && enabled,
  staleTime: 5 * 60 * 1000,
  retry: shouldRetry,
});
