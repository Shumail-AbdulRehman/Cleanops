import { configureStore } from '@reduxjs/toolkit';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { act, render, screen, waitFor } from '@testing-library/react';
import { Provider } from 'react-redux';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import App, { GuestRoute, ProtectedRoute, RequireRole } from '@/App';
import authReducer, { setLoading, setUser, type AuthUser } from '@/store/slices/authSlice';
import { LanguageProvider } from '@/i18n/LanguageProvider';
import { translate } from '@/i18n/translations';
import OperationsState from '@/pages/Manager/OperationsState';
import WorkspaceGate from './WorkspaceGate';
import { billingRoutes } from '@/pages/Subscription/onboarding/billingRoutes';

const api = vi.hoisted(() => ({ getCurrentUser: vi.fn(), get: vi.fn(), records: vi.fn() }));
vi.mock('@/api/auth', () => ({ getCurrentUser: api.getCurrentUser }));
vi.mock('@/api/client', async importOriginal => ({
  ...await importOriginal<typeof import('@/api/client')>(), client: { get: api.get },
}));
vi.mock('@/pages/Account/AccountPages', () => ({ OwnSecurityPage: () => <h1>Security</h1> }));
// Hold the real route's Suspense boundary at its lazy-module seam.
vi.mock('@/routes/workspacePages', () => ({ SubscriptionPage: () => { throw new Promise(() => {}); } }));

const owner: AuthUser = { id: 7, companyId: 42, role: 'ADMIN', name: 'Fixture', email: 'fixture@example.invalid' };
const clients: QueryClient[] = [];
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(finish => { resolve = finish; });
  return { promise, resolve };
}
function Records() {
  const query = useQuery({ queryKey: ['loading-state-records'], queryFn: api.records });
  return query.isPending ? <OperationsState loading layout="owner-overview" /> : <h1>Operational records</h1>;
}
function mount(path = '/dashboard', { role = 'ADMIN', restored = false, guard, language = 'en' }: {
  role?: AuthUser['role']; restored?: boolean; guard?: 'protected' | 'role' | 'guest'; language?: 'en' | 'ur';
} = {}) {
  localStorage.setItem('hygene-ops.language', language);
  const store = configureStore({ reducer: { auth: authReducer } });
  if (restored) store.dispatch(setUser({ ...owner, role }));
  if (guard) store.dispatch(setLoading(true));
  const query = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  clients.push(query);
  const privatePage = <WorkspaceGate><Records /></WorkspaceGate>;
  const page = guard === 'protected' ? <ProtectedRoute>{privatePage}</ProtectedRoute>
    : guard === 'role' ? <RequireRole roles={['ADMIN', 'MANAGER']}>{privatePage}</RequireRole>
      : guard === 'guest' ? <GuestRoute><h1>Login form</h1></GuestRoute>
        : <ProtectedRoute>{privatePage}</ProtectedRoute>;
  return { store, ...render(<Provider store={store}><QueryClientProvider client={query}><LanguageProvider>
    <MemoryRouter initialEntries={[path]}><Routes>
      <Route element={guard ? undefined : <App />}>
        <Route path={path.split('?')[0]} element={page} />
        {path !== '/login' && <Route path="/login" element={<h1>Login form</h1>} />}
      </Route>
    </Routes></MemoryRouter>
  </LanguageProvider></QueryClientProvider></Provider>) };
}
function expectSkeleton(layout?: string) {
  const status = screen.getByRole('status');
  expect(status).toHaveAttribute('aria-busy', 'true');
  expect(status).toHaveAttribute('data-loading-layout', layout ?? expect.any(String));
  expect(status.closest('.workspace')).not.toBeNull();
  expect(document.querySelector('.animate-spin, .flow-wait')).toBeNull();
  expect(screen.queryByText('Checking subscription status…')).not.toBeInTheDocument();
  expect(screen.queryByRole('heading', { name: 'Login form' })).not.toBeInTheDocument();
  expect(screen.queryByRole('heading', { name: 'Operational records' })).not.toBeInTheDocument();
}
beforeEach(() => { vi.clearAllMocks(); localStorage.clear(); });
afterEach(() => { clients.splice(0).forEach(client => client.clear()); });

