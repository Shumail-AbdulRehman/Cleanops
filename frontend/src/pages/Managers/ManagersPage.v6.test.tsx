import { configureStore } from '@reduxjs/toolkit';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { Provider } from 'react-redux';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { client } from '@/api/client';
import authReducer, { setUser } from '@/store/slices/authSlice';
import { LanguageProvider } from '@/i18n/LanguageProvider';
import { translate } from '@/i18n/translations';
import ManagersPage from './ManagersPage';
import type { Manager } from './types';

const sites = [{ id: 20, name: 'North office', isActive: true }, { id: 30, name: 'South clinic', isActive: true }, { id: 40, name: 'Available site', isActive: true }];
const saved: Manager = { id: 7, name: 'Saved manager', email: 'saved@example.invalid', isActive: true, createdAt: '2026-10-20T00:00:00Z', locations: sites.slice(0, 2) };
let managers: Manager[], locations: typeof sites;
let readFailure: { path: 'manager' | 'location'; status: number } | undefined;
let held: 'manager' | 'location' | undefined;
let release: (() => void) | undefined;
const requests: { url?: string; method?: string; body: Record<string, unknown> }[] = [];
const originalAdapter = client.defaults.adapter;
const queries: QueryClient[] = [];
function Path() { const location = useLocation(); return <output aria-label="Current route">{location.pathname}{location.search}</output>; }
function mount(language: 'en' | 'ur' = 'en') {
  localStorage.setItem('hygene-ops.language', language);
  const store = configureStore({ reducer: { auth: authReducer } });
  store.dispatch(setUser({ id: 2, companyId: 42, role: 'ADMIN', name: 'Saved owner', email: 'owner@example.invalid' }));
  const query = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } }); queries.push(query);
  const view = render(<Provider store={store}><QueryClientProvider client={query}><LanguageProvider><MemoryRouter initialEntries={['/managers?keep=scope']}><div className="workspace"><ManagersPage /></div><Path /></MemoryRouter></LanguageProvider></QueryClientProvider></Provider>);
  return { ...view, query, store };
}
async function loaded() { return screen.findByRole('region', { name: 'Manager assignments' }); }
function row(name = saved.name) { return screen.getByRole('row', { name: new RegExp(name) }); }
async function account(value: string) {
  fireEvent.pointerDown(screen.getByRole('button', { name: /^Account status:/ }), { button: 0, ctrlKey: false, pointerType: 'mouse' });
  fireEvent.click(await screen.findByRole('menuitemradio', { name: value }));
}
function search(value: string) { fireEvent.change(screen.getByRole('searchbox', { name: 'Search managers' }), { target: { value } }); }
async function refetch(query: QueryClient) { await act(async () => { await query.refetchQueries({ queryKey: ['getManagers'] }); await query.refetchQueries({ queryKey: ['getLocations'] }); }); }
beforeEach(() => {
  localStorage.clear(); requests.length = 0; readFailure = undefined; held = undefined; release = undefined;
  managers = [saved, { ...saved, id: 8, name: 'Inactive manager', email: 'inactive@example.invalid', isActive: false, locations: [sites[2]] }, { ...saved, id: 9, name: 'Unassigned manager', email: 'unassigned@example.invalid', locations: [] }]; locations = [...sites];
  client.defaults.adapter = async config => {
    const path = config.url?.includes('/manager') ? 'manager' : 'location';
    requests.push({ url: config.url, method: config.method, body: JSON.parse(config.data || '{}') });
    if (config.method === 'get') {
      if (held === path) await new Promise<void>(resolve => { release = resolve; });
      if (readFailure?.path === path) throw { config, response: { status: readFailure.status, data: { message: 'private backend detail' } } };
      return { config, data: { data: path === 'manager' ? managers : locations }, status: 200, statusText: 'OK', headers: {} };
    }
    return { config, data: { data: { id: 7, historyPreserved: true } }, status: 200, statusText: 'OK', headers: {} };
  };
});
afterEach(() => { client.defaults.adapter = originalAdapter; queries.splice(0).forEach(query => query.clear()); });

