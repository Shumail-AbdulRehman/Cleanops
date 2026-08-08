import { client } from '@/api/client';
import type { ApiEnvelope } from '../Subscription/types';

export type AttendanceAnnotation = {
  id: string;
  attendanceId: number;
  actorRole: 'ADMIN' | 'MANAGER' | 'STAFF';
  actorId: number;
  kind: 'NOTE' | 'ACKNOWLEDGEMENT';
  reason: string;
  parentId: string | null;
  createdAt: string;
};
export type AnnotationPage = {
  attendanceId: number;
  items: AttendanceAnnotation[];
  nextCursor: string | null;
};
export type AnnotationRequest = {
  requestId: string;
  reason: string;
} & ({ kind: 'NOTE' } | { kind: 'ACKNOWLEDGEMENT'; parentId: string });

export async function getAttendanceContext(id: number, after: string | undefined, signal?: AbortSignal) {
  return (await client.get<ApiEnvelope<AnnotationPage>>(`/attendance/${id}/annotations`, {
    params: { limit: 25, ...(after ? { after } : {}) }, signal,
  })).data.data;
}

export async function appendAttendanceContext(id: number, request: AnnotationRequest) {
  return (await client.post<ApiEnvelope<{ annotation: AttendanceAnnotation; reused: boolean }>>(
    `/attendance/${id}/annotations`, request,
  )).data.data;
}
