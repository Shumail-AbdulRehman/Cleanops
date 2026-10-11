import * as React from 'react';
import { AccessibilityInfo, Modal, Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { Easing, useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { Icon, type LucideIconName } from '../components/ui/icon';
import { useLanguage } from '../i18n/LanguageProvider';
import { StaffText } from './StaffText';
import { colors, gutterFor, motion, radius, type ColorToken } from './tokens';

export type SheetGlyphTone = 'needsYou' | 'red' | 'blue' | 'green';

export interface BottomSheetProps {
  visible: boolean;
  /** Called by Android back, the scrim and the screen-reader escape gesture. Leave out for a decision the person must make. */
  onDismiss?: () => void;
  /** Lucide icon shown in the tile beside the title. */
  glyph?: LucideIconName;
  glyphTone?: SheetGlyphTone;
  /** English key (translated) or a prepared node. */
  title: React.ReactNode;
  /** English key (translated, muted) or a prepared node. */
  body?: React.ReactNode;
  /** `ActionButton` elements, stacked. */
  actions?: React.ReactNode;
  /** Custom content between the heading and the actions (the attendance day sheet). */
  children?: React.ReactNode;
  /** `warning` fires one warning notification haptic when the sheet opens. */
  haptic?: 'warning';
}

const glyphTones: Record<SheetGlyphTone, { fill: ColorToken; icon: ColorToken }> = {
  needsYou: { fill: 'yellowWash', icon: 'yellowInk' },
  red: { fill: 'badWash', icon: 'bad' },
  blue: { fill: 'blueWash', icon: 'blueDeep' },
  green: { fill: 'okWash', icon: 'ok' },
};

const scrimEasing = Easing.out(Easing.ease);

/** Moves screen-reader focus to the heading once the opening motion has settled. */
export function useFocusOnOpen(visible: boolean, delay: number) {
  const ref = React.useRef<View>(null);
  React.useEffect(() => {
    if (!visible) return undefined;
    const timer = setTimeout(() => {
      const node = ref.current;
      if (node && typeof AccessibilityInfo.sendAccessibilityEvent === 'function') {
        AccessibilityInfo.sendAccessibilityEvent(node, 'focus');
      }
    }, delay);
    return () => clearTimeout(timer);
  }, [visible, delay]);
  return ref;
}

/** The one bottom sheet for problems and choices. Opens over the scrim; renders nothing while hidden. */
export function BottomSheet({
  visible,
  onDismiss,
  glyph,
  glyphTone = 'needsYou',
  title,
  body,
  actions,
  children,
  haptic,
}: BottomSheetProps) {
  const { isRTL } = useLanguage();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const reduced = useReducedMotion();

  const offscreen = reduced ? 0 : height;
  const scrimOpacity = useSharedValue(0);
  const sheetY = useSharedValue(offscreen);
  const sheetOpacity = useSharedValue(reduced ? 0 : 1);

  React.useEffect(() => {
    if (!visible) {
      scrimOpacity.value = 0;
      sheetY.value = offscreen;
      sheetOpacity.value = reduced ? 0 : 1;
      return;
    }
    scrimOpacity.value = withTiming(1, { duration: motion.duration.scrim, easing: scrimEasing });
    if (reduced) {
      sheetY.value = 0;
      sheetOpacity.value = withTiming(1, { duration: motion.duration.reducedFade, easing: scrimEasing });
    } else {
      sheetOpacity.value = 1;
      sheetY.value = withTiming(0, { duration: motion.duration.sheet, easing: Easing.bezier(...motion.easing.drawer) });
    }
    // Runs once per opening; the window height is read at that moment.
  }, [visible, reduced]);

  React.useEffect(() => {
    if (visible && haptic === 'warning') {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    }
    // Fires on opening only, not on re-renders while open.
  }, [visible]);

  const titleRef = useFocusOnOpen(visible, reduced ? motion.duration.reducedFade : motion.duration.sheet);

  const scrimStyle = useAnimatedStyle(() => ({ opacity: scrimOpacity.value }));
  const sheetStyle = useAnimatedStyle(() => ({
    opacity: sheetOpacity.value,
    transform: [{ translateY: sheetY.value }],
  }));

  if (!visible) return null;

  const tone = glyphTones[glyphTone];
  const dismiss = onDismiss ?? (() => {});
  const row = isRTL ? 'row-reverse' : 'row';
  const actionList = actions ? React.Children.toArray(actions) : [];

  return (
    <Modal
      visible
      transparent
      animationType="none"
      statusBarTranslucent
      navigationBarTranslucent
      onRequestClose={dismiss}
    >
      <View style={styles.root}>
        <Animated.View style={[StyleSheet.absoluteFill, styles.scrim, scrimStyle]}>
          {onDismiss ? (
            <Pressable
              style={StyleSheet.absoluteFill}
              onPress={onDismiss}
              accessible={false}
              importantForAccessibility="no"
            />
          ) : null}
        </Animated.View>
        <Animated.View
          accessibilityViewIsModal
          onAccessibilityEscape={onDismiss}
          style={[
            styles.sheet,
            { paddingHorizontal: gutterFor(width), paddingBottom: Math.max(26, insets.bottom + 16) },
            sheetStyle,
          ]}
        >
          <View style={styles.grab} />
          <View style={[styles.head, { flexDirection: row }]}>
            {glyph ? (
              <View style={[styles.glyph, { backgroundColor: colors[tone.fill] }]} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
                <Icon name={glyph} size={26} color={colors[tone.icon]} />
              </View>
            ) : null}
            <View style={styles.headText}>
              <View ref={titleRef} accessible accessibilityRole="header">
                {typeof title === 'string' ? <StaffText role="sheetTitle">{title}</StaffText> : title}
              </View>
              {body != null && body !== false ? (
                <View style={styles.body}>
                  {typeof body === 'string' ? <StaffText role="body" color="muted">{body}</StaffText> : body}
                </View>
              ) : null}
            </View>
          </View>
          {children}
          {actionList.length > 0 ? <View style={styles.actions}>{actionList}</View> : null}
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: 'flex-end' },
  scrim: { backgroundColor: colors.scrim },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.sheetRadius,
    borderTopRightRadius: radius.sheetRadius,
    paddingTop: 10,
  },
  grab: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.lineStrong,
    marginBottom: 16,
  },
  head: { alignItems: 'flex-start', gap: 14, marginBottom: 10 },
  glyph: {
    width: 50,
    height: 50,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headText: { flex: 1 },
  body: { marginTop: 3 },
  actions: { gap: 8, marginTop: 16 },
});
