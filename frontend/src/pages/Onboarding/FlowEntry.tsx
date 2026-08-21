import { Navigate, useLocation } from 'react-router-dom';
import useAuth from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { useLanguage } from '@/i18n/context';
import { useBillingLifecycle } from '@/pages/Subscription/queries';
import { deriveBillingViewState } from '@/pages/Subscription/onboarding/billingViewState';
import FlowShell, { FlowWait } from './FlowShell';
import { isSafeFromPath, onboardingRouteForStep, ONBOARDING_ROUTES } from './onboardingRoutes';

/** Shared fail-closed read state for entry and setup-route composition. */
export function FlowEntryStatus({ pending, busy, retry }: { pending: boolean; busy: boolean; retry: () => unknown }) {
  const { t } = useLanguage();
  if (pending) return <FlowShell><FlowWait heading label={t('Checking subscription status…')} /></FlowShell>;
  return <FlowShell>
    <h1>{t('Workspace access could not be checked')}</h1>
    <div className="flow-form">
      <p className="flow-notice flow-notice-bad" role="alert">{t('Billing is temporarily unavailable. Refresh status to try again.')}</p>
      <Button className="flow-button" disabled={busy} aria-busy={busy} onClick={() => void retry()}>{t('Try again')}</Button>
    </div>
  </FlowShell>;
}

function OwnerEntry({ companyId, ownerId }: { companyId: number; ownerId: number }) {
  const query = useBillingLifecycle();
  const location = useLocation();
  const view = deriveBillingViewState({ owner: { companyId, ownerId }, dataOwner: query.dataOwner, data: query.data,
    read: query.isPending ? 'loading' : query.isError ? 'error' : 'fresh' });
  const step = view.step;
  const route = onboardingRouteForStep(step);
  if (query.isFetching) return <FlowEntryStatus pending busy retry={query.refetch} />;
  if (!route) return <FlowEntryStatus pending={query.isPending} busy={query.isFetching} retry={query.refetch} />;
  const from: unknown = location.state?.from;
  return <Navigate to={step === 'WORKSPACE' && isSafeFromPath(from) ? from : route} replace />;
}

export default function FlowEntry() {
  const { user, isAuthenticated } = useAuth();
  const location = useLocation();
  if (!isAuthenticated) return <Navigate to={ONBOARDING_ROUTES.login} state={isSafeFromPath(location.state?.from) ? { from: location.state.from } : null} replace />;
  if (user?.role !== 'ADMIN') return <Navigate to={ONBOARDING_ROUTES.workspace} replace />;
  return <OwnerEntry key={`${user.companyId}:${user.id}`} companyId={user.companyId} ownerId={user.id} />;
}