it('shows authoritative summary, decorative avatars, contacts, location links and actual account statuses', async () => {
  mount(); await loaded();
  const summary = screen.getByLabelText('Manager summary');
  expect(within(summary).getByText('Total managers').parentElement).toHaveTextContent('3');
  expect(within(summary).getByText('Active managers').parentElement).toHaveTextContent('2');
  expect(within(summary).getByText('Locations covered').parentElement).toHaveTextContent('2');
  expect(within(row()).getByText(saved.email)).toHaveAttribute('dir', 'ltr');
  expect(within(row()).getByRole('link', { name: 'North office' })).toHaveAttribute('href', '/locations/20');
  expect(within(row()).getByRole('link', { name: 'South clinic' })).toHaveAttribute('href', '/locations/30');
  expect(within(row()).getByText('Active')).toBeInTheDocument(); expect(within(row('Inactive manager')).getByText('Inactive')).toBeInTheDocument();
  expect(screen.getByText('No locations assigned')).toBeInTheDocument(); expect(screen.queryByRole('img')).not.toBeInTheDocument();
  expect(requests.map(request => request.url)).toEqual(expect.arrayContaining(['/manager/', '/location/']));
  expect(requests.every(request => request.method === 'get')).toBe(true);
});
it.each(['SAVED MANAGER', 'SAVED@EXAMPLE.INVALID', 'SOUTH CLINIC'])('search matches name, email and assignment case-insensitively: %s', async value => {
  mount(); await loaded(); search(value); expect(row()).toBeInTheDocument(); expect(screen.queryByText('Inactive manager')).not.toBeInTheDocument();
  expect(screen.getByLabelText('Manager summary')).toHaveTextContent('3'); expect(screen.getByText('1 of 3 managers')).toBeInTheDocument();
});
it('composes search with Active and Inactive filters and clears a no-match result', async () => {
  mount(); await loaded(); await account('Inactive'); expect(row('Inactive manager')).toBeInTheDocument(); expect(screen.queryByText(saved.name)).not.toBeInTheDocument();
  search('North'); expect(screen.getByText('No managers match these filters.')).toBeInTheDocument();
  expect(screen.queryByText('No managers yet')).not.toBeInTheDocument(); fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
  expect(screen.getByRole('searchbox')).toHaveValue(''); expect(screen.getByRole('button', { name: 'Account status: All accounts' })).toBeInTheDocument();
  await account('Active'); expect(row()).toBeInTheDocument(); expect(screen.queryByText('Inactive manager')).not.toBeInTheDocument();
  expect(screen.getByLabelText('Current route')).toHaveTextContent('/managers?keep=scope');
});
it('Clear search preserves the status filter and restores input focus', async () => {
  mount(); await loaded(); await account('Inactive'); search('missing'); fireEvent.click(screen.getByRole('button', { name: 'Clear search' }));
  expect(screen.getByRole('searchbox')).toHaveFocus(); expect(screen.getByRole('button', { name: 'Account status: Inactive' })).toBeInTheDocument(); expect(row('Inactive manager')).toBeInTheDocument();
});
it('preserves name, assignment-count and account-status sorting without mutating cache data', async () => {
  const { query } = mount(); await loaded(); const original = query.getQueryData(['getManagers']);
  for (const header of ['Manager', 'Assigned locations', 'Account status']) {
    fireEvent.click(within(screen.getByRole('columnheader', { name: header })).getByRole('button'));
    expect(screen.getByRole('columnheader', { name: header })).toHaveAttribute('aria-sort', 'ascending');
    fireEvent.click(within(screen.getByRole('columnheader', { name: header })).getByRole('button'));
    expect(screen.getByRole('columnheader', { name: header })).toHaveAttribute('aria-sort', 'descending');
  }
  expect(query.getQueryData(['getManagers'])).toEqual(original);
});
it('keeps every manager reachable through 20-row pagination and clamps filtered results', async () => {
  managers = Array.from({ length: 21 }, (_, index) => ({ ...saved, id: index + 1, name: `Manager ${index + 1}` })); mount(); await loaded();
  expect(screen.getAllByRole('row')).toHaveLength(21); fireEvent.click(screen.getByRole('button', { name: 'Next' }));
  expect(row('Manager 21')).toBeInTheDocument(); expect(screen.getByText('Page 2 of 2')).toBeInTheDocument(); search('Manager 1');
  expect(screen.getByText('Manager 1')).toBeInTheDocument(); expect(screen.queryByText('Manager 21')).not.toBeInTheDocument();
});
it('Edit opens the existing panel with saved assignments, excludes other active managers and restores focus', async () => {
  managers.push({ ...saved, id: 10, name: 'Other manager', locations: [sites[2]] }); mount(); await loaded();
  const edit = within(row()).getByRole('button', { name: 'Edit' }); fireEvent.click(edit);
  expect(screen.getByRole('dialog', { name: 'Edit manager' })).toBeInTheDocument(); expect(screen.getByLabelText('Manager Name')).toHaveValue(saved.name);
  expect(screen.queryByLabelText('Password')).not.toBeInTheDocument(); expect(screen.getByRole('checkbox', { name: 'North office' })).toBeChecked();
  expect(screen.getByRole('checkbox', { name: 'North office' })).toBeEnabled(); expect(screen.getByRole('checkbox', { name: 'Available site' })).toBeDisabled();
  fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' }); await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument()); expect(edit).toHaveFocus();
});
it('inactive records disable Edit and retain their archived label without an access trigger', async () => {
  mount(); await loaded(); const inactive = row('Inactive manager'); expect(within(inactive).getByRole('button', { name: 'Edit' })).toBeDisabled();
  expect(within(inactive).getByText('Archived / inactive')).toBeInTheDocument(); expect(within(inactive).queryByRole('button', { name: 'Manage access' })).not.toBeInTheDocument();
});
it('retains the real access panel, manager handover safeguards and exact deactivation payload', async () => {
  mount(); await loaded(); fireEvent.click(within(row()).getByRole('button', { name: 'Manage access' }));
  expect(screen.getByRole('dialog', { name: 'Manager access' })).toBeInTheDocument(); expect(screen.getByText(/After the sites are released/)).toBeInTheDocument();
  expect(screen.queryByRole('option', { name: 'Issue one-use recovery code' })).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Reason'), { target: { value: ' Handover with history ' } }); fireEvent.click(screen.getByRole('button', { name: 'Confirm access change' }));
  await waitFor(() => expect(requests).toContainEqual({ url: '/workforce/manager/7/deactivate', method: 'post', body: { reason: 'Handover with history' } }));
});
it('empty state teaches adding the first manager and opens the real creation panel', async () => {
  managers = []; mount(); await loaded(); const empty = screen.getByRole('heading', { name: 'No managers yet' }).parentElement!;
  expect(within(empty).getByText('Managers see only the locations you assign them. Add one when you have a site to hand over.')).toBeInTheDocument();
  fireEvent.click(within(empty).getByRole('button', { name: 'Add manager' })); expect(screen.getByRole('dialog', { name: 'Add manager' })).toBeInTheDocument();
  expect(screen.getByLabelText('Password')).toBeInTheDocument(); expect(screen.getAllByRole('checkbox')).toHaveLength(3);
});
it('creation keeps only active locations, disables active assignments and releases inactive assignments', async () => {
  locations.push({ id: 50, name: 'Inactive site', isActive: false }); mount(); await loaded(); fireEvent.click(screen.getByRole('button', { name: 'Add manager' }));
  expect(screen.getByRole('checkbox', { name: 'North office' })).toBeDisabled(); expect(screen.getByRole('checkbox', { name: 'Available site' })).toBeEnabled(); expect(screen.queryByRole('checkbox', { name: 'Inactive site' })).not.toBeInTheDocument();
});
it('shows creation success through the existing callback and closes the form', async () => {
  mount(); await loaded(); fireEvent.click(screen.getByRole('button', { name: 'Add manager' }));
  for (const [label, value] of [['Manager Name', 'New manager'], ['Email', 'new@example.invalid'], ['Password', 'synthetic password']]) fireEvent.change(screen.getByLabelText(label), { target: { value } });
  fireEvent.click(screen.getByRole('checkbox', { name: 'Available site' })); fireEvent.click(screen.getByRole('button', { name: 'Create manager' }));
  expect(await screen.findByText('Manager added.')).toBeInTheDocument(); expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});
