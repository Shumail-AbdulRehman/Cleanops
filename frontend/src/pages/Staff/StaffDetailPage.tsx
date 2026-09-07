import { useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Clock, Mail, MapPin, Pencil, Phone, RefreshCw, User } from 'lucide-react';
import { formatInTimeZone } from 'date-fns-tz';
import useAuth from '@/hooks/useAuth';
import { useLanguage } from '@/i18n/context';
import { formatDays, isEveryDay } from '@/lib/workDays';
import PageHeader from '@/components/common/PageHeader';
import EmptyState from '@/components/common/EmptyState';
import PersonAvatar from '@/components/workspace/PersonAvatar';
import StatusPill from '@/components/workspace/StatusPill';
import ChipGroup from '@/components/workspace/ChipGroup';
import DateMenu from '@/components/workspace/DateMenu';
import SelectMenu from '@/components/workspace/SelectMenu';
import WorkspaceTabs, { WorkspaceTabPanel } from '@/components/workspace/WorkspaceTabs';
import OperationsState from '../Manager/OperationsState';
import { useGetLocations } from '../Location/queries';
import { useGetStaffDetails } from './queries';
import type { StaffDetailsFilters } from './api';
import StaffEditDialog from './StaffEditDialog';
import WorkforceActions, { type WorkforceSite } from './WorkforceActions';
import StaffOverviewTab, { type StaffProfileData } from './StaffOverviewTab';
import StaffScheduleTab from './StaffScheduleTab';
import StaffTasksTab from './StaffTasksTab';
import StaffAttendanceTab from './StaffAttendanceTab';
import './staff-profile-v6.css';

type Tab = 'overview' | 'templates' | 'instances' | 'attendance';
const tabs = [
  { value: 'overview', label: 'Overview' },
  { value: 'templates', label: 'Cleaning schedule' },
  { value: 'instances', label: 'Task history' },
  { value: 'attendance', label: 'Attendance' },
];
const dateValue = (date: Date) => date.toISOString().slice(0, 10);
const currentMonth = () => dateValue(new Date()).slice(0, 7);
const yesterdayValue = () => { const day = new Date(); day.setUTCDate(day.getUTCDate() - 1); return dateValue(day); };
const shiftTime = (value: string | null, timezone: string) => value ? formatInTimeZone(new Date(value), timezone, 'HH:mm (zzz)') : '—';

function monthOptions(locale: string, selected: string) {
  // Start on the first: subtracting a month on the 31st can skip February.
  const cursor = new Date(`${currentMonth()}-01T12:00:00Z`);
  const values = Array.from({ length: 12 }, () => { const value = dateValue(cursor).slice(0, 7); cursor.setUTCMonth(cursor.getUTCMonth() - 1); return value; });
  if (/^\d{4}-(0[1-9]|1[0-2])$/.test(selected) && !values.includes(selected)) values.push(selected);
  return values.map(value => ({ value, label: new Date(`${value}-15T12:00:00Z`).toLocaleDateString(locale, { month: 'long', year: 'numeric', timeZone: 'UTC' }), translateLabel: false }));
}

export default function StaffDetailPage() {
  const { id } = useParams();
  const { user } = useAuth();
  return <StaffProfile key={`${user?.companyId}:${user?.role}:${user?.id}:${id}`} id={id ?? ''} />;
}

