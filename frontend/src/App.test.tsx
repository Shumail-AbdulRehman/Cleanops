import { configureStore } from '@reduxjs/toolkit';
import { QueryClient, QueryClientProvider, onlineManager } from '@tanstack/react-query';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { Provider } from 'react-redux';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import App, { GuestRoute, ProtectedRoute, RequireRole } from './App';
import authReducer, { setLoading, setUser, type AuthUser } from './store/slices/authSlice';
import { LanguageProvider } from './i18n/LanguageProvider';

const api = vi.hoisted(() => ({ getCurrentUser: vi.fn() }));
vi.mock('@/api/auth', () => ({ ...api, logoutApi: vi.fn(), refreshToken: vi.fn() }));
vi.mock('@/pages/Account/AccountPages', () => ({ OwnSecurityPage: () => <h1>Replace your password</h1> }));

const owner: AuthUser = { id: 7, companyId: 42, role: 'ADMIN', name: 'Fixture', email: 'fixture@example.invalid' };
const protectedRender = vi.fn();
function PrivatePage() { protectedRender(); return <h1>Protected content</h1>; }
function Destination() {
  const location = useLocation();
  return <><h1>{location.pathname}</h1><output data-testid="from">{JSON.stringify(location.state)}</output></>;
}
const clients: QueryClient[] = [];
function mount({ user = owner as AuthUser | null, guest = false, from, language = 'en', cached = false, loading = false }:
  { user?: AuthUser | null; guest?: boolean; from?: unknown; language?: string; cached?: boolean; loading?: boolean } = {}) {
  localStorage.setItem('hygene-ops.language', language);
  const store = configureStore({ reducer: { auth: authReducer } });
  if (user) store.dispatch(setUser(user));
  if (loading) store.dispatch(setLoading(true));
  const dispatch = vi.spyOn(store, 'dispatch');
  const query = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity } } });
  clients.push(query);
  if (cached) query.setQueryData(['currentUser'], owner, { updatedAt: 1 });
  const view = render(<Provider store={store}><QueryClientProvider client={query}><LanguageProvider>
    <MemoryRouter initialEntries={[{ pathname: guest ? '/login' : '/private', state: { from } }]}><Routes>
      {guest ? <Route path="/login" element={<GuestRoute><h1>Login form</h1></GuestRoute>} /> : <Route element={<App />}>
        <Route path="/private" element={<ProtectedRoute><RequireRole roles={['ADMIN', 'MANAGER']}><PrivatePage /></RequireRole></ProtectedRoute>} />
        <Route path="/login" element={<h1>Sign in</h1>} />
      </Route>}
      <Route path="/continue" element={<Destination />} /><Route path="/dashboard" element={<Destination />} />
    </Routes></MemoryRouter>
  </LanguageProvider></QueryClientProvider></Provider>);
  return { ...view, store, dispatch, query };
}
beforeEach(() => { vi.clearAllMocks(); localStorage.clear(); api.getCurrentUser.mockReset(); });
afterEach(() => { clients.splice(0).forEach(client => client.clear()); onlineManager.setOnline(true); });

it.each([503, 500, 'network'] as const)('%s retries once, preserves identity and never mounts protected content', async status => {
  api.getCurrentUser.mockRejectedValue(status === 'network' ? new Error('Private network detail') : { response: { status, data: { message: 'Private server detail' } } });
  const { store, dispatch } = mount();
  expect(protectedRender).not.toHaveBeenCalled();
  const retry = await screen.findByRole('button', { name: 'Try again' }, { timeout: 2500 });
  expect(screen.getByRole('heading', { name: /We could not reach Hygene Ops/ })).toBeVisible();
  expect(api.getCurrentUser).toHaveBeenCalledTimes(2);
  expect(store.getState().auth.user).toEqual(owner);
  expect(dispatch).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'auth/clearUser' }));
  expect(protectedRender).not.toHaveBeenCalled();
  expect(screen.queryByText('Sign in')).not.toBeInTheDocument();
  expect(screen.queryByText(/Private.*detail/)).not.toBeInTheDocument();
  expect(screen.getByRole('heading')).toHaveFocus();
  api.getCurrentUser.mockResolvedValue(owner);
  fireEvent.click(retry);
  await screen.findByRole('heading', { name: 'Protected content' });
  expect(api.getCurrentUser).toHaveBeenCalledTimes(3);
  expect(store.getState().auth.isLoading).toBe(false);
});

