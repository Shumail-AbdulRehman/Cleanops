import * as React from 'react';
import { ActionButton } from '../../design/ActionButton';
import { Moment, type MomentFact } from '../../design/Moment';
import type { PillProps } from '../../design/Pill';
import { isolate } from '../../design/StaffText';
import { clock, duration, minutesBetween, timeRange } from '../../design/format';
import { useLanguage } from '../../i18n/LanguageProvider';
import type { AttendanceRecord } from '../../types';
import type { AttendanceActionResult } from './useAttendanceAction';

export interface AttendanceReceiptProps {
  /** The hook's `result` (phase `done`). */
  result: AttendanceActionResult;
  /** The fresh attendance record for this shift, or null if not loaded yet. */
  record: AttendanceRecord | null;
  tasksSubmitted: number;
  tasksTotal: number;
  /** The assigned location's entered name, or null. */
  place: string | null;
  onDone: () => void;
  /** IANA zone for times; the device zone when left out. */
  timeZone?: string;
}

/** "Checked in" or "Checked out" receipt shown when the hook reaches `done`. */
export function AttendanceReceipt({ result, record, tasksSubmitted, tasksTotal, place, onDone, timeZone }: AttendanceReceiptProps) {
  const { t, language, isRTL } = useLanguage();
  const lang = language === 'ur' ? 'ur' : 'en';
  const checkOut = result.mode === 'check-out';
  const at = result.at ?? (checkOut ? record?.checkOutTime : record?.checkInTime) ?? null;
  const facts: MomentFact[] = [];
  let pill: PillProps | undefined;

  if (checkOut) {
    const missed = record?.status === 'MISSED_CHECKOUT';
    if (missed) pill = { tone: 'warn', label: 'Missed check-out' };
    const checkedIn = record?.checkInTime ?? null;
    if (checkedIn) facts.push({ label: 'In', value: clock(checkedIn, timeZone) });
    if (at) facts.push({ label: 'Out', value: clock(at, timeZone) });
    if (!missed && checkedIn && at) {
      facts.push({ label: 'Time worked', value: duration(minutesBetween(checkedIn, at), lang) });
    }
    facts.push({ label: 'Tasks submitted', value: t('{n} of {t}', { n: tasksSubmitted, t: tasksTotal }) });
    if (place) facts.push({ label: 'Location', value: place });
  } else {
    pill = result.late || record?.status === 'LATE' ? { tone: 'late', label: 'Late' } : { tone: 'green', label: 'On time' };
    if (place) facts.push({ label: 'Location', value: place });
    if (record) facts.push({ label: 'Shift', value: timeRange(record.expectedStart, record.expectedEnd, timeZone) });
  }

  return (
    <Moment
      badge={checkOut ? 'green' : 'blue'}
      title={checkOut ? 'Checked out' : 'Checked in'}
      subtitle={at ? isolate(clock(at, timeZone)) : undefined}
      pill={pill}
      facts={facts}
      live
      action={
        <ActionButton
          kind="next"
          label={checkOut ? 'Back to my day' : "See today's work"}
          icon={isRTL ? 'ArrowLeft' : 'ArrowRight'}
          onPress={onDone}
        />
      }
    />
  );
}
