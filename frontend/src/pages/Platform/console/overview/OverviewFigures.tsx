import { Link } from 'react-router-dom';
import { LineAreaChart } from '@/components/platform-charts/LineAreaChart';
import { MiniBars } from '@/components/platform-charts/MiniBars';
import { RingGauge } from '@/components/platform-charts/RingGauge';
import { useLanguage } from '@/i18n/context';
import type { PlatformOverviewResponse } from '../api/consoleApi';
import { formatCount, formatMoney } from '../api/consoleFormat';
import './overview-figures.css';

type Figures = PlatformOverviewResponse['figures'];
type Month = PlatformOverviewResponse['months'][number];

export interface OverviewFiguresProps {
  figures: { [Key in keyof Figures]: Figures[Key] | null };
  months: readonly (Omit<Month, 'signups'> & { signups: Month['signups'] | null })[];
  checkinsPerDay: readonly PlatformOverviewResponse['checkinsPerDay'][number][] | null;
}

const signedPercent = new Intl.NumberFormat('en-US', {
  style: 'percent',
  signDisplay: 'exceptZero',
  maximumFractionDigits: 1,
});

export function OverviewFigures({ figures, months, checkinsPerDay }: OverviewFiguresProps) {
  const { t } = useLanguage();
  const { companies, newThisMonth, paying, payingShare, mrr, mrrChange, pastDue, activeStaff } = figures;
  const pastDueCount = pastDue?.length ?? null;
  const newPlatform = companies === 0 && paying === 0 && pastDueCount === 0 && activeStaff === 0;

  const revenueCurrency = mrr?.currency ?? months.find(month => month.mrrEstimate !== null)?.mrrEstimate?.currency;
  const revenue = months.map(({ month, mrrEstimate }) => ({
    label: month,
    value: mrrEstimate && mrrEstimate.currency === revenueCurrency ? mrrEstimate.amount : null,
  }));
  const signups = months.map(({ signups }) =>
    signups === null ? null : signups.STARTER + signups.PRO + signups.ADVANCED);
  const checkins = checkinsPerDay?.map(({ count }) => count);

  return (
    <section className="px-overview-figures" aria-label={t('Overview figures')}>
      <article className="px-overview-figure px-overview-figure--revenue">
        <h2>{t('Monthly recurring revenue')}</h2>
        <div className="px-overview-figure-value-line">
          <span className="px-overview-figure-value">{t(formatMoney(mrr))}</span>
          {mrr !== null && <span className="px-overview-figure-unit">{t('per month')}</span>}
        </div>
        {newPlatform && mrr?.amount === 0 && <p>{t('No paid subscriptions yet')}</p>}
        {!newPlatform && mrr !== null && mrrChange !== null && (
          <p className="px-overview-figure-change" data-direction={Math.sign(mrrChange)}>
            {t('{change} since the end of last month', { change: signedPercent.format(mrrChange) })}
          </p>
        )}
        {!newPlatform && revenue.some(({ value }) => value !== null) && (
          <div className="px-overview-figure-trend">
            <LineAreaChart compact label={t('Estimated monthly recurring revenue, last 12 months')}
              data={revenue} money={revenueCurrency} partialLast={months.at(-1)?.partial} />
          </div>
        )}
        <p className="px-overview-figure-footnote">
          {t(newPlatform
            ? 'Counts subscriptions once they are paid.'
            : 'Paid subscriptions at plan price; past due left out.')}
        </p>
      </article>

      <article className="px-overview-figure">
        <h2><Link to="/platform/companies">{t('Companies')}</Link></h2>
        <span className="px-overview-figure-value">{t(formatCount(companies))}</span>
        {newThisMonth === null && (
          <p>{t('Sign-ups this month: {count}', { count: t(formatCount(newThisMonth)) })}</p>
        )}
        {newThisMonth === 0 && <p>{t('None this month')}</p>}
        {newThisMonth !== null && newThisMonth > 0 && (
          <p>{t('+{count} signed up this month', { count: t(formatCount(newThisMonth)) })}</p>
        )}
        {!newPlatform && signups.some(value => value !== null) && (
          <div className="px-overview-figure-trend" role="img"
            aria-label={t('Monthly sign-ups, oldest to newest. {counts}', {
              counts: signups.map(count => t(formatCount(count))).join(', '),
            })}>
            <MiniBars values={signups} />
          </div>
        )}
      </article>

      <article className="px-overview-figure px-overview-figure--paying">
        <div>
          <h2><Link to="/platform/subscriptions">{t('Paying companies')}</Link></h2>
          <span className="px-overview-figure-value">{t(formatCount(paying))}</span>
          {!newPlatform && companies !== null && <p>{t('of {count} companies', { count: t(formatCount(companies)) })}</p>}
        </div>
        {!newPlatform && payingShare !== null && (
          <RingGauge label={t('Share of companies paying')} share={payingShare * 100} size={64} tone="blue" />
        )}
        {!newPlatform && payingShare === null && (
          <p>{t('Paying share: {share}', { share: t(formatCount(payingShare)) })}</p>
        )}
      </article>

      <article className="px-overview-figure" data-attention={pastDueCount !== null && pastDueCount > 0 ? 'true' : undefined}>
        <h2><Link to="/platform/companies?subscription=PAST_DUE">{t('Past due')}</Link></h2>
        <span className="px-overview-figure-value">{t(formatCount(pastDueCount))}</span>
        {pastDueCount === 0 && <p>{t('All payments current')}</p>}
        {pastDue && pastDue.length > 0 && (
          <>
            <p>{t('Paddle is retrying payment')}</p>
            <ul className="px-overview-figure-past-due" role="list">
              {pastDue.map(({ companyId, name, monthly }) => (
                <li key={companyId}>
                  <span>{name}</span>
                  <span>{t(formatMoney(monthly))}</span>
                </li>
              ))}
            </ul>
          </>
        )}
      </article>

      <article className="px-overview-figure">
        <h2>{t('Staff using the app')}</h2>
        <span className="px-overview-figure-value">{t(formatCount(activeStaff))}</span>
        <p>{t('Check-ins per day, last 14 days')}</p>
        {!newPlatform && checkins?.length ? (
          <div className="px-overview-figure-trend" role="img"
            aria-label={t('Daily check-ins, oldest to newest. {counts}', {
              counts: checkins.map(count => t(formatCount(count))).join(', '),
            })}>
            <MiniBars values={checkins} />
          </div>
        ) : null}
      </article>
    </section>
  );
}
