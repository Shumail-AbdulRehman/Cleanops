import { configureStore } from '@reduxjs/toolkit';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { Provider } from 'react-redux';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { beforeEach, expect, it, vi } from 'vitest';
import authReducer, { setUser, type AuthUser } from '@/store/slices/authSlice';
import { LanguageProvider } from '@/i18n/LanguageProvider';
import LocationDetailPage from './LocationDetailPage';

const mocks = vi.hoisted(() => ({
  detail: {} as Record<string, unknown>, operations: {} as Record<string, unknown>, areas: {} as Record<string, unknown>,
  read: vi.fn(), overview: vi.fn(), remove: vi.fn(),
}));
vi.mock('./queries', () => ({ useGetLocationById: (id: string, filter: unknown) => { mocks.read(id, filter); return mocks.detail; }, useDeleteLocation: () => ({ mutateAsync: mocks.remove }) }));
vi.mock('../Manager/operations', async original => ({ ...await original<typeof import('../Manager/operations')>(), useOperations: (...args: unknown[]) => { mocks.overview(...args); return mocks.operations; } }));
vi.mock('../Area/queries', () => ({ useAreas: () => mocks.areas }));
vi.mock('./LocationFormDialog', () => ({ default: ({ open, onOpenChange, onSaved, location }: { open: boolean; onOpenChange(value: boolean): void; onSaved(): void; location: { name: string } }) => open ? <div role="dialog" aria-label="Location editor"><p>{location.name}</p><button onClick={() => onOpenChange(false)}>Cancel editor</button><button onClick={onSaved}>Save editor</button></div> : null }));
vi.mock('../Staff/StaffCreateDialog', () => ({ default: ({ open, onSaved }: { open: boolean; onSaved(): void }) => open ? <div role="dialog" aria-label="Staff editor"><button onClick={onSaved}>Save staff</button></div> : null }));
vi.mock('./StaffImportDialog', () => ({ default: () => <button>Import boundary</button> }));
vi.mock('../Area/LocationAreasTab', () => ({ default: () => <p>Area editing boundary</p> }));
vi.mock('./components/LocationTemplatesTab', () => ({ default: () => <p>Schedule editing boundary</p> }));
vi.mock('./components/LocationScheduleTab', () => ({ default: () => <p>Week schedule boundary</p> }));
vi.mock('../Task/components/TaskQr', () => ({ default: ({ taskId }: { taskId: number }) => <p>QR boundary {taskId}</p> }));
vi.mock('../Task/components/AreaSubmissionsPanel', () => ({ default: ({ taskInstanceId }: { taskInstanceId: number }) => <p>Area submissions {taskInstanceId}</p> }));
const staff = { id: 7, name: 'Saved worker', email: 'worker@example.invalid', isActive: true, shiftStart: '2026-11-11T03:00:00Z', shiftEnd: '2026-11-11T11:00:00Z' };
const task = { id: 91, staffId: 7, title: 'Saved task', date: '2026-11-11T00:00:00Z', shiftStart: '2026-11-11T03:00:00Z', shiftEnd: '2026-11-11T11:00:00Z', status: 'IN_PROGRESS', verificationVersion: 2, verificationState: 'AWAITING_SUBMISSION', staffSubmittedAt: null };
const site = { id: 20, name: 'Persisted site', address: 'Synthetic street', timezone: 'Asia/Karachi', radiusMeters: 150, latitude: '31.5', longitude: '74.3', isActive: true, staff: [staff], taskTemplates: [], taskInstances: [task, { ...task, id: 92, title: 'Other saved task' }] };
const facts = { metrics: { present: 4, scheduled: 6, totalTasks: 11, submitted: 3, reviewCount: 2, verified: 1, accepted: 0 }, chart: { submitted: 3, inProgress: 2, notStarted: 4, overdue: 2 }, attention: [], comparison: [], locations: [], selected: [], days: [], asOf: '2026-11-11T06:00:00Z', date: 'today', tasks: [] };
function Path() { const loc = useLocation(); return <output aria-label="Current route">{loc.pathname + loc.search}</output>; }
function mount(path = '/locations/20', role: AuthUser['role'] = 'ADMIN', language = 'en') {
  localStorage.setItem('hygene-ops.language', language);
  const store = configureStore({ reducer: { auth: authReducer } });
  store.dispatch(setUser({ id: 2, companyId: 42, role, name: 'Fixture owner', email: 'owner@example.invalid' }));
  const query = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const tree = () => <Provider store={store}><QueryClientProvider client={query}><LanguageProvider><MemoryRouter initialEntries={[path]}><div className="workspace"><Routes><Route path="/locations/:id" element={<LocationDetailPage />} /><Route path="/locations" element={<p>Location register boundary</p>} /></Routes><Path /></div></MemoryRouter></LanguageProvider></QueryClientProvider></Provider>;
  const view = render(tree());
  return { ...view, refresh: () => view.rerender(tree()) };
}
const currentRoute = () => screen.getByLabelText('Current route');
beforeEach(() => {
  vi.clearAllMocks(); localStorage.clear(); HTMLElement.prototype.scrollIntoView = vi.fn();
  mocks.detail = { isLoading: false, isFetching: false, isError: false, data: { data: { locationInfo: site, taskStats: [{ status: 'IN_PROGRESS', _count: { status: 2 } }] } }, refetch: vi.fn() };
  mocks.operations = { isPending: false, isError: false, data: facts, refetch: vi.fn() };
  mocks.areas = { isPending: false, isError: false, data: [{ id: 1, status: 'ACTIVE' }, { id: 2, status: 'ARCHIVED' }], refetch: vi.fn() };
  mocks.remove.mockResolvedValue({});
});
it('header uses saved name, address, timezone, radius and actual active status', () => {
  mount(); expect(screen.getByRole('heading', { level: 1, name: site.name })).toBeInTheDocument();
  const header = screen.getByRole('heading', { level: 1 }).closest('header')!;
  expect(header).toHaveTextContent(site.address); expect(header).toHaveTextContent(site.timezone); expect(header).toHaveTextContent('Check-in radius 150 m'); expect(header).toHaveTextContent('Active');
  expect(screen.queryByText('Healthcare')).not.toBeInTheDocument(); expect(document.querySelectorAll('img')).toHaveLength(0);
});
it.each([['Overview', 'overview'], ['Area template', 'areas'], ['Cleaning schedule', 'templates'], ['Staff and shifts', 'staff'], ['Task history', 'instances'], ['Weekly schedule', 'schedule']])('the %s tab writes its existing URL value', (label, value) => {
  mount('/locations/20?tab=staff&source=setup'); fireEvent.mouseDown(screen.getByRole('tab', { name: label }), { button: 0, ctrlKey: false });
  expect(currentRoute()).toHaveTextContent('source=setup'); expect(currentRoute()).toHaveTextContent('tab=' + value); expect(screen.getByRole('tab', { name: label })).toHaveAttribute('aria-selected', 'true');
  expect(screen.getByRole('tabpanel', { name: label })).toBeInTheDocument();
});
it('taskId deep link selects Task history and only its task without needing a tab', async () => {
  mount('/locations/20?taskId=91&source=review'); expect(screen.getByRole('tab', { name: 'Task history' })).toHaveAttribute('aria-selected', 'true');
  expect(screen.getAllByText('Saved task').length).toBeGreaterThan(0); expect(screen.queryByText('Other saved task')).not.toBeInTheDocument();
  await waitFor(() => expect(screen.getByRole('region', { name: 'Task history' })).toHaveFocus());
});
it('explicit tab stays authoritative while taskId survives tab switches', () => {
  mount('/locations/20?tab=instances&taskId=91&source=review'); fireEvent.mouseDown(screen.getByRole('tab', { name: 'Overview' }), { button: 0 });
  expect(currentRoute()).toHaveTextContent('taskId=91'); expect(screen.getByRole('tab', { name: 'Overview' })).toHaveAttribute('aria-selected', 'true');
});
it('Show all tasks clears only taskId and retains tab and source', () => {
  mount('/locations/20?tab=instances&taskId=91&source=review'); fireEvent.click(screen.getByRole('button', { name: 'Show all tasks' }));
  expect(currentRoute()).not.toHaveTextContent('taskId'); expect(currentRoute()).toHaveTextContent('tab=instances'); expect(currentRoute()).toHaveTextContent('source=review'); expect(screen.getAllByText('Other saved task').length).toBeGreaterThan(0);
});
it('unavailable task keeps its explanatory empty state and show-all recovery', () => {
  mount('/locations/20?tab=instances&taskId=999'); expect(screen.getByText('This task is not available for this location and period.')).toBeInTheDocument(); expect(screen.getByRole('button', { name: 'Show all tasks' })).toBeInTheDocument();
});
it('Edit opens the form with saved location and a successful save announces the result', () => {
  mount(); fireEvent.click(screen.getByRole('button', { name: 'Edit location' })); expect(screen.getByRole('dialog', { name: 'Location editor' })).toHaveTextContent(site.name);
  fireEvent.click(screen.getByRole('button', { name: 'Save editor' })); expect(screen.queryByRole('dialog')).not.toBeInTheDocument(); expect(screen.getByText('Location updated.')).toHaveAttribute('role', 'status');
});
it('delete is secondary, asks confirmation and cancel never mutates', () => {
  mount(); expect(screen.queryByRole('button', { name: 'Delete ' + site.name })).not.toBeInTheDocument(); fireEvent.click(screen.getByRole('button', { name: 'Location settings' }));
  expect(screen.getByRole('region', { name: 'Location settings' })).toHaveTextContent('31.500000, 74.300000'); fireEvent.click(screen.getByRole('button', { name: 'Delete ' + site.name }));
  const dialog = screen.getByRole('dialog', { name: 'Delete Persisted site?' }); expect(dialog).toHaveTextContent('Staff accounts will stay, with their location and shift cleared.'); expect(mocks.remove).not.toHaveBeenCalled();
  fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' })); expect(screen.queryByRole('dialog')).not.toBeInTheDocument(); expect(mocks.remove).not.toHaveBeenCalled();
});
it('confirmed delete uses the existing mutation and returns to locations', async () => {
  mount(); fireEvent.click(screen.getByRole('button', { name: 'Location settings' })); fireEvent.click(screen.getByRole('button', { name: 'Delete ' + site.name })); fireEvent.click(screen.getByRole('button', { name: 'Delete permanently' }));
  expect(await screen.findByText('Location register boundary')).toBeInTheDocument(); expect(mocks.remove).toHaveBeenCalledExactlyOnceWith(20);
});
it('managers can read settings but never see owner editing or deletion', () => {
  mount('/locations/20', 'MANAGER'); expect(screen.queryByRole('button', { name: 'Edit location' })).not.toBeInTheDocument(); fireEvent.click(screen.getByRole('button', { name: 'Location settings' })); expect(screen.getByRole('region', { name: 'Location settings' })).toBeInTheDocument(); expect(screen.queryByRole('button', { name: /^Delete/ })).not.toBeInTheDocument();
});
it.each([undefined, { data: { locationInfo: null } }])('missing data shows not-found and Return to locations', data => {
  mocks.detail.data = data; mount(); expect(screen.getByRole('heading', { name: 'Location not found' })).toBeInTheDocument(); expect(screen.getByRole('link', { name: 'Return to locations' })).toHaveAttribute('href', '/locations'); expect(screen.queryByRole('tablist')).not.toBeInTheDocument();
});
it('404 is a not-found state even with cached data', () => {
  mocks.detail.isError = true; mocks.detail.error = { response: { status: 404 } }; mount(); expect(screen.getByRole('heading', { name: 'Location not found' })).toBeInTheDocument(); expect(screen.queryByText(site.address)).not.toBeInTheDocument();
});
it('initial failure offers Retry, saved-record reassurance and Return to locations', () => {
  mocks.detail = { isError: true, error: new Error('private failure'), refetch: vi.fn() }; mount(); expect(screen.getByRole('alert')).toHaveTextContent('Your saved records have not changed.'); fireEvent.click(screen.getByRole('button', { name: 'Retry' })); expect(mocks.detail.refetch).toHaveBeenCalledOnce(); expect(screen.getByRole('link', { name: 'Return to locations' })).toBeInTheDocument(); expect(screen.queryByText('private failure')).not.toBeInTheDocument();
});
it('initial detail loading announces a skeleton and never invents a not-found state', () => {
  mocks.detail = { isLoading: true }; mount(); expect(screen.getByRole('status', { name: 'Loading…' })).toHaveAttribute('aria-busy', 'true'); expect(screen.queryByText('Location not found')).not.toBeInTheDocument();
});
it('background detail failure preserves mounted tabs and focus', () => {
  const view = mount(); const settings = screen.getByRole('button', { name: 'Location settings' }); settings.focus(); mocks.detail.isError = true; mocks.detail.error = new Error('offline'); view.refresh(); expect(screen.getByRole('heading', { level: 1, name: site.name })).toBeInTheDocument(); expect(settings).toHaveFocus(); expect(screen.getByRole('tab', { name: 'Overview' })).toHaveAttribute('aria-selected', 'true');
});
it('a denied background detail read hides private cached records', () => {
  mocks.detail.isError = true; mocks.detail.error = { response: { status: 403 } }; mount(); expect(screen.getByRole('alert')).toHaveTextContent('You do not have access'); expect(screen.queryByText(site.name)).not.toBeInTheDocument(); expect(screen.queryByRole('tablist')).not.toBeInTheDocument();
});
it('overview keeps separate present/scheduled, submitted/total and waiting-review figures', () => {
  mount(); const summary = screen.getByRole('region', { name: 'Daily summary' }); expect(summary).toHaveTextContent('Staff today4 of 6'); expect(summary).toHaveTextContent('Tasks submitted3 of 11'); expect(summary).toHaveTextContent('Waiting for a decision2'); expect(summary).toHaveTextContent('Submission is not verification'); expect(within(summary).getByRole('img', { name: '3 of 11 tasks done' })).toBeInTheDocument();
});
it('summary links preserve the real location and site-local today scope', () => {
  mount(); expect(screen.getByRole('link', { name: /Staff today/ })).toHaveAttribute('href', '/today-status?locationId=20&date=today&tab=staff'); expect(screen.getByRole('link', { name: /Tasks submitted/ })).toHaveAttribute('href', '/today-status?locationId=20&date=today&tab=tasks'); expect(screen.getByRole('link', { name: /Waiting for a decision/ })).toHaveAttribute('href', '/exceptions?locationId=20&date=today&queue=needs-me&period=today');
});
it('location facts retain shift times, area count and working tab actions', () => {
  mount(); expect(screen.getByRole('region', { name: 'Location details' })).toHaveTextContent('08:00–16:00'); expect(screen.getByRole('button', { name: /Area templates/ })).toHaveTextContent('1'); fireEvent.click(screen.getByRole('button', { name: 'Open team and shifts' })); expect(currentRoute()).toHaveTextContent('tab=staff'); expect(screen.getAllByRole('link', { name: 'View worker' })[0]).toHaveAttribute('href', '/staff/7');
});
it('area failure keeps an unknown count, navigation and its independent Retry', () => {
  mocks.areas = { isError: true, error: new Error('offline'), refetch: vi.fn() }; mount(); expect(screen.getByRole('button', { name: /Area templates/ })).toHaveTextContent('—'); fireEvent.click(screen.getByRole('button', { name: 'Retry' })); expect(mocks.areas.refetch).toHaveBeenCalledOnce(); fireEvent.click(screen.getByRole('button', { name: /Area templates/ })); expect(currentRoute()).toHaveTextContent('tab=areas');
});
it('overview loading leaves saved location facts visible without fabricated daily zeros', () => {
  mocks.operations = { isPending: true }; mount(); expect(screen.getByRole('region', { name: 'Location details' })).toHaveTextContent('Asia/Karachi'); expect(screen.getByRole('status', { name: 'Loading…' })).toHaveAttribute('aria-busy', 'true'); expect(screen.queryByRole('region', { name: 'Daily summary' })).not.toBeInTheDocument();
});
it('initial overview failure gives Retry and unknown totals without an all-clear claim', () => {
  mocks.operations = { isError: true, error: new Error('offline'), refetch: vi.fn() }; mount(); expect(screen.getByText('Today’s attendance and task totals are unavailable.')).toBeInTheDocument(); expect(screen.queryByText('No issues right now')).not.toBeInTheDocument(); fireEvent.click(screen.getByRole('button', { name: 'Retry' })); expect(mocks.operations.refetch).toHaveBeenCalledOnce();
});
it('background overview failure preserves saved figures, links and focus', () => {
  const view = mount(); const link = screen.getByRole('link', { name: /Tasks submitted/ }); link.focus(); mocks.operations.isError = true; mocks.operations.error = new Error('offline'); view.refresh(); expect(screen.getByRole('region', { name: 'Daily summary' })).toHaveTextContent('Tasks submitted3 of 11'); expect(link).toHaveFocus(); expect(screen.getByRole('alert')).toBeInTheDocument();
});
it('zero saved figures remain zero with no invented tasks or shifts', () => {
  mocks.detail.data = { data: { locationInfo: { ...site, staff: [], taskInstances: [] } } };
  mocks.operations.data = {
    ...facts,
    metrics: { ...facts.metrics, present: 0, scheduled: 0, submitted: 0, totalTasks: 0, reviewCount: 0, verified: 0 },
    chart: { submitted: 0, inProgress: 0, notStarted: 0, overdue: 0 },
  };
  mount();
  expect(screen.getByRole('region', { name: 'Daily summary' })).toHaveTextContent('Tasks submitted0 of 0');
  expect(screen.getByRole('img', { name: '0 of 0 tasks done' })).toBeInTheDocument();
  expect(screen.getByText('0 in progress · 0 overdue')).toBeInTheDocument();
  expect(screen.getByText('No shift configured')).toBeInTheDocument();
  expect(screen.getByText('No issues right now')).toBeInTheDocument();
});
it('extracted history retains QR gating, area expansion and the photo return URL', () => {
  mount('/locations/20?tab=instances&taskId=91&source=review'); fireEvent.click(screen.getAllByRole('button', { name: 'Task QR' })[0]); expect(screen.getByText('QR boundary 91')).toBeInTheDocument(); fireEvent.click(screen.getAllByRole('button', { name: 'Areas' })[0]); expect(screen.getAllByText('Area submissions 91').length).toBeGreaterThan(0); expect(screen.getAllByRole('link', { name: 'View task photos' })[0]).toHaveAttribute('href', '/verification/91?returnTo=' + encodeURIComponent('/locations/20?tab=instances&taskId=91&source=review'));
});
it('extracted staff keeps add/import actions and the saved acknowledgement', () => {
  mount('/locations/20?tab=staff'); expect(screen.getByRole('button', { name: 'Import boundary' })).toBeInTheDocument(); fireEvent.click(screen.getByRole('button', { name: 'Add staff' })); fireEvent.click(screen.getByRole('button', { name: 'Save staff' })); expect(screen.getByText('Team member added.')).toHaveAttribute('role', 'status');
});
it('Urdu mirrors page direction, translates tabs/facts and preserves saved record names', () => {
  mount('/locations/20', 'ADMIN', 'ur'); expect(document.documentElement.dir).toBe('rtl'); expect(screen.getByRole('heading', { level: 1, name: site.name })).toBeInTheDocument(); expect(screen.getByRole('tab', { name: 'جائزہ' })).toHaveAttribute('aria-selected', 'true'); expect(screen.getByRole('region', { name: 'مقام کی تفصیل' })).toHaveTextContent(site.timezone); expect(screen.getByText(site.address)).toBeInTheDocument(); expect(screen.queryByText('of {total}')).not.toBeInTheDocument();
});
