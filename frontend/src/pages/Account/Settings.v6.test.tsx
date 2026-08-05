import type { ReactNode } from 'react';
import { configureStore } from '@reduxjs/toolkit';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Provider } from 'react-redux';
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { beforeEach, expect, it, vi } from 'vitest';
import { LanguageProvider } from '@/i18n/LanguageProvider';
import { translate } from '@/i18n/translations';
import { WorkspaceTheme } from '@/components/common/WorkspaceTheme';
import authReducer, { setUser, type AuthUser } from '@/store/slices/authSlice';
import { CompanySettingsPage, OwnSecurityPage } from './AccountPages';

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), patch: vi.fn() }));
vi.mock('@/api/client', () => ({ client: api }));
const company = { id: 42, name: 'Saved company', accountVersion: 3, updatedAt: '2026-11-10T00:00:00Z' };
const owner = { id: 7, companyId: 42, role: 'ADMIN' as const, name: 'Saved owner', email: 'owner@example.invalid' };
const identity = { emailVerified: false, deliveryConfigured: true, bootstrapRequired: false };
function Location() {
 const location = useLocation(), navigate = useNavigate();
 return <><span aria-label="Current URL">{location.pathname + location.search}</span><button onClick={() => navigate(-1)}>Browser back</button></>;
}
function mount({ path = '/settings', role = 'ADMIN', language = 'en', page = <CompanySettingsPage/>, workspace = true }: { path?: string; role?: AuthUser['role'] | null; language?: 'en' | 'ur'; page?: ReactNode; workspace?: boolean } = {}) {
 localStorage.setItem('hygene-ops.language', language);
 const store = configureStore({ reducer: { auth: authReducer } });
 if (role) store.dispatch(setUser({ ...owner, role }));
 const query = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
 query.setQueryData(['private-data'], { private: true });
 const view = render(<Provider store={store}><QueryClientProvider client={query}><LanguageProvider><WorkspaceTheme.Provider value={workspace}><MemoryRouter initialEntries={[path]}><Routes><Route path="/settings" element={<div className="workspace">{page}<Location/></div>}/><Route path="/login" element={<h1>Sign in again</h1>}/></Routes></MemoryRouter></WorkspaceTheme.Provider></LanguageProvider></QueryClientProvider></Provider>);
 return { ...view, store, query };
}
function password(next = 'New password 123', confirmation = next) {
 fireEvent.change(screen.getByLabelText('Current password'), { target: { value: 'Current password 123' } });
 fireEvent.change(screen.getByLabelText('New password'), { target: { value: next } });
 fireEvent.change(screen.getByLabelText('Confirm new password'), { target: { value: confirmation } });
 fireEvent.click(screen.getByRole('button', { name: 'Change password' }));
}
beforeEach(() => {
 vi.clearAllMocks(); localStorage.clear();
 api.get.mockImplementation(async (url: string) => ({ data: { data: url === '/company/settings' ? company : identity } }));
 api.patch.mockImplementation(async (_url, body) => ({ data: { data: { company: { ...company, name: body.name, accountVersion: 4 }, changed: true } } }));
 api.post.mockResolvedValue({ data: { data: { completed: true } } });
});

