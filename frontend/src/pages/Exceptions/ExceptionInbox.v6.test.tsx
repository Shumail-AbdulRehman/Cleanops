import { useState } from 'react';
import { configureStore } from '@reduxjs/toolkit';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { Provider } from 'react-redux';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import authReducer, { setUser } from '@/store/slices/authSlice';
import { LanguageProvider } from '@/i18n/LanguageProvider';
import { translate } from '@/i18n/translations';
import { localTime } from '../Manager/operations';
import ExceptionInboxPage from './ExceptionInboxPage';
import type { ExceptionDetail, VerificationException } from './types';

const api = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('@/api/client', () => ({ client: api }));
// Case content/decisions belong to specs 20/21; existing ReviewWorkspace and
// LaunchReviewContext tests exercise the real integration alongside this file.
vi.mock('./ReviewDetail', () => ({ default: function Case({ id, backTo }: { id: number; backTo: string }) {
  const [draft, setDraft] = useState('');
  return <section aria-label="Synthetic case"><h2>Case {id}</h2><a href={backTo}>Back to queue</a>
    <input aria-label="Synthetic case draft" value={draft} onChange={event => setDraft(event.target.value)} /></section>;
} }));
const site = { id: 8, name: 'Synthetic site', timezone: 'Asia/Karachi' };
const other = { id: 9, name: 'Today', timezone: 'Asia/Karachi' };
const record = (id: number, extra: Partial<VerificationException> = {}): VerificationException => ({
  id, kind: 'TASK', state: 'MANAGER_REVIEW', priority: 3, rowVersion: 2, locationId: 8,
  firstRaisedAt: '2026-11-08T04:00:00Z', updatedAt: '2026-11-10T04:00:00Z', displayReasonCode: 'SERVICE_FAILURE',
  location: site, area: { id: 7, name: `Synthetic room ${id}` }, issues: [],
  task: { id: id + 100, title: 'Synthetic cleaning', shiftEnd: '2026-11-09T05:00:00Z', staffSubmittedAt: null, staff: { id: 6, name: 'Synthetic worker' }, verificationState: 'NEEDS_REVIEW', completionOutcome: null }, ...extra,
});
let rows: VerificationException[];
let decisions: ExceptionDetail['decisions'];
let failed: boolean, outcomeFailed: boolean, areaFailed: boolean;
let pending: boolean;
let queryClients: QueryClient[];
function response(data: unknown) { return { data: { data } }; }
function mount(entry = '/exceptions', language = 'en', role: 'ADMIN' | 'MANAGER' = 'MANAGER') {
  localStorage.setItem('hygene-ops.language', language);
  const store = configureStore({ reducer: { auth: authReducer } });
  store.dispatch(setUser({ id: 1, companyId: 42, role, name: 'Synthetic operator', email: 'operator@example.invalid' }));
  const query = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  queryClients.push(query);
  const element = <ExceptionInboxPage />;
  const router = createMemoryRouter([{ path: '/exceptions', element }, { path: '/exceptions/:id', element }], { initialEntries: [entry] });
  const view = render(<Provider store={store}><QueryClientProvider client={query}><LanguageProvider><div className="workspace"><RouterProvider router={router} /></div></LanguageProvider></QueryClientProvider></Provider>);
  return { ...view, router, query, store };
}
const queue = () => screen.getByRole('region', { name: 'Review queue' });
async function loaded() { await screen.findByRole('heading', { name: 'Synthetic room 3' }); }
function filters() { fireEvent.click(screen.getByRole('button', { name: 'Review filters' })); return screen.getByRole('region', { name: 'Review filters' }); }
async function choose(label: string, option: string, root = screen) {
  fireEvent.keyDown(root.getByRole('button', { name: new RegExp(`^${label}:`) }), { key: 'ArrowDown' });
  fireEvent.click(screen.getByRole('menuitemradio', { name: option }));
  await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument());
}
const params = (router: ReturnType<typeof createMemoryRouter>) => new URLSearchParams(router.state.location.search);

