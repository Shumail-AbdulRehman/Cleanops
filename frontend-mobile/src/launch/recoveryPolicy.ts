import type { AttendanceRecord } from '../types';
import type { Manifest } from '../verification/types';

export type AttendanceAction = 'check-in' | 'check-out';

/** Only the selected persisted shift can resolve an uncertain attendance write. */
export function attendanceResult(records: AttendanceRecord[], expected: AttendanceRecord, mode: AttendanceAction) {
  const current = records.find(row => row.id === expected.id);
  if (!current || current.location?.id !== expected.location?.id ||
      current.expectedStart !== expected.expectedStart || current.expectedEnd !== expected.expectedEnd)
    throw new Error('Your shift changed. Refresh your attendance before retrying.');
  return { record: current, recorded: Boolean(mode === 'check-in' ? current.checkInTime : current.checkOutTime) };
}

/** Never automatically repeat a mutation after an uncertain network response. */
export async function reconcileAttendance(
  read: () => Promise<AttendanceRecord[]>, write: () => Promise<unknown>,
  expected: AttendanceRecord, mode: AttendanceAction,
) {
  const before = attendanceResult(await read(), expected, mode);
  if (before.recorded) return before.record;
  try { await write(); }
  catch (failure) {
    try {
      const after = attendanceResult(await read(), expected, mode);
      if (after.recorded) return after.record;
    } catch { /* Absence of confirmation is not permission to write again. */ }
    throw failure;
  }
  // The write may have succeeded while the subsequent read fails. The next
  // explicit attempt starts by reading again, rather than duplicating upload.
  const after = attendanceResult(await read(), expected, mode);
  if (!after.recorded) throw new Error('Attendance is not confirmed. Refresh before trying again.');
  return after.record;
}

export function photoAuthority(manifest: Manifest | null) {
  const qualified = manifest?.photoChecking?.available === true;
  return {
    capture: qualified && !!manifest?.allowedActions && (
      manifest.allowedActions.createSession || manifest.allowedActions.renewSession ||
      manifest.allowedActions.reworkSession === true || manifest.allowedActions.retakeSlots),
    upload: qualified && manifest?.allowedActions?.upload === true,
    qualified,
  };
}

export function passwordChangeRequired(error: unknown) {
  const response = (error as { response?: { status?: number; data?: { errors?: { code?: string }[] } } })?.response;
  return response?.status === 403 && response.data?.errors?.some(value => value.code === 'PASSWORD_CHANGE_REQUIRED') === true;
}

export function photoResultAction(state: string | undefined) {
  if (state && ['PASSED', 'REVIEW_REQUIRED', 'PRIVACY_HOLD', 'CLEANING_REQUIRED', 'RECAPTURE_REQUIRED'].includes(state)) return 'received';
  if (state && ['RECEIVED', 'QUALITY_CHECK', 'COVERAGE_CHECK', 'CLEANLINESS_CHECK', 'PROCESSING'].includes(state)) return 'checking';
  return 'retry';
}

/** Re-read the immutable receipt before posting, and after a lost response. */
export async function reconcileSubmission(read: () => Promise<Manifest>, write: () => Promise<unknown>) {
  const current = await read();
  if (current.staffSubmittedAt || current.task.status === 'COMPLETED') return current;
  try { await write(); }
  catch (error) {
    try {
      const after = await read();
      if (after.staffSubmittedAt || after.task.status === 'COMPLETED') return after;
    } catch { /* Keep the original failure; never manufacture a receipt. */ }
    throw error;
  }
  return read();
}
