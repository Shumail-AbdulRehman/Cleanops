import { useLanguage } from '@/i18n/context';
import DataTable, { type Column } from '@/components/common/DataTable';
import StatusPill from '@/components/workspace/StatusPill';
import { formatInTimeZone } from 'date-fns-tz';
import { Link } from 'react-router-dom';
import { Activity } from 'lucide-react';
import { verificationLabel, timingLabel } from '@/pages/Verification/presentation';
import './staff-tabs-v6.css';

export interface StaffTaskInstanceRow {
  id: number;
  title: string;
  location?: { name?: string | null; timezone?: string | null } | null;
  date: string | null;
  shiftStart: string | null;
  shiftEnd: string | null;
  status: string;
  staffSubmittedAt?: string | null;
  verificationVersion?: number;
  verificationState?: string;
  completionOutcome?: string | null;
  completionTiming?: string | null;
  isLate: boolean;
  startedAt: string | null;
  completedAt: string | null;
  proofImageUrls?: string[];
}

export interface StaffTasksTabProps { staff: { taskInstances: StaffTaskInstanceRow[] }; displayPeriod: string; id: string; searchParams: URLSearchParams }
export default function StaffTasksTab({ staff, displayPeriod, id, searchParams }: StaffTasksTabProps) {
  const { t, language } = useLanguage();
  const locale = language === 'ur' ? 'ur-PK' : 'en-PK';
  const date = (value: string | null) => value ? new Date(value).toLocaleDateString(locale, { timeZone: 'UTC' }) : '—';
  const time = (value: string | null, timezone = 'UTC') => value ? formatInTimeZone(new Date(value), timezone, 'HH:mm') : '—';
  const timestamp = (value: string | null, timezone = 'UTC') => value ? new Date(value).toLocaleString(locale, { timeZone: timezone, day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false }) : '—';
  const photoHref = (row: StaffTaskInstanceRow) => `/verification/${row.id}?returnTo=${encodeURIComponent(`/staff/${id}?${searchParams.toString()}`)}`;
  const columns: Column<StaffTaskInstanceRow>[] = [
    { key: 'title', header: 'Task', render: row => <strong><bdi>{row.title}</bdi></strong> },
    { key: 'location', header: 'Location', render: row => <bdi>{row.location?.name ?? '—'}</bdi> },
    { key: 'date', header: 'Date', render: row => <bdi>{date(row.date)}</bdi> },
    { key: 'shift', header: 'Shift', render: row => <bdi>{time(row.shiftStart, row.location?.timezone ?? 'UTC')} – {time(row.shiftEnd, row.location?.timezone ?? 'UTC')}</bdi> },
    { key: 'status', header: 'Status', className: 'wx-staff-tab-status-cell', render: row => {
      const submitted = Boolean(row.staffSubmittedAt || row.status === 'COMPLETED');
      return <div className="wx-staff-tab-stack"><StatusPill status={submitted ? undefined : row.status} tone={submitted || row.status === 'IN_PROGRESS' ? 'progress' : ['MISSED', 'NOT_COMPLETED_INTIME'].includes(row.status) ? 'bad' : 'neutral'}>{submitted ? t('Work submitted') : undefined}</StatusPill>
        {row.verificationVersion === 2 ? <Link className="wx-staff-tab-link" to={photoHref(row)}>{t(verificationLabel(row))}</Link> : null}
        {row.completionTiming ? <small>{t(timingLabel(row.completionTiming))}</small> : null}
        {row.isLate ? <small className="wx-staff-tab-warning">{t('Late start')}</small> : null}</div>;
    } },
    { key: 'startedAt', header: 'Started', render: row => <bdi>{timestamp(row.startedAt, row.location?.timezone ?? 'UTC')}</bdi> },
    { key: 'completedAt', header: 'Completed', render: row => <bdi>{timestamp(row.completedAt, row.location?.timezone ?? 'UTC')}</bdi> },
    { key: 'proof', header: 'Proof', render: row => row.verificationVersion === 2
      ? <Link className="wx-staff-tab-link" to={photoHref(row)}>{t('View task photos')}</Link>
      : <div className="wx-staff-tab-stack"><span>{(row.proofImageUrls?.length ?? 0).toLocaleString(locale)}</span>
        {row.proofImageUrls?.map((url, index) => <a className="wx-staff-tab-link" key={`${url}:${index}`} href={url} target="_blank" rel="noopener noreferrer"><span>{t('View task photos')} <bdi>{index + 1}</bdi></span></a>)}</div> },
  ];
  return <section className="wx-staff-tab" aria-label={t('Task instances')}>
    <div className="wx-staff-tab-heading"><h2>{t('Task instances')}</h2><p>{t('Recent filtered task execution for {period}.', { period: displayPeriod })}</p></div>
    <DataTable mobileCards pageSize={20} columns={columns} data={staff.taskInstances} rowKey={row => row.id}
      emptyIcon={<Activity size={32} aria-hidden="true" />} emptyMessage="No task instances found for this period." />
  </section>;
}
