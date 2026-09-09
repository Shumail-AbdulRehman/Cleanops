import { configureStore } from '@reduxjs/toolkit';
import { Provider } from 'react-redux';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import authReducer, { setUser, setLoading, type AuthUser } from '@/store/slices/authSlice';
import LanguageChoice from '@/components/common/LanguageChoice';
import App, { GuestRoute } from '@/App';
import { LanguageProvider } from '@/i18n/LanguageProvider';
import { onboardingRouteForStep } from '@/pages/Onboarding/onboardingRoutes';
import type { BillingOnboardingStep } from '../types';
import { billingRoutes } from './billingRoutes';
const mocks = vi.hoisted(() => ({ current: {} as Record<string, unknown>, query: {} as Record<string, unknown>, data: {} as Record<string, unknown>, retry: vi.fn() }));
vi.mock('@/queries/auth', () => ({ useGetCurrentUser: () => mocks.current }));
vi.mock('@/pages/Account/AccountPages', () => ({ OwnSecurityPage: ({ forced }: { forced: boolean }) => <h1>{forced ? 'Forced security' : 'Security'}</h1> }));
vi.mock('../queries', () => ({ useBillingLifecycle: () => ({ data: mocks.data, dataOwner: { companyId: 42, ownerId: 7 }, isPending: false, isError: false, isFetching: false, refetch: mocks.retry, ...mocks.query }) }));
vi.mock('./BillingPlanPage', () => ({ default: () => <h1>Plan fixture</h1> }));
vi.mock('./BillingPaymentPage', () => ({ default: () => <><LanguageChoice/><h1>Payment fixture</h1><input aria-label="Stable frame fixture" /></> }));
vi.mock('./BillingActivationPage', () => ({ default: () => <h1>Confirmation fixture</h1> }));
vi.mock('./BillingAccountPage', () => ({ default: () => <h1>Subscriber fixture</h1> }));
vi.mock('./BillingRecoveryPage', () => ({ default: () => <h1>Recovery fixture</h1> }));
function mount(path: string, { role = 'ADMIN', loading = false, guest = false, app = false }: { role?: AuthUser['role']; loading?: boolean; guest?: boolean; app?: boolean } = {}) {
  const store = configureStore({ reducer: { auth: authReducer } });
  if (!guest) store.dispatch(setUser({ id: 7, companyId: 42, role, name: 'Synthetic', email: 'fixture@example.invalid' }));
  if (loading) store.dispatch(setLoading(true));
  const children = [...billingRoutes,
    { path: '/login', element: <h1>Login fixture</h1> },
    { path: '/dashboard', element: <h1>Dashboard fixture</h1> },
    { path: '/account/security', element: <h1>Security fixture</h1> },
    { path: '/signup', element: <GuestRoute><h1>Signup fixture</h1></GuestRoute> },
  ];
  const router = createMemoryRouter(app ? [{ element: <App />, children }] : children, { initialEntries: [path] });
  return { router, ...render(<Provider store={store}><LanguageProvider><RouterProvider router={router} /></LanguageProvider></Provider>) };
}
beforeEach(() => {
  vi.clearAllMocks(); mocks.retry.mockResolvedValue({}); localStorage.clear(); mocks.current = {}; mocks.query = {};
  mocks.data = { company: { id: 42, name: 'Fixture', plan: 'PRO', isActive: true, operationalStatus: 'ACTIVE' }, usage: { locations: 1, staff: 1, managers: 1 }, limits: { locations: 5, staff: 25, managers: 3 }, subscription: null, providerState: 'NOT_LINKED', billingConfigured: true, billingEnvironment: 'sandbox', ownerVerified: false, reconciliationRequired: false, checkoutAvailable: true, portalAvailable: false, checkoutReadiness: 'READY', workspaceAccessAllowed: false, checkoutResume: null, onboardingStep: 'CHOOSE_PLAN' };
});
const steps: BillingOnboardingStep[] = ['CHOOSE_PLAN', 'PAYMENT', 'CONFIRMING', 'WORKSPACE', 'ACCOUNT', 'RECONCILE', 'RESTRICTED', 'VERIFY_EMAIL', 'UNAVAILABLE'];
const paths = ['/continue', '/choose-plan', '/subscription', '/subscription/payment', '/subscription/activation', '/subscription/recovery', '/welcome'];
const titles: Record<string, string> = { '/choose-plan': 'Plan fixture', '/subscription/payment': 'Payment fixture', '/subscription/activation': 'Confirmation fixture', '/subscription': 'Subscriber fixture', '/subscription/recovery': 'Recovery fixture', '/account/security': 'Security fixture', '/dashboard': 'Dashboard fixture' };
it.each(steps.flatMap(step => paths.map(path => ({ step, path }))))('$step at $path resolves to a stable destination', async ({ step, path }) => {
  mocks.data.onboardingStep = step; if (step === 'PAYMENT') mocks.data.checkoutResume = { plan: 'PRO', interval: 'year', transactionId: 'txn_' + 'b'.repeat(26) }; mocks.data.workspaceAccessAllowed = step === 'WORKSPACE';
  const route = step === 'WORKSPACE' && ['/welcome', '/subscription/activation'].includes(path) ? '/subscription/activation' : onboardingRouteForStep(step)!;
  const { router } = mount(path);
  expect(await screen.findByRole('heading', { name: titles[route] })).toBeVisible();
  expect(router.state.location.pathname).toBe(route);
  expect(document.querySelector('.workspace-sidebar')).toBeNull();
  await act(async () => { await router.navigate(0); });
  expect(screen.getByRole('heading', { name: titles[route] })).toBeVisible();
  expect(router.state.location.pathname).toBe(route);
});
it('guest redirects after restoration while loading waits', async () => {
  const view = mount('/choose-plan', { guest: true, loading: true }); expect(screen.queryByText('Login fixture')).toBeNull();
  view.unmount(); mount('/choose-plan', { guest: true }); expect(await screen.findByText('Login fixture')).toBeVisible();
});
it.each(['MANAGER', 'STAFF'] as const)('%s never mounts owner billing', async role => {
  mount('/subscription/payment', { role }); expect(await screen.findByText('Dashboard fixture')).toBeVisible(); expect(screen.queryByText('Payment fixture')).toBeNull();
});
it('authenticated signup resolves through the real continue route', async () => {
  mount('/signup'); expect(await screen.findByText('Plan fixture')).toBeVisible();
});
it('forced password change wins before billing screens', async () => {
  mocks.current = { isError: true, error: { response: { status: 403, data: { errors: [{ code: 'PASSWORD_CHANGE_REQUIRED' }] } } } };
  mount('/subscription/payment', { app: true }); expect(await screen.findByText('Forced security')).toBeVisible(); expect(screen.queryByText('Payment fixture')).toBeNull();
});
it.each(paths)('missing step at %s stays on retry rather than guessing', async path => {
  mocks.data.onboardingStep = null;
  const { router } = mount(path); expect(await screen.findByRole('button', { name: 'Try again' })).toBeEnabled();
  expect(router.state.location.pathname).toBe(path); expect(screen.queryByText('Payment fixture')).toBeNull();
});
it.each(paths)('read error at %s ignores stale server access', async path => {
  mocks.data.onboardingStep = 'WORKSPACE'; mocks.data.workspaceAccessAllowed = true; mocks.query.isError = true;
  const { router } = mount(path); fireEvent.click(await screen.findByRole('button', { name: 'Try again' })); expect(mocks.retry).toHaveBeenCalledTimes(path === '/continue' ? 1 : 2);
  expect(router.state.location.pathname).toBe(path); expect(screen.queryByText('Dashboard fixture')).toBeNull();
});
it('subscribed WORKSPACE owner retains settings at subscription', async () => {
  mocks.data.onboardingStep = 'WORKSPACE'; mocks.data.workspaceAccessAllowed = true;
  mocks.data.subscription = { status: 'active', plan: 'PRO', catalogQualified: true, periodStart: null, periodEnd: null, scheduledChangeAction: null, scheduledChangeAt: null, lastEventAt: '2026-11-10T00:00:00Z' };
  const { router } = mount('/subscription'); expect(await screen.findByText('Subscriber fixture')).toBeVisible(); expect(router.state.location.pathname).toBe('/subscription');
});
it.each([['CHOOSE_PLAN', '/subscription/payment?plan=PRO&interval=year', 'Payment fixture'], ['PAYMENT', '/choose-plan?plan=PRO&interval=year', 'Plan fixture']])('allows %s selection navigation and browser back', async (step, path, title) => {
  mocks.data.onboardingStep = step; if (step === 'PAYMENT') mocks.data.checkoutResume = { plan: 'PRO', interval: 'year', transactionId: 'txn_' + 'b'.repeat(26) };
  const start = onboardingRouteForStep(step as BillingOnboardingStep)!;
  const { router } = mount(start); await screen.findByRole('heading');
  await act(async () => { await router.navigate(path); }); expect(await screen.findByText(title)).toBeVisible();
  await act(async () => { await router.navigate(-1); }); expect(router.state.location.pathname).toBe(start);
});
it('keeps the payment subtree and input identity during background reads and language changes', async () => {
  mocks.data.onboardingStep = 'PAYMENT'; mocks.data.checkoutResume = { plan: 'PRO', interval: 'year', transactionId: 'txn_' + 'b'.repeat(26) };
  const { router } = mount('/subscription/payment');
  const frame = await screen.findByRole('textbox'); fireEvent.change(frame, { target: { value: 'retained' } });
  mocks.query.isFetching = true;
  await act(async () => { await router.navigate('/subscription/payment?plan=PRO&interval=year'); });
  expect(screen.getByRole('textbox')).toBe(frame); expect(frame).toHaveValue('retained');
  fireEvent.click(screen.getByRole('button', { name: 'اردو' })); expect(screen.getByRole('textbox')).toBe(frame);
});

