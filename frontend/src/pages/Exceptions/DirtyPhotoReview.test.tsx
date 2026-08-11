import { configureStore } from '@reduxjs/toolkit';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { Provider } from 'react-redux';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { LanguageProvider } from '@/i18n/LanguageProvider';
import { translate } from '@/i18n/translations';
import authReducer, { setUser } from '@/store/slices/authSlice';
import ReviewDetail from './ReviewDetail';
import type { ExceptionDetail } from './types';
import type { EvidenceAttempt } from '../Verification/types';

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock('@/api/client', () => ({ client: api }));

const receivedAt = '2026-11-21T04:00:00Z';
const requirementId = 'ba13d6ae-5d21-438e-96a7-020c0cafe001';
const attemptId = 'ba13d6ae-5d21-438e-96a7-020c0cafe002';
const hint = 'AI result: more cleaning needed. You can accept this photo if it is clean.';
const acceptLabel = 'Accept this photo';

function fixture(): ExceptionDetail {
  const photo: EvidenceAttempt = {
    id: attemptId, requirementId, state: 'CLEANING_REQUIRED',
    privacyState: 'NOT_REQUIRED', mediaAssetId: 'kept-photo', createdAt: receivedAt, receivedAt,
    reviewSummary: { reasonCode: 'CLEANING_REQUIRED', cleanliness: 'DIRTY', dirtySurfaces: ['basin'], missingSurfaces: [] },
  };
  return {
    id: 3,
    kind: 'TASK',
    state: 'MANAGER_REVIEW',
    rowVersion: 2,
    priority: 1,
    locationId: 8,
    firstRaisedAt: receivedAt,
    updatedAt: receivedAt,
    items: [{
      id: 1, nameSnapshot: 'Basin', sourceAreaItemId: 1,
      requirements: [{
        id: requirementId, viewKey: 'BASIN_TAP', state: 'CLEANING_REQUIRED', mandatory: true,
        decisionVersion: 2, instructionsSnapshot: 'Show the basin and tap', currentAttemptId: attemptId,
        allowedActions: ['ACCEPT_EVIDENCE'],
        currentAttempt: photo,
      }],
    }],
    issues: [{
      id: 41, requirementId, reasonCode: 'CLEANING_REQUIRED', state: 'OPEN', occurrences: 1,
      recommendedAction: 'REVIEW', firstSeenAt: receivedAt, lastSeenAt: receivedAt, allowedActions: ['ACCEPT_EVIDENCE'],
      latestAttempt: photo,
    }],
    allowedActions: ['ACCEPT_EVIDENCE'],
    closureActions: ['RESOLVE_REVIEW'],
    decisions: [],
    events: [],
  };
}

let detail: ExceptionDetail;
let cache: QueryClient;

function mount(entry = '/exceptions/3?issueId=41', language = 'en') {
  localStorage.setItem('hygene-ops.language', language);
  const store = configureStore({ reducer: { auth: authReducer } });
  store.dispatch(setUser({ id: 1, companyId: 42, role: 'MANAGER', name: 'Reviewer', email: 'fixture@example.invalid' }));
  const router = createMemoryRouter([
    { path: '/exceptions/:id', element: <ReviewDetail id={3} backTo="/exceptions" /> },
  ], { initialEntries: [entry] });
  render(<Provider store={store}><QueryClientProvider client={cache}><LanguageProvider>
    <RouterProvider router={router} />
  </LanguageProvider></QueryClientProvider></Provider>);
}

beforeEach(() => {
  api.get.mockReset();
  api.post.mockReset();
  cache = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  detail = fixture();
  vi.stubGlobal('IntersectionObserver', class {
    private callback: (entries: { isIntersecting: boolean }[]) => void;
    constructor(callback: (entries: { isIntersecting: boolean }[]) => void) { this.callback = callback; }
    observe() { this.callback([{ isIntersecting: true }]); }
    disconnect() {}
  });
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:kept-photo');
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  api.get.mockImplementation(async (url: string) => {
    if (url.startsWith('/evidence/')) return { data: new Blob(['kept photo']) };
    return { data: { data: url.endsWith('/next') ? { nextId: null } : structuredClone(detail) } };
  });
  api.post.mockResolvedValue({ data: { data: {} } });
});

