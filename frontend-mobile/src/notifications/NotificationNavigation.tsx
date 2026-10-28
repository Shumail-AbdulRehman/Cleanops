import { useEffect } from "react";
import { StackActions, createNavigationContainerRef } from "@react-navigation/native";
import { useAuth } from "../auth/AuthContext";
import type { RootStackParamList } from "../types";
import { useNotifications } from "./NotificationProvider";
import { belongsToAccount, notificationDestination } from "./model";
import { acknowledgePhoneAlert } from "./api";
export const staffNavigation =
  createNavigationContainerRef<RootStackParamList>();
export function NotificationNavigation({ ready }: { ready: boolean }) {
  const { user, isBootstrapping, passwordChangeRequired } = useAuth(),
    { pending, consume } = useNotifications();
  useEffect(() => {
    if (
      !ready ||
      !staffNavigation.isReady() ||
      isBootstrapping ||
      passwordChangeRequired ||
      !user ||
      !pending
    )
      return;
    if (!belongsToAccount(pending, user)) {
      consume();
      return;
    }
    // popTo returns to the one existing StaffTabs and selects the tab; navigate would push a second tab navigator.
    staffNavigation.dispatch(
      StackActions.popTo("StaffTabs", {
        screen: notificationDestination(pending.kind),
      }),
    );
    void acknowledgePhoneAlert(pending.notificationId, `${user.companyId}_${user.id}`).catch(() => {});
    consume();
  }, [ready, isBootstrapping, passwordChangeRequired, user, pending, consume]);
  return null;
}
