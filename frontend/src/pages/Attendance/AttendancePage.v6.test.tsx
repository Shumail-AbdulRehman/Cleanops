import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { LanguageProvider } from '@/i18n/LanguageProvider';
import { translate } from '@/i18n/translations';
import AttendancePage from './AttendancePage';

const mocks = vi.hoisted(() => ({ attendance: vi.fn(), locations: vi.fn(), staff: vi.fn(), get: vi.fn(), refetch: vi.fn(), retryLocations: vi.fn(), retryStaff: vi.fn(), create: vi.fn(), revoke: vi.fn() }));
vi.mock('./queries', () => ({ useGetAttendance: mocks.attendance }));
vi.mock('../Location/queries', () => ({ useGetLocations: mocks.locations }));
vi.mock('../Staff/queries', () => ({ useGetStaff: mocks.staff }));
vi.mock('@/api/client', () => ({ client: { get: mocks.get, post: vi.fn() } }));
vi.mock('@/hooks/useAuth', () => ({ default: () => ({ user: { id: 1, role: 'MANAGER', companyId: 42 } }) }));
const row = {
  id: 12, staffId: 7, locationId: 4, date: '2026-10-28T00:00:00Z',
  expectedStart: '2026-10-28T03:00:00Z', expectedEnd: '2026-10-28T11:00:00Z',
  checkInTime: '2026-10-28T03:10:00Z', checkOutTime: '2026-10-28T11:02:00Z',
  status: 'CHECKED_OUT', isLateCheckIn: true, lateMinutes: 10,
  checkInPhoto: { state: 'AVAILABLE' as const, path: '/attendance/12/photos/check-in' },
  checkOutPhoto: { state: 'AVAILABLE' as const, path: '/attendance/12/photos/check-out' },
  staff: { id: 7, name: 'Synthetic worker', email: 'fixture@example.invalid' },
  location: { id: 4, name: 'Synthetic site', timezone: 'Asia/Karachi' },
};
function mount(path = '/attendance', language: 'en' | 'ur' = 'en') {
  localStorage.setItem('hygene-ops.language', language);
  const query = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const router = createMemoryRouter([{ path: '*', element: <AttendancePage /> }], { initialEntries: [path] });
  render(<QueryClientProvider client={query}><LanguageProvider><div className="workspace"><RouterProvider router={router} /></div></LanguageProvider></QueryClientProvider>);
  return { router, params: () => new URLSearchParams(router.state.location.search) };
}
const lastFilters = () => mocks.attendance.mock.calls.at(-1)?.[0];
function choose(label: string, option: string) {
  fireEvent.keyDown(screen.getByRole('button', { name: new RegExp(`^${label}:`) }), { key: 'ArrowDown' });
  fireEvent.click(screen.getByRole('menuitemradio', { name: option }));
}
function date(label: string, value: string) {
  fireEvent.click(screen.getByRole('button', { name: new RegExp(`^${label}:`) }));
  fireEvent.click(screen.getByRole('button', { name: new Intl.DateTimeFormat('en-PK', { dateStyle: 'full', timeZone: 'UTC' }).format(new Date(`${value}T12:00:00Z`)) }));
}
const registerRow = () => screen.getByRole('row', { name: /Synthetic worker/ });
beforeEach(() => {
  vi.clearAllMocks(); localStorage.clear(); vi.setSystemTime(new Date('2026-10-28T21:30:00Z'));
  mocks.attendance.mockReturnValue({ data: { data: [row] }, isPending: false, isError: false, isFetching: false, refetch: mocks.refetch });
  mocks.locations.mockReturnValue({ data: { data: [{ id: 4, name: 'Synthetic site', timezone: 'Asia/Karachi' }] }, isPending: false, isError: false, refetch: mocks.retryLocations });
  mocks.staff.mockReturnValue({ data: { data: [{ id: 7, name: 'Synthetic worker', locationId: 4 }, { id: 8, name: 'Other site worker', locationId: 5 }] }, isPending: false, isError: false, refetch: mocks.retryStaff });
  mocks.get.mockImplementation(async (path: string) => path.includes('/photos/') ? { data: new Blob(['synthetic bytes'], { type: 'image/jpeg' }) } : { data: { data: { attendanceId: 12, items: [], nextCursor: null } } });
  const OriginalURL = URL;
  mocks.create.mockReturnValue('blob:synthetic-photo');
  vi.stubGlobal('URL', class extends OriginalURL { static createObjectURL = mocks.create; static revokeObjectURL = mocks.revoke; });
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

it.each([
  ['Today', '2026-10-28', '2026-10-28'], ['Yesterday', '2026-10-27', '2026-10-27'], ['This Month', '2026-10-01', '2026-10-31'],
])('%s writes concrete calendar dates to the URL and API, retaining unrelated parameters', (label, from, to) => {
  const { params } = mount('/attendance?staffId=7&keep=present');
  fireEvent.click(screen.getByRole('button', { name: label }));
  expect(Object.fromEntries(params())).toEqual({ staffId: '7', keep: 'present', from, to });
  expect(lastFilters()).toEqual({ staffId: 7, locationId: undefined, from, to });
  expect(screen.getByRole('button', { name: label })).toHaveAttribute('aria-pressed', 'true');
});
it.each([['Today', '2026-10-29', '2026-10-29'], ['Yesterday', '2026-10-28', '2026-10-28'], ['This Month', '2026-10-01', '2026-10-31']])('uses the selected location calendar for %s', (label, from, to) => {
  mount(); choose('Location', 'Synthetic site');
  fireEvent.click(screen.getByRole('button', { name: label }));
  expect(lastFilters()).toEqual({ locationId: 4, staffId: undefined, from, to });
});
it('This Month is the current local month even when the custom Month draft is historical', () => {
  mount('/attendance?from=2026-02-01&to=2026-02-28');
  fireEvent.click(screen.getByRole('button', { name: 'This Month' }));
  expect(lastFilters()).toMatchObject({ from: '2026-10-01', to: '2026-10-31' });
});
it('retains draft menu choices until Apply, restricts staff choices, and clears staff when location changes', () => {
  const { params } = mount(); const initial = lastFilters();
  choose('Staff', 'Synthetic worker'); choose('Location', 'Synthetic site');
  expect(lastFilters()).toEqual(initial);
  expect(screen.getByRole('button', { name: 'Staff: All Staff' })).toBeInTheDocument();
  fireEvent.keyDown(screen.getByRole('button', { name: 'Staff: All Staff' }), { key: 'ArrowDown' });
  expect(screen.queryByRole('menuitemradio', { name: 'Other site worker' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('menuitemradio', { name: 'Synthetic worker' }));
  fireEvent.click(screen.getByRole('button', { name: 'Apply filters' }));
  expect(lastFilters()).toMatchObject({ locationId: 4, staffId: 7 });
  expect(params().get('staffId')).toBe('7');
});
it('keeps calendar drafts until Apply and rejects a reversed range without changing requests or URL', () => {
  const { params } = mount(); const initial = lastFilters();
  fireEvent.click(screen.getByText('More filters'));
  date('From date', '2026-10-30'); date('To date', '2026-10-29');
  expect(lastFilters()).toEqual(initial);
  fireEvent.click(screen.getByRole('button', { name: 'Apply filters' }));
  expect(screen.getByRole('alert')).toHaveTextContent('Choose a valid date range');
  expect(params().has('from')).toBe(false); expect(lastFilters()).toEqual(initial);
  date('To date', '2026-10-31'); fireEvent.click(screen.getByRole('button', { name: 'Apply filters' }));
  expect(lastFilters()).toMatchObject({ from: '2026-10-30', to: '2026-10-31' });
  expect(params().get('to')).toBe('2026-10-31');
});
it('applies a leap-year month and resets scope while preserving unrelated URL parameters', () => {
  const { params } = mount('/attendance?locationId=4&staffId=7&keep=present');
  fireEvent.click(screen.getByText('More filters'));
  fireEvent.change(screen.getByLabelText('Month'), { target: { value: '2024-02' } });
  fireEvent.click(screen.getByRole('button', { name: 'Apply month' }));
  expect(lastFilters()).toMatchObject({ from: '2024-02-01', to: '2024-02-29', staffId: 7, locationId: 4 });
  fireEvent.click(screen.getByRole('button', { name: 'Reset' }));
  expect(Object.fromEntries(params())).toEqual({ keep: 'present', from: '2026-10-28', to: '2026-10-28' });
});
it('restores the API scope and menu/date drafts on browser Back and Forward', async () => {
  const { router } = mount('/attendance?locationId=4&from=2026-10-20&to=2026-10-21');
  fireEvent.click(screen.getByRole('button', { name: 'Yesterday' }));
  await act(() => router.navigate(-1));
  expect(lastFilters()).toMatchObject({ locationId: 4, from: '2026-10-20', to: '2026-10-21' });
  fireEvent.click(screen.getByText('More filters'));
  expect(screen.getByRole('button', { name: /^From date: 20 Oct 2026/ })).toBeInTheDocument();
  await act(() => router.navigate(1));
  expect(lastFilters()).toMatchObject({ from: '2026-10-28', to: '2026-10-28' });
});
it.each(['click', 'Enter', ' '])('opens the real controlled record panel by %s and returns focus on Escape', async action => {
  mount(); const recordRow = registerRow(); recordRow.focus();
  if (action === 'click') fireEvent.click(within(recordRow).getByText('08:10')); else fireEvent.keyDown(recordRow, { key: action });
  expect(await screen.findByRole('dialog', { name: 'Attendance context · #12' })).toBeInTheDocument();
  expect(await screen.findByRole('heading', { name: 'Original captured facts' })).toBeInTheDocument();
  fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  expect(recordRow).toHaveFocus();
});
it('has no images, photo loaders or requests in the table, and announces both camera markers', () => {
  mount(); const table = screen.getByRole('table');
  expect(table.querySelector('img')).toBeNull();
  expect(within(table).getAllByRole('img', { name: 'Photo available' })).toHaveLength(2);
  expect(screen.queryByText('Photos')).not.toBeInTheDocument();
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument(); expect(mocks.get).not.toHaveBeenCalled();
});
it('requests protected photos only after opening and preserves the panel draft across close/reopen', async () => {
  mount(); fireEvent.click(screen.getByRole('button', { name: 'Attendance context: Synthetic worker' }));
  await screen.findByRole('textbox');
  await waitFor(() => expect(mocks.get.mock.calls.filter(([path]) => path.includes('/photos/'))).toHaveLength(2));
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Synthetic retained draft' } });
  fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  fireEvent.click(screen.getByRole('button', { name: 'Attendance context: Synthetic worker' }));
  expect(await screen.findByRole('textbox')).toHaveValue('Synthetic retained draft');
});
it('keeps staff and location detail links navigable without opening the panel', () => {
  mount(); expect(screen.getByRole('link', { name: 'Synthetic worker' })).toHaveAttribute('href', '/staff/7');
  expect(screen.getByRole('link', { name: 'Synthetic site' })).toHaveAttribute('href', '/locations/4');
  fireEvent.click(screen.getByRole('link', { name: 'Synthetic worker' }));
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument(); expect(mocks.get).not.toHaveBeenCalled();
});
it('does not mark legacy or missing photos as available', () => {
  mocks.attendance.mockReturnValue({ data: { data: [{ ...row, checkInPhoto: { state: 'LEGACY_RESTRICTED', path: null }, checkOutPhoto: { state: 'NONE', path: null } }] } });
  mount(); expect(within(screen.getByRole('table')).queryByRole('img', { name: 'Photo available' })).not.toBeInTheDocument();
  expect(mocks.get).not.toHaveBeenCalled();
});
it.each(['locations', 'staff'] as const)('shows %s filter failure and independent Retry without losing records or deep-link scope', kind => {
  mocks[kind].mockReturnValue({ isError: true, refetch: kind === 'locations' ? mocks.retryLocations : mocks.retryStaff });
  mount('/attendance?locationId=4&staffId=7&from=2026-10-20&to=2026-10-21');
  expect(screen.getByRole('alert')).toHaveTextContent(kind === 'locations' ? 'Locations could not load' : 'Staff filter could not load');
  expect(screen.getByRole('button', { name: new RegExp(`^${kind === 'locations' ? 'Location' : 'Staff'}:`) })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: kind === 'locations' ? 'Retry locations' : 'Retry' }));
  expect(kind === 'locations' ? mocks.retryLocations : mocks.retryStaff).toHaveBeenCalledOnce();
  expect(registerRow()).toBeInTheDocument(); expect(lastFilters()).toMatchObject({ locationId: 4, staffId: 7 });
});
it('keeps saved rows, summary, focus and a record draft through background fetch and network failure', async () => {
  const { router } = mount(); fireEvent.click(screen.getByRole('button', { name: 'Attendance context: Synthetic worker' }));
  const editor = await screen.findByRole('textbox'); fireEvent.change(editor, { target: { value: 'Retained draft' } }); editor.focus();
  mocks.attendance.mockReturnValue({ data: { data: [row] }, isError: true, error: new Error('Synthetic unavailable'), isFetching: false });
  await act(() => router.navigate('/attendance?refresh=failed'));
  expect(screen.getByRole('textbox')).toHaveValue('Retained draft'); expect(editor).toHaveFocus();
  expect(screen.getByText('This page could not load')).toBeInTheDocument();
  expect(screen.getAllByRole('row', { hidden: true }).some(record => record.textContent?.includes('Synthetic worker'))).toBe(true);
  expect(within(screen.getByLabelText('Attendance summary')).getByText('Scheduled shifts').parentElement?.querySelector('strong')).toHaveTextContent('1');
});
it('hides cached rows and the open record after a denied attendance refresh', async () => {
  const { router } = mount(); fireEvent.click(screen.getByRole('button', { name: 'Attendance context: Synthetic worker' })); await screen.findByRole('dialog');
  mocks.attendance.mockReturnValue({ data: { data: [row] }, isError: true, error: { response: { status: 403 } } });
  await act(() => router.navigate('/attendance?refresh=denied'));
  expect(screen.queryByRole('table')).not.toBeInTheDocument(); expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(screen.getByRole('alert')).toHaveTextContent('You do not have access');
});
it('uses UTC fallback, keeps overnight guidance and retains late minutes after checkout', () => {
  mocks.locations.mockReturnValue({ data: { data: [] } });
  mocks.attendance.mockReturnValue({ data: { data: [{ ...row, location: { ...row.location, timezone: undefined } }] } });
  mount(); expect(screen.getByText('UTC · location timezone unavailable')).toBeInTheDocument();
  expect(screen.getByText('10 minutes late')).toBeInTheDocument();
  expect(screen.getByText('Overnight shifts remain tied to their scheduled local date.')).toBeInTheDocument();
});
it('teaches the empty state and offers a working Reset without showing photo content', () => {
  mocks.attendance.mockReturnValue({ data: { data: [] } });
  const { params } = mount('/attendance?from=2026-10-20&to=2026-10-21');
  expect(screen.getByRole('heading', { name: 'No attendance recorded yet' })).toBeInTheDocument();
  fireEvent.click(within(screen.getByRole('heading', { name: 'No attendance recorded yet' }).parentElement!).getByRole('button', { name: 'Reset' }));
  expect(params().get('from')).toBe('2026-10-28'); expect(mocks.get).not.toHaveBeenCalled();
});
it('uses announced initial loading instead of fabricated records or a spinner', () => {
  mocks.attendance.mockReturnValue({ isPending: true, isFetching: true });
  mount(); expect(screen.getByRole('status')).toHaveAttribute('aria-busy', 'true');
  expect(screen.queryByRole('table')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Refreshing…' })).toBeDisabled();
});
it('retains client pagination and opens a record on the second page', async () => {
  mocks.attendance.mockReturnValue({ data: { data: Array.from({ length: 21 }, (_, i) => ({ ...row, id: i + 1, staff: { ...row.staff, name: `Synthetic worker ${i + 1}` } })) } });
  mount(); expect(screen.getByText('1–20 of 21')).toBeInTheDocument(); fireEvent.click(screen.getByRole('button', { name: 'Next' }));
  expect(screen.getByText('21–21 of 21')).toBeInTheDocument(); fireEvent.keyDown(screen.getByRole('row', { name: /Synthetic worker 21/ }), { key: 'Enter' });
  expect(await screen.findByRole('dialog', { name: 'Attendance context · #21' })).toBeInTheDocument();
});
it('translates the controls, camera text and column labels under Urdu while preserving configured names', () => {
  mount('/attendance', 'ur'); expect(document.documentElement.dir).toBe('rtl');
  expect(screen.getByRole('button', { name: translate('Today', 'ur') })).toBeInTheDocument();
  expect(screen.getByRole('columnheader', { name: translate('Location and shift', 'ur') })).toBeInTheDocument();
  expect(screen.getAllByRole('img', { name: translate('Photo available', 'ur') })).toHaveLength(2);
  expect(screen.getByRole('link', { name: 'Synthetic worker' })).toBeInTheDocument();
});
