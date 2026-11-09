import * as React from 'react';
import { Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';
import { Icon } from '../../components/ui/icon';
import { Skeleton } from '../../design/Feedback';
import { StaffText } from '../../design/StaffText';
import { colors, gutterFor } from '../../design/tokens';
import type { ProfileMonthFigures } from '../../history/types';
import { useLanguage } from '../../i18n/LanguageProvider';

export interface ProfileMonthProps {
  /** The `month` part of `ProfileSummary`. */
  summary?: ProfileMonthFigures | null;
  loading?: boolean;
  error?: boolean;
  onRetry?: () => void;
  onSeeHistory: () => void;
}

interface MeterProps {
  label: string;
  value: number;
  total: number;
  valueKey: string;
  emptyKey: string;
}

function Meter({ label, value, total, valueKey, emptyKey }: MeterProps) {
  const { isRTL, t } = useLanguage();
  const hasTotal = total > 0;
  const fraction = hasTotal ? Math.max(0, Math.min(1, value / total)) : 0;
  return (
    <View style={styles.meter}>
      <View style={[styles.line, { flexDirection: isRTL ? 'row-reverse' : 'row' }]}>
        <View style={styles.label}>
          <StaffText role="body">{label}</StaffText>
        </View>
        <StaffText role="rowTitle" translate={false} align="end">
          {hasTotal ? t(valueKey, { n: value, t: total }) : t(emptyKey)}
        </StaffText>
      </View>
      {hasTotal ? (
        <View testID="meter-track" style={[styles.track, { flexDirection: isRTL ? 'row-reverse' : 'row' }]}>
          <View testID="meter-fill" style={[styles.fill, { width: `${Math.round(fraction * 100)}%` }]} />
        </View>
      ) : null}
    </View>
  );
}

/** Profile "This month": attended, on-time and submitted figures with named totals. */
export function ProfileMonth({ summary, loading = false, error = false, onRetry, onSeeHistory }: ProfileMonthProps) {
  const { isRTL, t } = useLanguage();
  const { width } = useWindowDimensions();
  const gutter = gutterFor(width);
  const dir = { flexDirection: isRTL ? 'row-reverse' : 'row' } as const;
  // Pressed wash in state: Android drops a `Pressable` style callback (spec 67).
  const [pressed, setPressed] = React.useState(false);

  let body: React.ReactNode;
  if (loading) {
    body = [0, 1, 2].map(i => (
      <View key={i} style={styles.meter} testID="month-skeleton">
        <Skeleton width="100%" height={16} />
        <View style={styles.gap} />
        <Skeleton width="100%" height={6} radius={3} />
      </View>
    ));
  } else if (error || !summary) {
    body = (
      <View style={[styles.meter, styles.errorRow, dir]}>
        <View style={styles.label}>
          <StaffText role="body" color="muted">Figures could not load.</StaffText>
        </View>
        {onRetry ? (
          <Pressable accessibilityRole="button" accessibilityLabel={t('Try again')} onPress={onRetry} style={styles.retry}>
            <StaffText role="action" color="blueDeep">Try again</StaffText>
          </Pressable>
        ) : null}
      </View>
    );
  } else {
    body = (
      <>
        <Meter label="Shifts attended" value={summary.shiftsAttended} total={summary.shiftsScheduled} valueKey="{n} of {t} scheduled" emptyKey="No shifts yet" />
        <Meter label="Arrived on time" value={summary.onTime} total={summary.shiftsAttended} valueKey="{n} of {t} attended" emptyKey="No shifts yet" />
        <Meter label="Tasks submitted" value={summary.tasksSubmitted} total={summary.tasksAssigned} valueKey="{n} of {t}" emptyKey="No tasks yet" />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('See my history')}
          onPress={onSeeHistory}
          onPressIn={() => setPressed(true)}
          onPressOut={() => setPressed(false)}
          style={[styles.more, dir, pressed ? styles.pressed : null]}
        >
          <StaffText role="action" color="blueDeep">See my history</StaffText>
          <Icon name={isRTL ? 'ArrowLeft' : 'ArrowRight'} size={18} color={colors.blueDeep} />
        </Pressable>
      </>
    );
  }

  return (
    <View style={[styles.block, { paddingHorizontal: gutter }]}>
      <StaffText role="groupTitle" accessibilityRole="header" style={styles.title}>This month</StaffText>
      {body}
    </View>
  );
}

const styles = StyleSheet.create({
  block: { backgroundColor: colors.surface, marginTop: 10, paddingVertical: 6 },
  title: { marginTop: 10, marginBottom: 2 },
  meter: { paddingVertical: 11 },
  line: { alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  label: { flexShrink: 1 },
  track: { height: 6, borderRadius: 3, backgroundColor: colors.line, marginTop: 7, overflow: 'hidden' },
  fill: { height: 6, borderRadius: 3, backgroundColor: colors.blue },
  gap: { height: 7 },
  errorRow: { alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  retry: { minHeight: 48, justifyContent: 'center', paddingHorizontal: 8 },
  more: { minHeight: 52, alignItems: 'center', justifyContent: 'center', gap: 6 },
  pressed: { backgroundColor: colors.soft },
});
