import { infiniteQueryOptions, type InfiniteData, type QueryKey } from '@tanstack/react-query';
import { client } from '../api/client';
import type { ApiEnvelope, TaskInstance } from '../types';
export type TaskCounts = { total: number; submitted: number; pending: number; inProgress: number };
export type MobileTaskPage = { tasks: TaskInstance[]; counts: TaskCounts; nextCursor: string | null };
export function mobileTaskOptions(queryKey: QueryKey, enabled = true) {
  return infiniteQueryOptions({
    queryKey, enabled, initialPageParam: null as string | null,
    queryFn: async ({ pageParam, signal }): Promise<MobileTaskPage> => (await client.get<ApiEnvelope<MobileTaskPage>>('/staff/mobile/tasks', {
      params: pageParam ? { cursor: pageParam } : {}, signal,
    })).data.data,
    getNextPageParam: page => page.nextCursor,
    staleTime: 30000, refetchOnMount: true, refetchOnWindowFocus: true,
    refetchInterval: 60000, refetchIntervalInBackground: false,
  });
}
export function flattenTaskPages(data: InfiniteData<MobileTaskPage> | undefined) {
  if (!data) return undefined;
  return [...new Map(data.pages.flatMap(page => page.tasks).map(task => [task.id, task])).values()];
}
export function updateStartedTask(data: TaskInstance[] | InfiniteData<MobileTaskPage> | undefined, update: TaskInstance) {
  if (!data) return data;
  if (Array.isArray(data)) return data.map(t => t.id === update.id ? { ...t, ...update } : t);
  const previous = data.pages.flatMap(p => p.tasks).find(t => t.id === update.id);
  return { ...data, pages: data.pages.map((page, index) => ({ ...page,
    tasks: page.tasks.map(t => t.id === update.id ? { ...t, ...update } : t),
    counts: index === 0 && previous?.status === 'PENDING' && update.status === 'IN_PROGRESS'
      ? { ...page.counts, pending: Math.max(0, page.counts.pending - 1), inProgress: page.counts.inProgress + 1 } : page.counts,
  })) };
}
