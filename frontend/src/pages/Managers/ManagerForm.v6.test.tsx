import { useState, type ComponentProps, type ReactNode } from 'react';
import { configureStore } from '@reduxjs/toolkit';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { Provider } from 'react-redux';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { client } from '@/api/client';
import authReducer, { setUser } from '@/store/slices/authSlice';
import { LanguageProvider } from '@/i18n/LanguageProvider';
import { translate } from '@/i18n/translations';
import ManagerFormDialog from './ManagerFormDialog';
import ManagersPage from './ManagersPage';
import type { Manager } from './types';

const sites = [{ id: 20, name: 'Saved site' }, { id: 30, name: 'Other saved site' }, { id: 40, name: 'Available site' }];
const manager: Manager = { id: 7, name: 'Saved manager', email: 'saved@example.invalid', isActive: true, createdAt: '2026-10-20T00:00:00Z', locations: [{ ...sites[0], isActive: true }] };
const requests: { url?: string; method?: string; data: Record<string, unknown> }[] = [];
const originalAdapter = client.defaults.adapter;
let failure: { status: number; code?: string } | undefined;
let hold = false;
let release: (() => void) | undefined;
function mount(child: ReactNode, language: 'en' | 'ur' = 'en') {
  localStorage.setItem('hygene-ops.language', language);
  const store = configureStore({ reducer: { auth: authReducer } });
  store.dispatch(setUser({ id: 2, companyId: 42, role: 'ADMIN', name: 'Saved owner', email: 'owner@example.invalid' }));
  const query = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const tree = (node: ReactNode) => <Provider store={store}><QueryClientProvider client={query}><LanguageProvider><MemoryRouter><div className="workspace">{node}</div></MemoryRouter></LanguageProvider></QueryClientProvider></Provider>;
  const view = render(tree(child));
  return { ...view, query, rerenderNode: (node: ReactNode) => view.rerender(tree(node)) };
}
function form(props: Partial<ComponentProps<typeof ManagerFormDialog>> = {}, language: 'en' | 'ur' = 'en') {
  const changed = vi.fn(), saved = vi.fn();
  return { ...mount(<ManagerFormDialog open locations={sites} onOpenChange={changed} onSaved={saved} {...props} />, language), changed, saved };
}
function field(label: string, value: string) { fireEvent.change(screen.getByLabelText(label), { target: { value } }); }
function fill() {
  field('Manager Name', 'New manager'); field('Email', 'new@example.invalid');
  if (screen.queryByLabelText('Password')) field('Password', 'synthetic password');
  fireEvent.click(screen.getByRole('checkbox', { name: 'Available site' }));
}
function submit(name = 'Create manager') { fireEvent.click(screen.getByRole('button', { name })); }
beforeEach(() => {
  localStorage.clear(); requests.length = 0; failure = undefined; hold = false; release = undefined;
  client.defaults.adapter = async config => {
    if (config.method === 'get') {
      const data = config.url?.includes('/manager')
        ? [manager, { ...manager, id: 8, name: 'Other manager', locations: [{ ...sites[1], isActive: true }] }, { ...manager, id: 9, name: 'Inactive manager', isActive: false, locations: [{ ...sites[2], isActive: true }] }]
        : sites.map(site => ({ ...site, isActive: true }));
      return { config, data: { data }, status: 200, statusText: 'OK', headers: {} };
    }
    requests.push({ url: config.url, method: config.method, data: JSON.parse(config.data || '{}') });
    if (hold) await new Promise<void>(resolve => { release = resolve; });
    if (failure) throw { config, response: { status: failure.status, data: { message: 'Private backend detail', errors: [{ code: failure.code }] } } };
    return { config, data: { data: { id: 7 } }, status: 200, statusText: 'OK', headers: {} };
  };
});
afterEach(() => { client.defaults.adapter = originalAdapter; });

