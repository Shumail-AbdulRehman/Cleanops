import { useForm } from 'react-hook-form';
import { useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useLogin } from './queries';
import type { LoginForm } from './types';
import { useLanguage } from '@/i18n/context';
import FlowShell from '@/pages/Onboarding/FlowShell';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import './login.css';

const exampleRows = [
  ['Morning check-ins', 'Done', 'ok'],
  ['Washrooms', 'Submitted', 'ok'],
  ['Lobby floors', 'Submitted', 'ok'],
  ['Kitchen photos to review', 'Review', 'warn'],
  ['Evening shift', 'Later', 'later'],
] as const;

type LoginFailure = {
  response?: {
    status?: number;
    data?: { code?: string; errors?: { code?: string }[] };
    headers?: Record<string, unknown>;
  };
};

export default function Login() {
  const { t } = useLanguage();
  const location = useLocation();
  const { register, handleSubmit, resetField, formState: { errors, isSubmitting } } = useForm<LoginForm>({
    defaultValues: { email: '', password: '' },
  });
  const [error, setError] = useState<{ key: string; values?: Record<string, number> } | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const submitting = useRef(false);
  const login = useLogin();
  const busy = isSubmitting || login.isPending;

  async function submit(data: LoginForm) {
    if (submitting.current) return;
    submitting.current = true;
    setError(null);
    try {
      await login.mutateAsync(data);
    } catch (failure) {
      const response = (failure as LoginFailure)?.response;
      const status = response?.status;
      if (status === 401) resetField('password');
      if (status === 400 || status === 401) {
        setError({ key: 'Email or password is incorrect.' });
      } else if (status === 403) {
        const deactivated = response?.data?.code === 'ACCOUNT_DEACTIVATED' ||
          response?.data?.errors?.some(item => item.code === 'ACCOUNT_DEACTIVATED');
        setError({ key: deactivated ? 'This account is deactivated. Contact your company owner.' :
          'Sign-in is unavailable for this account. Contact your company owner.' });
      } else if (status === 429) {
        const wait = Number(response?.headers?.['retry-after']);
        setError(Number.isFinite(wait) && wait > 0
          ? { key: 'Too many attempts. Try again in {count} seconds.', values: { count: Math.ceil(wait) } }
          : { key: 'Too many attempts. Try again in a few minutes.' });
      } else {
        setError({ key: 'We could not reach Hygene Ops. Check your connection and try again.' });
      }
    } finally {
      submitting.current = false;
    }
  }

  return <FlowShell siteNav size="split" aside={<>
    <div className="flow-worksheet login-worksheet" aria-hidden="true">
      <p className="login-worksheet-header"><strong>{t('Today')}</strong><span>{t('Example day')}</span></p>
      <ul>{exampleRows.map(([label, status, tone], index) => <li key={label} data-complete={index < 3 ? 'true' : undefined}>
        <span className="flow-step-box"><svg viewBox="0 0 20 20" focusable="false"><path d="m4 10 4 4 8-9" pathLength="1" /></svg></span>
        <span>{t(label)}</span><span className={`flow-chip flow-chip-${tone}`}>{t(status)}</span>
      </li>)}</ul>
    </div>
    <p className="flow-panel-headline">{t('Your whole operation, worked down one sheet.')}</p>
  </>}>
    <h1>{t('Welcome back')}</h1>
    <p className="flow-lede">{t("Sign in to run today's work.")}</p>
    {location.state?.securityCompleted && <p className="flow-notice flow-notice-ok login-notice" role="status">{t('Security details updated. Sign in again to continue.')}</p>}
    <form className="flow-form" onSubmit={handleSubmit(submit)} aria-busy={busy} noValidate>
      <div className="flow-field">
        <label htmlFor="email">{t('Email')}</label>
        <Input id="email" type="email" dir="ltr" autoComplete="email" placeholder="you@company.com" aria-invalid={!!errors.email} aria-describedby={errors.email ? 'email-error' : undefined}
          {...register('email', { required: 'Email is required', pattern: { value: /^[^\s@]+@[^\s@]+\.[^\s@]+$/, message: 'Enter a valid email address.' } })} />
        {errors.email && <p className="flow-field-error" id="email-error" role="alert">{t(errors.email.message ?? 'Email is required')}</p>}
      </div>
      <div className="flow-field">
        <div className="login-password-label"><label htmlFor="password">{t('Password')}</label><Link to="/recover-owner-account">{t('Forgot password?')}</Link></div>
        <div className="flow-password" dir="ltr">
          <Input id="password" type={showPassword ? 'text' : 'password'} dir="ltr" autoComplete="current-password" aria-invalid={!!errors.password} aria-describedby={errors.password ? 'password-error' : undefined}
            {...register('password', { required: 'Password is required' })} />
          <Button type="button" variant="ghost" className="flow-password-toggle" aria-label={t(showPassword ? 'Hide password' : 'Show password')} aria-pressed={showPassword} onClick={() => setShowPassword(value => !value)}>{t(showPassword ? 'Hide' : 'Show')}</Button>
        </div>
        {errors.password && <p className="flow-field-error" id="password-error" role="alert">{t(errors.password.message ?? 'Password is required')}</p>}
      </div>
      {error && <p className="flow-notice flow-notice-bad" role="alert">{t(error.key, error.values)}</p>}
      <Button className="flow-button" type="submit" disabled={busy} aria-busy={busy}>{t(busy ? 'Signing in…' : 'Sign in')}</Button>
    </form>
    <p className="login-alternative">{t('New to Hygene Ops?')} <Link to="/signup">{t('Create an account')}</Link></p>
    <p className="flow-fine login-platform-link"><Link to="/platform/login">{t('Platform owner sign-in')}</Link></p>
  </FlowShell>;
}
