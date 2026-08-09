import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useSelector } from 'react-redux';
import { ArrowRight, Building2, Check, ChevronDown, CircleHelp, RefreshCw } from 'lucide-react';
import { Area, Bar, BarChart, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { RootState } from '@/store/store';
import { useLanguage } from '@/i18n/context';
import ScopeFilters from '@/components/common/ScopeFilters';
import PageHeader from '@/components/common/PageHeader';
import EmptyState from '@/components/common/EmptyState';
import DataTable, { type Column } from '@/components/common/DataTable';
import FindField from '@/components/workspace/FindField';
import SelectMenu from '@/components/workspace/SelectMenu';
import SegmentedControl from '@/components/workspace/SegmentedControl';
import SiteAvatar from '@/components/workspace/SiteAvatar';
import StatusPill, { type StatusPillTone } from '@/components/workspace/StatusPill';
import OperationsState from '../Manager/OperationsState';
import { dailyLink, localTime, scopeParams } from '../Manager/operations';
import { useCompanyPerformance, statusLabel, type SitePerformance } from './performance';
import NewCompanyWelcome from './NewCompanyWelcome';
import './performance-v6.css';

const statusTone: Record<SitePerformance['today']['status'], StatusPillTone> = {
  ATTENTION: 'attention', IN_PROGRESS: 'progress', ON_TRACK: 'ok', NO_ACTIVITY: 'neutral',
};

export default function DashboardPage() {
  const { t, language } = useLanguage();
  const owner = useSelector((s: RootState) => s.auth.user?.role === 'ADMIN');
  const [params, setParams] = useSearchParams();
  const period = params.get('period') === '30' ? '30' : '7';
  const query = useCompanyPerformance({ ...scopeParams(params), period });
  const data = query.data;
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState('name');
  const locale = language === 'ur' ? 'ur-PK' : 'en-PK';
  const number = (value: number) => value.toLocaleString(locale, { maximumFractionDigits: 1 });
  const percent = (value: number | null) => value === null ? t('No data') : `${number(value)}%`;
  const change = (value: number | null) => value === null ? t('No previous data')
    : `${value > 0 ? '+' : ''}${number(value)} ${t('pp vs previous period')}`;
  const shortDate = (value: string | null) => value ? new Intl.DateTimeFormat(language === 'ur' ? 'ur-PK' : 'en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(`${value}T12:00:00Z`)) : '—';
  const summary = data?.summary;
  const filtered = data?.sites.filter(site => site.location.name.toLocaleLowerCase().includes(search.toLocaleLowerCase())).sort((a, b) => sort === 'name' ? a.location.name.localeCompare(b.location.name) : sort === 'attendance' ? (b.attendanceRate ?? -1) - (a.attendanceRate ?? -1) : sort === 'submission' ? (b.submissionRate ?? -1) - (a.submissionRate ?? -1) : b.today.overdue + b.today.missing + b.today.reviews - (a.today.overdue + a.today.missing + a.today.reviews)) ?? [];
  const signals = data?.sites.reduce((sum, site) => ({ overdue: sum.overdue + site.today.overdue, missing: sum.missing + site.today.missing, reviews: sum.reviews + site.today.reviews }), { overdue: 0, missing: 0, reviews: 0 });
  const reviewLink = '/exceptions?' + new URLSearchParams({ ...(params.get('locationId') ? { locationId: params.get('locationId')! } : {}), period: 'all' });
  const attendanceLink = '/attendance?' + new URLSearchParams({ ...(params.get('locationId') ? { locationId: params.get('locationId')! } : {}), ...(data?.dateTo ? { from: data.dateTo, to: data.dateTo } : {}) });
  const selectedLocation = data?.locations.find(location => String(location.id) === params.get('locationId'));
  const range = data ? `${shortDate(data.dateFrom)} – ${shortDate(data.dateTo)}` : t(query.isPending ? 'Loading performance…' : 'Reporting period');
  const columns: Column<SitePerformance>[] = [
    { key: 'location', header: 'Location', render: site => <div className="wx-perf-site"><SiteAvatar name={site.location.name} /><div><Link to={`/locations/${site.location.id}`}><strong><bdi>{site.location.name}</bdi></strong></Link><small>{number(site.staff)} {t('active staff')}</small></div></div> },
    ...(['attendance', 'submission'] as const).map(kind => ({
      key: kind, header: kind === 'attendance' ? 'Attendance' : 'Work submitted',
      render: (site: SitePerformance) => {
        const attendance = kind === 'attendance';
        const rate = attendance ? site.attendanceRate : site.submissionRate;
        return <div className={`wx-perf-rate wx-perf-rate--${kind}`}><div><strong><bdi>{percent(rate)}</bdi></strong><small><bdi>{number(attendance ? site.present : site.submitted)} / {number(attendance ? site.scheduledShifts : site.tasks)}</bdi> {t(attendance ? 'shifts' : 'tasks')}</small></div>{rate !== null ? <progress value={rate} max={100} aria-label={`${site.location.name}: ${t(attendance ? 'Attendance' : 'Work submitted')}`} /> : null}</div>;
      },
    })),
    { key: 'status', header: 'Status on selected day', render: site => <StatusPill tone={statusTone[site.today.status]}>{statusLabel[site.today.status]}</StatusPill> },
    { key: 'reviews', header: 'Open reviews', render: site => <bdi>{number(site.reviews)}</bdi> },
    { key: 'action', header: 'Action', render: site => <Link className="wx-perf-row-link" aria-label={`${t('View daily records')}: ${site.location.name}`} to={dailyLink(params, { locationId: String(site.location.id) })}><ArrowRight size={17} aria-hidden="true" /></Link> },
  ];
  const figures = data ? <details className="wx-perf-figures"><summary>{t('View daily figures')}<ChevronDown size={14} aria-hidden="true" /></summary><div className="wx-perf-daily-scroll" tabIndex={0} role="region" aria-label={t('Daily figures')}><table><caption className="sr-only">{t('Daily figures')}</caption><thead><tr><th scope="col">{t('Date')}</th><th scope="col">{t('Attendance')}</th><th scope="col">{t('Work submitted')}</th></tr></thead><tbody>{data.series.map(point => <tr key={point.offset}><th scope="row"><bdi>{shortDate(point.date)}</bdi></th><td><bdi>{number(point.present)} / {number(point.scheduledShifts)} ({percent(point.attendanceRate)})</bdi></td><td><bdi>{number(point.submitted)} / {number(point.tasks)} ({percent(point.submissionRate)})</bdi></td></tr>)}</tbody></table></div></details> : null;

  if (owner && data && !data.sites.length) return <div className="wx-performance">
    <OperationsState error={query.error} retry={() => void query.refetch()} />
    <NewCompanyWelcome />
  </div>;

  return <div className="wx-performance">
    <PageHeader title={owner ? 'Company performance' : 'Location overview'}
      subtitle={data ? `${range} · ${selectedLocation?.name ?? t(owner ? 'All locations' : 'My assigned locations')}` : range}
      tools={<><SegmentedControl label="Reporting period" value={period} options={[{ value: '7', label: 'Last 7 days' }, { value: '30', label: 'Last 30 days' }]}
        onChange={value => setParams(previous => { const next = new URLSearchParams(previous); next.set('period', value); return next; })} />
        <ScopeFilters locations={data?.locations ?? []} localDate={data?.dateTo ?? undefined} /></>}
      action={!owner ? <Link className="wx-perf-button" to={dailyLink(params)}>{t('Open Today')}<ArrowRight size={16} aria-hidden="true" /></Link> : undefined} />
    {!owner ? <p className="wx-perf-intro">{t('Historical performance for your assigned sites; daily actions stay in Today.')}</p> : null}
    <OperationsState loading={query.isPending} layout={owner ? 'owner-overview' : 'manager-overview'} error={query.error} retry={() => void query.refetch()} />
    {data && summary ? <>
      {!data.sites.length ? <EmptyState icon={<Building2 size={32} />} title="No assigned locations yet" message="Ask your company owner to assign a location to your account." /> : <>
        <div className={`wx-perf-main${!owner ? ' wx-perf-main--manager' : ''}`}>
          <section className="wx-perf-panel wx-perf-trend" aria-label={owner ? t('Performance summary') : undefined}>
            {owner ? <div className="wx-perf-summary">
              <h2 className="sr-only">{t('Consistency over time')}</h2>
              <p className="sr-only">{t('Daily attendance and submitted work as a share of the schedule.')}</p>
              {([{ label: 'Attendance', rate: summary.attendanceRate, delta: summary.attendanceChange, kind: 'attendance' }, { label: 'Work submitted', rate: summary.submissionRate, delta: summary.submissionChange, kind: 'submission' }]).map(metric => <div key={metric.kind} className={`wx-perf-metric wx-perf-metric--${metric.kind}`}><h3><i aria-hidden="true" />{t(metric.label)}</h3><strong><bdi>{percent(metric.rate)}</bdi></strong><small><bdi>{change(metric.delta)}</bdi></small></div>)}
            </div> : <div className="wx-perf-panel-heading"><div><h2>{t('Work submitted')}</h2><p>{t('Scheduled tasks in the reporting period')}</p></div><strong className="wx-perf-manager-total"><bdi>{number(summary.submitted)} / {number(summary.tasks)}</bdi></strong></div>}
            {summary.scheduledShifts || summary.tasks ? <div className="wx-perf-chart" dir="ltr" role="img" aria-label={t(owner ? 'Daily attendance and work submission percentages' : 'Daily submitted task counts')}><ResponsiveContainer width="100%" height="100%">{owner ? <ComposedChart data={data.series} margin={{ top: 12, right: 12, bottom: 0, left: -16 }} accessibilityLayer><CartesianGrid vertical={false} stroke="var(--wx-line)" strokeDasharray="3 5" /><XAxis padding={{ left: 8, right: 20 }} dataKey="date" tickFormatter={value => shortDate(String(value))} axisLine={false} tickLine={false} minTickGap={24} tick={{ fill: 'var(--wx-muted)', fontSize: 12 }} dy={10} /><YAxis domain={[0, 100]} ticks={[0, 25, 50, 75, 100]} tickFormatter={value => `${number(Number(value))}%`} axisLine={false} tickLine={false} tick={{ fill: 'var(--wx-muted)', fontSize: 12 }} /><Tooltip labelFormatter={value => shortDate(String(value))} formatter={value => value == null ? t('No data') : percent(Number(value))} contentStyle={{ background: 'var(--wx-surface)', color: 'var(--wx-ink)', border: '1px solid var(--wx-line)', borderRadius: 8, fontSize: 13 }} /><Area name={t('Work submitted')} dataKey="submissionRate" type="monotone" stroke="var(--wx-blue)" strokeWidth={2.5} fill="var(--wx-blue-wash)" fillOpacity={1} connectNulls={false} isAnimationActive={false} /><Line name={t('Attendance')} dataKey="attendanceRate" type="monotone" stroke="var(--wx-ink)" strokeWidth={2} strokeDasharray="5 4" dot={false} connectNulls={false} isAnimationActive={false} /></ComposedChart> : <BarChart data={data.series} margin={{ top: 12, right: 12, bottom: 0, left: -16 }} accessibilityLayer><CartesianGrid vertical={false} stroke="var(--wx-line)" /><XAxis padding={{ left: 8, right: 20 }} dataKey="date" tickFormatter={value => shortDate(String(value))} axisLine={false} tickLine={false} tick={{ fill: 'var(--wx-muted)', fontSize: 12 }} /><YAxis allowDecimals={false} axisLine={false} tickLine={false} tickFormatter={value => number(Number(value))} tick={{ fill: 'var(--wx-muted)', fontSize: 12 }} /><Tooltip labelFormatter={value => shortDate(String(value))} contentStyle={{ background: 'var(--wx-surface)', border: '1px solid var(--wx-line)', borderRadius: 8 }} /><Bar dataKey="submitted" name={t('Work submitted')} fill="var(--wx-blue)" radius={[4, 4, 0, 0]} maxBarSize={36} isAnimationActive={false} /></BarChart>}</ResponsiveContainer></div> : <div className="wx-perf-chart-empty"><h3>{t('No performance data in this period')}</h3><p>{t('Charts will appear when scheduled work is recorded.')}</p></div>}
            <p className="wx-perf-caption"><bdi>{number(summary.present)} / {number(summary.scheduledShifts)}</bdi> {t('scheduled shifts attended')} · <bdi>{number(summary.submitted)} / {number(summary.tasks)}</bdi> {t('scheduled tasks submitted')}. {t('Submitted work is separate from verification.')}</p>
            {figures}<p className="wx-perf-caption">{t('Gaps mean no scheduled records.')}</p>
          </section>
          <div className="wx-perf-side">
            <aside className={`wx-perf-panel wx-perf-attention${owner ? ' wx-perf-attention--owner' : ''}`} aria-labelledby="performance-attention"><div className="wx-perf-panel-heading"><div><h2 id="performance-attention">{t(owner ? (params.get('date') && params.get('date') !== 'today' ? 'Needs attention for this day' : 'Needs attention today') : 'Assigned-site actions')}</h2><p>{t('Dates follow each location’s timezone.')}</p></div></div><div className="wx-perf-attention-list">
              {owner ? <Link to={dailyLink(params, { tab: 'tasks', status: 'overdue' })}><span><strong>{t('Overdue work')}</strong><small>{t('Review daily work and assignment')}</small></span><b>{number(signals?.overdue ?? 0)}</b><ArrowRight size={16} aria-hidden="true" /></Link> : null}
              <Link to={reviewLink}><span><strong>{t('Photo reviews')}</strong><small>{t('Inspect received evidence and record a decision.')}</small></span>{owner ? <b>{number(signals?.reviews ?? 0)}</b> : null}<ArrowRight size={16} aria-hidden="true" /></Link>
              <Link to={attendanceLink}><span><strong>{t('Attendance follow-up')}</strong><small>{t('Review captured attendance and add context.')}</small></span>{owner ? <b>{number(signals?.missing ?? 0)}</b> : null}<ArrowRight size={16} aria-hidden="true" /></Link>
            </div><div className="wx-perf-attention-footer"><Link to={dailyLink(params)}>{t('Open Today')}<ArrowRight size={16} aria-hidden="true" /></Link></div></aside>
            {owner ? <section className="wx-perf-panel wx-perf-facts"><dl>
              <div><dt>{t('Locations with activity')}<small>{t('Locations with scheduled shifts or tasks')}</small></dt><dd><bdi>{number(summary.activeLocations)} / {number(summary.totalLocations)}</bdi></dd></div>
              <div><dt>{t('active team members')}</dt><dd>{number(summary.totalStaff)}</dd></div>
              <div><dt>{t('Open photo reviews')}<small>{t('Open reviews for work in this period')}</small></dt><dd>{number(summary.reviews)}</dd></div>
            </dl></section> : null}
          </div>
        </div>
        {owner ? <section className="wx-perf-panel wx-perf-locations" aria-labelledby="performance-locations"><div className="wx-perf-panel-heading"><div><h2 id="performance-locations">{t('Every location, in focus')}</h2><p>{t('Period totals alongside the latest status on the selected day.')}</p></div><Link to="/locations">{t('Manage locations')}<ArrowRight size={15} aria-hidden="true" /></Link></div>
          <div className="wx-perf-tools"><FindField label="Find a location" placeholder={t('Find a location…')} value={search} onChange={setSearch} /><SelectMenu label="Sort locations" value={sort} onChange={setSort} options={[{ value: 'name', label: 'Name A–Z' }, { value: 'attendance', label: 'Attendance rate' }, { value: 'submission', label: 'Work submission rate' }, { value: 'attention', label: 'Needs attention first' }]} /></div>
          {filtered.length ? <DataTable className="wx-perf-table" columns={columns} data={filtered} rowKey={site => site.location.id} mobileCards /> : <EmptyState title="No matching locations." action={<button type="button" className="wx-perf-button wx-perf-button--outline" onClick={() => setSearch('')}>{t('Clear search')}</button>} />}
          <footer className="wx-perf-table-footer"><span>{number(filtered.length)} {t('locations')} · {t('Weighted company totals')}</span><Link to={dailyLink(params)}>{t('Open Today')}</Link></footer>
        </section> : null}
        <details className="wx-perf-panel wx-perf-notes"><summary>{t('Work status and calculation notes')}<ChevronDown size={16} aria-hidden="true" /></summary><div><dl>{[['Work submitted', summary.submitted], ['In progress', summary.inProgress], ['Not started', summary.notStarted], ['Overdue', summary.overdue], ['verified', summary.verified], ['accepted with exceptions', summary.accepted]].map(([label, value]) => <div key={label}><dt>{t(String(label))}</dt><dd>{number(Number(value))}</dd></div>)}</dl><p><CircleHelp size={16} aria-hidden="true" />{t('Attendance counts checked-in shifts, including late arrivals. Rates include all scheduled records, including upcoming shifts today. Overnight work is counted once on its scheduled local date. Submitted work is separate from verification.')}</p><p><Check size={16} aria-hidden="true" />{t('Rates with no scheduled records are marked No data. Exact figures are listed below.')}</p></div></details>
      </>}
      <footer className="wx-perf-updated"><div><span>{t('Updated {time}', { time: localTime(data.asOf, data.selected[0]?.timezone ?? 'Asia/Karachi', language, true) })} · {t('Dates follow each location’s timezone.')}</span><button type="button" disabled={query.isFetching} onClick={() => void query.refetch()} aria-label={t('Refresh performance')}><RefreshCw size={14} aria-hidden="true" />{t('Refresh')}</button></div><Link to={dailyLink(params)}>{t('Go to daily operations')}<ArrowRight size={14} aria-hidden="true" /></Link></footer>
    </> : null}
  </div>;
}
