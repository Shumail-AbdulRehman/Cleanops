import { configureStore } from '@reduxjs/toolkit';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { Provider } from 'react-redux';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { client } from '@/api/client';
import authReducer, { setUser, type AuthUser } from '@/store/slices/authSlice';
import { LanguageProvider } from '@/i18n/LanguageProvider';
import { WorkspaceTheme } from '@/components/common/WorkspaceTheme';
import LocationDetailPage from './LocationDetailPage';
import LocationHistoryTab, { type TaskInstance } from './LocationHistoryTab';
import { locationStatsFilter } from './locationStatsFilter';

const worker = { id: 7, name: 'Saved worker', email: 'worker@example.invalid', isActive: true, shiftStart: '2026-11-11T03:00:00Z', shiftEnd: '2026-11-11T11:00:00Z' };
const task: TaskInstance = { id: 91, staffId: 7, title: 'Saved cleaning', date: '2026-11-11T00:00:00Z', shiftStart: worker.shiftStart, shiftEnd: worker.shiftEnd, status: 'IN_PROGRESS', verificationVersion: 2, verificationState: 'CAPTURING', staffSubmittedAt: null };
const tasks: TaskInstance[] = [task, { ...task, id: 92, title: 'Submitted cleaning', status: 'COMPLETED', staffSubmittedAt: '2026-11-11T07:00:00Z', verificationState: 'NEEDS_REVIEW' }];
let site = makeSite();
function makeSite() { return { id: 20, name: 'Saved site', address: 'Saved street', latitude: '31.5', longitude: '74.3', radiusMeters: 150, timezone: 'Asia/Karachi', isActive: true, staff: [worker], taskTemplates: [], taskInstances: tasks }; }
const calls = vi.fn();
let failure = false;
let loading = false;
let filtered = false;
let responseTasks: TaskInstance[] | null = null;
const originalAdapter = client.defaults.adapter;
function Path() { const location = useLocation(); return <output aria-label="Current route">{location.pathname + location.search}</output>; }
function mount(path = '/locations/20?tab=staff', role: AuthUser['role'] = 'ADMIN', lang = 'en', node = <LocationDetailPage />) {
  localStorage.setItem('hygene-ops.language', lang);
  const store = configureStore({ reducer: { auth: authReducer } });
  store.dispatch(setUser({ id: 2, companyId: 42, role, name: 'Fixture owner', email: 'owner@example.invalid' }));
  const query = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const view = render(<Provider store={store}><QueryClientProvider client={query}><LanguageProvider><WorkspaceTheme.Provider value={true}><MemoryRouter initialEntries={[path]}><div className="workspace"><Routes><Route path="/locations/:id" element={node} /><Route path="/staff/:id" element={<h1>Worker profile boundary</h1>} /></Routes><Path /></div></MemoryRouter></WorkspaceTheme.Provider></LanguageProvider></QueryClientProvider></Provider>);
  return { ...view, query };
}
const staffRegion = () => screen.getByRole('region', { name: 'Staff and shifts' });
const historyRegion = () => screen.getByRole('region', { name: 'Task history' });
async function ready() { await screen.findByRole('heading', { level: 1, name: site.name }); }
beforeEach(() => {
  localStorage.clear(); calls.mockClear(); failure = false; loading = false; filtered = false; responseTasks = null; site = makeSite();
  HTMLElement.prototype.scrollIntoView = vi.fn();
  client.defaults.adapter = async config => {
    calls(config.url, config.params, config.method);
    let data: unknown;
    if (config.url === '/location/20/stats') {
      if (loading) return new Promise(() => {});
      if (failure) throw new Error('Synthetic failure');
      const params = config.params ?? {};
      let entries = responseTasks ?? site.taskInstances;
      const today = locationStatsFilter('today', site.timezone);
      if (filtered) entries = params.days ? [{ ...task, title: 'Week result' }] : params.dateFrom ? [{ ...task, title: params.dateFrom === (today && today.type === 'range' ? today.dateFrom : null) ? 'Today result' : 'Yesterday result' }] : tasks;
      data = { locationInfo: { ...site, taskInstances: entries }, taskStats: [{ status: 'IN_PROGRESS', _count: { status: 1 } }] };
    } else if (config.url === '/manager/operations/overview') data = { locations: [], selected: [], days: [], metrics: {}, chart: {}, attention: [], tasks: [], comparison: [] };
    else if (config.url === '/task-instance/91/qr') data = { taskId: 91, title: task.title, areaName: 'Saved area', shiftStart: task.shiftStart, shiftEnd: task.shiftEnd, timezone: site.timezone, payload: 'synthetic-qr-payload' };
    else if (config.url === '/task-instance/91/area-submissions') data = [];
    else throw new Error('Unexpected request ' + config.url);
    return { data: { data }, status: 200, statusText: 'OK', headers: {}, config };
  };
});
afterEach(() => { client.defaults.adapter = originalAdapter; });
it('staff rows preserve email, local shift, active status and worker destination', async () => {
  mount(); await ready(); const row = within(staffRegion()).getByRole('row', { name: /Saved worker/ });
  expect(row).toHaveTextContent(worker.email); expect(row).toHaveTextContent('08:00 – 16:00'); expect(row).toHaveTextContent('Active');
  expect(within(row).getByRole('link', { name: 'View worker' })).toHaveAttribute('href', '/staff/7');
  fireEvent.click(within(row).getByRole('link', { name: 'View worker' })); expect(await screen.findByRole('heading', { name: 'Worker profile boundary' })).toBeInTheDocument();
});
it('missing phone and attendance are explicit, with a location-scoped daily attendance link', async () => {
  mount(); await ready(); const region = staffRegion(); expect(within(region).getByText('Phone:')).toBeInTheDocument();
  expect(within(region).getByRole('columnheader', { name: 'Today' })).toBeInTheDocument(); expect(within(region).getAllByText('Not available')).toHaveLength(1);
  expect(within(region).getByRole('link', { name: 'View attendance' })).toHaveAttribute('href', '/today-status?locationId=20&date=today&tab=staff');
  expect(within(region).queryByText('On time')).not.toBeInTheDocument();
});
it.each(['ADMIN', 'MANAGER'] as const)('%s Add staff opens the real panel and closes without changing the URL', async role => {
  mount('/locations/20?tab=staff&source=setup', role); await ready(); fireEvent.click(screen.getByRole('button', { name: 'Add staff' }));
  const dialog = await screen.findByRole('dialog', { name: 'Add team member' }); expect(within(dialog).getByLabelText('Full Name')).toBeInTheDocument(); expect(within(dialog).getByLabelText('Location')).toHaveValue('20');
  fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' })); expect(screen.queryByRole('dialog')).not.toBeInTheDocument(); expect(screen.getByLabelText('Current route')).toHaveTextContent('tab=staff&source=setup');
});
it('Import staff opens the real import panel for this location without fetching a spreadsheet', async () => {
  mount(); await ready(); fireEvent.click(screen.getByRole('button', { name: 'Import Staff' })); const dialog = await screen.findByRole('dialog', { name: 'Import Staff' });
  expect(dialog).toHaveTextContent(site.name); expect(within(dialog).getByRole('button', { name: 'Download Excel Template' })).toBeInTheDocument(); expect(calls.mock.calls.some(([url]) => url.includes('staff-import'))).toBe(false);
  fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' })); expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});
it('inactive locations keep saved rows and worker links but hide Add and Import', async () => {
  site.isActive = false; mount(); await ready(); expect(screen.queryByRole('button', { name: 'Add staff' })).not.toBeInTheDocument(); expect(screen.queryByRole('button', { name: 'Import Staff' })).not.toBeInTheDocument(); expect(screen.getByRole('link', { name: 'View worker' })).toBeInTheDocument();
});
it('empty staff keeps Add, Import and attendance recovery available', async () => {
  site.staff = []; mount(); await ready(); expect(screen.getByText('No staff assigned to this location.')).toBeInTheDocument(); expect(screen.getByRole('button', { name: 'Add staff' })).toBeInTheDocument(); expect(screen.getByRole('button', { name: 'Import Staff' })).toBeInTheDocument();
});
it('staff sorting and pagination keep access to every saved row', async () => {
  site.staff = Array.from({ length: 21 }, (_, i) => ({ ...worker, id: i + 1, name: `Worker ${String(i + 1).padStart(2, '0')}` })); mount(); await ready();
  fireEvent.click(within(staffRegion()).getByRole('button', { name: 'Next' })); expect(screen.getByRole('link', { name: 'View worker' })).toHaveAttribute('href', '/staff/21');
  fireEvent.click(screen.getByRole('button', { name: 'Staff' })); expect(screen.getByRole('columnheader', { name: 'Staff' })).toHaveAttribute('aria-sort', 'ascending');
  fireEvent.click(screen.getByRole('button', { name: 'Email' })); expect(screen.getByRole('columnheader', { name: 'Email' })).toHaveAttribute('aria-sort', 'ascending');
});
it.each(['Today', 'Yesterday', 'Last 7 Days', 'All Time'])('%s changes the real history request and results', async label => {
  filtered = true; mount('/locations/20?tab=instances&source=review'); await ready();
  if (label !== 'All Time') fireEvent.click(within(historyRegion()).getByRole('button', { name: label }));
  const result = label === 'Today' ? 'Today result' : label === 'Yesterday' ? 'Yesterday result' : label === 'Last 7 Days' ? 'Week result' : 'Submitted cleaning';
  expect(await screen.findByText(result)).toBeInTheDocument(); expect(within(historyRegion()).getByRole('button', { name: label })).toHaveAttribute('aria-pressed', 'true');
  expect(screen.getByLabelText('Current route')).toHaveTextContent('source=review');
});
it('Selected task and Show all tasks preserve every unrelated URL field', async () => {
  mount('/locations/20?tab=instances&taskId=91&source=review'); await ready(); expect(screen.getByRole('heading', { name: 'Selected task' })).toBeInTheDocument(); expect(screen.queryByText('Submitted cleaning')).not.toBeInTheDocument();
  expect(within(historyRegion()).getByRole('row', { name: /Saved cleaning/ })).toHaveAttribute('aria-selected', 'true');
  fireEvent.click(screen.getByRole('button', { name: 'Show all tasks' })); expect(screen.getByText('Submitted cleaning')).toBeInTheDocument(); expect(screen.getByLabelText('Current route')).toHaveTextContent('/locations/20?tab=instances&source=review');
});
it('unavailable selected task has an explanatory empty state and Show all recovery', async () => {
  mount('/locations/20?taskId=999'); await ready(); expect(screen.getByText('This task is not available for this location and period.')).toBeInTheDocument(); fireEvent.click(screen.getByRole('button', { name: 'Show all tasks' })); expect(screen.getByText(task.title)).toBeInTheDocument();
});
it('history keeps independent work submission and verification facts plus late and assignment notes', async () => {
  responseTasks = [{ ...task, staffSubmittedAt: '2026-11-11T07:00:00Z', verificationState: 'NEEDS_REVIEW', isLate: true, lateMinutes: 12, assignments: [
    { id: 1, staffId: 8, status: 'REASSIGNED', isCurrent: false, assignedAt: '2026-11-11T02:00:00Z', staff: { id: 8, name: 'Previous worker' } },
    { id: 2, staffId: 7, status: 'STARTED', isCurrent: true, assignedAt: '2026-11-11T03:00:00Z', staff: worker },
  ] }];
  mount('/locations/20?tab=instances'); await ready(); const row = within(historyRegion()).getByRole('row', { name: /Saved cleaning/ });
  expect(row).toHaveTextContent('Work submitted'); expect(row).toHaveTextContent('Completed · Needs manager review'); expect(row).toHaveTextContent('Late start: +12m'); expect(row).toHaveTextContent('1 reassigned'); expect(row).toHaveTextContent('Current');
});
it('a closed assignment retains the previous responsible worker with no current pointer', async () => {
  responseTasks = [{ ...task, staffId: null, assignments: [{ id: 2, staffId: 8, status: 'FAILED', isCurrent: false, assignedAt: '2026-11-11T03:00:00Z', staff: { id: 8, name: 'Previous worker' } }] }];
  mount('/locations/20?tab=instances'); await ready(); expect(historyRegion()).toHaveTextContent('Previous worker'); expect(historyRegion()).toHaveTextContent('Previously assigned'); expect(historyRegion()).toHaveTextContent('Failed assignment');
});
it('Task QR fetches only when opened and its row control closes it', async () => {
  mount('/locations/20?tab=instances'); await ready(); expect(calls.mock.calls.some(([url]) => url.endsWith('/qr'))).toBe(false);
  const button = within(historyRegion()).getByRole('button', { name: 'Task QR' }); fireEvent.click(button);
  await waitFor(() => expect(screen.getByRole('region', { name: 'Task QR' })).toHaveTextContent('Saved area')); expect(button).toHaveAttribute('aria-expanded', 'true'); fireEvent.click(button); expect(screen.queryByRole('region', { name: 'Task QR' })).not.toBeInTheDocument();
});
it.each(['COMPLETED', 'CANCELLED'])('%s tasks never offer Task QR', async status => {
  responseTasks = [{ ...task, status }]; mount('/locations/20?tab=instances'); await ready(); expect(screen.queryByRole('button', { name: 'Task QR' })).not.toBeInTheDocument();
});
it('photo review links retain the encoded location and task selection return URL', async () => {
  mount('/locations/20?tab=instances&taskId=91&source=review'); await ready(); expect(screen.getByRole('link', { name: 'View task photos' })).toHaveAttribute('href', '/verification/91?returnTo=' + encodeURIComponent('/locations/20?tab=instances&taskId=91&source=review'));
  expect(document.querySelectorAll('img')).toHaveLength(0); expect(calls.mock.calls.some(([url]) => url.includes('photos'))).toBe(false);
});
it('Areas mounts and unmounts the existing submissions panel only on demand', async () => {
  mount('/locations/20?tab=instances&taskId=91'); await ready(); expect(calls.mock.calls.some(([url]) => url.includes('area-submissions'))).toBe(false);
  const button = screen.getByRole('button', { name: 'Areas' }); fireEvent.click(button); expect(await screen.findByText('No area submissions for this task yet.')).toBeInTheDocument(); expect(button).toHaveAttribute('aria-expanded', 'true'); fireEvent.click(button); expect(screen.queryByText('Area Submissions')).not.toBeInTheDocument();
});
it('legacy verification preserves grouped findings, full reasons, scores and explicit photo links', async () => {
  responseTasks = [{ ...task, verificationVersion: 1, proofImageUrls: ['https://example.invalid/legacy.jpg'], completionAttempts: [
    { id: 1, status: 'REJECTED_LOCATION', areaName: 'Saved area', submissionId: 'group', locationMatchScore: .2, cleanlinessMatchScore: .8, locationMatchReason: 'Recorded wrong area reason', cleanlinessReason: null, imageUrl: '', createdAt: '2026-11-11T05:00:00Z' },
    { id: 2, status: 'APPROVED', areaName: 'Other area', submissionId: 'group', locationMatchScore: null, cleanlinessMatchScore: null, locationMatchReason: null, cleanlinessReason: null, imageUrl: '', createdAt: '2026-11-11T05:00:00Z' },
  ] }];
  mount('/locations/20?tab=instances'); await ready(); expect(historyRegion()).toHaveTextContent('Wrong area'); expect(historyRegion()).toHaveTextContent('Approved'); expect(historyRegion()).toHaveTextContent('Recorded wrong area reason'); expect(historyRegion()).toHaveTextContent('Location score 0.2 · Cleanliness score 0.8'); expect(screen.getByRole('link', { name: 'View task photos 1' })).toHaveAttribute('href', 'https://example.invalid/legacy.jpg'); expect(document.querySelectorAll('img')).toHaveLength(0);
});
it('empty history keeps all period controls', async () => {
  site.taskInstances = []; mount('/locations/20?tab=instances'); await ready(); expect(screen.getByText('No task instances for this period.')).toBeInTheDocument(); expect(screen.getByRole('group', { name: 'Task history period' })).toBeInTheDocument();
});
it('initial loading announces a skeleton, never an empty staff claim', async () => {
  loading = true; mount(); expect(await screen.findByRole('status', { name: 'Loading…' })).toHaveAttribute('aria-busy', 'true'); expect(screen.queryByText('No staff assigned to this location.')).not.toBeInTheDocument();
});
it('initial error offers Retry and saved-record reassurance, then restores the tab', async () => {
  failure = true; mount(); expect(await screen.findByRole('alert')).toHaveTextContent('Your saved records have not changed.'); failure = false; fireEvent.click(screen.getByRole('button', { name: 'Retry' })); await ready(); expect(staffRegion()).toHaveTextContent(worker.name);
});
it('background errors preserve saved staff, action focus and tab URL', async () => {
  const { query } = mount(); await ready(); const link = screen.getByRole('link', { name: 'View worker' }); link.focus(); failure = true;
  await act(async () => { await query.invalidateQueries({ queryKey: ['location'] }); }); expect(await screen.findByRole('alert')).toHaveTextContent('Your saved records have not changed.'); expect(link).toHaveFocus(); expect(staffRegion()).toHaveTextContent(worker.name);
});
it('missing canonical timezone disables local-day filters while retaining week/all', () => {
  function Standalone() { const [period, setPeriod] = useState<'all' | 'today' | 'yesterday' | '7days'>('all'); return <LocationHistoryTab id="20" locationInfo={site} locationTz="UTC" taskHistoryRef={null} selectedTaskId={null} activeFilter={period} setActiveFilter={setPeriod} isFetching={false} taskStats={[]} searchParams={new URLSearchParams()} setSearchParams={() => {}} qrTaskId={null} setQrTaskId={() => {}} expandedInstanceId={null} setExpandedInstanceId={() => {}} />; }
  mount('/locations/20', 'ADMIN', 'en', <Standalone />); expect(screen.getByRole('button', { name: 'Today' })).toBeDisabled(); expect(screen.getByRole('button', { name: 'Yesterday' })).toBeDisabled(); expect(screen.getByRole('button', { name: 'Last 7 Days' })).toBeEnabled();
});
it.each(['staff', 'instances'])('Urdu %s retains record names and translated actions in RTL', async tab => {
  mount('/locations/20?tab=' + tab, 'ADMIN', 'ur'); await ready(); expect(document.documentElement.dir).toBe('rtl');
  if (tab === 'staff') { expect(screen.getByRole('link', { name: 'کارکن کی تفصیل' })).toBeInTheDocument(); expect(screen.getByText(worker.name)).toBeInTheDocument(); }
  else { expect(screen.getByRole('button', { name: 'آج' })).toBeInTheDocument(); expect(screen.getByText(task.title)).toBeInTheDocument(); }
});
