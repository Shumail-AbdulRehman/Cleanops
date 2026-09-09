import { Link, Navigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { useLanguage } from '@/i18n/context';
import FlowShell from '@/pages/Onboarding/FlowShell';
import SupportContactLink from './SupportContactLink';
import { useCheckoutConfirmation } from './useCheckoutConfirmation';

export default function BillingActivationPage() {
  const { t, language } = useLanguage();
  const { status, lifecycle, outcome, consecutiveNotPaid, retry } = useCheckoutConfirmation();
  const denied = status === 'denied';
  const restricted = !!lifecycle && (!lifecycle.company.isActive ||
    lifecycle.company.operationalStatus === 'SUSPENDED' || lifecycle.onboardingStep === 'RESTRICTED');
  // An ACTIVE result alone is insufficient: the server's next step must also be WORKSPACE.
  const ready = !denied && !restricted && status === 'active' &&
    lifecycle?.onboardingStep === 'WORKSPACE' && lifecycle.workspaceAccessAllowed;
  const subscription = lifecycle?.subscription;
  // CONFIRMING also covers an unknown subscription. It is not proof of a payment.
  const activated = !denied && !restricted && subscription?.status === 'active' && subscription.catalogQualified;
  const paymentReceived = !!activated;
  const step = ready ? 'done' : paymentReceived ? 'workspace' : 'payment';

  // A just-finished checkout may still read unpaid once. Steps alone never redirect.
  if (!denied && !restricted && (status === 'waiting' || status === 'slow')) {
    if (outcome === 'NO_CHECKOUT') return <Navigate to="/choose-plan" replace />;
    if (outcome === 'NOT_PAID' && consecutiveNotPaid >= 2) {
      return <Navigate to={lifecycle?.onboardingStep === 'CHOOSE_PLAN' ? '/choose-plan' : '/subscription/payment'} replace />;
    }
  }

  const nextPayment = !subscription?.scheduledChangeAction && subscription?.periodEnd &&
    Number.isFinite(Date.parse(subscription.periodEnd))
    ? new Intl.DateTimeFormat(language === 'ur' ? 'ur-PK' : 'en-PK', { dateStyle: 'medium', timeZone: 'UTC' })
      .format(new Date(subscription.periodEnd))
    : t('Not available');
  const plan = subscription?.plan ?? lifecycle?.company.plan;
  const planName = plan ? { STARTER: 'Starter', PRO: 'Pro', ADVANCED: 'Enterprise' }[plan] : 'Not available';
  const needsRetry = status === 'timedOut' || (status === 'active' && !ready);

  return <FlowShell step={denied || restricted ? 'none' : step}>
    <section className="grid gap-6" aria-labelledby="confirmation-heading">
      <div role="status" aria-atomic="true">
        <h1 id="confirmation-heading">{t(denied ? 'Sign in again' : restricted ? 'This account is restricted' : ready ? "You're all set" : 'Confirming your subscription')}</h1>
        <p className="flow-lede">{t(denied ? 'Only the company owner can view or change billing.' : restricted
          ? "Company operations are on hold. Payment doesn't lift this. Contact support."
          : ready ? 'Your subscription is active and your workspace is ready.'
            : 'Do not enter your card again while confirmation is pending.')}</p>
      </div>

      {denied ? <Button asChild className="flow-button flow-button-full"><Link to="/login">{t('Sign in again')}</Link></Button>
        : restricted ? <SupportContactLink className="flow-button flow-button-secondary flow-button-full" />
          : ready ? <>
            <div className="flow-ready-stamp mx-auto" aria-hidden="true">
              <svg viewBox="0 0 48 48" focusable="false"><path d="m10 25 9 9 20-22" pathLength="1" /></svg>
            </div>
            <dl className="grid gap-4">
              <div className="flex flex-wrap justify-between gap-2">
                <dt className="text-(--flow-muted)">{t('Plan')}</dt>
                <dd><strong>{t(planName)}</strong> · {t(subscription?.interval === 'month' ? 'Monthly' : subscription?.interval === 'year' ? 'Yearly' : 'Not available')}</dd>
              </div>
              <div className="flex flex-wrap justify-between gap-2">
                <dt className="text-(--flow-muted)">{t('Next payment')}</dt>
                <dd><bdi dir="ltr">{nextPayment}</bdi></dd>
              </div>
            </dl>
            <Button asChild className="flow-button flow-button-full"><Link to="/dashboard">{t('Open your workspace')}</Link></Button>
            <p className="flow-fine text-center">{t('Your first step inside is adding a location.')}</p>
          </> : <>
            <div role="status" aria-atomic="true">
              <ul className="grid list-none gap-5 p-0" aria-label={t('Confirming your subscription')}>
                {[
                  { label: 'Payment received', done: paymentReceived },
                  { label: 'Activating your subscription', done: !!activated },
                  { label: 'Preparing your workspace', done: false },
                ].map(({ label, done }, index, rows) => {
                  const current = !done && (index === 0 || rows[index - 1].done);
                  return <li key={label} className="flex items-center gap-3" data-complete={done ? 'true' : undefined} aria-current={current ? 'step' : undefined}>
                    <span className={`flow-step-box${current && !needsRetry ? ' flow-confirming-ring' : ''}`} aria-hidden="true">
                      <svg viewBox="0 0 20 20" focusable="false"><path d="m4 10 4 4 8-9" pathLength="1" /></svg>
                    </span>
                    <span>{t(label)}</span>{done && <span className="flow-sr-only">{t('Step completed')}</span>}
                  </li>;
                })}
              </ul>
            </div>
            {status === 'slow' && <p className="flow-notice" role="status">{t('Taking a little longer than usual. You can stay here or come back later.')}</p>}
            {needsRetry && <>
              <p className="flow-notice flow-notice-warn" role="status">{t('We could not confirm your previous checkout. Check again before making another payment.')}</p>
              <Button className="flow-button flow-button-secondary flow-button-full" onClick={retry}>{t('Check again')}</Button>
            </>}
          </>}
    </section>
  </FlowShell>;
}
