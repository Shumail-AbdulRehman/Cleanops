import * as React from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useReducedMotion, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';
import { Icon, type LucideIconName } from '../components/ui/icon';
import { useLanguage } from '../i18n/LanguageProvider';
import { StaffText } from './StaffText';
import { colors, radius, type ColorToken } from './tokens';

export type PillToneName = 'neutral' | 'blue' | 'green' | 'needsYou' | 'needsYouSoft' | 'red' | 'late' | 'warn';

export interface PillProps {
  tone: PillToneName;
  /** English key, translated. */
  label: string;
  icon?: LucideIconName;
  /** Rotates the icon (for "Saved, uploading"). Static under reduced motion. */
  spinning?: boolean;
}

interface ToneStyle {
  fill: ColorToken;
  text: ColorToken;
  outline: boolean;
}

export const pillTones: Readonly<Record<PillToneName, ToneStyle>> = Object.freeze({
  neutral: { fill: 'canvas', text: 'pillText', outline: false },
  blue: { fill: 'blueWash', text: 'blueDeep', outline: false },
  green: { fill: 'okWash', text: 'ok', outline: false },
  needsYou: { fill: 'yellow', text: 'ink', outline: false },
  needsYouSoft: { fill: 'yellowWash', text: 'yellowInk', outline: false },
  red: { fill: 'badWash', text: 'bad', outline: false },
  late: { fill: 'late', text: 'ink', outline: false },
  warn: { fill: 'warnWash', text: 'warn', outline: true },
});

const ICON_SIZE = 14;
const OUTLINE = 1.5;
const SPIN_MS = 1000;

function SpinningIcon({ name, color }: { name: LucideIconName; color: string }) {
  const reduced = useReducedMotion();
  const turn = useSharedValue(0);
  React.useEffect(() => {
    if (reduced) {
      turn.value = 0;
      return;
    }
    turn.value = withRepeat(withTiming(360, { duration: SPIN_MS, easing: Easing.linear }), -1, false);
  }, [reduced, turn]);
  const animated = useAnimatedStyle(() => ({ transform: [{ rotate: `${turn.value}deg` }] }));
  return (
    <Animated.View style={animated}>
      <Icon name={name} size={ICON_SIZE} color={color} />
    </Animated.View>
  );
}

/** A small status pill. One line; it never wraps. */
export function Pill({ tone, label, icon, spinning = false }: PillProps) {
  const { isRTL, language } = useLanguage();
  const spec = pillTones[tone];
  return (
    <View
      style={[
        styles.pill,
        {
          backgroundColor: colors[spec.fill],
          flexDirection: isRTL ? 'row-reverse' : 'row',
          paddingVertical: spec.outline ? 3 - OUTLINE : 3,
          paddingHorizontal: (language === 'ur' ? 9 : 10) - (spec.outline ? OUTLINE : 0),
        },
        spec.outline ? { borderWidth: OUTLINE, borderColor: colors.warn } : null,
      ]}
    >
      {icon ? (
        spinning ? <SpinningIcon name={icon} color={colors[spec.text]} /> : <Icon name={icon} size={ICON_SIZE} color={colors[spec.text]} />
      ) : null}
      <StaffText role="label" color={spec.text} numberOfLines={1}>
        {label}
      </StaffText>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    flexShrink: 1,
    gap: 5,
    borderRadius: radius.pillRadius,
  },
});
