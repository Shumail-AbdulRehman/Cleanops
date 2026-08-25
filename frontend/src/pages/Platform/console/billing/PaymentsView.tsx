import { useState } from 'react';
import { CircleAlert, CircleCheck, ExternalLink } from 'lucide-react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import DataTable, { type Column } from '@/components/common/DataTable';
import EmptyState from '@/components/common/EmptyState';
import { ChartTable } from '@/components/platform-charts/ChartTable';
import { ColumnChart } from '@/components/platform-charts/ColumnChart';
import { RingGauge } from '@/components/platform-charts/RingGauge';
import { chartFormatter } from '@/components/platform-charts/chartScale';
import { Button } from '@/components/ui/button';
import { SegmentedControl } from '@/components/workspace/SegmentedControl';
import { useLanguage } from '@/i18n/context';
import type { ConsolePaymentFilters, Money, PlatformPaymentsResponse } from '../api/consoleApi';
import { useConsolePayments } from '../api/consoleQueries';
import { BillingTabs } from './BillingTabs';
import './payments.css';

type Range = NonNullable<ConsolePaymentFilters['range']>;
type Payment = PlatformPaymentsResponse['items'][number];
type Summary = PlatformPaymentsResponse['summary'];

const ranges = [
  { value: 'month', label: 'This month' },
  { value: 'three', label: 'Last 3 months' },
  { value: 'all', label: 'All' },
] satisfies { value: Range; label: string }[];

const dayOptions = { day: 'numeric', month: 'short', timeZone: 'Asia/Karachi' } as const;
const weekDate = new Intl.DateTimeFormat('en-GB', dayOptions);
const paymentDate = new Intl.DateTimeFormat('en-GB', { ...dayOptions, year: 'numeric' });

function formatMoney(money: Money | null, unavailable: string) {
  return money === null ? unavailable : chartFormatter(money.currency)(money.amount);
}

function companyPath(payment: Payment) {
  return `/platform/companies/${payment.companyId}`;
}

function PaymentsSummary({ summary, showTable, onToggleTable }: {
  summary: Summary;
  showTable: boolean;
  onToggleTable: () => void;
}) {
  const { t } = useLanguage();
  const currencies = new Set(summary.weekly.flatMap(({ collected }) => collected ? [collected.currency] : []));
  const [currency] = currencies;
  const comparable = currencies.size <= 1;
  const points = summary.weekly.map(({ week, collected }) => ({
    label: weekDate.format(new Date(week)),
    value: comparable ? collected?.amount ?? null : null,
  }));
  const outcomes = summary.paid + summary.pastDue;

  return (
    <div className="px-payments-summary">
      <section className="px-billing-panel" aria-labelledby="px-payments-weekly-title">
        <div className="px-payments-chart-header">
          <div>
            <h2 id="px-payments-weekly-title">{t('Collected per week')}</h2>
            <p className="px-billing-secondary">
              {currency && comparable
                ? t('Completed payments, last 8 weeks, {currency}', { currency })
                : t('Completed payments, last 8 weeks')}
            </p>
          </div>
          <Button className="px-payments-control" type="button" variant="outline"
            aria-pressed={showTable} onClick={onToggleTable}>{t('Table view')}</Button>
        </div>
        {showTable
          ? <ChartTable label="Collected per week" labelHeading="Week starting" valueHeading="Collected"
              data={points} money={comparable ? currency : undefined} />
          : <ColumnChart label="Collected per week" data={points} money={comparable ? currency : undefined}
              average labelLast />}
      </section>
      <section className="px-billing-panel" aria-labelledby="px-payments-outcomes-title">
        <h2 id="px-payments-outcomes-title">{t('Payment outcomes')}</h2>
        <p className="px-billing-secondary">{t('Last 8 weeks')}</p>
        <div className="px-payments-outcomes">
          <RingGauge label="Paid share" share={outcomes === 0 ? null : summary.paid / outcomes * 100} />
          <div>
            <strong>{t('{paid} of {total}', { paid: summary.paid, total: outcomes })}</strong>
            <p className="px-billing-secondary">{t('Paid')}</p>
          </div>
        </div>
        <dl className="px-payments-past-due">
          <dt>{t('Past due')}</dt>
          <dd>{summary.pastDue}</dd>
        </dl>
      </section>
    </div>
  );
}

