import { Navigate, useLocation } from 'react-router-dom';
import useAuth from '@/hooks/useAuth';
import { useBillingLifecycle } from '@/pages/Subscription/queries';
import { deriveBillingViewState } from '@/pages/Subscription/onboarding/billingViewState';
import { FlowEntryStatus } from '@/pages/Onboarding/FlowEntry';
import { isSafeFromPath, onboardingRouteForStep } from '@/pages/Onboarding/onboardingRoutes';
import { useContext } from 'react';
import { WorkspaceTheme } from '@/components/common/WorkspaceTheme';
import PageLoadingSkeleton from '@/components/common/PageLoadingSkeleton';
import '@/workspace-tokens.css';
import '@/components/layout/shell-v6.css';

function OwnerWorkspaceGate({ children, companyId, ownerId }: { children: React.ReactNode; companyId: number; ownerId: number }) {
  const workspace = useContext(WorkspaceTheme);
  const query = useBillingLifecycle();
  const location = useLocation();
  const view = deriveBillingViewState({ owner: { companyId, ownerId }, dataOwner: query.dataOwner, data: query.data,
    read: query.isPending ? 'loading' : query.isError ? 'error' : 'fresh' });
  const data = view.data;
  if (!query.isPending && !query.isError && data?.company.isActive && data.company.operationalStatus === 'ACTIVE' && view.kind !== 'restricted') {
    // Historical subscribers retain READ_OPERATIONAL. Work and capacity stay server-authorized.
    const historical = data.subscription && ['active', 'trialing', 'past_due', 'canceled', 'paused'].includes(data.subscription.status);
    if (view.canOpenWorkspace || (data.onboardingRequired !== true && (historical || data.onboardingRequired === false))) return children;
  }
  const route = onboardingRouteForStep(view.step);
  if (route && route !== location.pathname) {
    const from = `${location.pathname}${location.search}${location.hash}`;
    return <Navigate to={route} state={isSafeFromPath(from) ? { from } : null} replace />;
  }
  if (query.isPending) return workspace ? <PageLoadingSkeleton /> : (
    <div className="workspace" style={{ minBlockSize: '100vh', background: 'var(--wx-canvas)' }}>
      <div className="wx-shell-content" style={{ marginInline: 'auto' }}><PageLoadingSkeleton /></div>
    </div>
  );
  return <FlowEntryStatus pending={false} busy={query.isFetching} retry={query.refetch} />;
}

export default function WorkspaceGate({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const { pathname } = useLocation();
  if (user?.role !== 'ADMIN' || /^\/(subscription|settings)(\/|$)/.test(pathname)) return children;
  return <OwnerWorkspaceGate key={`${user.companyId}:${user.id}`} companyId={user.companyId} ownerId={user.id}>{children}</OwnerWorkspaceGate>;
}
