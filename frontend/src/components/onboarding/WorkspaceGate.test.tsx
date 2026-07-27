import { configureStore } from '@reduxjs/toolkit';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { Provider } from 'react-redux';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, expect, it, vi } from 'vitest';
import authReducer, { setUser, type AuthUser } from '@/store/slices/authSlice';
import { LanguageProvider } from '@/i18n/LanguageProvider';
import { onboardingRouteForStep } from '@/pages/Onboarding/onboardingRoutes';
import type { BillingLifecycle, BillingOnboardingStep } from '@/pages/Subscription/types';
import WorkspaceGate from './WorkspaceGate';

const boundary = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('@/api/client', () => ({ client: { get: boundary.get } }));
let lifecycle: BillingLifecycle;
function mount({ path = '/dashboard', role = 'ADMIN', language = 'en' }: { path?: string; role?: AuthUser['role']; language?: string } = {}) {
  localStorage.setItem('hygene-ops.language', language);
  const store = configureStore({ reducer: { auth: authReducer } });
  store.dispatch(setUser({ id: 7, companyId: 42, role, name: 'Test owner', email: 'owner@example.invalid' }));
  const query = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return { ...render(<Provider store={store}><QueryClientProvider client={query}><LanguageProvider><MemoryRouter initialEntries={[path]}><Routes><Route path={path} element={<WorkspaceGate><h1>Operational records</h1></WorkspaceGate>} />{['/subscription', '/choose-plan', '/subscription/payment', '/subscription/activation', '/subscription/recovery', '/account/security'].filter(route => route !== path).map(route => <Route key={route} path={route} element={<h1>{route === '/choose-plan' ? 'Plan selection' : route === '/subscription/activation' ? 'Confirmation' : route === '/subscription/recovery' ? 'Recovery' : route}</h1>} />)}</Routes></MemoryRouter></LanguageProvider></QueryClientProvider></Provider>), query };
}
beforeEach(() => {
  vi.clearAllMocks(); localStorage.clear();
  lifecycle = { company: { id: 42, name: 'Test company', plan: 'PRO', isActive: true, operationalStatus: 'SUSPENDED' }, usage: { locations: 4, staff: 28, managers: 2 }, limits: { locations: 5, staff: 25, managers: 3 }, subscription: null, reconciliationRequired: false, billingConfigured: false, ownerVerified: false, providerState: 'NOT_LINKED', portalAvailable: false, checkoutAvailable: false, onboardingStep: 'RESTRICTED' };
  boundary.get.mockImplementation(async () => ({ data: { data: structuredClone(lifecycle) } }));
});
it('sends suspended owners to recovery without mounting operational children', async () => {
  mount(); await screen.findByRole('heading', { name: 'Recovery' });
  expect(screen.queryByText('Operational records')).not.toBeInTheDocument();
});
it.each(['/subscription', '/settings', '/settings/security'])('keeps safe destination %s independent of operational check', path => {
  mount({ path }); expect(screen.getByText('Operational records')).toBeInTheDocument(); expect(boundary.get).not.toHaveBeenCalled();
});
it.each(['MANAGER', 'STAFF'] as const)('does not request owner billing for %s', role => {
  mount({ role }); expect(screen.getByText('Operational records')).toBeInTheDocument(); expect(boundary.get).not.toHaveBeenCalled();
});
it.each(['/dashboard', '/staff', '/locations', '/attendance'])('sends an owner with no billing account from %s to plan selection', async path => {
  lifecycle.company.operationalStatus = 'ACTIVE'; lifecycle.onboardingStep='CHOOSE_PLAN'; mount({ path });
  await screen.findByRole('heading', { name: 'Plan selection' });
  expect(screen.queryByText('Operational records')).not.toBeInTheDocument();
});
it.each(['active', 'trialing', 'past_due', 'canceled', 'paused'])('preserves read access for an existing %s subscription', async status => {
  lifecycle.company.operationalStatus = 'ACTIVE'; lifecycle.onboardingStep='ACCOUNT'; lifecycle.providerState = 'MIRRORED';
  lifecycle.subscription = { status, plan: 'PRO', catalogQualified: true, periodStart: null, periodEnd: null, scheduledChangeAction: null, scheduledChangeAt: null, lastEventAt: '2026-11-05T00:00:00Z' };
  mount(); await screen.findByText('Operational records');
  expect(screen.queryByText('Plan selection')).not.toBeInTheDocument();
});
it('does not restart onboarding for a provider account awaiting synchronization', async () => {
  lifecycle.company.operationalStatus = 'ACTIVE'; lifecycle.providerState = 'AWAITING_PROVIDER'; lifecycle.onboardingStep='CONFIRMING'; lifecycle.onboardingRequired=false;
  mount(); await screen.findByText('Operational records');
});
it('uses actual inactive company state even when its legacy operational status is active', async () => {
  lifecycle.company.isActive = false; lifecycle.company.operationalStatus = 'ACTIVE';
  mount(); await screen.findByRole('heading', { name: 'Recovery' });
  expect(screen.queryByText('Operational records')).not.toBeInTheDocument();
});
it('an explicit authorization denial supersedes a previously active snapshot', async () => {
  lifecycle.company.operationalStatus = 'ACTIVE'; lifecycle.providerState = 'AWAITING_PROVIDER'; lifecycle.onboardingStep='CONFIRMING'; lifecycle.onboardingRequired=false; const { query } = mount();
  await screen.findByText('Operational records');
  boundary.get.mockRejectedValue({ response: { status: 403 } });
  await act(async () => { await query.refetchQueries(); });
  expect(await screen.findByRole('alert')).toHaveTextContent('Billing is temporarily unavailable');
  expect(screen.queryByText('Operational records')).not.toBeInTheDocument();
});
it('does not trust another company lifecycle or expose its operational subtree', async () => {
  lifecycle.company.id = 99; mount(); expect(await screen.findByRole('alert')).toHaveTextContent('Billing is temporarily unavailable'); expect(screen.queryByText('Operational records')).not.toBeInTheDocument();
});
it('distinguishes an unavailable check and explicitly retries real lifecycle state', async () => {
  boundary.get.mockRejectedValue(new Error('private provider detail')); mount();
  expect(await screen.findByRole('alert')).toHaveTextContent('Billing is temporarily unavailable');
  expect(screen.queryByText('private provider detail')).not.toBeInTheDocument();
  lifecycle.company.operationalStatus = 'ACTIVE'; lifecycle.providerState = 'AWAITING_PROVIDER'; lifecycle.onboardingStep='CONFIRMING'; lifecycle.onboardingRequired=false; boundary.get.mockResolvedValue({ data: { data: lifecycle } });
  fireEvent.click(screen.getByRole('button', { name: 'Try again' })); await screen.findByText('Operational records');
});
it('shows the workspace skeleton without asserting suspension or mounting operational data while billing is pending', () => {
  boundary.get.mockReturnValue(new Promise(() => {})); mount();
  expect(screen.getByRole('status')).toHaveAccessibleName('Loading…');
  expect(screen.getByRole('status')).toHaveAttribute('data-loading-layout', 'owner-overview');
  expect(screen.getByRole('status')).toHaveAttribute('aria-busy', 'true');
  expect(screen.queryByText('Checking subscription status…')).not.toBeInTheDocument();
  expect(screen.queryByText('Operational records')).not.toBeInTheDocument();
});

