import * as React from 'react';
import { ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useQuery } from '@tanstack/react-query';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { client } from '../../api/client';
import { useAuth } from '../../auth/AuthContext';
import { useLanguage } from '../../i18n/LanguageProvider';
import { translateText } from '../../i18n/translations';
import { Icon, type LucideIconName } from '../../components/ui/icon';
import { ActionButton, ActionDock } from '../../design/ActionButton';
import { ErrorState, OfflineBanner, Skeleton, useOnline } from '../../design/Feedback';
import { Pill } from '../../design/Pill';
import { StaffText, isolate } from '../../design/StaffText';
import { StepPath } from '../../design/StepPath';
import { TopBar } from '../../design/TopBar';
import { timeRange } from '../../design/format';
import { displayFor, taskDisplay, type TaskDisplayKind } from '../../design/taskState';
import { colors, gutterFor, radius, space } from '../../design/tokens';
import { stackRoutes, tabRoutes } from '../../navigation/routeNames';
import { staffQueryKeys, useMyAttendanceQuery, useTodaysTasksQuery } from '../../queries/staff';
import { getRelevantAttendanceRecord, hasOpenCheckout } from '../../utils/attendance';
import { verificationManifest } from '../../verification/api';
import type { ApiEnvelope, RootStackParamList, TaskInstance } from '../../types';

type Nav = NativeStackNavigationProp<RootStackParamList>;

/** Same fixture icons as PhotoGuide and the photo list. */
const fixtureIcons: Readonly<Record<string, LucideIconName>> = {
  TOILET: 'Toilet',
  INDIAN_TOILET: 'Toilet',
  WESTERN_TOILET: 'Toilet',
  SINK: 'Bath',
  MIRROR: 'RectangleVertical',
  BIN: 'Trash2',
  FLOOR: 'Grid2X2',
};

/** Which of the four steps the person is on. */
export function stepFor(kind: TaskDisplayKind): { current: 1 | 2 | 3 | 4; allDone: boolean } {
  switch (kind) {
    case 'inProgress': return { current: 2, allDone: false };
    case 'photosNeeded':
    case 'retake':
    case 'overdue': return { current: 3, allDone: false };
    case 'submitted':
    case 'waitingForReview':
    case 'verified':
    case 'acceptedWithExceptions': return { current: 4, allDone: true };
    default: return { current: 1, allDone: false };
  }
}

function Note({ tone, title, body }: { tone: 'yellow' | 'red' | 'blue'; title?: string; body: string }) {
  const fill = tone === 'yellow' ? colors.yellowWash : tone === 'red' ? colors.badWash : colors.blueWash;
  const text = tone === 'yellow' ? 'yellowInk' : tone === 'red' ? 'bad' : 'ink';
  return (
    <View style={[styles.note, { backgroundColor: fill }]}>
      {title ? <StaffText role="rowTitle" color={text} translate={false}>{title}</StaffText> : null}
      <StaffText role="body" color={text} translate={false}>{body}</StaffText>
    </View>
  );
}

