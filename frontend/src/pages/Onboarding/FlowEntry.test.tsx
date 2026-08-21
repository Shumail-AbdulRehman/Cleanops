import { configureStore } from '@reduxjs/toolkit';
import { Provider } from 'react-redux';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { beforeEach, expect, it, vi } from 'vitest';
import authReducer, { setUser, type AuthUser } from '@/store/slices/authSlice';
import { LanguageProvider } from '@/i18n/LanguageProvider';
import type { BillingLifecycle, BillingOnboardingStep } from '@/pages/Subscription/types';
import { onboardingRouteForStep } from './onboardingRoutes';
import FlowEntry from './FlowEntry';
const mocks = vi.hoisted(() => ({ query: {} as Record<string, unknown>, read: vi.fn(), retry: vi.fn() }));
vi.mock('@/pages/Subscription/queries', () => ({ useBillingLifecycle: () => { mocks.read(); return mocks.query; } }));
let data: BillingLifecycle;
const steps: BillingOnboardingStep[] = ['CHOOSE_PLAN', 'PAYMENT', 'CONFIRMING', 'WORKSPACE', 'ACCOUNT', 'RECONCILE', 'RESTRICTED', 'VERIFY_EMAIL', 'UNAVAILABLE'];
function mount(from?: unknown, role: AuthUser['role'] | null = 'ADMIN') {
  const store = configureStore({ reducer: { auth: authReducer } });
  if (role) store.dispatch(setUser({ id: 7, companyId: 42, role, name: 'Fixture', email: 'fixture@example.invalid' }));
  const router = createMemoryRouter([
    { path: '/continue', element: <FlowEntry /> },
    { path: '*', element: <h1>Destination</h1> },
  ], { initialEntries: [{ pathname: '/continue', state: { from } }] });
  return { store, router, ...render(<Provider store={store}><LanguageProvider><RouterProvider router={router} /></LanguageProvider></Provider>) };
}
beforeEach(() => {
  vi.clearAllMocks(); localStorage.clear();
  data = { company: { id: 42, name: 'Fixture', plan: 'PRO', isActive: true, operationalStatus: 'ACTIVE' }, usage: { locations: 1, staff: 1, managers: 1 }, limits: { locations: 5, staff: 25, managers: 3 }, subscription: null, reconciliationRequired: false, billingConfigured: true, ownerVerified: false, providerState: 'NOT_LINKED', portalAvailable: false, checkoutAvailable: true, checkoutReadiness: 'READY', workspaceAccessAllowed: false, onboardingStep: 'CHOOSE_PLAN' };
  mocks.query = { data, dataOwner: { companyId: 42, ownerId: 7 }, isPending: false, isError: false, isFetching: false, refetch: mocks.retry };
});
it.each(steps)('resolves %s using the server map and ignores from until WORKSPACE', async step => {
  data.onboardingStep = step; if (step === 'PAYMENT') data.checkoutResume = { plan: 'PRO', interval: 'year', transactionId: 'txn_' + 'b'.repeat(26) }; data.workspaceAccessAllowed = step === 'WORKSPACE';
  const { router } = mount('/staff?shift=today#member');
  await screen.findByRole('heading', { name: 'Destination' });
  expect(router.state.location.pathname).toBe(step === 'WORKSPACE' ? '/staff' : onboardingRouteForStep(step));
  if (step === 'WORKSPACE') expect(router.state.location).toMatchObject({ search: '?shift=today', hash: '#member' });
  expect(router.state.historyAction).toBe('REPLACE');
});
it.each([null, undefined, 'https://evil.invalid', '//evil.invalid', '/continue', '/subscription/payment', '/login', '/choose-plan', '/account/security', '/%63ontinue'])('rejects unsafe/absent from %s', async from => {
  data.onboardingStep = 'WORKSPACE'; data.workspaceAccessAllowed = true;
  const { router } = mount(from); await screen.findByText('Destination'); expect(router.state.location.pathname).toBe('/dashboard');
});
it.each(['missing', 'null', 'error', 'foreign-company', 'foreign-owner', 'permission-missing', 'malformed'])('fails closed with retry for %s', condition => {
  if (condition === 'missing') delete data.onboardingStep;
  if (condition === 'null') data.onboardingStep = null;
  if (condition === 'error') { mocks.query.isError = true; mocks.query.error = new Error('private detail'); }
  if (condition === 'foreign-company') data.company.id = 99;
  if (condition === 'foreign-owner') mocks.query.dataOwner = { companyId: 42, ownerId: 9 };
  if (condition === 'permission-missing') data.onboardingStep = 'WORKSPACE';
  if (condition === 'malformed') mocks.query.data = {};
  const { router } = mount('/staff');
  expect(screen.getByRole('alert')).toHaveTextContent('Billing is temporarily unavailable');
  expect(screen.queryByText('private detail')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Try again' })); expect(mocks.retry).toHaveBeenCalledOnce();
  expect(router.state.location.pathname).toBe('/continue');
});
it('shows a pending read without granting access or offering an overlapping retry', () => {
  mocks.query.isPending = true; mocks.query.isFetching = true; mocks.query.data = undefined;
  mount(); expect(screen.getByRole('status')).toHaveTextContent('Checking subscription status'); expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
});
it.each(['MANAGER', 'STAFF', null] as const)('does not read private billing for %s', async role => {
  const { router } = mount('/staff', role); await screen.findByText('Destination');
  expect(router.state.location.pathname).toBe(role ? '/dashboard' : '/login'); expect(mocks.read).not.toHaveBeenCalled();
});
it('hides a prior owner result synchronously on identity change', () => {
  data.onboardingStep = null;
  const { store } = mount();
  act(() => store.dispatch(setUser({ id: 9, companyId: 99, role: 'ADMIN', name: 'Other', email: 'other@example.invalid' })));
  expect(screen.getByRole('alert')).toBeVisible(); expect(screen.queryByText('Destination')).toBeNull();
});

it('waits for a fresh read before honoring cached workspace permission', () => {
  data.onboardingStep = 'WORKSPACE'; data.workspaceAccessAllowed = true; mocks.query.isFetching = true;
  const { router } = mount('/staff'); expect(screen.getByRole('status')).toBeVisible(); expect(router.state.location.pathname).toBe('/continue');
});
it('a missing step retries even if the company is also restricted', () => {
  data.onboardingStep = null; data.company.operationalStatus = 'SUSPENDED';
  mount(); expect(screen.getByRole('button', { name: 'Try again' })).toBeEnabled();
});
