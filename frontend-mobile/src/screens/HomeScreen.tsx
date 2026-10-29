import * as React from "react";
import { AccessibilityInfo, BackHandler, RefreshControl, ScrollView, StyleSheet, View } from "react-native";
import { useIsFocused, useNavigation, useRoute, type CompositeNavigationProp, type RouteProp } from "@react-navigation/native";
import type { BottomTabNavigationProp } from "@react-navigation/bottom-tabs";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAuth } from "../auth/AuthContext";
import { useLanguage } from "../i18n/LanguageProvider";
import type { LucideIconName } from "../components/ui/icon";
import { AttendanceCamera } from "../components/AttendanceCamera";
import { ActionButton, ActionDock, DockStatus } from "../design/ActionButton";
import { OfflineBanner, useOnline, useSnackbar } from "../design/Feedback";
import { isolate } from "../design/StaffText";
import { displayFor, taskDisplay } from "../design/taskState";
import { colors } from "../design/tokens";
import { stackRoutes, tabRoutes } from "../navigation/routeNames";
import { useProfileSummary } from "../queries/history";
import { useStaffProfileQuery } from "../queries/profile";
import { useMyAttendanceQuery, useTodaysTasksQuery } from "../queries/staff";
import type { RootStackParamList, StaffTabsParamList, TaskInstance } from "../types";
import { getRecommendedCheckoutAt, getRelevantAttendanceRecord, hasOpenCheckout } from "../utils/attendance";
import { AttendanceLocating } from "./day/AttendanceLocating";
import { AttendanceReceipt } from "./day/AttendanceReceipt";
import { AttendanceSheets, UnsubmittedWorkSheet } from "./day/AttendanceSheets";
import { DayHeader, skyColor } from "./day/DayHeader";
import { TodayWork } from "./day/TodayWork";
import { nowState, type NowAction, type NowActionKind } from "./day/nowState";
import { useAttendanceAction, type AttendanceActionMode } from "./day/useAttendanceAction";

type NavigationProp = CompositeNavigationProp<
  BottomTabNavigationProp<StaffTabsParamList, "Shift">,
  NativeStackNavigationProp<RootStackParamList>
>;

/** The dock button for each next step: English label key and Lucide icon. */
const ACTIONS: Record<NowActionKind, { label: string; icon: LucideIconName }> = {
  checkIn: { label: "Check in", icon: "Camera" },
  checkInLate: { label: "Check in late", icon: "Camera" },
  checkOut: { label: "Check out", icon: "LogOut" },
  completeCheckOut: { label: "Complete check-out", icon: "LogOut" },
  startCleaning: { label: "Start cleaning", icon: "QrCode" },
  takePhotos: { label: "Take task photos", icon: "Camera" },
  retakePhoto: { label: "Retake photo", icon: "Camera" },
  retry: { label: "Try again", icon: "RefreshCw" },
};

const ATTENDANCE_MODE: Partial<Record<NowActionKind, AttendanceActionMode>> = {
  checkIn: "check-in",
  checkInLate: "check-in",
  checkOut: "check-out",
  completeCheckOut: "check-out",
};

const CLOCK_MS = 30000;
const DOCK_GAP = 8;

const isOpen = (task: TaskInstance) => displayFor(taskDisplay(task)).open;

