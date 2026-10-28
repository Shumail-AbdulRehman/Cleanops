import { useMemo } from 'react';
import { useQuery, useInfiniteQuery } from '@tanstack/react-query';
import { client } from '../api/client';
import type { ApiEnvelope, AttendanceRecord } from '../types';
import { flattenTaskPages, mobileTaskOptions } from './mobileWork';
export const staffQueryKeys = {
  all: ['staff'] as const,
  attendance: (staffId: number | undefined) => [...staffQueryKeys.all, staffId, 'attendance'] as const,
  tasksToday: (staffId: number | undefined) => [...staffQueryKeys.all, staffId, 'tasks', 'today', 'mobile-v1'] as const,
};
export const useMyAttendanceQuery = (staffId: number | undefined, enabled = true) => useQuery({
  queryKey: staffQueryKeys.attendance(staffId),
  queryFn: async ({ signal }) => (await client.get<ApiEnvelope<AttendanceRecord[]>>('/staff/mobile/attendance', { signal })).data.data,
  enabled: Boolean(staffId) && enabled,
  staleTime: 30000, refetchOnMount: true, refetchOnWindowFocus: true,
});
export function useTodaysTasksQuery(staffId: number | undefined, enabled = true) {
  const query = useInfiniteQuery(mobileTaskOptions(staffQueryKeys.tasksToday(staffId), Boolean(staffId) && enabled));
  const data = useMemo(() => flattenTaskPages(query.data), [query.data]);
  return { ...query, data, counts: query.data?.pages[0]?.counts };
}
