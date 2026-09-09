import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import useAuth from '@/hooks/useAuth';
import { useLanguage } from '@/i18n/context';
import { Button } from '@/components/ui/button';
import FlowShell from '@/pages/Onboarding/FlowShell';
import { getPublicSupport } from '@/lib/serviceInformation';
import { reconcileBillingCheckout } from '../api';
import { useBillingLifecycle } from '../queries';
import type { BillingLifecycle, BillingReconcileResult } from '../types';

const retryDelays = [2000, 5000, 10000];
const isRestricted = (facts: BillingLifecycle | undefined) => facts?.onboardingStep === 'RESTRICTED' || facts?.company.operationalStatus === 'SUSPENDED' || facts?.company.isActive === false;

export default function BillingRecoveryPage() {
  const { user } = useAuth();
  const { t } = useLanguage();
  if (user?.role !== 'ADMIN') return <FlowShell step="payment">
    <h1>{t('Check subscription status')}</h1>
    <p role="alert">{t('Only the company owner can view or change billing.')}</p>
    <Link to="/login">{t('Sign in again')}</Link>
  </FlowShell>;
  return <OwnerRecovery key={`${user.companyId}:${user.id}`} companyId={user.companyId} ownerId={user.id} />;
}

function OwnerRecovery({ companyId, ownerId }: { companyId: number; ownerId: number }) {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const query = useBillingLifecycle();
  const [attempt, setAttempt] = useState(0);
  const [settled, setSettled] = useState<{ attempt: number; result: BillingReconcileResult | null } | null>(null);
  const request = useRef<{ attempt: number; promise: Promise<BillingReconcileResult> } | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const [email, setEmail] = useState<string | null>(null);
  const result = settled?.attempt === attempt ? settled.result : undefined;
  const scoped = query.dataOwner?.companyId === companyId && query.dataOwner?.ownerId === ownerId;
  const data = scoped && !query.isError ? query.data : undefined;
  const facts = result?.lifecycle ?? data;
  const restricted = isRestricted(data) || isRestricted(result?.lifecycle);
  const unavailable = facts?.recoveryReason === 'BILLING_DISABLED' || facts?.recoveryReason === 'PRICE_NOT_READY' || facts?.onboardingStep === 'UNAVAILABLE';
  const shouldReconcile = !!data && data.onboardingStep === 'RECONCILE' && !restricted && !unavailable;
  const conflict = result?.outcome === 'CONFLICT' || (!shouldReconcile && facts?.recoveryReason === 'EMAIL_CONFLICT');
  const waiting = shouldReconcile && (result === undefined || (result?.outcome === 'IN_PROGRESS' && attempt < retryDelays.length));
  const title = restricted ? 'This account is restricted' : unavailable ? 'Payments are unavailable right now' : conflict ? 'This email is already used for payments' : waiting ? 'Checking your previous checkout' : 'Check subscription status';
  const message = restricted ? "Company operations are on hold. Payment doesn't lift this. Contact support." : unavailable ? 'Your account and plan choice are saved. Try again or contact support.' : conflict ? 'Contact support to link this email, or sign up with another email.' : waiting ? result?.outcome === 'IN_PROGRESS' ? 'Your previous checkout is still being checked. Please wait.' : "We're asking Paddle what happened, so you don't pay twice." : 'We could not confirm your previous checkout. Check again before making another payment.';

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    void getPublicSupport(controller.signal).then(support => { if (active) setEmail(support.email); }).catch(() => {});
    return () => { active = false; controller.abort(); };
  }, []);

  useEffect(() => {
    if (!shouldReconcile) return;
    // Reuse this attempt's promise during StrictMode effect replay. A second
    // subscription observes its result without sending a second mutation.
    if (request.current?.attempt !== attempt) request.current = { attempt, promise: reconcileBillingCheckout(undefined, companyId) };
    let active = true;
    void request.current.promise.then(value => {
      if (!active) return;
      setSettled({ attempt, result: value });
      const lifecycle = value.lifecycle;
      if (lifecycle.company.id !== companyId || !lifecycle.company.isActive || lifecycle.company.operationalStatus === 'SUSPENDED' || lifecycle.onboardingStep === 'RESTRICTED') return;
      const destination = { RESUMABLE: '/subscription/payment', CLEARED: '/choose-plan', PAID: '/subscription/activation' }[value.outcome as 'RESUMABLE' | 'CLEARED' | 'PAID'];
      if (destination) navigate(destination, { replace: true });
    }).catch(() => { if (active) setSettled({ attempt, result: null }); });
    return () => { active = false; };
  }, [attempt, companyId, navigate, shouldReconcile]);

  useEffect(() => {
    if (!shouldReconcile || restricted || unavailable || result?.outcome !== 'IN_PROGRESS' || attempt >= retryDelays.length) return;
    const timer = setTimeout(() => setAttempt(value => value + 1), retryDelays[attempt]);
    return () => clearTimeout(timer);
  }, [attempt, restricted, unavailable, result, shouldReconcile]);

  useEffect(() => { heading.current?.focus({ preventScroll: true }); }, [title, message]);

  return <FlowShell step="payment">
    <h1 ref={heading} tabIndex={-1}>{t(title)}</h1>
    <p className="flow-lede">{t(message)}</p>
    <div className="flow-form">
      {waiting ? <p role="status"><span className="flow-spinner" aria-hidden="true" /> {t('This takes a few seconds.')}</p> : null}
      {!restricted && !conflict && !waiting ? <Button className="flow-button" disabled={query.isFetching} onClick={() => {
        if (shouldReconcile) setAttempt(value => value + 1);
        else void query.refetch();
      }}>{t(unavailable ? 'Try again' : 'Check again')}</Button> : null}
      {!waiting && email ? <Button asChild className={`flow-button${restricted || conflict ? '' : ' flow-button-secondary'}`}>
        <a href={`mailto:${email}`}>{t('Contact support')}</a>
      </Button> : null}
      {conflict ? <Link to="/signup">{t('Sign up with another email')}</Link> : null}
    </div>
  </FlowShell>;
}
