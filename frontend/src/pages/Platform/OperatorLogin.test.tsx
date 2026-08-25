// @vitest-environment-options {"url":"https://console.example.test/"}
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import authReducer, { setUser, type AuthUser } from '@/store/slices/authSlice';
import { LanguageProvider } from '@/i18n/LanguageProvider';
import { platformRoutes } from './platformRoutes';
import { OperatorBoundary } from './OperatorLogin';
import { clearOperatorSession, operatorQueryScope, operatorRequest, operatorSessionStatus } from './operatorSession';
import { getConsoleOverview } from './console/api/consoleApi';
import { setCompanyStatus } from './companyApi';
import { saveInquiry } from './serviceApi';

function mount(path = '/platform/login', language = 'en', role?: AuthUser['role']) {
  localStorage.setItem('hygene-ops.language', language);
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  const store = configureStore({ reducer: { auth: authReducer } });
  if (role) store.dispatch(setUser({ id: 7, role, name: 'Synthetic person', email: 'fixture@example.invalid', companyId: 42 }));
  const router = createMemoryRouter(platformRoutes, { initialEntries: [path] });
  const view = render(<Provider store={store}><QueryClientProvider client={queryClient}><LanguageProvider><RouterProvider router={router} /></LanguageProvider></QueryClientProvider></Provider>);
  return { ...view, router, store, queryClient };
}
const liveBase = 'https://console.example.test/api';
const liveEmail = 'operator@example.test';
const fixturePassword = 'Synthetic-browser-fixture!42';
const sessionResponse = (enabled: boolean, authenticated = false) => Response.json({
  data: { enabled, authenticated, ...(authenticated ? { email: liveEmail } : {}) },
});

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  vi.stubEnv('VITE_API_BASE_URL', '/api');
  vi.stubEnv('VITE_LOCAL_PLATFORM_LOGIN', 'false');
  vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockImplementation(async () => sessionResponse(false)));
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