it('section buttons write the URL, preserve unrelated parameters, and default Organization removes section', async () => {
 mount({ path: '/settings?keep=1' }); await screen.findByLabelText('Company name');
 fireEvent.click(screen.getByRole('button', { name: 'My account' }));
 expect(screen.getByLabelText('Current URL')).toHaveTextContent('/settings?keep=1&section=account');
 expect(screen.getByRole('button', { name: 'My account' })).toHaveAttribute('aria-pressed', 'true');
 fireEvent.click(screen.getByRole('button', { name: 'Security' }));
 expect(screen.getByLabelText('Current URL')).toHaveTextContent('/settings?keep=1&section=security');
 fireEvent.click(screen.getByRole('button', { name: 'Organization' }));
 expect(screen.getByLabelText('Current URL')).toHaveTextContent('/settings?keep=1');
});
it.each(['account', 'security'])('supports a direct %s section link and browser Back', async section => {
 mount({ path: '/settings?section=' + section });
 expect(screen.getByRole('heading', { name: section === 'account' ? 'My account' : 'Change password' })).toBeVisible();
 fireEvent.click(screen.getByRole('button', { name: 'Organization' }));
 fireEvent.click(screen.getByRole('button', { name: 'Browser back' }));
 expect(screen.getByRole('heading', { name: section === 'account' ? 'My account' : 'Change password' })).toBeVisible();
});
it('unknown sections fall back without rewriting the URL', async () => {
 mount({ path: '/settings?section=unknown&keep=1' });
 expect(await screen.findByLabelText('Company name')).toBeVisible();
 expect(screen.getByLabelText('Current URL')).toHaveTextContent('section=unknown&keep=1');
});
it('confirmed company saves use the saved version and only the supported name field', async () => {
 mount(); fireEvent.change(await screen.findByLabelText('Company name'), { target: { value: '  Updated company  ' } });
 fireEvent.click(screen.getByRole('button', { name: 'Save company name' }));
 expect(await screen.findByRole('status')).toHaveTextContent('Company settings saved.');
 expect(api.patch).toHaveBeenCalledWith('/company/settings', { name: 'Updated company', expectedVersion: 3 });
 expect(screen.getByText('Saved company name: Updated company')).toBeVisible();
 expect(screen.queryByLabelText('Business phone')).not.toBeInTheDocument();
 expect(screen.queryByLabelText('City')).not.toBeInTheDocument();
});
it('pending company saves disable duplicate actions without claiming persistence', async () => {
 let release!: (value: unknown) => void;
 api.patch.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
 mount(); await screen.findByLabelText('Company name');
 fireEvent.click(screen.getByRole('button', { name: 'Save company name' }));
 const pending = await screen.findByRole('button', { name: 'Saving…' }); expect(pending).toBeDisabled(); fireEvent.click(pending);
 expect(api.patch).toHaveBeenCalledTimes(1); expect(screen.queryByText('Company settings saved.')).not.toBeInTheDocument();
 await act(async () => { release({ data: { data: { company } } }); });
 expect(await screen.findByText('Company settings saved.')).toBeVisible();
});
it.each([409, 403, 503])('save failure %s preserves the name draft and safe error wording', async status => {
 api.patch.mockRejectedValueOnce({ response: { status, data: { message: 'Private provider details' } } });
 mount(); fireEvent.change(await screen.findByLabelText('Company name'), { target: { value: 'Kept draft' } });
 fireEvent.click(screen.getByRole('button', { name: 'Save company name' }));
 expect(await screen.findByRole('alert')).toHaveTextContent(status === 409 ? 'Company settings changed elsewhere. Your draft is kept. Reload saved settings before trying again.' : status === 403 ? 'Company changes are restricted. Check your account access or plan activation.' : 'Company settings could not be saved. Your draft is kept. Try again.');
 expect(screen.getByLabelText('Company name')).toHaveValue('Kept draft'); expect(screen.queryByText('Private provider details')).not.toBeInTheDocument();
});
it('section switching keeps the organization draft', async () => {
 mount(); fireEvent.change(await screen.findByLabelText('Company name'), { target: { value: 'Unsaved name' } });
 fireEvent.click(screen.getByRole('button', { name: 'Security' })); fireEvent.click(screen.getByRole('button', { name: 'Organization' }));
 expect(screen.getByLabelText('Company name')).toHaveValue('Unsaved name');
});
it('background failures preserve cached name draft and focus, with an explicit successful reload replacing it', async () => {
 const { query } = mount(); const input = await screen.findByLabelText('Company name');
 fireEvent.change(input, { target: { value: 'Draft after failure' } }); input.focus();
 api.get.mockRejectedValueOnce(new Error('Network unavailable'));
 await act(async () => { await query.refetchQueries({ queryKey: ['companySettings', 42] }); });
 expect(await screen.findByRole('alert')).toHaveTextContent('Company settings could not load. Your saved records are unchanged.');
 expect(input).toHaveValue('Draft after failure'); expect(input).toHaveFocus();
 api.get.mockResolvedValueOnce({ data: { data: { ...company, name: 'New saved name', accountVersion: 5 } } });
 fireEvent.click(screen.getByRole('button', { name: 'Reload saved settings' }));
 await waitFor(() => expect(screen.getByLabelText('Company name')).toHaveValue('New saved name'));
});
it('initial loading announces the company read without fields or invented records', () => {
 api.get.mockImplementation(() => new Promise(() => undefined)); mount();
 expect(screen.getByRole('status')).toHaveAttribute('aria-busy', 'true');
 expect(screen.getByRole('status')).toHaveTextContent('Loading company settings…');
 expect(screen.queryByLabelText('Company name')).not.toBeInTheDocument();
 expect(screen.getByRole('heading', { name: 'What stays protected' })).toBeVisible();
});
it.each([403, 503])('initial %s read failure offers the unchanged recovery action and independent security', async status => {
 api.get.mockRejectedValueOnce({ response: { status } }); mount();
 expect(await screen.findByRole('alert')).toHaveTextContent(status === 403 ? 'Company settings are restricted.' : 'Your saved records are unchanged.');
 expect(screen.getByRole('link', { name: 'Change your password' })).toHaveAttribute('href', '/account/security');
 fireEvent.click(screen.getByRole('button', { name: 'Reload saved settings' })); expect(await screen.findByLabelText('Company name')).toHaveValue(company.name);
});
it('a blank saved name stays editable with no fabricated organization fields', async () => {
 api.get.mockResolvedValueOnce({ data: { data: { ...company, name: '' } } }); mount();
 expect(await screen.findByLabelText('Company name')).toHaveValue('');
 fireEvent.change(screen.getByLabelText('Company name'), { target: { value: 'First saved name' } }); fireEvent.click(screen.getByRole('button', { name: 'Save company name' }));
 expect(await screen.findByText('Company settings saved.')).toBeVisible();
});
it('account identity comes from the signed-in user and verification loads only on demand', async () => {
 mount(); await screen.findByLabelText('Company name'); expect(api.get).toHaveBeenCalledTimes(1);
 fireEvent.click(screen.getByRole('button', { name: 'My account' }));
 expect(screen.getByText(owner.name)).toBeVisible(); expect(screen.getByText(owner.email)).toHaveAttribute('dir', 'ltr');
 expect(await screen.findByText('Owner email is not verified.')).toBeVisible();
 expect(api.get).toHaveBeenCalledWith('/owner-identity/status');
 fireEvent.change(screen.getByLabelText('Current password'), { target: { value: 'Current password 123' } });
 fireEvent.click(screen.getByRole('button', { name: 'Request verification link' }));
 expect(await screen.findByRole('status')).toHaveTextContent('Delivery is not confirmed.');
 expect(api.post).toHaveBeenCalledWith('/owner-identity/email/request', { currentPassword: 'Current password 123' });
});
it('verification read errors retry without inferring verified status', async () => {
 api.get.mockImplementation(async url => { if (url === '/owner-identity/status') throw new Error('offline'); return { data: { data: company } }; });
 mount({ path: '/settings?section=account' });
 expect(await screen.findByRole('alert')).toHaveTextContent('Owner verification status could not load.');
 api.get.mockResolvedValueOnce({ data: { data: { ...identity, emailVerified: true } } });
 fireEvent.click(screen.getByRole('button', { name: 'Retry' })); expect(await screen.findByText('Owner email is verified.')).toBeVisible();
});
it.each([403, 400, 503])('password error %s shows exact guidance and keeps the failed draft', async status => {
 api.post.mockRejectedValueOnce({ response: { status, data: { message: 'Private password error' } } });
 mount({ path: '/settings?section=security' }); password();
 expect(await screen.findByRole('alert')).toHaveTextContent(status === 403 ? 'Your current password could not be verified, or access changed. Check it and try again.' : status === 400 ? 'Choose a different valid new password and try again.' : 'The password could not be changed. Check your connection and try again.');
 expect(screen.getByLabelText('New password')).toHaveValue('New password 123'); expect(screen.queryByText('Private password error')).not.toBeInTheDocument();
 expect(screen.getByRole('heading', { name: 'Session security' })).toBeVisible();
});
it('mismatched passwords keep validation wording and never send a mutation', async () => {
 mount({ path: '/settings?section=security' }); password('New password 123', 'Mismatch password');
 expect(await screen.findByRole('alert')).toHaveTextContent('Enter matching new passwords, at least 8 characters and at most 72 UTF-8 bytes.'); expect(api.post).not.toHaveBeenCalled();
});
it('successful password changes revoke the session and all private caches', async () => {
 const { store, query } = mount({ path: '/settings?section=security' }); password();
 expect(await screen.findByRole('heading', { name: 'Sign in again' })).toBeVisible();
 expect(api.post).toHaveBeenCalledWith('/common/security/password', { currentPassword: 'Current password 123', newPassword: 'New password 123' });
 expect(store.getState().auth.user).toBeNull(); expect(query.getQueryData(['private-data'])).toBeUndefined();
});
it.each(['MANAGER', 'STAFF'] as const)('%s cannot read organization settings', role => {
 mount({ role }); expect(screen.getByRole('alert')).toHaveTextContent('Only the company owner'); expect(api.get).not.toHaveBeenCalled();
});
it('workspace own security uses the workspace panel and never asks for owner or company data', async () => {
 mount({ role: 'MANAGER', page: <OwnSecurityPage/> });
 expect(screen.getByRole('region', { name: 'Change password' })).toBeVisible(); expect(screen.getByRole('heading', { name: 'Your account security' })).toBeVisible(); expect(api.get).not.toHaveBeenCalled();
 api.post.mockRejectedValueOnce({ response: { status: 403 } }); password(); expect(await screen.findByRole('alert')).toHaveTextContent('Your current password could not be verified');
});
it('signed-out workspace security offers sign in without password fields', () => {
 mount({ role: null, page: <OwnSecurityPage/> }); expect(screen.getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/login'); expect(screen.queryByLabelText('New password')).not.toBeInTheDocument();
});
it('Urdu sections and facts mirror while account email and passwords stay LTR', async () => {
 mount({ language: 'ur' }); expect(document.documentElement.dir).toBe('rtl');
 fireEvent.click(screen.getByRole('button', { name: translate('My account', 'ur') }));
 expect(screen.getByText(owner.email)).toHaveAttribute('dir', 'ltr'); await screen.findByText(translate('Owner email is not verified.', 'ur'));
 fireEvent.click(screen.getByRole('button', { name: translate('Security', 'ur') }));
 expect(screen.getByLabelText(translate('Current password', 'ur'))).toHaveAttribute('dir', 'ltr');
 expect(screen.getByLabelText('Current URL')).toHaveTextContent('section=security');
});
