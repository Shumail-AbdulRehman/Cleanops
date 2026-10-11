import * as React from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { Easing, useAnimatedProps, useAnimatedStyle, useReducedMotion, useSharedValue, withDelay, withTiming } from 'react-native-reanimated';
import Svg, { Path } from 'react-native-svg';
import * as Haptics from 'expo-haptics';
import { Icon, type LucideIconName } from '../components/ui/icon';
import { useLanguage } from '../i18n/LanguageProvider';
import { Pill, type PillProps } from './Pill';
import { StaffText, isolate } from './StaffText';
import { colors, motion, radius, space } from './tokens';

export interface MomentFact {
  /** English key, translated. */
  label: string;
  /** Plain value, shown as given (entered names, times, numbers). Never translated. */
  value: string;
  /** A prepared node shown instead of `value`. */
  valueNode?: React.ReactNode;
}

export interface MomentProps {
  badge: 'blue' | 'green';
  /** Static Lucide icon; the default `Check` is drawn as an animated stroke. */
  icon?: LucideIconName;
  /** English key, translated. */
  title: string;
  /** Prepared node, often a time. */
  subtitle?: React.ReactNode;
  pill?: PillProps;
  facts?: MomentFact[];
  /** An `ActionButton` element, placed in a borderless dock. */
  action?: React.ReactNode;
  /** Announce the title as a live region. */
  live?: boolean;
}

const ICON_SIZE = 52;
const TICK_LENGTH = 24;
const TICK_PATH = 'M5 12.5l4.5 4.5L19 7.5';
const TITLE_DELAY = 90;
const REST_DELAY = 150;
const AnimatedPath = Animated.createAnimatedComponent(Path);
const easeOut = Easing.bezier(...motion.easing.easeOut);

/** Fade up on mount after a delay; shown at once under reduced motion. */
function useFadeUp(delay: number, reduced: boolean) {
  const progress = useSharedValue(reduced ? 1 : 0);
  React.useEffect(() => {
    if (reduced) {
      progress.value = 1;
      return;
    }
    progress.value = withDelay(delay, withTiming(1, { duration: motion.duration.nowChange, easing: easeOut }));
  }, [delay, reduced, progress]);
  return useAnimatedStyle(() => ({ opacity: progress.value, transform: [{ translateY: (1 - progress.value) * 8 }] }));
}

/** Checked in, Checked out and Work submitted: one calm receipt with the app's one earned animation. */
export function Moment({ badge, icon = 'Check', title, subtitle, pill, facts = [], action, live = false }: MomentProps) {
  const { isRTL } = useLanguage();
  const reduced = useReducedMotion();
  const scale = useSharedValue(reduced ? 1 : 0.9);
  const badgeOpacity = useSharedValue(reduced ? 1 : 0);
  const tick = useSharedValue(reduced ? 1 : 0);

  React.useEffect(() => {
    if (reduced) {
      scale.value = 1;
      badgeOpacity.value = 1;
      tick.value = 1;
    } else {
      const timing = { duration: motion.duration.badge, easing: easeOut };
      scale.value = withTiming(1, timing);
      badgeOpacity.value = withTiming(1, timing);
      tick.value = withDelay(motion.duration.tickDelay, withTiming(1, { duration: motion.duration.tickDraw, easing: easeOut }));
    }
  }, [reduced, scale, badgeOpacity, tick]);

  React.useEffect(() => {
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  }, []);

  const badgeStyle = useAnimatedStyle(() => ({ opacity: badgeOpacity.value, transform: [{ scale: scale.value }] }));
  const tickProps = useAnimatedProps(() => ({ strokeDashoffset: TICK_LENGTH * (1 - tick.value) }));
  const titleStyle = useFadeUp(TITLE_DELAY, reduced);
  const restStyle = useFadeUp(REST_DELAY, reduced);

  return (
    <View style={styles.screen}>
      <View style={styles.content}>
        <Animated.View
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={[styles.badge, { backgroundColor: badge === 'green' ? colors.ok : colors.blue }, badgeStyle]}
        >
          {icon === 'Check' ? (
            <Svg width={ICON_SIZE} height={ICON_SIZE} viewBox="0 0 24 24" fill="none">
              <AnimatedPath
                d={TICK_PATH}
                stroke={colors.surface}
                strokeWidth={2.5}
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeDasharray={TICK_LENGTH}
                animatedProps={tickProps}
              />
            </Svg>
          ) : (
            <Icon name={icon} size={ICON_SIZE} color={colors.surface} />
          )}
        </Animated.View>
        <Animated.View style={[styles.center, titleStyle]}>
          <StaffText role="moment" align="center" accessibilityRole="header" accessibilityLiveRegion={live ? 'polite' : undefined}>
            {title}
          </StaffText>
        </Animated.View>
        <Animated.View style={[styles.center, restStyle]}>
          {subtitle !== undefined && subtitle !== null ? (
            typeof subtitle === 'string' ? (
              <StaffText role="body" color="muted" align="center">
                {subtitle}
              </StaffText>
            ) : (
              subtitle
            )
          ) : null}
          {pill ? (
            <View style={styles.pillWrap}>
              <Pill {...pill} />
            </View>
          ) : null}
          {facts.length > 0 ? (
            <View style={styles.facts}>
              {facts.map((fact, index) => (
                <View
                  key={`${fact.label}-${index}`}
                  style={[styles.fact, index > 0 ? styles.factDivider : null, { flexDirection: isRTL ? 'row-reverse' : 'row' }]}
                >
                  <StaffText role="body" color="muted">
                    {fact.label}
                  </StaffText>
                  <View style={styles.factValue}>
                    {fact.valueNode ?? (
                      <StaffText role="rowTitle" align="end" translate={false}>
                        {isolate(fact.value)}
                      </StaffText>
                    )}
                  </View>
                </View>
              ))}
            </View>
          ) : null}
        </Animated.View>
      </View>
      {action ? <View style={styles.dock}>{action}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.canvas },
  content: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 26, paddingVertical: 24, gap: 8 },
  badge: {
    width: space.badgeOkSize,
    height: space.badgeOkSize,
    borderRadius: radius.badgeOkRadius,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 14,
  },
  center: { alignSelf: 'stretch', alignItems: 'center', gap: 8 },
  pillWrap: { alignItems: 'center' },
  facts: {
    alignSelf: 'stretch',
    marginTop: 20,
    backgroundColor: colors.surface,
    borderRadius: radius.cardRadius,
    paddingHorizontal: 16,
    paddingVertical: 4,
  },
  fact: { alignItems: 'center', justifyContent: 'space-between', gap: 16, minHeight: 48, paddingVertical: 12 },
  factDivider: { borderTopWidth: 1, borderTopColor: colors.line },
  factValue: { flexShrink: 1 },
  dock: {
    paddingTop: space.dockPadTop,
    paddingHorizontal: space.dockPadSide,
    paddingBottom: space.dockPadBottom,
  },
});