beforeEach(() => {
  vi.clearAllMocks(); localStorage.clear(); queryClients = [];
  rows = [record(3), record(4, { priority: 2, displayReasonCode: 'MISSING_EVIDENCE' })];
  failed = outcomeFailed = areaFailed = pending = false;
  decisions = [{ id: 2, action: 'RESOLVE_REVIEW', reasonCode: 'MANAGER_RESOLVED', createdAt: '2026-11-10T05:10:00Z' }];
  api.get.mockImplementation(async (url: string, options?: { params?: Record<string, string> }) => {
    if (url === '/verification-exceptions') {
      if (pending) return new Promise(() => {});
      if (failed) throw { response: { status: 503 } };
      const p = options?.params ?? {};
      return response({ cases: rows, locations: [site, other], queueCounts: { 'needs-me': 12, resolved: 7, staff: 2, service: 1 }, page: Number(p.page || 1), pageSize: Number(p.pageSize || 20), total: rows.length ? 43 : 0, totalPages: rows.length ? 3 : 1 });
    }
    if (url.endsWith('/areas')) {
      if (areaFailed) throw { response: { status: 503 } };
      return response([{ id: 7, name: 'Synthetic area' }]);
    }
    if (outcomeFailed) throw { response: { status: 503 } };
    return response({ ...record(Number(url.split('/').pop())), state: 'RESOLVED', decisions, items: [], events: [], allowedActions: [] });
  });
});
afterEach(() => { queryClients.forEach(query => query.clear()); });

