import { configureStore } from '@reduxjs/toolkit';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { Provider } from 'react-redux';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { beforeEach, expect, it, vi } from 'vitest';
import authReducer, { setUser, type AuthUser } from '@/store/slices/authSlice';
import { LanguageProvider } from '@/i18n/LanguageProvider';
import { billingCatalogKey, billingLifecycleKey, subscriptionQueryKey } from '../queries';
import type { BillingCatalogEntry, BillingLifecycle, PlanDefinition } from '../types';
import BillingPlanPage from './BillingPlanPage';

const api = vi.hoisted(() => ({ getBillingLifecycle: vi.fn(), getBillingCatalog: vi.fn(), getSubscription: vi.fn() }));
vi.mock('../api', () => api);
const owner = { id: 7, role: 'ADMIN' as const, name: 'Synthetic', email: 'fixture@example.invalid', companyId: 42 };
const plans: PlanDefinition[] = ['STARTER', 'PRO', 'ADVANCED'].map((code, index) => ({
  code: code as PlanDefinition['code'], name: ['Starter', 'Pro', 'Advanced'][index], description: `API description ${index}`,
  limits: { locations: 2 + index * 7, staff: 4 + index * 19, managers: 2 + index * 3 },
  features: { managerAccess: true, automaticAssignment: false, automaticReassignment: false, inventoryVerification: false }, featureLabels: [],
}));
let lifecycle: BillingLifecycle;
let catalog: BillingCatalogEntry[];
function Position() { const location = useLocation(); return <><output data-testid="position">{location.pathname}{location.search}</output><output data-testid="navigation-state">{JSON.stringify(location.state)}</output></>; }
function mount(search = '', role: AuthUser['role'] = 'ADMIN') {
  const store = configureStore({ reducer: { auth: authReducer } });
  store.dispatch(setUser({ ...owner, role }));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const result = render(<Provider store={store}><QueryClientProvider client={client}><LanguageProvider><MemoryRouter initialEntries={[`/choose-plan${search}`]}><Position /><BillingPlanPage /></MemoryRouter></LanguageProvider></QueryClientProvider></Provider>);
  return { ...result, client, store };
}
const radio = (name: string) => screen.getByRole('radio', { name: new RegExp(`^${name} ·`) });
const continueButton = () => screen.getByRole('button', { name: 'Continue to payment' });
async function ready() { await waitFor(() => expect(continueButton()).toBeEnabled()); }
beforeEach(() => {
  vi.resetAllMocks(); localStorage.clear();
  lifecycle = { company: { id: 42, name: 'Synthetic', plan: 'STARTER', isActive: true, operationalStatus: 'ACTIVE' },
    usage: { locations: 0, staff: 0, managers: 1 }, limits: plans[0].limits, subscription: null,
    reconciliationRequired: false, billingConfigured: true, billingEnvironment: 'sandbox', ownerVerified: false,
    providerState: 'NOT_LINKED', portalAvailable: false, checkoutAvailable: true, checkoutReadiness: 'READY', workspaceAccessAllowed: false, checkoutResume: null, onboardingStep: 'CHOOSE_PLAN' };
  catalog = plans.flatMap((plan, index) => (['month', 'year'] as const).map((interval, i) => ({
    plan: plan.code, interval, priceId: `pri_${String(index * 2 + i).padStart(26, 'a')}`, productId: `pro_${'b'.repeat(26)}`,
    amount: String((index + 1) * (i ? 11337 : 1234)), currencyCode: 'USD',
  })));
  api.getBillingLifecycle.mockImplementation(async () => structuredClone(lifecycle));
  api.getBillingCatalog.mockImplementation(async () => structuredClone(catalog));
  api.getSubscription.mockImplementation(async () => ({ company: { id: 42 }, availablePlans: structuredClone(plans) }));
});

