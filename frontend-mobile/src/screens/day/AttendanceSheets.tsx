import * as React from 'react';
import { Linking, StyleSheet, View } from 'react-native';
import { ActionButton } from '../../design/ActionButton';
import { BottomSheet, type SheetGlyphTone } from '../../design/BottomSheet';
import { NameLine, StaffText, isolate } from '../../design/StaffText';
import { useLanguage } from '../../i18n/LanguageProvider';
import type { LucideIconName } from '../../components/ui/icon';
import type { AttendanceActionMode, AttendanceActionPhase } from './useAttendanceAction';

export interface AttendanceSheetsProps {
  /** The hook's fields (spread `useAttendanceAction()` in, then add `place`). */
  phase: AttendanceActionPhase;
  mode: AttendanceActionMode | null;
  /** English key or the server's own message; translated here. */
  error: string | null;
  accuracyMeters: number | null;
  /** The assigned location's entered name, or null. Never translated. */
  place: string | null;
  start: (mode: AttendanceActionMode) => unknown;
  retryLocation: () => unknown;
  continueAnyway: () => unknown;
  cancel: () => unknown;
}

interface SheetContent {
  glyph: LucideIconName;
  tone: SheetGlyphTone;
  title: React.ReactNode;
  body: React.ReactNode;
  actions: React.ReactNode[];
}

/** Server messages for an outside-location rejection repeat the sheet's own wording; anything else is extra detail. */
function addsDetail(message: string | null): message is string {
  return !!message && !/not at (your )?(assigned )?location/i.test(message);
}

/**
 * The problem sheets of check-in and check-out, chosen by the hook's phase.
 * Every sheet here dismisses to My day (`cancel`); none leaves a spinner behind.
 */
export function AttendanceSheets({
  phase,
  mode,
  error,
  accuracyMeters,
  place,
  start,
  retryLocation,
  continueAnyway,
  cancel,
}: AttendanceSheetsProps) {
  const { t, language } = useLanguage();
  const retry = () => { if (mode) void start(mode); };
  const tryAgain = (onPress: () => void) => (
    <ActionButton key="try" kind="next" label="Try again" icon="RefreshCw" onPress={onPress} />
  );
  const ghost = (label: string, onPress: () => void) => (
    <ActionButton key="ghost" kind="ghost" label={label} onPress={onPress} />
  );

  let content: SheetContent | null = null;
  switch (phase) {
    case 'weakSignal': {
      const meters = String(Math.round(accuracyMeters ?? 0));
      content = {
        glyph: 'MapPin',
        tone: 'needsYou',
        title: 'GPS signal is weak',
        body: (
          <StaffText role="body" color="muted" translate={false}>
            {t('Accuracy is ±{m} m. Move near a window or outdoors, then try again.', { m: isolate(meters) })}
          </StaffText>
        ),
        actions: [tryAgain(() => void retryLocation()), ghost('Continue anyway', () => void continueAnyway())],
      };
      break;
    }
    case 'notAtLocation': {
      // Reserved: the server sends no code for this yet, so the hook never enters it (spec 16).
      const urdu = language === 'ur';
      const title = place && !urdu ? (
        <StaffText role="sheetTitle" translate={false}>{t('You are not at {place}', { place: isolate(place) })}</StaffText>
      ) : (
        <View>
          <StaffText role="sheetTitle">You are not at your assigned location</StaffText>
          {place ? <NameLine role="sheetTitle" name={place} /> : null}
        </View>
      );
      content = {
        glyph: 'MapPin',
        tone: 'red',
        title,
        body: (
          <View style={styles.lines}>
            <StaffText role="body" color="muted">Go to your assigned location, then try again.</StaffText>
            {addsDetail(error) ? <StaffText role="body" color="muted">{error}</StaffText> : null}
          </View>
        ),
        actions: [tryAgain(retry), ghost('Cancel', () => void cancel())],
      };
      break;
    }
    case 'needsPermission':
      content = {
        glyph: 'Camera',
        tone: 'blue',
        title: 'Camera is needed',
        body: 'Allow camera and location in phone settings to mark attendance.',
        actions: [
          <ActionButton
            key="settings"
            kind="next"
            label="Open settings"
            icon="Settings"
            onPress={() => {
              void Linking.openSettings();
              void cancel();
            }}
          />,
          ghost('Cancel', () => void cancel()),
        ],
      };
      break;
    case 'error':
      if (!mode) break;
      content = {
        glyph: 'MapPin',
        tone: 'red',
        title: 'Attendance not saved',
        body: error ? (
          <StaffText role="body" color="muted" accessibilityLiveRegion="polite">{error}</StaffText>
        ) : undefined,
        actions: [tryAgain(retry), ghost('Cancel', () => void cancel())],
      };
      break;
    default:
      break;
  }

  if (!content) return null;
  return (
    <BottomSheet
      visible
      onDismiss={() => void cancel()}
      glyph={content.glyph}
      glyphTone={content.tone}
      title={content.title}
      body={content.body}
      actions={content.actions}
    />
  );
}

export interface UnsubmittedWorkSheetProps {
  /** Tasks of today not yet submitted (at least 1). */
  count: number;
  onBack: () => void;
  onCheckOutAnyway: () => void;
  visible?: boolean;
}

/** Shown before check-out while today's work is still open. Back closes it, like "Go back to my work". */
export function UnsubmittedWorkSheet({ count, onBack, onCheckOutAnyway, visible = true }: UnsubmittedWorkSheetProps) {
  const { t, isRTL } = useLanguage();
  return (
    <BottomSheet
      visible={visible}
      onDismiss={onBack}
      glyph="ListChecks"
      glyphTone="needsYou"
      title={
        count === 1 ? (
          '1 task is not submitted'
        ) : (
          <StaffText role="sheetTitle" translate={false}>{t('{n} tasks are not submitted', { n: isolate(String(count)) })}</StaffText>
        )
      }
      body="You can still check out, or go back and finish your work."
      actions={[
        <ActionButton key="back" kind="next" label="Go back to my work" icon={isRTL ? 'ArrowRight' : 'ArrowLeft'} onPress={onBack} />,
        <ActionButton key="out" kind="ghost" label="Check out anyway" onPress={onCheckOutAnyway} />,
      ]}
    />
  );
}

const styles = StyleSheet.create({
  lines: { gap: 6 },
});
