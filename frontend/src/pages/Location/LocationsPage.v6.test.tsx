import { configureStore } from '@reduxjs/toolkit';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { Provider } from 'react-redux';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { beforeEach, expect, it, vi } from 'vitest';
import authReducer, { setUser, type AuthUser } from '@/store/slices/authSlice';
import { LanguageProvider } from '@/i18n/LanguageProvider';
import LocationsPage from './LocationsPage';
const mocks = vi.hoisted(() => ({ locations: {} as Record<string, unknown>, operations: {} as Record<string, unknown>, get: vi.fn(), overview: vi.fn() }));
vi.mock('./queries', () => ({ useGetLocations: (all: boolean) => { mocks.get(all); return mocks.locations; } }));
vi.mock('../Manager/operations', () => ({ useOperations: (kind: string, scope: unknown) => { mocks.overview(kind, scope); return mocks.operations; } }));
vi.mock('./LocationFormDialog', () => ({ default: ({ open, onOpenChange, onSaved }: { open: boolean; onOpenChange(open: boolean): void; onSaved(): void }) => open ? <div role="dialog" aria-label="Location form boundary"><button onClick={() => onOpenChange(false)}>Cancel form</button><button onClick={onSaved}>Saved location</button></div> : null }));
const site = { id: 20, name: 'Persisted site', address: 'Synthetic street', timezone: 'Asia/Karachi', radiusMeters: 150, latitude: '31.5', longitude: '74.3', isActive: true, status: 'ACTIVE', _count: { staff: 2, taskTemplates: 3 } };
const archived = { ...site, id: 21, name: 'Archived fixture', address: 'Historic avenue', isActive: false, _count: { staff: 1, taskTemplates: 2 } };
const comparison = [{ location: site, present: 4, scheduled: 6, tasks: 11, submitted: 3, reviews: 2 }];
function Path() { const loc = useLocation(); return <output aria-label="Current route">{loc.pathname + loc.search}</output>; }
function mount(role: AuthUser['role'] = 'ADMIN', path = '/locations', language = 'en') {
  localStorage.setItem('hygene-ops.language', language);
  const store = configureStore({ reducer: { auth: authReducer } });
  store.dispatch(setUser({ id: 2, companyId: 42, role, name: 'Fixture owner', email: 'owner@example.invalid' }));
  const query = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const tree = () => <Provider store={store}><QueryClientProvider client={query}><LanguageProvider><MemoryRouter initialEntries={[path]}><div className="workspace"><LocationsPage /><Path /></div></MemoryRouter></LanguageProvider></QueryClientProvider></Provider>;
  const view = render(tree());
  return { ...view, refresh: () => view.rerender(tree()) };
}
async function select(label: string, value: string) {
  fireEvent.pointerDown(screen.getByRole('button', { name: new RegExp('^' + label + ':') }), { button: 0, ctrlKey: false, pointerType: 'mouse' });
  fireEvent.click(await screen.findByRole('menuitemradio', { name: value }));
}
const cards = () => within(screen.getByRole('list', { name: 'Location register' }));
beforeEach(() => {
  vi.clearAllMocks(); localStorage.clear();
  mocks.locations = { isPending: false, isError: false, data: { data: [site, archived] }, refetch: vi.fn() };
  mocks.operations = { isPending: false, isError: false, data: { comparison }, refetch: vi.fn() };
});
it('reads all saved locations and the existing today overview', () => {
  mount(); expect(mocks.get).toHaveBeenCalledWith(true); expect(mocks.overview).toHaveBeenCalledWith('overview', { date: 'today' });
});
it('cards show actual staff, submission, review, address and active state', () => {
  mount(); const card = screen.getByRole('link', { name: site.name });
  expect(card).toHaveAttribute('href', '/locations/20'); expect(card).toHaveTextContent(site.address);
  expect(card).toHaveTextContent('Staff present4 of 6'); expect(card).toHaveTextContent('Submitted / due3 of 11'); expect(card).toHaveTextContent('Waiting for review2'); expect(card).toHaveTextContent('Active');
  expect(screen.queryByText('Commercial office')).not.toBeInTheDocument(); expect(document.querySelectorAll('img')).toHaveLength(0);
});
it('summary uses active count and all assigned staff and schedules', () => {
  mount(); expect(screen.getByText('Assigned staff').parentElement).toHaveTextContent('3'); expect(screen.getByText('Cleaning schedules').parentElement).toHaveTextContent('5'); expect(screen.getByText('Active locations', { selector: 'dt' }).parentElement).toHaveTextContent('1');
});
it('search matches names without case sensitivity', () => {
  mount(); fireEvent.change(screen.getByRole('searchbox', { name: 'Search locations' }), { target: { value: 'PERSISTED' } }); expect(cards().getByRole('link', { name: site.name })).toBeInTheDocument();
});
it('search matches saved addresses and exposes a no-match state', () => {
  mount(); const input = screen.getByRole('searchbox'); fireEvent.change(input, { target: { value: 'synthetic street' } }); expect(cards().getByRole('link', { name: site.name })).toBeInTheDocument();
  fireEvent.change(input, { target: { value: 'not present' } }); expect(screen.getByText('No locations match these filters.')).toBeInTheDocument(); expect(screen.queryByRole('list')).not.toBeInTheDocument();
});
it('inactive status replaces active cards and retains saved inactive status', async () => {
  mount(); await select('Location status', 'Inactive locations'); expect(screen.queryByRole('link', { name: site.name })).not.toBeInTheDocument(); expect(screen.getByRole('link', { name: archived.name })).toHaveTextContent('Inactive');
});
it('all status shows both active and inactive locations', async () => {
  mount(); await select('Location status', 'All locations'); expect(cards().getAllByRole('link')).toHaveLength(2);
});
it('search and status compose and Clear filters restores defaults', async () => {
  mount(); await select('Location status', 'Inactive locations'); fireEvent.change(screen.getByRole('searchbox'), { target: { value: site.name } });
  fireEvent.click(screen.getByRole('button', { name: 'Clear filters' })); expect(screen.getByRole('searchbox')).toHaveValue(''); expect(screen.getByRole('button', { name: 'Location status: Active locations' })).toBeInTheDocument(); expect(screen.getByRole('link', { name: site.name })).toBeInTheDocument();
});
it('search clear retains the current status', async () => {
  mount(); await select('Location status', 'Inactive locations'); fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'Archived' } }); fireEvent.click(screen.getByRole('button', { name: 'Clear search' })); expect(screen.getByRole('button', { name: 'Location status: Inactive locations' })).toBeInTheDocument();
});
it('create deep link opens the unchanged form boundary', () => {
  mount('ADMIN', '/locations?create=1&from=setup'); expect(screen.getByRole('dialog', { name: 'Location form boundary' })).toBeInTheDocument(); fireEvent.click(screen.getByRole('button', { name: 'Cancel form' })); expect(screen.queryByRole('dialog')).not.toBeInTheDocument(); expect(screen.getByLabelText('Current route')).toHaveTextContent('/locations?from=setup');
});
it('both header action and final tile open the form', () => {
  mount(); const buttons = screen.getAllByRole('button', { name: 'Add location' }); expect(buttons).toHaveLength(2);
  for (const button of buttons) { fireEvent.click(button); expect(screen.getByRole('dialog')).toBeInTheDocument(); fireEvent.click(screen.getByRole('button', { name: 'Cancel form' })); }
});
it('successful form handoff closes create and announces the saved next step', () => {
  mount('ADMIN', '/locations?create=1&source=setup'); fireEvent.click(screen.getByRole('button', { name: 'Saved location' })); expect(screen.queryByRole('dialog')).not.toBeInTheDocument(); expect(screen.getByText('Location created. Add areas and assign your team to get started.')).toHaveAttribute('role', 'status'); expect(screen.getByLabelText('Current route')).toHaveTextContent('source=setup');
});
it('manager has cards but no form, tile or owner add action', () => {
  mount('MANAGER', '/locations?create=1'); expect(screen.queryByRole('dialog')).not.toBeInTheDocument(); expect(screen.queryByRole('button', { name: 'Add location' })).not.toBeInTheDocument(); expect(screen.getByRole('link', { name: site.name })).toBeInTheDocument();
});
it('empty owner state teaches the first location and opens the form', () => {
  mocks.locations.data = { data: [] }; mount(); expect(screen.getByRole('heading', { name: 'Add your first location' })).toBeInTheDocument(); expect(screen.getByText(/A location holds its check-in boundary/)).toBeInTheDocument(); fireEvent.click(within(screen.getByRole('heading', { name: 'Add your first location' }).parentElement!).getByRole('button', { name: 'Add location' })); expect(screen.getByRole('dialog')).toBeInTheDocument();
});
it('empty manager state explains assignment without adding', () => {
  mocks.locations.data = { data: [] }; mount('MANAGER'); expect(screen.getByText('No locations assigned to you yet. Contact your admin.')).toBeInTheDocument(); expect(screen.queryByRole('button', { name: 'Add location' })).not.toBeInTheDocument();
});
it('totals failure shows unknown figures and a working Retry', () => {
  mocks.operations = { isError: true, error: new Error('private error'), refetch: vi.fn() }; mount(); expect(screen.getByRole('alert')).toHaveTextContent('Today’s attendance and task totals are unavailable.'); expect(screen.getAllByLabelText('Information unavailable')).toHaveLength(3); expect(screen.queryByText('private error')).not.toBeInTheDocument(); fireEvent.click(screen.getByRole('button', { name: 'Retry' })); expect(mocks.operations.refetch).toHaveBeenCalledTimes(1);
});
it('failed cached totals are unknown rather than stale all-clear figures', () => {
  mocks.operations.isError = true; mount(); expect(screen.getAllByLabelText('Information unavailable')).toHaveLength(3); expect(screen.queryByText('No open reviews')).not.toBeInTheDocument();
});
it('pending totals do not replace real cards with a page loader', () => {
  mocks.operations = { isPending: true }; mount(); expect(screen.getByText('Checking today’s work…')).toHaveAttribute('role', 'status'); expect(screen.getByRole('link', { name: site.name })).toBeInTheDocument(); expect(screen.getAllByLabelText('Information unavailable')).toHaveLength(3);
});
it('zero recorded totals remain true zeros', () => {
  mocks.operations.data = { comparison: [{ ...comparison[0], present: 0, scheduled: 0, submitted: 0, tasks: 0, reviews: 0 }] }; mount(); expect(screen.getByRole('link', { name: site.name })).toHaveTextContent('Staff present0 of 0Submitted / due0 of 0Waiting for review0');
});
it('a missing comparison row stays unknown', async () => {
  mount(); await select('Location status', 'Inactive locations'); expect(screen.getAllByLabelText('Information unavailable')).toHaveLength(3);
});
it('initial locations loading is an announced skeleton, not an empty state', () => {
  mocks.locations = { isPending: true }; mount(); expect(screen.getAllByRole('status').some(node => node.getAttribute('aria-busy') === 'true')).toBe(true); expect(screen.queryByRole('heading', { name: 'Add your first location' })).not.toBeInTheDocument();
});
it('initial locations failure offers Retry and saved-record reassurance', () => {
  mocks.locations = { isError: true, error: new Error('private error'), refetch: vi.fn() }; mount(); expect(screen.getByRole('alert')).toHaveTextContent('Your saved records have not changed.'); fireEvent.click(screen.getByRole('button', { name: 'Retry' })); expect(mocks.locations.refetch).toHaveBeenCalledTimes(1); expect(screen.queryByRole('list')).not.toBeInTheDocument();
});
it('background location failure retains cached cards, search and focus', () => {
  const view = mount(); const input = screen.getByRole('searchbox'); fireEvent.change(input, { target: { value: 'Persisted' } }); input.focus(); mocks.locations.isError = true; mocks.locations.error = new Error('offline'); view.refresh(); expect(screen.getByRole('link', { name: site.name })).toBeInTheDocument(); expect(screen.getByRole('searchbox')).toHaveValue('Persisted'); expect(screen.getByRole('searchbox')).toHaveFocus(); expect(screen.getByRole('alert')).toBeInTheDocument();
});
it('denied reads hide cached private cards', () => {
  mocks.locations.isError = true; mocks.locations.error = { response: { status: 403 } }; mount(); expect(screen.getByRole('alert')).toHaveTextContent('You do not have access'); expect(screen.queryByRole('link', { name: site.name })).not.toBeInTheDocument();
});
it('sorting preserves ascending and descending numeric values', async () => {
  mocks.locations.data = { data: [site, { ...site, id: 22, name: 'Other persisted site' }] }; mocks.operations.data = { comparison: [...comparison, { ...comparison[0], location: { ...site, id: 22 }, submitted: 10 }] }; mount(); await select('Sort by', 'Submitted / due'); expect(cards().getAllByRole('link')[0]).toHaveAccessibleName(site.name); fireEvent.click(screen.getByRole('button', { name: 'Sort descending' })); expect(cards().getAllByRole('link')[0]).toHaveAccessibleName('Other persisted site');
});
it('pagination retains every location and returns to the first page on search', () => {
  mocks.locations.data = { data: Array.from({ length: 21 }, (_, i) => ({ ...site, id: i + 1, name: 'Saved site ' + (i + 1) })) }; mount(); expect(cards().getAllByRole('link')).toHaveLength(20); fireEvent.click(screen.getByRole('button', { name: 'Next' })); expect(cards().getAllByRole('link')).toHaveLength(1); expect(screen.getByRole('link', { name: 'Saved site 21' })).toBeInTheDocument(); fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'Saved site 1' } }); expect(screen.getByRole('link', { name: 'Saved site 1' })).toBeInTheDocument();
});
it('Urdu translates figures and controls while preserving saved names and addresses', () => {
  mount('ADMIN', '/locations', 'ur'); expect(document.documentElement.dir).toBe('rtl'); expect(screen.getByRole('link', { name: site.name })).toHaveTextContent(site.address); expect(screen.getByText('جمع شدہ / مقررہ')).toBeInTheDocument(); expect(screen.getByRole('searchbox', { name: 'مقامات تلاش کریں' })).toBeInTheDocument();
});