function FilteredPaymentsEmpty() {
  const all = useConsolePayments({ range: 'all' });
  const noHistory = all.data?.summary.count === 0 && all.data.items.length === 0;

  return <EmptyState title={noHistory ? 'No payments yet' : 'No payments in this period'}
    message={noHistory ? 'Paddle payments appear here.' : 'Choose a longer period.'} />;
}

export function PaymentsView() {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [showTable, setShowTable] = useState(false);
  const range = ranges.find(option => option.value === params.get('range'))?.value ?? 'three';
  const cursor = params.get('cursor') || undefined;
  const { data, isPending, isError, refetch } = useConsolePayments({ range, cursor });
  const unavailable = t('Not available');

  function updateList(nextRange: string, nextCursor?: string) {
    setParams(current => {
      const next = new URLSearchParams(current);
      next.set('range', nextRange);
      if (nextCursor) next.set('cursor', nextCursor);
      else next.delete('cursor');
      return next;
    });
  }

  const columns: Column<Payment>[] = [
    { key: 'company', header: 'Company', render: payment =>
      <Link className="px-billing-company-link" to={companyPath(payment)}><bdi>{payment.companyName}</bdi></Link> },
    { key: 'date', header: 'Date', render: payment =>
      <time dateTime={payment.date}>{paymentDate.format(new Date(payment.date))}</time> },
    { key: 'invoice', header: 'Invoice', render: payment => <bdi>{payment.invoice ?? unavailable}</bdi> },
    { key: 'amount', header: 'Amount', className: 'px-payments-amount', render: payment =>
      <bdi>{formatMoney(payment.amount, unavailable)}</bdi> },
    { key: 'status', header: 'Status', render: payment => {
      const paid = payment.status === 'PAID';
      const Icon = paid ? CircleCheck : CircleAlert;
      return <span className="px-payments-status" data-status={payment.status}>
        <Icon size={13} aria-hidden="true" />{t(paid ? 'Paid' : 'Past due')}
      </span>;
    } },
    { key: 'paddle', header: 'Paddle', render: payment => payment.paddleUrl
      ? <a className="px-billing-external" href={payment.paddleUrl} target="_blank" rel="noopener noreferrer"
          aria-label={t('Open in Paddle for {company}', { company: payment.companyName })}>
          <ExternalLink size={16} aria-hidden="true" />
        </a>
      : unavailable },
  ];

  const result = isError ? undefined : data;
  return (
    <div className="px-payments-view">
      <BillingTabs />
      {result && <PaymentsSummary summary={result.summary} showTable={showTable}
        onToggleTable={() => setShowTable(value => !value)} />}
      <p className="px-billing-note">
        <ExternalLink size={16} aria-hidden="true" />{t('View only. Manage payments in Paddle.')}
      </p>
      <div className="px-payments-toolbar">
        <SegmentedControl label="Payment period" value={range} options={ranges} onChange={value => {
          if (value !== range) updateList(value);
        }} />
        {result && <p>
          {t(result.summary.count === 1 ? 'Collected {amount} · {count} payment' : 'Collected {amount} · {count} payments', {
            amount: formatMoney(result.summary.collected, unavailable),
            count: result.summary.count,
          })}
        </p>}
      </div>
      {isPending && (
        <div className="px-payments-loading" role="status">
          <span className="sr-only">{t('Loading payments')}</span>
          <span aria-hidden="true" /><span aria-hidden="true" /><span aria-hidden="true" />
        </div>
      )}
      {isError && (
        <div className="px-billing-panel px-billing-error">
          <p role="alert">{t('Payments could not be loaded.')}</p>
          <Button type="button" variant="outline" onClick={() => void refetch()}>{t('Retry')}</Button>
        </div>
      )}
      {result && (result.items.length > 0
        ? <DataTable columns={columns} data={result.items} rowKey={payment => payment.id}
            className="px-payments-table" mobileCards onRowClick={payment => navigate(companyPath(payment))} />
        : cursor
          ? <EmptyState title="No payments on this page" />
          : range === 'all'
            ? <EmptyState title="No payments yet" message="Paddle payments appear here." />
            : <FilteredPaymentsEmpty />)}
      {(cursor || result?.nextCursor) && (
        <nav className="px-billing-pagination" aria-label={t('Payment pages')}>
          {cursor && <Button type="button" variant="outline" onClick={() => updateList(range)}>{t('First page')}</Button>}
          {result?.nextCursor && <Button type="button" variant="outline"
            onClick={() => updateList(range, result.nextCursor ?? undefined)}>{t('Next page')}</Button>}
        </nav>
      )}
    </div>
  );
}
