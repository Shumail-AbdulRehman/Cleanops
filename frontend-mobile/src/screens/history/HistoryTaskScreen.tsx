import * as React from 'react';
import { ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../../auth/AuthContext';
import { Icon, type LucideIconName } from '../../components/ui/icon';
import { ActionButton } from '../../design/ActionButton';
import { EmptyState, ErrorState, OfflineBanner, Skeleton } from '../../design/Feedback';
import { Pill } from '../../design/Pill';
import { StaffText, isolate } from '../../design/StaffText';
import { TopBar } from '../../design/TopBar';
import { clock, dayLabel, dayMonth, localDate, timeRange } from '../../design/format';
import { displayFor, historyDisplay } from '../../design/taskState';
import { colors, gutterFor, radius } from '../../design/tokens';
import type { TaskHistoryItem } from '../../history/types';
import { useLanguage } from '../../i18n/LanguageProvider';
import { flattenHistoryPages, historyKeys, useTaskHistory } from '../../queries/history';

const MARKER = 28;

type Params = { taskId: number; month: string };

function Step({ done, icon, label, value, last }: { done: boolean; icon: LucideIconName; label: string; value: string; last: boolean }) {
  const { isRTL } = useLanguage();
  return (
    <View style={[styles.step, { flexDirection: isRTL ? 'row-reverse' : 'row' }]}>
      <View style={styles.rail}>
        <View
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={[styles.marker, { backgroundColor: done ? colors.blue : colors.canvas }]}
        >
          <Icon name={done ? icon : 'Minus'} size={15} color={done ? colors.surface : colors.muted} />
        </View>
        {last ? null : <View style={styles.line} />}
      </View>
      <View style={[styles.stepBody, { flexDirection: isRTL ? 'row-reverse' : 'row' }]}>
        <View style={styles.flex}><StaffText role="rowTitle">{label}</StaffText></View>
        <StaffText role="meta" color="muted" translate={false}>{isolate(value)}</StaffText>
      </View>
    </View>
  );
}

function Fact({ label, children, first }: { label: string; children: React.ReactNode; first: boolean }) {
  const { isRTL } = useLanguage();
  return (
    <View style={[styles.fact, { flexDirection: isRTL ? 'row-reverse' : 'row' }, first ? null : styles.factRule]}>
      <View style={styles.flex}><StaffText role="body" color="muted">{label}</StaffText></View>
      {children}
    </View>
  );
}

/** What happened to one finished task: four steps and three separate states. */
export function HistoryTaskScreen() {
  const { user } = useAuth();
  const { t, language, isRTL } = useLanguage();
  const navigation = useNavigation();
  const { taskId, month } = useRoute().params as Params;
  const queryClient = useQueryClient();
  const gutter = gutterFor(useWindowDimensions().width);
  const goBack = () => navigation.goBack();

  // Look in every cached filter of this month first.
  const cached = React.useMemo(() => {
    const entries = queryClient.getQueriesData({ queryKey: historyKeys.tasks(user?.id, month, undefined).slice(0, 5) }) as [unknown, Parameters<typeof flattenHistoryPages>[0]][];
    for (const [, data] of entries) {
      const found = flattenHistoryPages(data)?.find(item => item.id === taskId);
      if (found) return found;
    }
    return undefined;
  }, [queryClient, user?.id, month, taskId]);

  const query = useTaskHistory(user?.id, month, 'all', !cached);
  const item: TaskHistoryItem | undefined = cached ?? flattenHistoryPages(query.data)?.find(entry => entry.id === taskId);

  const shell = (body: React.ReactNode) => (
    <View style={styles.page}>
      <TopBar title="Task details" onBack={goBack} withSafeArea />
      <OfflineBanner />
      {body}
    </View>
  );

  if (!item) {
    if (query.isError) return shell(<ErrorState onRetry={() => { void query.refetch(); }} />);
    if (query.data) {
      return shell(
        <EmptyState icon="CloudOff" title="This task is not in your history." action={<ActionButton kind="outline" label="Back" onPress={goBack} />} />,
      );
    }
    return shell(
      <View style={{ padding: gutter, gap: 14 }}>
        <Skeleton height={32} width="60%" />
        <Skeleton height={20} width="40%" />
        <Skeleton height={28} />
        <Skeleton height={28} />
        <Skeleton height={28} />
      </View>,
    );
  }

  const kind = historyDisplay(item.status);
  const display = displayFor(kind);
  const missed = item.status === 'MISSED';
  const verified = item.status === 'VERIFIED' || item.status === 'ACCEPTED_WITH_EXCEPTIONS';
  const today = localDate(new Date(), item.timezone);
  const when = `${dayLabel(item.date, today, language, t)}, ${dayMonth(item.date, language)}`;
  const photos = `${item.photos.received} / ${item.photos.required}`;
  const reviewClosed = item.reviewState === 'CLOSED' || (verified && item.reviewState === 'NOT_NEEDED');

  return shell(
    <ScrollView contentContainerStyle={{ paddingBottom: 24 }}>
      <View style={{ paddingHorizontal: gutter, paddingTop: 4, gap: 4 }}>
        <StaffText role="headline" translate={false}>{item.areaName}</StaffText>
        <StaffText role="body" color="muted" translate={false}>{item.title}</StaffText>
        <View style={[styles.when, { flexDirection: isRTL ? 'row-reverse' : 'row' }]}>
          {display.pillLabel ? <Pill tone={display.pillTone} label={display.pillLabel} /> : null}
          <StaffText role="body" color="muted" translate={false}>{when}</StaffText>
        </View>
      </View>

      <View style={{ paddingHorizontal: gutter, paddingTop: 22, paddingBottom: 8 }}>
        <StaffText role="groupTitle" accessibilityRole="header">What happened</StaffText>
      </View>
      <View style={{ paddingHorizontal: gutter, paddingTop: 4 }}>
        <Step done icon="Clock" label="Scheduled" value={timeRange(item.shiftStart, item.shiftEnd, item.timezone)} last={false} />
        <Step done={!!item.startedAt} icon="QrCode" label="Started" value={item.startedAt ? clock(item.startedAt, item.timezone) : t('Not recorded')} last={false} />
        <Step done={!missed} icon="Camera" label="Photos received" value={photos} last={false} />
        <Step done={!!item.submittedAt} icon="Check" label="Submitted" value={item.submittedAt ? clock(item.submittedAt, item.timezone) : t('Not done')} last />
      </View>

      <View style={{ paddingHorizontal: gutter, paddingTop: 6, paddingBottom: 8 }}>
        <StaffText role="groupTitle" accessibilityRole="header">Status</StaffText>
      </View>
      <View style={[styles.table, { marginHorizontal: gutter }]}>
        <Fact label="Submitted" first>
          {missed ? <Pill tone="red" label="Not done" /> : <Pill tone="blue" label="Yes" />}
        </Fact>
        <Fact label="Verified" first={false}>
          {verified ? <Pill tone="green" label={display.pillLabel ?? 'Verified'} /> : <Pill tone="neutral" label="Not yet" />}
        </Fact>
        <Fact label="Review closed" first={false}>
          {reviewClosed ? <Pill tone="green" label="Yes" /> : <Pill tone="neutral" label={item.reviewState === 'NOT_NEEDED' ? 'Not needed' : 'Not yet'} />}
        </Fact>
      </View>
      <View style={{ paddingHorizontal: gutter, paddingTop: 14 }}>
        <StaffText role="meta" color="muted">Submitted means you finished. Verified means your manager or the check confirmed it.</StaffText>
      </View>
    </ScrollView>,
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.surface },
  flex: { flex: 1, minWidth: 0 },
  when: { alignItems: 'center', gap: 8, flexWrap: 'wrap', marginTop: 10 },
  step: { gap: 14 },
  rail: { width: MARKER, alignItems: 'center' },
  marker: { width: MARKER, height: MARKER, borderRadius: MARKER / 2, alignItems: 'center', justifyContent: 'center' },
  line: { position: 'absolute', top: 30, bottom: 2, width: 2, backgroundColor: colors.line },
  stepBody: { flex: 1, minWidth: 0, minHeight: MARKER + 18, paddingBottom: 18, alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  table: { backgroundColor: colors.soft, borderRadius: radius.cardRadius, paddingHorizontal: 16, paddingVertical: 2 },
  fact: { minHeight: 48, alignItems: 'center', gap: 16, paddingVertical: 12 },
  factRule: { borderTopWidth: 1, borderTopColor: colors.line },
});