it('missing qualified provider shows a disabled action with an explanation and no registration/password form', async () => {
  mount();
  expect(await screen.findByRole('heading', { name: 'Platform operator sign-in', level: 1 })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Continue with identity provider' })).toBeDisabled();
  expect(screen.getByText('Platform sign in is not configured. Contact your platform administrator for access.')).toBeInTheDocument();
  expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  expect(screen.queryByRole('link', { name: /register|signup|password/i })).not.toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Company sign in' })).toHaveAttribute('href', '/login');
});

for (const role of ['ADMIN', 'MANAGER', 'STAFF'] as const) {
  it(`never promotes a tenant ${role} to an operator, including direct platform URLs`, async () => {
    const { store } = mount('/platform/companies', 'en', role);
    expect(await screen.findByRole('button', { name: 'Continue with identity provider' })).toBeDisabled();
    expect(store.getState().auth.user?.role).toBe(role);
    expect(operatorSessionStatus.status).toBe('unavailable');
    expect(screen.getByText('Named operator account and multi-factor authentication are required.')).toBeInTheDocument();
  });
}

it('ignores browser storage claims, bearer strings and role flags; no token is restored', async () => {
  localStorage.setItem('operator', JSON.stringify({ role: 'ADMIN', kind: 'PLATFORM_OPERATOR', acr: 'mfa', accessToken: 'synthetic.untrusted.token' }));
  sessionStorage.setItem('operator-access-token', 'synthetic.untrusted.token');
  mount('/platform/security');
  expect(await screen.findByRole('heading', { name: 'No platform session' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Open security provider' })).toBeDisabled();
});

for (const response of ['?code=untrusted&state=wrong&nonce=wrong', '?code=untrusted&state=matching-looking', '#access_token=synthetic.untrusted.token&state=untrusted', '?error=access_denied']) {
  it(`rejects unsolicited callback ${response.startsWith('#') ? 'fragment' : response.includes('error') ? 'error' : 'state/nonce'} without a platform session`, async () => {
    const { router } = mount(`/platform/callback${response}`);
    await screen.findByRole('heading', { name: 'Sign-in response rejected' });
    expect(router.state.location.pathname).toBe('/platform/callback');
    expect(router.state.location.search).toBe('');
    expect(router.state.location.hash).toBe('');
    expect(screen.getByText(/No platform session was created/)).toBeInTheDocument();
    expect(operatorSessionStatus.status).toBe('unavailable');
    expect(localStorage.getItem('operator-access-token')).toBeNull();
  });
}

it('keeps live operator requests on the site origin when tenant pages use a cross-origin API base', async () => {
  vi.stubEnv('VITE_API_BASE_URL', 'https://foreign.example.test/api');
  vi.mocked(fetch).mockImplementation(async target => target === liveBase + '/platform/session'
    ? sessionResponse(true) : Response.json({ data: {} }));
  mount();
  expect(await screen.findByLabelText('Platform email')).toBeVisible();
  await operatorRequest('/platform/companies');
  await operatorRequest('/platform/service/leads', { method: 'POST', body: { fixture: true } });
  const targets = vi.mocked(fetch).mock.calls.map(([target]) => String(target));
  expect(targets).toContain(liveBase + '/platform/companies');
  expect(targets).toContain(liveBase + '/platform/service/leads');
  expect(targets.every(target => target.startsWith(liveBase + '/'))).toBe(true);
});

it('local session cleanup removes only operator cache, leaving tenant identity and cached operations intact', async () => {
  const { queryClient, store } = mount('/platform/security', 'en', 'ADMIN');
  queryClient.setQueryData([...operatorQueryScope, 'companies'], { fixture: true });
  queryClient.setQueryData(['tenant', 'locations'], { kept: true });
  fireEvent.click(await screen.findByRole('button', { name: 'Clear platform session' }));
  await screen.findByRole('status');
  expect(queryClient.getQueryData([...operatorQueryScope, 'companies'])).toBeUndefined();
  expect(queryClient.getQueryData(['tenant', 'locations'])).toEqual({ kept: true });
  expect(store.getState().auth.user?.role).toBe('ADMIN');
  expect(screen.getByRole('status')).toHaveTextContent('This does not sign you out of an identity provider.');
});

it('cleanup cancels pending operator reads before removing sensitive cache entries', async () => {
  const queryClient = new QueryClient();
  let cancelled = false;
  const pending = queryClient.fetchQuery({ queryKey: [...operatorQueryScope, 'pending'], queryFn: ({ signal }) => new Promise<never>((_, reject) => {
    signal.addEventListener('abort', () => { cancelled = true; reject(new Error('cancelled')); });
  }) }).catch(() => undefined);
  await clearOperatorSession(queryClient);
  await pending;
  expect(cancelled).toBe(true);
  expect(queryClient.getQueryCache().findAll({ queryKey: operatorQueryScope })).toHaveLength(0);
});

it('a rejected callback clears cached operator records while preserving the company session', async () => {
  const { router, queryClient, store } = mount('/platform/security', 'en', 'ADMIN');
  queryClient.setQueryData([...operatorQueryScope, 'companies'], { restricted: true });
  queryClient.setQueryData(['tenant', 'locations'], { kept: true });
  await act(async () => { await router.navigate('/platform/callback?code=untrusted&state=untrusted#id_token=untrusted'); });
  expect(await screen.findByRole('alert')).toHaveTextContent('No platform session was created.');
  await waitFor(() => expect(queryClient.getQueryCache().findAll({ queryKey: operatorQueryScope })).toHaveLength(0));
  expect(queryClient.getQueryData(['tenant', 'locations'])).toEqual({ kept: true });
  expect(store.getState().auth.user?.role).toBe('ADMIN');
  expect(router.state.location.search).toBe('');
  expect(router.state.location.hash).toBe('');
});

it('an unsolicited callback never follows an external return destination or exchanges its code', async () => {
  const request = vi.spyOn(globalThis, 'fetch');
  const { router } = mount('/platform/callback?code=untrusted&state=untrusted&returnTo=https%3A%2F%2Funtrusted.example.invalid%2F');
  expect(await screen.findByRole('alert')).toHaveTextContent('Sign-in response rejected');
  expect(router.state.location.pathname).toBe('/platform/callback');
  expect(router.state.location.search).toBe('');
  expect(screen.getByRole('link', { name: 'Return to platform sign in' })).toHaveAttribute('href', '/platform/login');
  expect(request).not.toHaveBeenCalled();
});

it('a late operator response cannot restore data after local cleanup even if transport ignores abort', async () => {
  const queryClient = new QueryClient();
  let finish!: (value: { restricted: boolean }) => void;
  const pending = queryClient.fetchQuery({
    queryKey: [...operatorQueryScope, 'late'],
    queryFn: () => new Promise<{ restricted: boolean }>(resolve => { finish = resolve; }),
  }).catch(() => undefined);
  await clearOperatorSession(queryClient);
  finish({ restricted: true });
  await pending;
  expect(queryClient.getQueryCache().findAll({ queryKey: operatorQueryScope })).toHaveLength(0);
});

it('failed operator cancellation still removes only the operator cache and reports failure', async () => {
  const queryClient = new QueryClient();
  queryClient.setQueryData([...operatorQueryScope, 'companies'], { restricted: true });
  queryClient.setQueryData(['tenant', 'locations'], { kept: true });
  vi.spyOn(queryClient, 'cancelQueries').mockRejectedValueOnce(new Error('synthetic cancellation failure'));
  await expect(clearOperatorSession(queryClient)).rejects.toThrow('synthetic cancellation failure');
  expect(queryClient.getQueryCache().findAll({ queryKey: operatorQueryScope })).toHaveLength(0);
  expect(queryClient.getQueryData(['tenant', 'locations'])).toEqual({ kept: true });
});

it('cleanup failures stay explicit and retryable without reporting success', async () => {
  const { queryClient } = mount('/platform/security');
  vi.spyOn(queryClient, 'cancelQueries').mockRejectedValueOnce(new Error('synthetic cleanup failure'));
  fireEvent.click(await screen.findByRole('button', { name: 'Clear platform session' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Platform data could not be fully cleared.');
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
  fireEvent.click(await screen.findByRole('button', { name: 'Clear platform session' }));
  await screen.findByRole('status');
});

it('cleanup announces pending work, prevents repeated submission, and preserves company data', async () => {
  const { queryClient } = mount('/platform/security');
  queryClient.setQueryData(['tenant', 'locations'], { kept: true });
  let finish!: () => void;
  const cancellation = vi.spyOn(queryClient, 'cancelQueries').mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
  fireEvent.click(await screen.findByRole('button', { name: 'Clear platform session' }));
  const pending = screen.getByRole('button', { name: 'Clearing…' });
  expect(pending).toBeDisabled();
  expect(pending).toHaveAttribute('aria-busy', 'true');
  fireEvent.click(pending);
  expect(cancellation).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
  finish();
  await screen.findByRole('status');
  expect(screen.getByRole('button', { name: 'Clear platform session' })).toBeEnabled();
  expect(queryClient.getQueryData(['tenant', 'locations'])).toEqual({ kept: true });
});

it('public security and callback render complete Urdu guidance without provider controls', async () => {
  const view = mount('/platform/security', 'ur');
  expect(await screen.findByRole('heading', { level: 1, name: 'پلیٹ فارم کی سیکیورٹی' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'سیکیورٹی فراہم کنندہ کھولیں' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'پلیٹ فارم کا سیشن صاف کریں' }));
  expect(await screen.findByRole('status')).toHaveTextContent('کمپنی کا سیشن برقرار ہے۔');
  view.unmount();
  mount('/platform/callback?code=untrusted&state=untrusted#access_token=untrusted', 'ur');
  expect(await screen.findByRole('alert')).toHaveTextContent('پلیٹ فارم کا کوئی سیشن نہیں بنا۔');
  expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
});

it('complete Urdu interface follows persisted RTL language and switches without enabling access', async () => {
  mount('/platform/login', 'ur');
  expect(await screen.findByRole('heading', { name: 'پلیٹ فارم آپریٹر کا داخلہ' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'شناخت فراہم کنندہ کے ذریعے جاری رکھیں' })).toBeDisabled();
  await waitFor(() => expect(document.documentElement.dir).toBe('rtl'));
  fireEvent.click(screen.getByRole('button', { name: 'English' }));
  expect(screen.getByRole('heading', { name: 'Platform operator sign-in' })).toBeInTheDocument();
  expect(document.documentElement.dir).toBe('ltr');
});

it('the operator boundary never mounts protected children when sign-in is unavailable', async () => {
  const queryClient = new QueryClient();
  const router = createMemoryRouter([{ path: '*', element: <OperatorBoundary><div>Restricted platform records</div></OperatorBoundary> }]);
  render(<QueryClientProvider client={queryClient}><LanguageProvider><RouterProvider router={router} /></LanguageProvider></QueryClientProvider>);
  expect(screen.queryByText('Restricted platform records')).not.toBeInTheDocument();
  expect(await screen.findByRole('heading', { name: 'Platform operator sign-in' })).toBeInTheDocument();
});

it('shows the existing live form without the local label and signs in to Overview', async () => {
  let authenticated = false;
  vi.stubEnv('VITE_LOCAL_PLATFORM_LOGIN', 'true'); // A non-loopback site still uses live mode.
  vi.mocked(fetch).mockImplementation(async (target) => {
    if (target === liveBase + '/platform/session/login') {
      authenticated = true;
      return Response.json({ data: { authenticated: true, email: liveEmail } });
    }
    if (target === liveBase + '/platform/session') return sessionResponse(true, authenticated);
    return new Response(null, { status: 503 });
  });

  const { router } = mount();
  expect(await screen.findByRole('heading', { name: 'Platform owner sign-in' })).toBeVisible();
  fireEvent.change(await screen.findByLabelText('Platform email'), { target: { value: liveEmail } });
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: fixturePassword } });
  expect(screen.queryByText('Local development access')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Sign in to platform' }));
  await waitFor(() => expect(router.state.location.pathname).toBe('/platform/overview'));
  expect(await screen.findByRole('heading', { name: 'Overview', level: 1 })).toBeVisible();
  expect(fetch).toHaveBeenCalledWith(liveBase + '/platform/session', expect.objectContaining({
    method: 'GET', credentials: 'include', cache: 'no-store', redirect: 'error',
  }));
  expect(fetch).toHaveBeenCalledWith(liveBase + '/platform/session/login', expect.objectContaining({
    method: 'POST', credentials: 'include', cache: 'no-store', redirect: 'error',
    body: JSON.stringify({ email: liveEmail, password: fixturePassword }),
  }));
});

it.each(['/platform/login', '/platform/companies'])('keeps the provider-unavailable screen at %s when the status request fails', async (path) => {
  vi.mocked(fetch).mockRejectedValue(new TypeError('Synthetic network failure'));
  mount(path);
  expect(await screen.findByRole('heading', { name: 'Sign-in provider unavailable' })).toBeVisible();
  expect(screen.queryByLabelText('Platform email')).not.toBeInTheDocument();
  expect(screen.queryByRole('navigation', { name: 'Main navigation' })).not.toBeInTheDocument();
});

it('uses the live cookie for platform API reads, writes and sign-out', async () => {
  let authenticated = true;
  vi.stubEnv('VITE_API_BASE_URL', liveBase + '/');
  vi.mocked(fetch).mockImplementation(async target => {
    if (target === liveBase + '/platform/session/logout') authenticated = false;
    if (target === liveBase + '/platform/session') return sessionResponse(true, authenticated);
    return Response.json({ data: { authenticated } });
  });
  const { router } = mount('/platform/security');
  expect(await screen.findByText(liveEmail)).toBeVisible();
  expect(screen.queryByText('Local development access')).not.toBeInTheDocument();

  const companyStatus = { operationalStatus: 'SUSPENDED' as const, expectedVersion: 1, reason: 'Fixture' };
  const inquiryStatus = { expectedVersion: 0, status: 'CLOSED' as const, ownership: 'SELF' as const, reason: 'Fixture' };
  await getConsoleOverview();
  await setCompanyStatus(1, companyStatus);
  await saveInquiry('fixture', inquiryStatus);
  fireEvent.click(screen.getByRole('button', { name: 'Sign out of platform' }));
  await screen.findByRole('button', { name: 'Sign in to platform' });
  expect(router.state.location.pathname).toBe('/platform/login');

  for (const [path, method] of [
    ['/platform/overview', 'GET'],
    ['/platform/companies/1/status', 'PATCH'],
    ['/platform/service/inquiries/fixture', 'PATCH'],
    ['/platform/session/logout', 'POST'],
  ]) {
    expect(fetch).toHaveBeenCalledWith(liveBase + path, expect.objectContaining({
      method, credentials: 'include', cache: 'no-store', redirect: 'error',
    }));
  }
});
