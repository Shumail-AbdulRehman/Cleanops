import * as React from "react";
import {
  AccessibilityInfo,
  ActivityIndicator,
  Image,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { useAuth } from "../auth/AuthContext";
import { ActionButton } from "../design/ActionButton";
import { SnackbarProvider } from "../design/Feedback";
import { StaffText } from "../design/StaffText";
import { colors, space } from "../design/tokens";
import { useLanguage } from "../i18n/LanguageProvider";
import { HelpScreen } from "../screens/HelpScreen";
import { LoginScreen } from "../screens/LoginScreen";
import { HistoryTaskScreen } from "../screens/history/HistoryTaskScreen";
import { StartTaskScreen } from "../screens/StartTaskScreen";
import { TaskAlertsScreen } from "../screens/profile/TaskAlertsScreen";
import { TaskDetailScreen } from "../screens/task/TaskDetailScreen";
import { SpatialDiagnosticScreen } from "../screens/verification/SpatialDiagnosticScreen";
import { VerificationScreen } from "../screens/verification/VerificationScreen";
import type { RootStackParamList } from "../types";
import { stackRoutes } from "./routeNames";
import { StaffTabs } from "./StaffTabs";

const Stack = createNativeStackNavigator<RootStackParamList>();

/** True while the phone asks for reduced motion; pushes then fade instead of slide. */
function useReduceMotion(): boolean {
  const [reduced, setReduced] = React.useState(false);
  React.useEffect(() => {
    let alive = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then(value => { if (alive) setReduced(value); })
      .catch(() => {});
    const subscription = AccessibilityInfo.addEventListener("reduceMotionChanged", value => setReduced(value));
    return () => {
      alive = false;
      subscription?.remove?.();
    };
  }, []);
  return reduced;
}

/** Shown while the saved sign-in is restored: the one allowed whole-screen spinner. */
function SessionRestore() {
  return (
    <View style={styles.restore}>
      <Image source={require("../../assets/hygene-ops-mark.png")} style={styles.mark} accessible={false} />
      <StaffText role="sectionTitle" align="center" accessibilityLiveRegion="polite">Loading your day</StaffText>
      <ActivityIndicator size="large" color={colors.blue} />
    </View>
  );
}

function SignInAgain({ logout }: { logout: () => Promise<void> }) {
  const insets = useSafeAreaInsets();
  const { isRTL } = useLanguage();
  const signOut = () => { void logout().catch(() => {}); };
  return (
    <View style={styles.page}>
      <View style={[styles.heading, { paddingTop: insets.top, height: HEADING_HEIGHT + insets.top, flexDirection: isRTL ? "row-reverse" : "row" }]}>
        <StaffText role="barTitle" numberOfLines={1} accessibilityRole="header">Sign in again</StaffText>
      </View>
      <ScrollView
        contentContainerStyle={[styles.notice, { paddingBottom: insets.bottom + space.gutter }]}
      >
        <StaffText role="body">Your sign-in has changed. Sign out, then sign in with your phone number and a new code.</StaffText>
        <ActionButton kind="outline" label="Sign out" icon="LogOut" onPress={signOut} />
      </ScrollView>
    </View>
  );
}

export function AppNavigator() {
  const { t } = useLanguage();
  const reduceMotion = useReduceMotion();
  const { user, isBootstrapping, passwordChangeRequired, logout } = useAuth();

  let content: React.ReactNode;
  if (isBootstrapping) {
    content = <SessionRestore />;
  } else if (user && passwordChangeRequired) {
    content = <SignInAgain logout={logout} />;
  } else {
    content = (
      <Stack.Navigator
        screenOptions={{
          animation: reduceMotion ? "fade" : "default",
          headerShadowVisible: false,
          headerStyle: { backgroundColor: colors.surface },
          headerTitleStyle: { color: colors.ink, fontWeight: "700" },
          headerTintColor: colors.blueDeep,
          contentStyle: { backgroundColor: colors.surface },
        }}
      >
        {user ? (
          <>
            <Stack.Screen name={stackRoutes.staffTabs} component={StaffTabs} options={{ headerShown: false }} />
            <Stack.Screen name={stackRoutes.taskDetail} component={TaskDetailScreen} options={{ headerShown: false }} />
            <Stack.Screen name={stackRoutes.helpGuide} component={HelpScreen} options={{ headerShown: false }} />
            <Stack.Screen name={stackRoutes.taskAlerts} component={TaskAlertsScreen} options={{ headerShown: false }} />
            <Stack.Screen name={stackRoutes.historyTask} component={HistoryTaskScreen} options={{ headerShown: false }} />
            {__DEV__ ? (
              <Stack.Screen
                name="SpatialDiagnostic"
                component={SpatialDiagnosticScreen}
                options={{ title: "Spatial diagnostic" }}
              />
            ) : null}
            <Stack.Screen
              name={stackRoutes.verification}
              initialParams={{ requirePhotoQr: true }}
              component={VerificationScreen}
              options={{ title: t("Task photos") }}
            />
            <Stack.Screen
              name={stackRoutes.startTask}
              component={StartTaskScreen}
              options={{ title: t("Start cleaning") }}
            />
          </>
        ) : (
          <Stack.Screen name={stackRoutes.login} component={LoginScreen} options={{ headerShown: false }} />
        )}
      </Stack.Navigator>
    );
  }

  return (
    <View style={styles.fill}>
      <SnackbarProvider>{content}</SnackbarProvider>
    </View>
  );
}

const HEADING_HEIGHT = 56;

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: colors.surface },
  restore: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 16,
    paddingHorizontal: space.gutter,
    backgroundColor: colors.surface,
  },
  mark: { width: 56, height: 56 },
  page: { flex: 1, backgroundColor: colors.surface },
  heading: { alignItems: "center", paddingHorizontal: space.gutter, backgroundColor: colors.surface },
  notice: { padding: space.gutter, gap: 24, flexGrow: 1 },
});
