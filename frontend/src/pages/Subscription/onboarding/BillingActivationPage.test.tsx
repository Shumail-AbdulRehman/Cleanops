import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { LanguageProvider } from '@/i18n/LanguageProvider';
import { getPaddle } from '@/lib/paddle';
import { translate } from '@/i18n/translations';
import { billingLifecycleKey } from '../queries';
import type { BillingConfirmResult, ValidatedBillingLifecycle } from '../types';
import BillingActivationPage from './BillingActivationPage';

const m = vi.hoisted(() => ({
  user: { id: 7, companyId: 42, role: 'ADMIN' } as { id: number; companyId: number; role: string } | null,
  confirm: vi.fn(),
  event: null as null | ((event: { name: string }) => void),
}));
vi.mock('@/hooks/useAuth', () => ({ default: () => ({ user: m.user }) }));
vi.mock('@/lib/serviceInformation', async importOriginal => ({ ...await importOriginal<typeof import('@/lib/serviceInformation')>(), getPublicSupport: async () => ({ email: 'support@example.invalid' }) }));
vi.mock('../api', async importOriginal => ({ ...await importOriginal<typeof import('../api')>(), confirmBillingCheckout: m.confirm }));
vi.mock('@paddle/paddle-js', async importOriginal => ({
  ...await importOriginal<typeof import('@paddle/paddle-js')>(),
  initializePaddle: vi.fn(async (options: { eventCallback: typeof m.event }) => {
    m.event = options.eventCallback;
    return { Initialized: true };
  }),
}));

type Result = BillingConfirmResult & { lifecycle: ValidatedBillingLifecycle };
let facts: ValidatedBillingLifecycle;
const clients: QueryClient[] = [];
const result = (outcome: Result['outcome'] = 'PROCESSING'): Result => ({ outcome, lifecycle: structuredClone(facts) });
function active() {
  facts.onboardingStep = 'WORKSPACE';
  facts.workspaceAccessAllowed = true;
  facts.subscription = {
    status: 'active', plan: 'ADVANCED', interval: 'year', catalogQualified: true,
    periodStart: '2026-11-10T00:00:00Z', periodEnd: '2027-11-10T00:00:00Z',
    scheduledChangeAction: null, scheduledChangeAt: null, lastEventAt: '2026-11-10T00:00:00Z',
  };
}
function Position() { return <output data-testid="position">{useLocation().pathname}{useLocation().search}</output>; }
function mount({ path = '/subscription/activation', cached }: { path?: string; cached?: ValidatedBillingLifecycle } = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  clients.push(client);
  if (cached) client.setQueryData(billingLifecycleKey(42, 7), cached);
  return { client, ...render(<QueryClientProvider client={client}><LanguageProvider><MemoryRouter initialEntries={[path]}>
    <Position /><Routes>
      <Route path="/subscription/activation" element={<BillingActivationPage />} />
      {['/subscription/payment', '/choose-plan', '/dashboard', '/login'].map(path => <Route key={path} path={path} element={<h1>{path}</h1>} />)}
    </Routes>
  </MemoryRouter></LanguageProvider></QueryClientProvider>) };
}
async function flush() { await act(async () => { await Promise.resolve(); }); }
async function advance(ms: number) { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); }
function progressRows() { return within(screen.getByRole('list', { name: 'Confirming your subscription' })).getAllByRole('listitem'); }
function expectNoReady() { expect(screen.queryByRole('link', { name: 'Open your workspace' })).not.toBeInTheDocument(); }

beforeEach(() => {
  vi.useFakeTimers(); vi.resetAllMocks(); vi.setSystemTime(new Date('2026-11-10T00:00:00Z')); localStorage.clear();
  m.user = { id: 7, companyId: 42, role: 'ADMIN' };
  facts = {
    company: { id: 42, name: 'Fixture', plan: 'PRO', isActive: true, operationalStatus: 'ACTIVE' },
    usage: { locations: 0, staff: 0, managers: 1 }, limits: { locations: 5, staff: 25, managers: 3 }, subscription: null,
    reconciliationRequired: false, billingConfigured: true, ownerVerified: false, billingEnvironment: 'sandbox',
    providerState: 'AWAITING_PROVIDER', portalAvailable: false, checkoutAvailable: false, checkoutReadiness: 'UNKNOWN',
    workspaceAccessAllowed: false, checkoutResume: null, onboardingStep: 'CONFIRMING', recoveryReason: null,
  };
  m.confirm.mockImplementation(async () => result());
});
afterEach(() => { cleanup(); clients.splice(0).forEach(client => client.clear()); vi.useRealTimers(); localStorage.clear(); vi.unstubAllEnvs(); delete window.PaddleBillingV1; });

