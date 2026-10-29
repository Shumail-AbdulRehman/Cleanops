import { useEffect, useRef, useState } from 'react';
import { AppState, Linking, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useIsFocused } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { client } from '../api/client';
import { startCleaning } from '../api/startCleaning';
import { useAuth } from '../auth/AuthContext';
import { useLanguage } from '../i18n/LanguageProvider';
import { staffQueryKeys } from '../queries/staff';
import { CameraRoundButton, CaptureBusyCard, CaptureFrame } from '../components/PhotoCaptureControls';
import { Icon } from '../components/ui/icon';
import { ActionButton, ActionDock } from '../design/ActionButton';
import { BottomSheet } from '../design/BottomSheet';
import { ErrorState, Skeleton } from '../design/Feedback';
import { Pill } from '../design/Pill';
import { NameLine, StaffText, isolate } from '../design/StaffText';
import { TopBar } from '../design/TopBar';
import { clock, timeRange } from '../design/format';
import { displayFor, taskDisplay } from '../design/taskState';
import { colors, radius, space } from '../design/tokens';
import { verificationErrorMessage } from '../verification/errors';
import type { ApiEnvelope, RootStackParamList, TaskInstance } from '../types';

const scannerSettings = { barcodeTypes: ['qr' as const] };
type Props = NativeStackScreenProps<RootStackParamList, 'StartTask'>;

/** The server marks a QR from another task or area with this code (taskInstance.controller start). */
function isWrongTaskQr(failure: unknown): boolean {
  const errors = (failure as { response?: { data?: { errors?: unknown } } })?.response?.data?.errors;
  return Array.isArray(errors) && errors.some(entry => (entry as { code?: unknown })?.code === 'AREA_QR_MISMATCH');
}

/**
 * English: one sentence with the isolated area. Urdu: the label line, then the area on its own line.
 * The Urdu label keys are the design's wording without the name.
 */
function AreaSentence({ englishKey, urduLabelKey, area, color }: {
  englishKey: string; urduLabelKey: string; area: string; color: 'onCamera' | 'muted';
}) {
  const { language, t } = useLanguage();
  if (language === 'ur') {
    return <>
      <StaffText role="body" color={color}>{urduLabelKey}</StaffText>
      <NameLine role="body" color={color} name={area} />
    </>;
  }
  return <StaffText role="body" color={color} translate={false}>{t(englishKey, { area: isolate(area) })}</StaffText>;
}

