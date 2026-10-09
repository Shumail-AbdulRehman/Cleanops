import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Platform, StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useReducedMotion, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';
import { useLanguage } from '../i18n/LanguageProvider';
import { StaffText, isolate } from '../design/StaffText';
import { colors, motion, radius, whiteAlpha } from '../design/tokens';
import { checkLabels, checkPercent, WORKING_STAGES, type PhotoCheck, type PhotoCheckStage } from '../verification/photoCheck';
import { Icon, type LucideIconName } from './ui/icon';

// Spec 72: the photo-check card over the live task camera. It only shows what the screen reports;
// it never holds the screen back. Under reduced motion: no sweep, pulse, pop or shake, only fades.

const easeOut = Easing.bezier(...motion.easing.easeOut);
const TICK_MS = 250;
const SHAKE = 6;

type Look = { icon: LucideIconName; ink: string; wash: string; fill: string };
const looks: Record<PhotoCheckStage, Look> = {
  quality: { icon: 'ScanLine', ink: colors.surface, wash: colors.cameraButton, fill: colors.yellow },
  upload: { icon: 'CloudUpload', ink: colors.surface, wash: colors.cameraButton, fill: colors.yellow },
  ai: { icon: 'Sparkles', ink: colors.surface, wash: colors.cameraButton, fill: colors.yellow },
  received: { icon: 'Check', ink: colors.ok, wash: colors.okWash, fill: colors.okWash },
  retake: { icon: 'Camera', ink: colors.warn, wash: colors.warnWash, fill: colors.warnWash },
  clean: { icon: 'Droplets', ink: colors.warn, wash: colors.warnWash, fill: colors.warnWash },
  failed: { icon: 'Info', ink: colors.warn, wash: colors.warnWash, fill: colors.warnWash },
};
const problem = (stage: PhotoCheckStage) => stage === 'retake' || stage === 'clean' || stage === 'failed';

/** Thin bar with its fill from the start side (right in Urdu). The width follows `percent`; no motion when reduced. */
export function CheckBar({ percent, stage, label }: { percent: number; stage: PhotoCheckStage; label: string }) {
  const { isRTL } = useLanguage();
  const reduced = useReducedMotion();
  const [track, setTrack] = useState(0);
  const width = useSharedValue(0);
  useEffect(() => {
    const to = (track * Math.min(100, Math.max(0, percent))) / 100;
    width.value = reduced ? to : withTiming(to, { duration: motion.duration.busy, easing: easeOut });
  }, [percent, track, reduced, width]);
  const fillStyle = useAnimatedStyle(() => ({ width: width.value }));
  return <View testID="photo-check-bar" accessible accessibilityRole="progressbar" accessibilityLabel={label}
    accessibilityValue={{ min: 0, max: 100, now: percent }}
    onLayout={(event: LayoutChangeEvent) => setTrack(event.nativeEvent.layout.width)} style={styles.track}>
    <Animated.View style={[styles.fill, isRTL ? styles.fromRight : styles.fromLeft, { backgroundColor: looks[stage].fill }, fillStyle]} />
  </View>;
}

/** Round glyph for a stage: pulses while the AI checks, pops on a received photo. */
function CheckGlyph({ stage }: { stage: PhotoCheckStage }) {
  const reduced = useReducedMotion();
  const pulse = useSharedValue(0);
  const pop = useSharedValue(1);
  useEffect(() => {
    if (stage === 'ai' && !reduced) pulse.value = withRepeat(withTiming(1, { duration: motion.duration.locateRing, easing: Easing.inOut(Easing.ease) }), -1, true);
    else pulse.value = 0;
    if (stage === 'received') {
      pop.value = 0;
      pop.value = withTiming(1, { duration: reduced ? motion.duration.reducedFade : motion.duration.badge, easing: easeOut });
    } else pop.value = 1;
  }, [stage, reduced, pulse, pop]);
  const style = useAnimatedStyle(() => ({
    opacity: (1 - pulse.value * 0.45) * pop.value,
    transform: [{ scale: reduced ? 1 : 0.6 + 0.4 * pop.value }],
  }));
  const look = looks[stage];
  return <Animated.View testID={`photo-check-glyph-${stage}`} style={[styles.glyph, { backgroundColor: look.wash }, style]}>
    <Icon name={look.icon} size={18} color={look.ink} strokeWidth={stage === 'received' ? 3 : undefined} />
  </Animated.View>;
}

/**
 * The card: glyph, stage line (the one polite announcement per stage), percentage and bar. It rises in once
 * (`rise`), and shakes briefly on a problem ending.
 */
