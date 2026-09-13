import { configureStore } from '@reduxjs/toolkit';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { Provider } from 'react-redux';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import authReducer, { setUser } from '@/store/slices/authSlice';
import { LanguageProvider } from '@/i18n/LanguageProvider';
import VerificationHistoryPage from './VerificationHistoryPage';
import ProtectedEvidence from './ProtectedEvidence';
import type { VerificationManifest } from './types';
import { localTime } from '../Manager/operations';
import { readFileSync } from 'node:fs';
const css = readFileSync('src/pages/Verification/task-photos-v6.css', 'utf8');

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock('@/api/client', () => ({ client: api }));
const at = '2026-11-11T04:00:00Z';
type ReviewRecord = VerificationManifest['exceptions'][number];
const photo = (id: string, privacyState = 'SAFE') => ({ id, state: 'PASSED', privacyState, mediaAssetId: `asset-${id}`, createdAt: at, receivedAt: at });
function manifest(sinkPrivacy = 'SAFE', submitted: string | null = at, caseSummary?: ReviewRecord) {
  return {
    task: { id: 5, title: 'Synthetic task', status: 'COMPLETED', verificationVersion: 2, verificationState: 'VERIFIED', completionOutcome: 'VERIFIED_COMPLETE' as VerificationManifest['task']['completionOutcome'], staffSubmittedAt: submitted, shiftEnd: at, location: { id: 8, name: 'Synthetic site', timezone: 'Asia/Karachi' } },
    caseSummary,
    areaId: 7, areaName: 'Synthetic washroom', progress: { passed: 1, total: 2, pending: 0, failed: 0 },
    items: [{ id: 1, name: 'Synthetic sink', itemCodeSnapshot: 'S', typeSnapshot: 'SINK', mandatory: true, state: 'PASSED', requirements: [
      { id: 'sink', viewKey: 'BASIN_TAP', instructions: 'Show the whole basin', mandatory: true, state: 'PASSED', decisionVersion: 1, currentAttempt: photo('sink', sinkPrivacy) },
      { id: 'floor', viewKey: 'WIDE_ZONE', instructions: 'Show the floor', mandatory: true, state: 'MISSING', decisionVersion: 1, currentAttempt: null },
      { id: 'mirror', viewKey: 'REFLECTIVE_SURFACE', instructions: 'Show the mirror', mandatory: false, state: 'MISSING', decisionVersion: 1, currentAttempt: null },
    ] }],
  };
}
let data: ReturnType<typeof manifest>;
const taskRecord = (verificationVersion = 2, verificationException: ReviewRecord | null = null) => ({ id: 5, title: 'Synthetic task', verificationVersion, staff: { name: 'Synthetic worker' }, verificationException });
let taskData: ReturnType<typeof taskRecord>;
const historyAttempt = () => ({ ...photo('history'), staff: { id: 4, name: 'Synthetic history worker' }, requirement: { viewKey: 'BASIN_TAP', item: { nameSnapshot: 'Synthetic history fixture' } } });
async function respond(url: string) {
  if (url.startsWith('/evidence/')) return { data: new Blob(['synthetic']) };
  if (url.endsWith('/verification/history')) return { data: { data: { attempts: [historyAttempt()], nextCursor: null } } };
  if (url.endsWith('/verification')) return { data: { data: structuredClone(data) } };
  if (url.endsWith('/area-submissions')) return { data: { data: [{ id: 1, referenceImageId: 7, photoUrl: 'blob:legacy-photo', referenceImage: { name: 'Synthetic legacy area', imageUrl: null }, staff: { name: 'Synthetic legacy worker' }, attempts: [] }] } };
  return { data: { data: structuredClone(taskData) } };
}
const readPaths = { task: '/task-instance/5', manifest: '/task-instance/5/verification' };
const readKeys = { task: ['verification-task', '42:MANAGER:1', 5], manifest: ['verification', '42:MANAGER:1', 5] };
const httpError = (status: number) => Object.assign(new Error('synthetic read failure'), { response: { status } });
async function openHistory() {
  fireEvent.click(screen.getByText('Previous photos and upload history'));
  await screen.findByText('Synthetic history fixture');
  await waitFor(() => expect(screen.getAllByRole('img')).toHaveLength(2));
}
function expectPrivateContentHidden() {
  expect(screen.queryByRole('list', { name: 'Task details', hidden: true })).not.toBeInTheDocument();
  for (const name of ['Selected photo', 'Required photo views', 'Task and evidence status']) {
    expect(screen.queryByRole('region', { name, hidden: true })).not.toBeInTheDocument();
  }
  expect(screen.queryByText('Previous photos and upload history')).not.toBeInTheDocument();
  expect(screen.queryByRole('dialog', { hidden: true })).not.toBeInTheDocument();
  expect(screen.queryByRole('img', { hidden: true })).not.toBeInTheDocument();
  expect(screen.queryByText('You are viewing the last loaded information.')).not.toBeInTheDocument();
  for (const name of ['Synthetic task', 'Synthetic site', 'Synthetic washroom', 'Synthetic worker', 'Synthetic sink', 'Synthetic history fixture', 'Synthetic history worker', 'Synthetic legacy area', 'Synthetic legacy worker']) {
    expect(document.body).not.toHaveTextContent(name);
  }
}
const caches: QueryClient[] = [];
function mount(entry: string, retryOptions: { retry: number; retryDelay: number } | undefined = undefined) {
  localStorage.setItem('hygene-ops.language', 'en');
  const store = configureStore({ reducer: { auth: authReducer } });
  store.dispatch(setUser({ id: 1, companyId: 42, role: 'MANAGER', name: 'Synthetic reviewer', email: 'fixture@example.invalid' }));
  const cache = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0, ...retryOptions } } });
  caches.push(cache);
  const router = createMemoryRouter([
    { path: '/verification/:id', element: <VerificationHistoryPage /> },
    { path: '/exceptions/:id', element: <h1>Review case</h1> },
    { path: '/staff/:id', element: <p>Staff profile</p> },
    { path: '/today-status', element: <p>Today page</p> },
  ], { initialEntries: [entry] });
  render(<Provider store={store}><QueryClientProvider client={cache}><LanguageProvider><div className="workspace"><RouterProvider router={router} /></div></LanguageProvider></QueryClientProvider></Provider>);
  return router;
}
beforeEach(() => {
  vi.clearAllMocks(); localStorage.clear(); data = manifest(); taskData = taskRecord();
  vi.stubGlobal('IntersectionObserver', class {
    callback: (entries: { isIntersecting: boolean }[]) => void;
    constructor(callback: (entries: { isIntersecting: boolean }[]) => void) { this.callback = callback; }
    observe() { this.callback([{ isIntersecting: true }]); }
    disconnect() {}
  });
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:synthetic-photo');
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  api.get.mockImplementation(respond);
});
afterEach(() => { caches.splice(0).forEach(c => c.clear()); vi.unstubAllGlobals(); });

