import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { localSessionKey, operatorQueryScope, signOutLocalOperator } from '../../operatorSession';
import { getInquiries, type HandlingStatus, type Inquiry } from '../../serviceApi';
import ConsoleShell, { type ConsoleShellProps } from './ConsoleShell';

vi.mock('../../operatorSession', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../operatorSession')>(),
  signOutLocalOperator: vi.fn(),
}));
vi.mock('../../serviceApi', () => ({ getInquiries: vi.fn() }));

const inquiryList = vi.mocked(getInquiries);
const localSignOut = vi.mocked(signOutLocalOperator);
const overview = vi.fn<() => Promise<number>>();
const session = vi.fn<() => Promise<string>>();

function inquiry(id: string, status: HandlingStatus): Inquiry {
  return {
    id,
    company: `Company ${id}`,
    requestedLocations: 1,
    requestedStaff: 1,
    createdAt: '2026-11-19T00:00:00Z',
    contactVerification: 'UNVERIFIED',
    handling: { version: 1, status, owner: null, updatedAt: null },
  };
}

function Overview() {
  const { data } = useQuery({ queryKey: [...operatorQueryScope, 'console', 'overview'], queryFn: overview });
  useQuery({ queryKey: localSessionKey, queryFn: session });
  return <p>{data === undefined ? 'Loading figures' : `Companies in overview: ${data}`}</p>;
}

function renderShell({ path = '/platform', narrow = false, props = {}, login = <h1>Platform sign-in</h1> }: {
  path?: string;
  narrow?: boolean;
  props?: ConsoleShellProps;
  login?: ReactNode;
} = {}) {
  const viewport = Object.assign(new EventTarget(), { matches: narrow });
  vi.stubGlobal('matchMedia', vi.fn(() => viewport));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });

  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/platform" element={<ConsoleShell {...props} />}>
            <Route index element={<Overview />} />
            <Route path="companies/*" element={<p>Company records</p>} />
            <Route path="subscriptions/*" element={<p>Subscription records</p>} />
            <Route path="inquiries/*" element={<p>Inquiry records</p>} />
          </Route>
          <Route path="/platform/login" element={login} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return client;
}

beforeEach(() => {
  inquiryList.mockReset().mockResolvedValue({ items: [], nextCursor: null });
  localSignOut.mockReset().mockResolvedValue(undefined);
  overview.mockReset().mockResolvedValue(7);
  session.mockReset().mockResolvedValue('operator@example.test');
});

afterEach(() => vi.unstubAllGlobals());

