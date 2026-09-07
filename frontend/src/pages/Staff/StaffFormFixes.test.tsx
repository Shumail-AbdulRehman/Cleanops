import type { ReactNode } from 'react';
import { configureStore } from '@reduxjs/toolkit';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Provider } from 'react-redux';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { client } from '@/api/client';
import { LanguageProvider } from '@/i18n/LanguageProvider';
import authReducer, { setUser } from '@/store/slices/authSlice';
import StaffCreateDialog from './StaffCreateDialog';
import StaffEditDialog, { type EditableStaff } from './StaffEditDialog';

const site = { id: 20, name: 'Saved site', timezone: 'Asia/Karachi' };
const person: EditableStaff = {
  id: 7, name: 'Saved worker', email: 'worker@example.invalid', phone: '03001234567',
  isActive: true, locationId: site.id, location: site, shiftStart: null, shiftEnd: null,
};
const requests: { url?: string; method?: string; data: Record<string, unknown> }[] = [];
const originalAdapter = client.defaults.adapter;

function mount(node: ReactNode) {
  localStorage.setItem('hygene-ops.language', 'en');
  const store = configureStore({ reducer: { auth: authReducer } });
  store.dispatch(setUser({ id: 2, companyId: 42, role: 'ADMIN', name: 'Saved owner', email: 'owner@example.invalid' }));
  const query = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(
    <Provider store={store}>
      <QueryClientProvider client={query}>
        <LanguageProvider>
          <MemoryRouter initialEntries={['/staff']}>
            <div className="workspace">{node}</div>
          </MemoryRouter>
        </LanguageProvider>
      </QueryClientProvider>
    </Provider>,
  );
}

function create() {
  mount(<StaffCreateDialog open locations={[site]} onOpenChange={vi.fn()} />);
}

function edit(record: EditableStaff = person) {
  const saved = vi.fn();
  mount(<StaffEditDialog person={record} timezone={site.timezone} onClose={vi.fn()} onSaved={saved} />);
  return { saved };
}

function field(label: string, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

function fillShiftStart() {
  const start = screen.getByLabelText<HTMLInputElement>('Shift Start');
  // Mirror a browser time fill that sets the value before dispatching input and change.
  start.value = '08:00';
  fireEvent.input(start);
  fireEvent.change(start);
}

function submit(label = 'Create staff') {
  fireEvent.click(screen.getByRole('button', { name: label }));
}

beforeEach(() => {
  localStorage.clear();
  requests.length = 0;
  client.defaults.adapter = async config => {
    requests.push({ url: config.url, method: config.method, data: JSON.parse(config.data || '{}') });
    return { config, data: { data: { id: 7 } }, status: 200, statusText: 'OK', headers: {} };
  };
});

afterEach(() => { client.defaults.adapter = originalAdapter; });

it('shows the missing shift end alongside the three invalid contact fields on create', async () => {
  create();
  field('Phone Number', 'abc');
  field('Email (optional)', 'not-an-address');
  fillShiftStart();
  submit();

  expect(await screen.findAllByRole('alert')).toHaveLength(4);
  expect(screen.getByLabelText('Full Name')).toHaveAccessibleDescription('Full name is required.');
  expect(screen.getByLabelText('Phone Number')).toHaveAccessibleDescription(/Enter a Pakistan mobile number, like 03001234567\./);
  expect(screen.getByLabelText('Email (optional)')).toHaveAccessibleDescription('Enter a valid email, like name@example.com.');
  expect(screen.getByLabelText('Shift End')).toHaveAccessibleDescription('Times use the assigned site’s timezone. Enter both shift start and shift end.');
  expect(requests).toHaveLength(0);
});

it('shows the missing shift end on edit', async () => {
  edit();
  fillShiftStart();
  submit('Save changes');

  expect(await screen.findByRole('alert')).toHaveTextContent('Enter both shift start and shift end.');
  expect(screen.getByLabelText('Shift End')).toHaveAccessibleDescription(/Enter both shift start and shift end\./);
  expect(requests).toHaveLength(0);
});

it('saves a phone-only edit when the saved name contains a digit', async () => {
  const { saved } = edit({ ...person, name: 'Saved worker 2' });
  field('Phone Number', '03007654321');
  submit('Save changes');

  await waitFor(() => expect(saved).toHaveBeenCalledOnce());
  expect(requests).toEqual([{ url: '/staff/7', method: 'patch', data: { phone: '03007654321' } }]);
});

it('rejects a changed name that contains a digit', async () => {
  edit({ ...person, name: 'Saved worker 2' });
  field('Full Name', 'Changed worker 3');
  submit('Save changes');

  expect(await screen.findByRole('alert')).toHaveTextContent('Use letters only in the name.');
  expect(screen.getByLabelText('Full Name')).toHaveAccessibleDescription('Use letters only in the name.');
  expect(requests).toHaveLength(0);
});
