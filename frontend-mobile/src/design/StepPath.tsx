import * as React from 'react';
import { StyleSheet, View } from 'react-native';
import { Icon } from '../components/ui/icon';
import { useLanguage } from '../i18n/LanguageProvider';
import { StaffText } from './StaffText';
import { colors, space } from './tokens';

export const stepPathSteps = ['Scan QR', 'Clean', 'Photos', 'Submit'] as const;

export interface StepPathProps {
  /** 1 to 4: the step the person is on. Earlier steps are done. */
  current: 1 | 2 | 3 | 4;
  /** Every step is done (the work is submitted). */
  allDone?: boolean;
}

const CIRCLE = space.markerSize;
const LINE = 2;

/** Four numbered steps joined by a line: done blue with a tick, current yellow, later on canvas. Mirrors in Urdu. */
export function StepPath({ current, allDone = false }: StepPathProps) {
  const { isRTL, t } = useLanguage();
  return (
    <View style={[styles.row, { flexDirection: isRTL ? 'row-reverse' : 'row' }]} accessibilityRole="list">
      {stepPathSteps.map((label, index) => {
        const number = index + 1;
        const done = allDone || number < current;
        const isCurrent = !allDone && number === current;
        const circle = done ? colors.blue : isCurrent ? colors.yellow : colors.canvas;
        const joined = done || isCurrent;
        const state = done ? 'done' : isCurrent ? 'current' : 'later';
        return (
          <View
            key={label}
            style={styles.step}
            testID={`step-${number}-${state}`}
            accessible
            accessibilityLabel={t(label)}
            accessibilityState={{ selected: isCurrent }}
          >
            {index > 0 ? (
              <View
                testID={`step-line-${number}`}
                style={[
                  styles.line,
                  isRTL ? { left: '50%', right: '-50%' } : { left: '-50%', right: '50%' },
                  { backgroundColor: joined ? colors.blue : colors.line },
                ]}
              />
            ) : null}
            <View testID={`step-circle-${number}`} style={[styles.circle, { backgroundColor: circle }]}>
              {done ? (
                <Icon name="Check" size={18} color={colors.surface} />
              ) : (
                <StaffText role="label" color="ink" translate={false}>{String(number)}</StaffText>
              )}
            </View>
            <StaffText role="label" color={done || isCurrent ? 'ink' : 'muted'} align="center">{label}</StaffText>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { paddingTop: 18, paddingBottom: 4 },
  step: { flex: 1, alignItems: 'center', gap: 6 },
  circle: { width: CIRCLE, height: CIRCLE, borderRadius: CIRCLE / 2, alignItems: 'center', justifyContent: 'center', position: 'relative', zIndex: 1 },
  /* Spans from the edge of the previous circle to the edge of this one, so it never crosses a digit. */
  line: { position: 'absolute', zIndex: 0, top: CIRCLE / 2 - LINE / 2, marginHorizontal: CIRCLE / 2, height: LINE },
});