/** My day: one sentence, today's work and one button. The `Shift` tab. */
export function HomeScreen() {
  const { user } = useAuth();
  const { language, t } = useLanguage();
  const online = useOnline();
  const snackbar = useSnackbar();
  const navigation = useNavigation<NavigationProp>();
  const insets = useSafeAreaInsets();
  const focused = useIsFocused();

  const [now, setNow] = React.useState(() => new Date());
  React.useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), CLOCK_MS);
    return () => clearInterval(timer);
  }, []);

  const staffId = user?.id;
  const attendanceQuery = useMyAttendanceQuery(staffId, focused);
  const tasksQuery = useTodaysTasksQuery(staffId, focused);
  const records = attendanceQuery.data ?? [];
  const tasks: TaskInstance[] = tasksQuery.data ?? [];
  const action = useAttendanceAction({ staffId, records, now, online });
  const [leftWorkOpen, setLeftWorkOpen] = React.useState(false);
  /** The shift the running check-in or check-out is for, so the receipt shows that record. */
  const actionRecordId = React.useRef<number | null>(null);

  const hasLocation = Boolean(user?.locationId);
  const record = getRelevantAttendanceRecord(records, now);
  const needsProfile = !record && hasLocation;
  const profileQuery = useStaffProfileQuery(staffId, focused && needsProfile);
  const { offToday, nextShiftStart } = profileQuery.data ?? {};
  const needsShiftZone = needsProfile && offToday === true && Boolean(nextShiftStart);
  const summaryQuery = useProfileSummary(staffId, focused && needsShiftZone);
  const loading =
    online &&
    ((attendanceQuery.isPending && !attendanceQuery.data) || (tasksQuery.isPending && !tasksQuery.data) ||
      (needsShiftZone && summaryQuery.isPending && summaryQuery.fetchStatus === "fetching"));
  const failed =
    (attendanceQuery.isError && !attendanceQuery.data) || (tasksQuery.isError && !tasksQuery.data);
  // The task feed does not carry the photo authority (it lives in each task's manifest),
  // so My day never hides photo actions; the photo screen still enforces it.
  const state = nowState({
    hasLocation,
    record,
    tasks,
    now,
    online,
    failed,
    photosAvailable: true,
    offToday,
    nextShiftStart,
    timeZone: needsShiftZone ? summaryQuery.data?.location?.timezone ?? "Asia/Karachi" : undefined,
    language,
  });
  const place = record?.location?.name?.trim() || null;
  const firstName = user?.name?.trim().split(/\s+/)[0] ?? "";

  // Check-out time has come while work is still open: the task stays the main
  // action and check-out is offered under it, behind the unsubmitted-work sheet.
  const openCount = tasks.filter(isOpen).length;
  const checkOutDue =
    !!record &&
    record.status !== "MISSED_CHECKOUT" &&
    hasOpenCheckout(record) &&
    now.getTime() >= getRecommendedCheckoutAt(record).getTime();
  const offerCheckOut = !failed && checkOutDue && openCount > 0;

  const refetchAll = () => Promise.all([attendanceQuery.refetch(), tasksQuery.refetch()]);
  const onRefresh = async () => {
    const [[attendance, work]] = await Promise.all([refetchAll(), needsProfile ? profileQuery.refetch() : undefined]);
    if (attendance.error ?? work.error) snackbar.show("Today could not refresh. Try again.", undefined, "failure");
  };

  const startAttendance = (mode: AttendanceActionMode) => {
    actionRecordId.current = record?.id ?? null;
    void action.start(mode);
  };

  const run = ({ kind, taskId }: NowAction) => {
    const mode = ATTENDANCE_MODE[kind];
    if (mode) return startAttendance(mode);
    if (kind === "retry") return void refetchAll();
    if (taskId === undefined) return;
    if (kind === "startCleaning") navigation.navigate(stackRoutes.taskDetail, { taskId });
    else navigation.navigate(stackRoutes.verification, { taskId, requirePhotoQr: true });
  };

  const finish = () => {
    action.cancel();
    void refetchAll();
  };

  // The sentence is the screen's live region: announce it when it changes.
  const sentence = `${t(state.title.key, state.title.values)} ${t(state.sub.key, state.sub.values)}`;
  const sentenceKey = loading ? "" : `${state.title.key}|${state.title.name ?? ""}`;
  const lastSentence = React.useRef<string | null>(null);
  React.useEffect(() => {
    if (!sentenceKey) return;
    const previous = lastSentence.current;
    lastSentence.current = sentenceKey;
    if (previous !== null && previous !== sentenceKey) AccessibilityInfo.announceForAccessibility(sentence);
  }, [sentenceKey, sentence]);

  // Android back while locating cancels; the camera handles its own back.
  const locating = action.phase === "locating";
  const cancelRef = React.useRef(action.cancel);
  cancelRef.current = action.cancel;
  React.useEffect(() => {
    if (!locating) return undefined;
    const listener = BackHandler.addEventListener("hardwareBackPress", () => {
      cancelRef.current();
      return true;
    });
    return () => listener.remove();
  }, [locating]);

  // Locating, the selfie camera and the receipt are full screen: the tab bar hides through the
  // `fullScreen` param that `StaffTabs` reads (spec 67; the design's locate, selfie and checked views have no tabs).
  const route = useRoute<RouteProp<StaffTabsParamList, "Shift">>();
  const fullScreen =
    locating ||
    ((action.phase === "selfie" || action.phase === "saving") && !!action.mode) ||
    (action.phase === "done" && !!action.result);
  const fullScreenShown = Boolean(route?.params?.fullScreen);
  React.useEffect(() => {
    if (fullScreenShown !== fullScreen) navigation.setParams?.({ fullScreen });
  }, [fullScreen, fullScreenShown, navigation]);

  if (locating) return <AttendanceLocating place={place} onBack={action.cancel} />;

  if ((action.phase === "selfie" || action.phase === "saving") && action.mode) {
    return <AttendanceCamera mode={action.mode} onCapture={action.submitSelfie} onCancel={action.cancel} />;
  }

  if (action.phase === "done" && action.result) {
    const receiptRecord = records.find((row) => row.id === actionRecordId.current) ?? record;
    return (
      <View style={[styles.receipt, { paddingTop: insets.top }]}>
        <AttendanceReceipt
          result={action.result}
          record={receiptRecord}
          tasksSubmitted={tasksQuery.counts?.submitted ?? tasks.filter((task) => task.status === "COMPLETED").length}
          tasksTotal={tasksQuery.counts?.total ?? tasks.length}
          place={place}
          onDone={finish}
        />
      </View>
    );
  }

  const main = state.action;
  const busy = action.phase === "checkingServer";
  let dock: React.ReactNode = null;
  if (!loading && (main || state.wait || offerCheckOut)) {
    if (!online) {
      dock = <DockStatus label="Internet needed to continue" icon="WifiOff" />;
    } else if (state.wait) {
      const values = Object.fromEntries(Object.entries(state.wait.values).map(([key, value]) => [key, isolate(value)]));
      dock = <DockStatus label={t(state.wait.key, values)} icon="Clock" />;
    } else {
      dock = (
        <>
          {main ? (
            <ActionButton
              kind="next"
              label={ACTIONS[main.kind].label}
              icon={ACTIONS[main.kind].icon}
              busy={busy && !!ATTENDANCE_MODE[main.kind]}
              onPress={() => run(main)}
            />
          ) : null}
          {offerCheckOut ? (
            <View style={main ? styles.second : null}>
              <ActionButton
                kind="outline"
                label="Check out"
                icon="LogOut"
                busy={busy}
                onPress={() => setLeftWorkOpen(true)}
              />
            </View>
          ) : null}
        </>
      );
    }
  }

  return (
    <View style={styles.page}>
      {/* Fixed status-bar band in the sky colour (night when offline), so scrolled content never sits under the clock (spec 67). */}
      <View
        testID="status-band"
        style={{ height: insets.top, backgroundColor: online ? colors[skyColor(state, loading)] : colors.night2 }}
      />
      <OfflineBanner />
      <ScrollView
        style={styles.page}
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl
            refreshing={attendanceQuery.isRefetching || tasksQuery.isRefetching || (needsProfile && profileQuery.isRefetching)}
            onRefresh={() => void onRefresh()}
          />
        }
      >
        <DayHeader
          state={state}
          firstName={firstName}
          today={now}
          onAvatarPress={() => navigation.navigate(tabRoutes.profile)}
          loading={loading}
        />
        <TodayWork
          tasks={tasks}
          counts={tasksQuery.counts}
          compact={state.rail !== null}
          onOpenTask={(task) => navigation.navigate(stackRoutes.taskDetail, { taskId: task.id })}
          onSeeAll={() => navigation.navigate(tabRoutes.tasks)}
          loading={loading}
        />
      </ScrollView>
      {dock ? <ActionDock>{dock}</ActionDock> : null}
      <AttendanceSheets {...action} place={place} />
      {leftWorkOpen && offerCheckOut ? (
        <UnsubmittedWorkSheet
          count={openCount}
          onBack={() => setLeftWorkOpen(false)}
          onCheckOutAnyway={() => {
            setLeftWorkOpen(false);
            startAttendance("check-out");
          }}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.surface },
  content: { flexGrow: 1, backgroundColor: colors.surface },
  receipt: { flex: 1, backgroundColor: colors.canvas },
  second: { marginTop: DOCK_GAP },
});
