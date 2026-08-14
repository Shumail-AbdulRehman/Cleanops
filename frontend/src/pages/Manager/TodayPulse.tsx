import { useId } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import StatusPill from '@/components/workspace/StatusPill';
import { useLanguage } from '@/i18n/context';
import { dailyLink, reviewLink, localTime, type OperationOverview } from './operations';
import './today-pulse-v6.css';

export type TodayPulseProps = { data: OperationOverview; params: URLSearchParams };

export default function TodayPulse({ data, params }: TodayPulseProps) {
  const { t, language } = useLanguage();
  const id = useId();
  const format = (value: number) => value.toLocaleString(language === 'ur' ? 'ur-PK' : 'en-PK');
  const { metrics, chart } = data;
  const segments = [
    { label: 'Work submitted', count: chart.submitted, status: 'submitted', tone: 'submitted' },
    { label: 'In progress', count: chart.inProgress, status: 'in-progress', tone: 'progress' },
    { label: 'Not started', count: chart.notStarted, status: 'not-started', tone: 'pending' },
    { label: 'Overdue', count: chart.overdue, status: 'overdue', tone: 'overdue' },
  ];
  // Attendance attention is a bounded preview, not an aggregate or scheduled - present.
  const missing = data.attention.filter(item => item.kind === 'attendance');

  return <section className="wx-today-pulse" aria-label={t('Daily summary')}>
    <section className="wx-today-pulse__panel" aria-labelledby={`${id}-attendance`}>
      <h2 id={`${id}-attendance`}>{t('Team attendance')}</h2>
      <div className="wx-today-pulse__figure">
        <strong><bdi>{format(metrics.present)}</bdi></strong>
        <span><bdi>/ {format(metrics.scheduled)}</bdi> {t('scheduled staff checked in')}</span>
      </div>
      <div className="wx-today-pulse__bar" role="img" aria-label={t('{present} of {scheduled} scheduled staff checked in', { present: format(metrics.present), scheduled: format(metrics.scheduled) })}>
        <span className="wx-today-pulse__attendance" style={{ inlineSize: `${metrics.scheduled > 0 ? Math.max(0, Math.min(100, metrics.present / metrics.scheduled * 100)) : 0}%` }} />
      </div>
      <Link className="wx-today-pulse__link" to={dailyLink(params, { tab: 'staff' })}>{t('View attendance')}<ArrowRight size={14} aria-hidden="true" /></Link>
    </section>

    <section className="wx-today-pulse__panel" aria-labelledby={`${id}-tasks`}>
      <h2 id={`${id}-tasks`}>{t('Today’s task progress')}</h2>
      <div className="wx-today-pulse__figure">
        <strong><bdi>{format(metrics.submitted)}</bdi></strong>
        <span><bdi>/ {format(metrics.totalTasks)}</bdi> {t('Work submitted')}</span>
      </div>
      <div className="wx-today-pulse__bar" role="img" aria-label={segments.map(segment => `${t(segment.label)}: ${format(segment.count)}`).join(', ')}>
        {metrics.totalTasks > 0 ? segments.filter(segment => segment.count > 0).map(segment => <span key={segment.status} className={`wx-today-pulse__segment--${segment.tone}`} style={{ flexGrow: segment.count, flexBasis: 0 }} />) : null}
      </div>
      <nav className="wx-today-pulse__legend" aria-label={t('Task status')}>
        {segments.map(segment => <Link key={segment.status} to={dailyLink(params, { tab: 'tasks', status: segment.status })}>
          <i className={`wx-today-pulse__segment--${segment.tone}`} aria-hidden="true" />
          <span>{t(segment.label)}</span>{' '}<strong><bdi>{format(segment.count)}</bdi></strong>
        </Link>)}
      </nav>
      {metrics.totalTasks === 0 ? <p className="wx-today-pulse__hint">{t('Nothing is scheduled yet')}</p> : null}
    </section>

    <section className="wx-today-pulse__panel" aria-labelledby={`${id}-attention`}>
      <h2 id={`${id}-attention`}>{t('Needs attention')}</h2>
      <nav className="wx-today-pulse__attention" aria-labelledby={`${id}-attention`}>
        <Link to={dailyLink(params, { tab: 'staff', attendance: 'absent' })} aria-describedby={`${id}-preview`}>
          <span>{t('Missing check-ins')}</span>{' '}<strong><bdi>{format(missing.length)}</bdi></strong>
        </Link>
        <Link to={dailyLink(params, { tab: 'tasks', status: 'overdue' })}>
          <span>{t('Overdue tasks')}</span>{' '}<strong><bdi>{format(chart.overdue)}</bdi></strong>
        </Link>
        <Link to={reviewLink(params)}>
          <span>{t('Photo reviews')}</span>{' '}<strong><bdi>{format(metrics.reviewCount)}</bdi></strong>
        </Link>
      </nav>
      <p id={`${id}-preview`} className="wx-today-pulse__hint">{t('Missing check-ins is a preview. Open attendance for the full list.')}</p>
    </section>
  </section>;
}