it('keeps a newly created provider customer in onboarding until its subscription is linked', async () => {
 lifecycle.company.operationalStatus='ACTIVE';lifecycle.providerState='AWAITING_PROVIDER';lifecycle.onboardingRequired=true;lifecycle.onboardingStep='CHOOSE_PLAN';
 mount();await screen.findByRole('heading',{name:'Plan selection'});expect(screen.queryByText('Operational records')).not.toBeInTheDocument();
});

it('an early unknown mirrored subscription cannot mount operations',async()=>{lifecycle.company.operationalStatus='ACTIVE';lifecycle.providerState='MIRRORED';lifecycle.onboardingRequired=true;lifecycle.onboardingStep='CONFIRMING';lifecycle.subscription={status:'unknown',plan:null,catalogQualified:false,periodStart:null,periodEnd:null,scheduledChangeAction:null,scheduledChangeAt:null,lastEventAt:'2026-11-08T00:00:00Z'};mount();await screen.findByRole('heading',{name:'Confirmation'});expect(screen.queryByText('Operational records')).not.toBeInTheDocument();});

const steps: BillingOnboardingStep[] = ['CHOOSE_PLAN', 'PAYMENT', 'CONFIRMING', 'WORKSPACE', 'ACCOUNT', 'RECONCILE', 'RESTRICTED', 'VERIFY_EMAIL', 'UNAVAILABLE'];
it.each(steps.flatMap(step => ['/dashboard', '/staff', '/locations'].map(path => ({ step, path }))))('resolves unpaid deep link $path for $step', async ({ step, path }) => {
  lifecycle.company.operationalStatus = 'ACTIVE'; lifecycle.onboardingStep = step; lifecycle.onboardingRequired = true;
  lifecycle.workspaceAccessAllowed = step === 'WORKSPACE';
  lifecycle.checkoutResume = step === 'PAYMENT' ? { plan: 'PRO', interval: 'year', transactionId: 'txn_' + 'b'.repeat(26) } : null;
  const destination = onboardingRouteForStep(step)!;
  mount({ path });
  const expected = step === 'WORKSPACE' ? 'Operational records' : destination === '/choose-plan' ? 'Plan selection' : destination === '/subscription/activation' ? 'Confirmation' : destination === '/subscription/recovery' ? 'Recovery' : destination;
  expect(await screen.findByRole('heading', { name: expected })).toBeVisible();
  if (step !== 'WORKSPACE') expect(screen.queryByText('Operational records')).not.toBeInTheDocument();
});
it('does not treat a missing server step as workspace permission for an unpaid owner', async () => {
  lifecycle.company.operationalStatus = 'ACTIVE'; lifecycle.onboardingStep = null; lifecycle.workspaceAccessAllowed = true; lifecycle.onboardingRequired = true;
  mount(); expect(await screen.findByRole('button', { name: 'Try again' })).toBeEnabled(); expect(screen.queryByText('Operational records')).toBeNull();
});
