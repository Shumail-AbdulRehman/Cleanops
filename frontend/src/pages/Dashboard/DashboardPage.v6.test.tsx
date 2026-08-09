import { configureStore } from '@reduxjs/toolkit';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { Provider } from 'react-redux';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { beforeEach, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import authReducer, { setUser, type AuthUser } from '@/store/slices/authSlice';
import { LanguageProvider } from '@/i18n/LanguageProvider';
import DashboardPage from './DashboardPage';
import type { CompanyPerformance, SitePerformance } from './performance';

const api = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('@/api/client', () => ({ client: { get: api.get } }));
vi.mock('recharts', () => ({
  ResponsiveContainer: ({ children }: { children: ReactNode }) => children,
  ComposedChart: ({ children }: { children: ReactNode }) => <div data-testid="percent-chart">{children}</div>,
  BarChart: ({ children }: { children: ReactNode }) => <div data-testid="count-chart">{children}</div>,
  Area: () => null, Line: () => null, Bar: () => null, CartesianGrid: () => null,
  Tooltip: () => null, XAxis: () => null, YAxis: () => null,
}));
const location = { id: 20, name: 'Synthetic site', timezone: 'Asia/Karachi' };
const counts = { scheduledShifts: 4, present: 3, late: 1, missing: 1, tasks: 8, submitted: 2, verified: 1, accepted: 0, inProgress: 1, overdue: 2, notStarted: 3, reviews: 2, attendanceRate: 75, submissionRate: 25 };
const site = (id = 20, name = 'Synthetic site', extra: Partial<SitePerformance> = {}): SitePerformance => ({ ...counts, location: { ...location, id, name }, staff: 2, today: { ...counts, status: 'ATTENTION' }, ...extra });
let saved: CompanyPerformance;
function mount(role: AuthUser['role'] = 'ADMIN', language = 'en', path = '/dashboard') {
  localStorage.setItem('hygene-ops.language', language);
  const store = configureStore({ reducer: { auth: authReducer } });
  store.dispatch(setUser({ id: 7, role, name: 'Synthetic Owner', email: 'fixture@example.invalid', companyId: 42 }));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const router = createMemoryRouter([{ path: '/dashboard', element: <DashboardPage /> }], { initialEntries: [path] });
  render(<Provider store={store}><QueryClientProvider client={client}><LanguageProvider><div className="workspace"><RouterProvider router={router} /></div></LanguageProvider></QueryClientProvider></Provider>);
  return { router, client };
}
const report = () => screen.findByRole('region', { name: 'Performance summary' });
const table = () => screen.getByRole('region', { name: 'Every location, in focus' });
const rows = () => within(table()).getAllByRole('row').slice(1).map(row => within(row).getByRole('link', { name: /^Synthetic/ }).textContent);
async function sortBy(label: string) {
  fireEvent.keyDown(screen.getByRole('button', { name: /Sort locations/ }), { key: 'Enter' });
  fireEvent.click(await screen.findByRole('menuitemradio', { name: label }));
}
beforeEach(() => {
  localStorage.clear(); api.get.mockReset();
  saved = { date: 'today', asOf: '2026-11-10T10:00:00Z', locations: [location], selected: [location], days: [{ locationId: 20, localDate: '2026-11-10', timezone: location.timezone }], dateFrom: '2026-11-04', dateTo: '2026-11-10', period: 7, summary: { ...counts, previous: counts, attendanceChange: 2.4, submissionChange: -1.1, totalLocations: 1, activeLocations: 1, totalStaff: 2 }, sites: [site()], series: [{ ...counts, date: '2026-11-10', offset: 0 }] };
  api.get.mockImplementation(async (url: string) => ({ data: { data: structuredClone(url === '/location/readiness' ? { asOf: saved.asOf, totalLocations: 0, sites: [], nextCursor: null, calendar: 'DAILY_INCLUDES_EVERY_DAY', access: { manageWork: true } } : saved) } }));
});
it('renders persisted figures, signed percentage-point changes and company facts', async () => {
  mount(); const summary = await report();
  expect(within(summary).getByText('75%')).toBeInTheDocument();
  expect(within(summary).getByText('25%')).toBeInTheDocument();
  expect(within(summary).getByText('+2.4 pp vs previous period')).toBeInTheDocument();
  expect(within(summary).getByText('-1.1 pp vs previous period')).toBeInTheDocument();
  expect(screen.getByText('Locations with activity')).toBeInTheDocument();
  expect(screen.getByText('Open reviews for work in this period')).toBeInTheDocument();
  expect(screen.getByText('4 Nov – 10 Nov · All locations')).toBeInTheDocument();
});
it('keeps no-previous-data and zero changes distinct', async () => {
  saved.summary.attendanceChange = null; saved.summary.submissionChange = 0;
  mount(); const summary = await report();
  expect(within(summary).getByText('No previous data')).toBeInTheDocument();
  expect(within(summary).getByText('0 pp vs previous period')).toBeInTheDocument();
});
it('writes the period without dropping date, location or unrelated parameters', async () => {
  const { router } = mount('ADMIN', 'en', '/dashboard?locationId=20&date=2026-11-09&keep=yes'); await report();
  fireEvent.click(screen.getByRole('button', { name: 'Last 30 days' }));
  await waitFor(() => expect(api.get).toHaveBeenLastCalledWith('/manager/operations/performance', expect.objectContaining({ params: { locationId: '20', date: '2026-11-09', period: '30' }, signal: expect.any(AbortSignal) })));
  expect(new URLSearchParams(router.state.location.search).get('keep')).toBe('yes');
  expect(screen.getByRole('button', { name: 'Last 30 days' })).toHaveAttribute('aria-pressed', 'true');
});
it('updates location scope through the shared menu and preserves period', async () => {
  const { router } = mount('ADMIN', 'en', '/dashboard?period=30&page=2&taskId=9'); await report();
  fireEvent.keyDown(screen.getByRole('button', { name: /Location: All locations/ }), { key: 'Enter' });
  fireEvent.click(await screen.findByRole('menuitemradio', { name: 'Synthetic site' }));
  await waitFor(() => expect(new URLSearchParams(router.state.location.search).get('locationId')).toBe('20'));
  expect(router.state.location.search).toContain('period=30');
  expect(router.state.location.search).not.toContain('page='); expect(router.state.location.search).not.toContain('taskId=');
});
it('retains date/location parameters on every attention and daily link', async () => {
  mount('ADMIN', 'en', '/dashboard?locationId=20&date=2026-11-09&period=30'); await report();
  const attention = screen.getByRole('complementary', { name: 'Needs attention for this day' });
  expect(within(attention).getByRole('link', { name: /Overdue work/ })).toHaveAttribute('href', '/today-status?locationId=20&date=2026-11-09&tab=tasks&status=overdue');
  expect(within(attention).getByRole('link', { name: /Photo reviews/ })).toHaveAttribute('href', '/exceptions?locationId=20&period=all');
  expect(within(attention).getByRole('link', { name: /Attendance follow-up/ })).toHaveAttribute('href', '/attendance?locationId=20&from=2026-11-10&to=2026-11-10');
  expect(screen.getByRole('link', { name: 'View daily records: Synthetic site' })).toHaveAttribute('href', '/today-status?locationId=20&date=2026-11-09');
  expect(screen.getByRole('link', { name: 'Go to daily operations' })).toHaveAttribute('href', '/today-status?locationId=20&date=2026-11-09');
});
it('shows daily counts/rates and all status and calculation notes', async () => {
  mount(); await report(); fireEvent.click(screen.getByText('View daily figures'));
  const figures = screen.getByRole('region', { name: 'Daily figures' });
  expect(within(figures).getByText('3 / 4 (75%)')).toBeInTheDocument();
  expect(within(figures).getByText('2 / 8 (25%)')).toBeInTheDocument();
  fireEvent.click(screen.getByText('Work status and calculation notes'));
  expect(screen.getByText('verified')).toBeInTheDocument(); expect(screen.getByText('accepted with exceptions')).toBeInTheDocument();
  expect(screen.getByText(/Attendance counts checked-in shifts, including late arrivals/)).toBeInTheDocument();
  expect(screen.getByText('Rates with no scheduled records are marked No data. Exact figures are listed below.')).toBeInTheDocument();
});
it('searches case-insensitively and clears no matches while retaining summary', async () => {
  saved.sites.push(site(21, 'Synthetic Other')); mount(); const summary = await report();
  const find = screen.getByRole('searchbox', { name: 'Find a location' });
  fireEvent.change(find, { target: { value: 'OTHER' } }); expect(rows()).toEqual(['Synthetic Other']);
  fireEvent.change(find, { target: { value: 'absent' } });
  expect(screen.getByRole('heading', { name: 'No matching locations.' })).toBeInTheDocument();
  expect(summary).toBeInTheDocument();
  fireEvent.click(screen.getAllByRole('button', { name: 'Clear search' })[0]);
  expect(rows()).toHaveLength(2); expect(find).toHaveFocus();
});
it.each([
  ['Name A–Z', ['Synthetic A', 'Synthetic B', 'Synthetic C']],
  ['Attendance rate', ['Synthetic C', 'Synthetic A', 'Synthetic B']],
  ['Work submission rate', ['Synthetic B', 'Synthetic A', 'Synthetic C']],
  ['Needs attention first', ['Synthetic C', 'Synthetic B', 'Synthetic A']],
])('sorts locations by %s', async (label, expected) => {
  saved.sites = [site(21, 'Synthetic B', { attendanceRate: null, submissionRate: 90, today: { ...counts, overdue: 2, missing: 0, reviews: 0, status: 'IN_PROGRESS' } }), site(20, 'Synthetic A', { attendanceRate: 70, submissionRate: 40, today: { ...counts, overdue: 0, missing: 0, reviews: 0, status: 'ON_TRACK' } }), site(22, 'Synthetic C', { attendanceRate: 95, submissionRate: null, today: { ...counts, overdue: 3, missing: 1, reviews: 1, status: 'ATTENTION' } })];
  mount(); await report(); await sortBy(label); expect(rows()).toEqual(expected);
});
it('shows No data for null summary/site rates without fabricating zero bars', async () => {
  saved.summary.attendanceRate = null; saved.summary.submissionRate = null;
  saved.sites = [site(20, 'Synthetic site', { attendanceRate: null, submissionRate: null })];
  mount(); const summary = await report(); expect(within(summary).getAllByText('No data')).toHaveLength(2);
  expect(within(table()).getAllByText('No data')).toHaveLength(2);
  expect(within(table()).queryByRole('progressbar')).not.toBeInTheDocument();
});
it('keeps true zero rates and bars distinct from No data', async () => {
  saved.sites = [site(20, 'Synthetic site', { attendanceRate: 0, submissionRate: 0 })];
  mount(); await report(); expect(within(table()).getAllByText('0%')).toHaveLength(2);
  expect(within(table()).getAllByRole('progressbar')).toHaveLength(2);
});
it('integrates the owner welcome/readiness without report filters', async () => {
  saved.sites = []; saved.locations = []; mount();
  await screen.findByRole('heading', { name: 'Welcome, Synthetic' });
  expect(await screen.findByRole('link', { name: /Add location/ })).toHaveAttribute('href', '/locations?create=1');
  expect(screen.queryByRole('group', { name: 'Reporting period' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /Location:/ })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /Date:/ })).not.toBeInTheDocument();
  expect(screen.queryByRole('region', { name: 'Performance summary' })).not.toBeInTheDocument();
  expect(api.get).toHaveBeenCalledWith('/location/readiness', expect.objectContaining({ params: { afterId: 0, limit: 20 } }));
});
it('preserves the manager title, bar chart, period, scope and assigned actions', async () => {
  mount('MANAGER', 'en', '/dashboard?locationId=20');
  await screen.findByRole('heading', { name: 'Assigned-site actions' });
  expect(screen.getByRole('heading', { name: 'Location overview' })).toBeInTheDocument();
  expect(screen.getByTestId('count-chart')).toBeInTheDocument();
  expect(screen.queryByTestId('percent-chart')).not.toBeInTheDocument();
  expect(screen.queryByRole('region', { name: 'Performance summary' })).not.toBeInTheDocument();
  expect(screen.queryByText('Manage locations')).not.toBeInTheDocument();
  expect(screen.queryByText('Locations with activity')).not.toBeInTheDocument();
  expect(screen.queryByRole('link', { name: /Overdue work/ })).not.toBeInTheDocument();
  expect(screen.getAllByRole('link', { name: 'Open Today' })[0]).toHaveAttribute('href', '/today-status?locationId=20&date=today');
  expect(screen.getByRole('link', { name: /Photo reviews/ })).toHaveAttribute('href', '/exceptions?locationId=20&period=all');
});
it('keeps an empty manager scope distinct and never requests owner readiness', async () => {
  saved.sites = []; mount('MANAGER'); await screen.findByRole('heading', { name: 'No assigned locations yet' });
  expect(screen.getByText('Ask your company owner to assign a location to your account.')).toBeInTheDocument();
  expect(api.get.mock.calls.every(([url]) => url === '/manager/operations/performance')).toBe(true);
});
it('shows a teaching chart state for a period without scheduled work', async () => {
  saved.summary.scheduledShifts = 0; saved.summary.tasks = 0; mount();
  await screen.findByRole('heading', { name: 'No performance data in this period' });
  expect(screen.getByText('Charts will appear when scheduled work is recorded.')).toBeInTheDocument();
  expect(screen.queryByRole('img', { name: 'Daily attendance and work submission percentages' })).not.toBeInTheDocument();
});
it('shows initial loading, reports failure with saved-record reassurance and retries', async () => {
  let reject!: (error: Error) => void;
  api.get.mockImplementationOnce(() => new Promise((_resolve, failure) => { reject = failure; })); mount();
  expect(screen.getByRole('status', { name: /Loading/ })).toHaveAttribute('aria-busy', 'true');
  await act(async () => reject(new Error('Unavailable')));
  await screen.findByRole('alert');
  expect(screen.getByText('Check your connection and try again. Your saved records have not changed.')).toBeInTheDocument();
  expect(screen.queryByText('Loading performance…')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Retry' })); await report();
});
it('keeps mounted data, draft search and focus during background refresh and failure', async () => {
  mount(); const summary = await report();
  const find = screen.getByRole('searchbox', { name: 'Find a location' }); find.focus();
  fireEvent.change(find, { target: { value: 'Synthetic' } });
  let reject!: (error: Error) => void;
  api.get.mockImplementationOnce(() => new Promise((_resolve, failure) => { reject = failure; }));
  fireEvent.click(screen.getByRole('button', { name: 'Refresh performance' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Refresh performance' })).toBeDisabled());
  expect(summary).toBeInTheDocument(); expect(find).toHaveFocus();
  await act(async () => reject(new Error('Unavailable'))); await screen.findByRole('alert');
  expect(summary).toBeInTheDocument(); expect(find).toHaveValue('Synthetic'); expect(find).toHaveFocus();
});
it('translates the real report, mirrors Urdu and preserves record names', async () => {
  mount('ADMIN', 'ur'); await screen.findByRole('region', { name: 'کارکردگی کا خلاصہ' });
  expect(document.documentElement.dir).toBe('rtl');
  expect(screen.getByRole('link', { name: 'Synthetic site' })).toBeInTheDocument();
  expect(screen.getByRole('searchbox', { name: 'مقام تلاش کریں' })).toBeInTheDocument();
  expect(screen.queryByText('Needs attention today')).not.toBeInTheDocument();
});
