import * as React from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import { useAuth } from '../../auth/AuthContext';
import { Icon, type LucideIconName } from '../../components/ui/icon';
import { Skeleton } from '../../design/Feedback';
import { timeRange } from '../../design/format';
import { NameLine, StaffText, isolate } from '../../design/StaffText';
import { colors, gutterFor } from '../../design/tokens';
import type { ProfileSummary } from '../../history/types';
import { useLanguage } from '../../i18n/LanguageProvider';
import { useStaffProfileQuery, type Weekday } from '../../queries/profile';

type UsualShift = NonNullable<ProfileSummary['usualShift']> & { days?: readonly Weekday[] };

export interface ProfileWorkProps {
  summary?: Pick<ProfileSummary, 'location' | 'manager'> & { usualShift: UsualShift | null } | null;
  loading?: boolean;
}

function Row({ icon, label, children }: { icon: LucideIconName; label: string; children: React.ReactNode }) {
  const { isRTL } = useLanguage();
  return (
    <View style={[styles.row, { flexDirection: isRTL ? 'row-reverse' : 'row' }]}>
      <Icon name={icon} size={22} color={colors.muted} />
      <View style={styles.body}>
        <StaffText role="label" color="muted">{label}</StaffText>
        {children}
      </View>
    </View>
  );
}

function SkeletonRow() {
  const { isRTL } = useLanguage();
  return (
    <View style={[styles.row, { flexDirection: isRTL ? 'row-reverse' : 'row' }]} testID="work-skeleton">
      <Skeleton width={22} height={22} radius={6} />
      <View style={styles.body}>
        <Skeleton width={72} height={12} />
        <Skeleton width="60%" height={16} />
      </View>
    </View>
  );
}

/**
 * The summary gives the usual shift as "HH:mm" already in the location's zone, so the clock is
 * rebuilt as today's date at that wall time in UTC and formatted back in UTC: no zone shift.
 */
function usualShiftText(shift: { start: string; end: string }): string {
  const today = new Date().toISOString().slice(0, 10);
  const at = (hhmm: string) => new Date(`${today}T${hhmm.slice(0, 5)}:00.000Z`);
  return timeRange(at(shift.start), at(shift.end), 'UTC');
}

/** Profile "My work": where, when and with whom the person works. No call and no phone. */
export function ProfileWork({ summary, loading = false }: ProfileWorkProps) {
  const { user } = useAuth();
  const { language, t } = useLanguage();
  const { width } = useWindowDimensions();
  const gutter = gutterFor(width);
  const location = summary?.location ?? null;
  const shift = summary?.usualShift ?? null;
  const manager = summary?.manager ?? null;
  const summaryDays = shift?.days?.length ? shift.days : undefined;
  const profile = useStaffProfileQuery(user?.id, !loading && !summaryDays);
  const workDays = summaryDays ?? profile.data?.workDays;
  const workDaysText = workDays && workDays.length < 7
    ? workDays.map((day) => t(`${day[0]}${day.slice(1).toLowerCase()}`)).join(language === 'ur' ? '، ' : ', ')
    : t('Every day');

  return (
    <View style={[styles.block, { paddingHorizontal: gutter }]}>
      <StaffText role="groupTitle" accessibilityRole="header" style={styles.title}>My work</StaffText>
      {loading ? (
        <>
          <SkeletonRow />
          <SkeletonRow />
          <SkeletonRow />
        </>
      ) : (
        <>
          <Row icon="MapPin" label="Assigned location">
            {location ? (
              <>
                <NameLine role="rowTitle" name={location.name} />
                {location.address ? <NameLine role="meta" color="muted" name={location.address} /> : null}
              </>
            ) : (
              <StaffText role="rowTitle" color="muted">No location assigned</StaffText>
            )}
          </Row>
          <Row icon="Clock" label="Usual shift">
            {shift ? (
              <StaffText role="rowTitle" translate={false}>{isolate(usualShiftText(shift))}</StaffText>
            ) : (
              <StaffText role="rowTitle" color="muted">Not set</StaffText>
            )}
          </Row>
          <Row icon="Calendar" label="Work days">
            <StaffText role="rowTitle" translate={false}>{workDaysText}</StaffText>
          </Row>
          <Row icon="UserRound" label="Manager">
            {manager ? <NameLine role="rowTitle" name={manager.name} /> : <StaffText role="rowTitle" color="muted">No manager assigned</StaffText>}
          </Row>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  block: { backgroundColor: colors.surface, marginTop: 10, paddingVertical: 6 },
  title: { marginTop: 10, marginBottom: 2 },
  row: { alignItems: 'center', gap: 14, minHeight: 60, paddingVertical: 8 },
  body: { flex: 1, minWidth: 0 },
});
