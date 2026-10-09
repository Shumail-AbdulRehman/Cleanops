import { useEffect, type ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useReducedMotion, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { useLanguage } from '../i18n/LanguageProvider';
import { StaffText } from '../design/StaffText';
import { colors, motion, radius, space } from '../design/tokens';
import { Icon } from './ui/icon';
import { CheckCard } from './PhotoCheckProgress';

const easeOut = Easing.bezier(...motion.easing.easeOut);
/** Outer size of the shutter: the 80 face, the dark gap and the white ring. */
const RING = space.shutter + 2 * (space.shutterGap + space.shutterRing);

/**
 * The task camera shutter: white 80 face inside a white ring. Scales to 0.93 while
 * pressed (not under reduced motion) and gives one medium haptic per press.
 * Geometry lives in plain styles so the shutter can never flex or lose its bounds.
 */
export function PhotoCaptureControls({ disabled, busy, label, onCapture }: {
  disabled: boolean; busy: boolean; label: string; onCapture: () => void;
}) {
  const { t } = useLanguage();
  const reduced = useReducedMotion();
  const scale = useSharedValue(1);
  const pressStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  const pressTo = (to: number) => {
    if (reduced) return;
    scale.value = withTiming(to, { duration: motion.duration.press, easing: easeOut });
  };
  const blocked = disabled || busy;
  return <Pressable accessibilityRole="button" accessibilityLabel={t(label)} accessibilityState={{ disabled: blocked, busy }}
    disabled={blocked}
    onPress={() => { void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); onCapture(); }}
    onPressIn={() => { if (!blocked) pressTo(motion.scale.shutter); }}
    onPressOut={() => pressTo(1)}
    style={[captureStyles.shutter, { opacity: disabled ? 0.45 : 1 }]}>
    <Animated.View pointerEvents="none" style={[captureStyles.ring, pressStyle]}>
      <View style={captureStyles.face}>
        {busy ? <ActivityIndicator color={colors.ink} size="small" /> : <Icon name="Camera" color={colors.ink} size={30} />}
      </View>
    </Animated.View>
  </Pressable>;
}

/** Round 48 button on the dark camera (close, torch, restart). `on` fills it yellow. */
export function CameraRoundButton({ label, onPress, on = false, children }: {
  label: string; onPress: () => void; on?: boolean; children: ReactNode;
}) {
  return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ selected: on }}
    onPress={onPress} hitSlop={4} style={[captureStyles.round, on ? captureStyles.roundOn : null]}>
    {children}
  </Pressable>;
}

/**
 * Scanner viewfinder: four white rounded corners and a yellow line moving up and down
 * (still in the middle under reduced motion). Decorative only.
 */
export function CaptureFrame() {
  const reduced = useReducedMotion();
  const travel = useSharedValue(reduced ? 0.5 : 0);
  useEffect(() => {
    if (reduced) { travel.value = 0.5; return; }
    travel.value = 0;
    travel.value = withRepeat(withTiming(1, { duration: motion.duration.scanLine, easing: Easing.linear }), -1, true);
  }, [reduced, travel]);
  const lineStyle = useAnimatedStyle(() => ({ transform: [{ translateY: travel.value * (FRAME - LINE_HEIGHT) }] }));
  return <View pointerEvents="none" style={captureStyles.frameBox} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
    <View style={captureStyles.frame} testID="photo-viewfinder">
      <View style={[captureStyles.corner, captureStyles.cornerTL]} />
      <View style={[captureStyles.corner, captureStyles.cornerTR]} />
      <View style={[captureStyles.corner, captureStyles.cornerBL]} />
      <View style={[captureStyles.corner, captureStyles.cornerBR]} />
      <Animated.View testID="photo-scan-line" style={[captureStyles.scanLine, lineStyle]} />
    </View>
  </View>;
}

export type PhotoSegment = 'done' | 'current' | 'todo';

/** One segment per required photo (white done, yellow current, dim otherwise) and the "3/7" count. */
export function PhotoStepProgress({ current, total, segments }: { current: number; total: number; segments?: readonly PhotoSegment[] }) {
  const { t, isRTL } = useLanguage();
  const parts: readonly PhotoSegment[] = segments ?? Array.from({ length: total }, (_, i) => (i + 1 < current ? 'done' : i + 1 === current ? 'current' : 'todo'));
  return <View style={[captureStyles.stepRow, { flexDirection: isRTL ? 'row-reverse' : 'row' }]}>
    <View accessible accessibilityRole="image" accessibilityLabel={t('Photo {n} of {t}', { n: current, t: total })}
      style={[captureStyles.segments, { flexDirection: isRTL ? 'row-reverse' : 'row' }]}>
      {parts.map((part, i) => <View key={i} testID={`photo-segment-${part}`}
        style={[captureStyles.segment, part === 'done' ? captureStyles.segmentDone : part === 'current' ? captureStyles.segmentCurrent : null]} />)}
    </View>
    <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <StaffText role="label" color="surface" translate={false}>{`${current}/${total}`}</StaffText>
    </View>
  </View>;
}