describe('ConsoleShell', () => {
  it('renders the four links, marks the active section and renders the outlet', async () => {
    renderShell({ path: '/platform/companies/42' });
    const nav = within(screen.getByRole('navigation', { name: 'Main navigation' }));
    expect(nav.getAllByRole('link')).toHaveLength(4);
    expect(nav.getByRole('link', { name: 'Overview' })).toHaveAttribute('href', '/platform');
    expect(nav.getByRole('link', { name: 'Companies' })).toHaveAttribute('aria-current', 'page');
    expect(nav.getByRole('link', { name: 'Subscriptions' })).toHaveAttribute('href', '/platform/subscriptions');
    expect(nav.getByRole('link', { name: 'Inquiries' })).toHaveAttribute('href', '/platform/inquiries');
    expect(nav.getByRole('link', { name: 'Overview' })).not.toHaveAttribute('aria-current');
    expect(screen.getByRole('heading', { level: 1, name: 'Companies' })).toBeVisible();
    expect(within(screen.getByRole('main')).getByText('Company records')).toBeVisible();

    fireEvent.click(nav.getByRole('link', { name: 'Overview' }));
    expect(await screen.findByText('Companies in overview: 7')).toBeVisible();
    expect(nav.getByRole('link', { name: 'Overview' })).toHaveAttribute('aria-current', 'page');
  });

  it('supports a detail title, back link and operator email', () => {
    renderShell({ path: '/platform/companies/42', props: {
      title: 'Company details',
      backLink: { to: '/platform/companies', label: 'Back to companies' },
      operatorEmail: 'owner@example.test',
    } });
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getByRole('heading', { name: 'Company details' })).toBeVisible();
    expect(screen.getByRole('link', { name: 'Back to companies' })).toHaveAttribute('href', '/platform/companies');
    expect(screen.getByText('owner@example.test')).toBeVisible();
  });

  it('counts only new inquiries across all result pages', async () => {
    inquiryList.mockResolvedValueOnce({ items: [inquiry('a', 'NEW'), inquiry('b', 'IN_PROGRESS')], nextCursor: 'b' });
    inquiryList.mockResolvedValueOnce({ items: [inquiry('c', 'NEW'), inquiry('d', 'CLOSED')], nextCursor: null });
    renderShell({ path: '/platform/companies' });

    const link = await screen.findByRole('link', { name: 'Inquiries, 2 new' });
    expect(within(link).getByText('2')).toBeVisible();
    expect(inquiryList).toHaveBeenNthCalledWith(2, { after: 'b' }, expect.any(AbortSignal));
  });

  it('hides the badge during loading and when there are zero new inquiries', async () => {
    let finish: (value: Awaited<ReturnType<typeof getInquiries>>) => void = () => {};
    inquiryList.mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
    const client = renderShell({ path: '/platform/companies' });
    expect(screen.getByRole('link', { name: 'Inquiries' })).toHaveTextContent(/^Inquiries$/);

    finish({ items: [inquiry('a', 'CLOSED')], nextCursor: null });
    await waitFor(() => expect(client.isFetching()).toBe(0));
    expect(screen.getByRole('link', { name: 'Inquiries' })).toHaveTextContent(/^Inquiries$/);
  });

  it('hides an unavailable inquiry count and leaves navigation usable', async () => {
    inquiryList.mockRejectedValueOnce(new Error('Inquiry list unavailable'));
    const client = renderShell({ path: '/platform/companies' });
    await waitFor(() => expect(client.isFetching()).toBe(0));
    const link = screen.getByRole('link', { name: 'Inquiries' });
    expect(link).toHaveTextContent(/^Inquiries$/);
    fireEvent.click(link);
    expect(screen.getByText('Inquiry records')).toBeVisible();
    expect(link).toHaveAttribute('aria-current', 'page');
  });

  it('refreshes active console queries and the badge, without refetching the session', async () => {
    overview.mockResolvedValueOnce(7).mockResolvedValueOnce(8);
    inquiryList.mockResolvedValueOnce({ items: [], nextCursor: null });
    inquiryList.mockResolvedValueOnce({ items: [inquiry('a', 'NEW')], nextCursor: null });
    renderShell();
    expect(screen.getByText('Updated: Not available')).toBeVisible();
    await screen.findByText('Companies in overview: 7');
    expect(screen.getByRole('time')).toHaveTextContent(/^Updated /);

    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    expect(await screen.findByText('Companies in overview: 8')).toBeVisible();
    expect(await screen.findByRole('link', { name: 'Inquiries, 1 new' })).toBeVisible();
    expect(overview).toHaveBeenCalledTimes(2);
    expect(inquiryList).toHaveBeenCalledTimes(2);
    expect(session).toHaveBeenCalledTimes(1);
  });

  it('signs out locally, clears only operator queries and returns to platform sign-in', async () => {
    const client = renderShell();
    client.setQueryData(['tenant', 'profile'], { name: 'Tenant' });
    await screen.findByText('Companies in overview: 7');
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));

    expect(await screen.findByRole('heading', { name: 'Platform sign-in' })).toBeVisible();
    expect(localSignOut).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(client.getQueryCache().findAll({ queryKey: operatorQueryScope })).toHaveLength(0));
    expect(client.getQueryData(['tenant', 'profile'])).toEqual({ name: 'Tenant' });
  });

  it('reports failed sign-out and allows a retry', async () => {
    localSignOut.mockRejectedValueOnce(new Error('Sign-out unavailable'));
    renderShell({ path: '/platform/companies' });
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Sign out failed. Try again.');
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    expect(await screen.findByRole('heading', { name: 'Platform sign-in' })).toBeVisible();
  });

  it('lets the login route read a fresh session after clearing the old one', async () => {
    function Login() {
      const { data } = useQuery({ queryKey: localSessionKey, queryFn: session });
      return <h1>{data === 'signed out' ? 'Ready to sign in' : 'Checking session'}</h1>;
    }

    session.mockResolvedValueOnce('operator@example.test').mockResolvedValueOnce('signed out');
    const client = renderShell({ login: <Login /> });
    await screen.findByText('Companies in overview: 7');
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    expect(await screen.findByRole('heading', { name: 'Ready to sign in' })).toBeVisible();
    expect(client.getQueryData([...operatorQueryScope, 'console', 'overview'])).toBeUndefined();
    expect(session).toHaveBeenCalledTimes(2);
  });

  it('inerts the page, traps focus and returns it to the trigger when Escape closes the drawer', () => {
    renderShell({ narrow: true, path: '/platform/companies' });
    const menu = screen.getByRole('button', { name: 'Open menu' });
    const drawer = document.getElementById(menu.getAttribute('aria-controls')!);
    const page = screen.getByRole('main').parentElement;
    expect(menu).toHaveAttribute('aria-expanded', 'false');
    expect(drawer).toHaveAttribute('inert');
    expect(page).not.toHaveAttribute('inert');

    fireEvent.click(menu);
    const dialog = screen.getByRole('dialog', { name: 'Platform console' });
    const close = within(dialog).getByRole('button', { name: 'Close menu' });
    const signOut = within(dialog).getByRole('button', { name: 'Sign out' });
    expect(menu).toHaveAttribute('aria-expanded', 'true');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).not.toHaveAttribute('inert');
    expect(page).toHaveAttribute('inert');
    expect(close).toHaveFocus();

    fireEvent.keyDown(close, { key: 'Tab', shiftKey: true });
    expect(signOut).toHaveFocus();
    fireEvent.keyDown(signOut, { key: 'Tab' });
    expect(close).toHaveFocus();
    fireEvent.keyDown(close, { key: 'Escape' });
    expect(menu).toHaveAttribute('aria-expanded', 'false');
    expect(drawer).toHaveAttribute('inert');
    expect(page).not.toHaveAttribute('inert');
    expect(menu).toHaveFocus();
  });

  it('closes the phone drawer on scrim click and navigation', async () => {
    renderShell({ narrow: true, path: '/platform/companies' });
    const menu = screen.getByRole('button', { name: 'Open menu' });
    fireEvent.click(menu);
    const dialog = screen.getByRole('dialog', { name: 'Platform console' });
    fireEvent.click(dialog.nextElementSibling!);
    expect(menu).toHaveFocus();
    expect(menu).toHaveAttribute('aria-expanded', 'false');

    fireEvent.click(menu);
    fireEvent.click(within(dialog).getByRole('link', { name: 'Subscriptions' }));
    expect(await screen.findByRole('heading', { name: 'Subscriptions' })).toBeVisible();
    expect(menu).toHaveAttribute('aria-expanded', 'false');
  });
});
