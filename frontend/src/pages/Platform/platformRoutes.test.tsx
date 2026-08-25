import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { beforeEach, expect, it, vi } from 'vitest';
import { LanguageProvider } from '@/i18n/LanguageProvider';
import { platformRoutes } from './platformRoutes';

const mocks = vi.hoisted(() => ({ localLoginEnabled: vi.fn(), session: vi.fn(), request: vi.fn() }));
vi.mock('./operatorSession', async importOriginal => ({
  ...await importOriginal<typeof import('./operatorSession')>(),
  localOperatorLoginEnabled: mocks.localLoginEnabled,
  getLocalOperatorSession: mocks.session,
  operatorRequest: mocks.request,
}));

const email = 'operator@example.invalid';

beforeEach(() => {
  localStorage.clear();
  mocks.localLoginEnabled.mockReset().mockReturnValue(true);
  mocks.session.mockReset().mockResolvedValue({ enabled: true, authenticated: true, email });
  mocks.request.mockReset().mockRejectedValue(Object.assign(new Error('Access denied'), { status: 403 }));
});

function mount(path: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createMemoryRouter(platformRoutes, { initialEntries: [path] });
  render(
    <QueryClientProvider client={client}>
      <LanguageProvider><RouterProvider router={router} /></LanguageProvider>
    </QueryClientProvider>,
  );
  return router;
}

it.each([
  ['/platform', 'Overview', 'Platform data could not load'],
  ['/platform/overview', 'Overview', 'Platform data could not load'],
  ['/platform/companies', 'Companies', 'Companies could not be loaded.'],
  ['/platform/subscriptions', 'Subscriptions', 'Could not load subscriptions.'],
  ['/platform/subscriptions/payments', 'Subscriptions', 'Payments could not be loaded.'],
  ['/platform/inquiries', 'Inquiries', 'Could not load inquiries.'],
])('renders %s inside the operator shell', async (path, heading, message) => {
  const router = mount(path);
  expect(await within(await screen.findByRole('main')).findByRole('alert')).toHaveTextContent(message);
  const navigation = screen.getByRole('navigation', { name: 'Main navigation' });
  expect(within(navigation).getByRole('link', { name: heading })).toBeVisible();
  expect(screen.getAllByRole('heading', { name: heading, level: 1 })[0]).toBeVisible();
  expect(screen.getByText(email)).toBeVisible();
  expect(router.state.location.pathname).toBe(path);
});

it('mounts the company detail layout with the company ID and a filtered Companies back link', async () => {
  mount('/platform/companies/42?subscription=PAST_DUE');
  expect(await within(await screen.findByRole('main')).findByRole('alert')).toHaveTextContent('Company details could not be loaded.');
  expect(screen.getByRole('heading', { name: 'Company details', level: 1 })).toBeVisible();
  expect(screen.getAllByRole('link', { name: 'Companies' }).map(link => link.getAttribute('href')))
    .toContain('/platform/companies?subscription=PAST_DUE');
  expect(mocks.request).toHaveBeenCalledWith('/platform/companies/42', expect.anything());
  expect(mocks.request).toHaveBeenCalledWith('/platform/companies/42/insights', expect.anything());
});

it('opens an inquiry bookmark in the shell with the path ID selected', async () => {
  const inquiry = {
    id: 'bookmarked-request', company: 'Test Company', requestedStaff: 5, requestedLocations: 2,
    createdAt: '2026-11-19T05:00:00.000Z', contactVerification: 'UNVERIFIED',
    handling: { version: 1, status: 'NEW', owner: null, updatedAt: null },
  };
  mocks.request.mockImplementation(async (path: string) => {
    if (path.startsWith('/platform/service/inquiries?')) return { data: { items: [inquiry], nextCursor: null } };
    if (path === `/platform/service/inquiries/${inquiry.id}`) return { data: {
      ...inquiry, contactName: 'Test Contact', contactEmail: 'contact@example.invalid', requirements: 'Test request',
    } };
    throw new Error(`Unexpected platform request: ${path}`);
  });
  const router = mount(`/platform/inquiries/${inquiry.id}?inquiry=other&source=bookmark#details`);
  const detail = await within(await screen.findByRole('main')).findByRole('region', { name: 'Inquiry details' });
  expect(await within(detail).findByText('Test Contact')).toBeVisible();
  expect(router.state.location).toMatchObject({
    pathname: '/platform/inquiries', search: '?inquiry=bookmarked-request&source=bookmark', hash: '#details',
  });
  expect(router.state.historyAction).toBe('REPLACE');
});

it.each(['/platform/service', '/platform/audit?companyId=42'])(
  'redirects the retired route %s to Overview', async path => {
    const router = mount(path);
    expect(await screen.findByRole('heading', { name: 'Overview', level: 1 })).toBeVisible();
    expect(router.state.location).toMatchObject({ pathname: '/platform/overview', search: '' });
    expect(router.state.historyAction).toBe('REPLACE');
  },
);

it.each([
  ['/platform/login', 'Platform operator sign-in'],
  ['/platform/callback', 'Sign-in response rejected'],
  ['/platform/security', 'Platform security'],
  ['/platform/unknown/route', 'Platform operator sign-in'],
])('keeps %s outside the console shell', async (path, heading) => {
  mocks.localLoginEnabled.mockReturnValue(false);
  mocks.session.mockResolvedValue({ enabled: false, authenticated: false });
  const router = mount(path);
  expect(await screen.findByRole('heading', { name: heading })).toBeVisible();
  expect(screen.queryByRole('navigation', { name: 'Main navigation' })).not.toBeInTheDocument();
  expect(mocks.request).not.toHaveBeenCalled();
  expect(router.state.location.pathname).toBe(path);
});

it('keeps console requests and layout behind the local operator session check', async () => {
  mocks.session.mockResolvedValue({ enabled: true, authenticated: false });
  mount('/platform/companies/42');
  expect(await screen.findByRole('heading', { name: 'Platform owner sign-in' })).toBeVisible();
  expect(screen.queryByRole('navigation', { name: 'Main navigation' })).not.toBeInTheDocument();
  expect(mocks.request).not.toHaveBeenCalled();
});

it('mounts a live authenticated operator in the same console shell', async () => {
  mocks.localLoginEnabled.mockReturnValue(false);
  mount('/platform/companies');
  expect(await screen.findByRole('navigation', { name: 'Main navigation' })).toBeVisible();
  expect(screen.getByText(email)).toBeVisible();
  expect(mocks.request).toHaveBeenCalledWith(expect.stringMatching(/^\/platform\/companies/), expect.anything());
});
