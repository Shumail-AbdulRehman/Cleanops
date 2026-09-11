export type TaskWorker = { id?: number; name: string; email?: string | null };
export type WorkerAssignment = {
  id?: number;
  staffId?: number;
  isCurrent: boolean;
  status?: string;
  assignedAt?: string;
  staff?: TaskWorker | null;
};
export type TaskWithWorker = {
  staffId: number | null;
  staff?: TaskWorker | null;
  assignments?: WorkerAssignment[];
};

// The task's staffId is the current worker pointer. A closed assignment still
// identifies the previous responsible worker, but must never appear as current.
export function taskAssignee(task: TaskWithWorker) {
  const history = [...(task.assignments ?? [])].sort(
    (a, b) =>
      (Date.parse(b.assignedAt ?? "") || 0) -
        (Date.parse(a.assignedAt ?? "") || 0) || (b.id ?? 0) - (a.id ?? 0),
  );
  if (task.staffId != null) {
    const assignment = history.find(
      (a) => a.staffId === task.staffId || a.staff?.id === task.staffId,
    );
    return {
      worker:
        task.staff?.id == null || task.staff.id === task.staffId
          ? (task.staff ?? assignment?.staff ?? null)
          : (assignment?.staff ?? null),
      previous: false,
      assignment,
    };
  }
  const assignment = history[0];
  return {
    worker: assignment?.staff ?? null,
    previous: !!assignment?.staff,
    assignment,
  };
}

export function assignmentLabel(status?: string) {
  return (
    (
      {
        ASSIGNED: "Assigned",
        STARTED: "Started",
        MISSED: "Missed assignment",
        FAILED: "Failed assignment",
        CANCELLED: "Cancelled assignment",
        REASSIGNED: "Reassigned",
        COMPLETED: "Completed assignment",
      } as Record<string, string>
    )[status ?? ""] ?? ""
  );
}
