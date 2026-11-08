import * as React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Icon } from '../../components/ui/icon';
import { addMonths, compareMonths, monthTitle } from '../../design/format';
import { StaffText } from '../../design/StaffText';
import { colors, space } from '../../design/tokens';
import type { HistoryRange } from '../../history/types';
import { useLanguage } from '../../i18n/LanguageProvider';

export interface MonthBarProps {
  /** `YYYY-MM`. */
  month: string;
  /** Months the server has. Without it (still loading) both arrows are hidden. */
  range?: HistoryRange | null;
  onChange: (month: string) => void;
}

/** Previous arrow, "November 2026", next arrow. An arrow at the end of the range is hidden, not dead. Shared with the attendance list. */
export function MonthBar({ month, range, onChange }: MonthBarProps) {
  const { t, language, isRTL } = useLanguage();
  const hasPrevious = Boolean(range) && compareMonths(month, range!.earliestMonth) > 0;
  const hasNext = Boolean(range) && compareMonths(month, range!.latestMonth) < 0;

  const arrow = (direction: -1 | 1, visible: boolean) => {
    if (!visible) return <View style={styles.slot} />;
    const label = direction < 0 ? 'Previous month' : 'Next month';
    const pointsLeft = (direction < 0) !== isRTL;
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t(label)}
        onPress={() => onChange(addMonths(month, direction))}
        style={styles.slot}
      >
        <Icon name={pointsLeft ? 'ChevronLeft' : 'ChevronRight'} size={24} color={colors.ink} />
      </Pressable>
    );
  };

  return (
    <View style={[styles.row, { flexDirection: isRTL ? 'row-reverse' : 'row' }]}>
      {arrow(-1, hasPrevious)}
      <StaffText role="groupTitle" align="center" translate={false} accessibilityRole="header">
        {monthTitle(month, language)}
      </StaffText>
      {arrow(1, hasNext)}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12, paddingTop: 10 },
  slot: { width: space.touchMinIcon, height: space.touchMinIcon, alignItems: 'center', justifyContent: 'center' },
});
