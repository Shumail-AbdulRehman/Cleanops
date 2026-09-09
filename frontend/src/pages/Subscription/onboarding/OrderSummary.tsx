import { useId } from 'react';
import { Link } from 'react-router-dom';
import { LockKeyhole } from 'lucide-react';
import { useLanguage } from '@/i18n/context';
import type { BillingCatalogEntry, BillingInterval, PlanDefinition } from '../types';
import { formatBillingPrice } from './billingPrice';

/** Provider amounts must be exact strings in the smallest currency unit. */
export type OrderSummaryTotals = {
  currencyCode: string;
  totals?: { subtotal?: string; tax?: string; total?: string };
  recurringTotals?: { total?: string };
};

export type OrderSummaryProps = {
  plan: Pick<PlanDefinition, 'name' | 'limits'>;
  interval: BillingInterval;
  totals?: OrderSummaryTotals | null;
  catalogPrice?: Pick<BillingCatalogEntry, 'amount' | 'currencyCode' | 'interval'> | null;
  /** The caller ends the wait when totals are unavailable. No timer or fetch here. */
  fallback?: boolean;
  hideChangePlan?: boolean;
  changePlanHref?: string;
};

export default function OrderSummary({ plan, interval, totals, catalogPrice, fallback = false,
  hideChangePlan = false, changePlanHref = '/choose-plan' }: OrderSummaryProps) {
  const { t, language } = useLanguage();
  const headingId = useId();
  const perInterval = t(interval === 'month' ? 'per month' : 'per year');
  const format = (amount: string | undefined, currency = totals?.currencyCode) =>
    formatBillingPrice(amount, currency, interval)?.formatted;
  const subtotal = format(totals?.totals?.subtotal);
  const tax = format(totals?.totals?.tax);
  const due = format(totals?.totals?.total);
  const renewal = format(totals?.recurringTotals?.total);
  const catalog = catalogPrice?.interval === interval ? format(catalogPrice.amount, catalogPrice.currencyCode) : undefined;
  const loading = !fallback && [subtotal, tax, due, renewal].some(value => value === undefined);
  const amount = (value: string | undefined) => value !== undefined
    ? <bdi dir="ltr" className="flow-ltr tabular-nums [overflow-wrap:anywhere]">{value}</bdi>
    : fallback ? <span>{t('Calculated by Paddle')}</span>
      : <span className="inline-block" role="status" aria-label={t('Loading…')}><span aria-hidden="true" className="flow-skeleton inline-block h-4 w-20 rounded-[5px]" /></span>;

  return (
    <aside aria-labelledby={headingId} dir={language === 'ur' ? 'rtl' : 'ltr'}
      className="min-w-0 self-start rounded-[8px] bg-[var(--flow-canvas)] p-4 text-[var(--flow-ink)] min-[1024px]:sticky min-[1024px]:top-6 min-[1024px]:p-6">
      <h2 id={headingId} className="flow-section-title">{t('Order summary')}</h2>
      <p className="mt-4 flex flex-wrap items-baseline justify-between gap-2">
        <strong>{t(plan.name)}</strong><span className="text-[var(--flow-muted)]">{t(interval === 'month' ? 'Monthly' : 'Yearly')}</span>
      </p>
      <ul className="mt-3 hidden flex-wrap gap-x-4 gap-y-2 text-[14px] text-[var(--flow-muted)] min-[1024px]:flex">
        {(['locations', 'staff', 'managers'] as const).map(key => <li key={key}><bdi dir="ltr" className="tabular-nums">{plan.limits[key]}</bdi> {t(key)}</li>)}
      </ul>
      <div aria-busy={loading} aria-live="polite" aria-atomic="true">
        <dl className="my-4 border-y border-[var(--flow-line)] py-4">
          {[[t('Subtotal'), subtotal], [t('Tax'), tax], [t('Due today'), due]].map(([label, value], index) => (
            <div key={label} className={`flex items-baseline justify-between gap-4 ${index === 2 ? 'mt-4 border-t border-[var(--flow-line)] pt-4 font-semibold' : 'mb-3'}`}>
              <dt>{label}</dt><dd className="min-w-0 text-end">{amount(value)}</dd>
            </div>
          ))}
        </dl>
        <p className="flow-fine">{t('Then renews at')} {amount(renewal ?? (fallback ? catalog : undefined))} {perInterval}. {t('Cancel anytime.')}</p>
        {fallback && !renewal && catalog && <p className="flow-fine mt-2">{t('Calculated by Paddle')}</p>}
      </div>
      {!hideChangePlan && <Link to={changePlanHref} className="mt-2 inline-flex min-h-11 items-center text-[var(--flow-primary)] underline underline-offset-4 focus-visible:outline-3 focus-visible:outline-offset-4 focus-visible:outline-[var(--flow-primary)]">{t('Change plan')}</Link>}
      <p className="flow-fine mt-4 hidden items-start gap-2 border-t border-[var(--flow-line)] pt-4 min-[1024px]:flex">
        <LockKeyhole aria-hidden="true" size={16} className="mt-1 shrink-0" />
        <span>{t('Your card details go straight to Paddle. We never see them.')}</span>
      </p>
    </aside>
  );
}
