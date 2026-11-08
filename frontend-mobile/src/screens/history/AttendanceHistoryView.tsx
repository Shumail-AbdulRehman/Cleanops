import * as React from 'react';
import { Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';
import { ActionButton } from '../../design/ActionButton';
import { BottomSheet } from '../../design/BottomSheet';
import { EmptyState, ErrorState, Skeleton } from '../../design/Feedback';
import { Pill, type PillToneName } from '../../design/Pill';
import { StaffText, isolate } from '../../design/StaffText';
import { clock, dayLabel, dayMonth, localDate, timeRange } from '../../design/format';
import { colors, gutterFor, space } from '../../design/tokens';
import type { AttendanceDayState, AttendanceMonthRecord, HistoryRange } from '../../history/types';
import { useLanguage } from '../../i18n/LanguageProvider';
import { useAttendanceMonth } from '../../queries/history';
import { AttendanceCalendar, STATE_WORDS } from './AttendanceCalendar';
import { MonthBar } from './MonthBar';

export interface AttendanceHistoryViewProps {
  staffId: number | undefined;
  /** `YYYY-MM`. */
  month: string;
  onMonthChange: (month: string) => void;
  /** Called with the server range when a response brings a new one. */
  onRange?: (range: HistoryRange) => void;
}

const PILL_TONES: Record<AttendanceDayState, PillToneName> = {
  ON_TIME: 'green',
  LATE: 'late',
  ABSENT: 'red',
  MISSED_CHECKOUT: 'warn',
  ON_SHIFT: 'blue',
  UPCOMING: 'neutral',
};

/** Isolates a time range so "in – out" always reads left to right, also in Urdu. */

/** Month calendar, legend and day list for attendance. The screen shell supplies the scrolling. */
export function AttendanceHistoryView({ staffId, month, onMonthChange, onRange }: AttendanceHistoryViewProps) {
  const { t, language, isRTL } = useLanguage();
  const { width } = useWindowDimensions();
  const gutter = gutterFor(width);
  const query = useAttendanceMonth(staffId, month);
  const [openId, setOpenId] = React.useState<number | null>(null);
  const rtlRow = isRTL ? 'row-reverse' : 'row';

  const data = query.data;
  const knownRange = React.useRef<HistoryRange | null>(null);
  if (data?.range) knownRange.current = data.range;

  // Report the server range when it changes (by value), so the screen can adopt its latest month.
  const onRangeRef = React.useRef(onRange);
  onRangeRef.current = onRange;
  const reported = data?.range;
  React.useEffect(() => {
    if (reported) onRangeRef.current?.(reported);
  }, [reported?.earliestMonth, reported?.latestMonth]);
  const monthBar = <MonthBar month={month} range={data?.range ?? knownRange.current} onChange={onMonthChange} />;

  if (query.isError && !data) {
    return (
      <View>
        {monthBar}
        <ErrorState onRetry={() => { void query.refetch(); }} />
      </View>
    );
  }

  if (!data) {
    return (
      <View>
        {monthBar}
        <View style={[styles.skeletonGrid, { marginHorizontal: gutter }]}><Skeleton height={Math.min(width, 420) * 0.8} radius={12} /></View>
        {[0, 1, 2].map(index => (
          <View key={index} style={[styles.skeletonRow, { paddingHorizontal: gutter, flexDirection: rtlRow }]}>
            <View style={styles.skeletonText}>
              <Skeleton width="40%" height={16} />
              <Skeleton width="25%" height={14} />
            </View>
            <Skeleton width={72} height={24} radius={12} />
          </View>
        ))}
      </View>
    );
  }

  const timeZone = data.timezone;
  const today = localDate(new Date(), timeZone);
  const records = [...data.records].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : b.id - a.id));
  const selected = openId === null ? null : records.find(record => record.id === openId) ?? null;
  const { counts } = data;
  const legend = [
    { key: 'onTime', label: 'On time', count: counts.onTime, fill: colors.blueWash },
    { key: 'late', label: 'Late', count: counts.late, fill: colors.late },
    { key: 'absent', label: 'Absent', count: counts.absent, fill: colors.badWash },
    { key: 'missed', label: 'Missed check-out', count: counts.missedCheckout, fill: colors.warnWash },
  ];

  const times = (record: AttendanceMonthRecord): string => {
    if (!record.checkInTime) return '';
    const start = clock(record.checkInTime, timeZone);
    return record.checkOutTime ? `${start} – ${clock(record.checkOutTime, timeZone)}` : start;
  };

  return (
    <View>
      {monthBar}
      <AttendanceCalendar month={month} records={data.records} todayYmd={today} width={width} />
      <View style={[styles.legend, { paddingHorizontal: gutter, flexDirection: rtlRow }]}>
        {legend.map(part => (
          <View key={part.key} style={[styles.legendItem, { flexDirection: rtlRow }]} accessible accessibilityLabel={`${t(part.label)} ${part.count}`}>
            <View style={[styles.square, { backgroundColor: part.fill }]} />
            <StaffText role="meta" color="muted">{part.label}</StaffText>
            <StaffText role="label" translate={false}>{String(part.count)}</StaffText>
          </View>
        ))}
      </View>

      {records.length === 0 ? (
        <EmptyState icon="RotateCcwClock" title="Nothing here yet" body="No shifts this month." />
      ) : (
        <View style={styles.list}>
          {records.map((record, index) => {
            const day = dayLabel(record.date, today, language, t);
            const date = dayMonth(record.date, language);
            const range = times(record);
            const word = t(STATE_WORDS[record.state]);
            return (
              <AttendanceRow
                key={record.id}
                label={`${day}, ${date}${range ? `, ${range}` : ''}, ${word}`}
                day={day}
                date={date}
                range={range}
                state={record.state}
                gutter={gutter}
                separator={index > 0}
                onPress={() => setOpenId(record.id)}
              />
            );
          })}
        </View>
      )}

      <BottomSheet
        visible={selected !== null}
        onDismiss={() => setOpenId(null)}
        title={selected ? (
          <StaffText role="sheetTitle" translate={false}>
            {`${dayLabel(selected.date, today, language, t)}, ${dayMonth(selected.date, language)}`}
          </StaffText>
        ) : ''}
        body={selected ? (
          <View style={styles.sheetPill}>
            {selected.lateMinutes != null
              ? <Pill tone="late" label={t('Late by {n} min', { n: selected.lateMinutes })} />
              : <Pill tone={PILL_TONES[selected.state]} label={STATE_WORDS[selected.state]} />}
          </View>
        ) : undefined}
        actions={<ActionButton kind="outline" label="Close" onPress={() => setOpenId(null)} />}
      >
        {selected ? (
          <View style={styles.facts}>
            <Fact
              label="In"
              value={selected.checkInTime ? clock(selected.checkInTime, timeZone) : '–'}
              literal
            />
            <Fact
              label="Out"
              value={selected.checkOutTime
                ? clock(selected.checkOutTime, timeZone)
                : selected.checkInTime && selected.state === 'ON_SHIFT' ? 'Still on shift' : '–'}
              literal={Boolean(selected.checkOutTime) || !selected.checkInTime || selected.state !== 'ON_SHIFT'}
              separator
            />
            <Fact label="Shift" value={timeRange(selected.expectedStart, selected.expectedEnd, timeZone)} literal separator />
            <Fact label="Location" value={selected.location.name} literal separator />
          </View>
        ) : null}
      </BottomSheet>
    </View>
  );
}

