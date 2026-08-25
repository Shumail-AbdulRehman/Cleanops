import { useId, type ReactNode } from 'react';
import { PLAN_LABELS } from '@/components/platform-charts/chartScale';
import { StatusPill, type StatusPillTone } from '@/components/workspace/StatusPill';
import { useLanguage } from '@/i18n/context';
import type { CompanyDetail } from '../../companyApi';
import type { PlatformCompanyInsightsResponse } from '../api/consoleApi';
import { formatCount, formatDate, formatMoney, NOT_AVAILABLE } from '../api/consoleFormat';
import './company-page.css';

type Insights = PlatformCompanyInsightsResponse;
type Subscription = NonNullable<CompanyDetail['subscription']>;

function RecordPanel({ title, summary, aside, children }: {
  title: string;
  summary?: string;
  aside?: ReactNode;
  children: ReactNode;
}) {
  const { t } = useLanguage();
  const heading = useId();

  return (
    <section className="px-company-record" aria-labelledby={heading}>
      <header className="px-company-record__heading">
        <div>
          <h2 id={heading}>{t(title)}</h2>
          {summary && <p>{t(summary)}</p>}
        </div>
        {aside}
      </header>
      {children}
    </section>
  );
}

function RecordFields({ fields }: { fields: [string, ReactNode][] }) {
  const { t } = useLanguage();

  return (
    <dl className="px-company-record__fields">
      {fields.map(([label, value]) => (
        <div key={label}>
          <dt>{t(label)}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function CompanyAccountPanel({ company, owner }: { company: CompanyDetail['company']; owner: Insights['owner'] }) {
  const { t } = useLanguage();
  const suspended = company.operationalStatus === 'SUSPENDED';

  return (
    <RecordPanel title="Account">
      <RecordFields fields={[
        ['Owner', owner ? <bdi>{owner.name}</bdi> : t(NOT_AVAILABLE)],
        ['Email', owner ? (
          <a href={`mailto:${encodeURIComponent(owner.email).replace('%40', '@')}`}><bdi>{owner.email}</bdi></a>
        ) : t(NOT_AVAILABLE)],
        ['Company ID', t('#{id}', { id: company.id })],
        ['Signed up', t(formatDate(company.createdAt))],
        ['Managers', t(formatCount(company.counts.managers))],
        ['Account state', <StatusPill tone={suspended ? 'bad' : 'ok'}>{suspended ? 'Suspended' : 'Active'}</StatusPill>],
      ]} />
    </RecordPanel>
  );
}

function subscriptionFields({ status, scheduledChangeAction, scheduledChangeAt, periodEnd }: Subscription): {
  state: string;
  tone: StatusPillTone;
  boundaryLabel: string;
  boundaryDate: string | null;
} {
  const renewal = { boundaryLabel: 'Next renewal', boundaryDate: periodEnd };
  const accessEnd = { boundaryLabel: 'Access ends', boundaryDate: scheduledChangeAt ?? periodEnd };
  switch (status.toLowerCase()) {
    case 'active':
      if (scheduledChangeAction === 'cancel') return { state: 'Scheduled to cancel', tone: 'attention', ...accessEnd };
      return { state: 'Active', tone: 'ok', ...renewal };
    case 'trialing':
      return { state: 'Active', tone: 'ok', ...renewal };
    case 'past_due':
      return { state: 'Past due', tone: 'attention', ...renewal };
    case 'canceled':
      return { state: 'Cancelled', tone: 'neutral', ...accessEnd };
    default:
      return { state: NOT_AVAILABLE, tone: 'neutral', ...renewal, boundaryDate: null };
  }
}

export function CompanySubscriptionPanel({ detail, paddle }: { detail: CompanyDetail; paddle: Insights['paddle'] }) {
  const { t } = useLanguage();
  const { subscription, providerState } = detail;
  if (!subscription) {
    return (
      <RecordPanel title="Subscription">
        <p>{t(providerState === 'AWAITING_PROVIDER'
          ? 'Subscription details are awaiting the Paddle webhook.'
          : 'This company has not paid for a subscription.')}</p>
      </RecordPanel>
    );
  }

  const { state, tone, boundaryLabel, boundaryDate } = subscriptionFields(subscription);
  const plan = subscription.plan && Object.hasOwn(PLAN_LABELS, subscription.plan)
    ? PLAN_LABELS[subscription.plan as keyof typeof PLAN_LABELS] : NOT_AVAILABLE;
  const period = subscription.periodStart && subscription.periodEnd
    ? t('{start} to {end}', { start: t(formatDate(subscription.periodStart)), end: t(formatDate(subscription.periodEnd)) })
    : t(NOT_AVAILABLE);
  const customerId = paddle?.customerUrl.match(/\/customers\/(ctm_[a-z0-9]+)$/)?.[1];

  return (
    <RecordPanel title="Subscription" summary="View only">
      <RecordFields fields={[
        ['Plan', t(plan)],
        ['Billing interval', t(NOT_AVAILABLE)],
        ['Price', t(NOT_AVAILABLE)],
        ['Status', <StatusPill tone={tone}>{state}</StatusPill>],
        ['Current period', period],
        [boundaryLabel, t(formatDate(boundaryDate))],
        ['Paddle customer ID', customerId ? <bdi>{customerId}</bdi> : t(NOT_AVAILABLE)],
      ]} />
      <p className="px-company-record__note">
        {t('Subscription changes are made in Paddle and appear here through the signed webhook.')}
      </p>
    </RecordPanel>
  );
}

const paymentLabels = ['Date', 'Invoice', 'Amount', 'Status'];

export function CompanyPaymentsPanel({ payments, paidToDate }: Pick<Insights, 'payments' | 'paidToDate'>) {
  const { t } = useLanguage();
  const sortedPayments = payments.toSorted((a, b) => Date.parse(b.date) - Date.parse(a.date));

  return (
    <RecordPanel
      title="Payments"
      summary="Payment records from Paddle"
      aside={<p className="px-company-record__total"><strong>{t(formatMoney(paidToDate))}</strong> {t('paid to date')}</p>}
    >
      {sortedPayments.length ? (
        <table className="px-company-payments" aria-label={t('Company payments')} role="table">
          <thead role="rowgroup">
            <tr role="row">
              {paymentLabels.map(label => <th key={label} role="columnheader" scope="col">{t(label)}</th>)}
            </tr>
          </thead>
          <tbody role="rowgroup">
            {sortedPayments.map(({ id, date, invoice, amount, status }) => {
              const cells = [
                <time dateTime={date}>{t(formatDate(date))}</time>,
                invoice ? <bdi>{invoice}</bdi> : t(NOT_AVAILABLE),
                <bdi>{t(formatMoney(amount))}</bdi>,
                <StatusPill tone={status === 'PAID' ? 'ok' : 'attention'}>{status === 'PAID' ? 'Paid' : 'Past due'}</StatusPill>,
              ];
              return (
                <tr key={id} role="row">
                  {paymentLabels.map((label, index) => (
                    <td key={label} role="cell">
                      <span className="px-company-payments__label" aria-hidden="true">{t(label)}</span>
                      <span>{cells[index]}</span>
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      ) : <p>{t('No payments yet.')}</p>}
    </RecordPanel>
  );
}

const historyActions = {
  COMPANY_SUSPENDED: 'Company suspended',
  COMPANY_REACTIVATED: 'Company reactivated',
} as const;

export function CompanyHistoryPanel({ activity, company }: Pick<CompanyDetail, 'activity' | 'company'>) {
  const { t } = useLanguage();

  return (
    <RecordPanel title="Platform history" summary="Actions taken from this console">
      <ol className="px-company-history">
        {activity.flatMap(({ id, action, reason, createdAt }) => Object.hasOwn(historyActions, action) ? (
          <li key={id}>
            <strong>{t(historyActions[action as keyof typeof historyActions])}</strong>
            <time dateTime={createdAt}>{t(formatDate(createdAt))}</time>
            <p>{reason ?? t(NOT_AVAILABLE)}</p>
          </li>
        ) : [])}
        <li>
          <strong>{t('Company created')}</strong>
          <time dateTime={company.createdAt}>{t(formatDate(company.createdAt))}</time>
        </li>
      </ol>
    </RecordPanel>
  );
}
