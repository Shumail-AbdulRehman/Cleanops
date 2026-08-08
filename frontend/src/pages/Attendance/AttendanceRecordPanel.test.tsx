import { useState } from 'react';
import { configureStore } from '@reduxjs/toolkit';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { Provider } from 'react-redux';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import authReducer, { setUser, type AuthUser } from '@/store/slices/authSlice';
import { LanguageProvider } from '@/i18n/LanguageProvider';
import { translate } from '@/i18n/translations';
import AttendanceContext, { type AttendanceCapture } from './AttendanceContext';
import type { AttendanceAnnotation } from './contextApi';

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), create: vi.fn(), revoke: vi.fn() }));
vi.mock('@/api/client', () => ({ client: { get: api.get, post: api.post } }));
const record: AttendanceCapture = {
  id: 12, date: '2026-10-20T00:00:00Z', status: 'CHECKED_OUT',
  expectedStart: '2026-10-20T03:00:00Z', expectedEnd: '2026-10-20T11:00:00Z',
  checkInTime: '2026-10-20T03:07:00Z', checkOutTime: '2026-10-20T11:03:00Z',
  location: { name: 'Synthetic Karachi site', timezone: 'Asia/Karachi' },
  checkInPhoto: { state: 'AVAILABLE', path: '/attendance/12/photos/check-in' },
  checkOutPhoto: { state: 'AVAILABLE', path: '/attendance/12/photos/check-out' },
};
const note: AttendanceAnnotation = {
  id: '10000000-0000-4000-8000-000000000001', attendanceId: 12,
  actorRole: 'STAFF', actorId: 7, kind: 'NOTE', reason: 'Synthetic recorded note',
  parentId: null, createdAt: '2026-10-20T06:00:00Z',
};
let entries: AttendanceAnnotation[];
function Controlled({ attendance }: { attendance: AttendanceCapture }) {
  const [open, setOpen] = useState(false);
  return <><button onClick={() => setOpen(true)}>Open attendance record</button>
    <AttendanceContext attendance={attendance} staffName="Synthetic worker" open={open} onOpenChange={setOpen} /></>;
}
function mount(attendance = record, { language = 'en', role = 'ADMIN', controlled = true }: { language?: 'en' | 'ur'; role?: AuthUser['role']; controlled?: boolean } = {}) {
  localStorage.setItem('hygene-ops.language', language);
  const store = configureStore({ reducer: { auth: authReducer } });
  store.dispatch(setUser({ id: 1, companyId: 42, role, name: 'Synthetic account', email: 'fixture@example.invalid' }));
  const query = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const tree = (capture: AttendanceCapture) => <Provider store={store}><QueryClientProvider client={query}><LanguageProvider><div className="workspace">
    {controlled ? <Controlled attendance={capture} /> : <AttendanceContext attendance={capture} staffName="Synthetic worker" />}
  </div></LanguageProvider></QueryClientProvider></Provider>;
  const view = render(tree(attendance));
  return { ...view, store, query, changeRecord: (capture: AttendanceCapture) => view.rerender(tree(capture)) };
}
const open = () => fireEvent.click(screen.getByRole('button', { name: 'Open attendance record' }));
const editor = () => screen.getByRole('textbox', { name: 'Reason (required)' });
const photoCalls = () => api.get.mock.calls.filter(([path]) => path.includes('/photos/'));
async function loaded() { await screen.findByText(note.reason); await waitFor(() => expect(screen.getAllByRole('img')).toHaveLength(2)); }
beforeEach(() => {
  vi.clearAllMocks(); localStorage.clear(); entries = [note];
  const OriginalURL = URL;
  let nextUrl = 0;
  api.create.mockImplementation(() => `blob:protected-attendance-${++nextUrl}`);
  vi.stubGlobal('URL', class extends OriginalURL { static createObjectURL = api.create; static revokeObjectURL = api.revoke; });
  api.get.mockImplementation(async (path: string) => path.includes('/photos/')
    ? { data: new Blob(['synthetic photo bytes'], { type: 'image/jpeg' }) }
    : { data: { data: { attendanceId: 12, items: [...entries], nextCursor: null } } });
  api.post.mockImplementation(async (_path, body) => {
    const annotation = { ...note, ...body, id: '20000000-0000-4000-8000-000000000001', actorRole: 'ADMIN', actorId: 1 };
    entries.push(annotation);
    return { data: { data: { annotation, reused: false } } };
  });
});
afterEach(() => { vi.unstubAllGlobals(); });

