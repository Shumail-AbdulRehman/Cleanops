import * as React from 'react';
import { Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';
import { Icon } from '../components/ui/icon';
import { useLanguage } from '../i18n/LanguageProvider';
import { timeRange } from './format';
import { Pill } from './Pill';
import { isolate, NameLine, StaffText } from './StaffText';
import { StatusMarker } from './StatusMarker';
import { displayFor, type TaskDisplayKind } from './taskState';
import { colors, gutterFor, isNarrow, space } from './tokens';

export interface TaskRowProps {
  /** Entered area name. Never translated. */
  name: string;
  /** From `taskDisplay` or `historyDisplay`. */
  kind: TaskDisplayKind;
  /** Place in the day, shown by a not-started marker. */
  position?: number;
  start: string | Date;
  end: string | Date;
  timeZone?: string;
  onPress: () => void;
  /** My day after check-in: a shorter row. */
  compact?: boolean;
  /** Draw the hairline above the row. Pass false for the first row of a group. */
  separator?: boolean;
}

/** One task in a list: round marker, area name, status pill and time, then an arrow. */
export function TaskRow({ name, kind, position, start, end, timeZone, onPress, compact = false, separator = true }: TaskRowProps) {
  const { t, isRTL } = useLanguage();
  const { width } = useWindowDimensions();
  const [pressed, setPressed] = React.useState(false);
  const narrow = isNarrow(width);
  const gutter = gutterFor(width);
  const gap = narrow ? space.rowGapNarrow : space.rowGap;
  const display = displayFor(kind);
  const time = timeRange(start, end, timeZone);
  const status = t(display.pillLabel ?? display.hiddenLabel ?? '');
  const inset = gutter + space.markerSize + gap;
  const label = [name, status, time].filter(Boolean).join(', ');

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      onPressIn={() => setPressed(true)}
      onPressOut={() => setPressed(false)}
      style={{ backgroundColor: pressed ? colors.soft : colors.surface }}
    >
      {separator ? (
        <View
          style={[
            styles.separator,
            isRTL ? { right: inset } : { left: inset },
            { backgroundColor: colors.line },
          ]}
        />
      ) : null}
      <View
        style={{
          minHeight: compact ? space.rowMinHeightCompact : space.rowMinHeight,
          paddingVertical: compact ? space.rowPadVCompact : space.rowPadV,
          paddingHorizontal: gutter,
          gap,
          flexDirection: isRTL ? 'row-reverse' : 'row',
          alignItems: 'center',
        }}
      >
        <StatusMarker marker={display.marker} tone={display.markerTone} position={position} />
        <View style={styles.column}>
          <NameLine role="rowTitle" name={name} numberOfLines={2} />
          <View style={[styles.meta, { flexDirection: isRTL ? 'row-reverse' : 'row' }]}>
            {display.pillLabel ? <Pill tone={display.pillTone} label={display.pillLabel} /> : null}
            <StaffText role="meta" color="muted" translate={false} numberOfLines={1}>
              {isolate(time)}
            </StaffText>
          </View>
        </View>
        {narrow ? null : <Icon name={isRTL ? 'ChevronLeft' : 'ChevronRight'} size={20} color={colors.subtle} />}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  separator: { position: 'absolute', top: 0, left: 0, right: 0, height: StyleSheet.hairlineWidth },
  column: { flex: 1, gap: 4 },
  meta: { flexWrap: 'wrap', alignItems: 'center', columnGap: 8, rowGap: 2 },
});