afterEach(() => {
  cleanup();
  cache.clear();
  localStorage.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it('shows the kept photo and cleaning finding, and submits the offered acceptance for the inspected attempt', async () => {
  mount();
  const panel = within(await screen.findByRole('region', { name: 'Review photo' }));
  expect(await panel.findByRole('img', { name: 'Basin · Basin, drain and tap' })).toHaveAttribute('src', 'blob:kept-photo');
  expect(panel.getByText('More cleaning is needed')).toBeVisible();
  expect(panel.getByText(hint)).toBeVisible();

  const accept = panel.getByRole('button', { name: acceptLabel });
  fireEvent.click(accept);
  expect(api.post).not.toHaveBeenCalledWith('/verification-exceptions/3/actions', expect.anything());
  fireEvent.change(panel.getByRole('textbox', { name: 'What did you check?' }), { target: { value: 'The basin and tap look clean.' } });
  detail.items![0].requirements[0].state = 'MANAGER_ACCEPTED';
  detail.issues[0].state = 'RESOLVED';
  fireEvent.click(accept);
  await waitFor(() => expect(api.post).toHaveBeenCalledWith('/verification-exceptions/3/actions', {
    requestId: expect.any(String), expectedVersion: 2, action: 'ACCEPT_EVIDENCE', reasonCode: 'CLEAN',
    issueId: 41, requirementId, evidenceAttemptId: attemptId, note: 'The basin and tap look clean.',
  }));
  await waitFor(() => expect(panel.queryByRole('button', { name: acceptLabel })).not.toBeInTheDocument());
});

it('uses actions on the requirement when there is no linked issue', async () => {
  detail.issues = [];
  mount(`/exceptions/3?requirementId=${requirementId}`);
  const panel = within(await screen.findByRole('region', { name: 'Review photo' }));
  expect(panel.getByText(hint)).toBeVisible();
  expect(panel.getByRole('button', { name: acceptLabel })).toBeVisible();
});

it('shows the dirty finding on the current attempt when the issue records it', async () => {
  detail.items![0].requirements[0].state = 'REVIEW_REQUIRED';
  mount();
  const panel = within(await screen.findByRole('region', { name: 'Review photo' }));
  expect(panel.getByText('More cleaning is needed')).toBeVisible();
  expect(panel.getByText(hint)).toBeVisible();
});

it('leaves acceptance unavailable when the server omits it for the issue', async () => {
  detail.issues[0].allowedActions = [];
  mount();
  const panel = within(await screen.findByRole('region', { name: 'Review photo' }));
  expect(panel.getByText(hint)).toBeVisible();
  expect(panel.queryByRole('button', { name: acceptLabel })).not.toBeInTheDocument();
});

it('retains the old discarded-photo explanation without offering acceptance', async () => {
  const photo = detail.items![0].requirements[0].currentAttempt!;
  photo.privacyState = 'DISCARDED';
  photo.mediaAssetId = null;
  mount();
  const panel = within(await screen.findByRole('region', { name: 'Review photo' }));
  expect(panel.getByText('Rejected photo was not kept')).toBeVisible();
  expect(panel.queryByRole('img')).not.toBeInTheDocument();
  expect(panel.queryByText(hint)).not.toBeInTheDocument();
  expect(panel.queryByRole('button', { name: acceptLabel })).not.toBeInTheDocument();
});

it('shows the Urdu hint through the language provider', async () => {
  mount('/exceptions/3?issueId=41', 'ur');
  const panel = within(await screen.findByRole('region', { name: translate('Review photo', 'ur') }));
  expect(panel.getByText('مصنوعی ذہانت کا نتیجہ: مزید صفائی کی ضرورت ہے۔ اگر تصویر میں جگہ صاف دکھائی دے تو آپ تصویر قبول کر سکتے ہیں۔')).toBeVisible();
  expect(panel.queryByText(hint)).not.toBeInTheDocument();
});
