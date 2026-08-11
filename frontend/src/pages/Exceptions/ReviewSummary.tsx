import { AlertCircle, Camera, Clock3, CheckCircle2 } from 'lucide-react';
import { useLanguage } from '@/i18n/context';
import { localTime } from '../Manager/operations';
import { plainReason } from '../Verification/presentation';
import { reviewDiagnosis } from './reviewDiagnosis';
import type { ExceptionDetail } from './types';
import './review-detail-v6.css';

export default function ReviewSummary({ detail, onSelect }: { detail: ExceptionDetail; onSelect: (id: string) => void }) {
  const { t, language } = useLanguage();
  const summary = reviewDiagnosis(detail, t);
  const resolved = detail.state === 'RESOLVED';
  const headings = { cleaning: 'More cleaning needed', missing: 'Missing photos', retake: 'Photos did not pass', review: 'Manager review needed', processing: 'Checks in progress' };
  const title = resolved ? 'Review resolved' : detail.kind === 'SETUP' ? 'Room inventory needs setup'
    : summary.cleaning && summary.missing ? 'Cleaning is incomplete'
    : summary.cleaning ? 'More cleaning is needed' : summary.missing ? 'Required photos are missing'
    : summary.groups.length && summary.groups.every(group => group.category === 'processing') ? 'Photo checks are still running' : 'Photos need a manager’s review';
  const timezone = detail.location?.timezone ?? 'Asia/Karachi';
  return <section className={`wx-case-summary${resolved ? ' wx-case-summary--resolved' : ''}`} aria-label={t('Review summary')}>
    <div className="wx-case-summary-heading">
      <h3>{t(resolved ? 'Review result' : 'What went wrong')}</h3>
      {summary.total > 0 && <span className="wx-case-progress"><CheckCircle2 size={16} aria-hidden="true" />{t('{checked} of {total} required photos satisfied', { checked: summary.checked, total: summary.total })}</span>}
    </div>
    <p className="wx-case-summary-title">{t(title)}</p>
    {!resolved && summary.groups.length > 0 && <div className="wx-case-findings">{summary.groups.map(group => <div className="wx-case-finding" key={group.category}>
      <h4>{group.category === 'missing' ? <Camera size={17} aria-hidden="true" /> : <AlertCircle size={17} aria-hidden="true" />}{t(headings[group.category])} <span>({group.rows.length.toLocaleString(language === 'ur' ? 'ur-PK' : 'en-PK')})</span></h4>
      <ul>{group.rows.slice(0, 4).map(row => <li key={row.id}>
        <button type="button" onClick={() => onSelect(row.id)} aria-label={t('Inspect {name}: {view}', { name: row.name, view: row.view })}><bdi>{row.name}</bdi> · {row.view}</button>
        <p>{row.description}</p>
      </li>)}</ul>
      {group.rows.length > 4 && <p>{t('{count} more photos listed below', { count: group.rows.length - 4 })}</p>}
    </div>)}</div>}
    {!resolved && detail.issues.filter(issue => !issue.requirementId && issue.state !== 'RESOLVED').map(issue => <p key={issue.id}>{t(plainReason(issue.reasonCode))}</p>)}
    <div className="wx-case-next"><div><h4>{t('What to do next')}</h4><p>{summary.next}</p></div>
      {summary.capture.deadline && <div className="wx-case-deadline"><Clock3 size={17} aria-hidden="true" /><div><strong>{t(summary.capture.reason === 'DEADLINE_PASSED' ? 'Photo deadline passed' : 'Photo deadline')}</strong><time dateTime={summary.capture.deadline}><bdi>{localTime(summary.capture.deadline, timezone, language, true)}</bdi> (<bdi>{timezone}</bdi>)</time></div></div>}
    </div>
  </section>;
}
