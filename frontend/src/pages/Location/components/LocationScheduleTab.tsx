import TaskQr from '@/pages/Task/components/TaskQr';
import { Link } from 'react-router-dom';
import PageLoadingSkeleton from '@/components/common/PageLoadingSkeleton';
import { verificationLabel } from '@/pages/Verification/presentation';
import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useSelector } from 'react-redux';
import { formatInTimeZone } from 'date-fns-tz';
import type { RootState } from '@/store/store';
import { Button } from '@/components/ui/button';
import { SidePanel } from '@/components/workspace/SidePanel';
import OperationsState from '@/pages/Manager/OperationsState';
import '@/pages/Task/schedule-v6.css';
import { useLocationSchedule } from '../queries';
import { useLocationLanguage } from '../locationTranslations';
import { moveWeek, normalizeWeek, type ScheduleItem } from '../scheduleTypes';
const basicStatuses:Record<string,string>={PENDING:'Pending',IN_PROGRESS:'In progress',COMPLETED:'Submitted',MISSED:'Missed',CANCELLED:'Cancelled'};
export default function LocationScheduleTab({ locationId }: { locationId: string }) {
  const {t,language}=useLocationLanguage();
  const dayLabel=(day:string,pattern:string)=>new Intl.DateTimeFormat(language==='ur'?'ur-PK':'en-PK',{timeZone:'UTC',...(pattern==='EEEE'?{weekday:'long' as const}:{day:'numeric' as const,month:'short' as const,...(pattern.includes('yyyy')?{year:'numeric' as const}:{})})}).format(new Date(`${day}T12:00:00Z`));
  const statusLabel=(item:ScheduleItem)=>t(item.kind==='planned'?'Planned':item.verificationVersion===2?verificationLabel(item):(basicStatuses[item.status??'']??'Scheduled'));
  const staffLabel=(item:ScheduleItem)=>item.staff?`${t(item.staffMeaning==='template-default'?'Default staff':'Assigned to')}: ${item.staff.name}`:t('Unassigned');
  const companyId = useSelector((state: RootState) => state.auth.user?.companyId);
  const [params, setParams] = useSearchParams();
  const week = normalizeWeek(params.get('week'));
  const query = useLocationSchedule(companyId, locationId, week);
  const [selected, setSelected] = useState<{ key: string; date: string } | null>(null);
  const denied = [401, 403, 404, 410].includes((query.error as { response?: { status?: number } } | null)?.response?.status ?? 0);
  const data = denied ? undefined : query.data;
  const selectedItem = data?.days.find((day) => day.date === selected?.date)?.items.find((item) => item.key === selected?.key);
  const setWeek = (value?: string) => {
    setSelected(null);
    setParams((previous) => {
      const next = new URLSearchParams(previous);
      if (value) next.set('week', value); else next.delete('week');
      return next;
    });
    if (!value && !week) void query.refetch();
  };
  // The compiler may inspect callback dependencies before the query resolves.
  const weekStart = data?.weekStart;
  const timezone = data?.location.timezone;
  const time = (value: string) => timezone ? formatInTimeZone(value, timezone, 'HH:mm') : '—';
  const fullTime=(value:string)=>new Intl.DateTimeFormat(language==='ur'?'ur-PK':'en-PK',{timeZone:timezone,dateStyle:'medium',timeStyle:'short'}).format(new Date(value));
  return <section className="wx-schedule wx-schedule-preview" aria-label={t("Weekly schedule")}>
    <div className="wx-schedule-heading">
      <div><h2>{t('Week at a glance')}</h2><p>{t('Planned tasks preview the automatic schedule. Assignments can change.')}</p></div>
      <div className="wx-schedule-actions">
        <Button variant="outline" disabled={!data || query.isFetching} onClick={() => { if (weekStart) setWeek(moveWeek(weekStart, -1)); }}>{t('Previous week')}</Button>
        <Button variant="outline" disabled={query.isFetching} onClick={() => setWeek()}>{t('This week')}</Button>
        <Button variant="outline" disabled={!data || query.isFetching} onClick={() => { if (weekStart) setWeek(moveWeek(weekStart, 1)); }}>{t('Next week')}</Button>
      </div>
    </div>
    {query.isPending ? <PageLoadingSkeleton layout="schedule" section />
      : data ? <>
        {query.isError && <OperationsState error={query.error} retry={() => void query.refetch()} />}
        <div className="wx-schedule-preview-meta"><p>{dayLabel(data.weekStart, 'd MMM')} – {dayLabel(data.days[6].date, 'd MMM yyyy')}</p><p>{t('Site time')}: <bdi>{data.location.timezone}</bdi>{query.isFetching ? ' · '+t('Updating…') : ''}</p></div>
        {data.days.every((day) => day.items.length === 0) && <p className="wx-schedule-preview-empty">{t('No tasks scheduled for this week.')}</p>}
        <div className="wx-schedule-preview-days">
          {data.days.map((day) => <div key={day.date} className="wx-schedule-preview-row">
            <h3>{dayLabel(day.date, 'EEEE')}<span className="wx-schedule-preview-day">{dayLabel(day.date, 'd MMM')}</span></h3>
            <div className="wx-schedule-preview-items">
              {day.items.length === 0 && <p className="wx-schedule-help">{t('No tasks')}</p>}
              {day.items.map((item) => <button type="button" key={item.key} onClick={() => setSelected({ key: item.key, date: day.date })} className="wx-schedule-occurrence">
                <span className="wx-schedule-occurrence-heading"><bdi>{item.title}{item.areaNameSnapshot?` · ${item.areaNameSnapshot}`:""}</bdi><span className="wx-schedule-occurrence-status" data-kind={item.kind}>{statusLabel(item)}</span></span>
                <span className="wx-schedule-occurrence-detail"><bdi dir="ltr">{time(item.startsAt)} – {time(item.endsAt)}</bdi> · {staffLabel(item)}</span>
                {(item.continuesFromPreviousDay || item.continuesIntoNextDay) && <span className="wx-schedule-occurrence-detail">{[item.continuesFromPreviousDay && t('Continues from previous day'), item.continuesIntoNextDay && t('Continues into next day')].filter(Boolean).join(' · ')}</span>}
              </button>)}
            </div>
          </div>)}
        </div>
      </> : <OperationsState error={query.error} retry={() => void query.refetch()} />}
    <SidePanel open={!!selected} onOpenChange={(open) => { if (!open) setSelected(null); }} title={selectedItem?.title ?? t('Task no longer available')} description={t(selectedItem?.kind === 'planned' ? 'Template preview. The scheduler creates the actual task when it is due.' : 'Read-only schedule details.')}><div className="wx-schedule-form">
      {selectedItem && data ? <div className="wx-schedule-stack"><p>{statusLabel(selectedItem)}</p><p>{staffLabel(selectedItem)}</p>{selectedItem.instanceId?<Link to={`/verification/${selectedItem.instanceId}`}>{t('Verification history')}</Link>:null}<p>{fullTime(selectedItem.startsAt)} – {fullTime(selectedItem.endsAt)}</p><p className="wx-schedule-help"><bdi>{data.location.name}</bdi> · <bdi>{data.location.timezone}</bdi></p>{selectedItem.instanceId && selectedItem.verificationVersion === 2 && !['COMPLETED','CANCELLED'].includes(selectedItem.status ?? '') ? <TaskQr taskId={selectedItem.instanceId} /> : null}</div> : <p className="wx-schedule-help">{t('The schedule has changed. Close this panel and refresh the week.')}</p>}
    </div></SidePanel>
  </section>;
}
