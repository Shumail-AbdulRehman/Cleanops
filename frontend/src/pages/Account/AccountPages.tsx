import { useContext, useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useDispatch } from 'react-redux';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import useAuth from '@/hooks/useAuth';
import { clearUser } from '@/store/slices/authSlice';
import { useLanguage } from '@/i18n/context';
import AuthShell from '@/components/common/AuthShell';
import PageHeader from '@/components/common/PageHeader';
import { SkeletonLine } from '@/components/common/LoadingSkeleton';
import { WorkspaceTheme } from '@/components/common/WorkspaceTheme';
import FlowShell from '@/pages/Onboarding/FlowShell';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { changePassword, companySettings, completeOwnerLink, ownerStatus, requestRecovery, requestVerification, responseStatus, saveCompanySettings, type CompanySettings } from './api';
import { forgetOwnerLinkToken, ownerLinkToken } from './linkToken';
import '@/workspace.css';
import '@/workspace-refresh.css';
import './account.css';
import './settings-v6.css';

function useSecurityCompletion() {
 const query = useQueryClient(), dispatch = useDispatch(), navigate = useNavigate();
 return () => {
  forgetOwnerLinkToken(); dispatch(clearUser()); query.clear();
  query.setQueryData(['currentUser'], null);
  navigate('/login', {replace: true, state: {securityCompleted: true}});
 };
}
function SecurityShell({title, description, children, publicPage = false}: {title: string; description: string; children: ReactNode; publicPage?: boolean}) {
 const {t} = useLanguage();
 const translatedTitle = t(title);
 useEffect(() => {
  if (publicPage) document.title = `${translatedTitle} | Hygene Ops`;
 }, [publicPage, translatedTitle]);
 if (publicPage) return <FlowShell size="narrow">
  <h1>{t(title)}</h1>
  <p className="flow-lede">{t(description)}</p>
  <div className="flow-form">{children}<p className="flow-fine"><Link to="/login">{t('Return to sign in')}</Link></p></div>
 </FlowShell>;
 return <div className="workspace account-public"><AuthShell title={t(title)} subtitle={t(description)} footer={<Link to="/login">{t('Return to sign in')}</Link>}>{children}</AuthShell></div>;
}
function PasswordFields({current, submit, busy, label}: {current: boolean; submit: (currentPassword: string, newPassword: string) => Promise<void>; busy?: boolean; label: string}) {
 const {t} = useLanguage();
 const [pending, setPending] = useState(false), [error, setError] = useState('');
 async function save(event: FormEvent<HTMLFormElement>) {
  event.preventDefault(); const form = new FormData(event.currentTarget);
  const old = String(form.get('currentPassword') ?? ''), next = String(form.get('newPassword') ?? '');
  if ((current && !old) || next.length < 8 || new TextEncoder().encode(next).length > 72 || next !== form.get('confirmPassword')) {
   setError('Enter matching new passwords, at least 8 characters and at most 72 UTF-8 bytes.'); return;
  }
  setError(''); setPending(true);
  try { await submit(old, next); }
  catch (err) {
   const status = responseStatus(err);
   setError(status === 410 || (!current && (status === 400 || status === 403)) ? 'This link is invalid, expired or already used. Request a new link.' : status === 403 ? 'Your current password could not be verified, or access changed. Check it and try again.' : status === 400 ? 'Choose a different valid new password and try again.' : 'The password could not be changed. Check your connection and try again.');
  } finally {setPending(false);}
 }
 return <form className={current ? "account-form" : "grid gap-5"} onSubmit={save}>
  {current && <label>{t('Current password')}<Input name="currentPassword" type="password" dir="ltr" autoComplete="current-password" required maxLength={1024}/></label>}
  <label className={current ? undefined : 'flow-field'}>{t('New password')}<Input name="newPassword" type="password" dir="ltr" autoComplete="new-password" required minLength={8} aria-describedby="password-help"/></label>
  <p id="password-help" className={current ? "account-help" : "flow-fine"}>{t('Use at least 8 characters and at most 72 UTF-8 bytes. Choose a different password.')}</p>
  <label className={current ? undefined : 'flow-field'}>{t('Confirm new password')}<Input name="confirmPassword" type="password" dir="ltr" autoComplete="new-password" required minLength={8}/></label>
  {error && (current ? <p role="alert" className="account-error">{t(error)}</p> : <div role="alert" className="flow-notice flow-notice-bad">{t(error)} <Link to="/recover-owner-account">{t('Request recovery link')}</Link></div>)}
  <Button className={current ? undefined : "flow-button"} aria-busy={!current && pending ? true : undefined} disabled={pending || busy} type="submit">{t(pending ? 'Saving password…' : label)}</Button>
 </form>;
}
export function OwnSecurityPage({forced = false}: {forced?: boolean}) {
 const {t} = useLanguage(), {isAuthenticated} = useAuth(); const complete = useSecurityCompletion();
 const inWorkspace = useContext(WorkspaceTheme);
 const title = forced ? 'Replace your password' : 'Your account security';
 const description = forced ? 'Replace your password before continuing. This changes only your own credentials.' : 'Change your own password. You will need to sign in again on every device.';
 const content = <>
  {!isAuthenticated && !forced ? <p role="alert">{t('Sign in to change your own password.')} <Link to="/login">{t('Sign in')}</Link></p> : <PasswordFields current label="Change password" submit={async (old, next) => {await changePassword(old, next); complete();}}/>}
  <p className={inWorkspace ? 'wx-settings-help' : 'account-help'}><Link to="/recover-owner-account">{t('Owner password recovery')}</Link></p>
 </>;
 if (inWorkspace) return <div className="wx-settings wx-settings-own-security">
  <PageHeader title={title} subtitle={description}/>
  <section className="wx-settings-panel" aria-labelledby="own-password-heading"><h2 id="own-password-heading">{t('Change password')}</h2>{content}</section>
 </div>;
 return <SecurityShell title={title} description={description}>{content}</SecurityShell>;
}
export function OwnerRecoveryPage() {
 const {t} = useLanguage(); const [pending, setPending] = useState(false), [receipt, setReceipt] = useState(false), [error, setError] = useState('');
 async function submit(event: FormEvent<HTMLFormElement>) {
  event.preventDefault(); const email = String(new FormData(event.currentTarget).get('email') ?? ''); setPending(true); setError('');
  try {await requestRecovery(email); setReceipt(true);}
  catch (err) {setError(responseStatus(err) === 503 ? 'Email recovery is unavailable. Contact your company owner or the configured support channel. Delivery has not been confirmed.' : responseStatus(err) === 429 ? 'Too many requests. Wait before trying again. Delivery has not been confirmed.' : 'The request could not be accepted. Check your connection and try again.');}
  finally {setPending(false);}
 }
 return <SecurityShell publicPage title="Recover your owner account" description="Recovery is for verified company owners. Managers and staff should ask their company owner about account access.">
  {receipt ? <div role="status" className="flow-notice flow-notice-ok"><p>{t('If that email has an owner account, a reset link is on its way.')}</p><p>{t('Check your inbox and spam folder. If no link arrives, contact the configured support channel.')}</p></div> : <form onSubmit={submit} className="grid gap-5"><label className="flow-field">{t('Owner email')}<Input name="email" type="email" dir="ltr" autoComplete="email" required maxLength={254}/></label>{error && <p role="alert" className="flow-notice flow-notice-bad">{t(error)}</p>}<Button className="flow-button flow-button-full" type="submit" disabled={pending} aria-busy={pending}>{t(pending ? 'Requesting recovery…' : 'Request recovery link')}</Button></form>}
 </SecurityShell>;
}
export function OwnerLinkPage({kind}: {kind: 'verify' | 'reset'}) {
 const {t} = useLanguage(); const [token] = useState(() => ownerLinkToken(kind === 'verify' ? '/verify-owner-email' : '/reset-owner-password'));
 const [pending, setPending] = useState(false), [error, setError] = useState(''); const complete = useSecurityCompletion();
 async function verify() {
  if (!token || pending) return; setPending(true); setError('');
  try {await completeOwnerLink('verify', token); complete();}
  catch (err) {setError([400,403,410].includes(responseStatus(err) ?? 0) ? 'This link is invalid, expired or already used. Request a new link.' : 'Verification could not finish. Check your connection and try again.');}
  finally {setPending(false);}
 }
 return <SecurityShell publicPage title={kind === 'verify' ? 'Verify owner email' : 'Reset owner password'} description="Opening this page does not use the link. Confirm below to continue. Completing this action requires signing in again.">
  {!token ? <div role="alert" className="flow-notice flow-notice-bad"><p>{t('This link is missing or invalid. Open the complete link from your email. Reloading removes the temporary link for your security.')}</p><Link to={kind === 'reset' ? '/recover-owner-account' : '/settings'}>{t(kind === 'reset' ? 'Request recovery link' : 'Open company settings')}</Link></div> : kind === 'reset' ? <PasswordFields current={false} label="Reset password" submit={async (_old, next) => {await completeOwnerLink('reset', token, next); complete();}}/> : <div className="grid gap-5">{error && <div role="alert" className="flow-notice flow-notice-bad">{t(error)} <Link to="/settings">{t('Open company settings')}</Link></div>}<Button className="flow-button flow-button-full" onClick={verify} disabled={pending} aria-busy={pending}>{t(pending ? 'Verifying…' : 'Confirm owner email')}</Button></div>}
 </SecurityShell>;
}
function OrganizationForm({saved, update}: {saved: CompanySettings; update: (saved: CompanySettings) => void}) {
 const {t} = useLanguage(); const [pending, setPending] = useState(false), [message, setMessage] = useState(''), [error, setError] = useState('');
 async function submit(event: FormEvent<HTMLFormElement>) {
  event.preventDefault(); const name = String(new FormData(event.currentTarget).get('name') ?? '').trim(); setMessage(''); setError('');
  if (name.length < 2 || name.length > 160) {setError('Enter a company name between 2 and 160 characters.'); return;}
  setPending(true);
  try {const result = await saveCompanySettings(name, saved.accountVersion); update(result.company); setMessage('Company settings saved.');}
  catch (err) {setError(responseStatus(err) === 409 ? 'Company settings changed elsewhere. Your draft is kept. Reload saved settings before trying again.' : responseStatus(err) === 403 ? 'Company changes are restricted. Check your account access or plan activation.' : 'Company settings could not be saved. Your draft is kept. Try again.');}
  finally {setPending(false);}
 }
 return <form className="wx-settings-form" onSubmit={submit} aria-busy={pending}><label>{t('Company name')}<Input name="name" defaultValue={saved.name} required minLength={2} maxLength={160} aria-describedby="company-name-help"/></label><p id="company-name-help" className="wx-settings-notice">{t('Company settings update the company name only. Review your owner email in My account.')}</p><p className="wx-settings-help">{t('Saved company name: {name}', {name: saved.name})}</p>{error && <p role="alert" className="wx-settings-error">{t(error)}</p>}{message && <p role="status">{t(message)}</p>}<Button type="submit" disabled={pending}>{t(pending ? 'Saving…' : 'Save company name')}</Button></form>;
}
function OwnerVerification() {
 const {t} = useLanguage(); const {user} = useAuth(); const status = useQuery({queryKey:['ownerIdentity',user?.companyId,user?.role,user?.id],queryFn:ownerStatus,retry:false,staleTime:0});
 const [pending, setPending] = useState(false), [receipt, setReceipt] = useState(false), [error, setError] = useState('');
 async function submit(event: FormEvent<HTMLFormElement>) {
  event.preventDefault(); const password = String(new FormData(event.currentTarget).get('currentPassword') ?? ''); setPending(true); setError('');
  try {await requestVerification(password); setReceipt(true); (event.target as HTMLFormElement).reset();}
  catch (err) {setError(responseStatus(err) === 503 ? 'Verification delivery is unavailable. No delivery has been confirmed.' : responseStatus(err) === 403 ? 'Current owner credentials or verified enrollment are required. Check your password or contact the configured support channel.' : 'Verification could not be requested. Try again. Delivery has not been confirmed.');}
  finally {setPending(false);}
 }
 return <section className="wx-settings-verification"><h3>{t('Owner email verification')}</h3>
  {status.isPending ? <SettingsLoading label="Loading owner verification…"/> : status.isError ? <><p role="alert">{t('Owner verification status could not load.')}</p><Button variant="outline" onClick={() => status.refetch()}>{t('Retry')}</Button></> : status.data.emailVerified ? <p>{t('Owner email is verified.')}</p> : <>
   <p>{t('Owner email is not verified.')}</p>
   {status.data.bootstrapRequired ? <p>{t('This legacy account needs identity-verified enrollment through the configured support channel. Signing in does not verify an email.')}</p> : !status.data.deliveryConfigured ? <p>{t('Verification email delivery is unavailable. Contact the configured support channel.')}</p> : receipt ? <p role="status">{t('Request accepted for processing. Delivery is not confirmed. Check your inbox and spam folder.')}</p> : <form onSubmit={submit} className="wx-settings-form"><label>{t('Current password')}<Input name="currentPassword" type="password" dir="ltr" autoComplete="current-password" required maxLength={1024}/></label>{error && <p role="alert" className="wx-settings-error">{t(error)}</p>}<Button type="submit" variant="outline" disabled={pending}>{t(pending ? 'Requesting verification…' : 'Request verification link')}</Button></form>}
  </>}
 </section>;
}
function SettingsLoading({label}: {label: string}) {
 const {t} = useLanguage();
 return <div className="wx-settings-loading" role="status" aria-live="polite" aria-busy="true">
  <span className="wx-settings-loading-label">{t(label)}</span>
  <div aria-hidden="true"><SkeletonLine width="short"/><SkeletonLine width="full"/><SkeletonLine width="long"/></div>
 </div>;
}
export function CompanySettingsPage() {
 const {t} = useLanguage(), {user} = useAuth(); const query = useQueryClient();
 const [params, setParams] = useSearchParams(); const complete = useSecurityCompletion();
 const [settingsRevision, setSettingsRevision] = useState(0);
 const active = ['account', 'security'].includes(params.get('section') ?? '') ? params.get('section')! : 'organization';
 const settings = useQuery({queryKey:['companySettings', user?.companyId],queryFn:companySettings,enabled:user?.role === 'ADMIN',retry:false,staleTime:0});
 if (user?.role !== 'ADMIN') return <p role="alert">{t('Only the company owner can manage organization settings.')} <Link to="/account/security">{t('Your account security')}</Link></p>;
 async function reload() {const result = await settings.refetch(); if (result.isSuccess) setSettingsRevision(previous => previous + 1);}
 function choose(section: string) {setParams(previous => {const next = new URLSearchParams(previous); if (section === 'organization') next.delete('section'); else next.set('section', section); return next;});}
 return <div className="wx-settings" key={`${user.companyId}:${user.role}:${user.id}`}>
  <PageHeader title="Settings" subtitle="Keep company details and your own access up to date."/>
  <div className="wx-settings-layout">
   <div className="wx-settings-nav" role="group" aria-label={t('Settings sections')}>
    {([['organization', 'Organization'], ['account', 'My account'], ['security', 'Security']] as const).map(([id, label]) => <button key={id} id={`settings-section-${id}`} type="button" aria-pressed={active === id} aria-controls={`settings-${id}`} onClick={() => choose(id)}>{t(label)}</button>)}
   </div>
   <div className="wx-settings-content">
    <section id="settings-organization" hidden={active !== 'organization'} className="wx-settings-panel" aria-labelledby="settings-organization-heading">
     <h2 id="settings-organization-heading">{t('Organization details')}</h2>
     {settings.isPending ? <SettingsLoading label="Loading company settings…"/> : !settings.data ? <div className="wx-settings-state"><p role="alert" className="wx-settings-error">{t(responseStatus(settings.error) === 403 ? 'Company settings are restricted. Your own account security remains available.' : 'Company settings could not load. Your saved records are unchanged.')}</p><Button variant="outline" onClick={reload} disabled={settings.isFetching} aria-busy={settings.isFetching}>{t('Reload saved settings')}</Button></div> : <OrganizationForm key={`${user.companyId}:${settingsRevision}`} saved={settings.data} update={saved => query.setQueryData(['companySettings', user.companyId],saved)}/>}
     {settings.data && settings.isError && <p role="alert" className="wx-settings-error">{t('Company settings could not load. Your saved records are unchanged.')}</p>}
     {settings.data && <Button className="wx-settings-reload" variant="ghost" disabled={settings.isFetching} aria-busy={settings.isFetching} onClick={reload}>{t('Reload saved settings')}</Button>}
     <aside className="wx-settings-protected" aria-labelledby="settings-protected-heading">
      <h2 id="settings-protected-heading">{t('What stays protected')}</h2>
      <p>{t('Organization settings cannot change the company ID, subscription entitlements or platform permissions.')}</p>
      <p className="wx-settings-supporting">{t('Own-password changes remain separate from company operations and billing access.')}</p>
      <Link className="wx-settings-text-link" to="/account/security">{t('Change your password')}</Link>
     </aside>
    </section>
    <section id="settings-account" className="wx-settings-panel" hidden={active !== 'account'} aria-labelledby="settings-account-heading">
     <h2 id="settings-account-heading">{t('My account')}</h2>
     <dl className="wx-settings-facts"><div><dt>{t('Name')}</dt><dd><bdi>{user.name}</bdi></dd></div><div><dt>{t('Role')}</dt><dd>{t('Company owner')}</dd></div><div><dt>{t('Email')}</dt><dd><bdi dir="ltr">{user.email}</bdi></dd></div></dl>
     {active === 'account' && <OwnerVerification key={`${user.companyId}:${user.role}:${user.id}`}/>}
    </section>
    <section id="settings-security" hidden={active !== 'security'} className="wx-settings-panel" aria-labelledby="settings-password-heading">
     <h2 id="settings-password-heading">{t('Change password')}</h2>
     <p className="wx-settings-supporting">{t('Change your own password. You will need to sign in again on every device.')}</p>
     {active === 'security' && <PasswordFields current label="Change password" submit={async (old, next) => {await changePassword(old, next); complete();}}/>}
     <aside className="wx-settings-protected" aria-labelledby="settings-session-heading">
      <h2 id="settings-session-heading">{t('Session security')}</h2>
      <dl className="wx-settings-facts"><div><dt>{t('Current access')}</dt><dd>{t('Company owner')}</dd></div><div><dt>{t('Scope')}</dt><dd>{t('Your company role only')}</dd></div></dl>
      <p className="wx-settings-notice">{t('Changing your password signs you out on every device. Sign in again with your new password.')}</p>
      <div className="wx-settings-links"><Link className="wx-settings-text-link" to="/account/security">{t('Your account security')}</Link><Link className="wx-settings-text-link" to="/recover-owner-account">{t('Owner password recovery')}</Link></div>
     </aside>
    </section>
   </div>
  </div>
 </div>;
}
