import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, BackHandler, Pressable, StyleSheet, View, useWindowDimensions, type LayoutChangeEvent } from 'react-native';
import { CameraView } from 'expo-camera';
import { useIsFocused } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { Easing, useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from 'react-native-reanimated';
import Svg, { Ellipse, Path } from 'react-native-svg';
import * as Haptics from 'expo-haptics';
import { useLanguage } from '../i18n/LanguageProvider';
import { StaffText } from '../design/StaffText';
import { colors, motion, radius, space } from '../design/tokens';
import { Icon } from './ui/icon';

const OVAL_WIDTH = 236;
const OVAL_HEIGHT = 306;
const OVAL_BORDER = 4;
/** Vertical centre of the face guide, as a share of the camera area. */
const OVAL_CENTRE = 0.44;
const OUTSIDE_DIM = 0.62;
const BUSY_OFFSET = 12;
const easeOut = Easing.bezier(...motion.easing.easeOut);

/** Space kept between the title block and the oval, and below the oval. */
const OVAL_GAP = 8;
/** Smallest oval half-height, so a very short camera area still shows a usable guide. */
const OVAL_MIN_RY = 60;
/** Bottom of the title block before it is measured: top padding, close button, title, hint, bottom padding. */
const TOP_ESTIMATE = 6 + space.touchMinIcon + 6 + 36 + 24 + 20;

/**
 * Where the face oval goes in a camera area of `width` by `height` whose top `top` points hold
 * the close button, title and hint. Keeps the 236 by 306 proportions, centres at 44% when it fits,
 * never starts above `top + OVAL_GAP` and shrinks when the area is short (spec 67: on the phone the
 * oval covered the title and hint).
 */
export function faceGuideFrame(width: number, height: number, top: number) {
  const ratio = OVAL_HEIGHT / OVAL_WIDTH;
  const rxMax = Math.min(OVAL_WIDTH / 2, width * 0.36);
  const room = Math.max(0, height - top - 2 * OVAL_GAP);
  const ry = Math.max(Math.min(rxMax * ratio, room / 2), Math.min(OVAL_MIN_RY, rxMax * ratio));
  const rx = ry / ratio;
  const lowest = top + OVAL_GAP + ry;
  const highest = height - OVAL_GAP - ry;
  const cy = Math.max(lowest, Math.min(height * OVAL_CENTRE, highest));
  return { cx: width / 2, cy, rx, ry };
}

/** Darkens everything outside the oval face guide and draws its white border. */
function FaceGuide({ width, height, top }: { width: number; height: number; top: number }) {
  const { cx, cy, rx, ry } = faceGuideFrame(width, height, top);
  const outside = `M0 0H${width}V${height}H0Z M${cx - rx} ${cy}a${rx} ${ry} 0 1 0 ${2 * rx} 0a${rx} ${ry} 0 1 0 ${-2 * rx} 0Z`;
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Svg width={width} height={height}>
        <Path d={outside} fill={colors.night} fillOpacity={OUTSIDE_DIM} fillRule="evenodd" />
        <Ellipse cx={cx} cy={cy} rx={rx} ry={ry} stroke={colors.surface} strokeWidth={OVAL_BORDER} fill="none" />
      </Svg>
    </View>
  );
}

/** "Saving your attendance…" over the bottom of the camera while the upload runs. */
function BusyCard() {
  const reduced = useReducedMotion();
  const progress = useSharedValue(0);
  useEffect(() => {
    progress.value = withTiming(1, reduced
      ? { duration: motion.duration.reducedFade, easing: Easing.out(Easing.ease) }
      : { duration: motion.duration.busy, easing: easeOut });
  }, [progress, reduced]);
  const style = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [{ translateY: reduced ? 0 : (1 - progress.value) * BUSY_OFFSET }],
  }));
  const { isRTL } = useLanguage();
  return (
    <Animated.View style={[styles.busyCard, { flexDirection: isRTL ? 'row-reverse' : 'row' }, style]}>
      <ActivityIndicator color={colors.surface} size="small" />
      <View style={styles.busyText}>
        <StaffText role="rowTitle" color="surface" accessibilityLiveRegion="polite">
          Saving your attendance…
        </StaffText>
      </View>
    </Animated.View>
  );
}

