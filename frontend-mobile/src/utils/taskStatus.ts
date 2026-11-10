import type { TaskInstance } from '../types';
export function taskCardStatus(task: Pick<TaskInstance, 'status' | 'completionOutcome' | 'verificationState'>) {
  if (task.status === 'COMPLETED' || task.completionOutcome) return 'Work submitted';
  if (task.status === 'NOT_COMPLETED_INTIME') return 'Overdue';
  if (task.status === 'MISSED') return 'Missed';
  if (task.status === 'CANCELLED') return 'Cancelled';
  if (task.status === 'PENDING') return 'Not started';
  if (task.verificationState === 'PROCESSING') return 'Photo received and being checked';
  if (task.verificationState === 'REWORK_REQUIRED') return 'Photo needs attention';
  return 'In progress';
}
