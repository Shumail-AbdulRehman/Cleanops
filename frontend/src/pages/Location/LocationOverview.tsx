import { Link } from 'react-router-dom';
import type { UseQueryResult } from '@tanstack/react-query';
import { ArrowRight } from 'lucide-react';
import { useAreas } from '../Area/queries';
import type { OperationOverview } from '../Manager/operations';
import { dailyLink, reviewLink } from '../Manager/operations';
import OperationsState from '../Manager/OperationsState';
import AttentionList from '@/components/common/AttentionList';
import TaskTicks from '@/components/workspace/TaskTicks';
import { useLocationLanguage } from './locationTranslations';
import type { LocationStaff } from './types';
import { formatInTimeZone } from 'date-fns-tz';
import './location-detail-v6.css';

function SummaryFigure({ count, total }: { count: number; total: number }) {
  const { t, language } = useLocationLanguage();
  const numbers = new Intl.NumberFormat(language === 'ur' ? 'ur-PK' : 'en-PK');
  // Preserve translated word order while giving the recorded numerator emphasis.
  const [before, after] = t('{count} of {total}', { count: '{count}', total: numbers.format(total) }).split('{count}');
  return <strong>{before ? <small>{before}</small> : null}<bdi>{numbers.format(count)}</bdi>{after ? <small>{after}</small> : null}</strong>;
}

export default function LocationOverview({ location, onTab, overview }: {
  location: { id: number; timezone: string; radiusMeters: number; staff: LocationStaff[] };
  onTab: (tab: 'areas' | 'staff') => void;
  overview: UseQueryResult<OperationOverview, Error>;
}) {
  const { t, language } = useLocationLanguage();
  const numbers = new Intl.NumberFormat(language === 'ur' ? 'ur-PK' : 'en-PK');
  const areas = useAreas(location.id);
  const params = new URLSearchParams({ locationId: String(location.id), date: 'today' });
  const status = (overview.error as { response?: { status?: number } } | null)?.response?.status;
  const facts = [401, 403, 404, 410].includes(status ?? 0) ? undefined : overview.data;
  const metrics = facts?.metrics;
  const activeAreas = areas.isError ? undefined : areas.data?.filter(area => area.status !== 'ARCHIVED').length;
  const shifts = [...new Set(location.staff.filter(person => person.isActive && person.shiftStart && person.shiftEnd).map(person => formatInTimeZone(new Date(person.shiftStart!), location.timezone, 'HH:mm') + '–' + formatInTimeZone(new Date(person.shiftEnd!), location.timezone, 'HH:mm')))];

  return <div className="wx-location-overview">
    <OperationsState loading={overview.isPending && !facts} skeleton="metrics" error={overview.error} retry={() => void overview.refetch()} />
    {metrics && facts ? <section className="wx-location-detail-summary" aria-label={t('Daily summary')}>
      <Link className="wx-location-detail-metric" to={dailyLink(params, { tab: 'staff' })}>
        <span>{t('Staff today')}</span>
        <SummaryFigure count={metrics.present} total={metrics.scheduled} />
        <p>{t('{present} checked in · {missing} not checked in', { present: metrics.present, missing: Math.max(0, metrics.scheduled - metrics.present) })}</p>
        <small>{t('Site-local day')}</small>
      </Link>
      <Link className="wx-location-detail-metric" to={dailyLink(params, { tab: 'tasks' })}>
        <span>{t('Tasks submitted')}</span>
        <SummaryFigure count={metrics.submitted} total={metrics.totalTasks} />
        <TaskTicks done={metrics.submitted} total={metrics.totalTasks} />
        <p>{t('{progress} in progress · {overdue} overdue', { progress: facts.chart.inProgress, overdue: facts.chart.overdue })}</p>
        <small>{t('Submission is not verification')}</small>
      </Link>
      <Link className="wx-location-detail-metric" to={reviewLink(params)}>
        <span>{t('Waiting for a decision')}</span>
        <strong><bdi>{numbers.format(metrics.reviewCount)}</bdi></strong>
        <span className="wx-location-detail-review-link">{t('View reviews')}<ArrowRight size={14} aria-hidden="true" /></span>
        <small>{t('Photo reviews')}</small>
      </Link>
    </section> : null}
    <div className="wx-location-detail-columns">
      <section className="wx-location-attention" aria-label={t('Today at this location')}>
        <div className="wx-location-detail-section-heading"><h2>{t('Today at this location')}</h2><p>{t('Start with the exceptions, then check the schedule.')}</p></div>
        {facts ? <AttentionList data={facts} params={params} limit={3} /> : <p className="wx-location-detail-guidance">{t(overview.isPending ? 'Checking today’s work…' : 'Today’s attendance and task totals are unavailable.')}</p>}
      </section>
      <section className="wx-location-detail-facts" aria-label={t('Location details')}>
        <div className="wx-location-detail-section-heading"><h2>{t('Location details')}</h2><p>{t('The facts used by attendance and scheduling.')}</p></div>
        <dl>
          <div><dt>{t('Timezone')}</dt><dd><bdi>{location.timezone}</bdi></dd></div>
          <div><dt>{t('Check-in radius')}</dt><dd><bdi>{t('{radius} m', { radius: numbers.format(location.radiusMeters) })}</bdi></dd></div>
          <div><dt>{t('Staff shifts')}</dt><dd>{shifts.length === 1 ? <bdi>{shifts[0]}</bdi> : t(shifts.length ? 'Shift times vary by worker' : 'No shift configured')}</dd></div>
        </dl>
        <p className="wx-location-detail-guidance">{t('Attendance uses the saved geofence and reported device location.')}</p>
        <button className="wx-location-detail-action wx-location-detail-text-action" type="button" onClick={() => onTab('staff')}>{t('Open team and shifts')}<ArrowRight size={14} aria-hidden="true" /></button>
        <button className="wx-location-detail-area-action" type="button" onClick={() => onTab('areas')}>
          <span><strong>{t('Area templates')}</strong><small>{t(areas.isError ? 'Area templates are unavailable.' : 'Reusable cleaning requirements')}</small><small>{t('Immutable task snapshots')}</small></span>
          <bdi>{activeAreas === undefined ? '—' : numbers.format(activeAreas)}</bdi><ArrowRight size={16} aria-hidden="true" />
        </button>
        {areas.isError ? <OperationsState error={areas.error} retry={() => void areas.refetch()} /> : null}
      </section>
    </div>
  </div>;
}