it('shows received counts and the task status steps', async () => {
  mount('/verification/5');
  const views = await screen.findByRole('region', { name: 'Required photo views' });
  expect(views).toHaveTextContent('1 of 2 required photos received');
  expect(within(views).getByRole('button', { name: /Optional/ })).toBeInTheDocument();
  const status = screen.getByRole('region', { name: 'Task and evidence status' });
  expect(status).toHaveTextContent('Submitted'); expect(status).toHaveTextContent('Synthetic worker');
  expect(status).toHaveTextContent('The photos passed their checks.');
});

it('choosing a view writes view to the URL and changes the photo', async () => {
  const router = mount('/verification/5');
  expect(await screen.findByRole('img')).toHaveAttribute('alt', expect.stringContaining('Synthetic sink'));
  const views = screen.getByRole('region', { name: 'Required photo views' });
  const buttons = within(views).getAllByRole('button');
  expect(buttons[0]).toHaveAttribute('aria-pressed', 'true');
  fireEvent.click(buttons[1]);
  await waitFor(() => expect(router.state.location.search).toContain('view=floor'));
  expect(buttons[1]).toHaveAttribute('aria-pressed', 'true');
  expect(screen.queryByRole('img')).not.toBeInTheDocument();
  expect(screen.getByRole('region', { name: 'Selected photo' })).toHaveTextContent('No photo received for this view');
});

it('Back uses a safe returnTo and ignores an unsafe one', async () => {
  mount('/verification/5?returnTo=%2Fstaff%2F4');
  expect(await screen.findByRole('link', { name: 'Back' })).toHaveAttribute('href', '/staff/4');
  caches.splice(0).forEach(c => c.clear()); document.body.innerHTML = '';
  mount('/verification/5?returnTo=https%3A%2F%2Fevil.example');
  expect(await screen.findByRole('link', { name: 'Back' })).toHaveAttribute('href', '/today-status?tab=tasks&taskId=5');
});

