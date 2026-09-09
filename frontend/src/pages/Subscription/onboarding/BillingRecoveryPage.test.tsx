import { StrictMode } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { LanguageProvider } from '@/i18n/LanguageProvider';
import type { BillingLifecycle, BillingReconcileOutcome } from '../types';
import BillingRecoveryPage from './BillingRecoveryPage';

const mocks = vi.hoisted(() => ({
  user: { role: 'ADMIN', companyId: 42, id: 1 }, query: {} as Record<string, unknown>,
  reconcile: vi.fn(), support: vi.fn(), refetch: vi.fn(),
}));
vi.mock('@/hooks/useAuth', () => ({ default: () => ({ user: mocks.user }) }));
vi.mock('../queries', () => ({ useBillingLifecycle: () => mocks.query }));
vi.mock('../api', () => ({ reconcileBillingCheckout: mocks.reconcile }));
vi.mock('@/lib/serviceInformation', () => ({ getPublicSupport: mocks.support }));
const life = (overrides: Partial<BillingLifecycle> = {}): BillingLifecycle => ({
  company: { id: 42, name: 'Fixture', plan: 'PRO', isActive: true, operationalStatus: 'ACTIVE' },
  usage: { locations: 1, staff: 3, managers: 1 }, limits: { locations: 5, staff: 25, managers: 3 },
  subscription: null, providerState: 'NOT_LINKED', billingConfigured: true, ownerVerified: false,
  reconciliationRequired: true, checkoutAvailable: false, portalAvailable: false,
  onboardingStep: 'RECONCILE', recoveryReason: 'CUSTOMER_UNRESOLVED', ...overrides,
});
function tree() {
  return <StrictMode><MemoryRouter initialEntries={['/subscription/recovery?paid=true&reset=true&plan=PRO']}>
    <LanguageProvider><Routes>
      <Route path="/subscription/recovery" element={<BillingRecoveryPage />} />
      {['/subscription/payment', '/choose-plan', '/subscription/activation'].map(path => <Route key={path} path={path} element={<h1>{path}</h1>} />)}
    </Routes></LanguageProvider>
  </MemoryRouter></StrictMode>;
}
beforeEach(() => {
  vi.resetAllMocks(); localStorage.clear();
  mocks.user = { role: 'ADMIN', companyId: 42, id: 1 };
  mocks.query = { data: life(), dataOwner: { companyId: 42, ownerId: 1 }, isFetching: false, isError: false, refetch: mocks.refetch };
  mocks.support.mockResolvedValue({ email: 'support@example.invalid' });
  mocks.reconcile.mockResolvedValue({ outcome: 'UNRESOLVED', lifecycle: life() });
});
afterEach(() => vi.useRealTimers());
it('checks once during StrictMode double mount and explains the wait', async () => {
  let resolve!: (value: unknown) => void;
  mocks.reconcile.mockReturnValue(new Promise(done => { resolve = done; }));
  render(tree());
  expect(screen.getByRole('heading', { name: 'Checking your previous checkout' })).toHaveFocus();
  expect(screen.getByRole('status')).toHaveTextContent('This takes a few seconds.');
  expect(mocks.reconcile).toHaveBeenCalledExactlyOnceWith(undefined, 42);
  expect(screen.queryByRole('button', { name: /Check again|Try again/ })).not.toBeInTheDocument();
  await act(async () => resolve({ outcome: 'UNRESOLVED', lifecycle: life() }));
  expect(screen.getByRole('heading', { name: 'Check subscription status' })).toHaveFocus();
});
it.each([
  ['RESUMABLE', '/subscription/payment'], ['CLEARED', '/choose-plan'], ['PAID', '/subscription/activation'],
] as const)('%s navigates to %s', async (outcome, destination) => {
  mocks.reconcile.mockResolvedValue({ outcome, lifecycle: life() });
  render(tree());
  expect(await screen.findByRole('heading', { name: destination })).toBeVisible();
  expect(mocks.reconcile).toHaveBeenCalledOnce();
});
it('IN_PROGRESS retries three times then offers a manual check', async () => {
  vi.useFakeTimers();
  mocks.reconcile.mockResolvedValue({ outcome: 'IN_PROGRESS', lifecycle: life() });
  render(tree());
  await act(async () => {});
  expect(screen.getByText('Your previous checkout is still being checked. Please wait.')).toBeVisible();
  for (const delay of [2000, 5000, 10000]) await act(async () => { await vi.advanceTimersByTimeAsync(delay); });
  expect(mocks.reconcile).toHaveBeenCalledTimes(4);
  expect(screen.getByRole('button', { name: 'Check again' })).toBeEnabled();
  await act(async () => { await vi.advanceTimersByTimeAsync(120000); });
  expect(mocks.reconcile).toHaveBeenCalledTimes(4);
  fireEvent.click(screen.getByRole('button', { name: 'Check again' }));
  await act(async () => {});
  expect(mocks.reconcile).toHaveBeenCalledTimes(5);
});
it('UNRESOLVED checks again only on request and never offers reset or claims no charge', async () => {
  render(tree());
  fireEvent.click(await screen.findByRole('button', { name: 'Check again' }));
  await waitFor(() => expect(mocks.reconcile).toHaveBeenCalledTimes(2));
  expect(screen.getByText('We could not confirm your previous checkout. Check again before making another payment.')).toBeVisible();
  expect(screen.queryByRole('button', { name: /reset|pay|checkout/i })).not.toBeInTheDocument();
  expect(screen.queryByText(/not.*charged|nothing was charged/i)).not.toBeInTheDocument();
});
it('CONFLICT explains the email and supplies configured support and signup', async () => {
  mocks.reconcile.mockResolvedValue({ outcome: 'CONFLICT', lifecycle: life() });
  render(tree());
  expect(await screen.findByRole('heading', { name: 'This email is already used for payments' })).toHaveFocus();
  expect(screen.getByRole('link', { name: 'Contact support' })).toHaveAttribute('href', 'mailto:support@example.invalid');
  expect(screen.getByRole('link', { name: 'Sign up with another email' })).toHaveAttribute('href', '/signup');
  expect(screen.queryByRole('button', { name: /Check again|Try again|reset/i })).not.toBeInTheDocument();
  expect(screen.queryByText(/nothing was charged/i)).not.toBeInTheDocument();
});
it.each(['BILLING_DISABLED', 'PRICE_NOT_READY'] as const)('%s offers a lifecycle retry without a mutation', async recoveryReason => {
  mocks.query.data = life({ onboardingStep: 'UNAVAILABLE', recoveryReason });
  render(tree());
  expect(screen.getByRole('heading', { name: 'Payments are unavailable right now' })).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
  expect(mocks.refetch).toHaveBeenCalledOnce();
  expect(mocks.reconcile).not.toHaveBeenCalled();
  expect(screen.queryByText(/nothing was charged/i)).not.toBeInTheDocument();
});
it.each(['step', 'suspended', 'inactive'])('restriction via %s offers support without reconciling', async condition => {
  const data = life();
  if (condition === 'step') data.onboardingStep = 'RESTRICTED';
  if (condition === 'suspended') data.company.operationalStatus = 'SUSPENDED';
  if (condition === 'inactive') data.company.isActive = false;
  mocks.query.data = data;
  render(tree());
  expect(screen.getByRole('heading', { name: 'This account is restricted' })).toBeVisible();
  await waitFor(() => expect(screen.getByRole('link', { name: 'Contact support' })).toHaveAttribute('href', 'mailto:support@example.invalid'));
  expect(mocks.reconcile).not.toHaveBeenCalled();
  expect(screen.queryByRole('button', { name: /Check again|Try again|reset/i })).not.toBeInTheDocument();
});
it.each(['RESUMABLE', 'CLEARED', 'PAID'] as BillingReconcileOutcome[])('a restricted %s response cannot navigate', async outcome => {
  mocks.reconcile.mockResolvedValue({ outcome, lifecycle: life({ onboardingStep: 'RESTRICTED' }) });
  render(tree());
  expect(await screen.findByRole('heading', { name: 'This account is restricted' })).toHaveFocus();
});
it.each(['foreign', 'error', 'missing-step'])('%s lifecycle cannot auto reconcile', async condition => {
  if (condition === 'foreign') mocks.query.dataOwner = { companyId: 99, ownerId: 1 };
  if (condition === 'error') mocks.query.isError = true;
  if (condition === 'missing-step') mocks.query.data = life({ onboardingStep: null });
  render(tree());
  await screen.findByRole('button', { name: 'Check again' });
  expect(mocks.reconcile).not.toHaveBeenCalled();
});
it('network failure hides private errors and permits an explicit check', async () => {
  mocks.reconcile.mockRejectedValue(new Error('private provider diagnostic'));
  render(tree());
  expect(await screen.findByRole('button', { name: 'Check again' })).toBeEnabled();
  expect(screen.queryByText(/private provider/)).not.toBeInTheDocument();
});
it('support failure hides the contact link', async () => {
  mocks.support.mockRejectedValue(new Error('private support error'));
  mocks.query.data = life({ onboardingStep: 'RESTRICTED' });
  render(tree());
  await waitFor(() => expect(mocks.support).toHaveBeenCalled());
  expect(screen.queryByRole('link', { name: 'Contact support' })).not.toBeInTheDocument();
});
it('switching to Urdu keeps the request single and translates the recovery state', async () => {
  render(tree());
  await screen.findByRole('button', { name: 'Check again' });
  fireEvent.click(screen.getByRole('button', { name: 'اردو' }));
  expect(screen.getByRole('button', { name: 'دوبارہ چیک کریں' })).toBeVisible();
  expect(document.querySelector('.flow-shell')).toHaveAttribute('dir', 'rtl');
  expect(mocks.reconcile).toHaveBeenCalledOnce();
});
it('ignores late reconciliation after owner switch', async () => {
  let resolve!: (value: unknown) => void;
  mocks.reconcile.mockReturnValueOnce(new Promise(done => { resolve = done; }));
  const view = render(tree());
  mocks.user = { role: 'ADMIN', companyId: 99, id: 2 };
  mocks.query.dataOwner = { companyId: 99, ownerId: 2 };
  mocks.query.data = life({ company: { ...life().company, id: 99 }, onboardingStep: 'RESTRICTED' });
  view.rerender(tree());
  await act(async () => resolve({ outcome: 'PAID', lifecycle: life() }));
  expect(screen.getByRole('heading', { name: 'This account is restricted' })).toBeVisible();
});
it('unmount cancels pending retry', async () => {
  vi.useFakeTimers();
  mocks.reconcile.mockResolvedValue({ outcome: 'IN_PROGRESS', lifecycle: life() });
  const view = render(tree()); await act(async () => {}); view.unmount();
  await act(async () => { await vi.advanceTimersByTimeAsync(20000); });
  expect(mocks.reconcile).toHaveBeenCalledOnce();
});
it.each(['STAFF', 'MANAGER'])('%s cannot read billing or reconcile', role => {
  mocks.user.role = role;
  render(tree());
  expect(screen.getByRole('alert')).toHaveTextContent('Only the company owner');
  expect(mocks.reconcile).not.toHaveBeenCalled(); expect(mocks.support).not.toHaveBeenCalled();
});

it('a fresh restriction overrides an earlier in-progress response and stops retries', async () => {
  vi.useFakeTimers();
  mocks.reconcile.mockResolvedValue({ outcome: 'IN_PROGRESS', lifecycle: life() });
  const view = render(tree()); await act(async () => {});
  mocks.query.data = life({ onboardingStep: 'RESTRICTED' });
  view.rerender(tree());
  expect(screen.getByRole('heading', { name: 'This account is restricted' })).toHaveFocus();
  await act(async () => { await vi.advanceTimersByTimeAsync(20000); });
  expect(mocks.reconcile).toHaveBeenCalledOnce();
});
