import { configureStore } from '@reduxjs/toolkit';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { Provider } from 'react-redux';
import { beforeEach, expect, it, vi } from 'vitest';
import authReducer, { setUser, type AuthUser } from '@/store/slices/authSlice';
import { LanguageProvider } from '@/i18n/LanguageProvider';
import { attendanceContextUrdu } from '@/i18n/attendanceContextTranslations';
import AttendanceContext, { type AttendanceCapture } from './AttendanceContext';
import type { AttendanceAnnotation } from './contextApi';

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock('@/api/client', () => ({ client: api }));
const capture: AttendanceCapture = {
  id: 12, date: '2026-10-20T00:00:00Z', status: 'CHECKED_IN',
  expectedStart: '2026-10-20T03:00:00Z', expectedEnd: '2026-10-20T11:00:00Z',
  checkInTime: '2026-10-20T03:07:00Z', checkOutTime: null,
  location: { name: 'Synthetic Karachi site', timezone: 'Asia/Karachi' },
  checkInPhoto: { state: 'LEGACY_RESTRICTED', path: null },
  checkOutPhoto: { state: 'NONE', path: null },
};
const note: AttendanceAnnotation = {
  id: '10000000-0000-4000-8000-000000000001', attendanceId: 12,
  actorRole: 'STAFF', actorId: 7, kind: 'NOTE', reason: 'Synthetic transit delay',
  parentId: null, createdAt: '2026-10-20T06:00:00Z',
};
let entries: AttendanceAnnotation[];
function mount(role: AuthUser['role'] = 'ADMIN', language = 'en') {
  localStorage.setItem('hygene-ops.language', language);
  const store = configureStore({ reducer: { auth: authReducer } });
  store.dispatch(setUser({ id: 1, companyId: 42, name: 'Synthetic account', email: 'fixture@example.invalid', role }));
  const query = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const view = render(<Provider store={store}><QueryClientProvider client={query}><LanguageProvider><div className="workspace"><AttendanceContext attendance={capture} staffName="Synthetic worker" /></div></LanguageProvider></QueryClientProvider></Provider>);
  return { ...view, store };
}
const open = () => fireEvent.click(screen.getByRole('button', { name: 'Attendance context' }));
const editor = () => screen.getByRole('textbox', { name: 'Reason (required)' });
beforeEach(() => {
  vi.clearAllMocks(); localStorage.clear(); entries = [note];
  api.get.mockImplementation(async () => ({ data: { data: { attendanceId: 12, items: [...entries], nextCursor: null } } }));
  api.post.mockImplementation(async (_url, body) => {
    const annotation = { ...note, ...body, id: '20000000-0000-4000-8000-000000000001', actorRole: 'ADMIN', actorId: 1 };
    entries.push(annotation);
    return { data: { data: { annotation, reused: false } } };
  });
});

it('loads only when opened and separates original local capture from immutable attributed context', async () => {
  mount(); expect(api.get).not.toHaveBeenCalled(); open();
  await screen.findByText(note.reason);
  expect(api.get).toHaveBeenCalledWith('/attendance/12/annotations', expect.objectContaining({ params: { limit: 25 }, signal: expect.any(AbortSignal) }));
  const original = screen.getByRole('region', { name: 'Original captured facts' });
  expect(within(original).getByText('Synthetic worker')).toBeInTheDocument();
  expect(within(original).getByText(/08:07|8:07/)).toBeInTheDocument();
  expect(within(original).queryByText(note.reason)).not.toBeInTheDocument();
  expect(screen.getByText('#7')).toBeInTheDocument();
  expect(screen.getByText('Notes add context. Original attendance, photos and paid hours are not changed.')).toBeInTheDocument();
  expect(screen.queryByRole('img')).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /edit|delete/i })).not.toBeInTheDocument();
});

