import { StrictMode } from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createMemoryRouter, MemoryRouter, Route, RouterProvider, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { LanguageProvider } from '@/i18n/LanguageProvider';
import { checkoutActions, type CheckoutStatus } from './checkoutMachine';
import BillingPaymentPage from './BillingPaymentPage';

const mocks = vi.hoisted(() => ({
  session: {} as Record<string, unknown>, useSession: vi.fn(),
  user: { role: 'ADMIN', companyId: 42, id: 1 },
  life: {} as Record<string, unknown>, catalog: {} as Record<string, unknown>, subscription: {} as Record<string, unknown>,
}));
vi.mock('@/hooks/useAuth', () => ({ default: () => ({ user: mocks.user }) }));
vi.mock('@/lib/serviceInformation', async importOriginal => ({ ...await importOriginal<typeof import('@/lib/serviceInformation')>(), getPublicSupport: async () => ({ email: 'support@example.invalid' }) }));
vi.mock('./useCheckoutSession', () => ({ useCheckoutSession: (selection: unknown) => { mocks.useSession(selection); return mocks.session; } }));
vi.mock('../queries', () => ({ useBillingLifecycle: () => mocks.life, useBillingCatalog: () => mocks.catalog, useSubscription: () => mocks.subscription }));
const transactionId = 'txn_' + 'a'.repeat(26);
const draft = { plan: 'PRO', interval: 'year', transactionId };
const facts = () => ({ company: { id: 42, name: 'Fixture', plan: 'PRO', isActive: true, operationalStatus: 'ACTIVE' }, usage: { locations: 1, staff: 3, managers: 1 }, limits: { locations: 5, staff: 25, managers: 3 }, subscription: null, providerState: 'NOT_LINKED', billingConfigured: true, billingEnvironment: 'sandbox', ownerVerified: false, reconciliationRequired: false, checkoutAvailable: true, portalAvailable: false, checkoutReadiness: 'READY', workspaceAccessAllowed: false, checkoutResume: null, onboardingStep: 'CHOOSE_PLAN' });
const plans = ['STARTER', 'PRO', 'ADVANCED'].map((code, i) => ({ code, name: ['Starter', 'Pro', 'Advanced'][i], description: 'API definition', limits: { locations: i + 2, staff: i + 10, managers: i + 1 } }));
const entries = ['month', 'year'].flatMap(interval => plans.map(({ code: plan }) => ({ plan, interval, priceId: 'pri_' + 'a'.repeat(26), productId: 'pro_' + 'b'.repeat(26), amount: '12345', currencyCode: 'USD' })));
function status(value: CheckoutStatus, extra = {}) { mocks.session = { ...mocks.session, status: value, state: { status: value, sessionId: 1, transactionId }, actions: checkoutActions[value], ...extra }; }
function Destination() { const location = useLocation(); return <output data-testid="destination">{location.pathname + location.search}</output>; }
function RequestState() { const location = useLocation(); return <output data-testid="request-state">{JSON.stringify(location.state)}</output>; }
function tree(path = '/subscription/payment?plan=PRO&interval=year', state: unknown = null) {
  return <MemoryRouter initialEntries={[{ pathname: path.split('?')[0], search: path.includes('?') ? '?' + path.split('?')[1] : '', state }]}><LanguageProvider><RequestState /><Routes><Route path="/subscription/payment" element={<BillingPaymentPage />} /><Route path="*" element={<Destination />} /></Routes></LanguageProvider></MemoryRouter>;
}
function mount(path?: string) { return render(tree(path)); }
function target() { return document.querySelector('.paddle-checkout-frame'); }
beforeEach(() => {
  vi.clearAllMocks(); localStorage.clear();
  vi.stubEnv('VITE_PADDLE_ENVIRONMENT', 'sandbox'); vi.stubEnv('VITE_PADDLE_CLIENT_TOKEN', 'test_public');
  mocks.user = { role: 'ADMIN', companyId: 42, id: 1 };
  mocks.session = { prepared: null, totals: null, actionBusy: false, statusBusy: false, registerFrameTarget: vi.fn(), tryAgain: vi.fn(), checkStatus: vi.fn(), changePlan: vi.fn() };
  status('ready');
  const query = () => ({ isPending: false, isFetching: false, isError: false, refetch: vi.fn().mockResolvedValue({ isError: false }) });
  mocks.life = { ...query(), data: facts(), dataOwner: { companyId: 42, ownerId: 1 } };
  mocks.catalog = { ...query(), data: entries };
  mocks.subscription = { ...query(), data: { availablePlans: plans } };
});
afterEach(() => vi.unstubAllEnvs());

