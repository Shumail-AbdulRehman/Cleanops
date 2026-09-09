import { useId, useState, type KeyboardEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import useAuth from '@/hooks/useAuth';
import { useLanguage } from '@/i18n/context';
import { Button } from '@/components/ui/button';
import FlowShell from '@/pages/Onboarding/FlowShell';
import { parseOnboardingQuery } from '@/pages/Onboarding/onboardingRoutes';
import { useBillingCatalog, useBillingLifecycle, useSubscription } from '../queries';
import { billingPlanDefinition, deriveBillingViewState } from './billingViewState';
import { formatBillingPrice } from './billingPrice';
import type { BillingInterval, PlanCode } from '../types';

const planCodes = ['STARTER', 'PRO', 'ADVANCED'] as const;
const capacities = { locations: 'Locations', staff: 'Staff', managers: 'Managers' } as const;
const included = ['GPS attendance and selfies', 'Daily and one-time tasks', 'Area QR and guided photo capture', 'Photo review and history'];

export default function BillingPlanPage() {
  const { user } = useAuth();
  const { t } = useLanguage();
  if (user?.role !== 'ADMIN') return <FlowShell size="plan" step="plan"><h1>{t('Choose a plan')}</h1><p role="alert">{t('Only the company owner can view or change billing.')}</p><Link to="/login">{t('Sign in again')}</Link></FlowShell>;
  return <OwnerPlans key={`${user.companyId}:${user.id}`} companyId={user.companyId} ownerId={user.id} />;
}

function OwnerPlans({ companyId, ownerId }: { companyId: number; ownerId: number }) {
  const { t, language } = useLanguage();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [initial] = useState(() => parseOnboardingQuery(params));
  const [choice, setChoice] = useState<PlanCode>();
  const [cycle, setCycle] = useState<BillingInterval>();
  const noteId = useId();
  const lifecycle = useBillingLifecycle();
  const catalog = useBillingCatalog();
  const summary = useSubscription();
  const view = deriveBillingViewState({ owner: { companyId, ownerId }, dataOwner: lifecycle.dataOwner, data: lifecycle.data,
    // A background read retains the last server facts and never interrupts the controls.
    read: lifecycle.isPending ? 'loading' : lifecycle.isError ? 'error' : 'fresh',
    httpStatus: (lifecycle.error as { response?: { status?: number } } | null)?.response?.status });
  const draft = view.resume;
  const interval = cycle ?? initial.interval ?? draft?.interval ?? 'month';
  const selection = choice ?? initial.plan ?? draft?.plan ?? 'STARTER';
  const loading = lifecycle.isPending || catalog.isPending || summary.isPending;
  const failed = lifecycle.isError || catalog.isError || summary.isError;
  const allowed = view.canChoosePlan || view.kind === 'resume';
  const selectable = allowed && !loading && !failed;
  const rows = planCodes.flatMap(code => {
    const plan = billingPlanDefinition(summary.data?.availablePlans ?? [], code);
    if (!plan || Object.values(plan.limits).some(value => !Number.isSafeInteger(value) || value < 0)) return [];
    const entries = (catalog.data ?? []).filter(entry => entry.plan === code && entry.interval === interval);
    const price = entries.length === 1 ? formatBillingPrice(entries[0].amount, entries[0].currencyCode, interval, language === 'ur' ? 'ur-PK' : 'en-PK') : null;
    return [{ plan, price }];
  });
  const selected = rows.find(row => row.plan.code === selection && row.price);
  const available = rows.filter(row => row.price);
  const tabStop = selected?.plan.code ?? available[0]?.plan.code;
  const refresh = () => Promise.all([lifecycle.refetch(), catalog.refetch(), summary.refetch()]);
  const keyboard = (event: KeyboardEvent<HTMLInputElement>) => {
    if (!['ArrowRight', 'ArrowLeft', 'ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    const inputs = [...event.currentTarget.closest('fieldset')!.querySelectorAll<HTMLInputElement>('input:not(:disabled)')];
    if (!inputs.length) return;
    event.preventDefault();
    const forward = event.key === 'ArrowDown' || event.key === (language === 'ur' ? 'ArrowLeft' : 'ArrowRight');
    const index = event.key === 'Home' ? 0 : event.key === 'End' ? inputs.length - 1 : (inputs.indexOf(event.currentTarget) + (forward ? 1 : -1) + inputs.length) % inputs.length;
    setChoice(inputs[index].value as PlanCode);
    inputs[index].focus();
  };
  const sandbox = view.data?.billingEnvironment === 'sandbox' && import.meta.env.VITE_PADDLE_ENVIRONMENT === 'sandbox' && !!import.meta.env.VITE_PADDLE_CLIENT_TOKEN?.startsWith('test_');
  return <FlowShell size="plan" step="plan" testMode={sandbox}>
    <div className="grid gap-6">
      <header className="flex flex-wrap items-start justify-between gap-6">
        <div><h1>{t('Choose a plan')}</h1><p className="flow-lede">{t('Pick the size that fits your team. You can change it later.')}</p></div>
        <div className="flow-interval shrink-0" role="group" aria-label={t('Billing interval')}>
          <span className="flow-interval-thumb" aria-hidden="true" />
          {(['month', 'year'] as const).map(value => <button type="button" key={value} aria-pressed={interval === value} onClick={() => setCycle(value)}>{t(value === 'month' ? 'Monthly' : 'Yearly')}</button>)}
        </div>
      </header>
      {draft && (draft.plan !== selection || draft.interval !== interval) && <p className="flow-notice" role="status">{t('You have a checkout in progress. Choosing a different plan replaces it. You have not been charged.')}</p>}
      {loading ? <div role="status" aria-label={t('Loading plans')} aria-busy="true" className="grid gap-3"><span className="flow-sr-only">{t('Loading plans')}</span>{planCodes.map(code => <span key={code} className="flow-skeleton h-28" />)}</div> : failed ?
        <div className="flow-notice flow-notice-bad" role="alert"><p>{t('Prices could not load.')}</p><Button className="flow-button flow-button-secondary mt-3" onClick={() => void refresh()}>{t('Try again')}</Button></div> : !allowed ?
        <section className="flow-notice" role="status"><p>{t(view.kind === 'uncertain' || view.kind === 'pending' ? 'We could not confirm the outcome. Check subscription status before trying another payment.' : 'Billing is temporarily unavailable. Refresh status to try again.')}</p><Button className="flow-button flow-button-secondary mt-3" onClick={() => void refresh()}>{t('Check subscription status')}</Button>{view.kind === 'existing' || view.kind === 'confirmed' ? <Link to="/subscription">{t('Open Plan & billing')}</Link> : null}</section> : <>
        {!available.length && <div className="flow-notice" role="status"><p>{t('No plans are available for this billing interval.')}</p><Button className="flow-button flow-button-secondary mt-3" onClick={() => void refresh()}>{t('Try again')}</Button></div>}
        <fieldset className="m-0 grid min-w-0 gap-3 border-0 p-0" aria-describedby={noteId}>
          <legend className="flow-sr-only">{t('Choose a plan')}</legend>
          <div aria-hidden="true" className="flow-fine hidden items-center gap-4 px-4 md:grid md:grid-cols-[minmax(0,2fr)_repeat(3,minmax(0,.65fr))_minmax(0,1.3fr)]">
            <span />{Object.values(capacities).map(label => <span key={label} className="text-center">{t(label)}</span>)}<span className="text-end">{t('Price')}</span>
          </div>
          {rows.map(({ plan, price }) => <label key={plan.code} className="flow-plan-row grid min-w-0 cursor-pointer grid-cols-[minmax(0,1fr)_auto] items-center gap-4 p-4 md:grid-cols-[minmax(0,2fr)_repeat(3,minmax(0,.65fr))_minmax(0,1.3fr)]">
            <span className="flex min-w-0 items-center gap-3"><input type="radio" name={noteId} value={plan.code} checked={selection === plan.code} disabled={!selectable || !price} tabIndex={tabStop === plan.code ? 0 : -1} onChange={() => setChoice(plan.code)} onKeyDown={keyboard} aria-label={`${t(plan.name)} · ${price?.formatted ?? t('Unavailable')} · ${t(interval === 'month' ? 'Monthly' : 'Yearly')}`} /><span className="min-w-0"><strong>{t(plan.name)}</strong><span className="flow-fine block">{t(plan.description)}</span></span></span>
            <span className="col-span-2 row-start-2 grid grid-cols-3 gap-2 md:contents">{(['locations', 'staff', 'managers'] as const).map(resource => <span key={resource} className="min-w-0 text-center"><span className="flow-fine block md:sr-only">{t(capacities[resource])}</span><bdi dir="ltr">{plan.limits[resource]}</bdi></span>)}</span>
            <span className="col-start-2 row-start-1 min-w-0 text-end md:col-start-5"><bdi dir="ltr" className="flow-price break-words">{price?.formatted ?? t('Unavailable')}</bdi><span className="flow-fine block">{t(interval === 'month' ? 'Monthly' : 'Yearly')}</span></span>
          </label>)}
        </fieldset>
      </>}
      <details className="flow-disclosure"><summary>{t('What every plan includes')}</summary><ul className="list-disc space-y-2 ps-6">{included.map(key => <li key={key}>{t(key)}</li>)}</ul></details>
      <p className="flow-fine" id={noteId}>{t('Your company owner uses one manager seat.')}</p>
      <section aria-label={t('Selected plan')} className="sticky bottom-0 z-10 flex flex-wrap items-center justify-between gap-4 border-t border-(--flow-line) bg-(--flow-paper) py-4 md:static">
        <p className="min-w-0">{selected ? <><strong>{t(selected.plan.name)}</strong> · <bdi dir="ltr">{selected.price!.formatted}</bdi> · {t(interval === 'month' ? 'Monthly' : 'Yearly')}</> : t('No plans are available for this billing interval.')}</p>
        <Button className="flow-button w-full sm:w-auto" disabled={!selectable || !selected} onClick={() => selected && navigate(`/subscription/payment?${new URLSearchParams({ plan: selected.plan.code, interval })}`, {
          state: draft && (draft.plan !== selected.plan.code || draft.interval !== interval)
            ? { changePlan: { plan: selected.plan.code, interval } } : null,
        })}>{t('Continue to payment')}</Button>
      </section>
      <p className="flow-fine">{t('Final total and taxes are shown by Paddle before confirmation.')}</p>
    </div>
  </FlowShell>;
}
