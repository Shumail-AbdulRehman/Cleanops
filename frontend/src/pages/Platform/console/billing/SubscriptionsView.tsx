import { useId, useState } from 'react';
import { ExternalLink } from 'lucide-react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import DataTable, { type Column } from '@/components/common/DataTable';
import EmptyState from '@/components/common/EmptyState';
import { RankedBars } from '@/components/platform-charts/RankedBars';
import { Button } from '@/components/ui/button';
import ChipGroup from '@/components/workspace/ChipGroup';
import StatusPill, { type StatusPillTone } from '@/components/workspace/StatusPill';
import { useLanguage } from '@/i18n/context';
import type { PlanCode, PlatformSubscriptionsResponse, SubscriptionState } from '../api/consoleApi';
import { formatCount, formatDate, formatMoney, NOT_AVAILABLE } from '../api/consoleFormat';
import { useConsoleCompanies, useConsoleSubscriptions } from '../api/consoleQueries';
import { BillingTabs } from './BillingTabs';
import './billing.css';

type Subscription = PlatformSubscriptionsResponse['items'][number];
type Summary = PlatformSubscriptionsResponse['summary'];
type ListedStatus = Exclude<SubscriptionState, 'NONE'>;

const plans = {
  STARTER: { name: 'Starter', tone: 'starter' },
  PRO: { name: 'Pro', tone: 'pro' },
  ADVANCED: { name: 'Enterprise', tone: 'enterprise' },
} as const satisfies Record<PlanCode, { name: string; tone: string }>;

const statuses: Record<SubscriptionState, { label: string; tone: StatusPillTone }> = {
  ACTIVE: { label: 'Active', tone: 'ok' },
  PAST_DUE: { label: 'Past due', tone: 'attention' },
  SCHEDULED_CANCEL: { label: 'Scheduled to cancel', tone: 'attention' },
  CANCELLED: { label: 'Cancelled', tone: 'neutral' },
  NONE: { label: NOT_AVAILABLE, tone: 'neutral' },
};

const filters: readonly ListedStatus[] = ['ACTIVE', 'PAST_DUE', 'SCHEDULED_CANCEL', 'CANCELLED'];
const dateLabels: Partial<Record<SubscriptionState, string>> = {
  ACTIVE: 'Renews {date}',
  SCHEDULED_CANCEL: 'Ends {date}',
  CANCELLED: 'Ended {date}',
};

function companyPath(companyId: number) {
  return `/platform/companies/${companyId}`;
}

function EndingCompanyMonthlyValue({ companyId, name, after }: {
  companyId: number;
  name: string;
  after?: string;
}) {
  const { t } = useLanguage();
  const { data, isPending, isError } = useConsoleCompanies({ q: name, subscription: 'SCHEDULED_CANCEL', after });
  if (isPending) return <span role="status">{t('Loading…')}</span>;
  if (isError) return t(NOT_AVAILABLE);

  const company = data?.items.find(({ id }) => id === companyId);
  if (!company && data?.nextCursor) {
    return <EndingCompanyMonthlyValue companyId={companyId} name={name} after={data.nextCursor} />;
  }

  return t(formatMoney(company?.monthly ?? null));
}