it('no locations offers the prerequisite route, real zeros and Back to team', async () => {
  managers = []; locations = []; mount(); await loaded(); expect(screen.getByText('You need at least one location before you can create a manager.')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Add manager' })).not.toBeInTheDocument(); expect(screen.getAllByRole('link', { name: 'Go to locations' }).every(link => link.getAttribute('href') === '/locations')).toBe(true);
  fireEvent.click(screen.getByRole('link', { name: 'Back to team' })); expect(screen.getByLabelText('Current route')).toHaveTextContent('/staff');
});
it('preserves location links and access guidance even without any current locations', async () => {
  locations = []; mount(); await loaded(); expect(screen.getByRole('link', { name: 'North office' })).toHaveAttribute('href', '/locations/20');
  expect(screen.getByRole('region', { name: 'Access follows assigned locations' })).toHaveTextContent('Company owners retain access across the workspace.');
  fireEvent.click(screen.getByRole('link', { name: 'Go to locations' })); expect(screen.getByLabelText('Current route')).toHaveTextContent('/locations');
});
it.each(['manager', 'location'] as const)('initial %s loading has an announced skeleton, no fabricated totals and no creation', async path => {
  held = path; mount(); expect(await screen.findByRole('status', { name: 'Loading…' })).toHaveAttribute('aria-busy', 'true');
  expect(screen.queryByLabelText('Manager summary')).not.toBeInTheDocument(); expect(screen.queryByRole('button', { name: 'Add manager' })).not.toBeInTheDocument();
  held = undefined; await act(async () => release?.()); await loaded();
});
it.each(['manager', 'location'] as const)('initial %s failure has safe guidance and a working Retry', async path => {
  readFailure = { path, status: 503 }; mount(); expect(await screen.findByRole('alert')).toHaveTextContent('Your saved records have not changed.');
  expect(screen.queryByLabelText('Manager summary')).not.toBeInTheDocument(); expect(screen.queryByText('private backend detail')).not.toBeInTheDocument();
  readFailure = undefined; fireEvent.click(screen.getByRole('button', { name: 'Retry' })); await loaded(); expect(row()).toBeInTheDocument();
});
it('background manager failures retain search, saved rows and focus', async () => {
  const { query } = mount(); await loaded(); search('Saved'); const input = screen.getByRole('searchbox'); input.focus();
  readFailure = { path: 'manager', status: 503 }; await refetch(query); expect(await screen.findByRole('alert')).toHaveTextContent('Your saved records have not changed.');
  expect(row()).toBeInTheDocument(); expect(input).toHaveValue('Saved'); expect(input).toHaveFocus();
});
it('background reads retain an edit draft and focused field without remounting the panel', async () => {
  const { query } = mount(); await loaded(); fireEvent.click(within(row()).getByRole('button', { name: 'Edit' })); const input = screen.getByLabelText('Manager Name');
  fireEvent.change(input, { target: { value: 'Retained edit draft' } }); input.focus(); readFailure = { path: 'manager', status: 503 }; await refetch(query);
  expect(input).toHaveValue('Retained edit draft'); expect(input).toHaveFocus(); expect(screen.getByRole('dialog', { name: 'Edit manager' })).toBeInTheDocument();
});
it('background location failure keeps rows but prevents opening unconfirmed assignment forms', async () => {
  const { query } = mount(); await loaded(); readFailure = { path: 'location', status: 503 }; await refetch(query);
  expect(row()).toBeInTheDocument(); await waitFor(() => expect(within(row()).getByRole('button', { name: 'Edit' })).toBeDisabled()); expect(screen.queryByRole('button', { name: 'Add manager' })).not.toBeInTheDocument();
});
it.each(['manager', 'location'] as const)('denied cached %s reads hide private rows and panels', async path => {
  const { query } = mount(); await loaded(); fireEvent.click(within(row()).getByRole('button', { name: 'Edit' }));
  readFailure = { path, status: 403 }; await refetch(query); await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument()); expect(screen.queryByText(saved.name)).not.toBeInTheDocument();
  expect(screen.getByRole('alert')).toHaveTextContent('You do not have access');
});
it('principal changes clear local filters and form drafts', async () => {
  const { store } = mount(); await loaded(); search('Saved'); fireEvent.click(within(row()).getByRole('button', { name: 'Edit' }));
  fireEvent.change(screen.getByLabelText('Manager Name'), { target: { value: 'Prior draft' } });
  act(() => store.dispatch(setUser({ id: 3, companyId: 42, role: 'ADMIN', name: 'Other owner', email: 'other@example.invalid' })));
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument(); expect(screen.getByRole('searchbox')).toHaveValue('');
});
it('Urdu translates interface copy, preserves records and mirrors the real edit panel', async () => {
  mount('ur'); await screen.findByRole('region', { name: translate('Manager assignments', 'ur') });
  expect(document.documentElement).toHaveAttribute('dir', 'rtl'); expect(screen.getByRole('heading', { name: translate('Managers', 'ur') })).toBeInTheDocument();
  expect(screen.getByRole('searchbox', { name: translate('Search managers', 'ur') })).toBeInTheDocument(); expect(screen.getByText(saved.email)).toHaveAttribute('dir', 'ltr');
  expect(screen.getByRole('link', { name: 'North office' })).toBeInTheDocument(); fireEvent.click(within(row()).getByRole('button', { name: translate('Edit', 'ur') }));
  expect(screen.getByRole('dialog', { name: translate('Edit manager', 'ur') })).toHaveAttribute('dir', 'rtl');
});
