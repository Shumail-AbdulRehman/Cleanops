import { useId, useRef, useState, type FormEvent } from 'react';
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import useAuth from '@/hooks/useAuth';
import { useLanguage } from '@/i18n/context';
import { Button } from '@/components/ui/button';
import SidePanel, { SidePanelFieldError, SidePanelFooter } from '@/components/workspace/SidePanel';
import ProtectedAttendancePhoto, { type AttendancePhoto } from '@/components/common/ProtectedAttendancePhoto';
import StatusPill from '@/components/workspace/StatusPill';
import { appendAttendanceContext, getAttendanceContext, type AnnotationRequest } from './contextApi';
import './attendance-panel-v6.css';

export type AttendanceCapture = {
  id: number;
  date: string | null;
  expectedStart: string | null;
  expectedEnd: string | null;
  checkInTime: string | null;
  checkOutTime: string | null;
  status: string;
  location?: { name?: string | null; timezone?: string | null } | null;
  checkInPhoto?: AttendancePhoto;
  checkOutPhoto?: AttendancePhoto;
};
export type AttendanceContextProps = { attendance: AttendanceCapture; staffName?: string } & (
  { open: boolean; onOpenChange: (open: boolean) => void } |
  { open?: never; onOpenChange?: never }
);
const forbiddenControls = (value: string) => [...value].some(character => {
  const code = character.charCodeAt(0);
  return code < 32 && ![9, 10, 13].includes(code) || code === 127;
});
const statusOf = (error: unknown) => (error as { response?: { status?: number } })?.response?.status;

export default function AttendanceContext(props: AttendanceContextProps) {
  const { user } = useAuth();
  if (!user) return null;
  // Drafts and protected bytes never survive a principal/tenant/record change.
  // Controlled callers own the open state; legacy callers reset it on remount.
  return <ScopedContext key={`${user.companyId}:${user.role}:${user.id}:${props.attendance.id}`} {...props} />;
}