it('waits for the session read even when Redux still has a signed-in user', async () => {
  let finish!: (user: AuthUser) => void;
  api.getCurrentUser.mockReturnValue(new Promise<AuthUser>(resolve => { finish = resolve; }));
  mount();
  expect(protectedRender).not.toHaveBeenCalled();
  await act(async () => { finish(owner); });
  await screen.findByRole('heading', { name: 'Protected content' });
});
it('recovers automatically after the short retry delay', async () => {
  api.getCurrentUser.mockRejectedValueOnce({ response: { status: 503 } }).mockResolvedValue(owner);
  mount({ user: null });
  await screen.findByRole('heading', { name: 'Protected content' }, { timeout: 2500 });
  expect(api.getCurrentUser).toHaveBeenCalledTimes(2);
  expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument();
});
it('offers retry even when mounted while the browser is offline', async () => {
  onlineManager.setOnline(false);
  api.getCurrentUser.mockRejectedValue(new Error('offline'));
  mount({ user: null });
  await screen.findByRole('button', { name: 'Try again' }, { timeout: 2500 });
  expect(api.getCurrentUser).toHaveBeenCalledTimes(2);
  expect(protectedRender).not.toHaveBeenCalled();
});
it('blocks stale cached identity when a background session read fails', async () => {
  api.getCurrentUser.mockRejectedValue({ response: { status: 503 } });
  const { store } = mount({ cached: true });
  await screen.findByRole('button', { name: 'Try again' }, { timeout: 2500 });
  expect(screen.queryByText('Protected content')).not.toBeInTheDocument();
  expect(store.getState().auth.user).toEqual(owner);
});
it.each([
  { status: 401 },
  { status: 403, data: { message: 'Account is deactivated' } },
  { status: 403, data: { errors: [{ code: 'SESSION_REVOKED' }] } },
])('signs out only on confirmed session rejection: %j', async response => {
  api.getCurrentUser.mockRejectedValue({ response });
  const { store, dispatch } = mount();
  await screen.findByRole('heading', { name: 'Sign in' });
  expect(api.getCurrentUser).toHaveBeenCalledOnce();
  expect(store.getState().auth.user).toBeNull();
  expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({ type: 'auth/clearUser' }));
  expect(protectedRender).not.toHaveBeenCalled();
});
it.each([
  { status: 403 },
  { status: 403, data: { errors: [{ code: 'ACCOUNT_SUSPENDED' }] } },
])('keeps restricted sessions without admitting protected content: %j', async response => {
  api.getCurrentUser.mockRejectedValue({ response });
  const { store } = mount();
  await screen.findByRole('button', { name: 'Try again' }, { timeout: 2500 });
  expect(store.getState().auth.user).toEqual(owner);
  expect(protectedRender).not.toHaveBeenCalled();
});
it('retains the forced password flow without retrying or signing out', async () => {
  api.getCurrentUser.mockRejectedValue({ response: { status: 403, data: { errors: [{ code: 'PASSWORD_CHANGE_REQUIRED' }] } } });
  const { store } = mount();
  await screen.findByRole('heading', { name: 'Replace your password' });
  expect(api.getCurrentUser).toHaveBeenCalledOnce();
  expect(store.getState().auth.user).toEqual(owner);
  expect(protectedRender).not.toHaveBeenCalled();
});
it('uses the existing Urdu outage copy and retry control', async () => {
  api.getCurrentUser.mockRejectedValue(new Error('offline'));
  mount({ language: 'ur' });
  await screen.findByRole('button', { name: 'دوبارہ کوشش کریں' }, { timeout: 2500 });
  expect(screen.getByRole('alert')).toHaveTextContent('Hygene Ops سے رابطہ نہیں ہو سکا۔ اپنا کنکشن چیک کر کے دوبارہ کوشش کریں۔');
  expect(document.querySelector('.flow-shell')).toHaveAttribute('dir', 'rtl');
});
it.each(['ADMIN', 'MANAGER', 'STAFF'] as const)('GuestRoute sends %s to the correct entry and preserves a safe from', async role => {
  mount({ user: { ...owner, role }, guest: true, from: '/tasks?date=today#pending' });
  await screen.findByRole('heading', { name: role === 'ADMIN' ? '/continue' : '/dashboard' });
  expect(screen.getByTestId('from')).toHaveTextContent(JSON.stringify({ from: '/tasks?date=today#pending' }));
});
it.each(['https://evil.invalid', '//evil.invalid', '/\\evil.invalid', '/subscription/payment', '/continue', '/login', { pathname: '/tasks' }])('GuestRoute drops unsafe from: %j', async from => {
  mount({ guest: true, from });
  await screen.findByRole('heading', { name: '/continue' });
  expect(screen.getByTestId('from')).toHaveTextContent('null');
});
it('GuestRoute leaves signed-out guests on the public form', () => {
  mount({ user: null, guest: true });
  expect(screen.getByRole('heading', { name: 'Login form' })).toBeVisible();
});
it('GuestRoute waits while the session is unknown', () => {
  mount({ guest: true, loading: true });
  expect(screen.queryByRole('heading')).not.toBeInTheDocument();
});
it('keeps protected content blocked throughout a manual retry', async () => {
  api.getCurrentUser.mockRejectedValue({ response: { status: 503 } });
  mount();
  const retry = await screen.findByRole('button', { name: 'Try again' }, { timeout: 2500 });
  let finish!: (user: AuthUser) => void;
  api.getCurrentUser.mockReturnValue(new Promise<AuthUser>(resolve => { finish = resolve; }));
  fireEvent.click(retry);
  expect(await screen.findByRole('status')).toHaveTextContent('Loading…');
  expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument();
  expect(screen.queryByText('Protected content')).not.toBeInTheDocument();
  await act(async () => { finish(owner); });
  await screen.findByRole('heading', { name: 'Protected content' });
});
