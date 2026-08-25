import { useRef } from 'react';
import { Link, useLocation, useSearchParams } from 'react-router-dom';
import DataTable, { type Column } from '@/components/common/DataTable';
import { MiniBars } from '@/components/platform-charts/MiniBars';
import { FindField } from '@/components/workspace/FindField';
import { SelectMenu } from '@/components/workspace/SelectMenu';
import { StatusPill, type StatusPillTone } from '@/components/workspace/StatusPill';
import { useLanguage } from '@/i18n/context';
import type { PlanCode, PlatformCompanyListItem, SubscriptionState } from '../api/consoleApi';
import { formatCount, formatDate, formatDaysAgo, formatMoney, NOT_AVAILABLE } from '../api/consoleFormat';
import { useConsoleCompanies } from '../api/consoleQueries';
import { CompanySummaryCards } from './CompanySummaryCards';
import './companies-list.css';

const plans = { STARTER: 'Starter', PRO: 'Pro', ADVANCED: 'Enterprise' } satisfies Record<PlanCode, string>;
const subscriptions = {
  ACTIVE: { label: 'Active', tone: 'ok' },
  PAST_DUE: { label: 'Past due', tone: 'attention' },
  SCHEDULED_CANCEL: { label: 'Scheduled to cancel', tone: 'attention' },
  CANCELLED: { label: 'Cancelled', tone: 'neutral' },
  NONE: { label: 'Never paid', tone: 'neutral' },
} satisfies Record<SubscriptionState, { label: string; tone: StatusPillTone }>;
const accounts = { ACTIVE: 'Active', SUSPENDED: 'Suspended' };
const filterKeys = ['q', 'plan', 'subscription', 'status'] as const;
const searchLimit = 100;

function readOption<Key extends string>(value: string | null, options: Record<Key, unknown>) {
  return value && Object.hasOwn(options, value) ? value as Key : undefined;
}

function Capacity({ label, used, limit }: { label: string; used: number; limit: number }) {
  const { t } = useLanguage();
  const count = formatCount(used);
  const capacity = formatCount(limit);

  return (
    <span className="px-companies-capacity">
      {limit > 1 && (
        <span
          className="px-companies-meter"
          data-full={used >= limit || undefined}
          role="meter"
          aria-label={t(label)}
          aria-valuemin={0}
          aria-valuemax={limit}
          aria-valuenow={Math.min(used, limit)}
          aria-valuetext={t('{used} of {limit}', { used: count, limit: capacity })}
        >
          <span style={{ inlineSize: `${Math.min(used / limit, 1) * 100}%` }} />
        </span>
      )}
      {t('{used} / {limit}', { used: count, limit: capacity })}
    </span>
  );
}

function useCompanyColumns(): Column<PlatformCompanyListItem>[] {
  const { t } = useLanguage();

  return [
    {
      key: 'company',
      header: 'Company',
      className: 'px-companies-company',
      render: ({ id, name, owner }) => (
        <div className="px-companies-identity">
          <Link className="px-companies-link" to={`/platform/companies/${id}`} aria-label={t('Open {company}', { company: name })}>
            <bdi>{name}</bdi>
          </Link>
          <span>{owner ? <bdi>{owner.name}</bdi> : t(NOT_AVAILABLE)}</span>
        </div>
      ),
    },
    {
      key: 'plan',
      header: 'Plan',
      render: ({ plan }) => <StatusPill className="px-companies-plan">{plans[plan]}</StatusPill>,
    },
    {
      key: 'subscription',
      header: 'Subscription',
      render: ({ subscription, operationalStatus }) => (
        <div className="px-companies-pills">
          <StatusPill tone={subscriptions[subscription].tone}>{subscriptions[subscription].label}</StatusPill>
          {operationalStatus === 'SUSPENDED' && <StatusPill tone="bad">Account suspended</StatusPill>}
        </div>
      ),
    },
    {
      key: 'monthly',
      header: 'Monthly',
      className: 'px-companies-monthly',
      render: ({ monthly }) => monthly === null ? (
        <span><span aria-hidden="true">—</span><span className="sr-only">{t(NOT_AVAILABLE)}</span></span>
      ) : <bdi>{formatMoney(monthly)}</bdi>,
    },
    {
      key: 'staff',
      header: 'Staff',
      render: ({ counts, limits }) => <Capacity label="Staff usage" used={counts.staff} limit={limits.staff} />,
    },
    {
      key: 'locations',
      header: 'Locations',
      render: ({ counts, limits }) => <Capacity label="Location usage" used={counts.locations} limit={limits.locations} />,
    },
    {
      key: 'activity',
      header: 'Activity, 14 days',
      render: ({ subscription, activity14 }) => {
        if (subscription === 'NONE') return <span>{t('No work yet')}</span>;
        if (!activity14.length) return <span>{t(NOT_AVAILABLE)}</span>;

        const history = activity14.map(({ day, count }) =>
          t('{day}: {count}', { day: formatDate(day), count: formatCount(count) }),
        ).join(', ');
        return (
          <span className="px-companies-activity" role="img"
            aria-label={t('Task activity over 14 days: {history}', { history })}>
            <MiniBars values={activity14.map(({ count }) => count)} />
          </span>
        );
      },
    },
    {
      key: 'last-active',
      header: 'Last active',
      render: ({ lastActiveAt }) => lastActiveAt === null ? <span>{t(NOT_AVAILABLE)}</span> : (
        <time dateTime={lastActiveAt} title={formatDate(lastActiveAt)}>{t(formatDaysAgo(lastActiveAt))}</time>
      ),
    },
  ];
}