/** What a task is, where it is in four steps, the manager's note, what to clean, and the one next button. */
export function TaskDetailScreen() {
  const { user } = useAuth();
  const { t, isRTL, language } = useLanguage();
  const navigation = useNavigation<Nav>();
  const route = useRoute();
  const taskId = (route.params as { taskId: number }).taskId;
  const online = useOnline();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const gutter = gutterFor(width);
  const feed = useTodaysTasksQuery(user?.id);
  const fromFeed = feed.data?.find(task => task.id === taskId);
  // The feed may omit the template note, so the detail read also runs then.
  const needDetail = !fromFeed || fromFeed.template === undefined;
  const detail = useQuery({
    queryKey: ['staff', user?.id, 'task', taskId],
    queryFn: async ({ signal }) => (await client.get<ApiEnvelope<TaskInstance>>(`/task-instance/${taskId}`, { params: { view: 'mobile' }, signal })).data.data,
    enabled: !!user && needDetail,
    staleTime: 30000,
    retry: false,
  });
  const manifestQuery = useQuery({
    queryKey: [...staffQueryKeys.all, user?.id, 'task', taskId, 'manifest'],
    queryFn: () => verificationManifest(taskId),
    enabled: !!user,
    staleTime: 30000,
    retry: false,
  });
  const attendance = useMyAttendanceQuery(user?.id);

  const task: TaskInstance | undefined = fromFeed ? { ...detail.data, ...fromFeed, template: fromFeed.template ?? detail.data?.template } as TaskInstance : detail.data;
  const goBack = () => navigation.goBack();
  const bar = <TopBar title={t('Task {id}', { id: String(taskId) })} translateTitle={false} onBack={goBack} withSafeArea />;
  const shell = (body: React.ReactNode) => (
    <View style={styles.page}>
      {bar}
      <OfflineBanner />
      {body}
    </View>
  );

  if (!task) {
    if (detail.isError || (!detail.isPending && !detail.data)) {
      return shell(<ErrorState onRetry={() => void detail.refetch()} />);
    }
    return shell(
      <View style={{ padding: gutter, gap: 14 }}>
        <Skeleton height={32} width="60%" />
        <Skeleton height={20} width="40%" />
        <Skeleton height={34} />
        <Skeleton height={64} />
        <Skeleton height={64} />
      </View>,
    );
  }

  const kind = taskDisplay(task);
  const display = displayFor(kind);
  const step = stepFor(kind);
  const timeZone = task.location?.timezone ?? task.template?.location?.timezone;
  const area = task.areaNameSnapshot || task.title;
  const row = isRTL ? 'row-reverse' : 'row';
  const manifest = manifestQuery.data;
  const items = manifest?.items ?? [];
  const record = getRelevantAttendanceRecord(attendance.data ?? [], new Date());
  const checkedIn = !!record && hasOpenCheckout(record);
  const open = display.open;
  const notStarted = kind === 'notStarted';
  const photosUnavailable = manifest?.photoChecking?.available === false && open && !notStarted;
  const note = task.template?.description?.trim();

  let dock: React.ReactNode = null;
  if (notStarted) {
    dock = checkedIn
      ? <ActionButton kind="next" label="Start cleaning" icon="QrCode" onPress={() => navigation.navigate(stackRoutes.startTask, { taskId })} />
      : <ActionButton kind="next" label="Check in" icon="LogIn" onPress={() => navigation.popTo(stackRoutes.staffTabs, { screen: tabRoutes.myDay })} />;
  } else if (open && !photosUnavailable) {
    dock = <ActionButton kind="next" label="Take task photos" icon="Camera" onPress={() => navigation.navigate(stackRoutes.verification, { taskId, requirePhotoQr: true })} />;
  }

  return shell(
    <>
      <ScrollView contentContainerStyle={{ paddingBottom: 24 }}>
        <View style={{ paddingHorizontal: gutter, paddingTop: 8, gap: 4 }}>
          <StaffText role="headline" translate={false}>{isolate(area)}</StaffText>
          {task.title && task.title !== area ? <StaffText role="body" color="muted" translate={false}>{isolate(task.title)}</StaffText> : null}
          <View style={[styles.timeLine, { flexDirection: row }]}>
            <Icon name="Clock" size={18} color={colors.muted} />
            <StaffText role="meta" color="muted" translate={false}>{isolate(timeRange(task.shiftStart, task.shiftEnd, timeZone))}</StaffText>
            <Pill tone={display.pillTone} label={display.pillLabel ?? 'Not started'} />
          </View>
        </View>
        <View style={{ paddingHorizontal: gutter }}>
          <StepPath current={step.current} allDone={step.allDone} />
        </View>
        <View style={{ paddingHorizontal: gutter, paddingTop: 14, gap: 12 }}>
          {notStarted && !checkedIn ? <Note tone="yellow" body={t('Check in before starting a task.')} /> : null}
          {photosUnavailable ? <Note tone="red" title={t('Task photos are unavailable')} body={t('Results already received are kept. Ask your manager what to do next.')} /> : null}
          {note ? (
            <View style={{ gap: 6 }}>
              <StaffText role="groupTitle">Note from your manager</StaffText>
              <Note tone="blue" body={isolate(note)} />
            </View>
          ) : null}
        </View>
        {items.length > 0 ? (
          <View testID="what-to-clean" style={{ paddingTop: 22 }}>
            <View style={{ paddingHorizontal: gutter, paddingBottom: 8 }}>
              <StaffText role="groupTitle">What to clean</StaffText>
            </View>
            {items.map(item => {
              const count = item.requirements.filter(requirement => requirement.mandatory).length;
              return (
                <View key={item.id} style={[styles.fixture, { flexDirection: row, paddingHorizontal: gutter }]}>
                  <View accessible={false} style={styles.tile}>
                    <Icon name={fixtureIcons[item.typeSnapshot] ?? 'ScanLine'} size={22} color={colors.blueDeep} />
                  </View>
                  <View style={styles.flex}>
                    <StaffText role="rowTitle" translate={false}>{isolate(translateText(item.nameSnapshot, language))}</StaffText>
                    {count > 0 ? <StaffText role="meta" color="muted" translate={false}>{t(count === 1 ? '{n} photo' : '{n} photos', { n: String(count) })}</StaffText> : null}
                  </View>
                </View>
              );
            })}
          </View>
        ) : null}
      </ScrollView>
      {dock ? <ActionDock withSafeArea>{dock}</ActionDock> : <View style={{ height: insets.bottom }} />}
    </>,
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.surface },
  flex: { flex: 1, minWidth: 0 },
  timeLine: { alignItems: 'center', gap: 8, paddingTop: 6, flexWrap: 'wrap' },
  note: { borderRadius: radius.cardRadius, padding: 14, gap: 2 },
  fixture: { alignItems: 'center', gap: space.rowGap, minHeight: 64, paddingVertical: 11 },
  tile: { width: space.tileSize, height: space.tileSize, borderRadius: 12, backgroundColor: colors.blueWash, alignItems: 'center', justifyContent: 'center' },
});
