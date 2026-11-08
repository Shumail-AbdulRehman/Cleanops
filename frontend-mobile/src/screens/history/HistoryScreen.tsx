import * as React from 'react';
import { RefreshControl, ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useQueryClient } from '@tanstack/react-query';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../../auth/AuthContext';
import { OfflineBanner } from '../../design/Feedback';
import { SegmentedControl, type SegmentOption } from '../../design/SegmentedControl';
import { StaffText } from '../../design/StaffText';
import { localDate } from '../../design/format';
import { colors, gutterFor } from '../../design/tokens';
import type { HistoryRange, TaskHistoryItem } from '../../history/types';
import { stackRoutes } from '../../navigation/routeNames';
import { AttendanceHistoryView } from './AttendanceHistoryView';
import { TaskHistoryView } from './TaskHistoryView';

type Segment = 'tasks' | 'attendance';

const SEGMENTS: ReadonlyArray<SegmentOption<Segment>> = [
  { value: 'tasks', label: 'Tasks' },
  { value: 'attendance', label: 'Attendance' },
];

/** History tab: Tasks and Attendance behind one switch, sharing one chosen month. Supplies the vertical scroll both views rely on. */
export function HistoryScreen() {
  const navigation = useNavigation<any>();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const insets = useSafeAreaInsets();
  const gutter = gutterFor(useWindowDimensions().width);
  const staffId = user?.id;
  const [segment, setSegment] = React.useState<Segment>('tasks');
  const [month, setMonth] = React.useState(() => localDate(new Date()).slice(0, 7));
  const monthPicked = React.useRef(false);
  const rangeSeen = React.useRef(false);
  const [refreshing, setRefreshing] = React.useState(false);
  const scroll = React.useRef<any>(null);

  // Tapping the History tab again while on it scrolls back to the top.
  React.useEffect(() => {
    const unsubscribe = navigation.addListener?.('tabPress', () => {
      if (navigation.isFocused?.() ?? true) scroll.current?.scrollTo?.({ y: 0, animated: true });
    });
    return typeof unsubscribe === 'function' ? unsubscribe : undefined;
  }, [navigation]);

  const onRefresh = React.useCallback(async () => {
    setRefreshing(true);
    try {
      await queryClient.refetchQueries({ queryKey: ['staff', staffId, 'history', segment] });
    } catch {
      // The views show their own error state.
    } finally {
      setRefreshing(false);
    }
  }, [queryClient, staffId, segment]);

  const changeMonth = React.useCallback((next: string) => {
    monthPicked.current = true;
    setMonth(next);
  }, []);

  // The server's month uses the location timezone: on the first range, adopt its latest month unless the user already moved.
  const adoptRange = React.useCallback((range: HistoryRange) => {
    if (rangeSeen.current) return;
    rangeSeen.current = true;
    if (!monthPicked.current) setMonth(range.latestMonth);
  }, []);

  const openTask = React.useCallback(
    (item: TaskHistoryItem) => navigation.navigate(stackRoutes.historyTask, { taskId: item.id, month }),
    [navigation, month],
  );

  return (
    <View style={styles.screen}>
      {/* Fixed status-bar band, so the scrolled title never sits under the clock (spec 67). */}
      <View testID="status-band" style={{ height: insets.top }} />
      <OfflineBanner />
      <ScrollView
        ref={scroll}
        contentContainerStyle={{ paddingTop: 12, paddingBottom: insets.bottom + 24 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        <View style={{ paddingHorizontal: gutter }}>
          <StaffText role="pageTitle" accessibilityRole="header">History</StaffText>
        </View>
        <View style={[styles.switch, { paddingHorizontal: gutter }]}>
          <SegmentedControl options={SEGMENTS} value={segment} onChange={setSegment} accessibilityLabel="History" />
        </View>
        {segment === 'tasks' ? (
          <TaskHistoryView staffId={staffId} month={month} onMonthChange={changeMonth} onOpenTask={openTask} onRange={adoptRange} />
        ) : (
          <AttendanceHistoryView staffId={staffId} month={month} onMonthChange={changeMonth} onRange={adoptRange} />
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.canvas },
  switch: { marginTop: 12 },
});
