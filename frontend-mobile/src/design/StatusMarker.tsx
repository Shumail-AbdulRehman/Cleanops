import * as React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Icon, type LucideIconName } from '../components/ui/icon';
import { NativeFontsReady, fontFor } from '../fonts';
import { useLanguage } from '../i18n/LanguageProvider';
import { StaffText } from './StaffText';
import type { MarkerShape, MarkerTone } from './taskState';
import { colors, space, type ColorToken } from './tokens';

export interface StatusMarkerProps {
  /** From `displayFor` (taskState.ts). */
  marker: MarkerShape;
  tone: MarkerTone;
  /** Place in the day, shown by a `position` marker. */
  position?: number;
  /** English key read by screen readers when no pill is shown. */
  hiddenLabel?: string;
}

const icons: Readonly<Record<Exclude<MarkerShape, 'position'>, LucideIconName>> = Object.freeze({
  droplet: 'Droplets',
  camera: 'Camera',
  clock: 'Clock',
  tick: 'Check',
  doubleTick: 'CheckCheck',
  cross: 'X',
});

/** Glyph colour on each marker fill. */
export const markerGlyph: Readonly<Record<MarkerTone, ColorToken>> = Object.freeze({
  canvas: 'muted',
  blueWash: 'blue',
  yellow: 'ink',
  blue: 'surface',
  ok: 'surface',
  badWash: 'bad',
});

const ICON_SIZE = 18;

/** Round task marker. Never square, never an empty outline, so it cannot look like a checkbox. */
export function StatusMarker({ marker, tone, position, hiddenLabel }: StatusMarkerProps) {
  const { t } = useLanguage();
  const fontsReady = React.useContext(NativeFontsReady);
  const glyph = colors[markerGlyph[tone]];
  return (
    <View style={styles.holder}>
      <View
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={[styles.marker, { backgroundColor: colors[tone] }]}
      >
        {marker === 'position' ? (
          <Text
            style={{
              fontFamily: fontFor('bodyBold', 'en', fontsReady),
              fontWeight: fontsReady ? 'normal' : '700',
              fontSize: 15,
              lineHeight: 18,
              color: glyph,
              fontVariant: ['tabular-nums'],
            }}
          >
            {position === undefined ? '' : String(position)}
          </Text>
        ) : (
          <Icon name={icons[marker]} size={ICON_SIZE} color={glyph} />
        )}
      </View>
      {hiddenLabel ? (
        <View style={styles.hidden}>
          <StaffText role="meta" color="ink" numberOfLines={1}>
            {t(hiddenLabel)}
          </StaffText>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  holder: { width: space.markerSize, height: space.markerSize },
  marker: {
    width: space.markerSize,
    height: space.markerSize,
    borderRadius: space.markerSize / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  hidden: { position: 'absolute', width: 1, height: 1, overflow: 'hidden', opacity: 0.01 },
});
