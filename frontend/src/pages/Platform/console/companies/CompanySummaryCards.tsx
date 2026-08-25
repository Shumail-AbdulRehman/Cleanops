import { useId, type ReactNode } from 'react';
import { DonutChart, type PlanChartTone } from '@/components/platform-charts/DonutChart';
import { MiniBars } from '@/components/platform-charts/MiniBars';
import { RankedBars } from '@/components/platform-charts/RankedBars';
import { StatusStackBar } from '@/components/platform-charts/StatusStackBar';
import { useLanguage } from '@/i18n/context';
import type { PlanCode, PlatformOverviewResponse, SubscriptionState } from '../api/consoleApi';
import { formatCount } from '../api/consoleFormat';
import { useConsoleOverview } from '../api/consoleQueries';
import './company-summary.css';

const plans = {
  STARTER: { label: 'Starter', tone: 'starter' },
  PRO: { label: 'Pro', tone: 'pro' },
  ADVANCED: { label: 'Enterprise', tone: 'enterprise' },
} satisfies Record<PlanCode, { label: string; tone: PlanChartTone }>;

const subscriptionStates = [
  ['ACTIVE', 'Active', 'active'],
  ['PAST_DUE', 'Past due', 'past-due'],
  ['SCHEDULED_CANCEL', 'Scheduled to cancel', 'ending'],
  ['CANCELLED', 'Cancelled', 'cancelled'],
  ['NONE', 'Never paid', 'never'],
] as const satisfies readonly (readonly [SubscriptionState, string, string])[];

const monthName = new Intl.DateTimeFormat('en-US', { month: 'long', timeZone: 'Asia/Karachi' });
const monthAndYear = new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric', timeZone: 'Asia/Karachi' });

function SummaryCard({ title, children }: { title: string; children: ReactNode }) {
  const id = useId();
  return (
    <section className="px-company-summary-card" aria-labelledby={id}>
      <h2 id={id}>{title}</h2>
      {children}
    </section>
  );
}

function SummaryLegend({ label, rows }: {
  label: string;
  rows: readonly { label: string; tone: string; value: number | null }[];
}) {
  const { t } = useLanguage();
  return (
    <ul className="px-company-summary-legend" role="list" aria-label={label}>
      {rows.map(({ label, tone, value }) => (
        <li key={label}>
          <span><i data-tone={tone} aria-hidden="true" />{t(label)}</span>
          <strong>{t(formatCount(value))}</strong>
        </li>
      ))}
    </ul>
  );
}

function SignupSummary({ months }: Pick<PlatformOverviewResponse, 'months'>) {
  const { t } = useLanguage();
  const signups = months.map(({ month, signups }) => ({
    date: new Date(month),
    count: signups.STARTER + signups.PRO + signups.ADVANCED,
  }));
  const latest = signups.at(-1);
  const lastMonth = signups.at(-2);
  const history = signups.map(({ date, count }) =>
    t('{month}: {count}', { month: t(monthAndYear.format(date)), count: formatCount(count) }),
  ).join(', ');

  return (
    <SummaryCard title={t('Signed up this month')}>
      <p className="px-company-summary-figure">
        <strong>{t(formatCount(latest?.count ?? null))}</strong>
        <span>{lastMonth
          ? t('{count} in {month}', { count: formatCount(lastMonth.count), month: t(monthName.format(lastMonth.date)) })
          : t('Last month: {count}', { count: t('Not available') })}</span>
      </p>
      {signups.length > 0 && (
        <div className="px-company-summary-history" role="img"
          aria-label={t('Monthly sign-ups: {history}', { history })}>
          <MiniBars values={signups.map(({ count }) => count)} />
        </div>
      )}
    </SummaryCard>
  );
}

function StaffSummary({ companiesByPlan }: Pick<PlatformOverviewResponse, 'companiesByPlan'>) {
  const { t } = useLanguage();
  const populated = companiesByPlan.filter(({ companies }) => companies > 0);
  const companyCount = populated.reduce((sum, { companies }) => sum + companies, 0);
  const average = !companyCount || populated.some(({ averageStaff }) => averageStaff === null)
    ? null
    : populated.reduce((sum, { averageStaff, companies }) => sum + (averageStaff ?? 0) * companies, 0) / companyCount;
  const largest = !companyCount || populated.some(({ largestStaff }) => largestStaff === null)
    ? null
    : Math.max(...populated.map(({ largestStaff }) => largestStaff ?? 0));
  const formatAverage = (value: number) => formatCount(Math.round(value));

  return (
    <SummaryCard title={t('Staff per company')}>
      <p className="px-company-summary-figure">
        <strong>{average === null ? t(formatCount(null)) : formatAverage(average)}</strong>
        <span>{t('on average · largest {count}', { count: t(formatCount(largest)) })}</span>
      </p>
      <RankedBars label="Average staff by plan" rows={companiesByPlan.map(({ plan, averageStaff }) => ({
        name: plans[plan].label, value: averageStaff, tone: plans[plan].tone,
      }))} formatValue={formatAverage} />
    </SummaryCard>
  );
}

export function CompanySummaryCards() {
  const { t } = useLanguage();
  const { data, isPending, isError } = useConsoleOverview();

  if (isError) {
    return <p className="px-company-summary-error" role="status">{t('Company summary unavailable.')}</p>;
  }

  if (isPending) {
    return (
      <div className="px-company-summary" role="status" aria-label={t('Loading company summary')}>
        {['plan', 'subscription', 'signups', 'staff'].map((key) => (
          <div key={key} className="px-company-summary-card px-company-summary-skeleton" aria-hidden="true" />
        ))}
      </div>
    );
  }

  if (!data || data.figures.companies === 0) return null;

  const planParts = data.companiesByPlan.map(({ plan, companies }) => ({
    ...plans[plan], value: companies,
  }));

  return (
    <div className="px-company-summary">
      <SummaryCard title={t('All companies by plan')}>
        <div className="px-company-summary-plan">
          <DonutChart label="Companies by plan" parts={planParts} centerCaption="companies" formatValue={formatCount} />
          <SummaryLegend label={t('Plan counts')} rows={planParts} />
        </div>
      </SummaryCard>
      <SummaryCard title={t('By subscription')}>
        <StatusStackBar label="Companies by subscription" counts={data.statusCounts} />
        <SummaryLegend label={t('Subscription counts')} rows={subscriptionStates.map(([state, label, tone]) => ({
          label, tone, value: data.statusCounts[state],
        }))} />
      </SummaryCard>
      <SignupSummary months={data.months} />
      <StaffSummary companiesByPlan={data.companiesByPlan} />
    </div>
  );
}
