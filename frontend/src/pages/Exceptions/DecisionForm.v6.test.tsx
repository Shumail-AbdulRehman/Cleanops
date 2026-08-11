import { useState, type ReactNode } from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryRouter, RouterProvider, Link, useSearchParams } from 'react-router-dom';
import { beforeEach, it, expect, vi } from 'vitest';
import { LanguageProvider } from '@/i18n/LanguageProvider';
import { translate } from '@/i18n/translations';
import DecisionForm from './DecisionForm';
import type { ExceptionDetail, ReviewClosureAction } from './types';

const api = vi.hoisted(() => ({ post: vi.fn() }));
vi.mock('@/api/client', () => ({ client: api }));
const recordedAt = '2026-11-11T04:10:00Z';
function fixture(): ExceptionDetail {
  return {
    id: 31, kind: 'TASK', state: 'MANAGER_REVIEW', priority: 1, rowVersion: 7, locationId: 8,
    firstRaisedAt: recordedAt, updatedAt: recordedAt, issues: [], allowedActions: [],
    closureActions: ['RESOLVE_REVIEW', 'RECORD_PERFORMANCE_ISSUE'],
    performanceStaffOptions: [{ id: 14, name: 'Synthetic worker A' }, { id: 15, name: 'Synthetic worker B' }],
    location: { id: 8, name: 'Synthetic site', timezone: 'Asia/Karachi' }, decisions: [], events: [],
  };
}
function mount(content: ReactNode) {
  const query = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const router = createMemoryRouter([
    { path: '/exceptions/:id', element: content }, { path: '/elsewhere', element: <p>Left synthetic review</p> },
  ], { initialEntries: ['/exceptions/31?locationId=8&queue=needs-me'] });
  const view = render(<QueryClientProvider client={query}><LanguageProvider><div className="workspace"><RouterProvider router={router} /></div></LanguageProvider></QueryClientProvider>);
  return { ...view, router };
}
function form(detail = fixture(), onDone = vi.fn(async () => {}), extra = {}) {
  mount(<DecisionForm detail={detail} onDone={onDone} {...extra} />);
  return onDone;
}
const chooseIssue = () => fireEvent.click(screen.getByRole('radio', { name: 'Record staff performance issue' }));
const note = () => screen.getByRole('textbox');
const fillNote = (value = 'Synthetic circumstances checked') => fireEvent.change(note(), { target: { value } });
const save = () => fireEvent.click(screen.getByRole('button', { name: /Confirm resolution|Record issue and close review/ }));
const submit = () => fireEvent.submit(note().closest('form')!);
const staff = (value = '14') => fireEvent.change(screen.getByRole('combobox', { name: 'Staff member' }), { target: { value } });
const category = (value = 'CLEANING_QUALITY') => fireEvent.change(screen.getByRole('combobox', { name: 'Performance category' }), { target: { value } });

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
  api.post.mockResolvedValue({ data: { data: {} } });
});