export function CheckCard({ stage, label, percent, rise = true, testID }: {
  stage: PhotoCheckStage; label: string; percent: number; rise?: boolean; testID?: string;
}) {
  const { isRTL } = useLanguage();
  const reduced = useReducedMotion();
  const enter = useSharedValue(rise ? 0 : 1);
  const shake = useSharedValue(1);
  useEffect(() => {
    if (!rise) return;
    enter.value = withTiming(1, reduced
      ? { duration: motion.duration.reducedFade, easing: Easing.out(Easing.ease) }
      : { duration: motion.duration.busy, easing: easeOut });
  }, [enter, reduced, rise]);
  useEffect(() => {
    if (!problem(stage) || reduced) return;
    shake.value = 0;
    shake.value = withTiming(1, { duration: motion.duration.press * 3, easing: Easing.linear });
  }, [stage, reduced, shake]);
  useEffect(() => { if (Platform.OS === 'ios') AccessibilityInfo.announceForAccessibility?.(label); }, [label]);
  const style = useAnimatedStyle(() => ({
    opacity: enter.value,
    transform: [
      { translateY: reduced ? 0 : (1 - enter.value) * 12 },
      { translateX: reduced ? 0 : Math.sin(shake.value * Math.PI * 4) * SHAKE * (1 - shake.value) },
    ],
  }));
  const row = isRTL ? 'row-reverse' : 'row';
  return <Animated.View testID={testID ?? 'photo-check'} accessibilityState={{ busy: WORKING_STAGES.includes(stage) }} style={[styles.card, style]}>
    <View style={[styles.row, { flexDirection: row }]}>
      <CheckGlyph stage={stage} />
      <View style={styles.flex}>
        <StaffText role="rowTitle" color="surface" translate={false} accessibilityLiveRegion="polite">{label}</StaffText>
      </View>
      <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <StaffText role="label" color="surface" translate={false} testID="photo-check-percent">{isolate(`${percent}%`)}</StaffText>
      </View>
    </View>
    <CheckBar percent={percent} stage={stage} label={label} />
  </Animated.View>;
}

/** A light line sweeping down the camera while the phone checks the picture (not under reduced motion). */
function QualitySweep() {
  const [height, setHeight] = useState(0);
  const travel = useSharedValue(0);
  useEffect(() => {
    travel.value = 0;
    travel.value = withRepeat(withTiming(1, { duration: motion.duration.scanLine, easing: Easing.linear }), -1, false);
  }, [travel]);
  const lineStyle = useAnimatedStyle(() => ({ transform: [{ translateY: travel.value * height }] }));
  return <View pointerEvents="none" testID="photo-check-sweep" style={StyleSheet.absoluteFill}
    accessibilityElementsHidden importantForAccessibility="no-hide-descendants"
    onLayout={(event: LayoutChangeEvent) => setHeight(event.nativeEvent.layout.height)}>
    <Animated.View style={[styles.sweep, lineStyle]} />
  </View>;
}

/**
 * Everything the camera shows for one photo check (spec 72). The percentage only grows: quality and AI
 * ease with time inside their bands, upload follows the bytes sent, an ending is 100.
 */
export function PhotoCheckOverlay({ check }: { check: PhotoCheck }) {
  const { t } = useLanguage();
  const reduced = useReducedMotion();
  const [now, setNow] = useState(() => Date.now());
  const shown = useRef({ id: check.id, value: 0 });
  const timed = check.stage === 'quality' || check.stage === 'ai';
  useEffect(() => {
    setNow(Date.now());
    if (!timed) return;
    const timer = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(timer);
  }, [check.id, check.stage, timed]);
  if (shown.current.id !== check.id) shown.current = { id: check.id, value: 0 };
  shown.current.value = Math.max(shown.current.value, checkPercent(check, Math.max(now, check.since)));
  return <>
    {check.stage === 'quality' && !reduced ? <QualitySweep /> : null}
    <CheckCard stage={check.stage} label={t(checkLabels[check.stage])} percent={shown.current.value} />
  </>;
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  card: {
    position: 'absolute', left: 16, right: 16, bottom: 20, gap: 12, padding: 16,
    borderRadius: radius.cardRadius, backgroundColor: colors.night,
  },
  row: { alignItems: 'center', gap: 12 },
  glyph: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  track: { height: 4, borderRadius: 2, overflow: 'hidden', backgroundColor: whiteAlpha.track },
  fill: { position: 'absolute', top: 0, bottom: 0, borderRadius: 2 },
  fromLeft: { left: 0 },
  fromRight: { right: 0 },
  sweep: { position: 'absolute', top: 0, left: 0, right: 0, height: 2, backgroundColor: colors.yellow, opacity: 0.7 },
});