it('allows a payment completion transition to confirm while the server step catches up', async () => {
  mocks.data.onboardingStep = 'PAYMENT'; mocks.data.checkoutResume = { plan: 'PRO', interval: 'year', transactionId: 'txn_' + 'b'.repeat(26) };
  const { router } = mount('/subscription/payment'); await screen.findByText('Payment fixture');
  await act(async () => { await router.navigate('/subscription/activation', { replace: true }); });
  expect(await screen.findByText('Confirmation fixture')).toBeVisible(); expect(screen.queryByText('Dashboard fixture')).toBeNull();
});
it('offers retry for a PAYMENT step without a saved draft instead of looping', async () => {
  mocks.data.onboardingStep = 'PAYMENT';
  const { router } = mount('/subscription/payment');
  expect(await screen.findByRole('button', { name: 'Try again' })).toBeEnabled(); expect(router.state.location.pathname).toBe('/subscription/payment');
});

it('keeps restricted subscribers in billing settings when they explicitly open subscription', async () => {
  mocks.data.onboardingStep = 'RESTRICTED';
  mocks.data.subscription = { status: 'canceled', plan: 'PRO', catalogQualified: true, periodStart: null, periodEnd: null, scheduledChangeAction: null, scheduledChangeAt: null, lastEventAt: '2026-11-10T00:00:00Z' };
  mount('/subscription'); expect(await screen.findByText('Subscriber fixture')).toBeVisible();
});
it('shows the application session outage retry before mounting a setup screen', async () => {
  mocks.current = { isError: true, error: { response: { status: 503 } }, refetch: mocks.retry };
  mount('/choose-plan', { app: true });
  expect(await screen.findByRole('alert')).toHaveTextContent('We could not reach Hygene Ops');
  fireEvent.click(screen.getByRole('button', { name: 'Try again' })); expect(mocks.retry).toHaveBeenCalledOnce(); expect(screen.queryByText('Plan fixture')).toBeNull();
});
