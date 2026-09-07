import type { ReactNode } from 'react';
import { configureStore } from '@reduxjs/toolkit';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { Provider } from 'react-redux';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { client } from '@/api/client';
import { LanguageProvider } from '@/i18n/LanguageProvider';
import { translate, type Language } from '@/i18n/translations';
import authReducer, { setUser } from '@/store/slices/authSlice';
import StaffCreateDialog from './StaffCreateDialog';
import StaffEditDialog, { type EditableStaff } from './StaffEditDialog';

const timezone = 'Asia/Karachi';
const person: EditableStaff = {
  id: 7,
  name: 'Saved worker',
  email: null,
  phone: '03001234567',
  shiftStart: null,
  shiftEnd: null,
  isActive: true,
  workDays: ['MON', 'WED'],
};
const originalAdapter = client.defaults.adapter;
const requests = vi.fn();
const createPayload = { name: 'New worker', phone: '03007654321' };
const requiredMessage = 'Choose at least one work day.';
const serverConflict = 'Saved worker has schedules on the days you removed: "Corridor, first floor", "Lobby". Change those schedules first.';
let failure: { status: number; code: string; message?: string } | undefined;

beforeEach(() => {
  localStorage.clear();
  requests.mockClear();
  failure = undefined;
  client.defaults.adapter = async config => {
    requests(config.url, JSON.parse(config.data));
    if (failure) {
      const { status, code, message } = failure;
      throw { config, response: { status, data: { errors: [{ code, field: 'workDays', message }] } } };
    }
    return { config, data: { data: { id: 7 } }, status: 200, statusText: 'OK', headers: {} };
  };
});

afterEach(() => {
  client.defaults.adapter = originalAdapter;
  localStorage.clear();
});

function mount(form: ReactNode, language: Language = 'en') {
  localStorage.setItem('hygene-ops.language', language);
  const store = configureStore({ reducer: { auth: authReducer } });
  store.dispatch(setUser({ id: 2, companyId: 42, role: 'ADMIN', name: 'Owner', email: 'owner@example.invalid' }));
  const query = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  render(<Provider store={store}>
    <QueryClientProvider client={query}>
      <LanguageProvider>
        <MemoryRouter><div className="workspace">{form}</div></MemoryRouter>
      </LanguageProvider>
    </QueryClientProvider>
  </Provider>);
}

function create(inline = false) {
  const saved = vi.fn();
  mount(<StaffCreateDialog open inline={inline} onOpenChange={vi.fn()} onSaved={saved} />);
  fireEvent.change(screen.getByLabelText('Full Name'), { target: { value: createPayload.name } });
  fireEvent.change(screen.getByLabelText('Phone Number'), { target: { value: createPayload.phone } });
  return saved;
}

function edit(language: Language = 'en') {
  const close = vi.fn();
  mount(<StaffEditDialog person={person} timezone={timezone} onClose={close} />, language);
  return close;
}

function workDays(language: Language = 'en') {
  const name = translate('Work days', language);
  const heading = screen.getByText(name, { selector: 'label' });
  const group = screen.getByRole('group', { name });
  expect(heading).toBeVisible();
  expect(group).toHaveAttribute('aria-labelledby', heading.id);
  return group;
}

function pressDay(day: string, language: Language = 'en') {
  fireEvent.click(within(workDays(language)).getByRole('button', { name: translate(day, language) }));
}

function submit(label: string, language: Language = 'en') {
  fireEvent.click(screen.getByRole('button', { name: translate(label, language) }));
}

it.each([false, true])('defaults to seven days and omits workDays on create (inline: %s)', async inline => {
  const saved = create(inline);
  expect(within(workDays()).getAllByRole('button', { pressed: true })).toHaveLength(7);
  expect(screen.getByText('Works every day')).toBeVisible();
  expect(screen.getByText('Days this person comes to work. Shift times are the same on each day.')).toBeVisible();

  submit('Create staff');
  await waitFor(() => expect(saved).toHaveBeenCalledOnce());
  expect(requests).toHaveBeenCalledExactlyOnceWith('/staff/create-staff', createPayload);
});

