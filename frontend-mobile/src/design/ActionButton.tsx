import * as React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { Easing, useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { Icon, type LucideIconName } from '../components/ui/icon';
import { useLanguage } from '../i18n/LanguageProvider';
import { StaffText } from './StaffText';
import { colors, motion, radius, space, type ColorToken } from './tokens';

export type ActionKind = 'next' | 'form' | 'outline' | 'ghost' | 'danger';

export interface ActionButtonProps {
  kind: ActionKind;
  /** English key, translated. */
  label: string;
  icon?: LucideIconName;
  onPress: () => void;
  busy?: boolean;
  /** Defaults to the translated label. */
  accessibilityLabel?: string;
  /** Light impact on press. Defaults to true for `next`. */
  haptic?: boolean;
}

interface KindStyle {
  fill: ColorToken | null;
  pressedFill: ColorToken | null;
  label: ColorToken;
  height: number;
  border: boolean;
}

const kinds: Record<ActionKind, KindStyle> = {
  next: { fill: 'yellow', pressedFill: 'yellowPress', label: 'ink', height: space.actionHeight, border: false },
  form: { fill: 'blue', pressedFill: 'blueDeep', label: 'surface', height: space.actionHeight, border: false },
  outline: { fill: 'surface', pressedFill: 'soft', label: 'ink', height: space.actionHeight, border: true },
  ghost: { fill: null, pressedFill: 'soft', label: 'blueDeep', height: space.ghostHeight, border: false },
  danger: { fill: 'bad', pressedFill: 'badDeep', label: 'surface', height: space.actionHeight, border: false },
};

/** The big action and its siblings. There is no disabled state: an unavailable action is shown as `DockStatus`. */
export function ActionButton({ kind, label, icon, onPress, busy = false, accessibilityLabel, haptic }: ActionButtonProps) {
  const { t, isRTL } = useLanguage();
  const reduced = useReducedMotion();
  const scale = useSharedValue(1);
  const [pressed, setPressed] = React.useState(false);
  const spec = kinds[kind];
  const useHaptic = haptic ?? kind === 'next';
  const labelRole = kind === 'ghost' ? 'groupTitle' : 'action';

  const animated = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  const animateTo = (to: number) => {
    if (reduced) return;
    scale.value = withTiming(to, { duration: motion.duration.press, easing: Easing.bezier(...motion.easing.easeOut) });
  };

  const handlePress = () => {
    if (busy) return;
    if (useHaptic) void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onPress();
  };

  const fill = pressed && spec.pressedFill ? spec.pressedFill : spec.fill;
  const iconColor = colors[spec.label];

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? t(label)}
      accessibilityState={{ busy }}
      onPress={handlePress}
      onPressIn={() => { setPressed(true); if (!busy) animateTo(motion.scale.press); }}
      onPressOut={() => { setPressed(false); animateTo(1); }}
    >
      <Animated.View
        style={[
          styles.base,
          { height: spec.height, flexDirection: isRTL ? 'row-reverse' : 'row', opacity: busy ? 0.75 : 1 },
          fill ? { backgroundColor: colors[fill] } : null,
          spec.border ? styles.border : null,
          animated,
        ]}
      >
        {busy ? (
          <ActivityIndicator color={iconColor} size="small" />
        ) : icon ? (
          <Icon name={icon} size={kind === 'ghost' ? 20 : 24} color={iconColor} />
        ) : null}
        <View style={styles.labelBox}>
          <StaffText role={labelRole} color={spec.label} align="center">
            {label}
          </StaffText>
        </View>
      </Animated.View>
    </Pressable>
  );
}

export interface ActionDockProps {
  /** English key shown above the button. */
  hint?: string;
  /** Add the bottom safe-area inset (screens without a tab bar). */
  withSafeArea?: boolean;
  children?: React.ReactNode;
}

/** White bottom area that holds the one action of a screen. */
export function ActionDock({ hint, withSafeArea = false, children }: ActionDockProps) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.dock, { paddingBottom: space.dockPadBottom + (withSafeArea ? insets.bottom : 0) }]}>
      {hint ? (
        <View style={styles.hint}>
          <StaffText role="meta" color="muted" align="center">
            {hint}
          </StaffText>
        </View>
      ) : null}
      {children}
    </View>
  );
}

export interface DockStatusProps {
  label: string;
  icon?: LucideIconName;
  /** Only when the status truly has a shortcut; leave out otherwise. */
  onPress?: () => void;
}

/** Non-pressable status that stands in the dock when no action is available. */
export function DockStatus({ label, icon, onPress }: DockStatusProps) {
  const { isRTL } = useLanguage();
  const body = (
    <View
      accessibilityRole="text"
      accessibilityLiveRegion="polite"
      style={[styles.base, styles.status, { flexDirection: isRTL ? 'row-reverse' : 'row' }]}
    >
      {icon ? <Icon name={icon} size={22} color={colors.muted} /> : null}
      <View style={styles.labelBox}>
        <StaffText role="groupTitle" color="muted" align="center">
          {label}
        </StaffText>
      </View>
    </View>
  );
  if (!onPress) return body;
  return (
    <Pressable accessibilityRole="button" onPress={onPress}>
      {body}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    width: '100%',
    minHeight: space.ghostHeight,
    borderRadius: radius.actionRadius,
    paddingHorizontal: 16,
  },
  border: { borderWidth: 1.5, borderColor: colors.lineStrong },
  status: { minHeight: space.actionHeight, backgroundColor: colors.canvas },
  labelBox: { flexShrink: 1 },
  dock: {
    backgroundColor: colors.surface,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.line,
    paddingTop: space.dockPadTop,
    paddingHorizontal: space.dockPadSide,
  },
  hint: { marginBottom: 8 },
});