/** Starting records a room-marker event only. Finish owns its own QR/GPS session. */
export function StartTaskScreen({ route, navigation }: Props) {
  const { user } = useAuth();
  const { t, isRTL } = useLanguage();
  const insets = useSafeAreaInsets();
  const taskId = route.params.taskId;
  const focused = useIsFocused();
  const cache = useQueryClient();
  const taskKey = ['staff', user?.id, 'task', taskId];
  const taskQuery = useQuery({
    queryKey: taskKey,
    queryFn: async ({ signal }) => (await client.get<ApiEnvelope<TaskInstance>>(`/task-instance/${taskId}`, { params: { view: 'mobile' }, signal })).data.data,
    enabled: !!user && focused,
    staleTime: 30000,
    refetchOnMount: true,
    retry: false,
  });
  const [confirmed, setConfirmed] = useState<TaskInstance | null>(null);
  const task = confirmed ?? taskQuery.data;
  const [permission, requestPermission] = useCameraPermissions();
  const askedPermission = useRef(false);
  const [foreground, setForeground] = useState(AppState.currentState === 'active');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [wrongTask, setWrongTask] = useState(false);
  const [torch, setTorch] = useState(false);
  const [cameraMounted, setCameraMounted] = useState(false);
  const [cameraKey, setCameraKey] = useState(0);
  const ready = useRef(false);
  const inFlight = useRef(false);
  const alive = useRef(true);
  const active = useRef(false);
  const canStart = task?.status === 'PENDING' && task.verificationVersion === 2;
  const scanning = Platform.OS !== 'web' && !!user && canStart && focused && foreground && permission?.granted && !busy && !error;
  active.current = !!scanning;

  // The screen draws its own top: the dark camera overlay or the white top bar.
  useEffect(() => { navigation.setOptions?.({ headerShown: false }); }, [navigation]);

  useEffect(() => {
    alive.current = true;
    const listener = AppState.addEventListener('change', state => {
      if (state !== 'active') { active.current = false; ready.current = false; }
      setForeground(state === 'active');
    });
    return () => { alive.current = false; active.current = false; listener.remove(); };
  }, []);

  useEffect(() => {
    if (Platform.OS === 'web' || !canStart || !focused || !permission || permission.granted || !permission.canAskAgain || askedPermission.current) return;
    askedPermission.current = true;
    void requestPermission().catch(() => { if (alive.current) setError('Camera permission could not be requested. Try again.'); });
  }, [canStart, focused, permission, requestPermission]);

  useEffect(() => {
    ready.current = false;
    setCameraMounted(false);
    if (!scanning) return;
    const timer = setTimeout(() => setCameraMounted(true), 350);
    return () => clearTimeout(timer);
  }, [scanning]);

  useEffect(() => {
    if (!cameraMounted || !scanning) return;
    const timer = setTimeout(() => { if (!ready.current) setError('Camera could not open. Restart the scanner.'); }, 4000);
    return () => clearTimeout(timer);
  }, [cameraMounted, cameraKey, scanning]);

  async function scan(areaQr: string) {
    if (!active.current || !ready.current || inFlight.current || !user) return;
    inFlight.current = true;
    active.current = false;
    setBusy(true);
    try {
      const started = await startCleaning(cache, staffQueryKeys.tasksToday(user.id), taskId, areaQr);
      const next = { ...task, ...started } as TaskInstance;
      cache.setQueryData(taskKey, next);
      if (alive.current) {
        setConfirmed(next);
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }
    } catch (failure) {
      if (alive.current) { setWrongTask(isWrongTaskQr(failure)); setError(verificationErrorMessage(failure)); }
    } finally {
      inFlight.current = false;
      if (alive.current) setBusy(false);
    }
  }

  function restart() { ready.current = false; setError(''); setWrongTask(false); setCameraKey(key => key + 1); }
  function askCamera() {
    if (permission?.canAskAgain) void requestPermission().catch(() => setError('Camera permission could not be requested. Try again.'));
    else void Linking.openSettings();
  }
  const goBack = () => navigation.goBack();
  const timeZone = task?.location?.timezone ?? task?.template?.location?.timezone;
  const started = task?.status === 'IN_PROGRESS';
  const area = task?.areaNameSnapshot || task?.title || '';
  const row = isRTL ? 'row-reverse' : 'row';

  if (task && started) {
    const sub = task.startedAt
      ? t('Started at {time}. Finish by {end}.', { time: isolate(clock(task.startedAt, timeZone)), end: isolate(clock(task.shiftEnd, timeZone)) })
      : t('Finish by {time}.', { time: isolate(clock(task.shiftEnd, timeZone)) });
    return <View style={[styles.white, { paddingTop: insets.top }]}>
      <TopBar title={area} translateTitle={false} onBack={goBack} />
      <ScrollView contentContainerStyle={styles.startedBody}>
        <View style={styles.moment}>
          <View style={styles.badge} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
            <Icon name="Droplets" size={48} color={colors.surface} />
          </View>
          <StaffText role="headline" align="center" accessibilityRole="header" accessibilityLiveRegion="polite">Cleaning started</StaffText>
          <StaffText role="body" color="muted" align="center" translate={false}>{sub}</StaffText>
        </View>
        <View style={[styles.note, { flexDirection: row }]}>
          <Icon name="QrCode" size={22} color={colors.blueDeep} />
          <View style={styles.flex}>
            <StaffText role="body" color="blueDeep">Clean everything on this list. Then scan the same QR to take photos.</StaffText>
          </View>
        </View>
      </ScrollView>
      <ActionDock withSafeArea>
        <ActionButton kind="next" label="Cleaning is finished" icon="QrCode"
          onPress={() => navigation.replace('Verification', { taskId, requirePhotoQr: true })} />
      </ActionDock>
    </View>;
  }

  if (task && canStart) {
    const web = Platform.OS === 'web';
    const granted = !!permission?.granted;
    const status = !web && granted && !error && !busy && !(scanning && cameraMounted)
      ? (foreground ? 'Opening camera…' : 'Scanner paused')
      : null;
    return <View style={styles.night}>
      <View style={styles.camera}>
        {scanning && cameraMounted ? <CameraView key={cameraKey} style={StyleSheet.absoluteFill} facing="back" enableTorch={torch}
          barcodeScannerSettings={scannerSettings} onCameraReady={() => { ready.current = true; }}
          onMountError={() => { ready.current = false; setError('Camera could not open. Restart the scanner.'); }}
          onBarcodeScanned={({ data }) => { void scan(data); }} /> : null}
        <View style={[styles.cameraTop, { paddingTop: insets.top + 6 }]}>
          <View style={[styles.topRow, { flexDirection: row }]}>
            <CameraRoundButton label={t('Back')} onPress={goBack}>
              <View style={isRTL ? styles.mirror : null}><Icon name="ArrowLeft" size={24} color={colors.surface} /></View>
            </CameraRoundButton>
            <View style={styles.flex} />
            {!web && granted ? <CameraRoundButton label={t(torch ? 'Torch off' : 'Torch on')} on={torch} onPress={() => setTorch(value => !value)}>
              <Icon name="Flashlight" size={22} color={torch ? colors.ink : colors.surface} />
            </CameraRoundButton> : null}
          </View>
          <StaffText role="cameraTitle" color="surface" accessibilityRole="header">Scan the task QR</StaffText>
          <AreaSentence englishKey="Find the code for {area}." urduLabelKey="Find the code for this task:" area={area} color="onCamera" />
        </View>
        <CaptureFrame />
        {busy ? <CaptureBusyCard label="Confirming…" /> : null}
      </View>
      <View style={[styles.bar, { paddingBottom: insets.bottom + 12 }]}>
        {web ? <StaffText role="body" color="onCamera" align="center">Open the installed Hygene Ops Staff app to scan the task QR.</StaffText>
          : !granted ? <>
            <StaffText role="body" color="onCamera" align="center">Allow camera access to scan the task QR code.</StaffText>
            <ActionButton kind="next" icon="Camera" label={permission?.canAskAgain ? 'Allow camera' : 'Open camera settings'} onPress={askCamera} />
          </> : <>
            {status ? <StaffText role="body" color="onCamera" align="center" accessibilityLiveRegion="polite">{status}</StaffText> : null}
            <StaffText role="body" color="onCamera" align="center">Hold the QR inside the frame. It scans by itself.</StaffText>
            {!busy ? <Pressable accessibilityRole="button" accessibilityLabel={t('Restart scanner')} onPress={restart}
              style={[styles.ghost, { flexDirection: row }]}>
              <Icon name="RotateCcw" size={20} color={colors.surface} />
              <StaffText role="groupTitle" color="surface">Restart scanner</StaffText>
            </Pressable> : null}
          </>}
      </View>
      <BottomSheet
        visible={!!error}
        onDismiss={restart}
        glyph="QrCode"
        glyphTone="red"
        title={wrongTask ? 'This QR is for another task' : "Couldn't confirm the start"}
        body={wrongTask
          ? <AreaSentence englishKey="Find the code for {area}, then scan again." urduLabelKey="Find the code for this task, then scan again:" area={area} color="muted" />
          : <StaffText role="body" color="muted" accessibilityLiveRegion="polite">{error}</StaffText>}
        actions={<ActionButton kind="next" icon="QrCode" label="Scan again" onPress={restart} />}
      />
    </View>;
  }

  const kind = task ? displayFor(taskDisplay(task)) : null;
  return <View style={[styles.white, { paddingTop: insets.top }]}>
    <TopBar title={task ? area : 'Start cleaning'} translateTitle={!task} onBack={goBack} />
    <ScrollView contentContainerStyle={styles.plainBody}>
      {task ? <>
        <NameLine role="headline" name={task.title} />
        <StaffText role="meta" color="muted" translate={false}>{isolate(timeRange(task.shiftStart, task.shiftEnd, timeZone))}</StaffText>
        {kind?.pillLabel ? <View style={{ flexDirection: row }}><Pill tone={kind.pillTone} label={kind.pillLabel} /></View> : null}
        {task.status === 'PENDING' && task.verificationVersion !== 2 ? <View style={[styles.note, styles.noteWarn]}>
          <StaffText role="body" color="yellowInk" accessibilityLiveRegion="polite">This task needs area inventory setup. Ask your manager to repair or replace it.</StaffText>
        </View> : null}
      </> : taskQuery.isError ? <ErrorState body={verificationErrorMessage(taskQuery.error)} onRetry={() => void taskQuery.refetch()} />
        : <View style={styles.loading} accessibilityLabel={t('Loading assigned task…')} accessibilityLiveRegion="polite" testID="start-task-loading">
          <Skeleton height={32} width="70%" />
          <Skeleton height={20} width="45%" />
          <Skeleton height={236} radius={radius.cardRadius} />
        </View>}
    </ScrollView>
  </View>;
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  mirror: { transform: [{ scaleX: -1 }] },
  night: { flex: 1, backgroundColor: colors.night },
  camera: { flex: 1, overflow: 'hidden', backgroundColor: colors.night },
  cameraTop: { paddingHorizontal: 16, paddingBottom: 12, gap: 2 },
  topRow: { minHeight: space.touchMinIcon, alignItems: 'center', gap: 8, marginBottom: 6 },
  bar: { backgroundColor: colors.night, paddingTop: 14, paddingHorizontal: 22, gap: 12 },
  ghost: { minHeight: space.ghostHeight, alignItems: 'center', justifyContent: 'center', gap: 10, borderRadius: radius.actionRadius },
  white: { flex: 1, backgroundColor: colors.surface },
  startedBody: { paddingHorizontal: space.gutter, paddingBottom: 24 },
  moment: { alignItems: 'center', gap: 8, paddingTop: 34, paddingBottom: 24 },
  badge: {
    width: space.badgeOkSize,
    height: space.badgeOkSize,
    borderRadius: radius.badgeOkRadius,
    backgroundColor: colors.blue,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 14,
  },
  note: { gap: 12, paddingVertical: 14, paddingHorizontal: 16, borderRadius: 16, backgroundColor: colors.blueWash, alignItems: 'flex-start' },
  noteWarn: { backgroundColor: colors.yellowWash, marginTop: 8 },
  plainBody: { padding: space.gutter, gap: 10 },
  loading: { gap: 14 },
});
