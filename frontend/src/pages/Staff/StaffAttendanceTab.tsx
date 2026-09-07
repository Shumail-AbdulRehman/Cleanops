import { useRef, useState } from 'react';
import { useLanguage } from '@/i18n/context';
import DataTable, { type Column } from '@/components/common/DataTable';
import StatusPill from '@/components/workspace/StatusPill';
import { formatInTimeZone } from 'date-fns-tz';
import { Calendar, Camera, ChevronRight } from 'lucide-react';
import AttendanceContext from '@/pages/Attendance/AttendanceContext';
import type { AttendancePhoto } from '@/components/common/ProtectedAttendancePhoto';
import { getAttendanceDisplayStatus } from '@/lib/attendance';
import './staff-tabs-v6.css';

export interface StaffAttendanceRow {
  id: number;
  date: string | null;
  location?: { name?: string | null; timezone?: string | null } | null;
  expectedStart: string | null;
  expectedEnd: string | null;
  checkInTime: string | null;
  checkOutTime: string | null;
  status: string;
  isLateCheckIn: boolean;
  lateMinutes: number | null;
  checkInImage?: string | null;
  checkOutImage?: string | null;
  checkInPhoto?: AttendancePhoto;
  checkOutPhoto?: AttendancePhoto;
}

export interface StaffAttendanceTabProps { staff: { attendances: StaffAttendanceRow[] }; displayPeriod: string }
export default function StaffAttendanceTab({ staff, displayPeriod }: StaffAttendanceTabProps) {
  const { t, language } = useLanguage();
  const locale = language === 'ur' ? 'ur-PK' : 'en-PK';
  const root = useRef<HTMLElement>(null);
  const [selected, setSelected] = useState<StaffAttendanceRow | null>(null);
  const [open, setOpen] = useState(false);
  const date = (value: string | null) => value ? new Date(value).toLocaleDateString(locale, { timeZone: 'UTC' }) : '—';
  const time = (value: string | null, timezone = 'UTC') => value ? formatInTimeZone(new Date(value), timezone, 'HH:mm') : '—';
  const timestamp = (value: string | null, timezone = 'UTC') => value ? new Date(value).toLocaleString(locale, { timeZone: timezone, day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false }) : '—';
  function openRecord(attendance: StaffAttendanceRow, focusRow = false) {
    if (focusRow) root.current?.querySelector(`[data-record-id="${attendance.id}"]`)?.closest<HTMLTableRowElement>('tr')?.focus();
    setSelected(attendance);
    setOpen(true);
  }
  const timeCell = (attendance: StaffAttendanceRow, kind: 'check-in' | 'check-out') => {
    const value = kind === 'check-in' ? attendance.checkInTime : attendance.checkOutTime;
    const photo = kind === 'check-in' ? attendance.checkInPhoto : attendance.checkOutPhoto;
    return <span className="wx-staff-tab-time"><bdi>{timestamp(value, attendance.location?.timezone ?? 'UTC')}</bdi>
      {photo?.state === 'AVAILABLE' ? <span role="img" aria-label={t('Photo available')}><Camera size={14} aria-hidden="true" /></span> : null}</span>;
  };
  const status = (attendance: StaffAttendanceRow) => getAttendanceDisplayStatus(attendance, new Date(), attendance.location?.timezone ?? 'UTC');
  const columns: Column<StaffAttendanceRow>[] = [
    { key: 'date', header: 'Date', render: row => <strong><bdi>{date(row.date)}</bdi></strong> },
    { key: 'location', header: 'Location', render: row => <bdi>{row.location?.name ?? '—'}</bdi> },
    { key: 'shift', header: 'Expected Shift', render: row => <bdi>{time(row.expectedStart, row.location?.timezone ?? 'UTC')} – {time(row.expectedEnd, row.location?.timezone ?? 'UTC')}</bdi> },
    { key: 'checkIn', header: 'Check In', render: row => timeCell(row, 'check-in') },
    { key: 'checkOut', header: 'Check Out', render: row => timeCell(row, 'check-out') },
    { key: 'status', header: 'Status', render: row => <StatusPill status={status(row)} tone={['ABSENT', 'MISSED_CHECKOUT'].includes(status(row)) ? 'bad' : status(row) === 'LATE' ? 'attention' : ['CHECKED_IN', 'CHECKED_OUT'].includes(status(row)) ? 'ok' : 'neutral'} /> },
    { key: 'late', header: 'Late', render: row => row.isLateCheckIn
      ? <span className="wx-staff-tab-warning">{t('{count} min late', { count: row.lateMinutes ?? 0 })}</span>
      : ['CHECKED_IN', 'CHECKED_OUT'].includes(status(row)) ? <span className="wx-staff-tab-ok">{t('On time')}</span> : '—' },
    { key: 'actions', header: 'Actions', className: 'wx-staff-tab-action-cell', render: row => <button type="button" className="wx-staff-tab-open" data-record-id={row.id} aria-label={t('Attendance context')} onClick={() => openRecord(row)}><ChevronRight size={18} aria-hidden="true" /></button> },
  ];
  // Keep the selected panel mounted on close so its note draft/exact retry survive.
  const active = selected ? staff.attendances.find(row => row.id === selected.id) ?? selected : null;
  return <section className="wx-staff-tab" aria-label={t('Attendance records')} ref={root}>
    <div className="wx-staff-tab-heading"><h2>{t('Attendance records')}</h2><p>{t('Attendance records for {period}.', { period: displayPeriod })}</p></div>
    <DataTable mobileCards pageSize={20} columns={columns} data={staff.attendances} rowKey={row => row.id}
      selectedRowKey={open ? selected?.id : null} onRowClick={row => openRecord(row, true)}
      emptyIcon={<Calendar size={32} aria-hidden="true" />} emptyMessage="No attendance records found for this period." />
    {active ? <AttendanceContext attendance={active} open={open} onOpenChange={setOpen} /> : null}
  </section>;
}