it('does not display or fetch a photo whose privacy check is pending', async () => {
  data = manifest('PENDING');
  mount('/verification/5');
  await screen.findByRole('region', { name: 'Required photo views' });
  expect(await screen.findByText('Privacy check pending. Photo is not available for routine review yet.')).toBeInTheDocument();
  expect(screen.queryByRole('img')).not.toBeInTheDocument();
  expect(api.get.mock.calls.some(([url]) => String(url).startsWith('/evidence/'))).toBe(false);
});

it('shows the area, due time and assigned worker, also before submission', async () => {
  data = manifest('SAFE', null);
  mount('/verification/5');
  await screen.findByRole('region', { name: 'Required photo views' });
  const facts = screen.getByRole('list', { name: 'Task details' });
  expect(facts).toHaveTextContent('Synthetic washroom');
  expect(facts).toHaveTextContent(`Due${localTime(at, 'Asia/Karachi', 'en', true)}`);
  expect(facts).toHaveTextContent('Synthetic worker');
  expect(screen.getByRole('region', { name: 'Task and evidence status' })).toHaveTextContent('Not submitted');
});

it('a verified task with no review record does not show Review closed as done', async () => {
  mount('/verification/5');
  const status = await screen.findByRole('region', { name: 'Task and evidence status' });
  const steps = within(status).getAllByRole('listitem');
  expect(steps[1]).toHaveAttribute('data-done', 'true');
  expect(steps[2]).toHaveAttribute('data-done', 'false');
  expect(steps[2]).toHaveAttribute('data-state', 'none');
  expect(steps[2]).toHaveTextContent('No open reviews');
  expect(status).not.toHaveTextContent('Review closed');
});

