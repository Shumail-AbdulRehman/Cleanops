import * as React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useLanguage } from '../i18n/LanguageProvider';
import { StaffText } from './StaffText';
import { colors, radius, space } from './tokens';

export interface SegmentOption<V extends string = string> {
  value: V;
  /** English key (translated) or a fixed label with `translate: false`. */
  label: string;
  translate?: boolean;
}

export interface SegmentedControlProps<V extends string = string> {
  options: ReadonlyArray<SegmentOption<V>>;
  value: V;
  onChange: (value: V) => void;
  accessibilityLabel: string;
  /** 'fill' (default): equal segments share the track. 'content': each segment sizes to its label. */
  fit?: 'fill' | 'content';
}

/** Segments (equal-width by default, or content-width) never truncate and are at least the touch minimum in a `segmentTrack`; the selected one is a raised white thumb. Order reverses in Urdu. */
export function SegmentedControl<V extends string = string>({ options, value, onChange, accessibilityLabel, fit = 'fill' }: SegmentedControlProps<V>) {
  const { isRTL, t } = useLanguage();
  return (
    <View
      accessibilityRole="tablist"
      accessibilityLabel={t(accessibilityLabel)}
      style={[styles.track, fit === 'content' ? styles.trackContent : null, { flexDirection: isRTL ? 'row-reverse' : 'row' }]}
    >
      {options.map(option => {
        const selected = option.value === value;
        const translate = option.translate !== false;
        return (
          <Pressable
            key={option.value}
            accessibilityRole="tab"
            accessibilityLabel={translate ? t(option.label) : option.label}
            accessibilityState={{ selected }}
            onPress={() => onChange(option.value)}
            style={[styles.segment, fit === 'content' ? styles.segmentContent : styles.segmentFill, selected ? styles.selected : null]}
          >
            <StaffText role="label" color={selected ? 'ink' : 'muted'} align="center" translate={translate}>
              {option.label}
            </StaffText>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  track: { backgroundColor: colors.segmentTrack, borderRadius: radius.segmentTrackRadius, padding: space.segmentTrackPad },
  segment: {
    minWidth: space.touchMin,
    height: space.segmentHeight,
    borderRadius: radius.segmentThumbRadius,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 8,
  },
  trackContent: { flexShrink: 0 },
  segmentFill: { flex: 1 },
  segmentContent: { flexGrow: 0, flexShrink: 0 },
  selected: {
    backgroundColor: colors.surface,
    shadowColor: colors.ink,
    shadowOpacity: 0.12,
    shadowRadius: 2,
    shadowOffset: { width: 0, height: 1 },
    elevation: 1,
  },
});
