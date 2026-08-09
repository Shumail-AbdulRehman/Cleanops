import { configureStore } from '@reduxjs/toolkit';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { Provider } from 'react-redux';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import authReducer, { clearUser, setUser, type AuthUser } from '@/store/slices/authSlice';
import { LanguageProvider } from '@/i18n/LanguageProvider';
import { translate } from '@/i18n/translations';
import type { SetupReadiness, SetupSite } from '@/pages/Setup/api';
import NewCompanyWelcome from './NewCompanyWelcome';

const api = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('@/api/client', () => ({ client: { get: api.get } }));
const owner: AuthUser = { id: 7, role: 'ADMIN', name: 'Synthetic Owner', email: 'fixture@example.invalid', companyId: 42 };
let saved: SetupReadiness;
function site(counts: Partial<SetupSite['counts']> = {}): SetupSite {
  return { id: 20, name: 'Synthetic site', timezone: 'Asia/Karachi', setupReady: false, reasons: [],
    counts: { staffWithShift: 0, activeAreas: 0, readySchedules: 0, tasksToday: 0, unassignedTasksToday: 0, ...counts } };
}
function mount(user: AuthUser | null = owner, language = 'en') {
  localStorage.setItem('hygene-ops.language', language);
  const store = configureStore({ reducer: { auth: authReducer } });
  if (user) store.dispatch(setUser(user));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const router = createMemoryRouter([
    { path: '/dashboard', element: <NewCompanyWelcome /> },
    { path: '/locations', element: <h1>Location destination</h1> },
    { path: '/setup', element: <h1>Setup destination</h1> },
  ], { initialEntries: ['/dashboard'] });
  render(<Provider store={store}><QueryClientProvider client={client}><LanguageProvider><div className="workspace"><RouterProvider router={router} /></div></LanguageProvider></QueryClientProvider></Provider>);
  return { client, router, store };
}
beforeEach(() => {
  localStorage.clear();
  api.get.mockReset();
  saved = { asOf: '2026-11-11T03:00:00Z', totalLocations: 0, sites: [], nextCursor: null,
    calendar: 'DAILY_INCLUDES_EVERY_DAY', access: { manageWork: true } };
  api.get.mockImplementation(async () => ({ data: { data: structuredClone(saved) } }));
});

