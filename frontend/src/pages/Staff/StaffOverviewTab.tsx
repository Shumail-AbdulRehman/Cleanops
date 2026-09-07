import type { ComponentProps } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Activity, AlertTriangle, CheckCircle2, ClipboardList, XCircle } from 'lucide-react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { formatInTimeZone } from 'date-fns-tz';
import { useLanguage } from '@/i18n/context';
import { formatDays, isEveryDay } from '@/lib/workDays';
import DataTable from '@/components/common/DataTable';
import StatCard from '@/components/common/StatCard';
import StatusPill from '@/components/workspace/StatusPill';
import { verificationLabel } from '@/pages/Verification/presentation';
import StaffPerformanceIssues from './StaffPerformanceIssues';
import type { EditableStaff } from './StaffEditDialog';
import type { StaffTaskTemplateRow } from './StaffScheduleTab';
import type { StaffTaskInstanceRow } from './StaffTasksTab';
import type { StaffAttendanceRow } from './StaffAttendanceTab';
import './staff-profile-v6.css';
export interface StaffProfileData extends EditableStaff {
  role: string;
  createdAt: string;
  location?: { id?: number; name?: string | null; address?: string | null; timezone?: string | null } | null;
  periodLabel: string;
  taskStats: { totalTemplates: number; totalInstances: number; completed: number; pending: number; inProgress: number; missed: number };
  attendanceStats: { totalRecords: number; present: number; absent: number; late: number };
  taskTemplates: StaffTaskTemplateRow[];
  taskInstances: StaffTaskInstanceRow[];
  attendances: StaffAttendanceRow[];
  performanceIssues?: ComponentProps<typeof StaffPerformanceIssues>['data'];
}
export interface StaffOverviewTabProps { staff: StaffProfileData; staffTz: string; displayPeriod: string; isFetching: boolean }