it('starts with three unticked facts, an explicit wait and a focused heading', async () => {
  mount(); await flush();
  expect(screen.getByRole('heading', { name: 'Confirming your subscription' })).toHaveFocus();
  expect(progressRows().map(row => row.textContent)).toEqual(['Payment received', 'Activating your subscription', 'Preparing your workspace']);
  progressRows().forEach(row => expect(row).not.toHaveAttribute('data-complete'));
  expect(screen.getByText('Do not enter your card again while confirmation is pending.')).toBeVisible();
  expect(screen.queryByRole('button', { name: 'Check again' })).not.toBeInTheDocument();
  expectNoReady(); expect(m.confirm).not.toHaveBeenCalled();
});

it('announces slow at 20 seconds and timeout at 120 seconds, then Check again restarts confirmation', async () => {
  m.confirm.mockReturnValue(new Promise(() => {}));
  const view = mount(); await flush(); await advance(19_999);
  expect(screen.queryByText(/Taking a little longer/)).not.toBeInTheDocument();
  await advance(1);
  expect(screen.getByText(/Taking a little longer/)).toHaveAttribute('role', 'status');
  await advance(99_999); expect(screen.queryByRole('button', { name: 'Check again' })).not.toBeInTheDocument();
  await advance(1);
  expect(screen.queryByText(/Taking a little longer/)).not.toBeInTheDocument();
  expect(screen.getByText(/Check again before making another payment/)).toHaveAttribute('role', 'status');
  expect(view.container.querySelector('.flow-confirming-ring')).toBeNull();
  expectNoReady();
  active(); m.confirm.mockResolvedValue(result('ACTIVE'));
  fireEvent.click(screen.getByRole('button', { name: 'Check again' }));
  expect(screen.queryByText(/Check again before making another payment/)).not.toBeInTheDocument();
  await advance(2_000);
  expect(screen.getByRole('link', { name: 'Open your workspace' })).toBeVisible();
});

it('ticks payment and activation only after a qualified active server subscription', async () => {
  active(); facts.workspaceAccessAllowed = false; facts.onboardingStep = 'CONFIRMING';
  mount(); await flush(); await advance(2_000);
  const rows = progressRows();
  expect(rows[0]).toHaveAttribute('data-complete', 'true'); expect(rows[1]).toHaveAttribute('data-complete', 'true');
  expect(rows[2]).not.toHaveAttribute('data-complete'); expect(rows[2]).toHaveAttribute('aria-current', 'step'); expectNoReady();
});

it.each(['unknown', 'trialing', 'past_due', 'unqualified'] as const)('does not claim payment received for %s facts', async condition => {
  active(); facts.workspaceAccessAllowed = false; facts.onboardingStep = 'CONFIRMING';
  if (condition === 'unqualified') facts.subscription!.catalogQualified = false;
  else facts.subscription!.status = condition;
  mount(); await flush(); await advance(2_000);
  progressRows().forEach(row => expect(row).not.toHaveAttribute('data-complete')); expectNoReady();
});

it('shows the ready stamp and exact server plan, interval and renewal date, with explicit workspace entry', async () => {
  active(); m.confirm.mockResolvedValue(result('ACTIVE'));
  const view = mount({ path: '/subscription/activation?plan=STARTER&interval=month&success=true' }); await flush();
  expectNoReady(); await advance(2_000);
  expect(screen.getByRole('heading', { name: "You're all set" })).toHaveFocus();
  expect(screen.getByText('Enterprise')).toBeVisible(); expect(screen.getByText(/Yearly/)).toBeVisible();
  expect(screen.queryByText('Starter')).not.toBeInTheDocument();
  expect(screen.getByText('10-Nov-2027')).toHaveAttribute('dir', 'ltr');
  expect(view.container.querySelector('.flow-ready-stamp')).toHaveAttribute('aria-hidden', 'true');
  expect(view.container.querySelector('.flow-ready-stamp path')).toHaveAttribute('pathLength', '1');
  const link = screen.getByRole('link', { name: 'Open your workspace' }); expect(link).toHaveAttribute('href', '/dashboard');
  expect(screen.getByTestId('position')).toHaveTextContent('/subscription/activation');
  expect(within(screen.getByRole('navigation', { name: 'Setup progress' })).getAllByText('Step completed')).toHaveLength(4);
  fireEvent.click(link); expect(screen.getByTestId('position')).toHaveTextContent('/dashboard');
});

