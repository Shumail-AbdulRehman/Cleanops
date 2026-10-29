import * as React from "react";
import { RefreshControl, ScrollView, StyleSheet, View } from "react-native";
import { useNavigation, useIsFocused } from "@react-navigation/native";
import type { CompositeNavigationProp } from "@react-navigation/native";
import type { BottomTabNavigationProp } from "@react-navigation/bottom-tabs";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAuth } from "../auth/AuthContext";
import { useLanguage } from "../i18n/LanguageProvider";
import { Icon } from "../components/ui/icon";
import { ActionButton, ActionDock } from "../design/ActionButton";
import {
  EmptyState,
  ErrorState,
  OfflineBanner,
  Skeleton,
  useOnline,
  useSnackbar,
} from "../design/Feedback";
import { StaffText } from "../design/StaffText";
import { TaskRow } from "../design/TaskRow";
import { displayFor, groupTodayTasks, position, taskDisplay } from "../design/taskState";
import { colors, gutterFor, radius, space } from "../design/tokens";
import { stackRoutes, tabRoutes } from "../navigation/routeNames";
import { useMyAttendanceQuery, useTodaysTasksQuery } from "../queries/staff";
import {
  getCheckInOpenAt,
  getRecommendedCheckoutAt,
  getRelevantAttendanceRecord,
  hasOpenCheckout,
} from "../utils/attendance";
import { useWindowDimensions } from "react-native";
import type { RootStackParamList, StaffTabsParamList, TaskInstance } from "../types";

type TasksScreenNavigationProp = CompositeNavigationProp<
  BottomTabNavigationProp<StaffTabsParamList, "Tasks">,
  NativeStackNavigationProp<RootStackParamList>
>;

const SKELETON_ROWS = 5;

