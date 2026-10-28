import { Platform } from "react-native";
import * as Crypto from "expo-crypto";
import * as SecureStore from "expo-secure-store";
import Constants from "expo-constants";
import { client, accountRequest } from "../api/client";
import { captureAccount } from "../verification/captureAccount";
import { configureAndroidAlertChannels, configureStaffAlertActions } from "./channels";
const KEY = "hygene-notification-installation";
let identity: Promise<string> | null = null;
export function notificationDeviceId() {
  if (!identity)
    identity = (async () => {
      let id = await SecureStore.getItemAsync(KEY);
      if (!id) {
        id = Crypto.randomUUID();
        await SecureStore.setItemAsync(KEY, id);
      }
      return id;
    })().catch((error) => {
      identity = null;
      throw error;
    });
  return identity;
}
export type PushAvailability = "enabled" | "denied" | "unavailable" | "retry";
export async function registerPhoneAlerts(
  scope: string,
  language: string,
  requestPermission: boolean,
): Promise<PushAvailability> {
  if (Platform.OS === "web" || Constants.appOwnership === "expo")
    return "unavailable";
  try {
    const device = await import("expo-device");
    if (!device.isDevice) return "unavailable";
    const notifications = await import("expo-notifications");
    if (Platform.OS === "android")
      await configureAndroidAlertChannels(notifications, language);
    await configureStaffAlertActions(notifications, language);
    let permission = await notifications.getPermissionsAsync();
    if (!permission.granted && requestPermission && permission.canAskAgain)
      permission = await notifications.requestPermissionsAsync();
    const id = await notificationDeviceId();
    if (!permission.granted) {
      if (captureAccount() === scope)
        await client
          .delete(`/staff-notifications/devices/${id}`, accountRequest(scope))
          .catch(() => {});
      return "denied";
    }
    const projectId =
      Constants.expoConfig?.extra?.eas?.projectId ??
      Constants.easConfig?.projectId;
    if (!projectId) return "unavailable";
    const token = (await notifications.getExpoPushTokenAsync({ projectId }))
      .data;
    if (captureAccount() !== scope) return "retry";
    await client.post(
      "/staff-notifications/devices",
      { id, token, projectId, platform: Platform.OS, language, alertChannelVersion: 3 },
      accountRequest(scope),
    );
    return "enabled";
  } catch {
    return "retry";
  }
}
export async function clearPhoneAlerts() {
  if (Platform.OS === "web" || Constants.appOwnership === "expo") return;
  try {
    const notifications = await import("expo-notifications");
    await notifications.cancelAllScheduledNotificationsAsync();
    await notifications.dismissAllNotificationsAsync();
    await notifications.clearLastNotificationResponseAsync();
  } catch {
    /* Native module may be absent in the currently installed older app. */
  }
}
