import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { LanguageProvider } from '@/i18n/LanguageProvider';
import AttendancePage from './AttendancePage';
import { getStaffAttendance } from './api';
const mocks = vi.hoisted(() => ({ attendance: vi.fn(), locations: vi.fn(), staff: vi.fn(), get: vi.fn(), refetch: vi.fn() }));
vi.mock('./queries', () => ({ useGetAttendance: mocks.attendance }));
vi.mock('../Location/queries', () => ({ useGetLocations: mocks.locations }));
vi.mock('../Staff/queries', () => ({ useGetStaff: mocks.staff }));
vi.mock('./AttendanceContext', () => ({ default: () => <button>Attendance context</button> }));
vi.mock('@/api/client', () => ({ client: { get: mocks.get } }));
vi.mock('@/hooks/useAuth', () => ({ default: () => ({ user: { id: 1, role: 'ADMIN', companyId: 42 } }) }));
const rows = [
 { id: 1, staffId: 7, locationId: 4, date: '2026-10-28T00:00:00Z', expectedStart: '2026-10-28T03:00:00Z', expectedEnd: '2026-10-28T11:00:00Z', checkInTime: '2026-10-28T03:10:00Z', checkOutTime: '2026-10-28T11:00:00Z', status: 'CHECKED_OUT', isLateCheckIn: true, lateMinutes: 10, staff: { id: 7, name: 'Synthetic late worker', email: 'late@example.invalid' }, location: { id: 4, name: 'Synthetic Karachi' } },
 { id: 2, staffId: 8, locationId: 4, date: '2026-10-28T00:00:00Z', expectedStart: '2026-10-28T03:00:00Z', expectedEnd: '2026-10-28T11:00:00Z', checkInTime: null, checkOutTime: null, status: 'ABSENT', isLateCheckIn: false, lateMinutes: null, staff: { id: 8, name: 'Synthetic absent worker', email: 'absent@example.invalid' }, location: { id: 4, name: 'Synthetic Karachi' } },
];
function mount(language = 'en', path = '/attendance') {
 localStorage.setItem('hygene-ops.language', language);
 return render(<MemoryRouter initialEntries={[path]}><LanguageProvider><div className="workspace"><AttendancePage /></div></LanguageProvider></MemoryRouter>);
}
function choose(label: string, option: string) {
 fireEvent.keyDown(screen.getByRole('button', { name: new RegExp(`^${label}:`) }), { key: 'ArrowDown' });
 fireEvent.click(screen.getByRole('menuitemradio', { name: option }));
}
function chooseDate(label: string, value: string) {
 fireEvent.click(screen.getByRole('button', { name: new RegExp(`^${label}:`) }));
 fireEvent.click(screen.getByRole('button', { name: new Intl.DateTimeFormat('en-PK', { dateStyle: 'full', timeZone: 'UTC' }).format(new Date(`${value}T12:00:00Z`)) }));
}
beforeEach(() => {
 vi.clearAllMocks(); localStorage.clear();
 vi.setSystemTime(new Date('2026-10-28T21:30:00Z'));
 mocks.attendance.mockReturnValue({ data: { data: rows }, isPending: false, isError: false, isFetching: false, refetch: mocks.refetch });
 mocks.locations.mockReturnValue({ data: { data: [{ id: 4, name: 'Synthetic Karachi', timezone: 'Asia/Karachi' }] }, isPending: false, isError: false, refetch: mocks.refetch });
 mocks.staff.mockReturnValue({ data: { data: [{ id: 7, name: 'Synthetic late worker', locationId: 4 }] }, isPending: false, isError: false, refetch: mocks.refetch });
 mocks.get.mockResolvedValue({ data: { data: [] } });
});
afterEach(() => vi.useRealTimers());
it('derives the applied record totals from captured facts, including late staff who checked out', () => {
 mount();
 expect(screen.getByRole('heading', { name: 'Attendance records' })).toBeInTheDocument();
 const summary = screen.getByLabelText('Attendance summary');
 for (const [label, count] of [['Scheduled shifts', '2'], ['Checked in', '1'], ['Late arrivals', '1'], ['Checked out', '1']]) {
  expect(within(summary).getByText(label).parentElement?.querySelector('strong')).toHaveTextContent(count);
 }
 expect(screen.getAllByText('Asia/Karachi').length).toBeGreaterThan(0);
 expect(screen.getAllByText('10 minutes late').length).toBeGreaterThan(0);
 expect(screen.queryByText('UTC · location timezone unavailable')).not.toBeInTheDocument();
});
it('keeps draft filters until Apply and rejects reversed dates without changing the request', () => {
 mount(); const initial = mocks.attendance.mock.calls.at(-1)?.[0];
 choose('Location', 'Synthetic Karachi');
 fireEvent.click(screen.getByText('More filters')); chooseDate('From date', '2026-10-29');
 chooseDate('To date', '2026-10-28');
 expect(mocks.attendance.mock.calls.at(-1)?.[0]).toEqual(initial);
 fireEvent.submit(screen.getByRole('button', { name: 'Apply filters' }).closest('form')!);
 expect(screen.getByRole('alert')).toHaveTextContent('Choose a valid date range');
 expect(mocks.attendance.mock.calls.at(-1)?.[0]).toEqual(initial);
 chooseDate('To date', '2026-10-30');
 fireEvent.submit(screen.getByRole('button', { name: 'Apply filters' }).closest('form')!);
 expect(mocks.attendance.mock.calls.at(-1)?.[0]).toEqual({ locationId: 4, staffId: undefined, from: '2026-10-29', to: '2026-10-30' });
 expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});