it('has distinct loading, empty and denied states without pretending an error is no notes', async () => {
  api.get.mockImplementation(() => new Promise(() => undefined));
  const pending = mount(); open(); await screen.findByText('Loading attendance context…');
  expect(screen.getByRole('button', { name: 'Record note' })).toBeDisabled(); pending.unmount();
  entries = []; api.get.mockResolvedValue({ data: { data: { items: [], nextCursor: null } } });
  const empty = mount(); open(); await screen.findByText('No context has been recorded.'); empty.unmount();
  api.get.mockRejectedValue({ response: { status: 403, data: { message: 'private driver text' } } });
  mount(); open(); await screen.findByText('This attendance context is no longer available to your account.');
  expect(screen.queryByText('No context has been recorded.')).not.toBeInTheDocument();
  expect(screen.queryByText('private driver text')).not.toBeInTheDocument();
  expect(editor()).toBeDisabled();
});

it('requires a trimmed reason and rejects whitespace and control characters without posting', async () => {
  mount(); open(); await screen.findByText(note.reason);
  for (const value of ['', '   ', 'bad\u0007reason']) {
    fireEvent.change(editor(), { target: { value } });
    fireEvent.click(screen.getByRole('button', { name: 'Record note' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Enter a reason');
  }
  expect(api.post).not.toHaveBeenCalled();
});

it('posts only note intent and clears the draft only after authoritative acknowledgement', async () => {
  mount(); open(); await screen.findByText(note.reason);
  fireEvent.change(editor(), { target: { value: '  Synthetic late bus  ' } });
  fireEvent.click(screen.getByRole('button', { name: 'Record note' }));
  await screen.findByText('Context recorded. Original attendance is unchanged.');
  expect(api.post).toHaveBeenCalledWith('/attendance/12/annotations', {
    kind: 'NOTE', reason: 'Synthetic late bus', requestId: expect.stringMatching(/^[0-9a-f-]{36}$/),
  });
  expect(editor()).toHaveValue('');
  expect(await screen.findByText('Synthetic late bus')).toBeInTheDocument();
  expect(screen.getByRole('region', { name: 'Original captured facts' })).toHaveTextContent('Captured check-in');
});

it('retains an uncertain request and draft for exact retry without generating another identity', async () => {
  api.post.mockRejectedValueOnce(new Error('lost response'));
  mount(); open(); await screen.findByText(note.reason);
  fireEvent.change(editor(), { target: { value: 'Synthetic uncertain note' } });
  fireEvent.click(screen.getByRole('button', { name: 'Record note' }));
  await screen.findByText('Saving was not confirmed. Your draft is locked for an exact retry to prevent duplicate notes.');
  expect(editor()).toHaveValue('Synthetic uncertain note'); expect(editor()).toHaveAttribute('readonly');
  const intent = api.post.mock.calls[0][1];
  fireEvent.click(screen.getByRole('button', { name: 'Retry same request' }));
  await screen.findByText('Context recorded. Original attendance is unchanged.');
  expect(api.post.mock.calls[1][1]).toEqual(intent);
});

it('prevents duplicate submissions while the same request is pending', async () => {
  api.post.mockImplementation(() => new Promise(() => undefined));
  mount(); open(); await screen.findByText(note.reason);
  fireEvent.change(editor(), { target: { value: 'Synthetic note' } });
  const form = editor().closest('form')!;
  fireEvent.submit(form); fireEvent.submit(form);
  expect(api.post).toHaveBeenCalledTimes(1);
  expect(screen.getByRole('button', { name: 'Recording context…' })).toBeDisabled();
});

it('retains a conflicting draft and requires explicit refresh before a new request', async () => {
  api.post.mockRejectedValueOnce({ response: { status: 409 } });
  mount(); open(); await screen.findByText(note.reason);
  fireEvent.change(editor(), { target: { value: 'Synthetic conflict note' } });
  fireEvent.click(screen.getByRole('button', { name: 'Record note' }));
  await screen.findByText('Request conflict. Refresh context; your draft is kept.');
  expect(editor()).toHaveValue('Synthetic conflict note');
  expect(screen.getByRole('button', { name: 'Retry same request' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Review conflict and edit draft' }));
  await waitFor(() => expect(editor()).not.toHaveAttribute('readonly'));
  fireEvent.click(screen.getByRole('button', { name: 'Record note' }));
  await screen.findByText('Context recorded. Original attendance is unchanged.');
  expect(api.post.mock.calls[1][1].requestId).not.toBe(api.post.mock.calls[0][1].requestId);
});

it('acknowledges an exact note with a required reason and server attributed actor', async () => {
  mount('MANAGER'); open(); await screen.findByText(note.reason);
  fireEvent.click(screen.getByRole('button', { name: 'Acknowledge note' }));
  expect(screen.getByRole('heading', { name: 'Add acknowledgement' })).toBeInTheDocument();
  fireEvent.change(editor(), { target: { value: 'Synthetic receipt acknowledged' } });
  fireEvent.click(screen.getByRole('button', { name: 'Record acknowledgement' }));
  await screen.findByText('Context recorded. Original attendance is unchanged.');
  expect(api.post.mock.calls[0][1]).toEqual({ kind: 'ACKNOWLEDGEMENT', parentId: note.id, reason: 'Synthetic receipt acknowledged', requestId: expect.any(String) });
});

it('never offers staff an acknowledgement or trusted actor input', async () => {
  mount('STAFF'); open(); await screen.findByText(note.reason);
  expect(screen.queryByRole('button', { name: 'Acknowledge note' })).not.toBeInTheDocument();
  expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
});

it('loads subsequent chronology using only the server cursor', async () => {
  api.get.mockImplementation(async (_url, options) => ({ data: { data: options.params.after
    ? { items: [{ ...note, id: '30000000-0000-4000-8000-000000000001', reason: 'Synthetic next note' }], nextCursor: null }
    : { items: [note], nextCursor: note.id } } }));
  mount(); open(); await screen.findByText(note.reason);
  fireEvent.click(screen.getByRole('button', { name: 'Load more recorded context' }));
  await screen.findByText('Synthetic next note');
  expect(api.get).toHaveBeenLastCalledWith('/attendance/12/annotations', expect.objectContaining({ params: { limit: 25, after: note.id } }));
  expect(screen.queryByRole('button', { name: 'Load more recorded context' })).not.toBeInTheDocument();
});

it('preserves a draft on close/reopen but remounts it for another authenticated principal', async () => {
  const view = mount(); open(); await screen.findByText(note.reason);
  fireEvent.change(editor(), { target: { value: 'Synthetic saved draft' } });
  fireEvent.click(screen.getAllByRole('button', { name: /^Close$/ })[0]);
  open(); expect(await screen.findByRole('textbox')).toHaveValue('Synthetic saved draft');
  act(() => view.store.dispatch(setUser({ id: 2, companyId: 43, role: 'MANAGER', name: 'Other fixture', email: 'other@example.invalid' })));
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument(); open();
  expect(await screen.findByRole('textbox')).toHaveValue('');
});

it('renders Urdu controls and guidance in RTL while keeping submitted notes unchanged', async () => {
  mount('MANAGER', 'ur');
  fireEvent.click(screen.getByRole('button', { name: attendanceContextUrdu['Attendance context'] }));
  await screen.findByText(note.reason);
  expect(document.documentElement.dir).toBe('rtl');
  expect(screen.getByRole('heading', { name: attendanceContextUrdu['Original captured facts'] })).toBeInTheDocument();
  expect(screen.getByRole('textbox', { name: attendanceContextUrdu['Reason (required)'] })).toBeInTheDocument();
  for (const key of ['Record note', 'Add attendance note', 'Use 1–1000 characters. Saved notes cannot be edited or deleted.']) expect(screen.getByText(attendanceContextUrdu[key])).toBeInTheDocument();
});
