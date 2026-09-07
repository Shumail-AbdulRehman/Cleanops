import type { ReactNode } from 'react';
import { configureStore } from '@reduxjs/toolkit';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { Provider } from 'react-redux';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import authReducer, { setUser } from '@/store/slices/authSlice';
import { LanguageProvider } from '@/i18n/LanguageProvider';
import { translate } from '@/i18n/translations';
import StaffAttendanceTab, { type StaffAttendanceRow } from './StaffAttendanceTab';
import StaffTasksTab, { type StaffTaskInstanceRow } from './StaffTasksTab';
import StaffScheduleTab, { type StaffTaskTemplateRow } from './StaffScheduleTab';
import StaffDetailPage from './StaffDetailPage';
import type { StaffProfileData } from './StaffOverviewTab';

const m = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), create: vi.fn(), revoke: vi.fn(), details: {} as Record<string, unknown>, args: vi.fn(), retry: vi.fn() }));
vi.mock('@/api/client', () => ({ client: { get: m.get, post: m.post } }));
vi.mock('./queries', () => ({ useGetStaffDetails: (id: number, filters: unknown) => { m.args(id, filters); return m.details; }, useEditStaff: () => ({ mutateAsync: vi.fn(), isPending: false }) }));
vi.mock('../Location/queries', () => ({ useGetLocations: () => ({ data: { data: [site] } }) }));
const site = { id: 20, name: 'Recorded site', timezone: 'Asia/Karachi', isActive: true };
const attendance: StaffAttendanceRow = {
  id: 12, date: '2026-10-20T00:00:00Z', status: 'CHECKED_OUT', location: site,
  expectedStart: '2026-10-20T03:00:00Z', expectedEnd: '2026-10-20T11:00:00Z',
  checkInTime: '2026-10-20T03:07:00Z', checkOutTime: '2026-10-20T11:03:00Z', isLateCheckIn: true, lateMinutes: 7,
  checkInPhoto: { state: 'AVAILABLE', path: '/attendance/12/photos/check-in' },
  checkOutPhoto: { state: 'AVAILABLE', path: '/attendance/12/photos/check-out' },
};
const task: StaffTaskInstanceRow = {
  id: 31, title: 'Recorded cleaning', location: site, date: attendance.date, shiftStart: attendance.expectedStart, shiftEnd: attendance.expectedEnd,
  status: 'COMPLETED', staffSubmittedAt: '2026-10-20T10:50:00Z', verificationVersion: 2, verificationState: 'PROCESSING',
  isLate: true, startedAt: attendance.checkInTime, completedAt: attendance.checkOutTime, completionTiming: 'ON_TIME_SERVER_OBSERVED',
};
const schedule: StaffTaskTemplateRow = { id: 8, title: 'Recorded schedule', description: 'Recorded instructions', location: site, shiftStart: attendance.expectedStart, shiftEnd: attendance.expectedEnd, isActive: true, recurringType: 'DAILY', effectiveDate: attendance.date };
const worker: StaffProfileData = {
  id: 7, name: 'Recorded worker', email: 'worker@example.invalid', phone: '03001234567', role: 'STAFF', isActive: true,
  locationId: 20, location: site, shiftStart: attendance.expectedStart, shiftEnd: attendance.expectedEnd, createdAt: '2026-10-20T00:00:00Z', periodLabel: 'October 2026',
  taskStats: { totalTemplates: 1, totalInstances: 1, completed: 1, pending: 0, inProgress: 0, missed: 0 },
  attendanceStats: { totalRecords: 1, present: 1, absent: 0, late: 1 }, taskTemplates: [schedule], taskInstances: [task], attendances: [attendance],
};
function Path() { const location = useLocation(); return <output aria-label="Current route">{location.pathname + location.search}</output>; }
function mount(children: ReactNode, language: 'en' | 'ur' = 'en', path = '/staff/7?month=2026-10&tab=instances&source=setup') {
  localStorage.setItem('hygene-ops.language', language);
  const store = configureStore({ reducer: { auth: authReducer } });
  store.dispatch(setUser({ id: 2, companyId: 42, role: 'ADMIN', name: 'Recorded owner', email: 'owner@example.invalid' }));
  const query = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } } });
  const tree = (content: ReactNode) => <Provider store={store}><QueryClientProvider client={query}><LanguageProvider><MemoryRouter initialEntries={[path]}><div className="workspace">{content}<Path /></div></MemoryRouter></LanguageProvider></QueryClientProvider></Provider>;
  const view = render(tree(children));
  return { ...view, store, query, change: (content: ReactNode) => view.rerender(tree(content)) };
}
const mountAttendance = (rows = [attendance], language: 'en' | 'ur' = 'en') => mount(<StaffAttendanceTab staff={{ attendances: rows }} displayPeriod="October 2026" />, language);
const mountTasks = (rows = [task]) => mount(<StaffTasksTab staff={{ taskInstances: rows }} displayPeriod="October 2026" id="7" searchParams={new URLSearchParams('month=2026-10&tab=instances&source=setup&focus=today')} />);
const mountSchedule = (rows = [schedule]) => mount(<StaffScheduleTab staff={{ taskTemplates: rows }} />);
const dataRows = () => within(screen.getByRole('table')).getAllByRole('row').slice(1);
const openRecord = () => fireEvent.click(dataRows()[0]);
const loaded = () => screen.findByText('No context has been recorded.');
beforeEach(() => {
  vi.clearAllMocks(); localStorage.clear();
  m.details = { data: { data: structuredClone(worker) }, isLoading: false, isFetching: false, isError: false, refetch: m.retry };
  const OriginalURL = URL;
  m.create.mockReturnValue('blob:synthetic-attendance');
  vi.stubGlobal('URL', class extends OriginalURL { static createObjectURL = m.create; static revokeObjectURL = m.revoke; });
  m.get.mockImplementation(async (path: string) => path.includes('/photos/') ? { data: new Blob(['synthetic bytes'], { type: 'image/jpeg' }) } : { data: { data: { attendanceId: 12, items: [], nextCursor: null } } });
  m.post.mockResolvedValue({ data: { data: { annotation: {}, reused: false } } });
});
afterEach(() => vi.unstubAllGlobals());

