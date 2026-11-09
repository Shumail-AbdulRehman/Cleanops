import * as React from 'react';
import { ActionButton } from '../../design/ActionButton';
import { Moment, type MomentFact } from '../../design/Moment';
import { Pill } from '../../design/Pill';
import { StaffText, isolate } from '../../design/StaffText';
import { clock } from '../../design/format';
import { useLanguage } from '../../i18n/LanguageProvider';

export interface SubmissionReceiptProps {
  taskId: number;
  /** The area's entered name, shown as given (never translated). */
  areaName: string;
  /** ISO instant of the staff submission. */
  submittedAt: string;
  /** IANA zone for the submitted time; the device zone when left out. */
  timeZone?: string;
  photosReceived: number;
  photosRequired: number;
  /** When true the action goes to the next task; otherwise back to My day. */
  hasNextTask: boolean;
  onNext: () => void;
  onDone: () => void;
}

/** Shown after a task is submitted. Submitted and Verified stay separate facts. */
export function SubmissionReceipt({
  taskId,
  areaName,
  submittedAt,
  timeZone,
  photosReceived,
  photosRequired,
  hasNextTask,
  onNext,
  onDone,
}: SubmissionReceiptProps) {
  const { t, isRTL } = useLanguage();
  const time = isolate(clock(submittedAt, timeZone));

  const facts: MomentFact[] = [
    { label: t('Task {id}', { id: taskId }), value: areaName },
    { label: t('Photos received'), value: `${photosReceived} / ${photosRequired}` },
    { label: t('Submitted'), value: '', valueNode: <Pill tone="blue" label="Yes" /> },
    { label: t('Verified'), value: '', valueNode: <Pill tone="neutral" label="Not yet" /> },
  ];

  return (
    <Moment
      badge="blue"
      title="Work submitted"
      subtitle={
        <StaffText role="body" color="muted" align="center" translate={false}>
          {t('Submitted at {time}. Your manager may still review it.', { time })}
        </StaffText>
      }
      facts={facts}
      live
      action={
        <ActionButton
          kind="next"
          label={hasNextTask ? 'Next task' : 'Back to my day'}
          icon={isRTL ? 'ArrowLeft' : 'ArrowRight'}
          onPress={hasNextTask ? onNext : onDone}
        />
      }
    />
  );
}