export default function StaffOverviewTab({ staff, staffTz, displayPeriod, isFetching }: StaffOverviewTabProps) {
  const { t, language } = useLanguage();
  const location = useLocation();
  const returnTo = location.pathname + location.search;
  const locale = language === 'ur' ? 'ur-PK' : 'en-PK';
  const number = (value: number) => value.toLocaleString(locale);
  const { taskStats, attendanceStats } = staff;
  // The API's aggregate "present" has its own status definition. Keep it as
  // supplied; the capped history supports only a labelled recent check-in ratio.
  const checkIns = staff.attendances.filter(record => record.checkInTime);
  const onTime = checkIns.filter(record => !record.isLateCheckIn && record.status !== 'LATE').length;
  const reliability = attendanceStats.totalRecords > 0 ? Math.round(attendanceStats.present / attendanceStats.totalRecords * 100) : null;
  const chart = [
    { label: 'Work submitted', value: taskStats.completed, fill: 'var(--wx-blue)' },
    { label: 'Pending', value: taskStats.pending, fill: 'var(--wx-neutral-seg)' },
    { label: 'In Progress', value: taskStats.inProgress, fill: 'var(--wx-blue-mid)' },
    { label: 'Missed', value: taskStats.missed, fill: 'var(--wx-bad)' },
  ].map(item => ({ ...item, name: t(item.label) }));
  const chartData = chart.filter(item => item.value > 0);
  const time = (value: string | null, timezone = staffTz) => value ? formatInTimeZone(new Date(value), timezone, 'HH:mm') : '—';
  const date = (value: string | null) => value ? new Date(value).toLocaleDateString(locale, { timeZone: 'UTC' }) : '—';
  const days = staff.workDays?.length ? staff.workDays : undefined;
  const daySummary = formatDays(days, t, language);
  const shift = <>
    <bdi dir="ltr">{time(staff.shiftStart)} – {time(staff.shiftEnd)} ({staffTz})</bdi>
    {!isEveryDay(days) && <> · <bdi>{daySummary}</bdi></>}
  </>;
  const facts = [
    ['Name', staff.name], ['Email', staff.email || t('No email')], ['Phone Number', staff.phone || '—'], ['Role', t(staff.role)],
    ['Location', staff.location?.name ?? t('Unassigned')], ['Address', staff.location?.address ?? '—'],
    ['Shift', shift], ['Work days', daySummary], ['Joined', date(staff.createdAt)],
  ] as const;

  return <div className="wx-profile-overview">
    <dl className="wx-profile-figures">
      <div><dt>{t('Attendance reliability')}</dt><dd><strong>{reliability === null ? '—' : `${number(reliability)}%`}</strong><small>{t('Present')}: {number(attendanceStats.present)} · {t('Records')}: {number(attendanceStats.totalRecords)}</small></dd></div>
      <div><dt>{t('On time')}</dt><dd><strong>{number(onTime)}</strong><span>{t('of')} {number(checkIns.length)}</span><small>{t('Recent recorded check-ins only.')}</small></dd></div>
      <div><dt>{t('Tasks submitted')}</dt><dd><strong>{number(taskStats.completed)}</strong><span>{t('of')} {number(taskStats.totalInstances)}</span><small>{t('Scheduled tasks')}</small></dd></div>
      <div><dt>{t('Performance issues')}</dt><dd><strong>{staff.performanceIssues ? number(staff.performanceIssues.total) : '—'}</strong><small>{t('recorded performance issues')}</small></dd></div>
    </dl>
    <section className="wx-profile-recent" aria-label={t('Recent tasks')}>
      <DataTable<StaffTaskInstanceRow> data={staff.taskInstances.slice(0, 5)} rowKey={row => row.id} mobileCards emptyMessage="No task instances found for this period." columns={[
        { key: 'title', header: 'Recent task', render: row => <strong><bdi>{row.title}</bdi></strong> },
        { key: 'location', header: 'Location', render: row => <bdi>{row.location?.name ?? '—'}</bdi> },
        { key: 'time', header: 'Time', render: row => <div><bdi>{date(row.date)}</bdi><br /><bdi dir="ltr">{time(row.shiftStart, row.location?.timezone ?? 'UTC')} – {time(row.shiftEnd, row.location?.timezone ?? 'UTC')}</bdi></div> },
        { key: 'status', header: 'Status', render: row => <div className="wx-profile-task-status">
          {row.staffSubmittedAt || row.status === 'COMPLETED' ? <StatusPill tone="progress">Work submitted</StatusPill> : <StatusPill status={row.status} tone={row.status === 'MISSED' || row.status === 'OVERDUE' ? 'bad' : 'neutral'} />}
          {row.verificationVersion === 2 && <Link to={`/verification/${row.id}?returnTo=${encodeURIComponent(returnTo)}`}>{t(verificationLabel(row))}</Link>}
        </div> },
      ]} />
    </section>
    <div className="wx-profile-overview-details">
      <section className="wx-profile-chart" aria-labelledby={`staff-${staff.id}-task-performance`}>
        <h2 id={`staff-${staff.id}-task-performance`}>{t('Task performance')}</h2>
        <p>{t(isFetching ? 'Refreshing filtered period...' : 'Task outcomes for {period}.', { period: displayPeriod })}</p>
        {chartData.length ? <div role="img" aria-label={chart.map(item => `${item.name}: ${number(item.value)}`).join('; ')} dir="ltr" className="wx-profile-chart-plot">
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={chartData} layout="vertical" accessibilityLayer={false}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--wx-line)" />
              <XAxis type="number" allowDecimals={false} tick={{ fontSize: 12.5, fill: 'var(--wx-muted)' }} />
              <YAxis type="category" dataKey="name" width={language === 'ur' ? 110 : 105} tick={{ fontSize: 12.5, fill: 'var(--wx-muted)' }} />
              <Tooltip contentStyle={{ background: 'var(--wx-surface)', border: '1px solid var(--wx-line)', borderRadius: 'var(--wx-radius-md)', color: 'var(--wx-ink)' }} formatter={value => [number(Number(value)), t('Task totals')]} />
              <Bar dataKey="value" radius={[0, 3, 3, 0]} isAnimationActive={false} />
            </BarChart>
          </ResponsiveContainer>
        </div> : <p className="wx-profile-chart-empty">{t('No task data in this period.')}</p>}
        <details className="wx-profile-chart-table"><summary>{t('Task totals')}</summary><table><caption className="wx-profile-sr">{t('Task totals')}</caption><thead><tr><th scope="col">{t('Status')}</th><th scope="col">{t('Scheduled tasks')}</th></tr></thead><tbody>{chart.map(item => <tr key={item.label}><th scope="row">{item.name}</th><td>{number(item.value)}</td></tr>)}</tbody></table></details>
      </section>
      <section className="wx-profile-facts" aria-labelledby={`staff-${staff.id}-profile`}>
        <h2 id={`staff-${staff.id}-profile`}>{t('Profile')}</h2><p>{t('Core staff identity and assignment details.')}</p>
        <dl>{facts.map(([label, value]) => <div key={label}><dt>{t(label)}</dt><dd>{typeof value === 'string'
          ? <bdi dir={label === 'Phone Number' || (label === 'Email' && staff.email) ? 'ltr' : undefined}>{value}</bdi>
          : value}</dd></div>)}</dl>
      </section>
      <section className="wx-profile-totals" aria-label={t('Task totals')}>
        <StatCard label="Scheduled tasks" value={number(taskStats.totalInstances)} icon={ClipboardList} />
        <StatCard label="Work submitted" value={number(taskStats.completed)} icon={CheckCircle2} />
        <StatCard label="Pending" value={number(taskStats.pending)} icon={Activity} />
        <StatCard label="Missed" value={number(taskStats.missed)} icon={XCircle} />
        <StatCard label="Late Check-ins" value={number(attendanceStats.late)} icon={AlertTriangle} />
      </section>
      <section className="wx-profile-attendance-summary" aria-label={t('Attendance summary')}><h2>{t('Attendance summary')}</h2><p>{t('Attendance reliability for {period}.', { period: displayPeriod })}</p><dl>{[['Records', attendanceStats.totalRecords], ['Present', attendanceStats.present], ['Absent', attendanceStats.absent], ['Late', attendanceStats.late]].map(([label, value]) => <div key={label}><dt>{t(String(label))}</dt><dd>{number(Number(value))}</dd></div>)}</dl></section>
      <div className="wx-profile-issues"><StaffPerformanceIssues data={staff.performanceIssues} periodLabel={displayPeriod} staffId={staff.id} /></div>
    </div>
  </div>;
}
