import { beforeEach, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { configureStore } from '@reduxjs/toolkit';
import { Provider } from 'react-redux';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { LanguageProvider } from '@/i18n/LanguageProvider';
import { WorkspaceTheme } from '@/components/common/WorkspaceTheme';
import authReducer, { setUser } from '@/store/slices/authSlice';
import Templates from '@/pages/Location/components/LocationTemplatesTab';
import LocationScheduleTab from '@/pages/Location/components/LocationScheduleTab';
import type { TaskTemplate } from '@/pages/Location/types';
import type { LocationSchedule } from '@/pages/Location/scheduleTypes';
const m = vi.hoisted(() => ({ edit: vi.fn(), assign: vi.fn(), remove: vi.fn(), areas: vi.fn(), schedule: vi.fn() }));
vi.mock('@/pages/Task/queries', () => ({ useEditTaskTemplate: () => ({ mutate: m.edit }), useDeleteTaskTemplate: () => ({ mutateAsync: m.remove }) }));
vi.mock('@/pages/Assignment/queries', () => ({ useAssignStaffToTemplate: () => ({ mutate: m.assign }) }));
vi.mock('@/pages/Area/api', () => ({ getAreas: m.areas, getArea: vi.fn() }));
vi.mock('@/pages/Location/api', async importOriginal => ({ ...await importOriginal<typeof import('@/pages/Location/api')>(), getLocationSchedule: m.schedule }));
const base: TaskTemplate = { id: 1, title: 'Saved daily', shiftStart: '2026-11-09T04:00:00Z', shiftEnd: '2026-11-09T05:00:00Z', effectiveDate: '2026-11-09T00:00:00Z', recurringType: 'DAILY', isActive: true };
const staff = [7, 8].map(id => ({ id, name: `Saved worker ${id}`, email: `${id}@example.invalid`, shiftStart: null, shiftEnd: null, isActive: true }));
function Path() { return <output aria-label="Route">{useLocation().search}</output>; }
function mount(node: React.ReactNode, language = 'en', route = '/locations/20?tab=templates&week=2026-11-09&source=setup') {
  localStorage.setItem('hygene-ops.language', language);
  const store = configureStore({ reducer: { auth: authReducer } });
  store.dispatch(setUser({ id: 2, companyId: 42, role: 'ADMIN', name: 'Saved owner', email: 'owner@example.invalid' }));
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return { ...render(<Provider store={store}><QueryClientProvider client={queryClient}><LanguageProvider><WorkspaceTheme.Provider value><MemoryRouter initialEntries={[route]}><div className="workspace">{node}<Path /></div></MemoryRouter></WorkspaceTheme.Provider></LanguageProvider></QueryClientProvider></Provider>), queryClient };
}
function grid(template = base, zone = 'Asia/Karachi', week = '2026-11-09', language = 'en') {
  mount(
    <Templates templates={[template]} staffList={staff} timeZone={zone} locationId={20} locationName="Saved site" />,
    language,
    `/locations/20?tab=templates&week=${week}&view=week`,
  );
  const table = within(screen.getByRole('table', { name: language === 'ur' ? 'ہفتہ' : 'Week' }));
  const row = table.getByRole('row', { name: /Saved worker 7/ });
  return { cells: within(row).getAllByRole('cell'), table };
}
function schedules(templates = [base]) { return mount(<Templates templates={templates} staffList={staff} locationId={20} timeZone="Asia/Karachi" locationName="Saved site" />); }
function openEditor() {
  const opener = screen.getByRole('button', { name: /Saved daily/ });
  opener.focus();
  fireEvent.click(opener);
  fireEvent.click(screen.getByRole('button', { name: 'Edit schedule' }));
  return opener;
}
beforeEach(() => {
  vi.clearAllMocks(); m.schedule.mockReset(); localStorage.clear(); m.areas.mockResolvedValue([]);
  m.edit.mockImplementation((_input, cb) => cb.onSuccess({})); m.assign.mockImplementation((_input, cb) => cb.onSuccess({}));
});
it('places daily blocks on all seven local days, including both weekend days', () => {
  const { cells, table } = grid({ ...base, staffId: 7 });
  expect(cells).toHaveLength(7);
  for (const cell of cells) expect(within(cell).getByRole('button')).toHaveTextContent('09:00');
  expect(table.getByRole('columnheader', { name: /Sat,? 14 Nov/ })).toBeInTheDocument();
  expect(table.getByRole('columnheader', { name: /Sun,? 15 Nov/ })).toBeInTheDocument();
});
it('starts daily blocks at the inclusive effective date', () => {
  const { cells } = grid({ ...base, staffId: 7, effectiveDate: '2026-11-12T00:00:00Z' });
  expect(cells.slice(0, 3).every(cell => !within(cell).queryByRole('button'))).toBe(true);
  expect(cells.slice(3).every(cell => within(cell).queryByRole('button'))).toBe(true);
});
it('honors an available inclusive recurrence end without adding later occurrences', () => {
  const template = { ...base, staffId: 7, recurringEndDate: '2026-11-11T00:00:00Z' };
  const { cells } = grid(template); expect(cells.filter(cell => within(cell).queryByRole('button'))).toHaveLength(3);
});
it('places a one-time block only on its effective local day', () => {
  const { cells } = grid({ ...base, staffId: 7, recurringType: 'ONCE', effectiveDate: '2026-11-14T00:00:00Z' });
  expect(cells.filter(cell => within(cell).queryByRole('button'))).toHaveLength(1);
  expect(within(cells[5]).getByRole('button')).toHaveTextContent('09:00');
});
it('does not repeat a one-time schedule in a later week', () => {
  const { cells } = grid({ ...base, staffId: 7, recurringType: 'ONCE' }, 'Asia/Karachi', '2026-11-16');
  expect(cells.every(cell => !within(cell).queryByRole('button'))).toBe(true);
});
it('places a Friday overnight occurrence on Friday and shows its end time in details', () => {
  const { cells } = grid({ ...base, staffId: 7, recurringType: 'ONCE', effectiveDate: '2026-11-13T00:00:00Z', shiftStart: '2026-11-13T17:00:00Z', shiftEnd: '2026-11-13T01:00:00Z' });
  const block = within(cells[4]).getByRole('button', { name: /22:00 Saved daily/ });
  expect(within(cells[5]).queryByRole('button')).not.toBeInTheDocument();
  expect(within(cells[6]).queryByRole('button')).not.toBeInTheDocument();
  fireEvent.click(block);
  expect(within(screen.getByRole('dialog')).getByText('22:00–06:00', { exact: true })).toBeInTheDocument();
});
it('keeps an overnight Sunday schedule in the previous week', () => {
  const { cells } = grid({ ...base, staffId: 7, recurringType: 'ONCE', effectiveDate: '2026-11-08T00:00:00Z', shiftStart: '2026-11-08T17:00:00Z', shiftEnd: '2026-11-08T01:00:00Z' });
  expect(cells.every(cell => !within(cell).queryByRole('button'))).toBe(true);
});
it('shows one start per day for daily overnight shifts from the effective date', () => {
  const { cells } = grid({ ...base, staffId: 7, effectiveDate: '2026-11-10T00:00:00Z', shiftStart: '2026-11-09T17:00:00Z', shiftEnd: '2026-11-09T01:00:00Z' });
  expect(within(cells[0]).queryByRole('button')).not.toBeInTheDocument();
  for (const cell of cells.slice(1)) {
    expect(within(cell).getByRole('button')).toHaveTextContent('22:00');
  }
});
it('keeps a chosen-days overnight shift on its scheduled start day', () => {
  const { cells } = grid({
    ...base, staffId: 7, repeatDays: ['MON'], shiftStart: '2026-11-09T17:00:00Z', shiftEnd: '2026-11-09T01:00:00Z',
  });
  expect(within(cells[0]).getByRole('button')).toHaveTextContent('22:00');
  expect(cells.slice(1).every(cell => !within(cell).queryByRole('button'))).toBe(true);
});
it('shows the midnight end in details without a next-day block', () => {
  const { cells } = grid({ ...base, staffId: 7, recurringType: 'ONCE', shiftStart: '2026-11-09T17:00:00Z', shiftEnd: '2026-11-09T19:00:00Z' });
  expect(within(cells[1]).queryByRole('button')).not.toBeInTheDocument();
  fireEvent.click(within(cells[0]).getByRole('button', { name: /22:00 Saved daily/ }));
  expect(within(screen.getByRole('dialog')).getByText('22:00–00:00', { exact: true })).toBeInTheDocument();
});
it('keeps inactive schedules readable without week occurrences', () => {
  const { cells } = grid({ ...base, staffId: 7, isActive: false });
  expect(cells.every(cell => !within(cell).queryByRole('button'))).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: 'List' }));
  expect(screen.getByRole('button', { name: /Saved daily/ })).toHaveTextContent('Inactive');
});
it.each([{ shiftStart: null, savedTime: '10:00' }, { shiftEnd: null, savedTime: '09:00' }])('keeps schedules with partial times readable without fabricating a range: %j', ({ savedTime, ...change }) => {
  const { cells } = grid({ ...base, staffId: 7, ...change });
  fireEvent.click(within(cells[0]).getByRole('button', { name: /Saved daily/ }));
  const details = within(screen.getByRole('dialog'));
  expect(details.getByText(savedTime, { selector: 'strong > bdi' })).toBeInTheDocument();
  expect(details.queryByText('09:00–10:00')).not.toBeInTheDocument();
});
it('uses the location clock rather than UTC for times and date fallback', () => {
  const { cells } = grid({ ...base, staffId: 7, effectiveDate: null, recurringType: 'ONCE', shiftStart: '2026-11-10T01:00:00Z', shiftEnd: '2026-11-10T02:00:00Z' }, 'America/Los_Angeles');
  expect(within(cells[0]).getByRole('button')).toHaveTextContent('17:00');
  expect(within(cells[1]).queryByRole('button')).not.toBeInTheDocument();
  fireEvent.click(within(cells[0]).getByRole('button'));
  expect(within(screen.getByRole('dialog')).getByText('17:00–18:00', { exact: true })).toBeInTheDocument();
});
it('opens the saved template from its block without mutating its record', () => {
  const template = { ...base, staffId: 7 };
  const before = structuredClone(template);
  const { cells } = grid(template);
  fireEvent.click(within(cells[0]).getByRole('button'));
  expect(screen.getByRole('dialog', { name: /Saved daily/ })).toBeInTheDocument();
  expect(template).toEqual(before);
  expect(m.edit).not.toHaveBeenCalled();
});
it('week navigation preserves the tab, source and unrelated URL values', () => {
  schedules(); fireEvent.click(screen.getByRole('button', { name: 'Next week' })); expect(screen.getByLabelText('Route')).toHaveTextContent('week=2026-11-16'); expect(screen.getByLabelText('Route')).toHaveTextContent('source=setup');
  fireEvent.click(screen.getByRole('button', { name: 'Previous week' })); expect(screen.getByLabelText('Route')).toHaveTextContent('week=2026-11-09');
  fireEvent.click(screen.getByRole('button', { name: 'This week' })); expect(screen.getByLabelText('Route')).not.toHaveTextContent('week='); expect(screen.getByLabelText('Route')).toHaveTextContent('tab=templates');
});
it('empty schedules teach creation through the existing URL-backed wizard', async () => {
  schedules([]); expect(screen.getByRole('heading', { name: 'No cleaning schedules yet' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Add the first schedule' })); expect(await screen.findByRole('dialog', { name: 'Create cleaning schedule' })).toBeInTheDocument(); expect(screen.getByLabelText('Route')).toHaveTextContent('newSchedule=1');
});
it.each([
  { language: 'en', title: 'No cleaning schedules yet', message: 'A schedule says what gets cleaned, by whom, at what time and on which days. Tasks are then created for each day automatically.', action: 'Add the first schedule', panel: 'Create cleaning schedule', close: 'Close' },
  { language: 'ur', title: 'ابھی صفائی کا کوئی شیڈول نہیں ہے', message: 'شیڈول میں طے ہوتا ہے کہ کس چیز کی صفائی کون کرے گا، کس وقت اور کن دنوں میں۔ پھر ہر مقررہ دن کے کام خود بخود بن جاتے ہیں۔', action: 'پہلا شیڈول شامل کریں', panel: 'صفائی کا شیڈول بنائیں', close: 'بند کریں' },
])('empty schedule guidance and its scoped creation action work in $language', async ({ language, title, message, action, panel, close }) => {
  mount(<Templates templates={[]} staffList={staff} locationId={20} timeZone="Asia/Karachi" locationName="Saved site" />, language);
  const heading = screen.getByRole('heading', { level: 3, name: title });
  const emptyState = within(heading.parentElement!);
  expect(emptyState.getByText(message)).toBeInTheDocument();
  expect(screen.queryByRole('table')).not.toBeInTheDocument();
  if (language === 'ur') {
    expect(screen.queryByText('No cleaning schedules yet')).not.toBeInTheDocument();
    expect(screen.queryByText('A schedule says what gets cleaned, by whom, at what time and on which days. Tasks are then created for each day automatically.')).not.toBeInTheDocument();
  }
  const opener = emptyState.getByRole('button', { name: action });
  opener.focus();
  fireEvent.click(opener);
  const dialog = await screen.findByRole('dialog', { name: panel });
  expect(within(dialog).getByText('Saved site')).toBeInTheDocument();
  expect(within(dialog).getByText('Asia/Karachi')).toBeInTheDocument();
  expect(m.areas).toHaveBeenCalledWith(20);
  expect(screen.getByLabelText('Route')).toHaveTextContent('?tab=templates&week=2026-11-09&source=setup&newSchedule=1');
  fireEvent.click(within(dialog).getByRole('button', { name: close }));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  expect(screen.getByLabelText('Route')).toHaveTextContent('?tab=templates&week=2026-11-09&source=setup');
  expect(screen.getByLabelText('Route')).not.toHaveTextContent('newSchedule');
  expect(opener).toHaveFocus();
});
it('edit serializes changed times through wallTimeToIso in the saved location timezone', async () => {
  schedules(); openEditor();
  fireEvent.change(screen.getByLabelText('Shift start'), { target: { value: '11:30' } }); fireEvent.change(screen.getByLabelText('Shift end'), { target: { value: '12:30' } }); fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
  await waitFor(() => expect(m.edit).toHaveBeenCalledTimes(1)); expect(m.edit.mock.calls[0][0]).toEqual({ id: 1, data: { shiftStart: '2026-11-09T06:30:00.000Z', shiftEnd: '2026-11-09T07:30:00.000Z' } });
});
it('validates changed effective dates inline while keeping the draft', () => {
  schedules(); openEditor(); fireEvent.change(screen.getByLabelText('Effective from'), { target: { value: '2020-01-01' } });
  expect(screen.getByLabelText('Effective from')).toHaveAttribute('aria-invalid', 'true'); expect(screen.getByRole('alert')).toBeInTheDocument(); expect(m.edit).not.toHaveBeenCalled(); expect(screen.getByLabelText('Schedule title')).toHaveValue(base.title);
});
it('keeps the saved historical effective date valid for unrelated edits', async () => {
  schedules(); openEditor();
  expect(screen.getByLabelText('Effective from')).not.toHaveAttribute('min');
  fireEvent.change(screen.getByLabelText('Schedule title'), { target: { value: 'Updated saved title' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
  await waitFor(() => expect(m.edit).toHaveBeenCalledTimes(1));
  expect(m.edit.mock.calls[0][0]).toEqual({ id: base.id, data: { title: 'Updated saved title' } });
});
it('saves a changed effective date as a UTC calendar date rather than a local instant', async () => {
  schedules(); openEditor();
  fireEvent.change(screen.getByLabelText('Effective from'), { target: { value: '2099-01-02' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
  await waitFor(() => expect(m.edit).toHaveBeenCalledTimes(1));
  expect(m.edit.mock.calls[0][0]).toEqual({ id: base.id, data: { effectiveDate: '2099-01-02T00:00:00.000Z' } });
});
it('preserves partial-save guidance and retries only the unresolved staff assignment', async () => {
  m.assign.mockImplementationOnce((_input, cb) => cb.onError(new Error('unconfirmed')));
  schedules([{ ...base, staffId: 7 }]); openEditor();
  expect(screen.getByRole('option', { name: 'Unassigned' })).toBeDisabled();
  fireEvent.change(screen.getByLabelText('Schedule title'), { target: { value: 'Updated saved title' } });
  fireEvent.change(screen.getByLabelText('Assigned staff'), { target: { value: '8' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Schedule details were saved. Staff assignment could not be confirmed.');
  expect(screen.getByLabelText('Schedule title')).toHaveValue('Updated saved title');
  expect(screen.getByLabelText('Assigned staff')).toHaveValue('8');
  fireEvent.click(screen.getByRole('button', { name: 'Retry staff assignment' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  expect(m.edit).toHaveBeenCalledTimes(1); expect(m.assign).toHaveBeenCalledTimes(2);
  expect(m.assign.mock.calls.map(([input]) => input)).toEqual([{ templateId: base.id, staffId: 8 }, { templateId: base.id, staffId: 8 }]);
});
it('retains the edit draft after a details failure without assigning staff', async () => {
  m.edit.mockImplementationOnce((_input, cb) => cb.onError(new Error('private transport details')));
  schedules([{ ...base, staffId: 7 }]); openEditor();
  fireEvent.change(screen.getByLabelText('Schedule title'), { target: { value: 'Unconfirmed title' } });
  fireEvent.change(screen.getByLabelText('Assigned staff'), { target: { value: '8' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('The schedule could not be saved. Your draft is kept.');
  expect(screen.getByLabelText('Schedule title')).toHaveValue('Unconfirmed title');
  expect(m.assign).not.toHaveBeenCalled(); expect(screen.queryByText('private transport details')).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Retry staff assignment' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  expect(m.edit.mock.calls.map(([input]) => input)).toEqual([
    { id: base.id, data: { title: 'Unconfirmed title' } },
    { id: base.id, data: { title: 'Unconfirmed title' } },
  ]);
  expect(m.assign).toHaveBeenCalledTimes(1);
  expect(m.assign.mock.calls[0][0]).toEqual({ templateId: base.id, staffId: 8 });
});
it('blocks duplicate edit writes and panel dismissal while saving', async () => {
  let finish!: () => void;
  m.edit.mockImplementationOnce((_input, cb) => { finish = () => cb.onSuccess({}); });
  schedules(); openEditor();
  fireEvent.change(screen.getByLabelText('Schedule title'), { target: { value: 'Pending saved title' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
  expect(screen.getByRole('button', { name: 'Saving...' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
  fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' }); fireEvent.click(screen.getByRole('button', { name: 'Close' }));
  expect(screen.getByRole('dialog')).toBeInTheDocument(); expect(m.edit).toHaveBeenCalledTimes(1);
  finish(); await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
});
it('Escape dismisses the edit panel and returns focus to the actual opener', async () => {
  schedules(); const opener = openEditor(); fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument()); expect(opener).toHaveFocus();
});
it('Urdu preserves saved names and translates the week heading in mirrored direction', () => {
  const { cells, table } = grid({ ...base, staffId: 7, shiftStart: '2026-11-09T17:00:00Z', shiftEnd: '2026-11-09T01:00:00Z' }, 'Asia/Karachi', '2026-11-09', 'ur');
  expect(document.documentElement.dir).toBe('rtl');
  expect(table.getByRole('columnheader', { name: 'عملہ' })).toBeInTheDocument();
  for (const cell of cells) expect(within(cell).getByRole('button')).toHaveTextContent('22:00 Saved daily');
});

function actualWeek(): LocationSchedule {
  return {
    location: { id: 20, name: 'Saved site', timezone: 'Asia/Karachi' },
    weekStart: '2026-11-09', weekEndExclusive: '2026-11-16', asOf: '2026-11-11T05:00:00Z',
    days: Array.from({ length: 7 }, (_, index) => ({
      date: `2026-11-${String(9 + index).padStart(2, '0')}`, items: index === 0 ? [{
        key: 'actual-60', kind: 'actual', instanceId: 60, templateId: 1,
        title: 'Saved occurrence', startsAt: '2026-11-09T04:00:00Z', endsAt: '2026-11-09T05:00:00Z',
        status: 'PENDING', verificationVersion: 2, staff: { id: 7, name: 'Saved worker' }, staffMeaning: 'actual',
        continuesFromPreviousDay: false, continuesIntoNextDay: false,
      }] : [],
    })),
  };
}
it('actual-week initial loading announces a skeleton without inventing empty records', () => {
  m.schedule.mockImplementationOnce(() => new Promise(() => {}));
  mount(<LocationScheduleTab locationId="20" />);
  expect(screen.getByRole('status', { name: 'Loading…' })).toHaveAttribute('aria-busy', 'true');
  expect(screen.queryByText('No tasks scheduled for this week.')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Previous week' })).toBeDisabled();
});
it('actual-week errors offer Retry and saved-record reassurance, then restore the real occurrence', async () => {
  m.schedule.mockRejectedValueOnce({ response: { status: 503 } }).mockResolvedValueOnce(actualWeek());
  mount(<LocationScheduleTab locationId="20" />);
  expect(await screen.findByRole('alert')).toHaveTextContent('Your saved records have not changed.');
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
  expect(await screen.findByRole('button', { name: /Saved occurrence/ })).toHaveTextContent('09:00 – 10:00');
});
it('actual-week refresh failure preserves saved rows, the selected panel and focus', async () => {
  m.schedule.mockResolvedValueOnce(actualWeek()).mockRejectedValueOnce({ response: { status: 503 } });
  const { queryClient } = mount(<LocationScheduleTab locationId="20" />);
  const opener = await screen.findByRole('button', { name: /Saved occurrence/ }); fireEvent.click(opener);
  const link = screen.getByRole('link', { name: 'Verification history' }); link.focus();
  await act(async () => { await queryClient.invalidateQueries({ queryKey: ['location', 'schedule'] }); });
  expect(await screen.findByText('Check your connection and try again. Your saved records have not changed.')).toBeInTheDocument();
  expect(screen.getByRole('dialog', { name: 'Saved occurrence' })).toBeInTheDocument();
  expect(link).toHaveFocus(); expect(opener).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Task QR' })).toHaveAttribute('aria-expanded', 'false');
});
it('denied actual-week refresh hides cached private rows and selected detail', async () => {
  m.schedule.mockResolvedValueOnce(actualWeek()).mockRejectedValueOnce({ response: { status: 403 } });
  const { queryClient } = mount(<LocationScheduleTab locationId="20" />);
  fireEvent.click(await screen.findByRole('button', { name: /Saved occurrence/ }));
  await act(async () => { await queryClient.invalidateQueries({ queryKey: ['location', 'schedule'] }); });
  await waitFor(() => expect(screen.queryByText('Saved occurrence')).not.toBeInTheDocument());
  expect(screen.getByRole('dialog', { name: 'Task no longer available' })).toBeInTheDocument();
  expect(screen.queryByRole('link', { name: 'Verification history' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Task QR' })).not.toBeInTheDocument();
});
it('actual-week navigation keeps URL context and queries the requested local week with cancellation', async () => {
  m.schedule.mockResolvedValue(actualWeek()); mount(<LocationScheduleTab locationId="20" />);
  await screen.findByRole('button', { name: /Saved occurrence/ });
  fireEvent.click(screen.getByRole('button', { name: 'Next week' }));
  await waitFor(() => expect(m.schedule).toHaveBeenLastCalledWith('20', '2026-11-16', expect.any(AbortSignal)));
  expect(screen.getByLabelText('Route')).toHaveTextContent('source=setup');
  expect(screen.getByLabelText('Route')).toHaveTextContent('tab=templates');
});
