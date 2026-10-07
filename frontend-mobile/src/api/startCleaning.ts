import type { QueryClient, QueryKey } from '@tanstack/react-query';
import { client } from './client';
import type { ApiEnvelope, TaskInstance } from '../types';
import { updateStartedTask, type MobileTaskPage } from '../queries/mobileWork';
import type { InfiniteData } from '@tanstack/react-query';

export async function startCleaning(queryClient: QueryClient, queryKey: QueryKey, taskId: number, areaQr: string) {
  const response = await client.post<ApiEnvelope<TaskInstance>>(`/task-instance/${taskId}/start`, { areaQr });
  // Cancel an older feed response before applying the server-confirmed start.
  await queryClient.cancelQueries({ queryKey });
  queryClient.setQueryData<TaskInstance[] | InfiniteData<MobileTaskPage>>(queryKey, tasks =>
    updateStartedTask(tasks, response.data.data));
  // Refresh related verification data without making staff wait for another feed.
  void queryClient.invalidateQueries({ queryKey }).catch(() => {});
  return response.data.data;
}
