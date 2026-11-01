import * as React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { Easing, useAnimatedStyle, useReducedMotion, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';
import { Icon } from '../../components/ui/icon';
import { StaffText, isolate } from '../../design/StaffText';
import { colors, motion, space } from '../../design/tokens';
import { useLanguage } from '../../i18n/LanguageProvider';

export interface AttendanceLocatingProps {
  /** The assigned location's entered name, or null. Never translated. */
  place: string | null;
  onBack: () => void;
}

const PULSE = 120;
const RING_SCALE = 1.55;
const RING_START_OPACITY = 0.9;

/** Expanding ring behind the pin; not shown under reduced motion. */
function Ring() {
  const progress = useSharedValue(0);
  React.useEffect(() => {
    progress.value = withRepeat(
      withTiming(1, { duration: motion.duration.locateRing, easing: Easing.out(Easing.ease) }),
      -1,
      false,
    );
  }, [progress]);
  const style = useAnimatedStyle(() => ({
    opacity: RING_START_OPACITY * (1 - progress.value),
    transform: [{ scale: 1 + (RING_SCALE - 1) * progress.value }],
  }));
  return <Animated.View testID="locate-ring" style={[StyleSheet.absoluteFill, styles.ring, style]} />;
}

/** "Finding your location…" while the hook is in `locating`. */
export function AttendanceLocating({ place, onBack }: AttendanceLocatingProps) {
  const { t, isRTL } = useLanguage();
  const insets = useSafeAreaInsets();
  const reduced = useReducedMotion();
  return (
    <View style={[styles.screen, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
      <View style={[styles.top, { flexDirection: isRTL ? 'row-reverse' : 'row' }]}>
        <Pressable accessibilityRole="button" accessibilityLabel={t('Back')} onPress={onBack} hitSlop={4} style={styles.back}>
          <View style={isRTL ? styles.mirror : null}>
            <Icon name="ArrowLeft" size={24} color={colors.ink} />
          </View>
        </Pressable>
      </View>
      <View style={styles.content}>
        <View style={styles.pulse} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          {reduced ? null : <Ring />}
          <Icon name="MapPin" size={48} color={colors.blue} />
        </View>
        <StaffText role="headline" align="center" accessibilityRole="header" accessibilityLiveRegion="polite">
          Finding your location…
        </StaffText>
        <StaffText role="body" color="muted" align="center">
          Stay still for a moment.
        </StaffText>
        {place ? (
          <View style={styles.place}>
            <StaffText role="rowTitle" align="center" translate={false}>
              {isolate(place)}
            </StaffText>
          </View>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.canvas },
  top: { height: 56, alignItems: 'center', paddingHorizontal: 8 },
  back: {
    width: space.touchMinIcon,
    height: space.touchMinIcon,
    borderRadius: space.touchMinIcon / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  mirror: { transform: [{ scaleX: -1 }] },
  content: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 26, paddingVertical: 24, gap: 8 },
  pulse: {
    width: PULSE,
    height: PULSE,
    borderRadius: PULSE / 2,
    backgroundColor: colors.blueWash,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  ring: { borderRadius: PULSE / 2, backgroundColor: colors.blueWash },
  place: { alignSelf: 'stretch', marginTop: 14 },
});