function StaffProfile({ id }: { id: string }) {
  const { t, language } = useLanguage();
  const { user } = useAuth();
  const locale = language === 'ur' ? 'ur-PK' : 'en-PK';
  const [params, setParams] = useSearchParams();
  const requestedTab = params.get('tab');
  const activeTab: Tab = tabs.some(tab => tab.value === requestedTab) ? requestedTab as Tab : 'overview';
  const appliedMonth = params.get('month') ?? currentMonth();
  const appliedFrom = params.get('dateFrom') ?? '';
  const appliedTo = params.get('dateTo') ?? '';
  const periodKey = `${appliedMonth}:${appliedFrom}:${appliedTo}`;
  const filters = useMemo<StaffDetailsFilters>(() => appliedFrom && appliedTo ? { dateFrom: appliedFrom, dateTo: appliedTo } : { month: appliedMonth }, [appliedMonth, appliedFrom, appliedTo]);
  const [draft, setDraft] = useState({ month: appliedMonth, from: appliedFrom, to: appliedTo });
  const [previousPeriod, setPreviousPeriod] = useState(periodKey);
  const [filterError, setFilterError] = useState('');
  if (previousPeriod !== periodKey) {
    setPreviousPeriod(periodKey);
    setDraft({ month: appliedMonth, from: appliedFrom, to: appliedTo });
    setFilterError('');
  }
  const [editing, setEditing] = useState(false);
  const [accessOpen, setAccessOpen] = useState(false);
  const [saved, setSaved] = useState(false);
  const sitesQuery = useGetLocations();
  const staffQuery = useGetStaffDetails(Number(id), filters);
  const staff = staffQuery.data?.data as StaffProfileData | undefined;
  const status = (staffQuery.error as { response?: { status?: number } })?.response?.status;
  const denied = staffQuery.isError && (status === 401 || status === 403 || status === 404 || status === 410);
  const back = <Link className="wx-profile-back" to="/staff"><ArrowLeft aria-hidden="true" size={16} />{t('Back to team')}</Link>;

  const apply = (next: StaffDetailsFilters) => {
    setFilterError('');
    setParams(previous => {
      const result = new URLSearchParams(previous);
      result.set('tab', activeTab);
      result.delete('focus');
      for (const key of ['month', 'dateFrom', 'dateTo'] as const) {
        if (next[key]) result.set(key, next[key]!); else result.delete(key);
      }
      return result;
    });
    setDraft({ month: next.month ?? draft.month, from: next.dateFrom ?? '', to: next.dateTo ?? '' });
  };
  const quickFilter = appliedFrom && appliedTo ? appliedFrom === appliedTo && appliedFrom === dateValue(new Date()) ? 'today' : appliedFrom === appliedTo && appliedFrom === yesterdayValue() ? 'yesterday' : '' : appliedMonth === currentMonth() ? 'this-month' : '';

  if (staffQuery.isLoading && !staff) return <div className="wx-staff-profile">{back}<PageHeader title="Team member" /><OperationsState loading skeleton="detail" /></div>;
  if (denied || (staffQuery.isError && !staff)) return <div className="wx-staff-profile">{back}<PageHeader title="Team member" />
    {denied ? <div className="wx-profile-notice" role="alert">{t('This team member is unavailable to your account. Open the team directory to choose an accessible record.')}</div> : <OperationsState error={staffQuery.error} retry={() => void staffQuery.refetch()} />}
  </div>;
  if (!staff) return <div className="wx-staff-profile"><EmptyState icon={<User aria-hidden="true" />} title="Staff member not found." action={back} /></div>;

  const staffTz = staff.location?.timezone ?? 'UTC';
  const days = staff.workDays;
  const displayPeriod = filters.month && /^\d{4}-(0[1-9]|1[0-2])$/.test(filters.month) ? new Date(`${filters.month}-15T12:00:00Z`).toLocaleDateString(locale, { month: 'long', year: 'numeric', timeZone: 'UTC' }) : t(staff.periodLabel);
  const sites: WorkforceSite[] = sitesQuery.data?.data ?? [];
  const canAccess = staff.isActive && (user?.role === 'ADMIN' || (user?.role === 'MANAGER' && !sitesQuery.isError && sites.some(site => site.id === (staff.locationId ?? staff.location?.id))));
  const canEdit = staff.isActive && (user?.role === 'ADMIN' || user?.role === 'MANAGER');

  return <div className="wx-staff-profile">
    {back}
    <header className="wx-profile-header">
      <div className="wx-profile-identity">
        <PersonAvatar name={staff.name} size="large" />
        <div className="wx-profile-person">
          <h1 className="wx-page-title"><bdi>{staff.name}</bdi></h1>
          <div className="wx-profile-meta">
            <span><MapPin size={15} aria-hidden="true" /><bdi>{staff.location?.name ?? t('Unassigned')}</bdi></span>
            <span><Clock size={15} aria-hidden="true" /><bdi dir="ltr">{shiftTime(staff.shiftStart, staffTz)} – {shiftTime(staff.shiftEnd, staffTz)}</bdi>
              {days?.length && !isEveryDay(days) ? <> · <bdi>{formatDays(days, t, language)}</bdi></> : null}
            </span>
          </div>
          <div className="wx-profile-meta">
            <span><Phone size={15} aria-hidden="true" /><span className="wx-profile-sr">{t('Phone Number')}: </span><bdi dir="ltr">{staff.phone || '—'}</bdi></span>
            <span><Mail size={15} aria-hidden="true" />{staff.email ? <bdi dir="ltr">{staff.email}</bdi> : t('No email')}</span>
          </div>
        </div>
      </div>
      <div className="wx-profile-actions">
        <StatusPill tone={staff.isActive ? 'ok' : 'neutral'} status={staff.isActive ? 'ACTIVE' : 'INACTIVE'} />
        <button className="wx-profile-button" type="button" disabled={!canAccess} onClick={() => setAccessOpen(true)}>{t('Staff access')}</button>
        <button className="wx-profile-button" type="button" disabled={!canEdit} onClick={() => setEditing(true)}><Pencil size={16} aria-hidden="true" />{t('Edit')}</button>
      </div>
    </header>
    {saved && <p className="wx-profile-notice" role="status">{t('Team member changes saved.')}</p>}
    <OperationsState error={staffQuery.isError ? staffQuery.error : undefined} retry={() => void staffQuery.refetch()} />
    {sitesQuery.isError && <div className="wx-profile-notice" role="alert">{t('Location list could not load. Existing records are still shown.')} <button className="wx-profile-button" type="button" disabled={sitesQuery.isFetching} onClick={() => void sitesQuery.refetch()}>{t('Retry')}</button></div>}
    <section className="wx-profile-period" aria-label={t('Filters')}>
      <div className="wx-profile-period-top">
        <ChipGroup label="Quick filters" value={quickFilter} options={[{ value: 'today', label: 'Today' }, { value: 'yesterday', label: 'Yesterday' }, { value: 'this-month', label: 'This Month' }]} onChange={value => value === 'this-month' ? apply({ month: currentMonth() }) : apply({ dateFrom: value === 'today' ? dateValue(new Date()) : yesterdayValue(), dateTo: value === 'today' ? dateValue(new Date()) : yesterdayValue() })} />
        <p>{t(params.get('focus') === 'today' ? '{period} · Attendance and task history for today.' : '{period} · Attendance and task history.', { period: displayPeriod })}</p>
        <button className="wx-profile-button wx-profile-refresh" type="button" disabled={staffQuery.isFetching} aria-busy={staffQuery.isFetching} onClick={() => void staffQuery.refetch()}><RefreshCw aria-hidden="true" size={15} />{t('Refresh')}</button>
      </div>
      <div className="wx-profile-period-fields">
        <div className="wx-profile-field"><span>{t('Month')}</span><SelectMenu label="Month" value={draft.month} options={monthOptions(locale, draft.month)} onChange={month => setDraft({ ...draft, month })} /></div>
        <button className="wx-profile-button" type="button" onClick={() => apply({ month: draft.month })}>{t('Apply month')}</button>
        <div className="wx-profile-field"><span>{t('From')}</span><DateMenu label="From date" placeholder="From" value={draft.from} quickOptions={[]} onChange={from => setDraft({ ...draft, from })} /></div>
        <div className="wx-profile-field"><span>{t('To')}</span><DateMenu label="To date" placeholder="To" value={draft.to} quickOptions={[]} onChange={to => setDraft({ ...draft, to })} /></div>
        <div className="wx-profile-range-actions">
          <button className="wx-profile-button" type="button" onClick={() => apply({ month: currentMonth() })}>{t('Reset')}</button>
          <button className="wx-profile-button wx-profile-primary" type="button" onClick={() => { if (!draft.from || !draft.to || draft.from > draft.to) { setFilterError('Choose both dates. The end date must be on or after the start date.'); return; } apply({ dateFrom: draft.from, dateTo: draft.to }); }}>{t('Apply range')}</button>
        </div>
      </div>
      {filterError && <p className="wx-profile-error" role="alert">{t(filterError)}</p>}
    </section>
    <WorkspaceTabs className="wx-profile-tabs" label="Team member sections" value={activeTab} tabs={tabs} onChange={tab => setParams(previous => { const next = new URLSearchParams(previous); next.set('tab', tab); return next; })}>
      <WorkspaceTabPanel value="overview"><StaffOverviewTab staff={staff} staffTz={staffTz} displayPeriod={displayPeriod} isFetching={staffQuery.isFetching} /></WorkspaceTabPanel>
      <WorkspaceTabPanel value="templates"><StaffScheduleTab staff={staff} /></WorkspaceTabPanel>
      <WorkspaceTabPanel value="instances"><StaffTasksTab staff={staff} displayPeriod={displayPeriod} id={id} searchParams={params} /></WorkspaceTabPanel>
      <WorkspaceTabPanel value="attendance"><StaffAttendanceTab staff={staff} displayPeriod={displayPeriod} /></WorkspaceTabPanel>
    </WorkspaceTabs>
    <WorkforceActions person={{ id: staff.id, name: staff.name, isActive: staff.isActive, locationId: staff.locationId ?? staff.location?.id }} locations={sitesQuery.isError ? [] : sites} open={accessOpen} onOpenChange={setAccessOpen} />
    {editing && <StaffEditDialog person={staff} timezone={staffTz} onClose={() => setEditing(false)} onSaved={() => setSaved(true)} />}
  </div>;
}
