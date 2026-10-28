export const notificationKinds = [
  "TASK_ASSIGNED",
  "TASK_CHANGED",
  "SHIFT_APPROACHING",
  "MISSING_CHECK_IN",
  "CHECKOUT_APPROACHING",
] as const;
export type NotificationKind = (typeof notificationKinds)[number];
export type NotificationTarget = {
  notificationId: number;
  staffId: number;
  companyId: number;
  kind?: string;
};
export function notificationTarget(input: unknown): NotificationTarget | null {
  if (!input || typeof input !== "object") return null;
  const value = input as Record<string, unknown>;
  for (const key of ["notificationId", "staffId", "companyId"])
    if (!Number.isSafeInteger(value[key]) || Number(value[key]) <= 0)
      return null;
  return {
    notificationId: Number(value.notificationId),
    staffId: Number(value.staffId),
    companyId: Number(value.companyId),
    kind: notificationKinds.includes(value.kind as NotificationKind)
      ? value.kind as NotificationKind : undefined,
  };
}
export function belongsToAccount(
  target: NotificationTarget,
  user: { id: number; companyId: number } | null,
) {
  return (
    !!user && target.staffId === user.id && target.companyId === user.companyId
  );
}
export const notificationDestination = (kind?: string) =>
  kind?.startsWith("TASK_") ? ("Tasks" as const) : ("Shift" as const);
