import { useId } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ChartTable } from '@/components/platform-charts/ChartTable';
import { ColumnChart } from '@/components/platform-charts/ColumnChart';
import { DonutChart, type PlanChartTone } from '@/components/platform-charts/DonutChart';
import { LineAreaChart } from '@/components/platform-charts/LineAreaChart';
import { StackedColumnChart } from '@/components/platform-charts/StackedColumnChart';
import { CHART_PLANS, PLAN_LABELS } from '@/components/platform-charts/chartScale';
import { SegmentedControl } from '@/components/workspace/SegmentedControl';
import { useLanguage } from '@/i18n/context';
import type { PlanCode, PlatformOverviewResponse } from '../api/consoleApi';
import { formatCount, formatMoney } from '../api/consoleFormat';
import './overview-revenue.css';

export type OverviewRevenueProps = Pick<PlatformOverviewResponse, 'months' | 'plans'> & {
  figures: Pick<PlatformOverviewResponse['figures'], 'paying' | 'mrrChange'>;
};

const revenueModes = [
  { value: 'recurring', label: 'Recurring' },
  { value: 'collected', label: 'Collected' },
];
const planTones: Record<PlanCode, PlanChartTone> = {
  STARTER: 'starter',
  PRO: 'pro',
  ADVANCED: 'enterprise',
};
const monthFormat = new Intl.DateTimeFormat('en-US', {
  month: 'short', year: '2-digit', timeZone: 'UTC',
});
const changeFormat = new Intl.NumberFormat('en-US', {
  style: 'percent', maximumFractionDigits: 1, signDisplay: 'exceptZero',
});

function TableToggle({ label, showTable, onToggle }: {
  label: string;
  showTable: boolean;
  onToggle: () => void;
}) {
  const { t } = useLanguage();
  return (
    <button className="px-overview-revenue-toggle" type="button" onClick={onToggle}
      aria-label={t('{view} for {panel}', { view: t(showTable ? 'Chart' : 'Table'), panel: t(label) })}>
      {t(showTable ? 'Chart' : 'Table')}
    </button>
  );
}