function ScopedContext({ attendance, staffName, open: controlledOpen, onOpenChange }: AttendanceContextProps) {
  const { user } = useAuth();
  const { t, language } = useLanguage();
  const queryClient = useQueryClient();
  const reasonId = useId();
  const [localOpen, setLocalOpen] = useState(false);
  const open = controlledOpen ?? localOpen;
  const setOpen = onOpenChange ?? setLocalOpen;
  const [reason, setReason] = useState('');
  const [parentId, setParentId] = useState<string | null>(null);
  const [request, setRequest] = useState<AnnotationRequest | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<number | 'unknown' | null>(null);
  const [invalid, setInvalid] = useState(false);
  const [saved, setSaved] = useState(false);
  const busy = useRef(false);
  const queryKey = ['attendance-context', user?.companyId, user?.role, user?.id, attendance.id];
  const history = useInfiniteQuery({
    queryKey,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) => getAttendanceContext(attendance.id, pageParam, signal),
    getNextPageParam: page => page.nextCursor ?? undefined,
    enabled: open,
    staleTime: 0,
    refetchOnMount: 'always',
  });
  const denied = [401, 403, 404].includes(statusOf(history.error) ?? 0);
  const entries = denied ? [] : history.data?.pages.flatMap(page => page.items) ?? [];
  const acknowledge = user?.role === 'ADMIN' || user?.role === 'MANAGER';
  const timezone = attendance.location?.timezone || 'UTC';
  const timestamp = (value: string | null, timeOnly = false) => value && Number.isFinite(Date.parse(value))
    ? new Intl.DateTimeFormat(language === 'ur' ? 'ur-PK' : 'en-PK', {
      timeZone: timezone, dateStyle: timeOnly ? undefined : 'medium', timeStyle: 'short',
    }).format(new Date(value)) : t('Not recorded');
  const day = attendance.date && Number.isFinite(Date.parse(attendance.date))
    ? new Intl.DateTimeFormat(language === 'ur' ? 'ur-PK' : 'en-PK', { timeZone: 'UTC', dateStyle: 'medium' }).format(new Date(attendance.date))
    : t('Not recorded');
  const missingCheckOut = attendance.status === 'MISSED_CHECKOUT' ? 'Missed checkout'
    : attendance.checkInTime && ['CHECKED_IN', 'LATE'].includes(attendance.status) ? 'Not checked out yet' : 'No check-out recorded';

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy.current || !history.isSuccess || history.isError) return;
    const trimmed = reason.trim();
    if (!request && (!trimmed || trimmed.length > 1000 || forbiddenControls(trimmed))) {
      setInvalid(true);
      document.getElementById(reasonId)?.focus();
      return;
    }
    const intent = request ?? {
      requestId: crypto.randomUUID(), reason: trimmed,
      ...(parentId ? { kind: 'ACKNOWLEDGEMENT' as const, parentId } : { kind: 'NOTE' as const }),
    };
    busy.current = true;
    setRequest(intent);
    setSaving(true);
    setError(null);
    setInvalid(false);
    setSaved(false);
    try {
      await appendAttendanceContext(attendance.id, intent);
      setReason('');
      setParentId(null);
      setRequest(null);
      setSaved(true);
      await queryClient.invalidateQueries({ queryKey });
    } catch (failure) {
      setError(statusOf(failure) ?? 'unknown');
    } finally {
      busy.current = false;
      setSaving(false);
    }
  }

  return <>
    {controlledOpen === undefined ? <Button type="button" variant="outline" className="wx-attendance-action" onClick={() => setOpen(true)}>{t('Attendance context')}</Button> : null}
    <SidePanel open={open} onOpenChange={setOpen} title={`${t('Attendance context')} · #${attendance.id}`}
      description={`${staffName ? `${staffName} · ` : ''}${day}`}
      footer={<SidePanelFooter>
        <Button className="wx-attendance-action" type="submit" form={`${reasonId}-form`} aria-busy={saving} disabled={saving || !history.isSuccess || history.isError || error === 409}>{t(saving ? 'Recording context…' : request ? 'Retry same request' : parentId ? 'Record acknowledgement' : 'Record note')}</Button>
        {parentId && !request ? <Button className="wx-attendance-action" type="button" variant="outline" onClick={() => setParentId(null)}>{t('Add a note instead')}</Button> : null}
        <Button className="wx-attendance-action" type="button" variant="outline" onClick={() => setOpen(false)}>{t('Close')}</Button>
      </SidePanelFooter>}>
      <div className="wx-attendance-record">
      <div className="wx-attendance-photos">
        {(['check-in', 'check-out'] as const).map(kind => {
          const value = kind === 'check-in' ? attendance.checkInTime : attendance.checkOutTime;
          const missing = kind === 'check-in' ? 'No check-in recorded' : missingCheckOut;
          return <figure className="wx-attendance-photo-card" key={kind}>
            {open ? <ProtectedAttendancePhoto attendanceId={attendance.id} kind={kind} presentation="tile"
              photo={kind === 'check-in' ? attendance.checkInPhoto : attendance.checkOutPhoto}
              missingMessage={!value ? missing : undefined} /> : null}
            <figcaption><strong>{t(kind === 'check-in' ? 'Check-in' : 'Check-out')}</strong>
              {value ? <time dateTime={value}><bdi>{timestamp(value, true)}</bdi></time> : <span>{t('Not recorded')}</span>}
            </figcaption>
          </figure>;
        })}
      </div>
      <p className="wx-attendance-help">{t('Photos are available only to authorized accounts.')}</p>
      <p className="wx-attendance-help">{t('Notes add context. Original attendance, photos and paid hours are not changed.')}</p>
      <section className="wx-attendance-facts" aria-labelledby={`${reasonId}-capture`}>
        <h2 id={`${reasonId}-capture`}>{t('Original captured facts')}</h2>
        {staffName ? <p><bdi>{staffName}</bdi></p> : null}
        <p><bdi>{attendance.location?.name ?? t('Location unavailable')}</bdi> · <bdi>{timezone}</bdi></p>
        <dl>
          <dt>{t('Attendance day')}</dt><dd><bdi>{day}</bdi></dd>
          <dt>{t('Expected start')}</dt><dd><bdi>{timestamp(attendance.expectedStart)}</bdi></dd>
          <dt>{t('Expected end')}</dt><dd><bdi>{timestamp(attendance.expectedEnd)}</bdi></dd>
          <dt>{t('Captured check-in')}</dt><dd><bdi>{timestamp(attendance.checkInTime)}</bdi></dd>
          <dt>{t('Captured check-out')}</dt><dd><bdi>{timestamp(attendance.checkOutTime)}</bdi></dd>
          <dt>{t('Captured status')}</dt><dd><StatusPill tone={['ABSENT', 'MISSED_CHECKOUT'].includes(attendance.status) ? 'bad' : attendance.status === 'CHECKED_OUT' ? 'ok' : 'neutral'} status={attendance.status} /></dd>
        </dl>
      </section>
      <section className="wx-attendance-history" aria-labelledby={`${reasonId}-history`}>
        <h2 id={`${reasonId}-history`}>{t('Recorded context')}</h2>
        {history.isPending ? <div className="wx-attendance-loading" role="status" aria-busy="true"><span>{t('Loading attendance context…')}</span><div aria-hidden="true" /><div aria-hidden="true" /></div> : null}
        {history.isError ? <div role="alert"><p>{t(denied ? 'This attendance context is no longer available to your account.' : 'Context could not load. Your draft is kept.')}</p>
          <p>{t('Original attendance, photos and paid hours remain unchanged.')}</p>
          <Button className="wx-attendance-action" type="button" variant="outline" disabled={history.isFetching} onClick={() => void history.refetch()}>{t('Refresh context')}</Button></div> : null}
        {history.isSuccess && !entries.length ? <p>{t('No context has been recorded.')}</p> : null}
        <ol>{entries.map(entry => <li key={entry.id}>
          <div className="wx-attendance-attribution"><strong>{t(entry.kind === 'NOTE' ? 'Note' : 'Acknowledgement')}</strong>
            <span>{t(entry.actorRole === 'ADMIN' ? 'Company owner' : entry.actorRole === 'MANAGER' ? 'Manager' : 'Worker')} <bdi>#{entry.actorId}</bdi></span>
            <time dateTime={entry.createdAt}><bdi>{timestamp(entry.createdAt)}</bdi></time></div>
          <p className="wx-attendance-reason" dir="auto">{entry.reason}</p>
          {entry.parentId ? <p>{t('Acknowledges note')} <bdi>{entry.parentId}</bdi></p> : null}
          <p className="wx-attendance-reference">{t('Record reference')} <bdi>{entry.id}</bdi></p>
          {acknowledge && entry.kind === 'NOTE' ? <Button className="wx-attendance-action" type="button" variant="outline" disabled={!!request || history.isError} onClick={() => { setParentId(entry.id); setSaved(false); document.getElementById(reasonId)?.focus(); }}>{t('Acknowledge note')}</Button> : null}
        </li>)}</ol>
        {history.hasNextPage && !history.isError ? <Button className="wx-attendance-action" type="button" variant="outline" disabled={history.isFetchingNextPage} onClick={() => void history.fetchNextPage()}>{t(history.isFetchingNextPage ? 'Loading more context…' : 'Load more recorded context')}</Button> : null}
      </section>
      <form id={`${reasonId}-form`} className="wx-attendance-form" aria-busy={saving} onSubmit={event => void submit(event)} noValidate>
        <h2>{t(parentId ? 'Add acknowledgement' : 'Add attendance note')}</h2>
        {parentId ? <p>{t('Acknowledges note')} <bdi>{parentId}</bdi></p> : null}
        <label htmlFor={reasonId}>{t('Reason (required)')}</label>
        <textarea id={reasonId} value={reason} readOnly={!!request} disabled={denied} maxLength={1000} required aria-invalid={invalid} aria-describedby={`${reasonId}-help${invalid ? ` ${reasonId}-error` : ''}`} onChange={event => { setReason(event.target.value); setInvalid(false); setSaved(false); }} />
        <p id={`${reasonId}-help`}>{t('Use 1–1000 characters. Saved notes cannot be edited or deleted.')}</p><p>{t('Original attendance, photos and paid hours remain unchanged.')}</p>
        <SidePanelFieldError id={`${reasonId}-error`}>{invalid ? 'Enter a reason of 1–1000 characters without control characters.' : null}</SidePanelFieldError>
        {error ? <div role="alert"><p>{t(error === 409 ? 'Request conflict. Refresh context; your draft is kept.' : [401, 403, 404].includes(Number(error)) ? 'Your account cannot save context for this attendance. Your draft is kept.' : 'Saving was not confirmed. Your draft is locked for an exact retry to prevent duplicate notes.')}</p>
          {error === 409 ? <Button className="wx-attendance-action" type="button" variant="outline" disabled={history.isFetching} onClick={async () => { const refreshed = await history.refetch(); if (refreshed.isSuccess) { setRequest(null); setError(null); } }}>{t('Review conflict and edit draft')}</Button> : null}</div> : null}
        {saved ? <p role="status">{t('Context recorded. Original attendance is unchanged.')}</p> : null}
      </form></div>
    </SidePanel>
  </>;
}
