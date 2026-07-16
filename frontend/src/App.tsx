import { OwnSecurityPage } from './pages/Account/AccountPages';
import { requiresPasswordChange } from './pages/Account/api';
import './App.css';
import { Outlet, Navigate, useLocation } from 'react-router-dom';
import useAuth from '@/hooks/useAuth';
import { useGetCurrentUser } from './queries/auth.js';
import { useDispatch, useSelector } from 'react-redux';
import { setUser,setLoading,clearUser } from './store/slices/authSlice.js';
import type { AppDispatch } from '@/store/store';
import { useEffect } from 'react';
import PageLoadingSkeleton from './components/common/PageLoadingSkeleton';
import type { RootState } from '@/store/store';
import { isSessionInvalid } from './api/client';
import { isSafeFromPath, ONBOARDING_ROUTES } from './pages/Onboarding/onboardingRoutes';
import FlowShell, { FlowWait } from './pages/Onboarding/FlowShell';
import { Button } from './components/ui/button';
import { useLanguage } from './i18n/context';
import './workspace-tokens.css';
import './components/layout/shell-v6.css';

// Presentation only: authentication and role decisions remain in the guards below.
const isWorkspacePath = (pathname: string) => /^\/(dashboard|setup|today-status|locations|areas|staff|attendance|managers|exceptions|verification|settings)(\/|$)/.test(pathname);
const workspaceLoading = (
  <div className="workspace" style={{ minBlockSize: '100vh', background: 'var(--wx-canvas)' }}>
    <div className="wx-shell-content" style={{ marginInline: 'auto' }}><PageLoadingSkeleton /></div>
  </div>
);


export const ProtectedRoute = ({ children }: { children: React.ReactNode }) => {

  const { isAuthenticated } = useAuth();
  const {isLoading}= useSelector((state: RootState)=>  state.auth);
  const location = useLocation();
  if (isLoading) return isWorkspacePath(location.pathname) ? workspaceLoading : null;
  if (!isAuthenticated) return <Navigate to="/login" state={{ from: location.pathname }} replace />;


  return <>{children}</>;
};

export const GuestRoute = ({ children }: { children: React.ReactNode }) => {

  const { isAuthenticated, user, isLoading } = useAuth();
  const location = useLocation();
  if (isLoading) return isWorkspacePath(location.pathname) ? workspaceLoading : null;
  const from = location.state?.from;
  const destination = user?.role === 'ADMIN' ? ONBOARDING_ROUTES.continue : ONBOARDING_ROUTES.workspace;
  if (isAuthenticated) return <Navigate to={destination} state={isSafeFromPath(from) ? { from } : null} replace />;


  return <>{children}</>;
};

export const RequireRole = ({ roles, children }: { roles: Array<'ADMIN' | 'MANAGER' | 'STAFF'>; children: React.ReactNode }) => {

  const { isAuthenticated } = useAuth();
  const { user, isLoading } = useSelector((state: RootState) => state.auth);
  const location = useLocation();
  if (isLoading) return isWorkspacePath(location.pathname) ? workspaceLoading : null;
  if (!isAuthenticated) return <Navigate to="/login" state={{ from: location.pathname }} replace />;
  if (!user || !roles.includes(user.role)) return <Navigate to="/dashboard" replace />;

  return <>{children}</>;
};

function App() {
  const dispatch = useDispatch<AppDispatch>();
  const getCurrentUserQuery = useGetCurrentUser();
  const { user, isLoading } = useAuth();
  const { t } = useLanguage();
  const location = useLocation();

  
  useEffect(() => {
    if (getCurrentUserQuery.isPending) {
      dispatch(setLoading(true));
    } else if (getCurrentUserQuery.isSuccess && getCurrentUserQuery.data) {
      dispatch(setUser(getCurrentUserQuery.data));
    } else if (getCurrentUserQuery.isError) {
      if (isSessionInvalid(getCurrentUserQuery.error)) dispatch(clearUser());
      else dispatch(setLoading(true));
    }
  }, [
    getCurrentUserQuery.isPending,
    getCurrentUserQuery.isSuccess,
    getCurrentUserQuery.isError,
    getCurrentUserQuery.data,
    getCurrentUserQuery.error,
    dispatch,
  ]);

  
 // Wait for restored authentication to reach Redux before mounting routes.
 // Otherwise a reload of /welcome or /choose-plan can briefly redirect to login.
 const restoredUser = getCurrentUserQuery.data;
 const restoringSession = getCurrentUserQuery.isSuccess && restoredUser && (
   isLoading || user?.id !== restoredUser.id || user?.role !== restoredUser.role ||
   user?.companyId !== restoredUser.companyId
 );
 const signingOut = getCurrentUserQuery.isError && isSessionInvalid(getCurrentUserQuery.error) && (user || isLoading);
 if (getCurrentUserQuery.isPending || restoringSession || signingOut) {
  return isWorkspacePath(location.pathname) ? workspaceLoading : <FlowShell key="session-loading"><FlowWait label={t('Loading…')} /></FlowShell>;
}


  if (requiresPasswordChange(getCurrentUserQuery.error) && !['/verify-owner-email', '/reset-owner-password', '/recover-owner-account'].includes(window.location.pathname)) {
    return <OwnSecurityPage forced />;
  }
  if (getCurrentUserQuery.isError && !isSessionInvalid(getCurrentUserQuery.error) && !requiresPasswordChange(getCurrentUserQuery.error)) {
    return <FlowShell>
      <section role="alert" aria-labelledby="session-unavailable">
        <h1 id="session-unavailable">{t('We could not reach Hygene Ops. Check your connection and try again.')}</h1>
        <div className="flow-form">
          <Button className="flow-button" disabled={getCurrentUserQuery.isFetching} aria-busy={getCurrentUserQuery.isFetching} onClick={() => { void getCurrentUserQuery.refetch(); }}>
            {t(getCurrentUserQuery.isFetching ? 'Loading…' : 'Try again')}
          </Button>
        </div>
      </section>
    </FlowShell>;
  }
  return <Outlet />;
}

export default App;