it('requests both protected tiles and context only after the controlled record opens', async () => {
  mount(); expect(api.get).not.toHaveBeenCalled();
  expect(screen.queryByRole('button', { name: 'Attendance context' })).not.toBeInTheDocument();
  open(); await loaded();
  expect(screen.getByRole('dialog', { name: 'Attendance context · #12' })).toHaveAttribute('aria-modal', 'true');
  for (const kind of ['check-in', 'check-out']) expect(api.get).toHaveBeenCalledWith(`/attendance/12/photos/${kind}`, { responseType: 'blob', signal: expect.any(AbortSignal) });
  expect(photoCalls()).toHaveLength(2);
  const photos = screen.getAllByRole('figure');
  expect(within(photos[0]).getByText('Check-in')).toBeInTheDocument();
  expect(within(photos[0]).getByText(/08:07|8:07/)).toBeInTheDocument();
  expect(within(photos[1]).getByText('Check-out')).toBeInTheDocument();
  expect(within(photos[1]).getByText(/16:03|4:03/)).toBeInTheDocument();
  const facts = screen.getByRole('region', { name: 'Original captured facts' });
  expect(photos[0].compareDocumentPosition(facts) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(facts.compareDocumentPosition(screen.getByRole('region', { name: 'Recorded context' })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
});

it.each([
  ['CHECKED_IN', record.checkInTime, 'Not checked out yet'],
  ['LATE', record.checkInTime, 'Not checked out yet'],
  ['MISSED_CHECKOUT', record.checkInTime, 'Missed checkout'],
  ['ABSENT', null, 'No check-in recorded'],
  ['SHIFT_NOT_STARTED', null, 'No check-in recorded'],
])('uses captured %s fields for the missing-photo explanation', async (status, checkInTime, message) => {
  mount({ ...record, status, checkInTime, checkOutTime: null,
    checkInPhoto: checkInTime ? record.checkInPhoto : { state: 'NONE', path: null },
    checkOutPhoto: { state: 'NONE', path: null } });
  open(); await screen.findByText(message);
  expect(screen.queryByRole('button', { name: 'Enlarge check-out photo' })).not.toBeInTheDocument();
  expect(photoCalls()).toHaveLength(checkInTime ? 1 : 0);
  if (!checkInTime) expect(screen.getByText('No check-out recorded')).toBeInTheDocument();
});

it('shows missing photo rather than missing check-in when the timestamp is recorded', async () => {
  mount({ ...record, checkInPhoto: { state: 'NONE', path: null } }); open();
  expect(await screen.findByText('No photo recorded.')).toBeInTheDocument();
  expect(screen.queryByText('No check-in recorded')).not.toBeInTheDocument();
});

it('keeps legacy and untrusted metadata out of protected requests', async () => {
  mount({ ...record, checkInPhoto: { state: 'LEGACY_RESTRICTED', path: 'https://public.invalid/photo.jpg' },
    checkOutPhoto: { state: 'AVAILABLE', path: 'https://public.invalid/other.jpg' } });
  open(); await screen.findByText(note.reason);
  expect(screen.getByText('This earlier photo is unavailable. The attendance record is unchanged.')).toBeInTheDocument();
  expect(screen.getByText('No photo recorded.')).toBeInTheDocument();
  expect(photoCalls()).toHaveLength(0); expect(screen.queryByRole('img')).not.toBeInTheDocument();
});

it('enlarges either tile in the existing zoom dialog without requesting the bytes twice', async () => {
  mount(); open(); await loaded();
  for (const kind of ['check-in', 'check-out']) {
    const trigger = screen.getByRole('button', { name: `Enlarge ${kind} photo` });
    fireEvent.click(trigger);
    const zoom = screen.getByRole('dialog', { name: kind === 'check-in' ? 'Check-in photo' : 'Check-out photo' });
    expect(within(zoom).getByRole('button', { name: 'Zoom out' })).toBeDisabled();
    fireEvent.click(within(zoom).getByRole('button', { name: 'Zoom in' }));
    expect(within(zoom).getByRole('img')).toHaveStyle({ width: '150%' });
    fireEvent.keyDown(zoom, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog', { name: /Check-(in|out) photo/ })).not.toBeInTheDocument());
    expect(screen.getByRole('dialog', { name: 'Attendance context · #12' })).toBeInTheDocument();
    await waitFor(() => expect(trigger).toHaveFocus());
  }
  expect(photoCalls()).toHaveLength(2);
});

it('validates a missing reason then records only note intent through the existing API', async () => {
  mount(); open(); await loaded();
  fireEvent.click(screen.getByRole('button', { name: 'Record note' }));
  expect(api.post).not.toHaveBeenCalled(); expect(editor()).toHaveFocus();
  expect(editor()).toHaveAttribute('aria-invalid', 'true');
  expect(editor()).toHaveAccessibleDescription(/Enter a reason of 1–1000 characters/);
  fireEvent.change(editor(), { target: { value: '  Synthetic panel note  ' } });
  fireEvent.click(screen.getByRole('button', { name: 'Record note' }));
  await screen.findByText('Context recorded. Original attendance is unchanged.');
  expect(api.post).toHaveBeenCalledWith('/attendance/12/annotations', { kind: 'NOTE', reason: 'Synthetic panel note', requestId: expect.any(String) });
  expect(editor()).toHaveValue(''); expect(await screen.findByText('Synthetic panel note')).toBeInTheDocument();
  expect(screen.getByRole('region', { name: 'Original captured facts' })).toHaveTextContent('Captured check-in');
});

it('closes on Escape, releases both URLs and returns focus to the controlled opener', async () => {
  mount(); const opener = screen.getByRole('button', { name: 'Open attendance record' }); opener.focus(); open(); await loaded();
  fireEvent.change(editor(), { target: { value: 'Synthetic retained panel draft' } });
  fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  expect(api.revoke).toHaveBeenCalledTimes(2);
  for (const call of photoCalls()) expect(call[1].signal.aborted).toBe(true);
  await waitFor(() => expect(opener).toHaveFocus());
  open(); await loaded(); expect(editor()).toHaveValue('Synthetic retained panel draft');
  expect(photoCalls()).toHaveLength(4);
});

it('retains the existing context-button integration for callers not yet migrated', async () => {
  mount(record, { controlled: false }); expect(api.get).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Attendance context' })); await loaded();
  expect(screen.getByRole('dialog')).toBeInTheDocument();
});

it('shows skeleton loading for both tiles and history without fabricating images', async () => {
  api.get.mockImplementation(() => new Promise(() => undefined)); mount(); open();
  expect(screen.getAllByText('Loading attendance photo…')).toHaveLength(2);
  expect(screen.getByText('Loading attendance context…')).toBeInTheDocument();
  expect(screen.queryByRole('img')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Record note' })).toBeDisabled();
});

it.each([401, 403, 404])('keeps the denied/missing HTTP %i tile state without Retry or raw error details', async status => {
  api.get.mockImplementation(async (path: string) => {
    if (path.includes('/photos/')) throw { isAxiosError: true, response: { status, data: { message: 'private driver detail' } } };
    return { data: { data: { attendanceId: 12, items: entries, nextCursor: null } } };
  });
  mount(); open(); await screen.findByText(note.reason);
  await waitFor(() => expect(screen.getAllByRole('alert')).toHaveLength(2));
  for (const alert of screen.getAllByRole('alert')) expect(alert).toHaveTextContent(status === 404 ? 'Photo unavailable. The attendance record is unchanged.' : 'You no longer have access to this photo.');
  expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
  expect(screen.queryByText('private driver detail')).not.toBeInTheDocument(); expect(api.create).not.toHaveBeenCalled();
});

it('retries a transient tile failure without reloading its sibling', async () => {
  const normalGet = api.get.getMockImplementation()!;
  let fail = true;
  api.get.mockImplementation((path: string, options: unknown) => {
    if (path.endsWith('/photos/check-in') && fail) { fail = false; return Promise.reject(new Error('Synthetic offline')); }
    return normalGet(path, options);
  });
  mount(); open();
  await screen.findByRole('alert');
  expect(screen.getByRole('alert')).toHaveTextContent('The photo could not load. Try again.');
  fireEvent.click(screen.getByRole('button', { name: 'Retry' })); await loaded();
  expect(photoCalls().filter(([path]) => path.endsWith('check-in'))).toHaveLength(2);
  expect(photoCalls().filter(([path]) => path.endsWith('check-out'))).toHaveLength(1);
});

it('discards late tile responses after closing without allocating image URLs', async () => {
  const pending: ((value: { data: Blob }) => void)[] = [];
  api.get.mockImplementation((path: string) => path.includes('/photos/')
    ? new Promise(resolve => pending.push(resolve))
    : Promise.resolve({ data: { data: { attendanceId: 12, items: entries, nextCursor: null } } }));
  mount(); open(); await screen.findByText(note.reason);
  fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  await act(async () => pending.forEach(resolve => resolve({ data: new Blob(['late'], { type: 'image/jpeg' }) })));
  expect(api.create).not.toHaveBeenCalled();
});

it('retains cached history and focused draft on a background failure and disables unconfirmed writes', async () => {
  const view = mount(); open(); await loaded(); fireEvent.change(editor(), { target: { value: 'Synthetic saved draft' } }); editor().focus();
  api.get.mockRejectedValue(new Error('Synthetic network failure'));
  await act(async () => { await view.query.invalidateQueries({ queryKey: ['attendance-context'] }); });
  expect(screen.getByText(note.reason)).toBeInTheDocument(); expect(editor()).toHaveValue('Synthetic saved draft'); expect(editor()).toHaveFocus();
  await screen.findByText('Context could not load. Your draft is kept.');
  expect(screen.getByRole('button', { name: 'Record note' })).toBeDisabled();
});

it('keeps a conflicting draft locked when conflict review fails, then unlocks after a successful refresh', async () => {
  api.post.mockRejectedValueOnce({ response: { status: 409 } });
  mount(); open(); await loaded(); fireEvent.change(editor(), { target: { value: 'Synthetic conflict draft' } });
  fireEvent.click(screen.getByRole('button', { name: 'Record note' }));
  await screen.findByText('Request conflict. Refresh context; your draft is kept.');
  api.get.mockRejectedValueOnce(new Error('Synthetic failed refresh'));
  fireEvent.click(screen.getByRole('button', { name: 'Review conflict and edit draft' }));
  await screen.findByText('Context could not load. Your draft is kept.');
  expect(editor()).toHaveAttribute('readonly'); expect(editor()).toHaveValue('Synthetic conflict draft');
  fireEvent.click(screen.getByRole('button', { name: 'Review conflict and edit draft' }));
  await waitFor(() => expect(editor()).not.toHaveAttribute('readonly'));
  expect(editor()).toHaveValue('Synthetic conflict draft');
});

it('clears record-specific drafts and revokes old photos before a different record opens', async () => {
  const view = mount(); open(); await loaded(); fireEvent.change(editor(), { target: { value: 'Synthetic old record draft' } });
  view.changeRecord({ ...record, id: 13, checkInPhoto: { state: 'AVAILABLE', path: '/attendance/13/photos/check-in' }, checkOutPhoto: { state: 'AVAILABLE', path: '/attendance/13/photos/check-out' } });
  await screen.findByRole('dialog', { name: 'Attendance context · #13' });
  expect(editor()).toHaveValue(''); expect(api.revoke).toHaveBeenCalledTimes(2);
  expect(api.get).toHaveBeenCalledWith('/attendance/13/photos/check-in', expect.any(Object));
});

it('isolates an already open controlled record on a principal/tenant change', async () => {
  const view = mount(); open(); await loaded(); fireEvent.change(editor(), { target: { value: 'Synthetic old principal draft' } });
  act(() => view.store.dispatch(setUser({ id: 2, companyId: 43, role: 'MANAGER', name: 'Synthetic other account', email: 'other@example.invalid' })));
  await loaded(); expect(editor()).toHaveValue(''); expect(api.revoke).toHaveBeenCalledTimes(2);
  expect(photoCalls()).toHaveLength(4);
});

it('mirrors the controlled panel and translates missing/photo/note controls without translating captured names', async () => {
  mount({ ...record, status: 'CHECKED_IN', checkOutTime: null, checkOutPhoto: { state: 'NONE', path: null } }, { language: 'ur' }); open();
  await screen.findByText(note.reason);
  expect(screen.getByRole('dialog')).toHaveAttribute('dir', 'rtl');
  expect(screen.getByText(translate('Not checked out yet', 'ur'))).toBeInTheDocument();
  expect(screen.getByRole('button', { name: translate('Enlarge check-in photo', 'ur') })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: translate('Record note', 'ur') })).toBeInTheDocument();
  expect(screen.getByText('Synthetic worker')).toBeInTheDocument(); expect(screen.getByText('Synthetic Karachi site')).toBeInTheDocument();
});

it.each([
  ['non-image', new Blob(['synthetic'], { type: 'application/json' })],
  ['empty', new Blob([], { type: 'image/jpeg' })],
  ['oversized', new Blob([new Uint8Array(5 * 1024 * 1024 + 1)], { type: 'image/jpeg' })],
])('rejects %s protected tile responses without allocating URLs', async (_label, blob) => {
  const normalGet = api.get.getMockImplementation()!;
  api.get.mockImplementation((path: string, options: unknown) => path.includes('/photos/') ? Promise.resolve({ data: blob }) : normalGet(path, options));
  mount(); open(); await screen.findByText(note.reason);
  await waitFor(() => expect(screen.getAllByRole('alert')).toHaveLength(2));
  expect(api.create).not.toHaveBeenCalled(); expect(screen.queryByRole('img')).not.toBeInTheDocument();
});

it('offers tile Retry after an image decode failure and releases its previous bytes', async () => {
  mount(); open(); await loaded();
  fireEvent.error(screen.getByRole('img', { name: 'Check-in photo' }));
  expect(screen.getByRole('alert')).toHaveTextContent('The photo could not load. Try again.');
  fireEvent.click(screen.getByRole('button', { name: 'Retry' })); await loaded();
  expect(photoCalls()).toHaveLength(3); expect(api.revoke).toHaveBeenCalledTimes(1);
});