/** Kept separate so Today can place this compact context panel below its charts. */
export function TodayAside({ data, params }: TodayPulseProps) {
  const { t, language } = useLanguage();
  const id = useId();
  const format = (value: number) => value.toLocaleString(language === 'ur' ? 'ur-PK' : 'en-PK');
  const missing = data.attention.filter(item => item.kind === 'attendance');
  const upcoming = data.tasks.filter(task => !task.staffSubmittedAt && task.status !== 'CANCELLED' && task.status !== 'COMPLETED' && Date.parse(task.shiftStart) > Date.parse(data.asOf))
    .sort((a, b) => Date.parse(a.shiftStart) - Date.parse(b.shiftStart)).slice(0, 2);

  return <aside className="wx-today-aside" aria-label={t('Daily follow-up')}>
    <section className="wx-today-aside__section" aria-labelledby={`${id}-attention`}>
      <h2 id={`${id}-attention`}>{t('Needs attention')}</h2>
      <div className="wx-today-aside__signal">
        <div><strong>{t('Missing check-ins')}</strong><p>{t('Check expected attendance for this day.')}</p>
          {missing.slice(0, 2).map(item => <small key={item.key}><bdi>{item.staff?.name}</bdi></small>)}
        </div>
        <Link className="wx-today-pulse__link" to={dailyLink(params, { tab: 'staff', attendance: 'absent' })} aria-label={t('View missing check-ins')}>{t('View')}<ArrowRight size={14} aria-hidden="true" /></Link>
      </div>
      <div className="wx-today-aside__signal">
        <div><strong><bdi>{format(data.chart.overdue)}</bdi> {t('Overdue tasks')}</strong><p>{t('Past their scheduled end time')}</p></div>
        <Link className="wx-today-pulse__link" to={dailyLink(params, { tab: 'tasks', status: 'overdue' })} aria-label={t('View overdue tasks')}>{t('View')}<ArrowRight size={14} aria-hidden="true" /></Link>
      </div>
    </section>
    <section className="wx-today-aside__section" aria-labelledby={`${id}-reviews`}>
      <StatusPill tone={data.metrics.reviewCount > 0 ? 'attention' : 'neutral'}>{data.metrics.reviewCount > 0 ? 'Needs attention' : 'Photo reviews'}</StatusPill>
      <h2 id={`${id}-reviews`}>{data.metrics.reviewCount === 1 ? t('1 photo review needs attention') : <><bdi>{format(data.metrics.reviewCount)}</bdi> {t('photo reviews need attention')}</>}</h2>
      <p>{t('Inspect the evidence and record a decision in your review workspace.')}</p>
      <Link className="wx-today-pulse__link" to={reviewLink(params)}>{t('Open Photo Reviews')}<ArrowRight size={14} aria-hidden="true" /></Link>
    </section>
    <section className="wx-today-aside__section" aria-labelledby={`${id}-upcoming`}>
      <h2 id={`${id}-upcoming`}>{t('Coming up')}</h2>
      {upcoming.length ? <ul className="wx-today-aside__upcoming">{upcoming.map(task => <li key={task.id}>
        <Link to={dailyLink(params, { tab: 'tasks', taskId: String(task.id) })}>
          <time dateTime={task.shiftStart}><bdi>{localTime(task.shiftStart, task.location.timezone, language)}</bdi></time>
          <strong><bdi>{task.areaNameSnapshot ?? task.title}</bdi></strong>
          <span><bdi>{task.staff?.name ?? t('Unassigned')}</bdi> · <bdi>{task.location.name}</bdi></span>
        </Link>
      </li>)}</ul> : <p>{t('No upcoming tasks in the loaded summary.')}</p>}
    </section>
  </aside>;
}