/** Uses the app's camera directly; no external Android image-picker activity. */
export function AttendanceCamera({ mode, onCapture, onCancel }: {
  mode: 'check-in' | 'check-out';
  onCapture: (uri: string) => Promise<void>;
  onCancel: () => void;
}) {
  const { t, isRTL } = useLanguage();
  const camera = useRef<CameraView>(null);
  const ready = useRef(false);
  const taking = useRef(false);
  const [cameraReady, setCameraReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const focused = useIsFocused();
  const insets = useSafeAreaInsets();
  const screen = useWindowDimensions();
  const [area, setArea] = useState({ width: screen.width, height: Math.max(0, screen.height - 220) });
  const [topBlock, setTopBlock] = useState(TOP_ESTIMATE);
  const reduced = useReducedMotion();
  const shutterScale = useSharedValue(1);
  const shutterStyle = useAnimatedStyle(() => ({ transform: [{ scale: shutterScale.value }] }));

  useEffect(() => {
    const listener = BackHandler.addEventListener('hardwareBackPress', () => {
      if (!taking.current) onCancel();
      return true;
    });
    return () => listener.remove();
  }, [onCancel]);

  const capture = async () => {
    if (taking.current || !ready.current || !focused) return;
    taking.current = true; setBusy(true); setError('');
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
      const photo = await camera.current?.takePictureAsync({ quality: 0.7 });
      if (!photo?.uri) throw new Error('The camera did not save a selfie. Please try again.');
      setSaving(true);
      await onCapture(photo.uri);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Could not take your selfie. Try again.');
    } finally { taking.current = false; setBusy(false); setSaving(false); }
  };

  const pressShutter = (to: number) => {
    if (reduced) return;
    shutterScale.value = withTiming(to, { duration: motion.duration.press, easing: easeOut });
  };
  const close = () => { if (!taking.current) onCancel(); };
  const onLayout = (event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    if (width !== area.width || height !== area.height) setArea({ width, height });
  };
  const onTopLayout = (event: LayoutChangeEvent) => {
    const { y, height } = event.nativeEvent.layout;
    if (y + height !== topBlock) setTopBlock(y + height);
  };

  return <View style={[styles.screen, { paddingTop: insets.top }]}>
    <View style={styles.camera} onLayout={onLayout}>
      {focused ? <CameraView ref={camera} style={StyleSheet.absoluteFill} facing="front" mode="picture"
        onCameraReady={() => { ready.current = true; setCameraReady(true); }}
        onMountError={() => { ready.current = false; setCameraReady(false); setError('The camera could not open. Go back and try again.'); }} /> : null}
      {area.width > 0 && area.height > 0 ? <FaceGuide width={area.width} height={area.height} top={topBlock} /> : null}
      <View style={styles.cameraTop} onLayout={onTopLayout} testID="camera-top">
        <View style={[styles.topRow, { flexDirection: isRTL ? 'row-reverse' : 'row' }]}>
          <Pressable accessibilityRole="button" accessibilityLabel={t('Cancel')} onPress={close} hitSlop={4} style={styles.close}>
            <Icon name="X" size={24} color={colors.surface} />
          </Pressable>
        </View>
        <StaffText role="cameraTitle" color="surface" accessibilityRole="header">
          {mode === 'check-in' ? 'Check-in selfie' : 'Check-out selfie'}
        </StaffText>
        <StaffText role="body" color="onCamera">Keep your face inside the circle.</StaffText>
      </View>
      {saving ? <BusyCard /> : null}
    </View>
    <View style={[styles.bar, { paddingBottom: insets.bottom + 12 }]}>
      {!cameraReady && !error ? <StaffText role="body" color="onCamera" align="center" accessibilityLiveRegion="polite">Opening camera…</StaffText> : null}
      {error ? <StaffText role="body" color="onCamera" align="center" accessibilityLiveRegion="polite">{error}</StaffText> : null}
      <View style={styles.shoot}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('Take selfie')}
          accessibilityState={{ disabled: !cameraReady, busy }}
          onPress={() => void capture()}
          onPressIn={() => { if (!busy) pressShutter(motion.scale.shutter); }}
          onPressOut={() => pressShutter(1)}
        >
          <Animated.View style={[styles.shutterRing, shutterStyle]}>
            <View style={styles.shutter}>
              {busy ? <ActivityIndicator color={colors.ink} size="small" /> : <Icon name="Camera" size={30} color={colors.ink} />}
            </View>
          </Animated.View>
        </Pressable>
      </View>
    </View>
  </View>;
}

const RING = space.shutter + 2 * (space.shutterGap + space.shutterRing);

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.night },
  camera: { flex: 1, overflow: 'hidden', backgroundColor: colors.night },
  cameraTop: { position: 'absolute', top: 0, left: 0, right: 0, paddingHorizontal: 16, paddingTop: 6, paddingBottom: 20, gap: 2 },
  topRow: { minHeight: space.touchMinIcon, alignItems: 'center', marginBottom: 6 },
  close: {
    width: space.touchMinIcon,
    height: space.touchMinIcon,
    borderRadius: space.touchMinIcon / 2,
    backgroundColor: colors.cameraButton,
    alignItems: 'center',
    justifyContent: 'center',
  },
  busyCard: {
    position: 'absolute',
    left: 16,
    right: 16,
    bottom: 20,
    alignItems: 'center',
    gap: 12,
    padding: 16,
    borderRadius: radius.cardRadius,
    backgroundColor: colors.night,
  },
  busyText: { flex: 1 },
  bar: { backgroundColor: colors.night, paddingTop: 14, paddingHorizontal: 22, gap: 12 },
  shoot: { alignItems: 'center', justifyContent: 'center' },
  shutterRing: {
    width: RING,
    height: RING,
    borderRadius: RING / 2,
    borderWidth: space.shutterRing,
    borderColor: colors.surface,
    padding: space.shutterGap,
    backgroundColor: colors.night,
  },
  shutter: {
    flex: 1,
    borderRadius: space.shutter / 2,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
