import { useEffect, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link, useLocation } from 'react-router-dom';
import { useLanguage } from '@/i18n/context';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import FlowShell from '../Onboarding/FlowShell';
import { ONBOARDING_ROUTES, parseOnboardingQuery } from '../Onboarding/onboardingRoutes';
import { useCreateManager } from './queries';
import { signupFailure } from './api';
import type { SignUpForm } from './types';

const nextSteps = [
  ['Create your account', 'Your details and company name'],
  ['Choose a plan', 'Monthly or yearly, sized to your team'],
  ['Add your card', 'Entered securely with Paddle'],
  ['Open your workspace', 'Then add your first location'],
] as const;

export default function SignUp() {
  const { t } = useLanguage();
  const { search } = useLocation();
  const query = new URLSearchParams(parseOnboardingQuery(search)).toString();
  const login = `${ONBOARDING_ROUTES.login}${query ? `?${query}` : ''}`;
  const { register, handleSubmit, setError, clearErrors, formState: { errors, isSubmitting } } = useForm<SignUpForm>();
  const [notice, setNotice] = useState<'duplicate' | 'retry' | 'wait' | null>(null);
  const [wait, setWait] = useState(0);
  const [showPassword, setShowPassword] = useState(false);
  const [accountCreated, setAccountCreated] = useState(false);
  const submitting = useRef(false);
  const created = useRef(false);
  const createManager = useCreateManager();
  const busy = createManager.isPending || isSubmitting;

  useEffect(() => {
    if (!wait) return;
    const timer = window.setTimeout(() => {
      setWait(wait - 1);
      if (wait === 1) setNotice(null);
    }, 1000);
    return () => window.clearTimeout(timer);
  }, [wait]);

  const onSubmit = async (data: SignUpForm) => {
    if (submitting.current || created.current || wait > 0) return;
    submitting.current = true;
    setNotice(null);
    clearErrors();
    try {
      const user = await createManager.mutateAsync(data);
      created.current = true;
      if (user.sessionEstablished === false) setAccountCreated(true);
    } catch (cause) {
      const failure = signupFailure(cause);
      const status = (cause as { response?: { status?: number } } | null)?.response?.status;
      if (status === 429) {
        setWait(failure.retryAfter ?? 0);
        setNotice('wait');
      } else if (failure.duplicate) {
        setError('email', { type: 'server', message: 'This email already has an account.' }, { shouldFocus: true });
        setNotice('duplicate');
      } else {
        const fields = Object.entries(failure.fields) as [keyof SignUpForm, string][];
        fields.forEach(([field, message], index) => setError(field, { type: 'server', message }, { shouldFocus: index === 0 }));
        if (!fields.length) setNotice('retry');
      }
    } finally {
      submitting.current = false;
    }
  };

  const fieldError = (name: keyof SignUpForm) => errors[name] && (
    <p id={`${name}-error`} className="flow-field-error" role="alert">{t(errors[name]?.message ?? 'This field is required.')}</p>
  );
  const fieldProps = (name: keyof SignUpForm) => ({
    'aria-invalid': !!errors[name],
    'aria-describedby': [name === 'password' ? 'password-hint' : '', errors[name] ? `${name}-error` : ''].filter(Boolean).join(' ') || undefined,
  });

  return <FlowShell siteNav size="split" step="account" aside={<>
    <h2 className="flow-panel-headline">{t('What happens next')}</h2>
    <ol className="flow-worksheet" style={{ display: 'grid', gap: 20, listStyle: 'none', margin: 0 }}>
      {nextSteps.map(([title, detail], index) => <li key={title} style={{ display: 'flex', gap: 12 }}>
        <span className="flow-step-box" aria-hidden="true" style={index === 0 ? { borderColor: 'var(--flow-primary)', background: 'var(--flow-wash)' } : undefined} />
        <span><strong style={{ display: 'block', fontSize: 14 }}>{t(title)}</strong><span className="flow-fine">{t(detail)}</span></span>
      </li>)}
    </ol>
    <p className="flow-fine">{t("You're only charged when you confirm your card.")}</p>
  </>}>
    <h1>{t('Create your account')}</h1>
    <p className="flow-lede">{t("Next you'll choose a plan and add a card.")}</p>
    {accountCreated ? <div className="flow-notice flow-notice-ok" role="status" style={{ marginBlockStart: 24 }}>
      {t('Your account is ready. Sign in to continue.')} <Link to={login}>{t('Sign in')}</Link>
    </div> : <>
      <form className="flow-form" noValidate onSubmit={handleSubmit(onSubmit)} aria-busy={busy}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 160px), 1fr))', gap: 20 }}>
          <div className="flow-field">
            <label htmlFor="name">{t('Your name')}</label>
            <Input id="name" autoComplete="name" disabled={busy} {...fieldProps('name')}
              {...register('name', { required: 'This field is required.', validate: value => !!value.trim() || 'This field is required.' })} />
            {fieldError('name')}
          </div>
          <div className="flow-field">
            <label htmlFor="companyName">{t('Company name')}</label>
            <Input id="companyName" autoComplete="organization" disabled={busy} {...fieldProps('companyName')}
              {...register('companyName', { required: 'This field is required.', validate: value => !!value.trim() || 'This field is required.' })} />
            {fieldError('companyName')}
          </div>
        </div>
        <div className="flow-field">
          <label htmlFor="email">{t('Work email')}</label>
          <Input id="email" type="email" dir="ltr" autoComplete="email" placeholder="you@company.com" disabled={busy} {...fieldProps('email')}
            {...register('email', { required: 'This field is required.', pattern: { value: /^[^\s@]+@[^\s@]+\.[^\s@]+$/, message: 'Enter a valid email address.' } })} />
          {fieldError('email')}
        </div>
        <div className="flow-field">
          <label htmlFor="password">{t('Password')}</label>
          <div className="flow-password" dir="ltr">
            <Input id="password" type={showPassword ? 'text' : 'password'} dir="ltr" autoComplete="new-password" minLength={8} disabled={busy} {...fieldProps('password')}
              {...register('password', { required: 'This field is required.', minLength: { value: 8, message: 'Use at least 8 characters.' } })} />
            <Button type="button" variant="ghost" className="flow-password-toggle" aria-controls="password" aria-pressed={showPassword} onClick={() => setShowPassword(value => !value)}>{t(showPassword ? 'Hide' : 'Show')}</Button>
          </div>
          <p id="password-hint" className="flow-fine">{t('Use at least 8 characters.')}</p>
          {fieldError('password')}
        </div>
        {notice === 'duplicate' && <p className="flow-notice flow-notice-bad"><Link to={login}>{t('Sign in instead')}</Link></p>}
        {notice === 'retry' && <p role="alert" className="flow-notice flow-notice-bad">{t('Your account could not be created. Your details are still here, so try again.')}</p>}
        {notice === 'wait' && <p role="status" className="flow-notice flow-notice-warn">{wait > 0 ? t('Too many attempts. Try again in {count} seconds.', { count: wait }) : t('Too many attempts. Try again in a few minutes.')}</p>}
        <Button className="flow-button" type="submit" disabled={busy || wait > 0} aria-busy={busy}>{t(busy ? 'Creating your account…' : 'Continue to plans')}</Button>
      </form>
      <p className="flow-fine" style={{ marginBlockStart: 24 }}>{t('Already have an account?')} <Link to={login}>{t('Sign in')}</Link></p>
    </>}
  </FlowShell>;
}