export function CompaniesListPage() {
  const { t } = useLanguage();
  const [params, setParams] = useSearchParams();
  const { state } = useLocation();
  const results = useRef<HTMLElement>(null);
  const columns = useCompanyColumns();
  const search = (params.get('q') ?? '').slice(0, searchLimit);
  const q = search.trim() || undefined;
  const plan = readOption(params.get('plan'), plans);
  const subscription = readOption(params.get('subscription'), subscriptions);
  const status = readOption(params.get('status'), accounts);
  const afterParam = params.get('after');
  const after = afterParam && /^[1-9]\d{0,9}$/.test(afterParam) ? afterParam : undefined;
  const hasFilters = Boolean(search || plan || subscription || status);
  const { data, isPending, isError, refetch } = useConsoleCompanies({ q, plan, subscription, status, after });
  const nextCursor = isError ? null : data?.nextCursor;
  const previousCursors: (string | null)[] = state?.companyCursors ?? [];

  function updateFilter(key: typeof filterKeys[number], value: string) {
    const updated = new URLSearchParams(params);
    if (value) updated.set(key, value);
    else updated.delete(key);
    updated.delete('after');
    setParams(updated, { replace: key === 'q', preventScrollReset: true });
  }

  function clearFilters() {
    const updated = new URLSearchParams(params);
    filterKeys.forEach((key) => updated.delete(key));
    updated.delete('after');
    setParams(updated, { preventScrollReset: true });
  }

  function changePage(cursor: string | null, companyCursors: (string | null)[]) {
    const updated = new URLSearchParams(params);
    if (cursor) updated.set('after', cursor);
    else updated.delete('after');
    setParams(updated, { state: { companyCursors }, preventScrollReset: true });
    results.current?.focus({ preventScroll: true });
    results.current?.scrollIntoView?.({ block: 'start' });
  }

  return (
    <div className="px-companies-list">
      <CompanySummaryCards />
      <div className="px-companies-filters" role="group" aria-label={t('Company filters')}>
        <FindField label="Search companies" value={search} maxLength={searchLimit} onChange={(value) => updateFilter('q', value)} />
        <SelectMenu label="Plan" value={plan ?? ''} options={[
          { value: '', label: 'All plans' },
          ...Object.entries(plans).map(([value, label]) => ({ value, label })),
        ]} onChange={(value) => updateFilter('plan', value)} />
        <SelectMenu label="Subscription" value={subscription ?? ''} options={[
          { value: '', label: 'Any subscription' },
          ...Object.entries(subscriptions).map(([value, { label }]) => ({ value, label })),
        ]} onChange={(value) => updateFilter('subscription', value)} />
        <SelectMenu label="Account status" value={status ?? ''} options={[
          { value: '', label: 'Any account status' },
          ...Object.entries(accounts).map(([value, label]) => ({ value, label })),
        ]} onChange={(value) => updateFilter('status', value)} />
        {hasFilters && <button type="button" className="px-companies-button" onClick={clearFilters}>{t('Clear filters')}</button>}
      </div>
      <section className="px-companies-results" ref={results} tabIndex={-1} aria-label={t('Company results')}>
        {isPending ? (
          <div className="px-companies-skeleton" role="status" aria-label={t('Loading companies')}>
            {['heading', 'first', 'second', 'third'].map((line) => <div key={line} aria-hidden="true" />)}
          </div>
        ) : isError ? (
          <div className="px-companies-message">
            <p role="alert">{t('Companies could not be loaded.')}</p>
            <button type="button" className="px-companies-button" onClick={() => void refetch()}>{t('Retry')}</button>
          </div>
        ) : data?.items.length ? (
          <DataTable columns={columns} data={data.items} rowKey={({ id }) => id} mobileCards className="px-companies-table" />
        ) : (
          <div className="px-companies-message">
            <p role="status">{t(hasFilters ? 'No companies match these filters.' : after ? 'No companies on this page.' : 'No companies yet.')}</p>
            {hasFilters && <button type="button" className="px-companies-button" onClick={clearFilters}>{t('Clear')}</button>}
          </div>
        )}
        {(after || nextCursor) && (
          <nav className="px-companies-pagination" aria-label={t('Companies pagination')}>
            <button type="button" className="px-companies-button" disabled={!after}
              onClick={() => changePage(previousCursors.at(-1) ?? null, previousCursors.slice(0, -1))}>
              {t('Previous')}
            </button>
            <button type="button" className="px-companies-button" disabled={!nextCursor}
              onClick={() => nextCursor && changePage(nextCursor, [...previousCursors, after ?? null])}>
              {t('Next')}
            </button>
          </nav>
        )}
      </section>
    </div>
  );
}

export default CompaniesListPage;