it('composes the wide shell, real Paddle target and shared summary without app-owned card fields or payment buttons', () => {
  const { container } = mount();
  expect(screen.getByRole('heading', { name: 'Add your card' })).toHaveFocus();
  expect(container.querySelector('main')).toHaveAttribute('data-size', 'wide');
  expect(target()).toBeVisible();
  expect(mocks.session.registerFrameTarget).toHaveBeenCalledWith('paddle-checkout-frame');
  expect(screen.getByRole('complementary', { name: 'Order summary' })).toBeVisible();
  expect(screen.getByText('Pro')).toBeVisible();
  expect(screen.getByRole('link', { name: 'Change plan' })).toHaveAttribute('href', '/choose-plan?plan=PRO&interval=year');
  expect(container.querySelector('input, select, textarea, style')).toBeNull();
  expect(screen.queryByRole('button', { name: /pay|subscribe|checkout/i })).not.toBeInTheDocument();
  expect(screen.queryByText(/trial/i)).not.toBeInTheDocument();
});
it('copies the public test card and discloses extra sandbox cards', async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
  mount();
  const box = screen.getByRole('region', { name: 'Test mode' });
  expect(within(box).getByText('4242 4242 4242 4242')).toBeVisible();
  fireEvent.click(within(box).getByRole('button', { name: 'Copy' }));
  expect(writeText).toHaveBeenCalledWith('4242424242424242');
  expect(await screen.findByText('Copied')).toBeVisible();
  expect(screen.getByText('Any future expiry date, any name, security code 100.')).toBeVisible();
  fireEvent.click(screen.getByText('More test cards'));
  expect(screen.getByText('4000 0038 0000 0446')).toBeVisible();
  expect(screen.getByText('4000 0000 0000 0002')).toBeVisible();
});
it('clipboard rejection leaves a usable copy action without a false success', async () => {
  const writeText = vi.fn().mockRejectedValue(new Error('Denied'));
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
  mount(); fireEvent.click(screen.getByRole('button', { name: 'Copy' }));
  await waitFor(() => expect(writeText).toHaveBeenCalledOnce());
  expect(screen.queryByText('Copied')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Copy' })).toBeEnabled();
});
it.each(['browser-production', 'server-production', 'server-missing', 'browser-missing', 'bad-token', 'missing-token'])('hides all test guidance and the shell test tag for %s', value => {
  if (value === 'browser-production') vi.stubEnv('VITE_PADDLE_ENVIRONMENT', 'production');
  if (value === 'server-production') mocks.life.data = { ...facts(), billingEnvironment: 'production' };
  if (value === 'server-missing') mocks.life.data = { ...facts(), billingEnvironment: undefined };
  if (value === 'browser-missing') vi.stubEnv('VITE_PADDLE_ENVIRONMENT', '');
  if (value === 'bad-token') vi.stubEnv('VITE_PADDLE_CLIENT_TOKEN', 'live_public');
  if (value === 'missing-token') vi.stubEnv('VITE_PADDLE_CLIENT_TOKEN', '');
  mount();
  expect(screen.queryByText('4242 4242 4242 4242')).not.toBeInTheDocument();
  expect(screen.queryByText('Test mode')).not.toBeInTheDocument();
  expect(screen.queryByText('More test cards')).not.toBeInTheDocument();
});
it.each([
  ['checking', 'Checking subscription status…', 'status'],
  ['preparing', 'Preparing your checkout…', 'status'],
  ['declined', 'That card was declined. Check the details or try another card.', 'alert'],
  ['offline', "You're offline. Reconnect to continue. Your details stay here.", 'status'],
  ['paying', 'Processing your payment. Please keep this page open.', 'status'],
  ['replacing', 'Changing your plan. Please keep this page open.', 'status'],
  ['unresolved', 'We could not confirm your previous checkout. Check again before making another payment.', 'status'],
  ['restricted', 'This account is restricted', 'alert'],
] as const)('explains %s with an announced notice', (value, message, role) => {
  status(value); mount(); expect(screen.getByText(message)).toHaveAttribute('role', role);
});
it('shows the loading frame until the controller reports checkout.loaded', () => {
  status('frameLoading'); const view = mount(); const frame = target();
  expect(screen.getByText('Loading the secure card form')).toBeVisible();
  expect(frame?.parentElement).toHaveAttribute('inert');
  status('ready'); view.rerender(tree());
  expect(target()).toBe(frame); expect(frame?.parentElement).not.toHaveAttribute('inert');
  expect(screen.queryByText('Loading the secure card form')).not.toBeInTheDocument();
});
it('offers frame retry in place of the failed form', () => {
  status('frameFailed'); mount();
  expect(screen.getByRole('heading', { name: "The card form didn't load" })).toBeVisible();
  expect(target()).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Try again' })); expect(mocks.session.tryAgain).toHaveBeenCalledOnce();
  expect(screen.getByRole('link', { name: 'Change plan' })).toBeVisible();
});
it.each(['paying', 'replacing', 'offline', 'unresolved'] as const)('hides change plan while %s', value => {
  status(value); mount(); expect(screen.queryByRole('link', { name: 'Change plan' })).not.toBeInTheDocument();
});
it.each(['ready', 'declined', 'frameLoading', 'frameFailed'] as const)('allows change plan while %s', value => {
  status(value); mount(); expect(screen.getByRole('link', { name: 'Change plan' })).toBeVisible();
});
it('offline keeps an already-loaded target and offers reconnect retry', () => {
  const view = mount(); const frame = target();
  status('offline', { state: { onlineStatus: 'ready' } }); view.rerender(tree());
  expect(target()).toBe(frame); expect(frame?.parentElement).not.toHaveAttribute('inert');
  fireEvent.click(screen.getByRole('button', { name: 'Try again' })); expect(mocks.session.tryAgain).toHaveBeenCalledOnce();
});
it('status checking uses its independent lock', () => {
  status('unresolved', { actionBusy: true }); const view = mount();
  fireEvent.click(screen.getByRole('button', { name: 'Check subscription status' })); expect(mocks.session.checkStatus).toHaveBeenCalledOnce();
  mocks.session.statusBusy = true; view.rerender(tree());
  expect(screen.getByRole('button', { name: 'Checking subscription status…' })).toBeDisabled();
});
it('restricted provides support and no card form', async () => {
  status('restricted'); mount(); expect(await screen.findByRole('link', { name: 'Contact support' })).toHaveAttribute('href', 'mailto:support@example.invalid'); expect(target()).toBeNull();
});
it('restores saved draft ahead of a conflicting URL and announces resume', () => {
  mocks.life.data = { ...facts(), onboardingStep: 'PAYMENT', checkoutResume: draft };
  mount('/subscription/payment?plan=STARTER&interval=month');
  expect(mocks.useSession).toHaveBeenCalledWith({ plan: 'PRO', interval: 'year' });
  expect(screen.getByText('We saved your checkout. Pick up where you left off.')).toBeVisible();
  expect(screen.getByText('Pro')).toBeVisible(); expect(screen.getByText('Yearly')).toBeVisible();
  expect(mocks.session.changePlan).not.toHaveBeenCalled();
});
function changeRequestRouter() {
  return createMemoryRouter([
    { path: '/subscription/payment', element: <LanguageProvider><BillingPaymentPage /></LanguageProvider> },
    { path: '/elsewhere', element: <p>Elsewhere</p> },
  ], { initialEntries: [{ pathname: '/subscription/payment', search: '?plan=STARTER&interval=month',
    state: { changePlan: { plan: 'STARTER', interval: 'month' } } }] });
}
it('waits until changePlan is allowed and idle, consumes the explicit request once under StrictMode, and shows the replacement', async () => {
  mocks.life.data = { ...facts(), onboardingStep: 'PAYMENT', checkoutResume: draft };
  status('checking');
  const paymentTree = () => <StrictMode>{tree('/subscription/payment?plan=STARTER&interval=month', { changePlan: { plan: 'STARTER', interval: 'month' } })}</StrictMode>;
  const view = render(paymentTree());
  expect(mocks.session.changePlan).not.toHaveBeenCalled();
  status('frameLoading', { actionBusy: true });
  view.rerender(paymentTree());
  expect(mocks.session.changePlan).not.toHaveBeenCalled();
  status('ready', { actionBusy: false, statusBusy: true });
  view.rerender(paymentTree());
  expect(mocks.session.changePlan).not.toHaveBeenCalled();
  mocks.session.statusBusy = false;
  view.rerender(paymentTree());
  await waitFor(() => expect(mocks.session.changePlan).toHaveBeenCalledExactlyOnceWith({ plan: 'STARTER', interval: 'month' }));
  expect(screen.getByTestId('request-state')).toHaveTextContent('null');
  mocks.session.prepared = { plan: 'STARTER', interval: 'month', transactionId: 'txn_' + 'b'.repeat(26) };
  view.rerender(paymentTree());
  expect(screen.getByText('Starter')).toBeVisible();
  expect(screen.getByText('Monthly')).toBeVisible();
  expect(target()).toBeVisible();
  expect(mocks.session.changePlan).toHaveBeenCalledTimes(1);
});
it('a paid-draft confirmation still routes to activation without consuming a change action', () => {
  mocks.life.data = { ...facts(), onboardingStep: 'CONFIRMING' };
  status('confirming');
  render(tree('/subscription/payment?plan=STARTER&interval=month', { changePlan: { plan: 'STARTER', interval: 'month' } }));
  expect(screen.getByTestId('destination')).toHaveTextContent('/subscription/activation');
  expect(mocks.session.changePlan).not.toHaveBeenCalled();
});
it('clears the request from history so reload and Back cannot replace again', async () => {
  mocks.life.data = { ...facts(), onboardingStep: 'PAYMENT', checkoutResume: draft };
  const router = changeRequestRouter();
  const view = render(<RouterProvider router={router} />);
  await waitFor(() => expect(router.state.location.state).toBeNull());
  expect(mocks.session.changePlan).toHaveBeenCalledTimes(1);
  const consumedEntry = router.state.location;
  view.unmount();
  const reloaded = createMemoryRouter([{ path: '/subscription/payment', element: <LanguageProvider><BillingPaymentPage /></LanguageProvider> }],
    { initialEntries: [consumedEntry] });
  const reloadView = render(<RouterProvider router={reloaded} />);
  expect(mocks.session.changePlan).toHaveBeenCalledTimes(1);
  reloadView.unmount();
  render(<RouterProvider router={router} />);
  await act(async () => { await router.navigate('/elsewhere'); });
  await act(async () => { await router.navigate(-1); });
  expect(screen.getByText('Pro')).toBeVisible();
  expect(router.state.location.state).toBeNull();
  expect(mocks.session.changePlan).toHaveBeenCalledTimes(1);
});
it('resumes a saved draft even without URL selection', () => {
  mocks.life.data = { ...facts(), onboardingStep: 'PAYMENT', checkoutResume: draft }; mount('/subscription/payment');
  expect(mocks.useSession).toHaveBeenCalledWith({ plan: 'PRO', interval: 'year' }); expect(target()).toBeVisible();
});
it('uses the controller prepared selection before an older query draft', () => {
  mocks.life.data = { ...facts(), checkoutResume: draft };
  mocks.session.prepared = { ...draft, plan: 'ADVANCED', interval: 'month' }; mount();
  expect(screen.getByText('Enterprise')).toBeVisible(); expect(screen.getByText('Monthly')).toBeVisible();
});
it.each(['', '?plan=BAD&interval=year', '?plan=PRO&interval=weekly', '?plan=PRO', '?interval=year', '?plan=PRO&plan=STARTER&interval=year', '?plan=PRO&interval=year&interval=month'])('redirects missing or invalid selection %s without starting checkout', search => {
  mount('/subscription/payment' + search); expect(screen.getByTestId('destination')).toHaveTextContent('/choose-plan'); expect(mocks.useSession).not.toHaveBeenCalled();
});
it('waits for the saved draft read before rejecting an empty URL', () => {
  mocks.life = { ...mocks.life, data: undefined, isPending: true }; const view = mount('/subscription/payment');
  expect(screen.getByText('Checking subscription status…')).toBeVisible(); expect(mocks.useSession).not.toHaveBeenCalled();
  mocks.life = { ...mocks.life, isPending: false, data: { ...facts(), checkoutResume: draft } }; view.rerender(tree('/subscription/payment'));
  expect(target()).toBeVisible();
});
it.each(['foreign', 'error'] as const)('offers a scoped read retry for %s lifecycle without starting checkout', value => {
  if (value === 'foreign') mocks.life.dataOwner = { companyId: 99, ownerId: 1 };
  else mocks.life = { ...mocks.life, data: undefined, isError: true };
  mount(); expect(mocks.useSession).not.toHaveBeenCalled(); fireEvent.click(screen.getByRole('button', { name: 'Try again' })); expect(mocks.life.refetch).toHaveBeenCalledOnce();
});
it('preserves the frame through catalog, lifecycle and subscription background refetches, failures and new totals', () => {
  const view = mount(); const frame = target();
  mocks.catalog = { ...mocks.catalog, isFetching: true };
  mocks.life.isFetching = true; mocks.subscription.isFetching = true; view.rerender(tree());
  expect(target()).toBe(frame); expect(mocks.session.registerFrameTarget).toHaveBeenCalledTimes(1);
  mocks.catalog = { ...mocks.catalog, isFetching: false, isError: true };
  mocks.session.totals = { currencyCode: 'USD', totals: { subtotal: 123.45, tax: 1, total: 124.45 }, recurringTotals: { total: 124.45 } }; view.rerender(tree());
  expect(screen.getByText('US$1.00')).toBeVisible(); expect(screen.getAllByText('US$124.45')).toHaveLength(2);
  expect(target()).toBe(frame); expect(mocks.session.registerFrameTarget).toHaveBeenCalledTimes(1);
  expect(screen.getByRole('link', { name: 'Change plan' })).toBeEnabled();
});
it('keeps missing provider totals as skeletons during frame loading, then uses the shared fallback', () => {
  status('frameLoading'); const view = mount();
  expect(screen.queryByText('US$123.45')).not.toBeInTheDocument(); expect(screen.queryByText('Calculated by Paddle')).not.toBeInTheDocument();
  status('ready'); view.rerender(tree()); expect(screen.getByText('US$123.45')).toBeVisible(); expect(screen.getAllByText('Calculated by Paddle').length).toBeGreaterThan(0);
});
it('preserves the live frame, focus and draft through an Urdu switch and explains English provider fields', () => {
  const view = mount(); const frame = target(); const copy = screen.getByRole('button', { name: 'Copy' }); copy.focus();
  fireEvent.click(screen.getByRole('button', { name: 'اردو' }));
  expect(screen.getByText('Paddle کا محفوظ کارڈ فارم انگریزی میں ہے۔')).toBeVisible();
  expect(view.container.querySelector('.flow-shell')).toHaveAttribute('dir', 'rtl');
  expect(target()).toBe(frame); expect(copy).toHaveFocus(); expect(mocks.session.registerFrameTarget).toHaveBeenCalledTimes(1);
  expect(screen.getByText('4242 4242 4242 4242')).toHaveAttribute('dir', 'ltr');
});
it('completion hands off to activation without entering the workspace', () => {
  status('confirming'); mount(); expect(screen.getByTestId('destination')).toHaveTextContent('/subscription/activation');
});
it.each(['MANAGER', 'STAFF'])('denies %s without starting a session', role => {
  mocks.user.role = role; mount(); expect(screen.getByRole('alert')).toHaveTextContent('Only the company owner'); expect(mocks.useSession).not.toHaveBeenCalled();
});

it.each([
  ['USD', 1.15, 'US$1.15'], ['JPY', 123, 'JP¥123'], ['KWD', 1.234, 'KWD 1.234'],
] as const)('adapts documented SDK major units for %s using the shared currency precision', (currencyCode, total, expected) => {
  mocks.session.totals = { currencyCode, totals: { subtotal: total, tax: 0, total }, recurringTotals: { total } };
  mount();
  expect(screen.getAllByText(expected).length).toBeGreaterThan(0);
  expect(screen.getByRole('complementary').textContent).not.toContain('Calculated by Paddle');
});
it.each([NaN, Infinity, -1, 1.005, Number.MAX_SAFE_INTEGER, '12345'])('does not round or fabricate an SDK amount %s', total => {
  mocks.session.totals = { currencyCode: 'USD', totals: { subtotal: total, tax: total, total }, recurringTotals: { total } };
  mount(); expect(screen.getAllByText('Calculated by Paddle').length).toBeGreaterThan(0);
});
it('missing or unsupported SDK currency never borrows the catalog currency for tax or due today', () => {
  mocks.session.totals = { totals: { subtotal: 12, tax: 0, total: 12 } };
  const view = mount(); expect(screen.getAllByText('Calculated by Paddle').length).toBeGreaterThan(0);
  mocks.session.totals = { currencyCode: 'ZZZ', totals: { subtotal: 12, tax: 0, total: 12 } };
  view.rerender(tree()); expect(screen.queryByText('ZZZ 12.00')).not.toBeInTheDocument();
});