it('shows server queue counts and writes queue while resetting the page and preserving every filter', async () => {
  const { router } = mount('/exceptions?locationId=8&areaId=7&period=earlier&date=2026-11-09&q=sink&page=2&pageSize=50&reasonCode=MISSING_EVIDENCE');
  await loaded();
  expect(screen.getByRole('tab', { name: 'Pending 12' })).toHaveAttribute('aria-selected', 'true');
  fireEvent.mouseDown(screen.getByRole('tab', { name: 'Reviewed 7' }), { button: 0, ctrlKey: false });
  await waitFor(() => expect(params(router).get('queue')).toBe('resolved'));
  expect(params(router).has('page')).toBe(false);
  for (const [key, value] of Object.entries({ locationId: '8', areaId: '7', period: 'earlier', date: '2026-11-09', q: 'sink', pageSize: '50', reasonCode: 'MISSING_EVIDENCE' })) expect(params(router).get(key)).toBe(value);
});
it('returns to Pending using the URL-backed tab', async () => {
  const { router } = mount('/exceptions?queue=resolved'); await loaded();
  fireEvent.mouseDown(screen.getByRole('tab', { name: 'Pending 12' }), { button: 0, ctrlKey: false });
  await waitFor(() => expect(params(router).get('queue')).toBe('needs-me'));
});
it.each(['RESOLVE_REVIEW', 'RECORD_PERFORMANCE_ISSUE'])('shows the recorded %s outcome and closure time without implying verification', async action => {
  rows = [record(3, { state: 'RESOLVED' })]; decisions[0].action = action;
  mount('/exceptions?queue=resolved');
  const outcome = action === 'RESOLVE_REVIEW' ? 'Resolution recorded' : 'Staff performance issue recorded';
  expect(await within(queue()).findByText(outcome)).toBeInTheDocument();
  expect(within(queue()).getByText('Review handled')).toBeInTheDocument();
  expect(within(queue()).getByText('Review closed')).toBeInTheDocument();
  expect(within(queue()).getByText('Task not submitted')).toBeInTheDocument();
  expect(within(queue()).getByText(localTime(decisions[0].createdAt, site.timezone, 'en', true)).closest('time')).toHaveAttribute('dateTime', decisions[0].createdAt);
  expect(within(queue()).queryByText(/Verified/)).not.toBeInTheDocument();
  expect(api.get).toHaveBeenCalledWith('/verification-exceptions/3', { params: {} });
});
it('does not invent the outcome of a historical closure with no decision', async () => {
  rows = [record(3, { state: 'RESOLVED' })]; decisions = []; mount('/exceptions?queue=resolved');
  expect(await screen.findByText('Review closed; decision details unavailable')).toBeInTheDocument();
  expect(screen.queryByText('Resolution recorded')).not.toBeInTheDocument();
});
it('retries a failed outcome read without nesting a button in its case link', async () => {
  rows = [record(3, { state: 'RESOLVED' })]; outcomeFailed = true; mount('/exceptions?queue=resolved');
  await screen.findByText('Review closed; decision details unavailable');
  const retry = within(queue()).getByRole('button', { name: 'Retry' }); expect(retry.closest('a')).toBeNull();
  outcomeFailed = false; fireEvent.click(retry); expect(await screen.findByText('Resolution recorded')).toBeInTheDocument();
});
it('keeps service failure reason wording and the server priority/oldest ordering', async () => {
  mount(); await loaded();
  const links = within(queue()).getAllByRole('link');
  expect(links.map(link => link.querySelector('h2')?.textContent)).toEqual(['Synthetic room 3', 'Synthetic room 4']);
  expect(links[0]).toHaveTextContent('Automatic check could not finish');
  expect(links[1]).toHaveTextContent('Required photo is missing');
  expect(links[0]).not.toHaveTextContent('More cleaning is needed');
});
it('updates search immediately, debounces the request and clears search', async () => {
  const { router } = mount('/exceptions?locationId=8&page=2'); await loaded();
  const search = screen.getByRole('searchbox', { name: 'Find a review' });
  fireEvent.change(search, { target: { value: 'Synthetic sink' } }); expect(params(router).get('q')).toBe('Synthetic sink');
  expect(params(router).has('page')).toBe(false); expect(params(router).get('locationId')).toBe('8');
  await waitFor(() => expect(api.get).toHaveBeenCalledWith('/verification-exceptions', expect.objectContaining({ params: expect.objectContaining({ q: 'Synthetic sink' }), signal: expect.any(AbortSignal) })));
  fireEvent.click(screen.getByRole('button', { name: 'Clear search' })); expect(params(router).has('q')).toBe(false);
});
it('writes location and clears dependent area and stale page', async () => {
  const { router } = mount('/exceptions?locationId=8&areaId=7&page=2&reasonCode=SERVICE_FAILURE'); await loaded();
  await choose('Location', 'Today');
  expect(params(router).get('locationId')).toBe('9'); expect(params(router).has('areaId')).toBe(false); expect(params(router).has('page')).toBe(false);
  expect(params(router).get('reasonCode')).toBe('SERVICE_FAILURE');
});
it.each([['Today', 'today'], ['Earlier work', 'earlier'], ['All dates', 'all']])('writes period %s', async (label, period) => {
  const { router } = mount('/exceptions?period=date&date=2026-11-09'); await loaded(); await choose('Period', label);
  expect(params(router).get('period')).toBe(period); expect(params(router).get('date')).toBe('2026-11-09');
});
it('writes a specific local calendar date without converting its timezone', async () => {
  const { router } = mount('/exceptions?period=date&date=2026-11-09&locationId=8'); await loaded();
  fireEvent.click(screen.getByRole('button', { name: /^Local date:/ }));
  const day = new Intl.DateTimeFormat('en-PK', { dateStyle: 'full', timeZone: 'UTC' }).format(new Date('2026-11-08T12:00:00Z'));
  fireEvent.click(screen.getByRole('button', { name: day }));
  expect(params(router).get('date')).toBe('2026-11-08'); expect(params(router).get('period')).toBe('date');
});
it('writes review reason and area from the filter panel and clears all filters except queue', async () => {
  const { router } = mount('/exceptions?locationId=8&queue=resolved&page=2&pageSize=50'); await loaded();
  let panel = filters(); await choose('Review reason', 'Photo needs a privacy check', within(panel) as typeof screen);
  expect(params(router).get('reasonCode')).toBe('PRIVACY_HOLD');
  panel = await screen.findByRole('region', { name: 'Review filters' });
  await choose('Area', 'Synthetic area', within(panel) as typeof screen); expect(params(router).get('areaId')).toBe('7');
  fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
  expect(Object.fromEntries(params(router))).toEqual({ queue: 'resolved' });
});
it('keeps location, period and the specific date reachable inside the filter panel', async () => {
  const { router } = mount('/exceptions?locationId=8&areaId=7&page=2'); await loaded();
  const panel = filters();
  await choose('Location', 'Today', within(panel) as typeof screen);
  expect(params(router).get('locationId')).toBe('9'); expect(params(router).has('areaId')).toBe(false);
  expect(params(router).has('page')).toBe(false);
  await choose('Period', 'Specific date', within(panel) as typeof screen);
  expect(params(router).get('period')).toBe('date');
  await act(() => router.navigate('/exceptions?locationId=9&period=date&date=2026-11-09'));
  fireEvent.click(within(panel).getByRole('button', { name: /^Local date:/ }));
  const date = new Intl.DateTimeFormat('en-PK', { dateStyle: 'full', timeZone: 'UTC' }).format(new Date('2026-11-07T12:00:00Z'));
  fireEvent.click(screen.getByRole('button', { name: date }));
  expect(params(router).get('date')).toBe('2026-11-07'); expect(params(router).get('locationId')).toBe('9');
  fireEvent.click(screen.getByRole('button', { name: 'Review filters' }));
  expect(screen.queryByRole('region', { name: 'Review filters' })).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Review filters' })).toHaveAttribute('aria-expanded', 'false');
});
it('shows authoritative zero counts instead of dropping the queue count', async () => {
  rows = [];
  api.get.mockResolvedValue(response({ cases: [], locations: [], queueCounts: { 'needs-me': 0, resolved: 0 }, page: 1, pageSize: 20, total: 0, totalPages: 1 }));
  mount();
  expect(await screen.findByRole('tab', { name: 'Pending 0' })).toBeInTheDocument();
  expect(screen.getByRole('tab', { name: 'Reviewed 0' })).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: 'Select a review' })).toBeInTheDocument();
});
it.each(['ADMIN', 'MANAGER'] as const)('keeps %s queue reads in the existing actor-scoped cache', async role => {
  const { query } = mount('/exceptions?locationId=8', 'en', role); await loaded();
  expect(query.getQueryCache().findAll({ queryKey: ['review-page'] }).map(item => item.queryKey[1])).toEqual([`42:${role}:1`]);
  expect(api.get).toHaveBeenCalledWith('/verification-exceptions', expect.objectContaining({ params: expect.objectContaining({ locationId: '8' }), signal: expect.any(AbortSignal) }));
});
it('keeps a reviewed row mounted while its saved outcome refreshes', async () => {
  rows = [record(3, { state: 'RESOLVED' })];
  const { query } = mount('/exceptions?queue=resolved');
  await screen.findByText('Resolution recorded');
  const link = within(queue()).getByRole('link'); link.focus();
  decisions = [{ ...decisions[0], action: 'RECORD_PERFORMANCE_ISSUE' }];
  await act(async () => { await query.invalidateQueries({ queryKey: ['exception'] }); });
  expect(await screen.findByText('Staff performance issue recorded')).toBeInTheDocument();
  expect(within(queue()).getByRole('link')).toBe(link); expect(link).toHaveFocus();
});
it('keeps area selection disabled without a location and retries area errors', async () => {
  const { router } = mount(); await loaded(); let panel = filters(); expect(within(panel).getByRole('button', { name: 'Area: All areas' })).toBeDisabled();
  areaFailed = true; await act(() => router.navigate('/exceptions?locationId=8'));
  panel = await screen.findByRole('region', { name: 'Review filters' });
  expect(await within(panel).findByRole('alert')).toHaveTextContent('This page could not load');
  expect(within(panel).getByRole('button', { name: 'Area: All areas' })).toBeDisabled();
  areaFailed = false; fireEvent.click(within(panel).getByRole('button', { name: 'Retry' }));
  await waitFor(() => expect(within(panel).getByRole('button', { name: 'Area: All areas' })).toBeEnabled());
});
it.each([['Waiting for staff', 'staff'], ['Checks pending', 'service']])('keeps the extra queue %s reachable', async (label, value) => {
  const { router } = mount(); await loaded(); const panel = filters(); await choose('Review queue', label, within(panel) as typeof screen);
  expect(params(router).get('queue')).toBe(value); expect(screen.getByRole('tab', { name: new RegExp(`^${label}`) })).toHaveAttribute('aria-selected', 'true');
});
it('keeps server pagination and page size in the URL', async () => {
  const { router } = mount('/exceptions?q=sink'); await loaded();
  fireEvent.click(screen.getByRole('button', { name: 'Next' })); expect(params(router).get('page')).toBe('2'); expect(params(router).get('q')).toBe('sink');
  await screen.findByRole('combobox', { name: 'Per page' });
  fireEvent.change(screen.getByRole('combobox', { name: 'Per page' }), { target: { value: '50' } }); expect(params(router).get('pageSize')).toBe('50'); expect(params(router).has('page')).toBe(false);
});
it('navigates a row with encoded filters and restores scope from returnTo on the detail route', async () => {
  const { router } = mount('/exceptions?locationId=8&areaId=7&queue=needs-me&period=date&date=2026-11-09&q=sink&page=2&pageSize=50&reasonCode=SERVICE_FAILURE');
  await loaded(); const link = within(queue()).getAllByRole('link')[1]; const href = link.getAttribute('href')!;
  const destination = new URL(href, 'http://local.invalid'); const back = destination.searchParams.get('returnTo')!;
  expect(Object.fromEntries(new URLSearchParams(back.split('?')[1]))).toEqual(Object.fromEntries(params(router)));
  fireEvent.click(link); await screen.findByRole('heading', { name: 'Case 4' });
  expect(router.state.location.pathname).toBe('/exceptions/4'); expect(within(queue()).getAllByRole('link')[1]).toHaveAttribute('aria-current', 'true');
  expect(router.state.location.state).toMatchObject({ focusId: 4, scrollY: 0, returnTo: back });
  expect(screen.getByRole('link', { name: 'Back to queue' })).toHaveAttribute('href', back);
});
it('keeps an explicitly selected case when it is not on the queue page', async () => {
  mount('/exceptions/99?returnTo=%2Fexceptions%3Fqueue%3Dresolved%26page%3D3'); await loaded();
  expect(screen.getByRole('heading', { name: 'Case 99' })).toBeInTheDocument();
  expect(screen.getByRole('tab', { name: 'Reviewed 7' })).toHaveAttribute('aria-selected', 'true');
});
it('offers See reviewed on the empty pending queue and keeps Select a review', async () => {
  rows = []; const { router } = mount();
  expect(await screen.findByRole('heading', { name: 'Nothing is waiting for you' })).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: 'Select a review' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'See reviewed' })); expect(params(router).get('queue')).toBe('resolved');
  expect(await screen.findByRole('heading', { name: 'No reviews yet' })).toBeInTheDocument(); expect(screen.queryByRole('button', { name: 'See reviewed' })).not.toBeInTheDocument();
});
it('offers clearing a no-match search without calling filtered work all handled', async () => {
  rows = []; const { router } = mount('/exceptions?q=missing');
  expect(await screen.findByRole('heading', { name: 'No matching reviews' })).toBeInTheDocument();
  expect(screen.queryByText('Every photo review has a decision. New ones appear here automatically.')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Clear filters' })); expect(params(router).has('q')).toBe(false);
});
it('shows initial skeletons, then recovers through Retry without fabricated records', async () => {
  failed = true; const { query } = mount(); const alert = await within(queue()).findByRole('alert'); expect(alert).toHaveTextContent('Your saved records have not changed.');
  expect(within(queue()).queryByRole('link')).not.toBeInTheDocument(); failed = false; pending = true;
  fireEvent.click(within(alert).getByRole('button', { name: 'Retry' }));
  await waitFor(() => expect(within(queue()).getByRole('status')).toHaveAttribute('aria-busy', 'true'));
  pending = false; await act(async () => { await query.cancelQueries(); await query.invalidateQueries({ queryKey: ['review-page'] }); }); await loaded();
});
it('keeps the mounted case and its draft during background reads and queue failures', async () => {
  const { query } = mount(); await loaded(); const draft = screen.getByRole('textbox', { name: 'Synthetic case draft' }); fireEvent.change(draft, { target: { value: 'Retained case note' } }); draft.focus();
  await act(async () => { await query.invalidateQueries({ queryKey: ['review-page'] }); }); expect(draft).toHaveFocus();
  failed = true; await act(async () => { await query.invalidateQueries({ queryKey: ['review-page'] }); });
  expect(draft).toHaveValue('Retained case note'); expect(draft).toHaveFocus(); await waitFor(() => expect(within(queue()).queryByRole('link')).not.toBeInTheDocument());
  expect(screen.queryByRole('tab', { name: 'Pending 12' })).not.toBeInTheDocument();
});
it.each(['RESOLVED', 'WAITING_SERVICE', 'STAFF_ACTION_REQUIRED'])('preserves the legacy state=%s queue deep link', async state => {
  mount(`/exceptions?state=${state}`); await loaded();
  expect(api.get).toHaveBeenCalledWith('/verification-exceptions', expect.objectContaining({ params: expect.objectContaining({ queue: { RESOLVED: 'resolved', WAITING_SERVICE: 'service', STAFF_ACTION_REQUIRED: 'staff' }[state] }) }));
});
it('localizes Urdu queue vocabulary, keeps record names unchanged and never fetches protected photos', async () => {
  mount('/exceptions?locationId=8', 'ur');
  await screen.findByRole('heading', { name: 'Synthetic room 3' }); expect(document.documentElement.dir).toBe('rtl');
  expect(screen.getByRole('tab', { name: `${translate('pending', 'ur')} 12` })).toBeInTheDocument();
  expect(screen.getByRole('tab', { name: `${translate('reviewed', 'ur')} 7` })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: `${translate('Location', 'ur')}: Synthetic site` })).toBeInTheDocument();
  expect(api.get.mock.calls.some(([url]) => url.includes('/evidence/') || url.includes('/content'))).toBe(false);
});
it.each(['0', 'NaN', '-2', '1.5'])('rejects invalid case id %s', id => {
  mount(`/exceptions/${id}`); expect(screen.getByRole('alert')).toHaveTextContent('Review unavailable.'); expect(screen.queryByRole('region', { name: 'Synthetic case' })).not.toBeInTheDocument();
});