/** Spinner and one line on a dark card; `centred` puts it in the middle of the camera (locating). */
export function CaptureBusyCard({ label, centred = false }: { label: string; centred?: boolean }) {
  const { isRTL } = useLanguage();
  const reduced = useReducedMotion();
  const progress = useSharedValue(0);
  useEffect(() => {
    progress.value = withTiming(1, reduced
      ? { duration: motion.duration.reducedFade, easing: Easing.out(Easing.ease) }
      : { duration: motion.duration.busy, easing: easeOut });
  }, [progress, reduced]);
  const style = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [{ translateY: reduced ? 0 : (1 - progress.value) * 12 }],
  }));
  return <Animated.View accessibilityState={{ busy: true }}
    style={[captureStyles.busyCard, centred ? captureStyles.busyCentred : captureStyles.busyBottom, { flexDirection: isRTL ? 'row-reverse' : 'row' }, style]}>
    <ActivityIndicator color={colors.surface} size="small" />
    <View style={captureStyles.flex}>
      <StaffText role="rowTitle" color="surface" accessibilityLiveRegion="polite">{label}</StaffText>
    </View>
  </Animated.View>;
}

/**
 * "{item} photo done" on the dark camera after a photo that needs nothing more (spec 71), in the busy
 * card's place. One success haptic when it appears. Spec 72: the photo-check card's look at 100%, with
 * the green tick popping in where the check card was.
 */
export function CaptureDoneCard({ label }: { label: string }) {
  useEffect(() => { void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success); }, []);
  return <CheckCard testID="photo-done" stage="received" label={label} percent={100} rise={false} />;
}

const FRAME = 236;
const CORNER = 48;
const CORNER_WIDTH = 5;
const CORNER_RADIUS = 18;
const LINE_HEIGHT = 3;

const captureStyles = StyleSheet.create({
  flex: { flex: 1 },
  shutter: {
    width: RING, height: RING, flexGrow: 0, flexShrink: 0, alignSelf: 'center', borderRadius: RING / 2,
  },
  ring: {
    width: RING, height: RING, borderRadius: RING / 2, borderWidth: space.shutterRing, borderColor: colors.surface,
    padding: space.shutterGap, backgroundColor: colors.night,
  },
  face: {
    width: space.shutter, height: space.shutter, borderRadius: space.shutter / 2, flexGrow: 0, flexShrink: 0,
    backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center',
  },
  round: {
    width: space.touchMinIcon, height: space.touchMinIcon, borderRadius: space.touchMinIcon / 2,
    backgroundColor: colors.cameraButton, alignItems: 'center', justifyContent: 'center',
  },
  roundOn: { backgroundColor: colors.yellow },
  frameBox: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingBottom: 24 },
  frame: { width: FRAME, height: FRAME },
  corner: { position: 'absolute', width: CORNER, height: CORNER, borderColor: colors.surface },
  cornerTL: { top: 0, left: 0, borderTopWidth: CORNER_WIDTH, borderLeftWidth: CORNER_WIDTH, borderTopLeftRadius: CORNER_RADIUS },
  cornerTR: { top: 0, right: 0, borderTopWidth: CORNER_WIDTH, borderRightWidth: CORNER_WIDTH, borderTopRightRadius: CORNER_RADIUS },
  cornerBL: { bottom: 0, left: 0, borderBottomWidth: CORNER_WIDTH, borderLeftWidth: CORNER_WIDTH, borderBottomLeftRadius: CORNER_RADIUS },
  cornerBR: { bottom: 0, right: 0, borderBottomWidth: CORNER_WIDTH, borderRightWidth: CORNER_WIDTH, borderBottomRightRadius: CORNER_RADIUS },
  scanLine: { position: 'absolute', top: 0, left: 18, right: 18, height: LINE_HEIGHT, borderRadius: 2, backgroundColor: colors.yellow },
  stepRow: { flex: 1, alignItems: 'center', gap: 10 },
  segments: { flex: 1, gap: 4 },
  segment: { flex: 1, height: 5, borderRadius: 3, backgroundColor: colors.cameraButton },
  segmentDone: { backgroundColor: colors.surface },
  segmentCurrent: { backgroundColor: colors.yellow },
  busyCard: {
    position: 'absolute', left: 16, right: 16, alignItems: 'center', gap: 12, padding: 16,
    borderRadius: radius.cardRadius, backgroundColor: colors.night,
  },
  busyBottom: { bottom: 20 },
  busyCentred: { top: '45%' },
});
