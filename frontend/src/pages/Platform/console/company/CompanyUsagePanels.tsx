import { useId, useState } from 'react';
import { CalendarHeatmap } from '@/components/platform-charts/CalendarHeatmap';
import { ChartTable } from '@/components/platform-charts/ChartTable';
import { ColumnChart } from '@/components/platform-charts/ColumnChart';
import { RankedBars } from '@/components/platform-charts/RankedBars';
import { RingGauge } from '@/components/platform-charts/RingGauge';
import { PLAN_LABELS } from '@/components/platform-charts/chartScale';
import { MeterRow } from '@/components/workspace/MeterRow';
import { useLanguage } from '@/i18n/context';
import type { PlanCode, PlatformCompanyInsightsResponse } from '../api/consoleApi';
import { formatCount } from '../api/consoleFormat';
import './company-usage.css';

const capacity = [
  { key: 'locations', label: 'Locations', limitName: 'locations' },
  { key: 'staff', label: 'Staff', limitName: 'staff' },
  { key: 'managers', label: 'Managers', limitName: 'managers' },
] as const;
const limitList = new Intl.ListFormat('en', { style: 'long', type: 'conjunction' });
const dayLabel = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Karachi', day: 'numeric', month: 'short' });

type UsageProps = Pick<PlatformCompanyInsightsResponse, 'usage' | 'limits'> & { plan: PlanCode };
type ActivityProps = Pick<PlatformCompanyInsightsResponse, 'activity30' | 'calendar35' | 'lastActiveAt'>;
type QualityProps = Pick<PlatformCompanyInsightsResponse, 'photos' | 'onTimeShare' | 'lastActiveAt'>;

export function CompanyUsagePanel({ usage, limits, plan }: UsageProps) {
  const { t } = useLanguage();
  const heading = useId();
  const reached = capacity.filter(({ key }) => usage[key] >= limits[key]);

  return (
    <section className="px-company-usage-panel" aria-labelledby={heading}>
      <header>
        <h2 id={heading}>{t('Usage against plan')}</h2>
        <p>{t('{plan} plan limits', { plan: t(PLAN_LABELS[plan]) })}</p>
      </header>
      <div className="px-company-capacity">
        {capacity.map(({ key, label }) => (
          <MeterRow
            key={key}
            name={t(label)}
            figure={t('{used} / {limit}', {
              used: t(formatCount(usage[key])),
              limit: t(formatCount(limits[key])),
            })}
            value={usage[key]}
            max={limits[key]}
            className={limits[key] > 1 && usage[key] >= limits[key] ? 'px-company-capacity-reached' : undefined}
          />
        ))}
      </div>
      {reached.length > 0 && (
        <p className="px-company-limit-note">{t('The owner has reached the plan limits for {limits} and cannot add more in those categories.', {
          limits: limitList.format(reached.map(({ limitName }) => t(limitName))),
        })}</p>
      )}
    </section>
  );
}

export function CompanyActivityPanel({ activity30, calendar35, lastActiveAt }: ActivityProps) {
  const { t } = useLanguage();
  const heading = useId();
  const view = useId();
  const [showTable, setShowTable] = useState(false);
  const hasWorked = lastActiveAt !== null;
  const points = activity30.map(({ day, count }) => ({ label: dayLabel.format(new Date(day)), value: count }));
  const calendar = calendar35.map(({ day, count }) => ({ date: day, count }));
  const tasks = activity30.reduce((total, { count }) => total + count, 0);
  const busiest = Math.max(0, ...calendar35.map(({ count }) => count));
  const daysWithWork = calendar35.filter(({ count }) => count > 0).length;
  const chartLabel = 'Tasks completed per day, last 30 days';

  return (
    <section className="px-company-usage-panel" aria-labelledby={heading}>
      <header className="px-company-activity-header">
        <div>
          <h2 id={heading}>{t('Activity')}</h2>
          <p>{t(chartLabel)}</p>
        </div>
        {hasWorked && (
          <button type="button" className="px-company-activity-toggle" aria-controls={view}
            onClick={() => setShowTable(current => !current)}>
            {t(showTable ? 'Chart' : 'Table')}
          </button>
        )}
      </header>
      {hasWorked ? (
        <>
          <div id={view}>
            {showTable
              ? <ChartTable label={chartLabel} data={points} labelHeading="Date" valueHeading="Tasks" />
              : <ColumnChart label={chartLabel} data={points} height={180} unit="tasks" />}
          </div>
          <div className="px-company-activity-calendar">
            <div>
              <h3>{t('Last 5 weeks')}</h3>
              <CalendarHeatmap label="Tasks completed per day over 5 weeks" days={calendar} unit="tasks" />
            </div>
            <dl className="px-company-activity-figures">
              <div>
                <dt>{t('Tasks, 30 days')}</dt>
                <dd>{t(formatCount(tasks))}</dd>
              </div>
              <div>
                <dt>{t('Busiest day')}</dt>
                <dd>{t(formatCount(busiest))}</dd>
              </div>
              <div>
                <dt>{t('Days with work')}</dt>
                <dd>{t('{worked} of {days}', { worked: daysWithWork, days: calendar.length })}</dd>
              </div>
            </dl>
          </div>
        </>
      ) : (
        <div className="px-company-activity-empty">
          <strong>{t('No activity yet')}</strong>
          <p>{t('This company has not started any work.')}</p>
        </div>
      )}
    </section>
  );
}

export function CompanyQualityPanel({ photos, onTimeShare, lastActiveAt }: QualityProps) {
  const { t } = useLanguage();
  const heading = useId();
  if (lastActiveAt === null) return null;

  const { passed, retake, manager, cleaning } = photos;
  const outcomes = passed + retake + manager + cleaning;
  const passShare = outcomes > 0 ? passed / outcomes * 100 : null;

  return (
    <section className="px-company-usage-panel" aria-labelledby={heading}>
      <header>
        <h2 id={heading}>{t('Work quality')}</h2>
        <p>{t('Last 30 days')}</p>
      </header>
      <div className="px-company-quality-rings">
        <figure>
          <RingGauge label="Photos passed" share={passShare} size={80} />
          <figcaption>{t('Photos passed')}</figcaption>
        </figure>
        <figure>
          <RingGauge label="Check-ins on time" share={onTimeShare === null ? null : onTimeShare * 100} tone="blue" size={80} />
          <figcaption>{t('Check-ins on time')}</figcaption>
        </figure>
      </div>
      <RankedBars label="Photo outcomes" formatValue={value => t(formatCount(value))} rows={[
        { name: 'Retake needed', value: retake, tone: 'warn' },
        { name: 'Sent to a manager', value: manager, tone: 'mid' },
        { name: 'Cleaning required', value: cleaning, tone: 'bad' },
      ]} />
    </section>
  );
}
