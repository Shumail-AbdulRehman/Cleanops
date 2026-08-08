import { useRef, useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { CalendarCheck, Camera, ChevronRight, MapPin, RefreshCw, Users } from 'lucide-react';
import { formatInTimeZone } from 'date-fns-tz';
import { useLanguage } from '@/i18n/context';
import PageHeader from '@/components/common/PageHeader';
import DataTable, { type Column } from '@/components/common/DataTable';
import EmptyState from '@/components/common/EmptyState';
import type { AttendancePhoto } from '@/components/common/ProtectedAttendancePhoto';
import ChipGroup from '@/components/workspace/ChipGroup';
import DateMenu from '@/components/workspace/DateMenu';
import SelectMenu from '@/components/workspace/SelectMenu';
import PersonAvatar from '@/components/workspace/PersonAvatar';
import SiteAvatar from '@/components/workspace/SiteAvatar';
import StatusPill from '@/components/workspace/StatusPill';
import { getAttendanceDisplayStatus } from '@/lib/attendance';
import { useGetLocations } from '../Location/queries';
import { useGetStaff } from '../Staff/queries';
import OperationsState from '../Manager/OperationsState';
import AttendanceContext from './AttendanceContext';
import { useGetAttendance } from './queries';
import type { AttendanceFilters } from './api';
import './attendance-v6.css';

interface AttendanceRecord {
  id: number; staffId: number; locationId: number; date: string;
  expectedStart: string; expectedEnd: string; checkInTime: string | null; checkOutTime: string | null;
  status: string; isLateCheckIn: boolean; lateMinutes: number | null;
  checkInPhoto?: AttendancePhoto; checkOutPhoto?: AttendancePhoto;
  staff: { id: number; name: string; email: string | null };
  location: { id: number; name: string; timezone?: string };
}
interface Site { id: number; name: string; timezone: string }
interface StaffOption { id: number; name: string; locationId?: number | null }
const calendarDate = (date = new Date(), timezone = 'UTC') => formatInTimeZone(date, timezone, 'yyyy-MM-dd');
const validDate = (value: string | null): value is string => !!value && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
const monthRange = (month: string) => {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return null;
  const start = `${month}-01`;
  if (!validDate(start)) return null;
  const end = new Date(`${start}T12:00:00Z`);
  end.setUTCMonth(end.getUTCMonth() + 1, 0);
  return { from: start, to: calendarDate(end) };
};

type InitialFilters = AttendanceFilters & { from: string; to: string };
function readInitialFilters(params: URLSearchParams): InitialFilters {
  const positiveId = (key: string) => { const raw = params.get(key) ?? ''; const value = Number(raw); return /^\d+$/.test(raw) && Number.isSafeInteger(value) && value > 0 ? value : undefined; };
  const start = params.get('from'), end = params.get('to');
  const range = validDate(start) && validDate(end) && start <= end ? { from: start, to: end } : { from: calendarDate(), to: calendarDate() };
  return { ...range, locationId: positiveId('locationId'), staffId: positiveId('staffId') };
}
export default function AttendancePage() {
  const [params] = useSearchParams();
  return <AttendanceRegister initial={readInitialFilters(params)} />;
}
function AttendanceRegister({ initial: applied }: { initial: InitialFilters }) {
  const { t, language } = useLanguage();
  const [, setParams] = useSearchParams();
  const root = useRef<HTMLDivElement>(null);
  const scopeKey = `${applied.locationId ?? ''}:${applied.staffId ?? ''}:${applied.from}:${applied.to}`;
  const [previousScope, setPreviousScope] = useState(scopeKey);
  const [location, setLocation] = useState(applied.locationId ? String(applied.locationId) : '');
  const [staff, setStaff] = useState(applied.staffId ? String(applied.staffId) : '');
  const [from, setFrom] = useState(applied.from);
  const [to, setTo] = useState(applied.to);
  const [month, setMonth] = useState(applied.from.slice(0, 7));
  const [validation, setValidation] = useState('');
  const [selected, setSelected] = useState<AttendanceRecord | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  // Sync browser Back/Forward without remounting controls on our own URL writes.
  if (previousScope !== scopeKey) {
    setPreviousScope(scopeKey);
    setLocation(applied.locationId ? String(applied.locationId) : '');
    setStaff(applied.staffId ? String(applied.staffId) : '');
    setFrom(applied.from); setTo(applied.to); setMonth(applied.from.slice(0, 7));
    setValidation(''); setPanelOpen(false);
  }
  const locationsQuery = useGetLocations();
  const staffQuery = useGetStaff();
  const query = useGetAttendance(applied);
  const sites = (locationsQuery.data?.data ?? []) as Site[];
  const allStaff = (staffQuery.data?.data ?? []) as StaffOption[];
  const records = ((query.data?.data ?? []) as AttendanceRecord[]).map(record => ({
    ...record,
    location: { ...record.location, timezone: record.location.timezone ?? sites.find(site => site.id === record.locationId)?.timezone },
  }));
  const selectedSite = sites.find(site => String(site.id) === location);
  const appliedSite = sites.find(site => site.id === applied.locationId);
  const appliedStaff = allStaff.find(person => person.id === applied.staffId);
  const now = new Date();
  const today = calendarDate(now, selectedSite?.timezone);
  const yesterdayDate = new Date(today + 'T12:00:00Z');
  yesterdayDate.setUTCDate(yesterdayDate.getUTCDate() - 1);
  const yesterday = calendarDate(yesterdayDate);
  const thisMonth = monthRange(today.slice(0, 7))!;
  const quickValue = applied.from === today && applied.to === today ? 'today'
    : applied.from === yesterday && applied.to === yesterday ? 'yesterday'
    : applied.from === thisMonth.from && applied.to === thisMonth.to ? 'month' : '';
  const denied = [401, 403, 404].includes((query.error as { response?: { status?: number } })?.response?.status ?? 0);
  const hasRecords = !!query.data && !denied;
  const checkedIn = records.filter(record => record.checkInTime).length;
  const checkedOut = records.filter(record => record.checkOutTime).length;
  const late = records.filter(record => record.isLateCheckIn || record.status === 'LATE').length;
  const dateLabel = (value: string) => new Intl.DateTimeFormat(language === 'ur' ? 'ur-PK' : 'en-PK', { timeZone: 'UTC', dateStyle: 'medium' }).format(new Date(value + 'T00:00:00Z'));
  const time = (value: string | null, timezone?: string) => value ? formatInTimeZone(new Date(value), timezone ?? 'UTC', 'HH:mm') : t('Not recorded');

  function writeFilters(filters: InitialFilters) {
    setParams(current => {
      const next = new URLSearchParams(current);
      next.set('from', filters.from); next.set('to', filters.to);
      for (const key of ['locationId', 'staffId'] as const) {
        if (filters[key]) next.set(key, String(filters[key])); else next.delete(key);
      }
      return next;
    });
  }
  function apply(event?: FormEvent, range?: { from: string; to: string }) {
    event?.preventDefault();
    const start = range?.from ?? from, end = range?.to ?? to;
    if (!validDate(start) || !validDate(end) || start > end) { setValidation('Choose a valid date range. From must be on or before To.'); return; }
    setValidation(''); setFrom(start); setTo(end);
    writeFilters({ locationId: location ? Number(location) : undefined, staffId: staff ? Number(staff) : undefined, from: start, to: end });
  }
  function quick(type: string) {
    apply(undefined, type === 'month' ? thisMonth : { from: type === 'yesterday' ? yesterday : today, to: type === 'yesterday' ? yesterday : today });
  }
  function reset() {
    const date = calendarDate(); setLocation(''); setStaff(''); setFrom(date); setTo(date); setMonth(date.slice(0, 7)); setValidation('');
    writeFilters({ from: date, to: date });
  }
  function openRecord(record: AttendanceRecord, focusRow = false) {
    if (focusRow) root.current?.querySelector<HTMLButtonElement>(`[data-attendance-id="${record.id}"]`)?.closest<HTMLTableRowElement>('tr')?.focus();
    setSelected(record); setPanelOpen(true);
  }
  const staffCell = (record: AttendanceRecord) => <div className="wx-att-person"><PersonAvatar name={record.staff.name} /><div><Link to={`/staff/${record.staff.id}`}><bdi>{record.staff.name}</bdi></Link><small><bdi>{dateLabel(record.date.slice(0, 10))}</bdi></small></div></div>;
  const shiftCell = (record: AttendanceRecord) => <div className="wx-att-person"><SiteAvatar name={record.location.name} /><div><Link to={`/locations/${record.location.id}`}><bdi>{record.location.name}</bdi></Link><small><bdi>{time(record.expectedStart, record.location.timezone)} – {time(record.expectedEnd, record.location.timezone)}</bdi></small><small><bdi>{record.location.timezone ?? t('UTC · location timezone unavailable')}</bdi></small></div></div>;
  const timeCell = (record: AttendanceRecord, kind: 'check-in' | 'check-out') => {
    const photo = kind === 'check-in' ? record.checkInPhoto : record.checkOutPhoto;
    const value = kind === 'check-in' ? record.checkInTime : record.checkOutTime;
    return <span className="wx-att-time"><bdi>{time(value, record.location.timezone)}</bdi>{photo?.state === 'AVAILABLE' ? <span role="img" aria-label={t('Photo available')}><Camera size={14} aria-hidden="true" /></span> : null}</span>;
  };
  const statusCell = (record: AttendanceRecord) => {
    const status = getAttendanceDisplayStatus(record, now, record.location.timezone ?? 'UTC');
    return <div className="wx-att-status"><div><StatusPill status={status} tone={['ABSENT', 'MISSED_CHECKOUT'].includes(status) ? 'bad' : status === 'LATE' ? 'attention' : ['CHECKED_IN', 'CHECKED_OUT'].includes(status) ? 'ok' : 'neutral'} />{record.isLateCheckIn && record.status !== 'LATE' ? <small>{t('Late arrival')}</small> : null}{record.lateMinutes ? <small>{t('{minutes} minutes late', { minutes: record.lateMinutes })}</small> : null}</div><button type="button" className="wx-att-open" data-attendance-id={record.id} aria-label={`${t('Attendance context')}: ${record.staff.name}`} onClick={() => openRecord(record)}><ChevronRight aria-hidden="true" /></button></div>;
  };
  const columns: Column<AttendanceRecord>[] = [
    { key: 'staff', header: 'Staff member', sortValue: record => record.staff.name, render: staffCell },
    { key: 'shift', header: 'Location and shift', render: shiftCell },
    { key: 'check-in', header: 'Check-in', render: record => timeCell(record, 'check-in') },
    { key: 'check-out', header: 'Check-out', render: record => timeCell(record, 'check-out') },
    { key: 'status', header: 'Status', sortValue: record => getAttendanceDisplayStatus(record, now, record.location.timezone ?? 'UTC'), render: statusCell },
  ];
  const metrics = [
    ['Scheduled shifts', records.length, 'Recorded for the applied dates'],
    ['Checked in', checkedIn, 'Includes late arrivals'],
    ['Late arrivals', late, 'Recorded against the shift'],
    ['Checked out', checkedOut, 'Captured checkouts'],
  ] as const;
  const activeRecord = selected ? records.find(record => record.id === selected.id) ?? selected : null;
  return <div className="wx-attendance-page" ref={root}>
    <PageHeader title="Attendance" subtitle="Know who is on site. Follow every check-in with confidence." />
    <section className="wx-att-register" aria-labelledby="wx-att-register-title">
      <form className="wx-att-filters" onSubmit={apply} noValidate>
        <div className="wx-att-filter-row">
          <ChipGroup label="Quick filters" value={quickValue} options={[{ value: 'today', label: 'Today' }, { value: 'yesterday', label: 'Yesterday' }, { value: 'month', label: 'This Month' }]} onChange={quick} />
          <SelectMenu label="Location" value={location} onChange={value => { setLocation(value); setStaff(''); }} disabled={locationsQuery.isPending || locationsQuery.isError} icon={<MapPin />} options={[{ value: '', label: 'All locations' }, ...sites.map(site => ({ value: String(site.id), label: site.name, translateLabel: false }))]} />
          <SelectMenu label="Staff" value={staff} onChange={setStaff} disabled={staffQuery.isPending || staffQuery.isError} icon={<Users />} options={[{ value: '', label: 'All Staff' }, ...allStaff.filter(person => !location || String(person.locationId) === location).map(person => ({ value: String(person.id), label: person.name, translateLabel: false }))]} />
          <button className="wx-att-button" type="submit">{t('Apply filters')}</button>
          <button className="wx-att-button wx-att-button--quiet" type="button" onClick={reset}>{t('Reset')}</button>
        </div>
        <details className="wx-att-more"><summary>{t('More filters')}</summary><div className="wx-att-filter-row">
          <label><span>{t('From')}</span><DateMenu label="From date" value={from} onChange={setFrom} localDate={today} quickOptions={[]} /></label>
          <label><span>{t('To')}</span><DateMenu label="To date" value={to} onChange={setTo} localDate={today} quickOptions={[]} /></label>
          <label><span>{t('Month')}</span><input type="month" aria-label={t('Month')} value={month} onChange={event => setMonth(event.target.value)} /></label>
          <button type="button" className="wx-att-button" onClick={() => { const range = monthRange(month); if (range) apply(undefined, range); else setValidation('Choose a valid date range. From must be on or before To.'); }}>{t('Apply month')}</button>
        </div></details>
        {validation ? <p role="alert" className="wx-att-error">{t(validation)}</p> : null}
        {locationsQuery.isError ? <div role="alert" className="wx-att-option-error"><span>{t('Locations could not load. Existing attendance is still available.')}</span><button className="wx-att-button" type="button" disabled={locationsQuery.isFetching} onClick={() => void locationsQuery.refetch()}>{t('Retry locations')}</button></div> : null}
        {staffQuery.isError ? <div role="alert" className="wx-att-option-error"><span>{t('Staff filter could not load.')}</span><button className="wx-att-button" type="button" disabled={staffQuery.isFetching} onClick={() => void staffQuery.refetch()}>{t('Retry')}</button></div> : null}
        <p className="wx-att-scope"><bdi>{appliedSite?.name ?? (applied.locationId ? `#${applied.locationId}` : t('All locations'))}</bdi> · <bdi>{dateLabel(applied.from)}{applied.to !== applied.from ? ` – ${dateLabel(applied.to)}` : ''}</bdi>{appliedSite ? <> · <bdi>{appliedSite.timezone}</bdi></> : null}{applied.staffId ? <> · <bdi>{appliedStaff?.name ?? `#${applied.staffId}`}</bdi></> : null}</p>
        <p className="wx-att-help">{t(appliedSite ? 'Dates and times follow the selected location’s calendar.' : 'Dates follow each location’s calendar. Choose a location to use its current day.')}</p>
      </form>
      <div className="wx-att-summary" aria-label={t('Attendance summary')} aria-busy={query.isPending}>{metrics.map(([label, value, hint]) => <div key={label}><span>{t(label)}</span><strong>{hasRecords ? value.toLocaleString(language === 'ur' ? 'ur-PK' : 'en-PK') : '—'}</strong><p>{t(hint)}</p></div>)}</div>
      <header className="wx-att-register-heading"><div><h2 id="wx-att-register-title">{t('Attendance records')}</h2><p>{t('Photos are available only to authorized accounts.')}</p></div><button type="button" className="wx-att-button" onClick={() => void query.refetch()} disabled={query.isFetching} aria-busy={query.isFetching}><RefreshCw size={16} aria-hidden="true" />{t(query.isFetching ? 'Refreshing…' : 'Refresh')}</button></header>
      <OperationsState loading={query.isPending && !hasRecords} error={query.error} retry={() => void query.refetch()} />
      {hasRecords ? records.length ? <DataTable pageSize={20} columns={columns} data={records} rowKey={record => record.id} mobileCards selectedRowKey={panelOpen ? selected?.id : null} onRowClick={record => openRecord(record, true)} /> : <EmptyState icon={<CalendarCheck size={32} />} title="No attendance recorded yet" message="No attendance records found for the selected filters." action={<button type="button" className="wx-att-button wx-att-button--primary" onClick={reset}>{t('Reset')}</button>} /> : null}
      <footer className="wx-att-footer"><span>{t('Overnight shifts remain tied to their scheduled local date.')}</span><span>{hasRecords ? t('{count} recorded shifts', { count: records.length }) : t('Attendance totals are unavailable until records load.')}</span></footer>
    </section>
    {activeRecord && !denied ? <AttendanceContext attendance={{ ...activeRecord, location: { ...activeRecord.location, timezone: activeRecord.location.timezone ?? 'UTC' } }} staffName={activeRecord.staff.name} open={panelOpen} onOpenChange={setPanelOpen} /> : null}
  </div>;
}