it('renders API allowances, exact catalog prices, Enterprise and shared disclosure without legacy copy', async () => {
  mount(); await ready();
  expect(screen.getByRole('group', { name: 'Choose a plan' })).toBeVisible();
  for (const [index, name] of ['Starter', 'Pro', 'Enterprise'].entries()) {
    const row = radio(name).closest('label')!;
    expect(row).toHaveTextContent(`API description ${index}`);
    for (const [resource, value] of Object.entries(plans[index].limits)) {
      const label = { locations: 'Locations', staff: 'Staff', managers: 'Managers' }[resource as keyof PlanDefinition['limits']];
      expect(within(row).getByText(label).parentElement).toHaveTextContent(String(value));
    }
    expect(row).toHaveTextContent(`US$${((index + 1) * 12.34).toFixed(2)}`);
  }
  expect(radio('Starter')).toBeChecked();
  const disclosure = screen.getByText('What every plan includes').closest('details')!;
  fireEvent.click(screen.getByText('What every plan includes'));
  expect(disclosure).toHaveAttribute('open');
  expect(within(disclosure).getByText('GPS attendance and selfies')).toBeVisible();
  expect(document.body.textContent).not.toMatch(/trial|discount|most popular/i);
  expect(document.querySelector('style')).not.toBeInTheDocument();
});
it('switches to exact yearly prices without calculating a discount and navigates with selection only', async () => {
  mount(); await ready(); fireEvent.click(screen.getByRole('button', { name: 'Yearly' })); fireEvent.click(radio('Pro')); fireEvent.click(continueButton());
  expect(screen.getByTestId('position')).toHaveTextContent('/subscription/payment?plan=PRO&interval=year');
  expect(screen.getByTestId('navigation-state')).toHaveTextContent('null');
  expect(radio('Pro')).toHaveAccessibleName('Pro · US$226.74 · Yearly');
});
it.each(['?plan=PRO&interval=year', '?plan=ADVANCED&interval=month'])('preselects allowlisted URL %s', async search => {
  mount(search); await ready(); expect(radio(search.includes('ADVANCED') ? 'Enterprise' : 'Pro')).toBeChecked();
  expect(screen.getByRole('button', { name: search.includes('year') ? 'Yearly' : 'Monthly' })).toHaveAttribute('aria-pressed', 'true');
});
it.each(['?plan=admin&interval=week', '?plan=pro&interval=YEAR', '?plan=PRO&plan=ADVANCED&interval=year&interval=month', '?plan=%3Cscript%3E&interval=yearly'])('ignores tampered or ambiguous URL %s', async search => {
  mount(search); await ready(); expect(radio('Starter')).toBeChecked(); expect(screen.getByRole('button', { name: 'Monthly' })).toHaveAttribute('aria-pressed', 'true');
});
it('uses the saved draft before Starter, lets URL override it and announces replacement', async () => {
  lifecycle.onboardingStep = 'PAYMENT'; lifecycle.checkoutResume = { plan: 'PRO', interval: 'year', transactionId: `txn_${'b'.repeat(26)}` };
  mount('?plan=ADVANCED&interval=month'); await ready(); expect(radio('Enterprise')).toBeChecked();
  expect(screen.getByText('You have a checkout in progress. Choosing a different plan replaces it. You have not been charged.')).toHaveAttribute('role', 'status');
  fireEvent.click(continueButton()); expect(screen.getByTestId('position')).toHaveTextContent('plan=ADVANCED&interval=month');
  expect(JSON.parse(screen.getByTestId('navigation-state').textContent!)).toEqual({ changePlan: { plan: 'ADVANCED', interval: 'month' } });
});
it('continuing the saved selection carries no replacement request', async () => {
  lifecycle.onboardingStep = 'PAYMENT'; lifecycle.checkoutResume = { plan: 'PRO', interval: 'year', transactionId: `txn_${'b'.repeat(26)}` };
  mount(); await ready(); fireEvent.click(continueButton());
  expect(screen.getByTestId('position')).toHaveTextContent('/subscription/payment?plan=PRO&interval=year');
  expect(screen.getByTestId('navigation-state')).toHaveTextContent('null');
});
it('changing only the interval carries an explicit replacement request', async () => {
  lifecycle.onboardingStep = 'PAYMENT'; lifecycle.checkoutResume = { plan: 'PRO', interval: 'year', transactionId: `txn_${'b'.repeat(26)}` };
  mount(); await ready(); fireEvent.click(screen.getByRole('button', { name: 'Monthly' })); fireEvent.click(continueButton());
  expect(JSON.parse(screen.getByTestId('navigation-state').textContent!)).toEqual({ changePlan: { plan: 'PRO', interval: 'month' } });
});
it('loads the draft selection and permits changing both plan and interval', async () => {
  lifecycle.onboardingStep = 'PAYMENT'; lifecycle.checkoutResume = { plan: 'PRO', interval: 'year', transactionId: `txn_${'b'.repeat(26)}` };
  mount(); await ready(); expect(radio('Pro')).toBeChecked();
  expect(screen.getByRole('button', { name: 'Yearly' })).toHaveAttribute('aria-pressed', 'true');
  expect(screen.queryByText(/Choosing a different plan replaces it/)).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Monthly' })); expect(screen.getByText(/Choosing a different plan replaces it/)).toBeVisible();
  fireEvent.click(radio('Starter')); expect(radio('Starter')).toBeChecked();
});
it('falls back independently to the draft when one URL field is invalid', async () => {
  lifecycle.onboardingStep = 'PAYMENT'; lifecycle.checkoutResume = { plan: 'PRO', interval: 'year', transactionId: `txn_${'b'.repeat(26)}` };
  mount('?plan=STARTER&interval=tampered'); await ready(); expect(radio('Starter')).toBeChecked();
  expect(screen.getByRole('button', { name: 'Yearly' })).toHaveAttribute('aria-pressed', 'true');
});
it('supports keyboard selection, focus, wrapping and a single radio tab stop', async () => {
  mount(); await ready(); radio('Starter').focus();
  fireEvent.keyDown(radio('Starter'), { key: 'ArrowRight' }); expect(radio('Pro')).toBeChecked(); expect(radio('Pro')).toHaveFocus();
  fireEvent.keyDown(radio('Pro'), { key: 'End' }); expect(radio('Enterprise')).toHaveFocus();
  fireEvent.keyDown(radio('Enterprise'), { key: 'ArrowDown' }); expect(radio('Starter')).toHaveFocus();
  fireEvent.keyDown(radio('Starter'), { key: 'ArrowUp' }); expect(radio('Enterprise')).toHaveFocus();
  fireEvent.keyDown(radio('Enterprise'), { key: 'Home' }); expect(radio('Starter')).toHaveFocus();
  expect(screen.getAllByRole('radio').filter(input => input.tabIndex === 0)).toEqual([radio('Starter')]);
});
it('shows three skeleton rows until the initial requests finish', async () => {
  let release!: (data: BillingCatalogEntry[]) => void;
  api.getBillingCatalog.mockImplementation(() => new Promise(resolve => { release = resolve; }));
  mount(); expect(screen.getByRole('status', { name: 'Loading plans' })).toHaveAttribute('aria-busy', 'true');
  expect(document.querySelectorAll('.flow-skeleton')).toHaveLength(3); expect(continueButton()).toBeDisabled();
  await act(async () => release(catalog)); await ready();
});
it.each(['getBillingCatalog', 'getBillingLifecycle', 'getSubscription'] as const)('shows a safe error and retries %s', async method => {
  api[method].mockRejectedValueOnce(new Error('private detail'));
  mount(); expect(await screen.findByRole('alert')).toHaveTextContent('Prices could not load.');
  expect(document.body.textContent).not.toContain('private detail'); expect(continueButton()).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Try again' })); await ready();
});
it('shows an empty catalog and offers retry without fabricating prices', async () => {
  catalog = []; mount(); await waitFor(() => expect(screen.queryByRole('status', { name: 'Loading plans' })).not.toBeInTheDocument());
  expect(screen.getByRole('button', { name: 'Try again' })).toBeEnabled(); expect(continueButton()).toBeDisabled();
  expect(screen.getAllByRole('radio')).toHaveLength(3); for (const input of screen.getAllByRole('radio')) expect(input).toBeDisabled();
});
it('keeps a missing interval price unavailable while other choices and keyboard navigation work', async () => {
  catalog = catalog.filter(entry => entry.plan !== 'PRO' || entry.interval !== 'year'); mount('?interval=year'); await ready();
  expect(radio('Pro')).toBeDisabled(); fireEvent.keyDown(radio('Starter'), { key: 'ArrowDown' }); expect(radio('Enterprise')).toBeChecked();
  fireEvent.click(screen.getByRole('button', { name: 'Monthly' })); expect(radio('Pro')).toBeEnabled();
});
it('does not silently substitute an unavailable URL selection', async () => {
  catalog = catalog.filter(entry => entry.plan !== 'PRO'); mount('?plan=PRO');
  await screen.findByRole('radio', { name: /^Pro ·/ }); expect(radio('Pro')).toBeChecked(); expect(radio('Pro')).toBeDisabled(); expect(continueButton()).toBeDisabled();
  expect(screen.getAllByRole('radio').filter(input => input.tabIndex === 0)).toEqual([radio('Starter')]);
  fireEvent.click(radio('Starter')); await ready();
});
it('shows an empty allowance response without inventing plan limits', async () => {
  api.getSubscription.mockResolvedValue({ company: { id: 42 }, availablePlans: [] });
  mount(); expect(await screen.findByRole('button', { name: 'Try again' })).toBeEnabled();
  expect(screen.queryByRole('radio')).not.toBeInTheDocument(); expect(continueButton()).toBeDisabled();
});
it.each(['invalid', 'duplicate'] as const)('does not sell a plan with an %s catalog price', async kind => {
  if (kind === 'invalid') catalog[0].amount = '12.34';
  else catalog.push({ ...catalog[0] });
  mount(); await screen.findByRole('radio', { name: /^Starter ·/ });
  expect(radio('Starter')).toBeDisabled(); expect(continueButton()).toBeDisabled();
  fireEvent.click(radio('Pro')); await ready();
});
it.each(['getBillingCatalog', 'getSubscription'] as const)('keeps choices usable while %s refetches', async method => {
  const { client } = mount(); await ready(); radio('Starter').focus();
  const focused = radio('Starter');
  let release!: (data: unknown) => void;
  api[method].mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
  let request!: Promise<void>;
  act(() => { request = client.invalidateQueries({ queryKey: method === 'getBillingCatalog' ? billingCatalogKey(42, 7) : [...subscriptionQueryKey, 42, 7] }); });
  await waitFor(() => expect(client.isFetching()).toBeGreaterThan(0));
  expect(radio('Starter')).toBe(focused); expect(focused).toHaveFocus();
  expect(screen.getAllByRole('radio').every(input => !(input as HTMLInputElement).disabled)).toBe(true);
  expect(continueButton()).toBeEnabled();
  fireEvent.keyDown(focused, { key: 'ArrowDown' }); expect(radio('Pro')).toHaveFocus();
  await act(async () => { release(method === 'getBillingCatalog' ? structuredClone(catalog) : { company: { id: 42 }, availablePlans: structuredClone(plans) }); await request; });
  expect(radio('Pro')).toBeChecked(); expect(radio('Pro')).toHaveFocus();
});
it('retains selection and focus on language changes and mirrors horizontal radio navigation', async () => {
  mount(); await ready(); fireEvent.click(radio('Pro'));
  fireEvent.click(screen.getByRole('button', { name: 'اردو' }));
  expect(document.querySelector('.flow-shell')).toHaveAttribute('dir', 'rtl');
  radio('Pro').focus(); fireEvent.keyDown(radio('Pro'), { key: 'ArrowLeft' });
  expect(radio('Enterprise')).toBeChecked(); expect(radio('Enterprise')).toHaveFocus();
  fireEvent.keyDown(radio('Enterprise'), { key: 'ArrowRight' }); expect(radio('Pro')).toHaveFocus();
  const amount = radio('Pro').closest('label')!.querySelector('.flow-price');
  expect(amount).toHaveAttribute('dir', 'ltr');
});
it('retains radios, selection and focus throughout background refetches', async () => {
  const { client } = mount(); await ready(); fireEvent.click(radio('Pro')); radio('Pro').focus(); const focused = radio('Pro');
  let release!: (data: BillingLifecycle) => void;
  api.getBillingLifecycle.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
  let request!: Promise<void>;
  act(() => { request = client.invalidateQueries({ queryKey: billingLifecycleKey(42, 7) }); });
  await waitFor(() => expect(client.isFetching()).toBeGreaterThan(0));
  expect(focused).toHaveFocus(); expect(focused).toBeChecked(); expect(focused).toBeEnabled(); expect(continueButton()).toBeEnabled();
  fireEvent.click(radio('Enterprise')); radio('Enterprise').focus();
  await act(async () => { release(lifecycle); await request; });
  expect(radio('Enterprise')).toHaveFocus(); expect(radio('Enterprise')).toBeChecked();
  await act(async () => { await client.invalidateQueries({ queryKey: billingCatalogKey(42, 7) }); });
  expect(radio('Enterprise')).toHaveFocus(); expect(radio('Enterprise')).toBeChecked();
});
it.each(['MANAGER', 'STAFF'] as const)('denies %s without starting queries', role => {
  mount('', role); expect(screen.getByRole('alert')).toHaveTextContent('Only the company owner'); expect(api.getBillingLifecycle).not.toHaveBeenCalled(); expect(api.getBillingCatalog).not.toHaveBeenCalled();
});
it('preserves restriction and unresolved-payment gates', async () => {
  lifecycle.onboardingStep = 'RECONCILE'; lifecycle.reconciliationRequired = true; lifecycle.checkoutReadiness = 'RECONCILIATION_PENDING'; mount();
  expect(await screen.findByText(/We could not confirm the outcome/)).toBeVisible(); expect(continueButton()).toBeDisabled(); expect(screen.queryByRole('radio')).not.toBeInTheDocument();
});
it('uses the shared responsive ledger and sticky phone decision bar', async () => {
  mount(); await ready(); expect(document.querySelector('.flow-stage')).toHaveAttribute('data-size', 'plan');
  expect(document.querySelectorAll('.flow-plan-row')).toHaveLength(3);
  expect(screen.getByRole('region', { name: 'Selected plan' })).toHaveClass('sticky', 'bottom-0', 'md:static');
});