it('an owner reload uses skeletons through session, billing and page data, in that order', async () => {
  const session = deferred<AuthUser>();
  const billing = deferred<unknown>();
  const records = deferred<unknown>();
  api.getCurrentUser.mockReturnValue(session.promise);
  api.get.mockReturnValue(billing.promise);
  api.records.mockReturnValue(records.promise);
  mount('/dashboard', { restored: true });
  const stages: string[] = [];
  function recordStage() {
    const status = screen.getByRole('status');
    stages.push(status.hasAttribute('data-loading-layout') ? 'workspace skeleton'
      : status.querySelector('.animate-spin') ? 'centred spinner' : status.textContent!.trim());
    expect(screen.queryByText('Login form')).not.toBeInTheDocument();
    expect(screen.queryByText('Operational records')).not.toBeInTheDocument();
  }
  recordStage();
  expect(api.get).not.toHaveBeenCalled();
  await act(async () => { session.resolve(owner); });
  await waitFor(() => expect(api.get).toHaveBeenCalledOnce());
  recordStage();
  expect(api.records).not.toHaveBeenCalled();
  await act(async () => { billing.resolve({ data: { data: {
    company: { id: 42, name: 'Fixture', plan: 'PRO', isActive: true, operationalStatus: 'ACTIVE' },
    usage: { locations: 1, staff: 1, managers: 1 }, limits: { locations: 5, staff: 25, managers: 3 },
    subscription: null, reconciliationRequired: false, billingConfigured: false, ownerVerified: false,
    providerState: 'NOT_LINKED', portalAvailable: false, checkoutAvailable: false,
    onboardingStep: 'WORKSPACE', workspaceAccessAllowed: true,
  } } }); });
  await waitFor(() => expect(api.records).toHaveBeenCalledOnce());
  recordStage();
  await act(async () => { records.resolve([]); });
  expect(await screen.findByRole('heading', { name: 'Operational records' })).toBeVisible();
  expect(stages).toEqual(['workspace skeleton', 'workspace skeleton', 'workspace skeleton']);
});

it.each([
  ['/dashboard', 'manager-overview'], ['/today-status', 'today'], ['/setup', 'records'],
  ['/locations', 'locations'], ['/locations/3?tab=staff', 'location-detail'],
  ['/locations/3/areas/new', 'area-setup'], ['/areas/2', 'area'], ['/staff', 'team'],
  ['/staff/4?tab=attendance', 'team-detail'], ['/attendance', 'attendance'],
  ['/managers', 'managers'], ['/exceptions', 'reviews'], ['/exceptions/5', 'review-detail'],
  ['/verification/6', 'verification'], ['/settings', 'records'],
])('session restoration at %s shows the matching skeleton without a login flash', (path, layout) => {
  api.getCurrentUser.mockReturnValue(new Promise(() => {}));
  mount(path);
  expectSkeleton(layout);
  if (path.includes('?tab=')) expect(screen.getByRole('status')).toHaveAttribute('data-loading-tab', path.split('?tab=')[1]);
  expect(api.get).not.toHaveBeenCalled();
  expect(api.records).not.toHaveBeenCalled();
});

it.each(['protected', 'role'] as const)('%s guard keeps the workspace skeleton while identity is pending', guard => {
  mount('/staff', { guard });
  expectSkeleton('team');
  expect(api.get).not.toHaveBeenCalled();
});

it('session restoration uses translated skeleton copy under Urdu', () => {
  api.getCurrentUser.mockReturnValue(new Promise(() => {}));
  mount('/attendance', { language: 'ur' });
  expectSkeleton('attendance');
  expect(screen.getByRole('status')).toHaveAccessibleName(translate('Loading…', 'ur'));
  expect(document.documentElement).toHaveAttribute('dir', 'rtl');
});

it.each(['/login', '/signup', '/', '/features', '/pricing', '/continue', '/choose-plan', '/welcome',
  '/subscription', '/subscription/payment', '/subscription/activation', '/subscription/recovery', '/account/security',
])('restoring %s never displays a workspace skeleton or the login form', path => {
  api.getCurrentUser.mockReturnValue(new Promise(() => {}));
  mount(path);
  expect(document.querySelector('[data-loading-layout], .animate-spin')).toBeNull();
  expect(screen.queryByText('Login form')).not.toBeInTheDocument();
  expect(api.get).not.toHaveBeenCalled();
});

it('GuestRoute keeps the sign-in form hidden while restoring identity', () => {
  mount('/login', { guard: 'guest' });
  expect(document.querySelector('[data-loading-layout], .animate-spin')).toBeNull();
  expect(screen.queryByText('Login form')).not.toBeInTheDocument();
});

it.each(['en', 'ur'] as const)('billing routes retain their translated FlowWait during loading in %s', async language => {
  localStorage.setItem('hygene-ops.language', language);
  const store = configureStore({ reducer: { auth: authReducer } });
  store.dispatch(setUser(owner));
  const query = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  clients.push(query);
  api.get.mockReturnValue(new Promise(() => {}));
  for (const path of ['/continue', '/choose-plan', '/welcome', '/subscription', '/subscription/payment', '/subscription/activation', '/subscription/recovery']) {
    const view = render(<Provider store={store}><QueryClientProvider client={query}><LanguageProvider>
      <MemoryRouter initialEntries={[path]}><Routes>
        {billingRoutes.map(route => <Route key={route.path} path={route.path} element={route.element} />)}
      </Routes></MemoryRouter>
    </LanguageProvider></QueryClientProvider></Provider>);
    expect(await screen.findByRole('status')).toHaveTextContent(translate('Checking subscription status…', language));
    expect(document.querySelector('.flow-shell .flow-wait')).not.toBeNull();
    expect(document.querySelector('[data-loading-layout], .animate-spin')).toBeNull();
    view.unmount();
  }
});