it('attendance has time/camera cells, no photo columns, and no eager protected requests', () => {
  mountAttendance();
  for (const label of ['Check-In Photo', 'Check-Out Photo']) expect(screen.queryByRole('columnheader', { name: label })).toBeNull();
  for (const label of ['Check In', 'Check Out', 'Expected Shift', 'Late', 'Location']) expect(screen.getByRole('columnheader', { name: label })).toBeInTheDocument();
  expect(screen.getAllByRole('img', { name: 'Photo available' })).toHaveLength(2);
  expect(dataRows()[0]).toHaveTextContent('08:00 – 16:00'); expect(dataRows()[0]).toHaveTextContent('7 min late');
  expect(document.querySelector('img')).toBeNull(); expect(m.get).not.toHaveBeenCalled();
});
it('row opens the real shared record panel, requests only its photos/context, and marks selection', async () => {
  mountAttendance(); const row = dataRows()[0]; openRecord(); await loaded(); expect(row).toHaveAttribute('aria-selected', 'true');
  expect(screen.getByRole('dialog', { name: 'Attendance context · #12' })).toHaveAttribute('aria-modal', 'true');
  expect(screen.getByRole('region', { name: 'Original captured facts' })).toHaveTextContent('Recorded site');
  for (const kind of ['check-in', 'check-out']) expect(m.get).toHaveBeenCalledWith(`/attendance/12/photos/${kind}`, { responseType: 'blob', signal: expect.any(AbortSignal) });
  expect(m.get).toHaveBeenCalledWith('/attendance/12/annotations', { params: { limit: 25 }, signal: expect.any(AbortSignal) });
});
it.each(['Enter', ' '])('attendance row supports keyboard %s', async key => { mountAttendance(); const row = dataRows()[0]; row.focus(); fireEvent.keyDown(row, { key }); await loaded(); expect(screen.getByRole('dialog')).toBeInTheDocument(); });
it('explicit attendance action opens and Escape returns focus to the opener', async () => {
  mountAttendance(); const trigger = screen.getByRole('button', { name: 'Attendance context' }); trigger.focus(); fireEvent.click(trigger); await loaded();
  fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' }); await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull()); expect(trigger).toHaveFocus();
});
it('row opening returns focus to its row on close and releases protected bytes', async () => {
  mountAttendance(); const row = dataRows()[0]; openRecord(); await loaded(); await waitFor(() => expect(m.create).toHaveBeenCalledTimes(2));
  fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' }); await waitFor(() => expect(row).toHaveFocus()); expect(document.querySelector('img')).toBeNull(); expect(m.revoke).toHaveBeenCalledTimes(2);
});
it('closing and reopening the same selected record preserves its note draft', async () => {
  mountAttendance(); openRecord(); await loaded(); fireEvent.change(screen.getByRole('textbox', { name: 'Reason (required)' }), { target: { value: 'Kept draft' } });
  fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' }); await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull()); openRecord(); await loaded(); expect(screen.getByRole('textbox', { name: 'Reason (required)' })).toHaveValue('Kept draft');
});
it('selecting a different record clears the previous note draft', async () => {
  mountAttendance([attendance, { ...attendance, id: 13, checkInPhoto: { state: 'NONE', path: null }, checkOutPhoto: { state: 'NONE', path: null } }]);
  openRecord(); await loaded(); fireEvent.change(screen.getByRole('textbox', { name: 'Reason (required)' }), { target: { value: 'First record draft' } }); fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' }); await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  fireEvent.click(dataRows()[1]); await loaded(); expect(screen.getByRole('dialog', { name: 'Attendance context · #13' })).toBeInTheDocument(); expect(screen.getByRole('textbox', { name: 'Reason (required)' })).toHaveValue('');
});
it('same-record refresh keeps the note focused and displays updated captured fields', async () => {
  const view = mountAttendance(); openRecord(); await loaded(); const reason = screen.getByRole('textbox', { name: 'Reason (required)' }); fireEvent.change(reason, { target: { value: 'Kept draft' } }); reason.focus();
  view.change(<StaffAttendanceTab staff={{ attendances: [{ ...attendance, location: { ...site, name: 'Updated site' } }] }} displayPeriod="October 2026" />);
  expect(reason).toHaveFocus(); expect(reason).toHaveValue('Kept draft'); expect(screen.getByRole('region', { name: 'Original captured facts' })).toHaveTextContent('Updated site');
});
it('unavailable/legacy photos have no camera markers or protected request', async () => {
  mountAttendance([{ ...attendance, checkInPhoto: { state: 'NONE', path: null }, checkOutPhoto: { state: 'LEGACY_RESTRICTED', path: 'https://invalid.example/secret' } }]); expect(screen.queryByRole('img', { name: 'Photo available' })).toBeNull(); openRecord(); await loaded(); expect(m.get.mock.calls.filter(([path]) => path.includes('/photos/'))).toHaveLength(0);
});
it('on-time and absent rows preserve timing and missing-value meaning', () => {
  mountAttendance([{ ...attendance, isLateCheckIn: false }, { ...attendance, id: 13, status: 'ABSENT', checkInTime: null, checkOutTime: null, isLateCheckIn: false }]); expect(dataRows()[0]).toHaveTextContent('On time'); expect(dataRows()[1]).toHaveTextContent('Not checked in'); expect(dataRows()[1]).not.toHaveTextContent('On time');
});
it('attendance keeps client pagination at 20 rows', () => {
  mountAttendance(Array.from({ length: 21 }, (_, i) => ({ ...attendance, id: i + 1 }))); expect(dataRows()).toHaveLength(20); fireEvent.click(screen.getByRole('button', { name: 'Next' })); expect(dataRows()).toHaveLength(1); expect(screen.getByText('Page 2 of 2')).toBeInTheDocument();
});
it('task photo/status links keep all period and return URL fields', () => {
  mountTasks(); const href = '/verification/31?returnTo=' + encodeURIComponent('/staff/7?month=2026-10&tab=instances&source=setup&focus=today');
  expect(screen.getByRole('link', { name: 'View task photos' })).toHaveAttribute('href', href); expect(screen.getByRole('link', { name: 'Completed · Verification pending' })).toHaveAttribute('href', href);
  expect(screen.getByText('Recent filtered task execution for October 2026.')).toBeInTheDocument(); expect(document.querySelector('img')).toBeNull(); expect(m.get).not.toHaveBeenCalled();
});
it('task rows preserve local shift, execution times, late start and separate submission/verification facts', () => {
  mountTasks(); const row = dataRows()[0]; expect(row).toHaveTextContent('08:00 – 16:00'); expect(row).toHaveTextContent('08:07'); expect(row).toHaveTextContent('16:03'); expect(row).toHaveTextContent('Late start'); expect(row).toHaveTextContent('Work submitted'); expect(row).toHaveTextContent('Completed · Verification pending'); expect(row).toHaveTextContent('Evidence received on time'); expect(screen.queryByText('Verified complete')).toBeNull();
});
it('legacy proof count and every photo remain reachable without eager thumbnails', () => {
  mountTasks([{ ...task, verificationVersion: 1, proofImageUrls: ['https://invalid.example/proof-1', 'https://invalid.example/proof-2'] }]);
  expect(screen.getByRole('link', { name: 'View task photos 1' })).toHaveAttribute('href', 'https://invalid.example/proof-1'); expect(screen.getByRole('link', { name: 'View task photos 2' })).toHaveAttribute('href', 'https://invalid.example/proof-2'); expect(within(dataRows()[0]).getAllByRole('cell').at(-1)).toHaveTextContent(/^Proof2View task photos/); expect(document.querySelector('img')).toBeNull();
});
it('zero legacy proof is a real zero; version 2 does not invent a count', () => {
  mountTasks([{ ...task, id: 1, verificationVersion: 1, proofImageUrls: [] }, task]);
  expect(within(dataRows()[0]).getAllByRole('cell').at(-1)).toHaveTextContent(/^Proof0$/); expect(within(dataRows()[1]).getAllByRole('cell').at(-1)).toHaveTextContent(/^ProofView task photos$/);
});
it('task history retains 20-row pagination', () => { mountTasks(Array.from({ length: 21 }, (_, i) => ({ ...task, id: i + 1 }))); expect(dataRows()).toHaveLength(20); fireEvent.click(screen.getByRole('button', { name: 'Next' })); expect(dataRows()).toHaveLength(1); });
it('schedule renders saved rows, instructions, local shifts, recurrence and account-independent status', () => {
  mountSchedule(); const row = dataRows()[0]; for (const text of ['Recorded schedule', 'Recorded instructions', 'Recorded site', '08:00 – 16:00', 'Daily', 'Active']) expect(row).toHaveTextContent(text); expect(m.get).not.toHaveBeenCalled();
});
it.each(['Cleaning schedule', 'Location', 'Effective'])('schedule retains %s sorting', label => {
  mountSchedule([schedule, { ...schedule, id: 9, title: 'A first schedule', location: { ...site, name: 'A first site' }, effectiveDate: '2026-01-01' }]); fireEvent.click(screen.getByRole('button', { name: label })); expect(dataRows()[0]).toHaveTextContent('A first schedule'); fireEvent.click(screen.getByRole('button', { name: label })); expect(dataRows()[0]).toHaveTextContent('Recorded schedule');
});
it('schedule retains inactive/once records and missing-field dashes', () => {
  mountSchedule([{ ...schedule, isActive: false, recurringType: null, description: null, location: null, shiftStart: null, shiftEnd: null, effectiveDate: null }]); expect(dataRows()[0]).toHaveTextContent('Inactive'); expect(dataRows()[0]).toHaveTextContent('Once'); expect(dataRows()[0]).toHaveTextContent('—');
});
it('schedule keeps 20-row pagination', () => { mountSchedule(Array.from({ length: 21 }, (_, i) => ({ ...schedule, id: i + 1 }))); expect(dataRows()).toHaveLength(20); fireEvent.click(screen.getByRole('button', { name: 'Next' })); expect(dataRows()).toHaveLength(1); });
it.each(['attendance', 'tasks', 'schedule'])('%s empty state explains the missing records', tab => {
  if (tab === 'attendance') mountAttendance([]); else if (tab === 'tasks') mountTasks([]); else mountSchedule([]);
  expect(screen.getByRole('heading', { name: 'Nothing here yet.' })).toBeInTheDocument(); expect(screen.queryByRole('table')).toBeNull(); expect(m.get).not.toHaveBeenCalled();
});
it('Urdu attendance mirrors language, translates headings and retains saved record names', () => {
  mountAttendance(undefined, 'ur'); expect(document.documentElement.dir).toBe('rtl'); expect(screen.getByRole('columnheader', { name: translate('Expected Shift', 'ur') })).toBeInTheDocument(); expect(screen.getByText('Recorded site')).toHaveProperty('tagName', 'BDI'); expect(screen.getAllByRole('img', { name: translate('Photo available', 'ur') })).toHaveLength(2);
});
it('parent period filtering remains request-backed and preserves active tab/unrelated URL scope', () => {
  mount(<Routes><Route path="/staff/:id" element={<StaffDetailPage />} /></Routes>);
  fireEvent.click(screen.getByRole('button', { name: 'Today' })); const today = new Date().toISOString().slice(0, 10); expect(m.args).toHaveBeenLastCalledWith(7, { dateFrom: today, dateTo: today }); const route = screen.getByLabelText('Current route').textContent!; expect(route).toContain('tab=instances'); expect(route).toContain('source=setup'); expect(route).not.toContain('month='); expect(screen.getByRole('link', { name: 'View task photos' })).toHaveAttribute('href', '/verification/31?returnTo=' + encodeURIComponent(route));
});
it('parent initial error/retry and loading remain available for the changed tabs', () => {
  m.details = { isError: true, error: new Error('network'), refetch: m.retry }; const view = mount(<Routes><Route path="/staff/:id" element={<StaffDetailPage />} /></Routes>); fireEvent.click(screen.getByRole('button', { name: 'Retry' })); expect(m.retry).toHaveBeenCalledOnce(); expect(screen.getByRole('alert')).toHaveTextContent('Your saved records have not changed.');
  m.details = { isLoading: true }; view.change(<Routes><Route path="/staff/:id" element={<StaffDetailPage />} /></Routes>); expect(screen.getAllByRole('status').some(node => node.getAttribute('aria-busy') === 'true')).toBe(true); expect(screen.queryByRole('table')).toBeNull();
});
it('denied parent refresh hides an open record and its protected content', async () => {
  const view = mount(<Routes><Route path="/staff/:id" element={<StaffDetailPage />} /></Routes>, 'en', '/staff/7?tab=attendance'); openRecord(); await loaded();
  m.details.isError = true; m.details.error = { response: { status: 403 } }; act(() => view.change(<Routes><Route path="/staff/:id" element={<StaffDetailPage />} /></Routes>)); expect(screen.queryByRole('dialog')).toBeNull(); expect(document.querySelector('img')).toBeNull(); expect(screen.queryByRole('table')).toBeNull();
});