it('sends only Monday when the other six days are turned off', async () => {
  const saved = create(true);
  for (const day of ['Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']) pressDay(day);
  expect(within(workDays()).getByRole('button', { name: 'Monday', pressed: true })).toBeVisible();

  submit('Create staff');
  await waitFor(() => expect(saved).toHaveBeenCalledOnce());
  expect(requests).toHaveBeenCalledExactlyOnceWith('/staff/create-staff', { ...createPayload, workDays: ['MON'] });
});

it('blocks an empty selection and focuses the group with its linked error', async () => {
  create();
  for (const button of within(workDays()).getAllByRole('button', { pressed: true })) fireEvent.click(button);

  submit('Create staff');
  expect(await screen.findByRole('alert')).toHaveTextContent(requiredMessage);
  expect(workDays()).toHaveAccessibleDescription(requiredMessage);
  expect(workDays()).toHaveAttribute('aria-invalid', 'true');
  expect(workDays()).toHaveFocus();
  expect(requests).not.toHaveBeenCalled();
});

it('starts edit with the stored days and omits them when they return to the original selection', async () => {
  const close = edit();
  const selected = within(workDays()).getAllByRole('button', { pressed: true });
  expect(selected).toHaveLength(2);
  expect(selected[0]).toHaveAccessibleName('Monday');
  expect(selected[1]).toHaveAccessibleName('Wednesday');
  pressDay('Monday');
  pressDay('Monday');
  fireEvent.change(screen.getByLabelText('Full Name'), { target: { value: 'Updated worker' } });

  submit('Save changes');
  await waitFor(() => expect(close).toHaveBeenCalledOnce());
  expect(requests).toHaveBeenCalledExactlyOnceWith('/staff/7', { name: 'Updated worker' });
});

it.each([
  { toggles: ['Wednesday'], expected: ['MON'] },
  { toggles: ['Tuesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'], expected: ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'] },
])('sends changed work days on edit including a return to all seven ($expected)', async ({ toggles, expected }) => {
  const close = edit();
  for (const day of toggles) pressDay(day);

  submit('Save changes');
  await waitFor(() => expect(close).toHaveBeenCalledOnce());
  expect(requests).toHaveBeenCalledExactlyOnceWith('/staff/7', { workDays: expected });
});

it.each([
  ['en', 'This person has schedules on the days you removed: "Corridor, first floor", "Lobby". Change those schedules first.'],
  ['ur', 'جن دنوں کو آپ نے ہٹایا ہے، ان پر اس کارکن کے یہ کام مقرر ہیں: "Corridor, first floor", "Lobby"۔ پہلے ان کاموں کے دن بدلیں۔'],
] as const)('links the conflict error and keeps the draft in %s', async (language, message) => {
  failure = { status: 409, code: 'WORK_DAYS_CONFLICT', message: serverConflict };
  const close = edit(language);
  const name = screen.getByLabelText(translate('Full Name', language));
  fireEvent.change(name, { target: { value: 'Draft worker' } });
  pressDay('Wednesday', language);

  submit('Save changes', language);
  expect(await screen.findByRole('alert')).toHaveTextContent(message);
  const group = workDays(language);
  expect(group).toHaveAccessibleDescription(message);
  expect(group).toHaveAttribute('dir', language === 'ur' ? 'rtl' : 'ltr');
  expect(group).toHaveFocus();
  expect(within(group).getByRole('button', { name: translate('Wednesday', language), pressed: false })).toBeVisible();
  expect(name).toHaveValue('Draft worker');
  expect(close).not.toHaveBeenCalled();
});

it('translates the server validation code in Urdu and keeps the selection', async () => {
  failure = { status: 400, code: 'INVALID_WORK_DAYS', message: 'Private backend detail' };
  const close = edit('ur');
  pressDay('Wednesday', 'ur');

  submit('Save changes', 'ur');
  const message = 'کام کے لیے کم از کم ایک دن منتخب کریں۔';
  expect(await screen.findByRole('alert')).toHaveTextContent(message);
  const group = screen.getByRole('group', { name: 'کام کے دن' });
  expect(group).toHaveAccessibleDescription(message);
  expect(within(group).getByRole('button', { name: 'پیر', pressed: true })).toBeVisible();
  expect(screen.queryByText('Private backend detail')).not.toBeInTheDocument();
  expect(close).not.toHaveBeenCalled();
});
