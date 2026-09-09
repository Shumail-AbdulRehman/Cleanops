import { useEffect, useRef, useState } from 'react';
import { Link, Navigate, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import useAuth from '@/hooks/useAuth';
import { useLanguage } from '@/i18n/context';
import { Button } from '@/components/ui/button';
import FlowShell, { FlowWait } from '@/pages/Onboarding/FlowShell';
import { parseOnboardingQuery } from '@/pages/Onboarding/onboardingRoutes';
import { useBillingCatalog, useBillingLifecycle, useSubscription } from '../queries';
import { billingPlanDefinition, deriveBillingViewState } from './billingViewState';
import { formatBillingPrice } from './billingPrice';
import { useCheckoutSession, type CheckoutSelection } from './useCheckoutSession';
import PaddleCheckoutFrame from './PaddleCheckoutFrame';
import SupportContactLink from './SupportContactLink';
import OrderSummary from './OrderSummary';
import type { BillingCheckoutResume, ValidatedBillingLifecycle } from '../types';

export default function BillingPaymentPage() {
  const { user } = useAuth();
  const { t } = useLanguage();
  if (user?.role !== 'ADMIN') return <FlowShell size="wide" step="payment">
    <h1>{t('Add your card')}</h1>
    <p role="alert">{t('Only the company owner can view or change billing.')}</p>
    <Link to="/login">{t('Sign in again')}</Link>
  </FlowShell>;
  return <OwnerPayment key={`${user.companyId}:${user.id}`} companyId={user.companyId} ownerId={user.id} />;
}

function OwnerPayment({ companyId, ownerId }: { companyId: number; ownerId: number }) {
  const { t } = useLanguage();
  const [params] = useSearchParams();
  const lifecycle = useBillingLifecycle();
  const view = deriveBillingViewState({ owner: { companyId, ownerId }, dataOwner: lifecycle.dataOwner, data: lifecycle.data,
    read: lifecycle.isPending ? 'loading' : lifecycle.isError ? 'error' : 'fresh' });
  // Resolve only after the scoped read: an existing draft always wins over the URL.
  const selection = view.data?.checkoutResume ?? parseOnboardingQuery(params);
  if (!view.data) return <FlowShell size="wide" step="payment">
    <h1>{t('Add your card')}</h1>
    {lifecycle.isPending ? <FlowWait label={t('Checking subscription status…')} /> :
      <div className="flow-notice flow-notice-bad mt-6" role="alert">
        <p>{t('Billing is temporarily unavailable. Refresh status to try again.')}</p>
        <Button className="flow-button flow-button-secondary mt-3" disabled={lifecycle.isFetching} onClick={() => void lifecycle.refetch()}>{t('Try again')}</Button>
      </div>}
  </FlowShell>;
  if (!selection.plan || !selection.interval) return <Navigate to="/choose-plan" replace />;
  const environment = import.meta.env.VITE_PADDLE_ENVIRONMENT?.trim();
  const token = import.meta.env.VITE_PADDLE_CLIENT_TOKEN?.trim();
  if (!['sandbox', 'production'].includes(environment ?? '') || view.data.billingEnvironment !== environment ||
    !token?.startsWith(environment === 'sandbox' ? 'test_' : 'live_')) return <FlowShell size="wide" step="payment">
    <h1>{t('Add your card')}</h1>
    <div role="alert" className="flow-notice flow-notice-bad mt-6">
      <h2 className="flow-section-title">{t("The card form didn't load")}</h2>
      <p>{t('Billing is temporarily unavailable. Refresh status to try again.')}</p>
      <Button className="flow-button mt-3" disabled={lifecycle.isFetching} onClick={() => void lifecycle.refetch()}>{t('Try again')}</Button>
    </div>
  </FlowShell>;
  return <PaymentSession selection={{ plan: selection.plan, interval: selection.interval }} facts={view.data} />;
}

function PaymentSession({ selection, facts }: { selection: CheckoutSelection; facts: ValidatedBillingLifecycle }) {
  const { t, language } = useLanguage();
  const catalog = useBillingCatalog();
  const subscription = useSubscription();
  const checkout = useCheckoutSession(selection);
  const location = useLocation();
  const navigate = useNavigate();
  const consumedRequest = useRef<string | null>(null);
  const { actions, actionBusy, statusBusy, changePlan } = checkout;
  useEffect(() => {
    const request = location.state?.changePlan as CheckoutSelection | undefined;
    if (!request || !['STARTER', 'PRO', 'ADVANCED'].includes(request.plan) || !['month', 'year'].includes(request.interval) ||
      consumedRequest.current === location.key || actionBusy || statusBusy || !actions.includes('changePlan')) return;
    // Consume the history entry before starting private work. Effect replay,
    // reload and Back must never submit this request a second time.
    consumedRequest.current = location.key;
    void navigate(location.pathname + location.search + location.hash, { replace: true, state: null });
    void changePlan(request);
  }, [location, navigate, actions, actionBusy, statusBusy, changePlan]);
  // A prepared replacement may be newer than the query's last saved draft.
  const draft: BillingCheckoutResume | null = checkout.prepared ?? facts.checkoutResume;
  const chosen = draft ?? selection;
  const plan = billingPlanDefinition(subscription.data?.availablePlans ?? [], chosen.plan);
  const entries = catalog.data?.filter(entry => entry.plan === chosen.plan && entry.interval === chosen.interval) ?? [];
  const price = entries.length === 1 ? entries[0] : null;
  const { status } = checkout;
  const sandbox = facts.billingEnvironment === 'sandbox' && import.meta.env.VITE_PADDLE_ENVIRONMENT === 'sandbox' &&
    !!import.meta.env.VITE_PADDLE_CLIENT_TOKEN?.startsWith('test_');
  const ready = ['ready', 'paying', 'declined'].includes(status) ||
    (status === 'offline' && ['ready', 'declined'].includes(checkout.state.onlineStatus ?? ''));
  const showFrame = !['frameFailed', 'unresolved', 'restricted', 'replacing', 'confirming'].includes(status);
  const fallback = !['checking', 'preparing', 'frameLoading'].includes(status);
  const currencyCode = checkout.totals?.currencyCode;
  const digits = formatBillingPrice('0', currencyCode, chosen.interval)?.fractionDigits;
  // Paddle.js events use major-unit numbers (unlike the REST API). Adapt to
  // OrderSummary's minor-unit strings without rounding or doing binary arithmetic.
  // https://developer.paddle.com/build/checkout/build-branded-inline-checkout/
  const minorUnits = (value: number | undefined): string | undefined => {
    if (digits === undefined || typeof value !== 'number' || !Number.isFinite(value) || value < 0) return;
    const decimal = value.toFixed(digits);
    if (Number(decimal) !== value) return;
    const minor = decimal.replace('.', '');
    if (!/^\d+$/.test(minor) || !Number.isSafeInteger(Number(minor))) return;
    return BigInt(minor).toString();
  };
  const totals = currencyCode ? { currencyCode,
    totals: { subtotal: minorUnits(checkout.totals?.totals?.subtotal), tax: minorUnits(checkout.totals?.totals?.tax), total: minorUnits(checkout.totals?.totals?.total) },
    recurringTotals: { total: minorUnits(checkout.totals?.recurringTotals?.total) } } : null;
  const changePlanHref = `/choose-plan?${new URLSearchParams({ plan: chosen.plan, interval: chosen.interval })}`;

  if (status === 'confirming') return <Navigate to="/subscription/activation" replace />;

  return <FlowShell size="wide" step="payment" testMode={sandbox}>
    <h1>{t('Add your card')}</h1>
    <div className="mt-6 grid min-w-0 gap-6 min-[1024px]:grid-cols-[minmax(0,1.3fr)_minmax(0,.9fr)] min-[1024px]:gap-12">
      <section aria-label={t('Add your card')} className="order-2 min-w-0 space-y-4 min-[1024px]:order-1">
        {sandbox && status !== 'frameFailed' && <TestCards />}
        {language === 'ur' && <p className="flow-fine">{t("Paddle's secure card form is in English.")}</p>}
        {ready && status === 'checking' && <p role="status" className="flow-notice">{t('Checking subscription status…')}</p>}
        {ready && status === 'preparing' && <p role="status" className="flow-notice">{t('Preparing your checkout…')}</p>}
        {status === 'declined' && <p role="alert" className="flow-notice flow-notice-bad">{t('That card was declined. Check the details or try another card.')}</p>}
        {status === 'offline' && <p role="status" className="flow-notice flow-notice-warn">{t("You're offline. Reconnect to continue. Your details stay here.")}</p>}
        {facts.checkoutResume && ['frameLoading', 'ready'].includes(status) && <p role="status" className="flow-notice flow-notice-ok">{t('We saved your checkout. Pick up where you left off.')}</p>}
        {status === 'paying' && <p role="status" className="flow-notice">{t('Processing your payment. Please keep this page open.')}</p>}
        {status === 'replacing' && <p role="status" className="flow-notice">{t('Changing your plan. Please keep this page open.')}</p>}
        {status === 'frameFailed' && <div role="alert" className="flow-notice flow-notice-bad space-y-3">
          <h2 className="flow-section-title">{t("The card form didn't load")}</h2>
          <p>{t('The card form could not load. Check your connection or browser extensions and try again.')}</p>
        </div>}
        {status === 'unresolved' && <p role="status" className="flow-notice flow-notice-warn">{t('We could not confirm your previous checkout. Check again before making another payment.')}</p>}
        {status === 'restricted' && <p role="alert" className="flow-notice flow-notice-bad">{t('This account is restricted')}</p>}
        {actions.includes('tryAgain') && <Button className="flow-button" disabled={checkout.actionBusy} aria-busy={checkout.actionBusy} onClick={() => void checkout.tryAgain()}>{t('Try again')}</Button>}
        {actions.includes('checkStatus') && <Button className="flow-button" disabled={checkout.statusBusy} aria-busy={checkout.statusBusy} onClick={() => void checkout.checkStatus()}>{t(checkout.statusBusy ? 'Checking subscription status…' : 'Check subscription status')}</Button>}
        {actions.includes('contactSupport') && <SupportContactLink className="flow-button" />}
        {showFrame && <PaddleCheckoutFrame ready={ready} registerFrameTarget={checkout.registerFrameTarget}
          label={status === 'checking' ? t('Checking subscription status…') : status === 'preparing' ? t('Preparing your checkout…') : undefined} />}
      </section>
      <div className="order-1 min-w-0 self-start min-[1024px]:sticky min-[1024px]:top-6 min-[1024px]:order-2">
        {plan ? <OrderSummary plan={plan} interval={chosen.interval} totals={totals} catalogPrice={price}
          fallback={fallback} hideChangePlan={!actions.includes('changePlan')} changePlanHref={changePlanHref} /> :
          <div className="space-y-4 rounded-[8px] bg-[var(--flow-canvas)] p-4">
            <h2 className="flow-section-title">{t('Order summary')}</h2>
            {subscription.isPending ? <div role="status" aria-label={t('Loading…')} className="flow-skeleton h-28" /> :
              <><p role="status">{t('Billing is temporarily unavailable. Refresh status to try again.')}</p>
                <Button className="flow-button flow-button-secondary" disabled={subscription.isFetching} onClick={() => void subscription.refetch()}>{t('Try again')}</Button>
                {actions.includes('changePlan') && <Link className="block text-[var(--flow-primary)] underline" to={changePlanHref}>{t('Change plan')}</Link>}</>}
          </div>}
      </div>
    </div>
  </FlowShell>;
}

function TestCards() {
  const { t } = useLanguage();
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try { await navigator.clipboard.writeText('4242424242424242'); setCopied(true); }
    catch { setCopied(false); }
  };
  return <section aria-label={t('Test mode')} className="rounded-[7px] border border-dashed border-[var(--flow-warn-ink)] bg-[var(--flow-warn-fill)] p-4 text-[14px] text-[var(--flow-warn-ink)]">
    <p><strong>{t('Test mode. No real money moves.')}</strong></p>
    <p className="flex flex-wrap items-center gap-x-2">
      <span>{t('Use this card:')}</span><bdi dir="ltr" className="font-mono tabular-nums">4242 4242 4242 4242</bdi>
      <Button variant="ghost" className="min-h-11 text-inherit underline" onClick={() => void copy()}>{t('Copy')}</Button>
      {copied && <span role="status">{t('Copied')}</span>}
    </p>
    <p>{t('Any future expiry date, any name, security code 100.')}</p>
    <details className="flow-disclosure mt-3">
      <summary>{t('More test cards')}</summary>
      <ul className="space-y-3 pt-3">
        <li><span className="block">{t('Asks for bank approval (3D Secure)')}</span><bdi dir="ltr" className="font-mono">4000 0038 0000 0446</bdi></li>
        <li><span className="block">{t('Always declined')}</span><bdi dir="ltr" className="font-mono">4000 0000 0000 0002</bdi></li>
      </ul>
    </details>
  </section>;
}
