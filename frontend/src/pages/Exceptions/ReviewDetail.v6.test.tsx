import { configureStore } from '@reduxjs/toolkit';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { Provider } from 'react-redux';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import authReducer, { setUser } from '@/store/slices/authSlice';
import { LanguageProvider } from '@/i18n/LanguageProvider';
import { translate } from '@/i18n/translations';
import ReviewDetail from './ReviewDetail';
import type { ExceptionDetail } from './types';
import type { EvidenceAttempt } from '../Verification/types';

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock('@/api/client', () => ({ client: api }));
const receivedAt = '2026-11-11T04:00:00Z';
function attempt(id: string, state = 'REVIEW_REQUIRED', privacyState = 'SAFE'): EvidenceAttempt {
  return { id, state, privacyState, mediaAssetId: `asset-${id}`, receivedAt, createdAt: receivedAt,
    reviewSummary: { reasonCode: state === 'CLEANING_REQUIRED' ? 'CLEANING_REQUIRED' : 'AUTO_PASS_NOT_VALIDATED', cleanliness: state === 'CLEANING_REQUIRED' ? 'DIRTY' : 'CLEAN', dirtySurfaces: ['basin'], missingSurfaces: [] } };
}
function fixture(): ExceptionDetail {
  const photo = attempt('sink', 'CLEANING_REQUIRED');
  return { id: 3, kind: 'TASK', state: 'MANAGER_REVIEW', rowVersion: 2, priority: 1, locationId: 8,
    location: { id: 8, name: 'Synthetic site', timezone: 'Asia/Karachi' }, area: { id: 7, name: 'Synthetic washroom' },
    firstRaisedAt: receivedAt, updatedAt: receivedAt, serverTime: '2026-11-11T05:10:00Z',
    task: { id: 2, title: 'Synthetic task', status: 'IN_PROGRESS', verificationState: 'NEEDS_REVIEW', completionOutcome: null, shiftEnd: '2026-11-11T05:00:00Z', staffSubmittedAt: null, staff: { id: 4, name: 'Synthetic worker' } },
    items: [{ id: 1, nameSnapshot: 'Synthetic sink', sourceAreaItemId: 1, requirements: [
      { id: 'sink', viewKey: 'BASIN_TAP', state: 'CLEANING_REQUIRED', mandatory: true, decisionVersion: 2, instructionsSnapshot: 'Keep the whole basin visible', currentAttempt: photo, currentAttemptId: photo.id },
      { id: 'floor', viewKey: 'WIDE_ZONE', state: 'MISSING', mandatory: true, decisionVersion: 2, instructionsSnapshot: 'Show the entire floor', currentAttempt: null, currentAttemptId: null },
      { id: 'mirror', viewKey: 'REFLECTIVE_SURFACE', state: 'PASSED', mandatory: true, decisionVersion: 2, instructionsSnapshot: 'Show the mirror', currentAttempt: attempt('mirror', 'PASSED') },
    ] }],
    issues: [{ id: 41, requirementId: 'floor', reasonCode: 'MISSING_EVIDENCE', state: 'OPEN', occurrences: 1, recommendedAction: 'REVIEW', firstSeenAt: receivedAt, lastSeenAt: receivedAt }],
    allowedActions: [], closureActions: ['RESOLVE_REVIEW', 'RECORD_PERFORMANCE_ISSUE'], performanceStaffOptions: [{ id: 4, name: 'Synthetic worker' }], decisions: [], events: [],
    captureStatus: { available: false, canExtend: false, deadline: '2026-11-11T05:00:00Z', reason: 'DEADLINE_PASSED' },
  };
}
let detail: ExceptionDetail;
let nextId: number | null;
const caches: QueryClient[] = [];
function mount(entry = '/exceptions/3', language = 'en') {
  localStorage.setItem('hygene-ops.language', language);
  const store = configureStore({ reducer: { auth: authReducer } });
  store.dispatch(setUser({ id: 1, companyId: 42, role: 'MANAGER', name: 'Synthetic reviewer', email: 'fixture@example.invalid' }));
  const cache = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } } });
  caches.push(cache);
  const router = createMemoryRouter([{ path: '/exceptions/:id', element: <ReviewDetail id={3} backTo="/exceptions" returnState={{ scrollY: 80, focusId: 3 }} /> }, { path: '/exceptions', element: <p>Returned to queue</p> }], { initialEntries: [entry] });
  const view = render(<Provider store={store}><QueryClientProvider client={cache}><LanguageProvider><div className="workspace"><RouterProvider router={router} /></div></LanguageProvider></QueryClientProvider></Provider>);
  return { ...view, cache, router };
}
async function loaded() { return screen.findByRole('region', { name: 'Required photo views' }); }
beforeEach(() => {
  vi.clearAllMocks(); localStorage.clear(); detail = fixture(); nextId = null;
  vi.stubGlobal('IntersectionObserver', class {
    callback: (entries: { isIntersecting: boolean }[]) => void;
    constructor(callback: (entries: { isIntersecting: boolean }[]) => void) { this.callback = callback; }
    observe() { this.callback([{ isIntersecting: true }]); }
    disconnect() {}
  });
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:synthetic-protected-photo');
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  api.get.mockImplementation(async (url: string) => url.startsWith('/evidence/') ? { data: new Blob(['synthetic']) }
    : { data: { data: url.endsWith('/next') ? { nextId } : structuredClone(detail) } });
  api.post.mockResolvedValue({ data: { data: {} } });
});
afterEach(() => { caches.splice(0).forEach(cache => cache.clear()); vi.unstubAllGlobals(); });