/**
 * One day in the list: day and date at the start, time and pill at the end.
 * The pressed wash lives in React state: on Android, NativeWind's interop drops a
 * `Pressable` style callback, which lost the row's direction and gutter (spec 67).
 */
function AttendanceRow({ label, day, date, range, state, gutter, separator, onPress }: {
  label: string; day: string; date: string; range: string; state: AttendanceDayState;
  gutter: number; separator: boolean; onPress: () => void;
}) {
  const { isRTL } = useLanguage();
  const [pressed, setPressed] = React.useState(false);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      onPressIn={() => setPressed(true)}
      onPressOut={() => setPressed(false)}
      style={[
        styles.row,
        { flexDirection: isRTL ? 'row-reverse' : 'row', marginHorizontal: gutter },
        separator ? styles.separator : null,
        pressed ? styles.pressed : null,
      ]}
    >
      <View style={styles.rowBody}>
        <StaffText role="label" translate={false}>{day}</StaffText>
        <StaffText role="meta" color="muted" translate={false}>{date}</StaffText>
      </View>
      {range ? <StaffText role="meta" color="muted" translate={false} align="end">{isolate(range)}</StaffText> : null}
      {/* The pill aligns itself to the top; this box lets the row centre it, as the design draws. */}
      <View testID="attendance-row-pill" style={styles.rowPill}>
        <Pill tone={PILL_TONES[state]} label={STATE_WORDS[state]} />
      </View>
    </Pressable>
  );
}

function Fact({ label, value, literal = false, separator = false }: { label: string; value: string; literal?: boolean; separator?: boolean }) {
  const { isRTL } = useLanguage();
  return (
    <View style={[styles.fact, { flexDirection: isRTL ? 'row-reverse' : 'row' }, separator ? styles.separator : null]}>
      <StaffText role="body" color="muted">{label}</StaffText>
      <View style={styles.factValue}>
        <StaffText role="label" align="end" translate={!literal}>{literal ? isolate(value) : value}</StaffText>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  skeletonGrid: { marginTop: 12, marginBottom: 8 },
  skeletonRow: { alignItems: 'center', justifyContent: 'space-between', gap: 14, minHeight: 68 },
  skeletonText: { flex: 1, gap: 8 },
  legend: { flexWrap: 'wrap', columnGap: 16, rowGap: 6, paddingTop: 6, paddingBottom: 10 },
  legendItem: { alignItems: 'center', gap: 6 },
  square: { width: 10, height: 10, borderRadius: 3, borderWidth: 1, borderColor: colors.lineStrong },
  list: { backgroundColor: colors.surface, paddingVertical: 6 },
  row: { height: 68, alignItems: 'center', gap: 12 },
  separator: { borderTopWidth: 1, borderTopColor: colors.line },
  rowBody: { flex: 1, minWidth: 0 },
  pressed: { backgroundColor: colors.soft },
  rowPill: { justifyContent: 'center' },
  sheetPill: { marginTop: 6 },
  facts: { marginTop: 8, backgroundColor: colors.surface },
  fact: { minHeight: space.touchMin + 4, alignItems: 'center', justifyContent: 'space-between', gap: 16 },
  factValue: { flexShrink: 1 },
});
