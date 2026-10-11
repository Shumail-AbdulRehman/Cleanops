import * as React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { NativeFontsReady, fontFor } from '../fonts';
import { useLanguage } from '../i18n/LanguageProvider';
import { SegmentedControl } from './SegmentedControl';
import { colors, radius, space, whiteAlpha } from './tokens';

export interface LanguageToggleProps {
  appearance: 'onBlue' | 'onWhite';
}

type Choice = 'en' | 'ur';

const LABEL = 'Language / زبان';
const choices: ReadonlyArray<{ value: Choice; label: string }> = [
  { value: 'en', label: 'English' },
  { value: 'ur', label: 'اردو' },
];

/** English and اردو, each always in its own script and face, never translated. */
export function LanguageToggle({ appearance }: LanguageToggleProps) {
  const { language, setLanguage, isRTL } = useLanguage();
  const fontsReady = React.useContext(NativeFontsReady);

  if (appearance === 'onWhite') {
    return (
      <SegmentedControl<Choice>
        options={choices.map(c => ({ ...c, translate: false }))}
        value={language}
        onChange={setLanguage}
        accessibilityLabel={LABEL}
        fit="content"
      />
    );
  }

  return (
    <View
      accessibilityRole="tablist"
      accessibilityLabel={LABEL}
      style={[styles.track, { flexDirection: isRTL ? 'row-reverse' : 'row' }]}
    >
      {choices.map(c => {
        const selected = language === c.value;
        return (
          <Pressable
            key={c.value}
            accessibilityRole="tab"
            accessibilityLabel={c.label}
            accessibilityState={{ selected }}
            onPress={() => setLanguage(c.value)}
            style={[styles.segment, selected ? styles.active : null]}
          >
            <Text
              numberOfLines={1}
              maxFontSizeMultiplier={1.4}
              style={[
                styles.text,
                {
                  color: selected ? colors.blueDeep : colors.surface,
                  fontFamily: c.value === 'ur' ? fontFor('urduBold', 'ur', fontsReady) : fontFor('bodySemi', 'en', fontsReady),
                  writingDirection: c.value === 'ur' ? 'rtl' : 'ltr',
                },
              ]}
            >
              {c.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  // Translucent white track, 16 percent (v3 `.langpill`).
  track: { backgroundColor: whiteAlpha.track, borderRadius: radius.pillRadius, padding: 3 },
  segment: {
    height: 42,
    minWidth: space.touchMin,
    paddingHorizontal: 10,
    borderRadius: radius.pillRadius,
    alignItems: 'center',
    justifyContent: 'center',
  },
  active: { backgroundColor: colors.surface },
  text: { fontSize: 14, lineHeight: 24, textAlign: 'center' },
});
