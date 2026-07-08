export const notificationKinds = [
  "TASK_ASSIGNED",
  "TASK_CHANGED",
  "SHIFT_APPROACHING",
  "MISSING_CHECK_IN",
  "CHECKOUT_APPROACHING",
] as const;
export type NotificationKind = (typeof notificationKinds)[number];
export function notificationAlertChannel(kind: string, version = 1) {
  if (version !== 3) return kind.startsWith("TASK_") ? "tasks" : "attendance";
  if (!notificationKinds.includes(kind as NotificationKind)) throw new Error("Unsupported staff notification");
  return `staff-${kind.toLowerCase().replaceAll("_", "-")}-v3`;
}
export function notificationAlertCategory(kind: string) {
  return notificationAlertChannel(kind, 3).replaceAll("-", "_");
}
export function notificationMessage(
  kind: string,
  change: string | undefined,
  language = "en",
  taskTitle?: unknown,
) {
  const messages: Record<string, [string, string, string, string]> = {
    TASK_ASSIGNED: [
      "🧹 New task assigned",
      "Open Tasks to view your new cleaning task.",
      "🧹 نیا کام مقرر ہوا ہے",
      "اپنا نیا صفائی کا کام دیکھنے کے لیے کام کھولیں۔",
    ],
    TASK_CHANGED:
      change === "cancelled"
        ? [
            "⛔ Task cancelled",
            "A cleaning task has been cancelled. Open Tasks for the latest work.",
            "⛔ کام منسوخ ہو گیا",
            "صفائی کا ایک کام منسوخ ہو گیا ہے۔ تازہ فہرست کے لیے کام کھولیں۔",
          ]
        : [
            "🔄 Task reassigned",
            "A task is no longer assigned to you. Open Tasks for the latest work.",
            "🔄 کام کسی اور کو مقرر ہو گیا",
            "یہ کام اب آپ کو مقرر نہیں ہے۔ تازہ فہرست کے لیے کام کھولیں۔",
          ],
    SHIFT_APPROACHING: [
      "🕒 Your shift starts soon",
      "Your shift starts in about 10 minutes. Remember to check in.",
      "🕒 آپ کی شفٹ جلد شروع ہو گی",
      "آپ کی شفٹ تقریباً 10 منٹ میں شروع ہو گی۔ حاضری لگانا یاد رکھیں۔",
    ],
    MISSING_CHECK_IN: [
      "⚠️ Check-in needed",
      "Your shift has started and your check-in is still missing.",
      "⚠️ حاضری درج کریں",
      "آپ کی شفٹ شروع ہو چکی ہے اور حاضری ابھی درج نہیں ہوئی۔",
    ],
    CHECKOUT_APPROACHING: [
      "✅ Remember to check out",
      "Your shift ends in about 10 minutes. Check out when you finish.",
      "✅ روانگی درج کرنا یاد رکھیں",
      "آپ کی شفٹ تقریباً 10 منٹ میں ختم ہو گی۔ کام ختم ہونے پر روانگی درج کریں۔",
    ],
  };
  const row = messages[kind];
  if (!row) throw new Error("Unsupported staff notification");
  const task = kind.startsWith("TASK_") && typeof taskTitle === "string"
    ? taskTitle.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 100)
    : "";
  return {
    title: row[language === "ur" ? 2 : 0],
    body: (task ? `${task}\n` : "") + row[language === "ur" ? 3 : 1],
    subtitle: kind.startsWith("TASK_")
      ? (language === "ur" ? "صفائی کے کام" : "Cleaning tasks")
      : (language === "ur" ? "حاضری" : "Attendance"),
  };
}
export type Source = {
  staffId: number | null;
  status?: string;
  isActive?: boolean;
  staffSubmittedAt?: Date | null;
  shiftEnd?: Date;
  expectedStart?: Date;
  expectedEnd?: Date;
  checkInTime?: Date | null;
  checkOutTime?: Date | null;
};
export function notificationCurrent(
  n: { kind: string; staffId: number; expiresAt: Date; data: unknown },
  source: Source | null,
  now: Date,
) {
  if (n.expiresAt <= now) return false;
  const data = n.data as {
    change?: string;
    windowStart?: string;
    graceMinutes?: number;
  };
  if (n.kind === "TASK_CHANGED")
    return (
      !source ||
      (data.change === "cancelled"
        ? !source.isActive || source.status === "CANCELLED"
        : source.staffId !== n.staffId)
    );
  if (!source || source.staffId !== n.staffId) return false;
  if (n.kind === "TASK_ASSIGNED")
    return (
      source.isActive &&
      ["PENDING", "IN_PROGRESS"].includes(source.status ?? "") &&
      !source.staffSubmittedAt &&
      !!source.shiftEnd &&
      source.shiftEnd > now
    );
  if (
    !source.expectedStart ||
    !source.expectedEnd ||
    source.checkOutTime ||
    data.windowStart !== source.expectedStart.toISOString()
  )
    return false;
  if (n.kind === "SHIFT_APPROACHING")
    return (
      !source.checkInTime &&
      now < source.expectedStart &&
      +now >= +source.expectedStart - 10 * 60000
    );
  if (n.kind === "MISSING_CHECK_IN")
    return (
      !source.checkInTime &&
      +now >= +source.expectedStart + (data.graceMinutes ?? 10) * 60000 &&
      now < source.expectedEnd
    );
  if (n.kind === "CHECKOUT_APPROACHING")
    return (
      !!source.checkInTime &&
      now < source.expectedEnd &&
      +now >= +source.expectedEnd - 10 * 60000
    );
  return false;
}
export const retryDelayMs = (attempt: number) =>
  Math.min(3600000, 30000 * 2 ** Math.max(0, attempt - 1));