function SubscriptionSummary({ summary }: { summary: Summary }) {
  const { t } = useLanguage();
  const id = useId();
  const currencies = new Set(summary.mrrByPlan.flatMap(({ mrr }) => mrr ? [mrr.currency] : []));
  const [currency] = currencies;
  const maxRenewals = Math.max(1, ...summary.renewals.map(({ count }) => count));

  return (
    <div className="px-subscription-summary">
      <section className="px-billing-panel" aria-labelledby={`${id}-revenue`}>
        <h2 id={`${id}-revenue`}>{t('Recurring revenue by plan')}</h2>
        <p className="px-billing-caption">{t('Per month')}</p>
        {currencies.size > 1 ? (
          <ul className="px-billing-breakdown" role="list" aria-label={t('Plan revenue')}>
            {summary.mrrByPlan.map(({ plan, mrr }) => (
              <li key={plan}><span>{t(plans[plan].name)}</span><strong>{t(formatMoney(mrr))}</strong></li>
            ))}
          </ul>
        ) : (
          <RankedBars
            label="Plan revenue"
            rows={summary.mrrByPlan.map(({ plan, mrr }) => ({ ...plans[plan], value: mrr?.amount ?? null }))}
            formatValue={(amount) => t(formatMoney(currency ? { amount, currency } : null))}
          />
        )}
        <p className="px-billing-average">
          <span>{t('Average per paying company')}</span>
          <strong>{t(formatMoney(summary.averagePerPaying))}</strong>
        </p>
      </section>

      <section className="px-billing-panel" aria-labelledby={`${id}-renewals`}>
        <h2 id={`${id}-renewals`}>{t('Renewals coming up')}</h2>
        <p className="px-billing-caption">{t('Subscriptions renewing in the next 4 weeks')}</p>
        <ol className="px-renewal-columns" role="list" aria-label={t('Weekly renewal counts and amounts')}>
          {summary.renewals.map(({ week, count, amount }) => (
            <li key={week}>
              <div className="px-renewal-scale">
                <strong>{t(formatCount(count))}</strong>
                <span aria-hidden="true" style={{ blockSize: `${count / maxRenewals * 76}%` }} />
              </div>
              <time dateTime={week}>{t(formatDate(week))}</time>
              <strong>{t(formatMoney(amount))}</strong>
            </li>
          ))}
        </ol>
      </section>

      <section className="px-billing-panel" aria-labelledby={`${id}-ending`}>
        <h2 id={`${id}-ending`}>{t('Ending soon')}</h2>
        <p className="px-billing-caption">{t('Scheduled to cancel')}</p>
        <p className="px-billing-stat">
          <strong>{t(formatCount(summary.endingSoon.length))}</strong>
          <span>{t('ending soon')}</span>
        </p>
        {summary.endingSoon.length > 0 && (
          <ul className="px-billing-breakdown" role="list" aria-label={t('Companies ending soon')}>
            {summary.endingSoon.map(({ companyId, name, renewsOrEndsAt }) => (
              <li key={companyId}>
                <div>
                  <Link className="px-billing-text-link" to={companyPath(companyId)}>{name}</Link>
                  <span className="px-billing-secondary">
                    {renewsOrEndsAt ? t('Ends {date}', { date: formatDate(renewsOrEndsAt) }) : t(NOT_AVAILABLE)}
                  </span>
                </div>
                <strong>
                  <span className="sr-only">{t('Monthly value')} </span>
                  <EndingCompanyMonthlyValue companyId={companyId} name={name} />
                </strong>
              </li>
            ))}
          </ul>
        )}
        <p className="px-billing-stat">
          <strong>{t(formatCount(summary.cancelled))}</strong>
          <span>{t('cancelled to date')}</span>
        </p>
      </section>
    </div>
  );
}

