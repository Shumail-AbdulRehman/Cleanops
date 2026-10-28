import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { AppState, Platform } from "react-native";
import NetInfo from "@react-native-community/netinfo";
import Constants from "expo-constants";
import { focusManager, onlineManager, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "../auth/AuthContext";
import { useLanguage } from "../i18n/LanguageProvider";
import type { NotificationResponse } from "expo-notifications";
import { staffQueryKeys } from "../queries/staff";
import {
  notificationTarget,
  type NotificationTarget,
} from "./model";
import { registerPhoneAlerts } from "./native";
import { staffLogoutQueue } from "../auth/pendingLogout";
const Context = createContext({
  pending: null as NotificationTarget | null,
  consume: () => {},
});
export const useNotifications = () => useContext(Context);
export function NotificationProvider({ children }: { children: ReactNode }) {
  const { user, isBootstrapping, passwordChangeRequired } = useAuth(),
    { language } = useLanguage(),
    cache = useQueryClient();
  const [pending, setPending] = useState<NotificationTarget | null>(null);
  const scope = user ? `${user.companyId}_${user.id}` : null,
    liveScope = useRef(scope);
  liveScope.current = scope;
  const registration = useRef<{ scope: string; promise: Promise<void> } | null>(
    null,
  );
  const register = useCallback(
    async (request = false) => {
      if (!scope || isBootstrapping || passwordChangeRequired) return;
      if (registration.current?.scope === scope)
        return registration.current.promise;
      const operation = (async () => {
        await registerPhoneAlerts(scope, language, request);
      })();
      registration.current = { scope, promise: operation };
      try {
        await operation;
      } finally {
        if (registration.current?.promise === operation)
          registration.current = null;
      }
    },
    [scope, language, isBootstrapping, passwordChangeRequired],
  );
  useEffect(() => {
    void register(true);
  }, [register]);
  useEffect(() => {
    const unsubscribe = NetInfo.addEventListener((state) => {
      onlineManager.setOnline(state.isConnected !== false && state.isInternetReachable !== false);
      if (state.isConnected && state.isInternetReachable !== false) {
        void staffLogoutQueue.flush().catch(() => {});
        void register();
      }
    });
    const subscription = AppState.addEventListener("change", (state) => {
      const active = state === "active";
      focusManager.setFocused(active);
      if (active) {
        void staffLogoutQueue.flush().catch(() => {});
        void register();
        void cache.invalidateQueries({ queryKey: staffQueryKeys.all });
      }
    });
    return () => {
      unsubscribe();
      subscription.remove();
    };
  }, [register, cache]);
  useEffect(() => {
    if (Platform.OS === "web" || Constants.appOwnership === "expo") return;
    let cancelled = false;
    const cleanup: Array<() => void> = [];
    void import("expo-notifications")
      .then(async (notifications) => {
        if (cancelled) return;
        notifications.setNotificationHandler({
          handleNotification: async (notification) => {
            const target = notificationTarget(
              notification.request.content.data,
            );
            const valid =
              !!target &&
              liveScope.current === `${target.companyId}_${target.staffId}`;
            return {
              shouldShowBanner: valid,
              shouldShowList: valid,
              shouldPlaySound: valid,
              shouldSetBadge: false,
              priority: notifications.AndroidNotificationPriority.HIGH,
            };
          },
        });
        const receive = notifications.addNotificationReceivedListener(() => {
          void cache.invalidateQueries({ queryKey: staffQueryKeys.all });
        });
        cleanup.push(() => receive.remove());
        const respond = (response: NotificationResponse) => {
          const target = notificationTarget(
            response.notification.request.content.data,
          );
          if (target) setPending(target);
          void notifications.clearLastNotificationResponseAsync();
        };
        const responses =
          notifications.addNotificationResponseReceivedListener(respond);
        cleanup.push(() => responses.remove());
        const tokens = notifications.addPushTokenListener(() => {
          void register();
        });
        cleanup.push(() => tokens.remove());
        const initial = await notifications.getLastNotificationResponseAsync();
        if (!cancelled && initial) respond(initial);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      cleanup.forEach((fn) => fn());
    };
  }, [cache, register]);
  return (
    <Context.Provider
      value={{
        pending,
        consume: () => setPending(null),
      }}
    >
      {children}
    </Context.Provider>
  );
}
