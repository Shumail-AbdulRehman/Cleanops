import { useEffect, type ReactNode } from 'react';
import { Link, Navigate, isRouteErrorResponse, useRouteError } from 'react-router-dom';
import { useSelector } from 'react-redux';
import { ShieldCheck } from 'lucide-react';
import type { RootState } from '@/store/store';
import { useLanguage } from '@/i18n/context';
import LanguageChoice from '@/components/common/LanguageChoice';
import BrandLogo from '@/components/common/BrandLogo';
import FlowShell from '@/pages/Onboarding/FlowShell';
import {serviceInformation} from '@/lib/serviceInformation';
import { Button } from '@/components/ui/button';
import { useLogout } from '@/queries/auth';
import '@/workspace.css';
import '@/workspace-refresh.css';

export function WorkspaceAudience({ children }: { children: ReactNode }) {
  const user = useSelector((state: RootState) => state.auth.user);
  if (!user) return <Navigate to="/login" replace />;
  if (user.role === 'STAFF') return <StaffWebHandoff />;
  return children;
}

function StaffWebHandoff() {
  const { t } = useLanguage();
  const title = t('Your work is in the app');
  useEffect(() => { document.title = `${title} | Hygene Ops`; }, [title]);
  const user = useSelector((state: RootState) => state.auth.user);
  const logout = useLogout();
  const { android } = serviceInformation();
  return <FlowShell size="narrow">
    <h1>{title}</h1>
    <p className="flow-lede">{t('Attendance and cleaning tasks are in the Hygene Ops Android app your company gave you.')}</p>
    <div className="flow-form">
      <p>{t('You are signed in as {name}.', { name: `\u2068${user?.name ?? ''}\u2069` })}</p>
      <div className="flow-notice" role="status">{android ? <>
        <a href={android} rel="noreferrer">{t('Open approved Android distribution')}</a>
        <p>{t('Use only the distribution approved by your company. A download link does not confirm device qualification.')}</p>
      </> : <p>{t('Approved Android distribution is unavailable. Ask your company owner for the qualified app.')}</p>}</div>
      <Button className="flow-button flow-button-full" disabled={logout.isPending} aria-busy={logout.isPending} onClick={() => logout.mutate()}>{t(logout.isPending ? 'Signing out…' : 'Sign out')}</Button>
      {logout.isError && <p className="flow-notice flow-notice-bad" role="alert">{t('Sign out failed. Try again.')}</p>}
    </div>
  </FlowShell>;
}

export function WorkspaceRouteError() {
  const error = useRouteError();
  const { t } = useLanguage();
  const missing = isRouteErrorResponse(error) && error.status === 404;
  return <div className="workspace workspace-access-page">
    <header><BrandLogo /><LanguageChoice /></header>
    <main className="workspace-access-content" role="alert">
      <h1>{t(missing ? 'Page not found' : 'This page is unavailable')}</h1>
      <p>{t(missing ? 'This address does not match an available page.' : 'Your saved records are kept. Reload the page to try again, or return to your workspace.')}</p>
      <div className="workspace-access-actions">
        <Button onClick={() => window.location.reload()}>{t('Reload page')}</Button>
        <Link to="/dashboard">{t('Back to workspace')}</Link>
      </div>
    </main>
  </div>;
}

export function CompanySettingsUnavailable() {
  const { t } = useLanguage();
  return <section className="workspace-unavailable">
    <h1>{t('Company settings are unavailable')}</h1>
    <p>{t('Company settings are not available in this workspace yet. You can continue managing your locations and team.')}</p>
    <Link to="/locations">{t('Locations')}</Link>
  </section>;
}

// Never reuse tenant auth as operator sign-in; spec34 replaces this safe boundary.
export function PlatformUnavailable() {
  const { t } = useLanguage();
  return <div className="workspace workspace-access-page">
    <header><BrandLogo /><LanguageChoice /></header>
    <main className="workspace-access-content">
      <ShieldCheck size={32} aria-hidden="true" />
      <h1>{t('Platform access is unavailable')}</h1>
      <p>{t('Platform operations require a separate provisioned account. A company owner account does not grant platform access.')}</p>
      <Link to="/login">{t('Return to sign in')}</Link>
    </main>
  </div>;
}