for (const source of ['task', 'manifest'] as const) {
  it.each(['OPEN', 'RESOLVED'])('redirects to the authorized ' + source + ' case when its review is %s', async state => {
    // The authorized case identifiers deliberately differ from the task id.
    const review = { id: source === 'task' ? 701 : 902, state };
    if (source === 'task') taskData = taskRecord(2, review);
    else data = manifest('SAFE', at, review);
    const router = mount('/verification/5?view=sink&returnTo=%2Fstaff%2F4%3Ftab%3Dtasks');

    expect(await screen.findByRole('heading', { name: 'Review case' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe(`/exceptions/${review.id}`);
    expect(new URLSearchParams(router.state.location.search).get('returnTo')).toBe('/staff/4?tab=tasks');
    expect(router.state.historyAction).toBe('REPLACE');
    expect(screen.queryByRole('region', { name: 'Task and evidence status' })).not.toBeInTheDocument();
    expect(api.get.mock.calls.some(([url]) => url === readPaths.manifest)).toBe(source === 'manifest');
  });
}

const reviewStates = [
  { state: 'none', record: undefined, label: 'No open reviews', description: 'No manager review is open for this task.' },
  { state: 'open', record: { id: 902, state: 'OPEN' }, label: 'Manager review needed', description: 'A photo needs your review' },
  { state: 'closed', record: { id: 902, state: 'RESOLVED' }, label: 'Review closed', description: 'Review closure records a manager decision. Required photos, staff submission and verified completion stay separate.' },
] as const;

for (const review of reviewStates) {
  for (const submitted of [false, true]) {
    it.each([false, true])(`keeps review ${review.state} independent with submitted=${submitted}, verified=%s during a transient fallback, then recovers`, async verified => {
      const entry = '/verification/5?view=sink&returnTo=%2Fstaff%2F4';
      const router = mount(entry);
      const image = await screen.findByRole('img');
      await openHistory();
      const history = screen.getByText('Previous photos and upload history').closest('details');
      const cache = caches.at(-1)!;
      data = manifest('SAFE', submitted ? at : null, review.record);
      data.task.status = submitted ? 'COMPLETED' : 'IN_PROGRESS';
      data.task.verificationState = verified ? 'VERIFIED' : 'NEEDS_REVIEW';
      data.task.completionOutcome = verified ? 'VERIFIED_COMPLETE' : null;

      // Complete the temporary task failure before delivering the manifest's
      // caseSummary. The real query error prevents Navigate, leaving the real
      // API adapter and cached PhotoWorkspace mounted for status assertions.
      let resolveManifest!: (response: Awaited<ReturnType<typeof respond>>) => void;
      const pendingManifest = new Promise<Awaited<ReturnType<typeof respond>>>(resolve => { resolveManifest = resolve; });
      api.get.mockImplementation((url: string) => url === readPaths.task ? Promise.reject(httpError(503))
        : url === readPaths.manifest ? pendingManifest : respond(url));
      const refresh = screen.getByRole('button', { name: 'Refresh' });
      refresh.focus(); fireEvent.click(refresh);
      await waitFor(() => expect(cache.getQueryState(readKeys.task)?.error).toMatchObject({ response: { status: 503 } }));
      await act(async () => { resolveManifest(await respond(readPaths.manifest)); });
      await waitFor(() => expect(cache.getQueryState(readKeys.manifest)?.fetchStatus).toBe('idle'));

      const status = screen.getByRole('region', { name: 'Task and evidence status' });
      const steps = within(status).getAllByRole('listitem');
      expect(steps).toHaveLength(3);
      expect(steps[0]).toHaveTextContent('Submitted');
      expect(steps[0]).toHaveAttribute('data-done', String(submitted));
      expect(steps[0]).toHaveTextContent(submitted ? 'Synthetic worker' : 'Not submitted');
      expect(steps[1]).toHaveTextContent('Verified');
      expect(steps[1]).toHaveAttribute('data-done', String(verified));
      expect(steps[1]).toHaveTextContent(verified ? 'The photos passed their checks.' : submitted ? 'Completed · Needs manager review' : 'Needs manager');
      expect(steps[2]).toHaveAttribute('data-state', review.state);
      expect(steps[2]).toHaveAttribute('data-done', String(review.state === 'closed'));
      expect(steps[2]).toHaveTextContent(review.label);
      expect(steps[2]).toHaveTextContent(review.description);
      for (const other of reviewStates.filter(other => other.state !== review.state)) {
        expect(within(steps[2]).queryByText(other.label)).not.toBeInTheDocument();
      }
      expect(cache.getQueryData<VerificationManifest>(readKeys.manifest)?.exceptions).toEqual(review.record ? [review.record] : []);
      expect(screen.getByRole('alert')).toHaveTextContent('You are viewing the last loaded information.');
      expect(within(screen.getByRole('region', { name: 'Selected photo' })).getByRole('img')).toBe(image);
      expect(history).toHaveAttribute('open');
      expect(screen.getByText('Synthetic history fixture')).toBeInTheDocument();
      expect(document.activeElement).toBe(refresh);
      expect(router.state.location.pathname + router.state.location.search).toBe(entry);

      api.get.mockImplementation(respond);
      fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
      if (review.record) {
        await screen.findByRole('heading', { name: 'Review case' });
        expect(router.state.location.pathname).toBe(`/exceptions/${review.record.id}`);
        expect(new URLSearchParams(router.state.location.search).get('returnTo')).toBe('/staff/4');
        expect(router.state.historyAction).toBe('REPLACE');
      } else {
        await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
        expect(router.state.location.pathname + router.state.location.search).toBe(entry);
        expect(steps[2]).toHaveAttribute('data-state', 'none');
        expect(steps[2]).toHaveAttribute('data-done', 'false');
        expect(image).toBeInTheDocument();
        expect(history).toHaveAttribute('open');
      }
    });
  }
}

it('a failed refresh keeps the loaded photo and history and offers Retry without moving focus', async () => {
  mount('/verification/5');
  await screen.findByRole('img');
  await openHistory();
  api.get.mockImplementation(async (url: string) => {
    if (url.startsWith('/evidence/')) return { data: new Blob(['synthetic']) };
    throw Object.assign(new Error('offline'), { response: { status: 503 } });
  });
  const refresh = screen.getByRole('button', { name: 'Refresh' });
  refresh.focus(); fireEvent.click(refresh);
  expect(await screen.findByText('You are viewing the last loaded information.')).toBeInTheDocument();
  const notice = screen.getByText('You are viewing the last loaded information.').parentElement!;
  expect(within(notice).getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  expect(screen.getByRole('region', { name: 'Selected photo' })).toBeInTheDocument();
  expect(within(screen.getByRole('region', { name: 'Selected photo' })).getByRole('img')).toBeInTheDocument();
  expect(screen.getByText('Previous photos and upload history')).toBeInTheDocument();
  expect(screen.getByText('Previous photos and upload history').closest('details')).toHaveAttribute('open');
  expect(screen.getByText('Synthetic history fixture')).toBeInTheDocument();
  expect(screen.getAllByRole('img')).toHaveLength(2);
  expect(document.activeElement).toBe(refresh);
});

for (const read of ['task', 'manifest'] as const) {
  it(`hides a ${read} denial immediately during an automatic retry, even if that retry then fails temporarily`, async () => {
    mount('/verification/5', { retry: 1, retryDelay: 0 });
    await screen.findByRole('img');
    let rejectRetry!: (error: Error) => void;
    const pendingRetry = new Promise<never>((_, reject) => { rejectRetry = reject; });
    let attempts = 0;
    api.get.mockImplementation((url: string) => url === readPaths[read]
      ? (++attempts === 1 ? Promise.reject(httpError(403)) : pendingRetry) : respond(url));
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    await screen.findByRole('heading', { name: 'This page could not load' });
    expectPrivateContentHidden();
    await waitFor(() => expect(attempts).toBe(2));
    await act(async () => { rejectRetry(httpError(503)); });
    await waitFor(() => expect(caches.at(-1)!.getQueryState(readKeys[read])?.error).toMatchObject({ response: { status: 503 } }));
    expectPrivateContentHidden();
  });

  it(`preserves the selected view, open history, bytes and Refresh focus through an offline ${read} failure and Retry`, async () => {
    data.items.push({ ...data.items[0], id: 2, name: 'Synthetic mirror', requirements: [{ ...data.items[0].requirements[0], id: 'mirror-photo', currentAttempt: photo('mirror-photo') }] });
    const router = mount('/verification/5?view=mirror-photo');
    await screen.findByRole('img');
    await openHistory();
    const selected = screen.getByRole('region', { name: 'Selected photo' });
    const image = within(selected).getByRole('img');
    const history = screen.getByText('Previous photos and upload history').closest('details');
    api.get.mockImplementation((url: string) => url === readPaths[read] ? Promise.reject(new Error('offline')) : respond(url));
    const refresh = screen.getByRole('button', { name: 'Refresh' });
    refresh.focus(); fireEvent.click(refresh);
    await screen.findByText('You are viewing the last loaded information.');
    expect(document.activeElement).toBe(refresh);
    expect(image).toBeInTheDocument();
    expect(image).toHaveAttribute('alt', expect.stringContaining('Synthetic mirror'));
    expect(history).toHaveAttribute('open');
    expect(screen.getByText('Synthetic history fixture')).toBeInTheDocument();
    expect(screen.getAllByRole('img')).toHaveLength(2);
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();

    api.get.mockImplementation(respond);
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(screen.queryByText('You are viewing the last loaded information.')).not.toBeInTheDocument());
    expect(image).toBeInTheDocument();
    expect(history).toHaveAttribute('open');
    expect(router.state.location.search).toBe('?view=mirror-photo');
    expect(document.activeElement).toBe(refresh);
    expect(URL.createObjectURL).toHaveBeenCalledTimes(2);
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();
  });

  it.each([401, 403, 404, 410])(`hides all cached content and open history when only the ${read} refresh returns %i`, async status => {
    mount('/verification/5?view=sink&returnTo=%2Fstaff%2F4');
    await screen.findByRole('img');
    await openHistory();
    const signals = api.get.mock.calls.filter(([url]) => String(url).startsWith('/evidence/')).map(([, config]) => config.signal as AbortSignal);
    api.get.mockImplementation((url: string) => url === readPaths[read] ? Promise.reject(httpError(status)) : respond(url));

    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    await screen.findByRole('heading', { name: 'This page could not load' });
    expectPrivateContentHidden();
    expect(caches.at(-1)!.getQueryState(readKeys[read === 'task' ? 'manifest' : 'task'])?.status).toBe('success');
    expect(signals).toHaveLength(2);
    expect(signals.every(signal => signal.aborted)).toBe(true);
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(2);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:synthetic-photo');
    if (status === 403) expect(screen.getByRole('alert')).toHaveTextContent('You do not have access to this location.');
    expect(screen.getByRole('link', { name: 'Back' })).toHaveAttribute('href', '/staff/4');
    fireEvent.click(screen.getByRole('link', { name: 'Back' }));
    expect(await screen.findByText('Staff profile')).toBeInTheDocument();
  });

  it(`closes an enlarged protected photo and releases its bytes after a terminal ${read} refresh`, async () => {
    mount('/verification/5');
    await screen.findByRole('img');
    const signal = api.get.mock.calls.find(([url]) => String(url).startsWith('/evidence/'))![1].signal as AbortSignal;
    fireEvent.click(screen.getAllByRole('button', { name: 'Enlarge photo' })[0]);
    const dialog = await screen.findByRole('dialog', { name: 'Review photo' });
    expect(within(dialog).getByRole('img')).toHaveAttribute('src', 'blob:synthetic-photo');
    api.get.mockImplementation((url: string) => url === readPaths[read] ? Promise.reject(httpError(403)) : respond(url));

    await act(async () => { await caches.at(-1)!.refetchQueries({ queryKey: readKeys[read], exact: true }); });
    await screen.findByRole('heading', { name: 'This page could not load' });
    expectPrivateContentHidden();
    expect(dialog).not.toBeInTheDocument();
    expect(signal.aborted).toBe(true);
    expect(URL.revokeObjectURL).toHaveBeenCalledExactlyOnceWith('blob:synthetic-photo');
  });

  it(`aborts an in-flight protected request on ${read} denial and ignores its late bytes`, async () => {
    let resolvePhoto!: (response: { data: Blob }) => void;
    const pendingPhoto = new Promise<{ data: Blob }>(resolve => { resolvePhoto = resolve; });
    api.get.mockImplementation((url: string) => url.startsWith('/evidence/') ? pendingPhoto : respond(url));
    mount('/verification/5');
    await waitFor(() => expect(api.get.mock.calls.some(([url]) => String(url).startsWith('/evidence/'))).toBe(true));
    const signal = api.get.mock.calls.find(([url]) => String(url).startsWith('/evidence/'))![1].signal as AbortSignal;
    api.get.mockImplementation((url: string) => url === readPaths[read] ? Promise.reject(httpError(403)) : respond(url));
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    await screen.findByRole('heading', { name: 'This page could not load' });
    expectPrivateContentHidden();
    expect(signal.aborted).toBe(true);
    await act(async () => { resolvePhoto({ data: new Blob(['late synthetic bytes']) }); });
    expect(URL.createObjectURL).not.toHaveBeenCalled();
    expectPrivateContentHidden();
  });

  it(`keeps a ${read} denial hidden through a failed retry and partial recovery until both fresh reads succeed`, async () => {
    const router = mount('/verification/5?view=sink');
    await screen.findByRole('img');
    await openHistory();
    const cache = caches.at(-1)!;
    api.get.mockImplementation((url: string) => url === readPaths[read] ? Promise.reject(httpError(403)) : respond(url));
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    await screen.findByRole('heading', { name: 'This page could not load' });
    expectPrivateContentHidden();

    api.get.mockImplementation((url: string) => url === readPaths[read] ? Promise.reject(httpError(503)) : respond(url));
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(cache.getQueryState(readKeys[read])?.error).toMatchObject({ response: { status: 503 } }));
    expectPrivateContentHidden();

    taskData = { ...taskRecord(), title: 'Fresh task', staff: { name: 'Fresh worker' } };
    data = manifest(); data.task.title = 'Fresh task'; data.task.location.name = 'Fresh site'; data.areaName = 'Fresh area'; data.items[0].name = 'Fresh fixture';
    let resolveTask!: (response: Awaited<ReturnType<typeof respond>>) => void;
    let resolveManifest!: (response: Awaited<ReturnType<typeof respond>>) => void;
    const pendingTask = new Promise<Awaited<ReturnType<typeof respond>>>(resolve => { resolveTask = resolve; });
    const pendingManifest = new Promise<Awaited<ReturnType<typeof respond>>>(resolve => { resolveManifest = resolve; });
    api.get.mockImplementation((url: string) => url === readPaths.task ? pendingTask : url === readPaths.manifest ? pendingManifest : respond(url));
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(cache.getQueryState(readKeys.task)?.fetchStatus).toBe('fetching'));
    expectPrivateContentHidden();
    await act(async () => { resolveTask(await respond(readPaths.task)); });
    await waitFor(() => expect(cache.getQueryState(readKeys.task)?.status).toBe('success'));
    expectPrivateContentHidden();
    await act(async () => { resolveManifest(await respond(readPaths.manifest)); });
    expect(await screen.findByRole('img')).toHaveAttribute('alt', expect.stringContaining('Fresh fixture'));
    expect(screen.getByRole('list', { name: 'Task details' })).toHaveTextContent('Fresh area');
    expect(screen.getByRole('list', { name: 'Task details' })).toHaveTextContent('Fresh worker');
    expect(document.body).toHaveTextContent('Fresh task · Fresh site');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(router.state.location.search).toBe('?view=sink');
    expect(screen.getByText('Previous photos and upload history').closest('details')).not.toHaveAttribute('open');
    api.get.mockImplementation((url: string) => url.endsWith('/verification/history')
      ? Promise.resolve({ data: { data: { attempts: [{ ...historyAttempt(), requirement: { viewKey: 'BASIN_TAP', item: { nameSnapshot: 'Fresh history fixture' } } }], nextCursor: null } } }) : respond(url));
    fireEvent.click(screen.getByText('Previous photos and upload history'));
    expect(screen.queryByText('Synthetic history fixture')).not.toBeInTheDocument();
    expect(await screen.findByText('Fresh history fixture')).toBeInTheDocument();
  });
}

it.each([401, 403, 404, 410])('hides the legacy area submissions and task facts after a %i task refresh', async status => {
  taskData = taskRecord(1);
  mount('/verification/5');
  expect(await screen.findByText('Synthetic legacy area')).toBeInTheDocument();
  expect(screen.getByRole('img')).toHaveAttribute('src', 'blob:legacy-photo');
  api.get.mockImplementation((url: string) => url === readPaths.task ? Promise.reject(httpError(status)) : respond(url));
  fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
  await screen.findByRole('heading', { name: 'This page could not load' });
  expectPrivateContentHidden();
  expect(screen.queryByText('Area Submissions')).not.toBeInTheDocument();
  expect(api.get.mock.calls.some(([url]) => url === readPaths.manifest)).toBe(false);
});

it('a terminal manifest error takes precedence over a simultaneous transient task error', async () => {
  mount('/verification/5');
  await screen.findByRole('img');
  api.get.mockImplementation((url: string) => Promise.reject(httpError(url === readPaths.manifest ? 403 : 503)));
  fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('You do not have access to this location.');
  expectPrivateContentHidden();
});

it('a held photo the reviewer may see loads with the privacy notice; a server denial shows no photo', async () => {
  data = manifest('PRIVACY_HOLD');
  mount('/verification/5');
  expect(await screen.findByRole('img')).toBeInTheDocument();
  expect(screen.getByText('Privacy flag recorded · Manager access. Viewing does not allow acceptance.')).toBeInTheDocument();
  caches.splice(0).forEach(c => c.clear()); document.body.innerHTML = '';
  api.get.mockImplementation(async (url: string) => {
    if (url.startsWith('/evidence/')) throw Object.assign(new Error('denied'), { response: { status: 403 } });
    if (url.endsWith('/verification')) return { data: { data: structuredClone(data) } };
    return { data: { data: { id: 5, title: 'Synthetic task', verificationVersion: 2, staff: { name: 'Synthetic worker' }, verificationException: null } } };
  });
  mount('/verification/5');
  expect(await screen.findByText('You do not have access to this evidence.')).toBeInTheDocument();
  expect(screen.queryByRole('img')).not.toBeInTheDocument();
});

it('a held photo without restricted-review access is never requested', () => {
  localStorage.setItem('hygene-ops.language', 'en');
  render(<LanguageProvider><div className="workspace"><ProtectedEvidence assetId="held-asset" privacyState="PRIVACY_HOLD" /></div></LanguageProvider>);
  expect(screen.getByText('Sensitive image restricted. Only an authorized privacy review can access it.')).toBeInTheDocument();
  expect(api.get).not.toHaveBeenCalled();
});

it('loading is a skeleton, and reduced motion has no spin or press scale', () => {
  localStorage.setItem('hygene-ops.language', 'en');
  api.get.mockImplementation(() => new Promise(() => {}));
  const { container } = render(<LanguageProvider><div className="workspace"><ProtectedEvidence assetId="slow" privacyState="SAFE" /></div></LanguageProvider>);
  expect(screen.getByRole('status')).toHaveTextContent('Loading protected photo…');
  expect(container.querySelector('.wx-evidence-skeleton')).not.toBeNull();
  expect(container.querySelector('svg')).toBeNull();
  expect(css).not.toMatch(/animation|@keyframes/);
  const reduced = css.slice(css.indexOf('prefers-reduced-motion'));
  expect(reduced).toMatch(/\.wx-task-photos-button:active \{ transform: none; \}/);
});