export function OverviewRevenue({ figures, months, plans }: OverviewRevenueProps) {
  const { t } = useLanguage();
  const id = useId();
  const [params, setParams] = useSearchParams();
  const collected = params.get('revenue') === 'collected';
  const revenueTable = params.get('revenueView') === 'table';
  const signupsTable = params.get('signupsView') === 'table';

  function setView(key: string, value: string | null) {
    setParams(current => {
      const next = new URLSearchParams(current);
      if (value === null) next.delete(key);
      else next.set(key, value);
      return next;
    }, { preventScrollReset: true });
  }

  const series = months.map(month => ({
    label: monthFormat.format(new Date(`${month.month}-01T00:00:00Z`)),
    money: collected ? month.collected : month.mrrEstimate,
    signups: month.signups,
  }));
  const currencies = new Set(series.flatMap(({ money }) => money === null ? [] : [money.currency]));
  const currency = currencies.size === 1 ? currencies.values().next().value : undefined;
  const revenueData = series.map(({ label, money }) => ({ label, value: money?.amount ?? null }));
  const signupData = series.map(({ label, signups }) => ({ label, parts: signups }));
  const partialLast = months.at(-1)?.partial;
  const hasRevenueChart = currency !== undefined && revenueData.every(({ value }) => value !== null);
  const RevenueChart = collected ? ColumnChart : LineAreaChart;

  const revenueLabel = collected ? 'Collected payments' : 'Estimated recurring revenue';
  const revenueDescription = collected ? 'Completed payments per month' : 'Estimated recurring revenue at each month end';
  const payingLabel = 'Paying companies by plan';
  const signupsLabel = 'Sign-ups by plan';
  const planDetails = CHART_PLANS.map(plan => ({
    plan,
    label: PLAN_LABELS[plan],
    tone: planTones[plan],
    metrics: plans.find(row => row.plan === plan),
  }));

  return (
    <div className="px-overview-revenue">
      <section className="px-overview-revenue-panel px-overview-revenue-history" aria-labelledby={`${id}-revenue`}>
        <header className="px-overview-revenue-header">
          <div>
            <h2 id={`${id}-revenue`}>{t('Revenue')}</h2>
            <p>{t(revenueDescription)}{currency && t(' ({currency})', { currency })}</p>
          </div>
          <div className="px-overview-revenue-controls">
            <SegmentedControl className="px-overview-revenue-modes" label="Revenue type"
              value={collected ? 'collected' : 'recurring'} options={revenueModes}
              onChange={value => setView('revenue', value === 'collected' ? value : null)} />
            <TableToggle label="Revenue" showTable={revenueTable}
              onToggle={() => setView('revenueView', revenueTable ? null : 'table')} />
          </div>
        </header>
        {revenueTable && series.length > 0 && currencies.size <= 1 ? (
          <ChartTable label={revenueLabel} data={revenueData} money={currency} labelHeading="Month"
            valueHeading={revenueLabel} partialLast={collected && partialLast} />
        ) : hasRevenueChart ? (
          <RevenueChart label={revenueLabel} data={revenueData} money={currency}
            average="12-month average" partialLast={collected && partialLast} />
        ) : (
          <p className="px-overview-revenue-unavailable">{t('Not available')}</p>
        )}
        {!collected && (
          <p className="px-overview-revenue-change">
            <span>{t('Change from the month before')}</span>
            <strong>{figures.mrrChange === null ? t('Not available') : changeFormat.format(figures.mrrChange)}</strong>
          </p>
        )}
      </section>

      <section className="px-overview-revenue-panel px-overview-revenue-paying" aria-labelledby={`${id}-paying`}>
        <header className="px-overview-revenue-header">
          <div>
            <h2 id={`${id}-paying`}>{t(payingLabel)}</h2>
            <p>{t('With the recurring revenue each plan brings')}</p>
          </div>
        </header>
        <div className="px-overview-revenue-plan-details">
          <DonutChart label={payingLabel} centerValue={figures.paying} centerCaption="paying" formatValue={formatCount}
            parts={planDetails.map(({ label, tone, metrics }) => ({ label, tone, value: metrics?.paying ?? null }))} />
          <ul className="px-overview-revenue-plan-legend">
            {planDetails.map(({ plan, label, tone, metrics }) => (
              <li key={plan}>
                <span className="px-overview-revenue-swatch" data-tone={tone} aria-hidden="true" />
                <span>
                  {t(label)}
                  <small>{metrics?.mrr == null ? t('Not available') : t('{amount}/mo', { amount: formatMoney(metrics.mrr) })}</small>
                </span>
                <strong>{t(formatCount(metrics?.paying ?? null))}</strong>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="px-overview-revenue-panel px-overview-revenue-signups" aria-labelledby={`${id}-signups`}>
        <header className="px-overview-revenue-header">
          <div>
            <h2 id={`${id}-signups`}>{t(signupsLabel)}</h2>
            <p>{t('New companies per month, split by the plan they chose')}</p>
          </div>
          <TableToggle label={signupsLabel} showTable={signupsTable}
            onToggle={() => setView('signupsView', signupsTable ? null : 'table')} />
        </header>
        {series.length === 0 ? (
          <p className="px-overview-revenue-unavailable">{t('Not available')}</p>
        ) : signupsTable ? (
          <ChartTable label={signupsLabel} data={signupData} labelHeading="Month" partialLast={partialLast} />
        ) : (
          <StackedColumnChart label={signupsLabel} data={signupData} partialLast={partialLast} />
        )}
        <ul className="px-overview-revenue-signup-legend">
          {planDetails.map(({ plan, label, tone }) => (
            <li key={plan}>
              <span className="px-overview-revenue-swatch" data-tone={tone} aria-hidden="true" />
              {t(label)}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
