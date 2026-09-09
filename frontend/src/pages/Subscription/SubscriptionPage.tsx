import { useEffect, useState } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import useAuth from '@/hooks/useAuth';
import { useLanguage } from '@/i18n/context';
import FlowShell from '@/pages/Onboarding/FlowShell';
import { FlowEntryStatus } from '@/pages/Onboarding/FlowEntry';
import { onboardingRouteForStep, ONBOARDING_ROUTES, parseOnboardingQuery } from '@/pages/Onboarding/onboardingRoutes';
import { useBillingLifecycle } from './queries';
import { deriveBillingViewState } from './onboarding/billingViewState';
import BillingPlanPage from './onboarding/BillingPlanPage';
import BillingPaymentPage from './onboarding/BillingPaymentPage';
import BillingActivationPage from './onboarding/BillingActivationPage';
import BillingAccountPage from './onboarding/BillingAccountPage';
import BillingRecoveryPage from './onboarding/BillingRecoveryPage';

export default function SubscriptionPage({ activationReturn = false }: { activationReturn?: boolean }) {
  const { user } = useAuth();
  const { t } = useLanguage();
  if (user?.role !== 'ADMIN') return <FlowShell><p role="alert">{t('Only the company owner can view or change billing.')}</p></FlowShell>;
  return <OwnerBilling key={`${user.companyId}:${user.id}`} companyId={user.companyId} ownerId={user.id} activationReturn={activationReturn} />;
}

function OwnerBilling({ companyId, ownerId, activationReturn }: { companyId: number; ownerId: number; activationReturn: boolean }) {
  const query = useBillingLifecycle();
  const { pathname, search } = useLocation();
  const [routeRead, setRouteRead] = useState<{ path: string; from: string | null } | null>(null);
  const { refetch } = query;
  useEffect(() => {
    let active = true;
    // Recovery changes provider facts outside the query cache. Read the server
    // on pathname changes before a cached step can redirect back to recovery.
    void Promise.resolve(refetch()).then(() => {
      if (active) setRouteRead(previous => ({ path: pathname, from: previous?.path ?? null }));
    });
    return () => { active = false; };
  }, [pathname, refetch]);
  const view = deriveBillingViewState({ owner: { companyId, ownerId }, dataOwner: query.dataOwner, data: query.data,
    // An in-flight background read retains the screen and its checkout controller.
    read: query.isPending ? 'loading' : query.isError ? 'error' : 'fresh' });
  if (routeRead?.path !== pathname) return <FlowEntryStatus pending busy retry={refetch} />;
  const step = view.step;
  const route = onboardingRouteForStep(step);
  if (!route) return <FlowEntryStatus pending={query.isPending} busy={query.isFetching} retry={query.refetch} />;
  if (activationReturn || pathname === '/welcome') return <Navigate to={ONBOARDING_ROUTES.activation} replace />;
  // A subscribed owner can always return to their existing billing settings.
  if (pathname === ONBOARDING_ROUTES.account && (step === 'ACCOUNT' || (view.data?.subscription && view.data.subscription.status !== 'unknown'))) return <BillingAccountPage />;
  // A completion event can reach confirmation before lifecycle catches up.
  // This only starts a server check; Ready still needs fresh server permission.
  const paymentReturn = routeRead.from === ONBOARDING_ROUTES.payment && (step === 'CHOOSE_PLAN' || step === 'PAYMENT');
  if (pathname === ONBOARDING_ROUTES.activation && (step === 'CONFIRMING' || step === 'WORKSPACE' || paymentReturn)) return <BillingActivationPage />;
  const selection = parseOnboardingQuery(search);
  const selected = !!selection.plan && !!selection.interval;
  // Plan selection may advance to payment, and an unpaid draft may change plan.
  if (pathname === ONBOARDING_ROUTES.payment && step === 'CHOOSE_PLAN' && selected) return <BillingPaymentPage />;
  if (pathname === ONBOARDING_ROUTES.choosePlan && step === 'PAYMENT' && selected) return <BillingPlanPage />;
  if (pathname !== route) return <Navigate to={route} replace />;
  switch (pathname) {
    case ONBOARDING_ROUTES.choosePlan: return <BillingPlanPage />;
    case ONBOARDING_ROUTES.payment: return <BillingPaymentPage />;
    case ONBOARDING_ROUTES.recovery: return <BillingRecoveryPage />;
    case ONBOARDING_ROUTES.account: return <BillingAccountPage />;
    default: return <Navigate to={route} replace />;
  }
}
