import * as React from 'react';
import { StyleSheet, View } from 'react-native';
import { StaffText } from '../../design/StaffText';
import { monthTitle } from '../../design/format';
import { colors, type ColorToken } from '../../design/tokens';
import type { AttendanceDayState, AttendanceMonthRecord } from '../../history/types';
import { useLanguage } from '../../i18n/LanguageProvider';

export interface AttendanceCalendarProps {
  /** `YYYY-MM`. */
  month: string;
  records: readonly AttendanceMonthRecord[];
  /** `YYYY-MM-DD` in the location timezone. */
  todayYmd: string;
  /** Window width; sizes the square cells. */
  width: number;
}

const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;
const GAP = 3;
const SIDE = 8;
/**
 * Minimum width of a weekday label. Measured in the web export (spec 58 Log):
 * "جمعرات" in urduBold is 51.16 wide at 14.5 and 45.86 at 13; "Wed" in
 * bodySemi 14 is 30.59. 58 is the widest plus spare, so no name is cut.
 */
export const DAY_NAME_MIN_WIDTH = 58;

export const STATE_WORDS: Record<AttendanceDayState, string> = {
  ON_TIME: 'On time',
  LATE: 'Late',
  ABSENT: 'Absent',
  MISSED_CHECKOUT: 'Missed check-out',
  ON_SHIFT: 'On shift',
  UPCOMING: 'Upcoming',
};

interface CellLook {
  fill: ColorToken | null;
  text: ColorToken;
  outline: ColorToken | null;
  regular: boolean;
}

/** Colours per `DESIGN-SYSTEM.md#components` (calendar). */
function lookFor(state: AttendanceDayState | null, isToday: boolean, isFuture: boolean): CellLook {
  switch (state) {
    case 'LATE': return { fill: 'late', text: 'ink', outline: null, regular: false };
    case 'ABSENT': return { fill: 'badWash', text: 'bad', outline: 'bad', regular: false };
    case 'MISSED_CHECKOUT': return { fill: 'warnWash', text: 'warn', outline: 'warn', regular: false };
    default: break;
  }
  if (isToday) return { fill: 'blue', text: 'surface', outline: null, regular: false };
  if (state === 'ON_TIME' || state === 'ON_SHIFT') return { fill: 'blueWash', text: 'blueDeep', outline: null, regular: false };
  if (isFuture || state === 'UPCOMING') return { fill: null, text: 'future', outline: null, regular: true };
  return { fill: null, text: 'offDay', outline: null, regular: true };
}

/** Monday-first month grid. Each day is coloured by its attendance state. */
export function AttendanceCalendar({ month, records, todayYmd, width }: AttendanceCalendarProps) {
  const { t, language, isRTL } = useLanguage();
  const [year, monthNumber] = month.split('-').map(Number);
  const lead = (new Date(Date.UTC(year, monthNumber - 1, 1)).getUTCDay() + 6) % 7;
  const dayCount = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  const byDate = new Map(records.map(record => [record.date.slice(0, 10), record]));
  const cell = Math.max(28, Math.floor((width - SIDE * 2 - GAP * 6) / 7));
  const nameWidth = Math.max(cell, DAY_NAME_MIN_WIDTH);
  const nameOverhang = (nameWidth - cell) / 2;
  const rtlRow = isRTL ? 'row-reverse' : 'row';
  const monthName = monthTitle(month, language).split(' ')[0];

  const slots: (number | null)[] = [...Array<null>(lead).fill(null), ...Array.from({ length: dayCount }, (_, index) => index + 1)];
  while (slots.length % 7 !== 0) slots.push(null);
  const weeks: (number | null)[][] = [];
  for (let index = 0; index < slots.length; index += 7) weeks.push(slots.slice(index, index + 7));

  return (
    <View style={styles.grid}>
      <View style={[styles.week, { flexDirection: rtlRow }]} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        {DAY_NAMES.map(name => (
          <View key={name} style={{ width: cell }}>
            {/* Label area wider than the column, centred on it by equal negative margins, so the row's width is unchanged. */}
            <View style={{ width: nameWidth, marginHorizontal: -nameOverhang }}>
              <StaffText role="calendarHead" color="muted" align="center" numberOfLines={1}>{name}</StaffText>
            </View>
          </View>
        ))}
      </View>
      {weeks.map((week, weekIndex) => (
        <View key={weekIndex} style={[styles.week, { flexDirection: rtlRow }]}>
          {week.map((day, index) => {
            if (day === null) return <View key={`e${index}`} style={{ width: cell, height: cell }} />;
            const ymd = `${month}-${String(day).padStart(2, '0')}`;
            const record = byDate.get(ymd);
            const state = record?.state ?? null;
            const look = lookFor(state, ymd === todayYmd, ymd > todayYmd);
            const stateWord = state ? t(STATE_WORDS[state]) : null;
            const label = `${day} ${monthName}${stateWord ? `, ${stateWord}` : ''}`;
            return (
              <View
                key={ymd}
                accessible
                accessibilityLabel={label}
                style={[
                  styles.day,
                  { width: cell, height: cell },
                  look.fill ? { backgroundColor: colors[look.fill] } : null,
                  look.outline ? { borderWidth: 1.5, borderColor: colors[look.outline] } : null,
                ]}
              >
                <StaffText role={look.regular ? 'body' : 'label'} color={look.text} align="center" translate={false}>{String(day)}</StaffText>
              </View>
            );
          })}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: { paddingHorizontal: SIDE, paddingTop: 6, paddingBottom: 8, gap: GAP },
  week: { gap: GAP },
  day: { borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
});