function SubscriptionResults({ status, onStatusChange }: {
  status: ListedStatus | undefined;
  onStatusChange: (value: string) => void;
}) {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const [cursors, setCursors] = useState<string[]>([]);
  const { data, isError, isPending, refetch } = useConsoleSubscriptions({ status, cursor: cursors.at(-1) });

  if (isPending) return <p className="px-billing-panel" role="status">{t('Loading subscriptions…')}</p>;
  if (isError || !data) {
    return (
      <div className="px-billing-panel px-billing-error">
        <p role="alert">{t('Could not load subscriptions.')}</p>
        <Button type="button" variant="outline" onClick={() => void refetch()}>{t('Retry')}</Button>
      </div>
    );
  }

  const columns: Column<Subscription>[] = [
    {
      key: 'company', header: 'Company', className: 'px-subscription-company-cell', render: (row) => (
        <div>
          <Link className="px-billing-company-link" to={companyPath(row.companyId)}>{row.name}</Link>
          <span className="px-billing-secondary">{row.owner?.name || row.owner?.email || t(NOT_AVAILABLE)}</span>
        </div>
      ),
    },
    { key: 'plan', header: 'Plan', render: (row) => <StatusPill>{plans[row.plan].name}</StatusPill> },
    {
      key: 'interval', header: 'Billing', render: (row) => (
        row.interval ? t(row.interval === 'month' ? 'Monthly' : 'Yearly') : t(NOT_AVAILABLE)
      ),
    },
    { key: 'amount', header: 'Amount', render: (row) => t(formatMoney(row.amount)) },
    {
      key: 'status', header: 'Status', render: (row) => (
        <StatusPill tone={statuses[row.status].tone}>{statuses[row.status].label}</StatusPill>
      ),
    },
    {
      key: 'date', header: 'Renews or ends', render: (row) => {
        const date = formatDate(row.renewsOrEndsAt);
        const label = dateLabels[row.status];
        return label && date !== NOT_AVAILABLE ? t(label, { date }) : t(date);
      },
    },
    {
      key: 'paddle', header: 'Paddle', className: 'px-subscription-paddle-cell', render: (row) => (
        row.paddleUrl ? (
          <a className="px-billing-external" href={row.paddleUrl} target="_blank" rel="noopener noreferrer"
            aria-label={t('Open in Paddle for {company}', { company: row.name })}>
            <ExternalLink size={16} aria-hidden="true" />
          </a>
        ) : t(NOT_AVAILABLE)
      ),
    },
  ];
  const options = filters.map((value) => ({ value, label: statuses[value].label, count: data.statusCounts[value] }));
  const total = options.reduce((sum, option) => sum + option.count, 0);
  const nextCursor = data.nextCursor;

  return (
    <>
      <SubscriptionSummary summary={data.summary} />
      <p className="px-billing-note">
        <ExternalLink size={16} aria-hidden="true" />
        {t('View only. Cancel, pause, change plans or issue refunds in Paddle. This page updates through the signed webhook.')}
      </p>
      <ChipGroup label="Subscription status" value={status ?? ''}
        options={[{ value: '', label: 'All', count: total }, ...options]} onChange={onStatusChange} />
      {data.items.length > 0 ? (
        <DataTable columns={columns} data={data.items} rowKey={(row) => row.companyId}
          mobileCards className="px-subscription-table" onRowClick={(row) => navigate(companyPath(row.companyId))} />
      ) : (
        <EmptyState title={status ? 'No subscriptions with this status' : 'No subscriptions yet'} />
      )}
      {(cursors.length > 0 || nextCursor) && (
        <nav className="px-billing-pagination" aria-label={t('Subscription pages')}>
          <Button type="button" variant="outline" disabled={cursors.length === 0}
            onClick={() => setCursors((pages) => pages.slice(0, -1))}>{t('Previous')}</Button>
          <span>{t('Page {number}', { number: cursors.length + 1 })}</span>
          <Button type="button" variant="outline" disabled={!nextCursor}
            onClick={() => nextCursor && setCursors((pages) => [...pages, nextCursor])}>{t('Next')}</Button>
        </nav>
      )}
    </>
  );
}

export function SubscriptionsView() {
  const [params, setParams] = useSearchParams();
  const status = filters.find((value) => value === params.get('status'));

  function setStatus(value: string) {
    const next = new URLSearchParams(params);
    if (value) next.set('status', value);
    else next.delete('status');
    if (next.toString() !== params.toString()) setParams(next);
  }

  return (
    <div className="px-subscriptions-view">
      <BillingTabs />
      <SubscriptionResults key={status ?? 'all'} status={status} onStatusChange={setStatus} />
    </div>
  );
}
