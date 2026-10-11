import * as React from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from 'react-native-reanimated';
import { useLanguage } from '../i18n/LanguageProvider';
import { useFocusOnOpen } from './BottomSheet';
import { StaffText } from './StaffText';
import { colors, motion, radius, type ColorToken } from './tokens';

export interface ConfirmDialogProps {
  visible: boolean;
  /** English key. */
  title: string;
  /** English key. */
  body?: string;
  /** English key. */
  confirmLabel: string;
  /** English key. Defaults to "Cancel". */
  cancelLabel?: string;
  /** Shows the confirm button in `bad`. */
  destructive?: boolean;
  onConfirm: () => void;
  /** Also called by Android back. */
  onCancel: () => void;
}

const fadeEasing = Easing.out(Easing.ease);
const START_SCALE = 0.96;

function TextButton({ label, color, onPress }: { label: string; color: ColorToken; onPress: () => void }) {
  const { t } = useLanguage();
  // Pressed wash in state: Android drops a `Pressable` style callback (spec 67).
  const [pressed, setPressed] = React.useState(false);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t(label)}
      onPress={onPress}
      onPressIn={() => setPressed(true)}
      onPressOut={() => setPressed(false)}
      style={[styles.button, pressed ? styles.buttonPressed : null]}
    >
      <StaffText role="groupTitle" color={color} align="center" numberOfLines={2}>
        {label}
      </StaffText>
    </Pressable>
  );
}

/** Small centred confirmation, used only for sign out. Renders nothing while hidden. */
export function ConfirmDialog({
  visible,
  title,
  body,
  confirmLabel,
  cancelLabel = 'Cancel',
  destructive = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const { isRTL } = useLanguage();
  const reduced = useReducedMotion();
  const scrimOpacity = useSharedValue(0);
  const cardOpacity = useSharedValue(0);
  const cardScale = useSharedValue(reduced ? 1 : START_SCALE);

  React.useEffect(() => {
    if (!visible) {
      scrimOpacity.value = 0;
      cardOpacity.value = 0;
      cardScale.value = reduced ? 1 : START_SCALE;
      return;
    }
    scrimOpacity.value = withTiming(1, { duration: motion.duration.scrim, easing: fadeEasing });
    if (reduced) {
      cardScale.value = 1;
      cardOpacity.value = withTiming(1, { duration: motion.duration.reducedFade, easing: fadeEasing });
    } else {
      const timing = { duration: motion.duration.dialog, easing: Easing.bezier(...motion.easing.easeOut) };
      cardOpacity.value = withTiming(1, timing);
      cardScale.value = withTiming(1, timing);
    }
  }, [visible, reduced]);

  const titleRef = useFocusOnOpen(visible, reduced ? motion.duration.reducedFade : motion.duration.dialog);
  const scrimStyle = useAnimatedStyle(() => ({ opacity: scrimOpacity.value }));
  const cardStyle = useAnimatedStyle(() => ({ opacity: cardOpacity.value, transform: [{ scale: cardScale.value }] }));

  if (!visible) return null;

  return (
    <Modal visible transparent animationType="none" statusBarTranslucent navigationBarTranslucent onRequestClose={onCancel}>
      <View style={styles.root}>
        <Animated.View style={[StyleSheet.absoluteFill, styles.scrim, scrimStyle]} />
        <Animated.View accessibilityViewIsModal onAccessibilityEscape={onCancel} style={[styles.card, cardStyle]}>
          <View ref={titleRef} accessible accessibilityRole="header">
            <StaffText role="sheetTitle">{title}</StaffText>
          </View>
          {body ? (
            <StaffText role="body" color="muted" style={styles.body}>
              {body}
            </StaffText>
          ) : null}
          <View style={[styles.actions, { flexDirection: isRTL ? 'row-reverse' : 'row' }]}>
            <TextButton label={cancelLabel} color="blueDeep" onPress={onCancel} />
            <TextButton label={confirmLabel} color={destructive ? 'bad' : 'blueDeep'} onPress={onConfirm} />
          </View>
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 28 },
  scrim: { backgroundColor: colors.scrim },
  card: {
    width: '100%',
    backgroundColor: colors.surface,
    borderRadius: radius.sheetRadius,
    padding: 22,
  },
  body: { marginTop: 6 },
  actions: { justifyContent: 'flex-end', flexWrap: 'wrap', gap: 8, marginTop: 18 },
  button: {
    minHeight: 48,
    minWidth: 48,
    paddingHorizontal: 16,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonPressed: { backgroundColor: colors.soft },
});
