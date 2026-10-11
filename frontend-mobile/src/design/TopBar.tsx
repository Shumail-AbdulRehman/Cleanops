import * as React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Icon } from '../components/ui/icon';
import { useLanguage } from '../i18n/LanguageProvider';
import { StaffText } from './StaffText';
import { colors, space } from './tokens';

export interface TopBarProps {
  /** English key, or an entered name with `translateTitle={false}`. */
  title: string;
  translateTitle?: boolean;
  onBack: () => void;
  /** English key, translated. */
  backLabel?: string;
  trailing?: React.ReactNode;
  /** Adds the top safe-area inset above the bar. */
  withSafeArea?: boolean;
}

const BAR_HEIGHT = 56;

/** Back button and one-line title shared by every pushed screen. */
export function TopBar({ title, translateTitle = true, onBack, backLabel = 'Back', trailing, withSafeArea = false }: TopBarProps) {
  const { isRTL, t } = useLanguage();
  const insets = useSafeAreaInsets();
  return (
    <View
      style={[
        styles.bar,
        { flexDirection: isRTL ? 'row-reverse' : 'row', paddingTop: withSafeArea ? insets.top : 0, height: BAR_HEIGHT + (withSafeArea ? insets.top : 0) },
      ]}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t(backLabel)}
        onPress={onBack}
        hitSlop={4}
        style={styles.back}
      >
        <View testID="top-bar-back-icon" style={isRTL ? styles.mirror : null}>
          <Icon name="ArrowLeft" size={24} color={colors.ink} />
        </View>
      </Pressable>
      <View style={styles.title}>
        <StaffText role="barTitle" numberOfLines={1} translate={translateTitle} accessibilityRole="header">
          {title}
        </StaffText>
      </View>
      {trailing ?? null}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { alignItems: 'center', gap: 6, paddingHorizontal: 8, backgroundColor: colors.surface },
  back: { width: space.touchMinIcon, height: space.touchMinIcon, borderRadius: space.touchMinIcon / 2, alignItems: 'center', justifyContent: 'center' },
  mirror: { transform: [{ scaleX: -1 }] },
  title: { flex: 1, minWidth: 0 },
});