it('leads with grouped findings before evidence and decisions, naming the missing fixture and view', async () => {
  mount(); const evidence = await loaded(); const summary = screen.getByRole('region', { name: 'Review summary' });
  expect(summary).toHaveTextContent('What went wrong'); expect(summary).toHaveTextContent('Missing photos'); expect(summary).toHaveTextContent('Synthetic sink · Whole floor zone');
  expect(summary).toHaveTextContent('The photo check flagged the basin as needing cleaning.');
  expect(summary).toHaveTextContent('1 of 3 required photos satisfied'); expect(summary).toHaveTextContent('Photo deadline passed'); expect(summary).toHaveTextContent('Asia/Karachi'); expect(summary).toHaveTextContent('What to do next');
  expect(summary.compareDocumentPosition(evidence) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(evidence.compareDocumentPosition(screen.getByRole('textbox', { name: 'Resolution note' })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
});
it('renders every required view with its name, status and a distinct missing photo', async () => {
  mount(); const evidence = await loaded(); expect(within(evidence).getAllByRole('article')).toHaveLength(3);
  expect(within(evidence).getByRole('article', { name: 'Synthetic sink · Whole floor zone' })).toHaveTextContent('Photo missing');
  expect(within(evidence).getByRole('article', { name: 'Synthetic sink · Reflective surface' })).toHaveTextContent('Photo requirement satisfied');
  expect(within(evidence).getByText('This required photo is missing')).toBeInTheDocument();
});
it('focuses the exact view for issueId and preserves unrelated scope', async () => {
  const { router } = mount('/exceptions/3?issueId=41&locationId=8'); await loaded();
  const row = screen.getByRole('article', { name: 'Synthetic sink · Whole floor zone' });
  expect(row).toHaveFocus(); expect(row).toHaveAttribute('aria-current', 'true'); expect(router.state.location.search).toContain('locationId=8');
  expect(screen.getByRole('region', { name: 'Review photo' })).toHaveTextContent('Show the entire floor');
});
it('focuses requirementId from a bookmark and inspection links while preserving the note', async () => {
  const { router } = mount('/exceptions/3?requirementId=floor&issueId=41&date=today'); await loaded();
  const note = screen.getByRole('textbox', { name: 'Resolution note' }); fireEvent.change(note, { target: { value: 'Keep this note' } });
  fireEvent.click(within(screen.getByRole('region', { name: 'Review summary' })).getByRole('button', { name: 'Inspect Synthetic sink: Basin, drain and tap' }));
  await waitFor(() => expect(screen.getByRole('article', { name: 'Synthetic sink · Basin, drain and tap' })).toHaveFocus());
  expect(router.state.location.search).toContain('requirementId=sink'); expect(router.state.location.search).not.toContain('issueId='); expect(router.state.location.search).toContain('date=today'); expect(note).toHaveValue('Keep this note');
});
it('supports generic issue focus without inventing a required view', async () => {
  detail.issues = [41, 42].map(id => ({ id, reasonCode: id === 41 ? 'SERVICE_FAILURE' : 'GPS_UNCERTAIN', state: 'OPEN', occurrences: 1, recommendedAction: 'REVIEW', firstSeenAt: receivedAt, lastSeenAt: receivedAt }));
  mount('/exceptions/3?issueId=42'); await loaded();
  expect(within(screen.getByRole('group', { name: 'Issues in this review' })).getByRole('button', { pressed: true })).toHaveFocus();
});
it('blocks decisions for setup records, retaining the real setup link and Check again', async () => {
  detail.kind = 'SETUP'; delete detail.task; detail.items = []; mount();
  await screen.findByRole('heading', { name: 'Room inventory needs setup' });
  expect(screen.getByRole('link', { name: 'Review room setup' })).toHaveAttribute('href', '/locations/8?tab=templates');
  expect(screen.getByText('No task generated')).toBeInTheDocument(); expect(screen.queryByRole('textbox')).not.toBeInTheDocument(); expect(screen.queryByRole('button', { name: 'Resolve review' })).not.toBeInTheDocument();
  const calls = api.get.mock.calls.length; fireEvent.click(screen.getByRole('button', { name: 'Check again' })); await waitFor(() => expect(api.get.mock.calls.length).toBeGreaterThan(calls));
});
it.each(['PENDING', 'PROCESSING', undefined])('does not fetch or display privacy-pending photo (%s)', async privacy => {
  const row = detail.items![0].requirements[0]; row.currentAttempt = attempt('pending', 'PROCESSING', 'PENDING'); row.currentAttempt.privacyState = privacy;
  mount('/exceptions/3?requirementId=sink'); await loaded();
  expect(screen.getByRole('region', { name: 'Review photo' })).toHaveTextContent('Privacy check pending. Photo is not available for routine review yet.');
  expect(api.get.mock.calls.some(([url]) => url === '/evidence/asset-pending/content')).toBe(false);
  expect(within(screen.getByRole('article', { name: 'Synthetic sink · Basin, drain and tap' })).queryByRole('img')).not.toBeInTheDocument();
});
it('keeps authorized held photos behind ProtectedEvidence without enabling acceptance', async () => {
  detail.items![0].requirements[0].currentAttempt = attempt('held', 'PRIVACY_HOLD', 'HOLD');
  mount('/exceptions/3?requirementId=sink'); await loaded();
  await waitFor(() => expect(api.get).toHaveBeenCalledWith('/evidence/asset-held/content', expect.objectContaining({ responseType: 'blob', params: { variant: 'review' } })));
  expect(screen.getByRole('region', { name: 'Review photo' })).toHaveTextContent('Privacy flag recorded'); expect(screen.queryByRole('button', { name: 'Accept evidence' })).not.toBeInTheDocument();
});
it('distinguishes discarded evidence from missing and unavailable photos', async () => {
  detail.items![0].requirements[0].currentAttempt = { ...attempt('discarded'), mediaAssetId: null, privacyState: 'DISCARDED' };
  mount('/exceptions/3?requirementId=sink'); await loaded(); expect(screen.getByRole('region', { name: 'Review photo' })).toHaveTextContent('Rejected photo was not kept');
  expect(screen.getByRole('region', { name: 'Required photo views' })).toHaveTextContent('This required photo is missing');
});
it('does not display stale issue evidence in place of a missing current replacement', async () => {
  detail.attempts = [{ ...attempt('earlier'), requirementId: 'floor' }]; detail.issues[0].latestAttempt = attempt('stale');
  mount('/exceptions/3?issueId=41'); await loaded(); expect(screen.getByRole('region', { name: 'Review photo' })).toHaveTextContent('Replacement photo missing'); expect(api.get.mock.calls.some(([url]) => url.includes('asset-stale'))).toBe(false);
});
it('keeps clean results awaiting manager review separate from dirty findings', async () => {
  const row = detail.items![0].requirements[0]; row.state = 'REVIEW_REQUIRED'; row.currentAttempt = attempt('clean');
  mount('/exceptions/3?requirementId=sink'); await loaded();
  expect(screen.getByRole('region', { name: 'Review photo' })).toHaveTextContent('automatic approval is not enabled'); expect(screen.queryByText('More cleaning is needed')).not.toBeInTheDocument();
});
it('treats checking failures as checking failures even with a stale cleaning state', async () => {
  const row = detail.items![0].requirements[0]; row.currentAttempt = attempt('failure', 'SERVICE_FAILURE'); row.currentAttempt.reviewSummary!.reasonCode = 'SERVICE_FAILURE';
  mount('/exceptions/3?requirementId=sink'); await loaded(); expect(screen.getByRole('region', { name: 'Review photo' })).toHaveTextContent('not a finding that the fixture is dirty');
});
it('opens optional example and room-context evidence only when the disclosure is opened', async () => {
  detail.standards = [{ id: 1, caption: 'Synthetic guidance', areaItemId: 1, mediaAssetId: 'example' }];
  detail.attempts = [{ ...attempt('context'), contextKey: 'ROOM_OVERVIEW' }, { ...attempt('context-pending', 'PROCESSING', 'PENDING'), contextKey: 'ROOM_OVERVIEW' }];
  mount('/exceptions/3?requirementId=sink'); await loaded();
  expect(api.get.mock.calls.some(([url]) => url.includes('/example/') || url.includes('asset-context'))).toBe(false);
  const examples = screen.getByText('Example guidance').closest('details')!; examples.open = true; fireEvent(examples, new Event('toggle'));
  await waitFor(() => expect(api.get.mock.calls.some(([url]) => url === '/evidence/example/content')).toBe(true));
  const context = screen.getByText('Room context photos').closest('details')!; context.open = true; fireEvent(context, new Event('toggle'));
  await waitFor(() => expect(api.get.mock.calls.some(([url]) => url === '/evidence/asset-context/content')).toBe(true));
  expect(api.get.mock.calls.some(([url]) => url === '/evidence/asset-context-pending/content')).toBe(false);
});
it('keeps submission, closure and evidence verification as independent facts', async () => {
  detail.state = 'RESOLVED'; detail.task!.staffSubmittedAt = receivedAt; detail.task!.completionOutcome = 'COMPLETED_WITH_EXCEPTIONS';
  detail.decisions = [{ id: 1, action: 'RESOLVE_REVIEW', reasonCode: 'MANAGER_RESOLVED', note: 'Synthetic saved note', createdAt: receivedAt, actorManager: { name: 'Synthetic reviewer' } }];
  mount(); await loaded(); const facts = screen.getByRole('region', { name: 'Task and evidence status' });
  expect(facts).toHaveTextContent('3 current views'); expect(facts).toHaveTextContent('Review decision recorded'); expect(facts).toHaveTextContent('Completed with exceptions; evidence not fully verified'); expect(screen.queryByText('Verified completion recorded')).not.toBeInTheDocument();
  expect(screen.getByRole('region', { name: 'Review summary' })).toHaveTextContent('Review result');
});
it('does not infer submission or verification from a closed review', async () => {
  detail.state = 'RESOLVED'; mount(); await loaded(); const facts = screen.getByRole('region', { name: 'Task and evidence status' });
  expect(facts).toHaveTextContent('No task submission recorded'); expect(facts).toHaveTextContent('Review closed; decision details unavailable'); expect(facts).toHaveTextContent('Verified completion not recorded');
});
it('keeps optional views visible without adding them to required progress', async () => {
  detail.items![0].requirements[1].mandatory = false; mount(); const evidence = await loaded();
  expect(within(evidence).getByRole('article', { name: 'Synthetic sink · Whole floor zone' })).toHaveTextContent('Optional'); expect(screen.getByRole('region', { name: 'Review summary' })).toHaveTextContent('1 of 2 required photos satisfied');
});
it('loads protected evidence through the authenticated blob endpoint and retries a failed load', async () => {
  let fail = true; const get = api.get.getMockImplementation()!;
  api.get.mockImplementation(async (url: string, options: unknown) => { if (url === '/evidence/asset-sink/content' && fail) throw { response: { status: 503 } }; return get(url, options); });
  mount('/exceptions/3?requirementId=sink'); await loaded(); const panel = screen.getByRole('region', { name: 'Review photo' }); await within(panel).findByRole('alert');
  fail = false; fireEvent.click(within(panel).getByRole('button', { name: 'Retry' }));
  expect(await within(panel).findByRole('img')).toHaveAttribute('src', 'blob:synthetic-protected-photo');
});
it('retains an offline decision draft and disables save until reconnected', async () => {
  mount(); await loaded(); const note = screen.getByRole('textbox', { name: 'Resolution note' }); fireEvent.change(note, { target: { value: 'Synthetic offline note' } });
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false); fireEvent(window, new Event('offline'));
  expect(note).toHaveValue('Synthetic offline note'); expect(screen.getByRole('button', { name: 'Confirm resolution' })).toBeDisabled(); expect(screen.getByText(/Internet needed to save a decision/)).toBeInTheDocument();
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true); fireEvent(window, new Event('online')); expect(screen.getByRole('button', { name: 'Confirm resolution' })).toBeEnabled();
});
it('retains data, note and focus after a background failure and offers Retry', async () => {
  const view = mount(); await loaded(); const note = screen.getByRole('textbox', { name: 'Resolution note' }); fireEvent.change(note, { target: { value: 'Synthetic cached note' } }); note.focus();
  const get = api.get.getMockImplementation()!; api.get.mockImplementation(async (url: string, options: unknown) => { if (url === '/verification-exceptions/3') throw Error('Synthetic failure'); return get(url, options); });
  await act(async () => { await view.cache.invalidateQueries({ queryKey: ['exception'] }); });
  await waitFor(() => expect(screen.getByRole('button', { name: 'Confirm resolution' })).toBeDisabled()); expect(note).toHaveValue('Synthetic cached note'); expect(note).toHaveFocus(); expect(screen.getByText('This page could not load')).toBeInTheDocument();
  api.get.mockImplementation(get); fireEvent.click(screen.getByRole('button', { name: 'Retry' })); await waitFor(() => expect(screen.getByRole('button', { name: 'Confirm resolution' })).toBeEnabled());
});
it('announces initial loading without invented findings or decision controls', () => {
  api.get.mockImplementation(() => new Promise(() => {})); mount(); expect(screen.getByRole('status')).toHaveAttribute('aria-busy', 'true'); expect(screen.queryByText('What went wrong')).not.toBeInTheDocument(); expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
});
it('offers Retry for initial failure and recovers real detail', async () => {
  api.get.mockRejectedValueOnce(Error('Synthetic unavailable')); mount(); await screen.findByRole('alert'); expect(screen.queryByText('What went wrong')).not.toBeInTheDocument(); fireEvent.click(screen.getByRole('button', { name: 'Retry' })); await loaded();
});
it.each([401, 403, 404, 410])('removes cached private detail when access becomes unavailable (%s)', async status => {
  const view = mount(); await loaded(); api.get.mockRejectedValue({ response: { status } }); await act(async () => { await view.cache.invalidateQueries({ queryKey: ['exception'] }); });
  await waitFor(() => expect(screen.queryByRole('region', { name: 'Required photo views' })).not.toBeInTheDocument()); expect(screen.queryByRole('textbox')).not.toBeInTheDocument(); expect(screen.getByRole('alert')).toBeInTheDocument();
});
it('retains encoded returnTo and navigation state for Back and Next', async () => {
  nextId = 9; const returnTo = '/exceptions?queue=needs-me&locationId=8&page=3'; mount('/exceptions/3?returnTo=' + encodeURIComponent(returnTo)); await loaded();
  expect(screen.getByRole('link', { name: 'Back to reviews' })).toHaveAttribute('href', returnTo); expect(await screen.findByRole('link', { name: 'Next review' })).toHaveAttribute('href', '/exceptions/9?returnTo=' + encodeURIComponent(returnTo));
});
it('rejects an external return destination while keeping queue navigation', async () => {
  mount('/exceptions/3?returnTo=' + encodeURIComponent('https://example.invalid')); await loaded(); expect(screen.getByRole('link', { name: 'Back to reviews' })).toHaveAttribute('href', '/exceptions');
});
it('renders an empty evidence list without inventing views or verified completion', async () => {
  detail.items = []; detail.issues = []; mount(); const evidence = await loaded(); expect(within(evidence).queryByRole('article')).not.toBeInTheDocument(); expect(evidence).toHaveTextContent('The review summary above lists the affected fixtures and missing photos.'); expect(screen.getByText('Verified completion not recorded')).toBeInTheDocument();
});
it('uses Urdu direction and translated findings while preserving record names and instructions', async () => {
  mount('/exceptions/3?requirementId=sink', 'ur'); await screen.findByRole('region', { name: translate('Required photo views', 'ur') });
  expect(document.documentElement.dir).toBe('rtl'); expect(screen.getByText(translate('What went wrong', 'ur'))).toBeInTheDocument(); expect(screen.getByText('Keep the whole basin visible')).toBeInTheDocument(); expect(screen.getByRole('heading', { name: 'Synthetic washroom' })).toBeInTheDocument();
});

it.each(['OPEN', 'RESOLVED'])('focuses a single non-requirement issue bookmark (%s)', async state => {
  detail.issues = [{ id: 42, reasonCode: 'GPS_UNCERTAIN', state, occurrences: 1, recommendedAction: 'REVIEW', firstSeenAt: receivedAt, lastSeenAt: receivedAt }];
  if (state === 'RESOLVED') detail.state = 'RESOLVED';
  mount('/exceptions/3?issueId=42'); await loaded();
  expect(within(screen.getByRole('group', { name: 'Issues in this review' })).getByRole('button', { pressed: true })).toHaveFocus();
});