it('names the panel, describes assignments and associates the footer submit', () => {
  form(); expect(screen.getByRole('dialog', { name: 'Add manager' })).toHaveAccessibleDescription('Access follows assigned locations');
  expect((screen.getByRole('button', { name: 'Create manager' }) as HTMLButtonElement).form).toBeInTheDocument();
  expect(screen.getByRole('group', { name: 'Assigned Locations' })).toHaveAccessibleDescription(/only see and manage/);
});
it('validates all required fields with associated errors and focuses the name', async () => {
  form(); submit(); expect(await screen.findAllByRole('alert')).toHaveLength(4);
  for (const label of ['Manager Name', 'Email', 'Password']) {
    expect(screen.getByLabelText(label)).toHaveAttribute('aria-invalid', 'true'); expect(screen.getByLabelText(label)).toHaveAccessibleDescription();
  }
  expect(screen.getByRole('group', { name: 'Assigned Locations' })).toHaveAccessibleDescription(/Assign at least one location/);
  expect(screen.getByLabelText('Manager Name')).toHaveFocus(); expect(requests).toHaveLength(0);
});
it.each([['Manager Name', 'A', 'Name must be at least 2 characters'], ['Password', 'short', 'Use at least 8 characters']])('retains %s minimum length', async (label, value, message) => {
  form(); fill(); field(label, value); submit(); expect(await screen.findByRole('alert')).toHaveTextContent(message); expect(requests).toHaveLength(0);
});
it('retains native email validation', () => {
  form(); fill(); field('Email', 'invalid-email'); submit(); expect(screen.getByLabelText('Email')).toBeInvalid(); expect(requests).toHaveLength(0);
});
it('requires a selected location', async () => {
  form(); fill(); fireEvent.click(screen.getByRole('checkbox', { name: 'Available site' })); submit();
  expect(await screen.findByRole('alert')).toHaveTextContent('Assign at least one location'); expect(requests).toHaveLength(0);
});
it('teaches the next step and validates an empty location scope', async () => {
  form({ locations: [] }); expect(screen.getByText('You need at least one location before you can create a manager.')).toBeInTheDocument();
  field('Manager Name', 'New manager'); field('Email', 'new@example.invalid'); field('Password', 'synthetic password'); submit();
  expect(await screen.findByRole('alert')).toHaveTextContent('Assign at least one location'); expect(requests).toHaveLength(0);
});
it('disables taken locations with the actual manager name', () => {
  form({ takenLocations: new Map([[20, 'Recorded owner']]) });
  expect(screen.getByRole('checkbox', { name: 'Saved site' })).toBeDisabled();
  expect(screen.getByRole('checkbox', { name: 'Saved site' })).toHaveAccessibleDescription('Assigned to Recorded owner');
  expect(screen.getByRole('checkbox', { name: 'Other saved site' })).toBeEnabled();
});
it('creates with unchanged trimmed payload, numeric ids, exact password and invalidation', async () => {
  const { changed, saved, query } = form(); const invalidate = vi.spyOn(query, 'invalidateQueries'); fill();
  field('Manager Name', '  New manager  '); field('Password', '  synthetic password  ');
  fireEvent.click(screen.getByRole('checkbox', { name: 'Saved site' })); submit(); await waitFor(() => expect(saved).toHaveBeenCalledTimes(1));
  expect(requests).toEqual([{ url: '/manager/', method: 'post', data: { name: 'New manager', email: 'new@example.invalid', password: '  synthetic password  ', locationIds: [20, 40] } }]);
  expect(changed).toHaveBeenCalledWith(false); expect(invalidate).toHaveBeenCalledWith({ queryKey: ['getManagers'] });
});
it('edits preselected assignments without rendering or sending a password', async () => {
  const { changed, saved } = form({ manager }); expect(screen.getByRole('dialog', { name: 'Edit manager' })).toBeInTheDocument();
  expect(screen.queryByLabelText('Password')).not.toBeInTheDocument();
  expect(screen.getByText('Managers change their own password in Account security. Owner password replacement is unavailable.')).toBeInTheDocument();
  expect(screen.getByRole('checkbox', { name: 'Saved site' })).toBeChecked();
  fireEvent.click(screen.getByRole('checkbox', { name: 'Available site' })); submit('Save changes'); await waitFor(() => expect(saved).toHaveBeenCalledTimes(1));
  expect(requests).toEqual([{ url: '/manager/7', method: 'patch', data: { name: 'Saved manager', email: 'saved@example.invalid', locationIds: [20, 40] } }]);
  expect(changed).toHaveBeenCalledWith(false);
});
it('can release an assignment while retaining another', async () => {
  form({ manager }); fireEvent.click(screen.getByRole('checkbox', { name: 'Saved site' })); fireEvent.click(screen.getByRole('checkbox', { name: 'Other saved site' })); submit('Save changes');
  await waitFor(() => expect(requests).toHaveLength(1)); expect(requests[0].data.locationIds).toEqual([30]);
});
it.each([
  [409, undefined, 'The record changed or a site is already assigned. Refresh before retrying. Your draft is kept.'],
  [403, undefined, 'You do not have access to this action. Refresh your assigned sites.'],
  [503, undefined, 'The action could not be confirmed. Refresh the record before retrying. Your draft is kept.'],
  [403, 'CAPACITY_REACHED', 'Your plan’s manager capacity has been reached. Review Plan & billing. Your draft is kept.'],
  [403, 'SUBSCRIPTION_REQUIRED', 'An active subscription is required to add managers. Review Plan & billing. Your draft is kept.'],
])('keeps drafts and safe guidance after %s %s', async (status, code, message) => {
  failure = { status, code }; const { changed, saved } = form(); fill(); submit(); expect(await screen.findByRole('alert')).toHaveTextContent(message);
  expect(screen.queryByText('Private backend detail')).not.toBeInTheDocument(); expect(screen.getByLabelText('Manager Name')).toHaveValue('New manager');
  expect(screen.getByLabelText('Password')).toHaveValue('synthetic password'); expect(screen.getByRole('checkbox', { name: 'Available site' })).toBeChecked();
  expect(changed).not.toHaveBeenCalled(); expect(saved).not.toHaveBeenCalled();
});
it('permits a deliberate retry with the preserved payload', async () => {
  failure = { status: 409 }; const { saved } = form(); fill(); submit(); await screen.findByRole('alert'); failure = undefined; submit();
  await waitFor(() => expect(saved).toHaveBeenCalledTimes(1)); expect(requests).toHaveLength(2); expect(requests[1]).toEqual(requests[0]);
});
it.each([false, true])('blocks duplicates and dismissals while pending (edit %s)', async editing => {
  hold = true; const { changed } = form(editing ? { manager } : {}); if (!editing) fill();
  const button = screen.getByRole('button', { name: editing ? 'Save changes' : 'Create manager' }) as HTMLButtonElement;
  fireEvent.submit(button.form!); fireEvent.submit(button.form!); await waitFor(() => expect(requests).toHaveLength(1));
  await waitFor(() => expect(screen.getByRole('button', { name: editing ? 'Saving...' : 'Creating...' })).toBeDisabled());
  expect(screen.getByLabelText('Manager Name')).toBeDisabled(); expect(screen.getByRole('checkbox', { name: 'Available site' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled(); fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
  fireEvent.click(screen.getByRole('button', { name: 'Close' }));
  fireEvent.pointerDown(document.querySelector('.wx-side-panel-scrim')!, { button: 0, ctrlKey: false });
  expect(changed).not.toHaveBeenCalled(); expect(requests).toHaveLength(1);
  await act(async () => release?.()); await waitFor(() => expect(changed).toHaveBeenCalledWith(false));
});
it.each(['Cancel', 'Close', 'Escape'])('dismisses with %s and restores opener focus', async action => {
  function Demo() { const [open, setOpen] = useState(false); return <><button onClick={() => setOpen(true)}>Open form</button><ManagerFormDialog open={open} onOpenChange={setOpen} locations={sites} /></>; }
  mount(<Demo />); const opener = screen.getByRole('button', { name: 'Open form' }); opener.focus(); fireEvent.click(opener);
  expect(screen.getByRole('heading', { name: 'Add manager' })).toHaveFocus();
  if (action === 'Escape') fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' }); else fireEvent.click(screen.getByRole('button', { name: action }));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument()); expect(opener).toHaveFocus(); expect(requests).toHaveLength(0);
});
it('retains the mounted draft and focus when parent assignments refresh', () => {
  const props = { open: true, onOpenChange: vi.fn(), manager, locations: sites }; const view = mount(<ManagerFormDialog {...props} />);
  const name = screen.getByLabelText('Manager Name'); field('Manager Name', 'Draft manager'); name.focus();
  view.rerenderNode(<ManagerFormDialog {...props} manager={{ ...manager, name: 'Refreshed manager' }} takenLocations={new Map([[30, 'New assignee']])} />);
  expect(name).toHaveValue('Draft manager'); expect(name).toHaveFocus(); expect(screen.getByRole('checkbox', { name: 'Other saved site' })).toBeDisabled();
});
it('translates Urdu labels and guidance while preserving saved names and LTR email', () => {
  form({ manager, takenLocations: new Map([[30, 'Recorded owner']]) }, 'ur');
  expect(screen.getByRole('dialog', { name: translate('Edit manager', 'ur') })).toHaveAttribute('dir', 'rtl');
  expect(screen.queryByLabelText(translate('Password', 'ur'))).not.toBeInTheDocument(); expect(screen.getByLabelText(translate('Email', 'ur'))).toHaveAttribute('dir', 'ltr');
  expect(screen.getByRole('checkbox', { name: 'Other saved site' })).toHaveAccessibleDescription(translate('Assigned to {name}', 'ur', { name: 'Recorded owner' }));
});
it('the real parent disables other active managers’ locations and releases inactive ones', async () => {
  mount(<ManagersPage />); fireEvent.click(await screen.findByRole('button', { name: 'Add manager' }));
  expect(screen.getByRole('checkbox', { name: 'Saved site' })).toBeDisabled(); expect(screen.getByRole('checkbox', { name: 'Saved site' })).toHaveAccessibleDescription('Assigned to Saved manager');
  expect(screen.getByRole('checkbox', { name: 'Other saved site' })).toHaveAccessibleDescription('Assigned to Other manager'); expect(screen.getByRole('checkbox', { name: 'Available site' })).toBeEnabled();
});
it('the real parent keeps the manager’s own locations editable', async () => {
  mount(<ManagersPage />); const row = await screen.findByRole('row', { name: /Saved manager/ }); fireEvent.click(within(row).getByRole('button', { name: 'Edit' }));
  expect(screen.getByRole('checkbox', { name: 'Saved site' })).toBeEnabled(); expect(screen.getByRole('checkbox', { name: 'Saved site' })).toBeChecked(); expect(screen.getByRole('checkbox', { name: 'Other saved site' })).toBeDisabled();
});
