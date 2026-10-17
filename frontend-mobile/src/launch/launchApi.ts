import { client, accountRequest } from '../api/client';
import { captureAccount } from '../verification/captureAccount';
import type { ApiEnvelope, AttendanceRecord } from '../types';

export async function readAttendance() {
  const scope = captureAccount();
  if (!scope) throw new Error('Sign in again to continue.');
  return (await client.get<ApiEnvelope<AttendanceRecord[]>>('/staff/mobile/attendance', accountRequest(scope))).data.data;
}