it.each(['missing-step', 'confirming-step', 'missing-access', 'processing-outcome'] as const)('never shows ready for %s even if some access facts look ready', async condition => {
  active();
  if (condition === 'missing-step') facts.onboardingStep = null;
  if (condition === 'confirming-step') facts.onboardingStep = 'CONFIRMING';
  if (condition === 'missing-access') facts.workspaceAccessAllowed = false;
  m.confirm.mockResolvedValue(result(condition === 'processing-outcome' ? 'PROCESSING' : 'ACTIVE'));
  mount(); await flush(); await advance(2_000); expectNoReady();
  expect(screen.getByRole('heading', { name: 'Confirming your subscription' })).toBeVisible();
});

it.each(['inactive', 'suspended', 'restricted-step'] as const)('restriction wins over active confirmation for %s', async condition => {
  active();
  if (condition === 'inactive') facts.company.isActive = false;
  if (condition === 'suspended') facts.company.operationalStatus = 'SUSPENDED';
  if (condition === 'restricted-step') facts.onboardingStep = 'RESTRICTED';
  m.confirm.mockResolvedValue(result('ACTIVE')); mount(); await flush(); await advance(2_000);
  expect(screen.getByRole('heading', { name: 'This account is restricted' })).toBeVisible();
  expect(screen.getByText(/Payment doesn't lift this/)).toBeVisible();
  await flush(); expect(screen.getByRole('link', { name: 'Contact support' })).toHaveAttribute('href', 'mailto:support@example.invalid'); expectNoReady();
  expect(screen.queryByRole('button', { name: 'Check again' })).not.toBeInTheDocument();
});

it.each([401, 403])('denied HTTP %s shows sign in again and hides prior payment facts', async status => {
  active(); facts.workspaceAccessAllowed = false; facts.onboardingStep = 'CONFIRMING';
  m.confirm.mockResolvedValueOnce(result()).mockRejectedValueOnce({ response: { status } });
  mount(); await flush(); await advance(5_000);
  expect(screen.getByRole('heading', { name: 'Sign in again' })).toBeVisible();
  expect(screen.getByRole('link', { name: 'Sign in again' })).toHaveAttribute('href', '/login');
  expect(screen.queryByText('Payment received')).not.toBeInTheDocument(); expectNoReady();
});

it.each([null, 'MANAGER', 'STAFF'])('denies %s identity without making a private request', async role => {
  m.user = role ? { id: 7, companyId: 42, role } : null;
  mount(); await flush(); await advance(120_000);
  expect(screen.getByRole('link', { name: 'Sign in again' })).toBeVisible(); expectNoReady(); expect(m.confirm).not.toHaveBeenCalled();
});

it.each([
  { step: 'PAYMENT', route: '/subscription/payment' },
  { step: 'CHOOSE_PLAN', route: '/choose-plan' },
  { step: 'CONFIRMING', route: '/subscription/payment' },
  { step: null, route: '/subscription/payment' },
] as const)('redirects two consecutive NOT_PAID responses with step $step to $route', async ({ step, route }) => {
  facts.onboardingStep = step; m.confirm.mockResolvedValue(result('NOT_PAID'));
  mount({ path: '/subscription/activation?plan=ADVANCED&interval=year&success=true' }); await flush(); await advance(2_000);
  expect(screen.getByTestId('position').textContent).toBe('/subscription/activation?plan=ADVANCED&interval=year&success=true');
  expect(screen.getByRole('heading', { name: 'Confirming your subscription' })).toBeVisible(); expectNoReady();
  await advance(2_999); expect(m.confirm).toHaveBeenCalledOnce();
  await advance(1);
  expect(screen.getByTestId('position').textContent).toBe(route); expectNoReady();
  await advance(120_000); expect(m.confirm).toHaveBeenCalledTimes(2);
});

it.each(['CHOOSE_PLAN', 'PAYMENT', 'CONFIRMING', null] as const)('NO_CHECKOUT goes straight to the plan page even with step %s', async step => {
  facts.onboardingStep = step; m.confirm.mockResolvedValue(result('NO_CHECKOUT'));
  mount(); await flush(); await advance(2_000);
  expect(screen.getByTestId('position').textContent).toBe('/choose-plan'); expectNoReady();
  await advance(120_000); expect(m.confirm).toHaveBeenCalledOnce();
});

it('NOT_PAID then PROCESSING resets the streak before any redirect', async () => {
  facts.onboardingStep = 'PAYMENT';
  m.confirm.mockResolvedValueOnce(result('NOT_PAID')).mockResolvedValueOnce(result('PROCESSING')).mockResolvedValue(result('NOT_PAID'));
  mount(); await flush(); await advance(10_000);
  expect(m.confirm).toHaveBeenCalledTimes(3);
  expect(screen.getByTestId('position').textContent).toBe('/subscription/activation'); expectNoReady();
  await advance(8_000);
  expect(screen.getByTestId('position').textContent).toBe('/subscription/payment');
});

it.each(['PAYMENT', 'CHOOSE_PLAN'] as const)('PROCESSING, a failed read and timeout stay on confirmation despite step %s', async step => {
  facts.onboardingStep = step;
  m.confirm.mockResolvedValueOnce(result('PROCESSING')).mockRejectedValue(new Error('read unavailable'));
  mount(); await flush(); await advance(2_000);
  expect(screen.getByTestId('position').textContent).toBe('/subscription/activation');
  await advance(3_000);
  expect(screen.getByTestId('position').textContent).toBe('/subscription/activation');
  await advance(115_000);
  expect(screen.getByRole('button', { name: 'Check again' })).toBeVisible();
  expect(screen.getByTestId('position').textContent).toBe('/subscription/activation'); expectNoReady();
});

it('a failed read between NOT_PAID responses requires a new consecutive pair', async () => {
  facts.onboardingStep = 'CHOOSE_PLAN';
  m.confirm.mockResolvedValueOnce(result('NOT_PAID')).mockRejectedValueOnce(new Error('read unavailable')).mockResolvedValue(result('NOT_PAID'));
  mount(); await flush(); await advance(10_000);
  expect(screen.getByTestId('position').textContent).toBe('/subscription/activation');
  await advance(8_000); expect(screen.getByTestId('position').textContent).toBe('/choose-plan');
});

it.each(['NOT_PAID', 'NO_CHECKOUT'] as const)('restricted %s never redirects or shows Ready', async outcome => {
  facts.company.operationalStatus = 'SUSPENDED'; facts.onboardingStep = 'CHOOSE_PLAN';
  m.confirm.mockResolvedValue(result(outcome)); mount(); await flush(); await advance(120_000);
  expect(screen.getByRole('heading', { name: 'This account is restricted' })).toBeVisible();
  expect(screen.getByRole('link', { name: 'Contact support' })).toBeVisible();
  expect(screen.getByTestId('position')).toHaveTextContent('/subscription/activation'); expectNoReady();
});

it.each([401, 403])('HTTP %s wins over a prior NOT_PAID outcome and a plan step', async status => {
  facts.onboardingStep = 'CHOOSE_PLAN';
  m.confirm.mockResolvedValueOnce(result('NOT_PAID')).mockRejectedValueOnce({ response: { status } });
  mount(); await flush(); await advance(5_000);
  expect(screen.getByRole('heading', { name: 'Sign in again' })).toBeVisible();
  expect(screen.getByTestId('position').textContent).toBe('/subscription/activation'); expectNoReady();
});

it('reload starts a new NOT_PAID streak instead of counting the prior run', async () => {
  facts.onboardingStep = 'PAYMENT'; m.confirm.mockResolvedValue(result('NOT_PAID'));
  const first = mount(); await flush(); await advance(2_000); first.unmount();
  mount({ cached: facts }); await flush(); await advance(2_000);
  expect(screen.getByTestId('position').textContent).toBe('/subscription/activation');
  await advance(3_000); expect(screen.getByTestId('position').textContent).toBe('/subscription/payment');
});

it('reload resumes a fresh confirmation and ignores cached ready facts until the server answers again', async () => {
  const first = mount(); await flush(); await advance(20_000); first.unmount();
  active(); const cached = structuredClone(facts); m.confirm.mockResolvedValue(result('ACTIVE'));
  mount({ cached }); await flush(); expectNoReady();
  expect(screen.queryByText(/Taking a little longer/)).not.toBeInTheDocument();
  await advance(2_000); expect(screen.getByRole('link', { name: 'Open your workspace' })).toBeVisible();
});

it('a browser completion event, return URL and cached access cannot show Ready', async () => {
  active(); const cached = structuredClone(facts);
  facts.workspaceAccessAllowed = false; facts.onboardingStep = 'CONFIRMING'; facts.subscription = null;
  vi.stubEnv('VITE_PADDLE_ENVIRONMENT', 'sandbox'); vi.stubEnv('VITE_PADDLE_CLIENT_TOKEN', 'test_fixture');
  window.PaddleBillingV1 = { Initialized: true } as NonNullable<typeof window.PaddleBillingV1>;
  mount({ cached, path: '/subscription/activation?success=true&activation=WORKSPACE' }); await flush();
  await getPaddle();
  act(() => m.event?.({ name: 'checkout.completed' }));
  expectNoReady(); expect(m.confirm).not.toHaveBeenCalled();
  await advance(2_000); expectNoReady();
  progressRows().forEach(row => expect(row).not.toHaveAttribute('data-complete'));
});

it('foreign-company facts cannot show ready or another company plan', async () => {
  active(); facts.company.id = 99; m.confirm.mockResolvedValue(result('ACTIVE'));
  mount(); await flush(); await advance(2_000);
  expectNoReady(); expect(screen.queryByText('Enterprise')).not.toBeInTheDocument();
});

it('owner changes discard previous readiness synchronously', async () => {
  active(); m.confirm.mockResolvedValue(result('ACTIVE'));
  const view = mount(); await flush(); await advance(2_000);
  expect(screen.getByRole('link', { name: 'Open your workspace' })).toBeVisible();
  m.user = { id: 8, companyId: 55, role: 'ADMIN' }; view.rerender(<QueryClientProvider client={view.client}><LanguageProvider><MemoryRouter><BillingActivationPage /></MemoryRouter></LanguageProvider></QueryClientProvider>);
  expectNoReady(); expect(screen.queryByText('Enterprise')).not.toBeInTheDocument();
});

it.each(['missing-date', 'scheduled-cancellation', 'missing-interval'] as const)('does not invent renewal facts for %s', async condition => {
  active();
  if (condition === 'missing-date') facts.subscription!.periodEnd = null;
  if (condition === 'scheduled-cancellation') facts.subscription!.scheduledChangeAction = 'cancel';
  if (condition === 'missing-interval') facts.subscription!.interval = null;
  m.confirm.mockResolvedValue(result('ACTIVE')); mount(); await flush(); await advance(2_000);
  expect(screen.getByText(/Not available/)).toBeVisible();
});

it('switches to Urdu without resetting confirmation and isolates the ready date left to right', async () => {
  mount(); await flush(); await advance(19_000);
  fireEvent.click(screen.getByRole('button', { name: 'اردو' })); await advance(1_000);
  expect(screen.getByText(translate('Taking a little longer than usual. You can stay here or come back later.', 'ur'))).toBeVisible();
  active(); m.confirm.mockResolvedValue(result('ACTIVE')); await advance(11_000);
  const heading = screen.getByRole('heading', { name: translate("You're all set", 'ur') });
  expect(heading.closest('.flow-shell')).toHaveAttribute('dir', 'rtl');
  expect(screen.getByText(new Intl.DateTimeFormat('ur-PK', { dateStyle: 'medium', timeZone: 'UTC' }).format(new Date(facts.subscription!.periodEnd!)))).toHaveAttribute('dir', 'ltr');
});

it('uses the shared stamp and ring motion with an instant reduced-motion override', async () => {
  const { readFileSync } = await vi.importActual<{ readFileSync(path: string, encoding: 'utf8'): string }>('node:fs');
  const flowCss = readFileSync('src/pages/Onboarding/flow.css', 'utf8');
  const view = mount(); await flush();
  expect(view.container.querySelector('.flow-confirming-ring')).toBeInTheDocument();
  active(); m.confirm.mockResolvedValue(result('ACTIVE')); await advance(2_000);
  expect(view.container.querySelector('.flow-ready-stamp path')).toHaveAttribute('pathLength', '1');
  const reduced = flowCss.slice(flowCss.indexOf('@media (prefers-reduced-motion: reduce)'));
  expect(reduced).toMatch(/\.flow-shell \*, \.flow-shell \*::before, \.flow-shell \*::after \{ animation: none !important; transition: none !important;/);
  expect(reduced).toContain('.flow-confirming-ring::after { display: none; }');
});
