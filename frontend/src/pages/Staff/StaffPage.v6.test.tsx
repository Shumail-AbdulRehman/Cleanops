import { configureStore } from '@reduxjs/toolkit';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { Provider } from 'react-redux';
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom';
import { beforeEach, expect, it, vi } from 'vitest';
import authReducer, { setUser, type AuthUser } from '@/store/slices/authSlice';
import { LanguageProvider } from '@/i18n/LanguageProvider';
import StaffPage from './StaffPage';
const m = vi.hoisted(() => ({ staff: {} as Record<string, unknown>, locations: {} as Record<string, unknown>, edit: vi.fn(), create: vi.fn(), prefetch: vi.fn() }));
vi.mock('./queries', () => ({ useGetStaff: () => m.staff, getStaffDetailsQueryOptions: (id: number) => { m.prefetch(id); return { queryKey: ['preview', id], queryFn: async () => null }; }, useEditStaff: () => ({ mutateAsync: m.edit, isPending: false }), useCreateStaff: () => ({ mutate: m.create, isPending: false }) }));
vi.mock('../Location/queries', () => ({ useGetLocations: () => m.locations }));
const site = { id: 20, name: 'Saved site', timezone: 'Asia/Karachi', isActive: true };
const worker = { id: 7, name: 'Saved worker', email: 'worker@example.invalid', phone: '03001234567', isActive: true, locationId: 20, shiftStart: '1970-01-01T04:00:00Z', shiftEnd: '1970-01-01T12:00:00Z' };
const hire = { ...worker, id: 8, name: 'Staged hire', email: 'hire@example.invalid', phone: '03007654321', locationId: null };
const inactive = { ...worker, id: 9, name: 'Inactive worker', email: 'inactive@example.invalid', isActive: false };
function Path() { const loc = useLocation(), navigate = useNavigate(); return <><output aria-label="Current route">{loc.pathname + loc.search}</output><button onClick={() => navigate('/staff?locationId=unassigned&source=history')}>Set URL scope</button><button onClick={() => navigate(-1)}>History back</button></>; }
function mount(role: AuthUser['role'] = 'ADMIN', path = '/staff', language = 'en') {
  localStorage.setItem('hygene-ops.language', language);
  const store = configureStore({ reducer: { auth: authReducer } });
  store.dispatch(setUser({ id: 2, companyId: 42, role, name: 'Saved owner', email: 'owner@example.invalid' }));
  const query = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const tree = () => <Provider store={store}><QueryClientProvider client={query}><LanguageProvider><MemoryRouter initialEntries={[path]}><div className="workspace"><StaffPage /><Path /></div></MemoryRouter></LanguageProvider></QueryClientProvider></Provider>;
  const view = render(tree()); return { ...view, store, refresh: () => view.rerender(tree()) };
}
async function select(label: string, value: string) {
  fireEvent.pointerDown(screen.getByRole('button', { name: new RegExp('^' + label + ':') }), { button: 0, ctrlKey: false, pointerType: 'mouse' });
  fireEvent.click(await screen.findByRole('menuitemradio', { name: value }));
}
async function menu(name = worker.name) {
  fireEvent.pointerDown(screen.getByRole('button', { name: 'Actions: ' + name }), { button: 0, ctrlKey: false, pointerType: 'mouse' });
  return within(await screen.findByRole('menu', { name: 'Actions: ' + name }));
}
const row = (name = worker.name) => screen.getByRole('row', { name: new RegExp(name) });
beforeEach(() => {
  vi.clearAllMocks(); localStorage.clear(); m.edit.mockResolvedValue({});
  m.staff = { isLoading: false, isError: false, data: { data: [worker, hire, inactive] }, refetch: vi.fn() };
  m.locations = { isPending: false, isError: false, data: { data: [site] }, refetch: vi.fn() };
});
it('renders saved identities, contact, local shift and independent account statuses without photos', () => {
  mount(); expect(row()).toHaveTextContent('03001234567'); expect(row()).toHaveTextContent(worker.email); expect(row()).toHaveTextContent('Saved site09:00–17:00 · Asia/Karachi'); expect(row()).toHaveTextContent('Active'); expect(row(inactive.name)).toHaveTextContent('Inactive'); expect(document.querySelectorAll('img')).toHaveLength(0);
});
it('summary counts all records and highlights positive unassigned count', () => {
  mount(); for (const [label, count] of [['Active staff', '2'], ['Assigned staff', '2'], ['Unassigned hires', '1']]) expect(screen.getByText(label, { selector: 'dt' }).parentElement).toHaveTextContent(count);
  expect(screen.getByText('Unassigned hires', { selector: 'dt' }).parentElement).toHaveClass('wx-team-needs-site');
});
it('zero unassigned stays zero without attention treatment', () => {
  m.staff.data = { data: [worker] }; mount(); expect(screen.getByText('Unassigned hires', { selector: 'dt' }).parentElement).toHaveTextContent('0'); expect(screen.getByText('Unassigned hires', { selector: 'dt' }).parentElement).not.toHaveClass('wx-team-needs-site');
});
it.each([['saved WORKER', worker.name], ['hire@example', hire.name], ['0300765', hire.name]])('search matches name email and phone: %s', (search, name) => {
  mount(); fireEvent.change(screen.getByRole('searchbox', { name: 'Search team' }), { target: { value: search } }); expect(row(name)).toBeInTheDocument(); expect(screen.getAllByRole('row')).toHaveLength(2);
});
it('shows No email and searches the worker by phone without indexing null', () => {
  m.staff.data = { data: [{ ...worker, email: null }, hire] };
  mount();
  expect(within(row()).getByText('No email')).toBeVisible();
  const search = screen.getByRole('searchbox', { name: 'Search team' });
  fireEvent.change(search, { target: { value: '0300123' } });
  expect(row()).toBeInTheDocument();
  expect(screen.getAllByRole('row')).toHaveLength(2);
  fireEvent.change(search, { target: { value: 'null' } });
  expect(screen.queryByRole('row', { name: new RegExp(worker.name) })).not.toBeInTheDocument();
});
it('location and account filters compose with search, preserving unrelated URLs', async () => {
  mount('ADMIN', '/staff?source=setup'); await select('Filter by location', site.name); await select('Account status', 'Inactive'); fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'worker' } }); expect(row(inactive.name)).toBeInTheDocument(); expect(screen.getAllByRole('row')).toHaveLength(2); expect(screen.getByLabelText('Current route')).toHaveTextContent('source=setup&locationId=20');
});
it('unassigned URL filters saved records and Clear filters restores all', () => {
  mount('ADMIN', '/staff?locationId=unassigned&source=setup'); expect(row(hire.name)).toBeInTheDocument(); expect(screen.queryByRole('link', { name: worker.name })).not.toBeInTheDocument(); fireEvent.click(screen.getByRole('button', { name: 'Clear filters' })); expect(row()).toBeInTheDocument(); expect(screen.getByLabelText('Current route')).toHaveTextContent('/staff?source=setup');
});
it('URL back and forward update the location filter', () => {
  mount(); fireEvent.click(screen.getByRole('button', { name: 'Set URL scope' })); expect(screen.queryByRole('link', { name: worker.name })).not.toBeInTheDocument(); fireEvent.click(screen.getByRole('button', { name: 'History back' })); expect(row()).toBeInTheDocument();
});
it('no-match retains the directory and clear action', () => {
  mount(); fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'missing' } }); expect(screen.getByText('No team members match these filters.')).toBeInTheDocument(); fireEvent.click(screen.getByRole('button', { name: 'Clear filters' })); expect(row()).toBeInTheDocument();
});
it.each(['click', 'Enter', ' '])('row navigates by %s', method => {
  mount(); if (method === 'click') fireEvent.click(within(row()).getByText('09:00–17:00')); else fireEvent.keyDown(row(), { key: method }); expect(screen.getByLabelText('Current route')).toHaveTextContent('/staff/7');
});
it('hover prefetches the existing staff detail query', () => { mount(); fireEvent.mouseEnter(row()); expect(m.prefetch).toHaveBeenCalledWith(7); });
it('row menu View details retains its real destination', async () => {
  mount(); const actions = await menu(); expect(actions.getByRole('menuitem', { name: 'View details' })).toHaveAttribute('href', '/staff/7'); expect(screen.getByLabelText('Current route')).toHaveTextContent('/staff');
});
it('row menu Edit opens the real panel without navigating and saves the unchanged API payload', async () => {
  mount(); const actions = await menu(); fireEvent.click(actions.getByRole('menuitem', { name: 'Edit' })); expect(await screen.findByRole('dialog', { name: 'Edit team member' })).toBeInTheDocument(); expect(screen.getByLabelText('Location')).toHaveValue(site.name); expect(screen.getByLabelText('Current route')).toHaveTextContent(/^\/staff$/); fireEvent.change(screen.getByLabelText('Full Name'), { target: { value: 'Edited name' } }); fireEvent.click(screen.getByRole('button', { name: 'Save changes' })); expect(await screen.findByText('Team member changes saved.')).toHaveAttribute('role', 'status'); expect(m.edit).toHaveBeenCalledWith({ id: 7, data: { name: 'Edited name' } });
});
it('row menu Staff access opens the real reason panel without navigating', async () => {
  mount(); fireEvent.click((await menu()).getByRole('menuitem', { name: 'Staff access' })); expect(await screen.findByRole('dialog', { name: 'Staff access' })).toBeInTheDocument(); expect(screen.getByLabelText('Reason')).toBeInTheDocument(); expect(screen.getByLabelText('Current route')).toHaveTextContent(/^\/staff$/); expect(screen.getByRole('button', { name: 'Confirm access change' })).toBeDisabled();
});
it('inactive menu retains details but disables Edit and Staff access', async () => {
  mount(); const actions = await menu(inactive.name); expect(actions.getByRole('menuitem', { name: 'View details' })).toHaveAttribute('href', '/staff/9'); for (const name of ['Edit', 'Staff access']) expect(actions.getByRole('menuitem', { name })).toHaveAttribute('aria-disabled', 'true');
});
it('create deep link opens a side panel with fixed location and cancel preserves scope', () => {
  mount('ADMIN', '/staff?locationId=20&create=1&source=setup'); expect(screen.getByRole('dialog', { name: 'Add team member' })).toBeInTheDocument(); expect(screen.getByRole('combobox', { name: 'Location' })).toHaveValue('20'); fireEvent.click(screen.getByRole('button', { name: 'Cancel' })); expect(screen.getByLabelText('Current route')).toHaveTextContent('/staff?locationId=20&source=setup');
});
it('header opens create without losing URL scope', () => {
  mount('ADMIN', '/staff?source=setup'); fireEvent.click(screen.getByRole('button', { name: 'Add team member' })); expect(screen.getByRole('dialog', { name: 'Add team member' })).toBeInTheDocument(); expect(screen.getByLabelText('Current route')).toHaveTextContent('source=setup&create=1');
});
it('empty state teaches the first hire and opens the same panel', () => {
  m.staff.data = { data: [] }; mount(); expect(screen.getByRole('heading', { name: 'Add your first team member' })).toBeInTheDocument(); fireEvent.click(within(screen.getByRole('heading', { name: 'Add your first team member' }).parentElement!).getByRole('button', { name: 'Add team member' })); expect(screen.getByRole('dialog')).toBeInTheDocument();
});
it('manager keeps assigned-site guidance without owner navigation or unassigned choice', async () => {
  mount('MANAGER'); expect(screen.queryByRole('link', { name: 'Manage managers' })).not.toBeInTheDocument(); expect(screen.getByText('You can manage staff only at your assigned sites. Contact the company owner for manager access changes.')).toBeInTheDocument(); await select('Filter by location', 'All locations'); fireEvent.pointerDown(screen.getByRole('button', { name: 'Filter by location: All locations' }), { button: 0, ctrlKey: false, pointerType: 'mouse' }); expect(screen.queryByRole('menuitemradio', { name: 'Unassigned' })).not.toBeInTheDocument();
});
it('manager access gate still rejects unassigned sources', async () => {
  mount('MANAGER'); const actions = await menu(hire.name); expect(actions.getByRole('menuitem', { name: 'Staff access' })).toHaveAttribute('aria-disabled', 'true');
});
it('owner retains manager, attendance and safe offboarding navigation', () => {
  mount(); expect(screen.getByRole('link', { name: 'Manage managers' })).toHaveAttribute('href', '/managers'); expect(screen.getByRole('link', { name: 'Open attendance' })).toHaveAttribute('href', '/attendance'); expect(screen.getByRole('heading', { name: 'Safe offboarding' })).toBeInTheDocument();
});
it('initial loading shows announced skeletons without zero totals', () => {
  m.staff = { isLoading: true }; mount(); expect(screen.getAllByRole('status').some(node => node.getAttribute('aria-busy') === 'true')).toBe(true); expect(screen.queryByText('Active staff')).not.toBeInTheDocument(); expect(screen.getByRole('button', { name: 'Add team member' })).toBeDisabled();
});
it('initial failure offers working Retry and saved-record reassurance', () => {
  m.staff = { isError: true, error: new Error('private error'), refetch: vi.fn() }; mount(); expect(screen.getByRole('alert')).toHaveTextContent('Your saved records have not changed.'); expect(screen.queryByText('private error')).not.toBeInTheDocument(); fireEvent.click(screen.getByRole('button', { name: 'Retry' })); expect(m.staff.refetch).toHaveBeenCalledOnce(); expect(m.locations.refetch).toHaveBeenCalledOnce();
});
it('cached refresh failure retains search, rows and focus', () => {
  const view = mount(); const input = screen.getByRole('searchbox'); fireEvent.change(input, { target: { value: 'Saved' } }); input.focus(); m.staff.isError = true; m.staff.error = new Error('offline'); view.refresh(); expect(row()).toBeInTheDocument(); expect(screen.getByRole('searchbox')).toHaveValue('Saved'); expect(screen.getByRole('searchbox')).toHaveFocus(); expect(screen.getByRole('alert')).toBeInTheDocument();
});
it('cached refresh failure retains an open Staff access draft', async () => {
  const view = mount(); fireEvent.click((await menu()).getByRole('menuitem', { name: 'Staff access' })); fireEvent.change(await screen.findByLabelText('Reason'), { target: { value: 'Saved draft' } }); m.staff.isError = true; m.staff.error = new Error('offline'); view.refresh(); expect(screen.getByLabelText('Reason')).toHaveValue('Saved draft');
});
it.each(['staff', 'locations'] as const)('denied cached %s hides private rows and panels', async source => {
  const view = mount(); fireEvent.click((await menu()).getByRole('menuitem', { name: 'Staff access' })); await screen.findByRole('dialog'); m[source].isError = true; m[source].error = { response: { status: 403 } }; view.refresh(); expect(screen.queryByRole('dialog')).not.toBeInTheDocument(); expect(screen.queryByRole('link', { name: worker.name })).not.toBeInTheDocument(); expect(screen.getByRole('alert')).toBeInTheDocument();
});
it('pagination and name sorting keep all saved records reachable', () => {
  m.staff.data = { data: Array.from({ length: 21 }, (_, index) => ({ ...worker, id: index + 1, name: `Worker ${index + 1}` })) }; mount(); expect(screen.getAllByRole('row')).toHaveLength(21); fireEvent.click(screen.getByRole('button', { name: 'Next' })); expect(screen.getByRole('link', { name: 'Worker 21' })).toBeInTheDocument(); fireEvent.click(screen.getByRole('button', { name: 'Team member' })); expect(screen.getByRole('link', { name: 'Worker 1' })).toBeInTheDocument(); expect(screen.getByRole('columnheader', { name: 'Team member' })).toHaveAttribute('aria-sort', 'ascending');
});
it('Urdu mirrors the page and retains saved record names and contact data', () => {
  mount('ADMIN', '/staff', 'ur'); expect(document.documentElement.dir).toBe('rtl'); expect(screen.getByRole('searchbox', { name: 'ٹیم تلاش کریں' })).toBeInTheDocument(); expect(row()).toHaveTextContent(worker.name); expect(row()).toHaveTextContent(worker.email); expect(screen.getByText('بغیر مقام کے نئے کارکن', { selector: 'dt' })).toBeInTheDocument();
});
it('principal changes remove an open access draft', async () => {
  const view = mount(); fireEvent.click((await menu()).getByRole('menuitem', { name: 'Staff access' })); fireEvent.change(await screen.findByLabelText('Reason'), { target: { value: 'Prior principal' } }); act(() => view.store.dispatch(setUser({ id: 88, companyId: 99, role: 'ADMIN', name: 'Other owner', email: 'other@example.invalid' }))); expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});