it('Today uses the selected site calendar across a UTC date boundary', () => {
 mount(); choose('Location', 'Synthetic Karachi');
 fireEvent.click(screen.getByRole('button', { name: /^Today$/ }));
 expect(mocks.attendance.mock.calls.at(-1)?.[0]).toEqual({ locationId: 4, staffId: undefined, from: '2026-10-29', to: '2026-10-29' });
 fireEvent.click(screen.getByText('More filters')); expect(screen.getByRole('button', { name: /^From date: 29 Oct 2026/ })).toBeInTheDocument();
});
it('keeps month and staff filtering available as secondary controls', () => {
 mount(); fireEvent.click(screen.getByText('More filters'));
 choose('Staff', 'Synthetic late worker');
 fireEvent.change(screen.getByLabelText('Month', { selector: 'input' }), { target: { value: '2026-02' } });
 fireEvent.click(screen.getByRole('button', { name: 'Apply month' }));
 expect(mocks.attendance.mock.calls.at(-1)?.[0]).toEqual({ locationId: undefined, staffId: 7, from: '2026-02-01', to: '2026-02-28' });
 fireEvent.click(screen.getByRole('button', { name: 'Reset' }));
 expect(screen.getByRole('button', { name: 'Staff: All Staff' })).toBeInTheDocument();
});
it('does not present a failed attendance read as zero totals or an empty register', () => {
 mocks.attendance.mockReturnValue({ isPending: false, isError: true, error: { response: { status: 403 } }, refetch: mocks.refetch });
 mount(); expect(screen.getByRole('alert')).toHaveTextContent('You do not have access');
 expect(screen.getByLabelText('Attendance summary').querySelectorAll('strong')).toHaveLength(4);
 for (const count of screen.getByLabelText('Attendance summary').querySelectorAll('strong')) expect(count).toHaveTextContent('—');
 expect(screen.queryByText('No attendance records found for the selected filters.')).not.toBeInTheDocument();
 fireEvent.click(screen.getByRole('button', { name: /^Retry$/ })); expect(mocks.refetch).toHaveBeenCalledOnce();
});
it('keeps the operational filter frame while initial records are loading', () => {
 mocks.attendance.mockReturnValue({ isPending: true, isError: false, isFetching: true, refetch: mocks.refetch });
 mount(); expect(screen.getByLabelText('Attendance summary')).toHaveAttribute('aria-busy', 'true');
 fireEvent.click(screen.getByText('More filters')); expect(screen.getByRole('button', { name: /^From date:/ })).toBeInTheDocument();
 expect(screen.getByRole('button', { name: 'Refreshing…' })).toBeDisabled();
});
it('renders complete Urdu register controls and RTL without translating configured names', () => {
 mount('ur'); expect(document.documentElement.dir).toBe('rtl');
 expect(screen.getByRole('heading', { name: 'حاضری کے ریکارڈ' })).toBeInTheDocument();
 fireEvent.click(screen.getByText('مزید فلٹر')); expect(screen.getByRole('button', { name: /^آغاز کی تاریخ:/ })).toBeInTheDocument();
 expect(screen.getByRole('columnheader', { name: 'آمد' })).toBeInTheDocument();
 expect(screen.getByRole('columnheader', { name: 'روانگی' })).toBeInTheDocument();
 expect(screen.getByRole('button', { name: 'فلٹر لگائیں' })).toBeInTheDocument();
 expect(screen.getAllByText('Synthetic late worker').length).toBeGreaterThan(0);
});
it('passes locationId to the existing authorized API rather than filtering a tenant-wide browser result', async () => {
 await getStaffAttendance({ locationId: 4, staffId: 7, from: '2026-10-28', to: '2026-10-29' });
 expect(mocks.get).toHaveBeenCalledWith('/attendance/', { params: { locationId: 4, staffId: 7, from: '2026-10-28', to: '2026-10-29' } });
});

it('consumes dashboard site and date links as actual API filters without losing the applied range', () => {
 mount('en', '/attendance?locationId=4&from=2026-10-20&to=2026-10-21');
 expect(mocks.attendance.mock.calls.at(-1)?.[0]).toEqual({locationId:4,staffId:undefined,from:'2026-10-20',to:'2026-10-21'});
 expect(screen.getByRole('button', { name: 'Location: Synthetic Karachi' })).toBeInTheDocument(); fireEvent.click(screen.getByText('More filters')); expect(screen.getByRole('button', { name: /^From date: 20 Oct 2026/ })).toBeInTheDocument();
});
it('rejects invalid deep-link IDs and impossible or reversed calendar ranges before requesting records', () => {
 mount('en', '/attendance?locationId=-4&staffId=0&from=2026-02-30&to=2026-02-01');
 expect(mocks.attendance.mock.calls.at(-1)?.[0]).toEqual({locationId:undefined,staffId:undefined,from:'2026-10-28',to:'2026-10-28'});
});