describe('NewCompanyWelcome', () => {
  it('greets the owner by first name and reads readiness with cancellation and the existing scope', async () => {
    const { client } = mount({ ...owner, name: '  Synthetic   Owner  ' });
    expect(screen.getByRole('heading', { level: 1, name: 'Welcome, Synthetic' })).toBeVisible();
    await screen.findByRole('list', { name: 'Your setup checklist' });
    expect(api.get).toHaveBeenCalledWith('/location/readiness', { params: { afterId: 0, limit: 20 }, signal: expect.any(AbortSignal) });
    expect(client.getQueryData(['setup-readiness', 42, 'ADMIN', 7, 0])).toEqual(saved);
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
  });

  it('offers the first step action and keeps later steps locked until saved', async () => {
    const { router } = mount();
    const add = await screen.findByRole('link', { name: 'Add location' });
    expect(screen.getAllByRole('listitem')).toHaveLength(4);
    expect(screen.getByRole('listitem', { current: 'step' })).toHaveTextContent('Create a location');
    expect(screen.getByText('Step 1 of 4. Nothing is marked complete until it is saved.')).toBeVisible();
    expect(screen.getAllByText('Not configured')).toHaveLength(4);
    expect(screen.getByRole('button', { name: 'Add cleaning schedule' })).toBeDisabled();
    fireEvent.click(add);
    expect(router.state.location.pathname + router.state.location.search).toBe('/locations?create=1');
  });

  it('keeps the full checklist link available and navigates to setup', () => {
    const { router } = mount();
    fireEvent.click(screen.getByRole('link', { name: 'Open full checklist' }));
    expect(router.state.location.pathname).toBe('/setup');
  });

  it('labels the entire static example and has no sample record names or operational links inside it', async () => {
    mount();
    const preview = await screen.findByRole('complementary', { name: 'What this page becomes' });
    expect(preview).toHaveAccessibleDescription('Example only.');
    const example = within(preview).getByRole('group', { name: 'Example only.' });
    expect(within(example).getByText('94%')).toBeVisible();
    expect(within(example).getByText('89%')).toBeVisible();
    expect(within(example).getByText('Needs attention today')).toBeVisible();
    expect(within(example).getByRole('img', { name: '10 of 13 tasks done' })).toBeVisible();
    expect(within(preview).queryByRole('link')).not.toBeInTheDocument();
    expect(screen.queryByText('Building A')).not.toBeInTheDocument();
    expect(screen.queryByText('Shumail')).not.toBeInTheDocument();
  });

  it('keeps the manager assignment message and makes no readiness request or owner offer', async () => {
    mount({ ...owner, role: 'MANAGER' });
    expect(screen.getByRole('heading', { name: 'No assigned locations yet' })).toBeVisible();
    expect(screen.getByText('Ask your company owner to assign a location to your account.')).toBeVisible();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    expect(screen.queryByRole('list')).not.toBeInTheDocument();
    expect(screen.queryByRole('complementary')).not.toBeInTheDocument();
    await act(async () => {});
    expect(api.get).not.toHaveBeenCalled();
  });

  it.each([null, { ...owner, role: 'STAFF' as const }])('fails closed for a non-workspace identity', async user => {
    mount(user);
    expect(screen.getByRole('alert')).toHaveTextContent('Owner or assigned-site manager access is required.');
    await act(async () => {});
    expect(api.get).not.toHaveBeenCalled();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  it('shows an announced skeleton without an actionable checklist or example until readiness arrives', async () => {
    let resolve!: (value: unknown) => void;
    api.get.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    mount();
    expect(screen.getByRole('status')).toHaveAttribute('aria-busy', 'true');
    expect(screen.queryByRole('list')).not.toBeInTheDocument();
    expect(screen.queryByText('94%')).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Add location' })).not.toBeInTheDocument();
    await act(async () => resolve({ data: { data: saved } }));
    await screen.findByRole('link', { name: 'Add location' });
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('offers Retry with saved-record reassurance and recovers from an initial error', async () => {
    api.get.mockRejectedValueOnce(new Error('Private internal error details'));
    mount();
    const error = await screen.findByRole('alert');
    expect(error).toHaveTextContent('This page could not load');
    expect(error).toHaveTextContent('Your saved records have not changed.');
    expect(screen.queryByText('Private internal error details')).not.toBeInTheDocument();
    expect(screen.queryByRole('list')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await screen.findByRole('link', { name: 'Add location' });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(api.get).toHaveBeenCalledTimes(2);
  });

  it('keeps restricted-access guidance without granting a location action', async () => {
    api.get.mockRejectedValueOnce({ response: { status: 403 } });
    mount();
    expect(await screen.findByRole('alert')).toHaveTextContent('You do not have access to this location. Choose an assigned location or ask your owner.');
    expect(screen.queryByRole('link', { name: 'Add location' })).not.toBeInTheDocument();
  });

  it.each([false, undefined])('does not grant creation without server new-work access (%s)', async manageWork => {
    saved.access = { manageWork } as SetupReadiness['access'];
    mount();
    const button = await screen.findByRole('button', { name: 'Add location' });
    expect(button).toBeDisabled();
    expect(button).toHaveAccessibleDescription(manageWork === false
      ? 'This workspace is read-only for new work. Review plan activation to add or change setup.'
      : 'New-work access is unavailable');
    expect(screen.queryByRole('link', { name: 'Add location' })).not.toBeInTheDocument();
  });

  it('uses saved readiness progress and location-scoped links instead of hard-coded empty steps', async () => {
    saved.totalLocations = 1;
    saved.sites = [site({ staffWithShift: 2, activeAreas: 1 })];
    mount();
    await screen.findByText('Step 4 of 4. Nothing is marked complete until it is saved.');
    expect(screen.getAllByText('Configured')).toHaveLength(3);
    expect(screen.getByRole('link', { name: 'Add cleaning schedule' })).toHaveAttribute('href', '/locations/20?tab=templates&newSchedule=1');
    expect(screen.getByRole('link', { name: 'Open team and shifts' })).toHaveAttribute('href', '/staff?locationId=20');
  });

  it('preserves the mounted checklist and focused action through a background refetch', async () => {
    const { client } = mount();
    const add = await screen.findByRole('link', { name: 'Add location' });
    add.focus();
    let resolve!: (value: unknown) => void;
    api.get.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
    let refresh!: Promise<void>;
    act(() => { refresh = client.invalidateQueries({ queryKey: ['setup-readiness'] }); });
    await waitFor(() => expect(api.get).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(add).toHaveFocus();
    await act(async () => { resolve({ data: { data: saved } }); await refresh; });
    expect(screen.getByRole('link', { name: 'Add location' })).toBe(add);
    expect(add).toHaveFocus();
  });

  it('retains saved progress after a refresh failure and disables unconfirmed creation access', async () => {
    saved.totalLocations = 1;
    saved.sites = [site()];
    const { client } = mount();
    await screen.findByRole('link', { name: 'Add area template' });
    api.get.mockRejectedValueOnce(new Error('Offline'));
    await act(async () => { await client.invalidateQueries({ queryKey: ['setup-readiness'] }); });
    await screen.findByRole('alert');
    expect(screen.getByRole('list')).toBeVisible();
    expect(screen.getByText('Configured')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Add area template' })).toBeDisabled();
    expect(screen.getByRole('link', { name: 'Review location' })).toBeVisible();
  });

  it('isolates cached readiness when the company or identity changes', async () => {
    const { store } = mount();
    await screen.findByRole('link', { name: 'Add location' });
    api.get.mockImplementationOnce(() => new Promise(() => {}));
    act(() => { store.dispatch(setUser({ ...owner, id: 9, companyId: 99 })); });
    await waitFor(() => expect(api.get).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole('list')).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveAttribute('aria-busy', 'true');
    act(() => { store.dispatch(clearUser()); });
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  it('uses a translated greeting fallback for a blank owner name', () => {
    mount({ ...owner, name: '   ' });
    expect(screen.getByRole('heading', { level: 1, name: 'Welcome back' })).toBeVisible();
  });

  it('translates the welcome, steps and preview in Urdu while preserving the owner name', async () => {
    mount({ ...owner, name: 'علی خان' }, 'ur');
    await screen.findByRole('list', { name: translate('Your setup checklist', 'ur') });
    expect(document.documentElement).toHaveAttribute('dir', 'rtl');
    expect(screen.getByRole('heading', { level: 1, name: translate('Welcome, {name}', 'ur', { name: 'علی' }) })).toBeVisible();
    expect(screen.getByRole('link', { name: translate('Add location', 'ur') })).toHaveAttribute('href', '/locations?create=1');
    expect(screen.getByRole('complementary', { name: translate('What this page becomes', 'ur') })).toHaveAccessibleDescription(translate('Example only.', 'ur'));
  });
});