it.each<ReviewClosureAction[]>([['RESOLVE_REVIEW'], ['RECORD_PERFORMANCE_ISSUE'], ['RESOLVE_REVIEW', 'RECORD_PERFORMANCE_ISSUE']])('shows only server-allowed outcomes (%j)', (...actions) => {
  form({ ...fixture(), closureActions: actions });
  expect(screen.getAllByRole('radio')).toHaveLength(actions.length);
  expect(!!screen.queryByRole('radio', { name: 'Resolve review' })).toBe(actions.includes('RESOLVE_REVIEW'));
  expect(!!screen.queryByRole('radio', { name: 'Record staff performance issue' })).toBe(actions.includes('RECORD_PERFORMANCE_ISSUE'));
  expect(screen.getByRole('group', { name: 'Your decision' })).toBeInTheDocument();
});
it('starts with resolution and hides issue fields until selected', () => {
  form();
  expect(screen.getByRole('radio', { name: 'Resolve review' })).toBeChecked();
  expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
  fillNote(); chooseIssue();
  expect(screen.getByRole('radio', { name: 'Record staff performance issue' })).toBeChecked();
  expect(screen.getByRole('radio', { name: 'Resolve review' })).not.toBeChecked();
  expect(screen.getByRole('textbox', { name: 'Performance note' })).toHaveValue('Synthetic circumstances checked');
  expect(screen.getByRole('combobox', { name: 'Staff member' })).toBeRequired();
  expect(screen.getByRole('combobox', { name: 'Performance category' })).toBeRequired();
  expect(screen.getByText(/A photo-check failure does not automatically count against staff/)).toBeInTheDocument();
});
it('shows exactly the five specified category labels and existing payload values', () => {
  form(); chooseIssue();
  const options = within(screen.getByRole('combobox', { name: 'Performance category' })).getAllByRole('option');
  expect(options.map(option => option.textContent)).toEqual(['Choose a category', 'Cleaning quality', 'Missing photos', 'Wrong photo', 'Incomplete work', 'Other']);
  expect(options.map(option => (option as HTMLOptionElement).value)).toEqual(['', 'CLEANING_QUALITY', 'MISSING_PHOTOS', 'WRONG_PHOTO', 'INCOMPLETE_WORK', 'OTHER']);
});
it.each(['', '   \n '])('blocks an empty/whitespace note and associates its inline error (%j)', value => {
  form(); fillNote(value); save();
  expect(api.post).not.toHaveBeenCalled();
  expect(screen.getByRole('alert')).toHaveTextContent('Add a note before saving.');
  expect(note()).toHaveAttribute('aria-invalid', 'true');
  expect(note()).toHaveAccessibleDescription('Add a note before saving.');
  expect(note()).toHaveFocus();
});
it('shows required errors on blur and removes them as fields become valid', () => {
  form(); fireEvent.blur(note());
  expect(screen.getByRole('alert')).toHaveTextContent('Add a note before saving.');
  fillNote(); expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  expect(note()).toHaveAttribute('maxlength', '1000');
  expect(note()).toBeRequired();
});
it('requires staff and category with focus on the first missing field', () => {
  form(); chooseIssue(); fillNote(); save();
  expect(api.post).not.toHaveBeenCalled();
  expect(screen.getByRole('combobox', { name: 'Staff member' })).toHaveFocus();
  expect(screen.getByRole('combobox', { name: 'Staff member' })).toHaveAccessibleDescription('Choose responsible staff member');
  expect(screen.getByRole('combobox', { name: 'Performance category' })).toHaveAccessibleDescription('Choose a performance category.');
  staff(); save(); expect(screen.getByRole('combobox', { name: 'Performance category' })).toHaveFocus();
  expect(api.post).not.toHaveBeenCalled();
});
it('preselects the sole server-authorized staff member', () => {
  form({ ...fixture(), performanceStaffOptions: [{ id: 14, name: 'Synthetic worker A' }] }); chooseIssue();
  expect(screen.getByRole('combobox', { name: 'Staff member' })).toHaveValue('14');
});
it('never invents staff options when the server supplies none', () => {
  form({ ...fixture(), performanceStaffOptions: [] }); chooseIssue(); category(); fillNote(); save();
  expect(screen.getByRole('combobox', { name: 'Staff member' })).toHaveValue('');
  expect(within(screen.getByRole('combobox', { name: 'Staff member' })).getAllByRole('option')).toHaveLength(1);
  expect(api.post).not.toHaveBeenCalled();
});
it('submits the unchanged resolution contract, trimmed note and expectedVersion', async () => {
  const done = form(); fillNote('  Synthetic resolution \n '); save();
  await waitFor(() => expect(done).toHaveBeenCalledWith('Review resolved. This task is no longer in the active exception queue.'));
  expect(api.post).toHaveBeenCalledExactlyOnceWith('/verification-exceptions/31/close', {
    requestId: expect.any(String), expectedVersion: 7, action: 'RESOLVE_REVIEW', note: 'Synthetic resolution',
  });
});
it.each(['CLEANING_QUALITY', 'MISSING_PHOTOS', 'WRONG_PHOTO', 'INCOMPLETE_WORK', 'OTHER'])('submits an attributed issue with category %s', async value => {
  const done = form(); chooseIssue(); staff('15'); category(value); fillNote(); save();
  await waitFor(() => expect(done).toHaveBeenCalledWith('Staff performance issue recorded. This task review is now closed.'));
  expect(api.post).toHaveBeenCalledExactlyOnceWith('/verification-exceptions/31/close', {
    requestId: expect.any(String), expectedVersion: 7, action: 'RECORD_PERFORMANCE_ISSUE', note: 'Synthetic circumstances checked', staffId: 15, category: value,
  });
});
it('removes issue-only fields from a resolution payload after changing outcomes', async () => {
  const done = form(); chooseIssue(); staff(); category(); fillNote();
  fireEvent.click(screen.getByRole('radio', { name: 'Resolve review' })); save();
  await waitFor(() => expect(done).toHaveBeenCalled());
  expect(api.post.mock.calls[0][1]).not.toHaveProperty('category');
  expect(api.post.mock.calls[0][1]).not.toHaveProperty('staffId');
});
it.each([false, true])('preserves a conflict note and waits for a new server version (new=%s)', async changed => {
  function Live() {
    const [version, setVersion] = useState(7);
    return <DecisionForm detail={{ ...fixture(), rowVersion: version }} onDone={async () => setVersion(changed ? 8 : 7)} />;
  }
  api.post.mockRejectedValueOnce({ response: { status: 409 } }); mount(<Live />); fillNote(); save();
  expect(await screen.findByRole('alert')).toHaveTextContent('This review changed. Refresh before saving. Your note is kept.');
  expect(screen.getByRole('button', { name: 'Confirm resolution' })).toBeDisabled();
  chooseIssue(); staff(); category();
  expect(screen.getByRole('alert')).toHaveTextContent('This review changed.');
  expect(screen.getByRole('button', { name: 'Record issue and close review' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Refresh review' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Record issue and close review' })).toHaveProperty('disabled', !changed));
  expect(note()).toHaveValue('Synthetic circumstances checked');
  if (changed) { save(); await waitFor(() => expect(api.post).toHaveBeenCalledTimes(2)); expect(api.post.mock.calls[1][1].expectedVersion).toBe(8); }
});
it.each([401, 403, 503])('keeps the note with safe recovery after status %s', async status => {
  api.post.mockRejectedValue({ response: { status, data: { message: 'Secret internal error fixture' } } }); form(); fillNote(); save();
  expect(await screen.findByRole('alert')).toHaveTextContent(status === 503 ? 'Could not save your decision.' : 'You do not have access to save a decision');
  expect(note()).toHaveValue('Synthetic circumstances checked');
  expect(screen.queryByText('Secret internal error fixture')).not.toBeInTheDocument();
});
it('reuses the request identity after an uncertain failure and changes it for an edited payload', async () => {
  api.post.mockRejectedValue(new Error('Synthetic response lost')); form(); fillNote(); save();
  await screen.findByRole('alert'); submit(); await waitFor(() => expect(api.post).toHaveBeenCalledTimes(2));
  expect(api.post.mock.calls[1]).toEqual(api.post.mock.calls[0]);
  await waitFor(() => expect(screen.getByRole('button', { name: 'Confirm resolution' })).toBeEnabled());
  fillNote('Synthetic revised note'); submit(); await waitFor(() => expect(api.post).toHaveBeenCalledTimes(3));
  expect(api.post.mock.calls[2][1].requestId).not.toBe(api.post.mock.calls[0][1].requestId);
});
it('disables edits and duplicate submissions while saving, then shows the server-saved record', async () => {
  let finish!: (value: unknown) => void;
  api.post.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  function Live() {
    const [detail, setDetail] = useState(fixture());
    return <DecisionForm detail={detail} onDone={async () => setDetail({ ...detail, state: 'RESOLVED', decisions: [{ id: 1, action: 'RESOLVE_REVIEW', reasonCode: 'MANAGER_RESOLVED', note: 'Synthetic server note', actorManager: { name: 'Synthetic manager' }, createdAt: recordedAt }] })} />;
  }
  mount(<Live />); fillNote(); save();
  await screen.findByRole('button', { name: 'Saving decision…' });
  expect(note()).toBeDisabled(); expect(screen.getByRole('radio', { name: 'Resolve review' })).toBeDisabled();
  submit(); expect(api.post).toHaveBeenCalledTimes(1);
  finish({ data: { data: {} } });
  expect(await screen.findByRole('region', { name: 'Decision recorded' })).toHaveTextContent('Synthetic server note');
  expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
});
it('retains the note offline and restores saving when reconnected', () => {
  form(); fillNote(); vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false); fireEvent(window, new Event('offline'));
  expect(screen.getByRole('status')).toHaveTextContent('You’re offline');
  expect(screen.getByRole('button', { name: 'Confirm resolution' })).toBeDisabled(); submit(); expect(api.post).not.toHaveBeenCalled();
  expect(note()).toHaveValue('Synthetic circumstances checked');
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true); fireEvent(window, new Event('online'));
  expect(screen.queryByRole('status')).not.toBeInTheDocument(); expect(screen.getByRole('button', { name: 'Confirm resolution' })).toBeEnabled();
});
it('keeps the mounted note and focus after refresh failure until the parent restores availability', async () => {
  const refresh = vi.fn();
  function Live() {
    const [unavailable, setUnavailable] = useState(false);
    return <><button onClick={() => setUnavailable(true)}>Fail refresh</button><DecisionForm detail={fixture()} unavailable={unavailable} onDone={async () => { refresh(); setUnavailable(false); }} /></>;
  }
  mount(<Live />); fillNote(); note().focus(); fireEvent.click(screen.getByRole('button', { name: 'Fail refresh' }));
  expect(note()).toHaveValue('Synthetic circumstances checked'); expect(note()).toHaveFocus();
  expect(screen.getByRole('alert')).toHaveTextContent('Review details could not refresh. Your note is kept.');
  expect(screen.getByRole('button', { name: 'Confirm resolution' })).toBeDisabled(); submit(); expect(api.post).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Refresh review' })); await waitFor(() => expect(refresh).toHaveBeenCalledOnce());
  expect(screen.getByRole('button', { name: 'Confirm resolution' })).toBeEnabled(); expect(note()).toHaveValue('Synthetic circumstances checked');
});
it('fails closed when a refreshed response removes the selected outcome', () => {
  function Live() {
    const [actions, setActions] = useState<ReviewClosureAction[]>(['RESOLVE_REVIEW', 'RECORD_PERFORMANCE_ISSUE']);
    return <><button onClick={() => setActions(['RECORD_PERFORMANCE_ISSUE'])}>Remove resolution</button><DecisionForm detail={{ ...fixture(), closureActions: actions }} onDone={async () => {}} /></>;
  }
  mount(<Live />); fillNote(); fireEvent.click(screen.getByRole('button', { name: 'Remove resolution' }));
  expect(screen.queryByRole('radio', { name: 'Resolve review' })).not.toBeInTheDocument(); expect(screen.getByRole('button', { name: 'Confirm resolution' })).toBeDisabled();
  submit(); expect(api.post).not.toHaveBeenCalled();
});
it('preserves draft inspection, blocks review/filter navigation and supports Stay and Leave', async () => {
  function Live() {
    const [, setParams] = useSearchParams();
    return <><button onClick={() => setParams({ issueId: '2', requirementId: 'view' })}>Inspect photo</button><button onClick={() => setParams({ queue: 'resolved' })}>Change queue</button><Link to="/elsewhere">Leave page</Link><DecisionForm detail={fixture()} onDone={async () => {}} /></>;
  }
  const { router } = mount(<Live />); fillNote();
  // Inspection changes only these two parameters, retaining all other URL scope.
  await router.navigate('/exceptions/31?locationId=8&queue=needs-me&issueId=2&requirementId=view');
  expect(screen.queryByRole('alert')).not.toBeInTheDocument(); expect(note()).toHaveValue('Synthetic circumstances checked');
  fireEvent.click(screen.getByRole('button', { name: 'Change queue' })); expect(screen.getByRole('alert')).toHaveTextContent('You have an unsaved note.');
  fireEvent.click(screen.getByRole('button', { name: 'Stay here' })); expect(note()).toHaveValue('Synthetic circumstances checked');
  fireEvent.click(screen.getByRole('link', { name: 'Leave page' })); fireEvent.click(screen.getByRole('button', { name: 'Leave review' }));
  expect(await screen.findByText('Left synthetic review')).toBeInTheDocument();
});
it('keeps the canceled note protected and restores it when an outcome is chosen again', () => {
  form(); fillNote(); fireEvent.click(screen.getByRole('button', { name: 'Cancel' })); expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('radio', { name: 'Resolve review' })); expect(note()).toHaveValue('Synthetic circumstances checked');
  const event = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(event); expect(event.defaultPrevented).toBe(true);
});
it.each([true, false])('distinguishes existing performance issues from missing assignments (%s)', recorded => {
  form({ ...fixture(), closureActions: ['RESOLVE_REVIEW'], performanceIssueRecorded: recorded });
  expect(screen.getByText(recorded ? 'A performance issue has already been recorded for this task.' : 'A performance issue needs a staff member assigned to this task.')).toBeInTheDocument();
});
it('blocks task decisions for setup records even if closure actions are present', () => {
  form({ ...fixture(), kind: 'SETUP' }); expect(screen.getByRole('status')).toHaveTextContent('No staff decision is available for this setup record.');
  expect(screen.queryByRole('radio')).not.toBeInTheDocument(); expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
});
it('explains unavailable server actions and offers refresh without inventing an outcome', async () => {
  const refresh = form({ ...fixture(), closureActions: [] }); expect(screen.getByRole('status')).toHaveTextContent('Review decisions could not be loaded.');
  expect(screen.queryByRole('radio')).not.toBeInTheDocument(); fireEvent.click(screen.getByRole('button', { name: 'Refresh review' })); await waitFor(() => expect(refresh).toHaveBeenCalledWith());
});
it.each(['RESOLVE_REVIEW', 'RECORD_PERFORMANCE_ISSUE'])('shows the saved %s outcome, attribution, timestamp, verbatim note and next link', action => {
  form({ ...fixture(), state: 'RESOLVED', decisions: [
    { id: 1, action: 'ACCEPT_EVIDENCE', reasonCode: 'ACCEPTED', note: 'Not the closure note', createdAt: recordedAt },
    { id: 2, action, reasonCode: 'MANAGER_RECORDED', note: 'Synthetic saved note\nSecond saved line', actorManager: { name: 'Synthetic manager' }, createdAt: recordedAt },
  ] }, undefined, { nextReviewHref: '/exceptions/32?returnTo=%2Fexceptions%3Fqueue%3Dneeds-me' });
  const panel = screen.getByRole('region', { name: 'Decision recorded' });
  expect(within(panel).getByRole('status')).toHaveTextContent(action === 'RESOLVE_REVIEW' ? 'Resolution recorded' : 'Staff performance issue recorded');
  expect(panel).toHaveTextContent('Manager reviewed'); expect(panel).toHaveTextContent('Synthetic manager'); expect(panel).toHaveTextContent('Recorded at');
  expect(panel.querySelector('time')).toHaveAttribute('datetime', recordedAt); expect(panel).toHaveTextContent('9:10 am'); expect(panel).toHaveTextContent('Asia/Karachi');
  expect(within(panel).getByText(/Synthetic saved note/).textContent).toBe('Synthetic saved note\nSecond saved line');
  expect(panel).toHaveTextContent('This review is closed. Task verification remains as recorded.');
  expect(within(panel).getByRole('link', { name: 'Next pending review' })).toHaveAttribute('href', '/exceptions/32?returnTo=%2Fexceptions%3Fqueue%3Dneeds-me');
  expect(screen.queryByRole('textbox')).not.toBeInTheDocument(); expect(screen.queryByRole('radio')).not.toBeInTheDocument(); expect(screen.queryByText('Not the closure note')).not.toBeInTheDocument();
});
it('does not invent saved decision details or a next review for historical records', () => {
  form({ ...fixture(), state: 'RESOLVED', decisions: [] }); expect(screen.getByRole('status')).toHaveTextContent('Review closed; decision details unavailable');
  expect(screen.queryByText('Saved note')).not.toBeInTheDocument(); expect(screen.queryByRole('link')).not.toBeInTheDocument();
});
it('uses explicit unavailable actor/note labels on incomplete saved records', () => {
  form({ ...fixture(), state: 'RESOLVED', decisions: [{ id: 1, action: 'RESOLVE_REVIEW', reasonCode: 'MANAGER_RESOLVED', createdAt: recordedAt }] });
  expect(screen.getByText('Manager name unavailable')).toBeInTheDocument(); expect(screen.getByText('Decision note unavailable')).toBeInTheDocument();
});
it('translates the choices, labels and required validation in Urdu, preserving staff names', () => {
  localStorage.setItem('hygene-ops.language', 'ur'); form();
  fireEvent.click(screen.getByRole('radio', { name: translate('Record staff performance issue', 'ur') }));
  expect(document.documentElement.dir).toBe('rtl'); expect(screen.getByRole('textbox', { name: translate('Performance note', 'ur') })).toBeInTheDocument();
  expect(screen.getByRole('option', { name: 'Synthetic worker A' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: translate('Record issue and close review', 'ur') }));
  expect(screen.getByText(translate('Add a note before saving.', 'ur'))).toBeInTheDocument(); expect(screen.getByText(translate('Choose a performance category.', 'ur'))).toBeInTheDocument();
});