export function TasksScreen() {
  const { user } = useAuth();
  const { t, isRTL } = useLanguage();
  const online = useOnline();
  const snackbar = useSnackbar();
  const { width } = useWindowDimensions();
  const gutter = gutterFor(width);
  const focused = useIsFocused();
  const navigation = useNavigation<TasksScreenNavigationProp>();
  const insets = useSafeAreaInsets();
  const attendanceQuery = useMyAttendanceQuery(user?.id, focused);
  const tasksQuery = useTodaysTasksQuery(user?.id, focused);

  const [, setTick] = React.useState(0);
  const now = new Date();
  const record = getRelevantAttendanceRecord(attendanceQuery.data ?? [], now);
  const checkedIn = !!record && hasOpenCheckout(record);
  const tasks: TaskInstance[] = tasksQuery.data ?? [];
  const groups = groupTodayTasks(tasks);
  const isInitialLoading = tasksQuery.isPending && !tasksQuery.data;
  const side = isRTL ? "row-reverse" : "row";

  // Re-render once when the check-out time arrives so the dock appears without any other change.
  const checkoutAt = checkedIn && record ? getRecommendedCheckoutAt(record).getTime() : null;
  React.useEffect(() => {
    if (checkoutAt === null) return undefined;
    const wait = checkoutAt - Date.now();
    if (wait <= 0 || wait > 2 ** 31 - 1) return undefined;
    const timer = setTimeout(() => setTick((n) => n + 1), wait + 50);
    return () => clearTimeout(timer);
  }, [checkoutAt]);

  const onRefresh = async () => {
    const result = await tasksQuery.refetch();
    if (result.error) snackbar.show("Tasks could not refresh. Try again.", undefined, "failure");
  };

  const openTask = (task: TaskInstance) => navigation.navigate(stackRoutes.taskDetail, { taskId: task.id });
  const goMyDay = () => navigation.navigate(tabRoutes.myDay);

  const submitted =
    tasksQuery.counts?.submitted ?? tasks.filter((task) => !displayFor(taskDisplay(task)).open).length;
  const total = tasksQuery.counts?.total ?? tasks.length;

  // Dock: one action that sends the person to My day, which runs the flow.
  let dockLabel: string | null = null;
  if (record?.status === "MISSED_CHECKOUT" && checkedIn) dockLabel = "Complete check-out";
  else if (checkedIn && record && now.getTime() >= getRecommendedCheckoutAt(record).getTime()) dockLabel = "Check out";
  else if (!checkedIn) {
    const notOpenYet = !!record && record.status === "ABSENT" && now.getTime() < getCheckInOpenAt(record).getTime();
    dockLabel = notOpenYet ? null : "Check in";
  }

  const header = (
    <View style={[styles.header, { paddingHorizontal: gutter }]}>
      <StaffText role="pageTitle">Today's work</StaffText>
      {isInitialLoading ? (
        <Skeleton width="40%" height={14} />
      ) : (
        <StaffText role="meta" color="muted" translate={false}>
          {t("{n} of {t} submitted", { n: submitted, t: total })}
        </StaffText>
      )}
    </View>
  );

  const groupBlock = (title: string, list: TaskInstance[]) =>
    list.length ? (
      <View key={title}>
        <View style={[styles.groupHead, { paddingHorizontal: gutter }]}>
          <StaffText role="label" accessibilityRole="header">{title}</StaffText>
        </View>
        {list.map((task, index) => (
          <TaskRow
            key={task.id}
            name={task.areaNameSnapshot ?? task.title}
            kind={taskDisplay(task)}
            position={position(task, tasks)}
            start={task.shiftStart}
            end={task.shiftEnd}
            timeZone={task.location?.timezone ?? task.template?.location?.timezone}
            separator={index > 0}
            onPress={() => openTask(task)}
          />
        ))}
      </View>
    ) : null;

  let body: React.ReactNode;
  if (isInitialLoading && online) {
    body = Array.from({ length: SKELETON_ROWS }, (_, i) => (
      <View key={i} style={[styles.skeletonRow, { paddingHorizontal: gutter, flexDirection: side }]}>
        <Skeleton width={space.markerSize} height={space.markerSize} radius={space.markerSize / 2} />
        <View style={styles.skeletonText}>
          <Skeleton width="62%" height={15} />
          <Skeleton width="40%" height={12} />
        </View>
      </View>
    ));
  } else if (tasks.length) {
    body = (
      <>
        {groupBlock("Needs you", groups.needsYou)}
        {groupBlock("To do", groups.toDo)}
        {groupBlock("Done today", groups.done)}
      </>
    );
  } else if (tasksQuery.isError) {
    body = <ErrorState onRetry={() => void tasksQuery.refetch()} />;
  } else if (!tasksQuery.data && !online) {
    body = (
      <View style={{ padding: gutter }}>
        <StaffText role="body" color="muted">Today has not loaded yet. Reconnect and refresh.</StaffText>
      </View>
    );
  } else {
    body = (
      <EmptyState
        icon="List"
        title="No tasks today"
        body="Your manager has not given you work for today."
      />
    );
  }

  return (
    <View style={styles.page}>
      <View style={{ paddingTop: insets.top }} />
      <OfflineBanner />
      <ScrollView
        style={styles.page}
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={tasksQuery.isRefetching} onRefresh={onRefresh} />}
      >
        {header}
        {!checkedIn && !isInitialLoading ? (
          <View style={[styles.note, { marginHorizontal: gutter, flexDirection: side }]}>
            <Icon name="Camera" size={22} color={colors.ink} />
            <View style={styles.noteText}>
              <StaffText role="label">Check in before starting a task.</StaffText>
            </View>
          </View>
        ) : null}
        {body}
        {tasksQuery.hasNextPage && online ? (
          <ActionButton
            kind="ghost"
            label={tasksQuery.isFetchingNextPage ? "Loading tasks…" : "Load more tasks"}
            busy={tasksQuery.isFetchingNextPage}
            onPress={() => void tasksQuery.fetchNextPage()}
          />
        ) : null}
      </ScrollView>
      {dockLabel && !isInitialLoading ? (
        <ActionDock>
          <ActionButton kind="next" label={dockLabel} onPress={goMyDay} />
        </ActionDock>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.surface },
  content: { paddingBottom: 16 },
  header: { paddingTop: 16, paddingBottom: 8, gap: 4 },
  groupHead: { paddingTop: 16, paddingBottom: 4 },
  note: {
    alignItems: "center",
    gap: 12,
    backgroundColor: colors.yellowWash,
    borderRadius: radius.cardRadius,
    padding: 14,
    marginTop: 8,
  },
  noteText: { flex: 1 },
  skeletonRow: {
    minHeight: space.rowMinHeight,
    paddingVertical: space.rowPadV,
    gap: space.rowGap,
    alignItems: "center",
  },
  skeletonText: { flex: 1, gap: 9 },
});
