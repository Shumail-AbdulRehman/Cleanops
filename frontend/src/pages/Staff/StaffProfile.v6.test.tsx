import { configureStore } from '@reduxjs/toolkit';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { Provider } from 'react-redux';
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { beforeEach, expect, it, vi } from 'vitest';
import authReducer, { setUser, type AuthUser } from '@/store/slices/authSlice';
import { LanguageProvider } from '@/i18n/LanguageProvider';
import StaffDetailPage from './StaffDetailPage';
import type { StaffProfileData } from './StaffOverviewTab';
const m = vi.hoisted(() => ({ detail: {} as Record<string, unknown>, sites: {} as Record<string, unknown>, args: vi.fn(), edit: vi.fn(), retry: vi.fn() }));
vi.mock('./queries', () => ({ useGetStaffDetails: (id: number, filters: unknown) => { m.args(id, filters); return m.detail; }, useEditStaff: () => ({ mutateAsync: m.edit, isPending: false }) }));
vi.mock('../Location/queries', () => ({ useGetLocations: () => m.sites }));
const site = { id: 20, name: 'Saved site', address: 'Saved address', timezone: 'Asia/Karachi', isActive: true };
const task = { id: 1, title: 'Saved task', location: site, date: '2026-11-10T00:00:00Z', shiftStart: '2026-11-10T04:00:00Z', shiftEnd: '2026-11-10T05:00:00Z', status: 'COMPLETED', staffSubmittedAt: '2026-11-10T04:45:00Z', verificationVersion: 2, verificationState: 'AWAITING_REVIEW', isLate: false, startedAt: null, completedAt: null };
const attendance = { id: 10, date: '2026-11-10T00:00:00Z', location: site, expectedStart: '2026-11-10T04:00:00Z', expectedEnd: '2026-11-10T12:00:00Z', checkInTime: '2026-11-10T04:00:00Z', checkOutTime: null, status: 'CHECKED_IN', isLateCheckIn: false, lateMinutes: null };
const worker: StaffProfileData = { id: 7, name: 'Saved worker', email: 'worker@example.invalid', phone: '03001234567', isActive: true, locationId: 20, location: site, role: 'STAFF', createdAt: '2026-10-01T00:00:00Z', shiftStart: '1970-01-01T04:00:00Z', shiftEnd: '1970-01-01T12:00:00Z', periodLabel: 'All time', taskStats: { totalTemplates: 2, totalInstances: 9, completed: 3, pending: 4, inProgress: 1, missed: 1 }, attendanceStats: { totalRecords: 25, present: 24, absent: 1, late: 2 }, taskTemplates: [{ id: 30, title: 'Saved cleaning schedule', description: 'Saved instructions', isActive: true, recurringType: 'DAILY', location: site, shiftStart: '1970-01-01T04:00:00Z', shiftEnd: '1970-01-01T05:00:00Z', effectiveDate: '2026-10-01T00:00:00Z' }], taskInstances: [task], attendances: [attendance, { ...attendance, id: 11, status: 'LATE', isLateCheckIn: true }], performanceIssues: { total: 1, reports: [{ id: 4, reviewId: 5, recordedAt: '2026-11-10T00:00:00Z', category: 'CLEANING_QUALITY', note: 'Saved manager note', taskId: 1, taskTitle: task.title, managerName: 'Saved manager' }] } };
function Path() { const loc = useLocation(), nav = useNavigate(); return <><output aria-label="Current route">{loc.pathname + loc.search}</output><button onClick={() => nav('/staff/7?tab=attendance&dateFrom=2026-10-01&dateTo=2026-10-10&source=history')}>Set history URL</button><button onClick={() => nav(-1)}>History back</button></>; }
function mount(path = '/staff/7?month=2026-10&source=setup', role: AuthUser['role'] = 'ADMIN', language = 'en') {
  localStorage.setItem('hygene-ops.language', language);
  const store = configureStore({ reducer: { auth: authReducer } });
  store.dispatch(setUser({ id: 2, companyId: 42, role, name: 'Saved owner', email: 'owner@example.invalid' }));
  const query = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const tree = () => <Provider store={store}><QueryClientProvider client={query}><LanguageProvider><MemoryRouter initialEntries={[path]}><div className="workspace"><Routes><Route path="/staff/:id" element={<StaffDetailPage />} /></Routes><Path /></div></MemoryRouter></LanguageProvider></QueryClientProvider></Provider>;
  const view = render(tree()); return { ...view, store, refresh: () => view.rerender(tree()) };
}
function tab(label: string) { fireEvent.mouseDown(screen.getByRole('tab', { name: label }), { button: 0, ctrlKey: false }); }
const record = () => (m.detail.data as { data: StaffProfileData }).data;
const url = () => new URL('https://example.invalid' + screen.getByLabelText('Current route').textContent);
async function chooseMonth(name: string) { fireEvent.pointerDown(screen.getByRole('button', { name: /^Month:/ }), { button: 0, ctrlKey: false, pointerType: 'mouse' }); fireEvent.click(await screen.findByRole('menuitemradio', { name })); }
function chooseDate(label: string, day: number) {
  fireEvent.click(screen.getByRole('button', { name: new RegExp('^' + label + ':') }));
  const date = new Date(); date.setDate(day);
  fireEvent.click(screen.getByRole('button', { name: date.toLocaleDateString('en-PK', { dateStyle: 'full' }) }));
}
beforeEach(() => {
  vi.clearAllMocks(); localStorage.clear(); m.edit.mockResolvedValue({});
  m.detail = { data: { data: structuredClone(worker) }, isLoading: false, isFetching: false, isError: false, refetch: m.retry };
  m.sites = { data: { data: [site] }, isError: false, refetch: vi.fn() };
});
it('header shows saved contact, assignment, local shift and actual account status without media', () => {
  mount('/staff/7?tab=attendance'); expect(screen.getByRole('heading', { name: worker.name })).toBeInTheDocument(); expect(screen.getAllByText('worker@example.invalid').length).toBeGreaterThan(0); expect(screen.getByText(worker.phone!)).toBeInTheDocument(); expect(screen.getByText(/09:00 \(GMT\+5\)/)).toHaveTextContent('17:00'); expect(screen.getByText('Active')).toBeInTheDocument(); expect(document.querySelector('img')).toBeNull();
});
it('shows the missing email in the header and overview and includes the phone fact', () => {
  record().email = null;
  mount();
  const overview = screen.getByRole('tabpanel', { name: 'Overview' });
  const facts = within(overview).getByRole('region', { name: 'Profile' });
  expect(within(facts).getByText('No email')).toBeVisible();
  expect(screen.getByRole('heading', { name: worker.name }).parentElement).toHaveTextContent('No email');
  const phoneFact = within(facts).getByText('Phone Number', { selector: 'dt' }).parentElement;
  expect(phoneFact).toHaveTextContent(worker.phone!);
});
it.each([['Cleaning schedule', 'templates'], ['Task history', 'instances'], ['Attendance', 'attendance'], ['Overview', 'overview']])('tab %s preserves scoped URL and exposes its panel', (label, value) => {
  mount('/staff/7?month=2026-10&focus=today&source=setup' + (value === 'overview' ? '&tab=attendance' : '')); tab(label); expect(url().searchParams.get('tab')).toBe(value); expect(url().searchParams.get('month')).toBe('2026-10'); expect(url().searchParams.get('focus')).toBe('today'); expect(url().searchParams.get('source')).toBe('setup'); expect(screen.getByRole('tabpanel', { name: label })).toBeInTheDocument();
});
it.each([['Today', 0], ['Yesterday', -1]])('%s applies UTC calendar fields and clears only obsolete range/focus', (label, offset) => {
  mount('/staff/7?month=2026-10&focus=today&source=setup&tab=attendance'); fireEvent.click(screen.getByRole('button', { name: label })); const day = new Date(); day.setUTCDate(day.getUTCDate() + offset); const value = day.toISOString().slice(0, 10); expect(m.args).toHaveBeenLastCalledWith(7, { dateFrom: value, dateTo: value }); expect(url().searchParams.get('dateFrom')).toBe(value); expect(url().searchParams.has('month')).toBe(false); expect(url().searchParams.has('focus')).toBe(false); expect(url().searchParams.get('source')).toBe('setup'); expect(screen.getByRole('button', { name: label })).toHaveAttribute('aria-pressed', 'true');
});
it('This Month and Reset restore current UTC month without changing the tab', () => {
  mount('/staff/7?tab=templates&dateFrom=2026-01-01&dateTo=2026-01-15'); fireEvent.click(screen.getByRole('button', { name: 'This Month' })); expect(m.args).toHaveBeenLastCalledWith(7, { month: new Date().toISOString().slice(0, 7) }); fireEvent.click(screen.getByRole('button', { name: 'Today' })); fireEvent.click(screen.getByRole('button', { name: 'Reset' })); expect(url().searchParams.has('dateFrom')).toBe(false); expect(url().searchParams.get('tab')).toBe('templates');
});
it('month choice is a draft until Apply month writes its exact request and URL', async () => {
  mount(); const desired = new Date(); desired.setUTCDate(1); desired.setUTCMonth(desired.getUTCMonth() - 2); const value = desired.toISOString().slice(0, 7); await chooseMonth(desired.toLocaleDateString('en-PK', { month: 'long', year: 'numeric', timeZone: 'UTC' })); expect(url().searchParams.get('month')).toBe('2026-10'); fireEvent.click(screen.getByRole('button', { name: 'Apply month' })); expect(m.args).toHaveBeenLastCalledWith(7, { month: value }); expect(url().searchParams.get('month')).toBe(value);
});
it('range calendars keep drafts until Apply range, then preserve unrelated scope', () => {
  mount(); chooseDate('From date', 10); chooseDate('To date', 20); expect(m.args).toHaveBeenLastCalledWith(7, { month: '2026-10' }); fireEvent.click(screen.getByRole('button', { name: 'Apply range' })); const prefix = new Date().toISOString().slice(0, 7); expect(m.args).toHaveBeenLastCalledWith(7, { dateFrom: prefix + '-10', dateTo: prefix + '-20' }); expect(url().searchParams.get('source')).toBe('setup'); expect(url().searchParams.has('month')).toBe(false);
});
it.each(['missing', 'reversed'])('invalid %s range retains applied filters and URL', type => {
  mount(); if (type === 'reversed') { chooseDate('From date', 20); chooseDate('To date', 10); } fireEvent.click(screen.getByRole('button', { name: 'Apply range' })); expect(screen.getByRole('alert')).toHaveTextContent('Choose both dates.'); expect(m.args).toHaveBeenLastCalledWith(7, { month: '2026-10' }); expect(url().searchParams.has('dateFrom')).toBe(false);
});
it('history changes synchronize tab, period controls and query; Back restores the prior scope', () => {
  mount(); fireEvent.click(screen.getByRole('button', { name: 'Set history URL' })); expect(screen.getByRole('tab', { name: 'Attendance' })).toHaveAttribute('aria-selected', 'true'); expect(m.args).toHaveBeenLastCalledWith(7, { dateFrom: '2026-10-01', dateTo: '2026-10-10' }); expect(screen.getByRole('button', { name: /^From date:/ })).toHaveTextContent('1 Oct 2026'); fireEvent.click(screen.getByRole('button', { name: 'History back' })); expect(m.args).toHaveBeenLastCalledWith(7, { month: '2026-10' }); expect(screen.getByRole('tab', { name: 'Overview' })).toHaveAttribute('aria-selected', 'true');
});
it('unknown tab safely opens Overview without rewriting the URL', () => { mount('/staff/7?tab=unknown'); expect(screen.getByRole('tab', { name: 'Overview' })).toHaveAttribute('aria-selected', 'true'); expect(url().searchParams.get('tab')).toBe('unknown'); });
it('Edit opens its real panel and keeps the exact changed-fields-only payload', async () => {
  mount(); fireEvent.click(screen.getByRole('button', { name: 'Edit' })); expect(screen.getByRole('dialog', { name: 'Edit team member' })).toBeInTheDocument(); fireEvent.change(screen.getByLabelText('Full Name'), { target: { value: 'Changed worker' } }); fireEvent.click(screen.getByRole('button', { name: 'Save changes' })); expect(await screen.findByText('Team member changes saved.')).toBeInTheDocument(); expect(m.edit).toHaveBeenCalledWith({ id: 7, data: { name: 'Changed worker' } }); expect(screen.queryByRole('dialog')).toBeNull();
});
it('Staff access opens the real controlled panel with required reason and no duplicate trigger', async () => {
  mount(); expect(screen.getAllByRole('button', { name: 'Staff access' })).toHaveLength(1); fireEvent.click(screen.getByRole('button', { name: 'Staff access' })); expect(await screen.findByRole('dialog', { name: 'Staff access' })).toBeInTheDocument(); expect(screen.getByLabelText('Reason')).toBeInTheDocument(); expect(screen.getByRole('button', { name: 'Confirm access change' })).toBeDisabled();
});
it('inactive profile retains facts but cannot edit or manage access', () => { record().isActive = false; mount(); expect(screen.getByText('Inactive')).toBeInTheDocument(); expect(screen.getByRole('button', { name: 'Edit' })).toBeDisabled(); expect(screen.getByRole('button', { name: 'Staff access' })).toBeDisabled(); });
it.each([true, false])('manager assigned-source access gate is preserved (%s)', assigned => { if (!assigned) record().locationId = 99; mount(undefined, 'MANAGER'); expect(screen.getByRole('button', { name: 'Staff access' }).hasAttribute('disabled')).toBe(!assigned); });
it('not-found retains Back to team', () => { m.detail = { data: { data: null } }; mount(); expect(screen.getByRole('heading', { name: 'Staff member not found.' })).toBeInTheDocument(); expect(screen.getByRole('link', { name: 'Back to team' })).toHaveAttribute('href', '/staff'); });
it.each([403, 404, 401, 410])('unavailable %s hides cached data and panels with Back to team', status => {
  const view = mount(); fireEvent.click(screen.getByRole('button', { name: 'Edit' })); m.detail.isError = true; m.detail.error = { response: { status } }; view.refresh(); expect(screen.queryByRole('heading', { name: worker.name })).toBeNull(); expect(screen.queryByRole('dialog')).toBeNull(); expect(screen.getByRole('alert')).toHaveTextContent('unavailable to your account'); expect(screen.getByRole('link', { name: 'Back to team' })).toHaveAttribute('href', '/staff');
});
it('loading uses an announced skeleton without fabricated figures', () => { m.detail = { isLoading: true }; mount(); expect(screen.getAllByRole('status').some(node => node.getAttribute('aria-busy') === 'true')).toBe(true); expect(screen.queryByText('96%')).toBeNull(); expect(screen.getByRole('link', { name: 'Back to team' })).toBeInTheDocument(); });
it('initial failure offers Retry and saved-record reassurance without exposing server details', () => { m.detail = { isError: true, error: new Error('private server details'), refetch: m.retry }; mount(); expect(screen.getByRole('alert')).toHaveTextContent('Your saved records have not changed.'); expect(screen.queryByText('private server details')).toBeNull(); fireEvent.click(screen.getByRole('button', { name: 'Retry' })); expect(m.retry).toHaveBeenCalledOnce(); });
it('background failure retains profile, period draft and focused access reason', async () => {
  const view = mount(); fireEvent.click(screen.getByRole('button', { name: 'Staff access' })); const reason = await screen.findByLabelText('Reason'); fireEvent.change(reason, { target: { value: 'Retained reason' } }); reason.focus(); m.detail.isError = true; m.detail.error = new Error('offline'); view.refresh(); expect(screen.getByLabelText('Reason')).toHaveValue('Retained reason'); expect(screen.getByLabelText('Reason')).toHaveFocus();
});
it('Refresh disables during fetching without blanking the profile', () => { m.detail.isFetching = true; mount(); expect(screen.getByRole('button', { name: 'Refresh' })).toBeDisabled(); expect(screen.getByRole('heading', { name: worker.name })).toBeInTheDocument(); });
it('overview preserves aggregates, labels recent-only on-time counts and keeps submission separate', () => {
  mount(); expect(screen.getByText('Attendance reliability', { selector: 'dt' }).parentElement).toHaveTextContent('96%'); expect(screen.getByText('On time', { selector: 'dt' }).parentElement).toHaveTextContent('1of 2Recent recorded check-ins only.'); expect(screen.getByText('Tasks submitted', { selector: 'dt' }).parentElement).toHaveTextContent('3of 9'); expect(screen.getByRole('region', { name: 'Recent tasks' })).toHaveTextContent('Work submitted'); expect(screen.getByRole('region', { name: 'Recent tasks' })).not.toHaveTextContent('Verified');
});
it('task chart has an accessible summary and a disclosure with all four true totals', () => {
  mount(); expect(screen.getByRole('img', { name: /Work submitted: 3; Pending: 4; In Progress: 1; Missed: 1/ })).toBeInTheDocument(); const summary = screen.getByText('Task totals', { selector: 'summary' }); fireEvent.click(summary); const table = screen.getByRole('table', { name: 'Task totals' }); expect(within(table).getAllByRole('row')).toHaveLength(5);
});
it('zero work and attendance preserve real zeros and unknown reliability without invented rates', () => {
  Object.assign(record().taskStats, { completed: 0, pending: 0, inProgress: 0, missed: 0, totalInstances: 0 }); Object.assign(record().attendanceStats, { totalRecords: 0, present: 0 }); record().taskInstances = []; record().attendances = []; mount(); expect(screen.getByText('Attendance reliability', { selector: 'dt' }).parentElement).toHaveTextContent('—'); expect(screen.getByText('No task data in this period.')).toBeInTheDocument(); expect(screen.getByText('Tasks submitted', { selector: 'dt' }).parentElement).toHaveTextContent('0of 0');
});
it('profile facts, original attendance totals and attributed performance issues remain reachable', () => {
  mount(); expect(screen.getByRole('region', { name: 'Profile' })).toHaveTextContent(site.address); expect(screen.getByRole('region', { name: 'Attendance summary' })).toHaveTextContent('Records25Present24Absent1Late2'); expect(screen.getByText('Saved manager note')).toBeInTheDocument(); expect(screen.getByRole('link', { name: task.title })).toHaveAttribute('href', '/exceptions/5?returnTo=%2Fstaff%2F7');
});
it('extracted schedule, history and attendance keep their existing fields and photo links', () => {
  mount('/staff/7?month=2026-10&source=setup&tab=templates'); expect(screen.getAllByText('Saved cleaning schedule').length).toBeGreaterThan(0); expect(screen.getAllByText('Saved instructions').length).toBeGreaterThan(0); tab('Task history'); expect(screen.getAllByRole('link', { name: 'View task photos' })[0]).toHaveAttribute('href', '/verification/1?returnTo=' + encodeURIComponent('/staff/7?month=2026-10&source=setup&tab=instances')); tab('Attendance'); expect(screen.getByRole('columnheader', { name: 'Expected Shift' })).toBeInTheDocument(); expect(screen.getAllByRole('button', { name: 'Attendance context' }).length).toBeGreaterThanOrEqual(2); expect(document.querySelector('img')).toBeNull();
});
it('Urdu translates shell and overview, mirrors direction and preserves record text', () => { mount(undefined, 'ADMIN', 'ur'); expect(document.documentElement.dir).toBe('rtl'); expect(screen.getByRole('heading', { name: worker.name })).toBeInTheDocument(); expect(screen.getByText('حاضری کی باقاعدگی', { selector: 'dt' })).toBeInTheDocument(); expect(screen.getByRole('tab', { name: 'کام کی تاریخ' })).toBeInTheDocument(); expect(screen.getAllByText('worker@example.invalid')[0]).toHaveAttribute('dir', 'ltr'); });
it('principal change clears a mounted edit draft', () => { const view = mount(); fireEvent.click(screen.getByRole('button', { name: 'Edit' })); fireEvent.change(screen.getByLabelText('Full Name'), { target: { value: 'Prior draft' } }); act(() => view.store.dispatch(setUser({ id: 88, companyId: 99, role: 'ADMIN', name: 'Another owner', email: 'other@example.invalid' }))); expect(screen.queryByRole('dialog')).toBeNull(); });

it.each(['0', 'invalid'])('disabled invalid-id query %s reaches not-found instead of a perpetual skeleton', id => {
  m.detail = { isPending: true, isLoading: false, fetchStatus: 'idle' }; mount('/staff/' + id); expect(screen.getByRole('heading', { name: 'Staff member not found.' })).toBeInTheDocument(); expect(screen.getByRole('link', { name: 'Back to team' })).toHaveAttribute('href', '/staff'); expect(screen.queryByText('Loading')).toBeNull();
});
it('recent-task verification preserves the complete current profile return URL', () => {
  const path = '/staff/7?month=2026-10&tab=overview&focus=today&source=setup'; mount(path); const recent = screen.getByRole('region', { name: 'Recent tasks' }); expect(within(recent).getByRole('link')).toHaveAttribute('href', '/verification/1?returnTo=' + encodeURIComponent(path));
});
