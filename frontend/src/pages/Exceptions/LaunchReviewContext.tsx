import { useLanguage } from '@/i18n/context';
import { localTime } from '../Manager/operations';
import type { ExceptionDetail, ReviewReplacement } from './types';
import './review-detail-v6.css';

export default function LaunchReviewContext({ detail, replacement }: { detail: ExceptionDetail; replacement?: ReviewReplacement }) {
  const { t, language } = useLanguage();
  const requirements = (detail.items ?? []).flatMap(item => item.requirements);
  const received = requirements.filter(row => !!row.currentAttempt?.receivedAt).length;
  const closure = detail.decisions.find(row => ['RESOLVE_REVIEW', 'RECORD_PERFORMANCE_ISSUE'].includes(row.action));
  const timezone = detail.location?.timezone ?? 'Asia/Karachi';
  const stamp = (value: string) => <time dateTime={value}><bdi>{localTime(value, timezone, language, true)}</bdi> ({timezone})</time>;
  const service = replacement ?? requirements.find(row => row.replacement)?.replacement;
  const verified = detail.task?.completionOutcome === 'VERIFIED_COMPLETE';
  return <section className="wx-case-context" aria-label={t('Task and evidence status')}>
    <h2>{t('Task and evidence status')}</h2>
    <dl className="wx-case-facts">
      <div><dt>{t('Photos uploaded')}</dt><dd>{requirements.length ? t('{received} of {total} current views received', { received, total: requirements.length }) : t('Photo receipt information unavailable')}</dd></div>
      <div><dt>{t('Task submitted')}</dt><dd>{!detail.task ? t('Task submission information unavailable') : detail.task.staffSubmittedAt ? stamp(detail.task.staffSubmittedAt) : t('No task submission recorded')}</dd></div>
      <div><dt>{t('Manager reviewed')}</dt><dd>{closure ? <>{t('Review decision recorded')} · {closure.actorManager?.name ?? t('Manager name unavailable')}<br/>{stamp(closure.createdAt)}</> : t(detail.state === 'RESOLVED' ? 'Review closed; decision details unavailable' : 'No closure decision recorded')}</dd></div>
      <div><dt>{t('Evidence verified')}</dt><dd>{t(verified ? 'Verified completion recorded' : detail.task?.completionOutcome === 'COMPLETED_WITH_EXCEPTIONS' ? 'Completed with exceptions; evidence not fully verified' : 'Verified completion not recorded')}</dd></div>
    </dl>
    <p className="wx-case-context-note">{t('Uploading a photo does not submit the task. Closing a review does not verify its evidence.')}</p>
    {closure && <div className="wx-case-instructions"><h3>{t(closure.action === 'RECORD_PERFORMANCE_ISSUE' ? 'Staff performance issue recorded' : 'Resolution recorded')}</h3><p className="wx-case-saved-note">{closure.note ?? t('Decision note unavailable')}</p></div>}
    <p role="status">{t(!service ? 'Photo service status unavailable. Refresh before relying on capture availability.' : !service.processingAllowed ? 'New photo checking is unavailable pending safety qualification. Existing evidence and recorded results remain available where authorized.' : service.automaticApproval ? 'Photo checking is available. Only a recorded verified completion confirms verification.' : 'Photo checking is available; automatic approval is unavailable.')}</p>
    {replacement && <div className="wx-case-instructions"><h3>{t('Photo replacement')}</h3><p>{t(!replacement.processingAllowed ? replacement.policyEligible ? 'This failed view meets the recorded replacement rules, but new photo checking is unavailable. No replacement can be submitted now.' : 'Replacement is unavailable while new photo checking is disabled.' : replacement.available ? replacement.policyReason === 'FRESH_TASK_QR_REQUIRED' ? 'The assigned staff member must clean, then scan the task QR again. Capture authority is checked again by the server.' : 'Replacement is available only through the assigned staff capture flow. Capture authority is checked again by the server.' : 'No current replacement authority is confirmed for this view. The assigned staff app checks eligibility before capture.')}</p></div>}
  </section>;
}
