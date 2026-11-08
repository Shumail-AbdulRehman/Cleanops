import * as React from 'react';
import { Pressable, ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
import { dayLabel, dayMonth, localDate } from '../../design/format';
import { EmptyState, ErrorState, Skeleton } from '../../design/Feedback';
import { ActionButton } from '../../design/ActionButton';
import { StaffText } from '../../design/StaffText';
import { TaskRow } from '../../design/TaskRow';
import { historyDisplay } from '../../design/taskState';
import { colors, gutterFor, radius, space } from '../../design/tokens';
import { HISTORY_FILTERS, type HistoryFilter, type HistoryRange, type TaskHistoryItem } from '../../history/types';
import { useLanguage } from '../../i18n/LanguageProvider';
import { flattenHistoryPages, useTaskHistory } from '../../queries/history';
import { MonthBar } from './MonthBar';

export interface TaskHistoryViewProps {
  staffId: number | undefined;
  /** `YYYY-MM`. */
  month: string;
  onMonthChange: (month: string) => void;
  onOpenTask: (item: TaskHistoryItem) => void;
  /** Called with the server range when a response brings a new one. */
  onRange?: (range: HistoryRange) => void;
}

const FILTER_LABELS: Record<HistoryFilter, string> = { all: 'All', verified: 'Verified', waiting: 'Waiting', missed: 'Missed' };

/** Month by month list of finished and missed tasks, with a status summary and filters. The screen shell supplies the scrolling. */
export function TaskHistoryView({ staffId, month, onMonthChange, onOpenTask, onRange }: TaskHistoryViewProps) {
  const { t, language, isRTL } = useLanguage();
  const gutter = gutterFor(useWindowWidth());
  const [filter, setFilter] = React.useState<HistoryFilter>('all');
  const query = useTaskHistory(staffId, month, filter);
  const rtlRow = isRTL ? 'row-reverse' : 'row';

  const first = query.data?.pages[0];
  const items = flattenHistoryPages(query.data);
  // Keep the last known range so the arrows do not vanish while the next month loads.
  const knownRange = React.useRef<HistoryRange | null>(null);
  if (first?.range) knownRange.current = first.range;

  // Report the server range when it changes (by value), so the screen can adopt its latest month.
  const onRangeRef = React.useRef(onRange);
  onRangeRef.current = onRange;
  const reported = first?.range;
  React.useEffect(() => {
    if (reported) onRangeRef.current?.(reported);
  }, [reported?.earliestMonth, reported?.latestMonth]);

  const monthBar = <MonthBar month={month} range={first?.range ?? knownRange.current} onChange={onMonthChange} />;

  if (query.isError && !items) {
    return (
      <View>
        {monthBar}
        <ErrorState onRetry={() => { void query.refetch(); }} />
      </View>
    );
  }

  if (!items || !first) {
    return (
      <View>
        {monthBar}
        <View style={[styles.skeletonBar, { marginHorizontal: gutter }]}><Skeleton height={10} radius={5} /></View>
        <View style={[styles.chips, { flexDirection: rtlRow, paddingHorizontal: gutter }]}>
          {HISTORY_FILTERS.map(key => <Skeleton key={key} width={84} height={space.chipHeight} radius={radius.chipRadius} />)}
        </View>
        {[0, 1, 2, 3, 4].map(index => (
          <View key={index} style={[styles.skeletonRow, { paddingHorizontal: gutter, flexDirection: rtlRow }]}>
            <Skeleton width={space.markerSize} height={space.markerSize} radius={space.markerSize / 2} />
            <View style={styles.skeletonText}>
              <Skeleton width="55%" height={16} />
              <Skeleton width="35%" height={14} />
            </View>
          </View>
        ))}
      </View>
    );
  }

  const { counts } = first;
  const parts = [
    { key: 'verified', count: counts.verified, color: colors.ok, label: 'Verified' },
    { key: 'waiting', count: counts.waiting, color: colors.blue, label: 'Waiting' },
    { key: 'missed', count: counts.missed, color: colors.bad, label: 'Missed' },
  ];

  const today = localDate(new Date(), first.timezone);
  const groups: { date: string; items: TaskHistoryItem[] }[] = [];
  for (const item of items) {
    const last = groups[groups.length - 1];
    if (last && last.date === item.date) last.items.push(item);
    else groups.push({ date: item.date, items: [item] });
  }

  return (
    <View>
      {monthBar}
      <View
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={[styles.stack, { marginHorizontal: gutter, flexDirection: rtlRow }]}
      >
        {parts.filter(part => part.count > 0).map(part => (
          <View key={part.key} style={{ flex: part.count, backgroundColor: part.color }} />
        ))}
        {counts.verified + counts.waiting + counts.missed === 0 ? <View style={[styles.fill, { backgroundColor: colors.line }]} /> : null}
      </View>
      <View style={[styles.legend, { paddingHorizontal: gutter, flexDirection: rtlRow }]}>
        {parts.map(part => (
          <View key={part.key} style={[styles.legendItem, { flexDirection: rtlRow }]} accessible accessibilityLabel={`${t(part.label)} ${part.count}`}>
            <View style={[styles.square, { backgroundColor: part.color }]} />
            <StaffText role="meta" color="muted">{part.label}</StaffText>
            <StaffText role="label" translate={false}>{String(part.count)}</StaffText>
          </View>
        ))}
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={[styles.chips, { flexDirection: rtlRow, paddingHorizontal: gutter }]}>
        {HISTORY_FILTERS.map(key => {
          const selected = key === filter;
          return (
            <Pressable
              key={key}
              accessibilityRole="button"
              accessibilityLabel={t(FILTER_LABELS[key])}
              accessibilityState={{ selected }}
              onPress={() => setFilter(key)}
              style={[styles.chip, selected ? styles.chipOn : styles.chipOff]}
            >
              <StaffText role="label" color={selected ? 'surface' : 'pillText'}>{FILTER_LABELS[key]}</StaffText>
            </Pressable>
          );
        })}
      </ScrollView>

      {groups.length === 0 ? (
        <EmptyState
          icon="RotateCcwClock"
          title="Nothing here yet"
          body={filter === 'all' ? 'No finished tasks this month.' : 'Try another filter.'}
        />
      ) : (
        <View style={styles.list}>
          {groups.map(group => (
            <View key={group.date}>
              <View style={[styles.dayHead, { flexDirection: rtlRow, paddingHorizontal: gutter }]}>
                <StaffText role="label" translate={false}>{dayLabel(group.date, today, language, t)}</StaffText>
                <StaffText role="meta" color="muted" translate={false}>{dayMonth(group.date, language)}</StaffText>
              </View>
              {group.items.map((item, index) => (
                <TaskRow
                  key={item.id}
                  name={item.areaName}
                  kind={historyDisplay(item.status)}
                  start={item.shiftStart}
                  end={item.shiftEnd}
                  timeZone={item.timezone}
                  separator={index > 0}
                  onPress={() => onOpenTask(item)}
                />
              ))}
            </View>
          ))}
          {query.hasNextPage ? (
            <ActionButton kind="ghost" label="Load earlier tasks" busy={query.isFetchingNextPage} onPress={() => { void query.fetchNextPage(); }} />
          ) : null}
        </View>
      )}
    </View>
  );
}

function useWindowWidth(): number {
  return useWindowDimensions().width;
}

const styles = StyleSheet.create({
  stack: { height: 10, borderRadius: 5, overflow: 'hidden', gap: 2, marginTop: 12, marginBottom: 8 },
  fill: { flex: 1 },
  skeletonBar: { marginTop: 12, marginBottom: 8 },
  legend: { flexWrap: 'wrap', columnGap: 16, rowGap: 6, paddingBottom: 10 },
  legendItem: { alignItems: 'center', gap: 6 },
  square: { width: 10, height: 10, borderRadius: 3 },
  chips: { gap: 8, paddingVertical: 10 },
  chip: { height: space.chipHeight, paddingHorizontal: 15, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  chipOn: { backgroundColor: colors.ink },
  chipOff: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.lineStrong },
  list: { backgroundColor: colors.surface, paddingBottom: 6 },
  dayHead: { justifyContent: 'space-between', paddingTop: 16, paddingBottom: 4 },
  skeletonRow: { alignItems: 'center', gap: 14, minHeight: space.rowMinHeight },
  skeletonText: { flex: 1, gap: 8 },
});
