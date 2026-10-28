import type * as Notifications from "expo-notifications";

// New IDs migrate the original DEFAULT channels. Existing channels and the
// user's later notification settings are deliberately preserved.
export const staffAlertEvents = [
  { kind: "TASK_ASSIGNED", id: "staff-task-assigned-v3", name: "New cleaning tasks", urdu: "صفائی کے نئے کام", vibration: [0, 180, 100, 180], action: "View task", urduAction: "کام دیکھیں" },
  { kind: "TASK_CHANGED", id: "staff-task-changed-v3", name: "Task changes", urdu: "کام میں تبدیلی", vibration: [0, 320], action: "View updated tasks", urduAction: "تازہ کام دیکھیں" },
  { kind: "SHIFT_APPROACHING", id: "staff-shift-approaching-v3", name: "Shift starting soon", urdu: "شفٹ جلد شروع ہو گی", vibration: [0, 140, 160, 140, 160, 140], action: "View shift", urduAction: "شفٹ دیکھیں" },
  { kind: "MISSING_CHECK_IN", id: "staff-missing-check-in-v3", name: "Check-in needed", urdu: "حاضری درج کریں", vibration: [0, 400, 150, 400], action: "Check in", urduAction: "حاضری لگائیں" },
  { kind: "CHECKOUT_APPROACHING", id: "staff-checkout-approaching-v3", name: "Checkout reminders", urdu: "روانگی کی یاد دہانی", vibration: [0, 120, 100, 120, 100, 300], action: "Check out", urduAction: "روانگی درج کریں" },
] as const;
export const defaultStaffAlertChannel = staffAlertEvents[0].id;

export async function configureAndroidAlertChannels(
  notifications: Pick<typeof Notifications,
    "setNotificationChannelAsync" | "AndroidImportance" | "AndroidNotificationVisibility">,
  language = "en",
) {
  for (const event of staffAlertEvents) {
    await notifications.setNotificationChannelAsync(event.id, {
      name: language === "ur" ? event.urdu : event.name,
      importance: notifications.AndroidImportance.HIGH,
      sound: "default",
      enableVibrate: true,
      vibrationPattern: [...event.vibration],
      lightColor: "#4264D9",
      lockscreenVisibility: notifications.AndroidNotificationVisibility.PRIVATE,
    });
  }
}

export async function configureStaffAlertActions(
  notifications: Pick<typeof Notifications, "setNotificationCategoryAsync">,
  language = "en",
) {
  for (const event of staffAlertEvents) {
    // Expo categories must not contain '-' or ':', unlike Android channels.
    await notifications.setNotificationCategoryAsync(event.id.replaceAll("-", "_"), [{
      identifier: "open_work",
      buttonTitle: language === "ur" ? event.urduAction : event.action,
      options: { opensAppToForeground: true },
    }]);
  }
}
