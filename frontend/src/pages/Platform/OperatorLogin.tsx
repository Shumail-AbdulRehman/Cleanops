import LocalOperatorLogin, { LocalOperatorBoundary } from './LocalOperatorLogin';
import { useEffect, useState, type ReactNode } from 'react';
import { Link, Navigate, useLocation } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { ShieldCheck } from 'lucide-react';
import BrandLogo from '@/components/common/BrandLogo';
import LanguageChoice from '@/components/common/LanguageChoice';
import AuthShell from '@/components/common/AuthShell';
import { Button } from '@/components/ui/button';
import { useLanguage } from '@/i18n/context';
import { clearOperatorSession, rejectOperatorCallback } from './operatorSession';
import { operatorUrdu } from './operatorTranslations';
import '@/workspace.css';
import '@/workspace-refresh.css';
import './operator.css';
import './operator-polish.css';

function useOperatorText() {
  const { language } = useLanguage();
  return (text: string) => language === 'ur' ? operatorUrdu[text] ?? text : text;
}

export function OperatorShell({ title, children }: { title: string; children: ReactNode }) {
  const text = useOperatorText();
  useEffect(() => { document.title = `${text(title)} | Hygene Ops`; }, [title, text]);
  return <div className="workspace operator-page platform-polished">
    <header className="operator-header"><BrandLogo /><LanguageChoice /></header>
    <main className="operator-content">
      <ShieldCheck size={32} aria-hidden="true" />
      <h1>{text(title)}</h1>
      {children}
    </main>
  </div>;
}

export default function OperatorLogin() {
  return <LocalOperatorLogin unavailable={<ProviderOperatorLogin />} />;
}

function ProviderOperatorLogin() {
  const text = useOperatorText();
  return <div className="operator-access"><AuthShell
    title={text('Platform operator sign-in')}
    subtitle={text('Only provisioned operators can access customer-account administration. Company owners use a separate sign-in.')}
    footer={<Link to="/login">{text('Company sign in')}</Link>}
  >
    <span className="operator-identity"><ShieldCheck size={16} aria-hidden="true" />{text('Restricted operator identity')}</span>
    <section className="operator-provider-state" aria-labelledby="operator-unavailable">
      <h2 id="operator-unavailable">{text('Sign-in provider unavailable')}</h2>
      <p id="operator-signin-reason">{text('Platform sign in is not configured. Contact your platform administrator for access.')}</p>
      <Button disabled aria-describedby="operator-signin-reason">{text('Continue with identity provider')}</Button>
    </section>
    <ul className="operator-requirements">
      <li>{text('A company owner, manager or staff account does not grant platform access.')}</li>
      <li>{text('Named operator account and multi-factor authentication are required.')}</li>
      <li>{text('No public operator registration or local password recovery is available.')}</li>
    </ul>
  </AuthShell></div>;
}

export function OperatorCallback() {
  const queryClient = useQueryClient();
  const location = useLocation();
  const text = useOperatorText();
  // Remove untrusted authorization response material before rendering any links.
  useEffect(() => {
    rejectOperatorCallback();
    void clearOperatorSession(queryClient).catch(() => undefined);
  }, [queryClient]);
  if (location.search || location.hash) return <Navigate to="/platform/callback" replace />;
  return <div className="operator-access"><AuthShell
    title={text('Platform operator sign-in')}
    subtitle={text('Separate access for provisioned platform operators.')}
    footer={<Link to="/platform/login">{text('Return to platform sign in')}</Link>}
  >
    <section className="operator-provider-state operator-callback-error" role="alert">
      <h2>{text('Sign-in response rejected')}</h2>
      <p>{text('This sign-in response cannot be verified. No platform session was created. Return to platform sign in.')}</p>
    </section>
  </AuthShell></div>;
}

export function OperatorSecurity() {
  return <LocalOperatorLogin security unavailable={<ProviderOperatorSecurity />} />;
}
function ProviderOperatorSecurity() {
  const queryClient = useQueryClient();
  const text = useOperatorText();
  const [status, setStatus] = useState<'idle' | 'pending' | 'cleared' | 'error'>('idle');
  async function clear() {
    if (status === 'pending') return;
    setStatus('pending');
    try { await clearOperatorSession(queryClient); setStatus('cleared'); }
    catch { setStatus('error'); }
  }
  return <div className="operator-access"><AuthShell
    title={text('Platform security')}
    subtitle={text('Protect privileged business-account access.')}
    footer={<Link to="/platform/login">{text('Return to platform sign in')}</Link>}
  >
    <section className="operator-provider-state" aria-labelledby="operator-no-session">
      <h2 id="operator-no-session">{text('No platform session')}</h2>
      <p id="operator-security-reason">{text('Multi-factor authentication and account recovery must be managed through the approved identity provider. That connection is unavailable.')}</p>
      <Button disabled aria-describedby="operator-security-reason">{text('Open security provider')}</Button>
    </section>
    <div className="operator-cleanup"><p>{text('Clear only the platform data held in this browser.')}</p>
    <Button variant="outline" disabled={status === 'pending'} aria-busy={status === 'pending'} onClick={() => void clear()}>{text(status === 'pending' ? 'Clearing…' : 'Clear platform session')}</Button></div>
    {status === 'cleared' && <p role="status">{text('Platform data cleared from this browser. Your company session is unchanged. This does not sign you out of an identity provider.')}</p>}
    {status === 'error' && <p role="alert">{text('Platform data could not be fully cleared. Reload and try again.')}</p>}
  </AuthShell></div>;
}

/** No tenant role/Redux state can enter an operator surface. */
export function OperatorBoundary(props: { children: ReactNode }) {
  return <LocalOperatorBoundary unavailable={<ProviderOperatorLogin />}>{props.children}</LocalOperatorBoundary>;
}
