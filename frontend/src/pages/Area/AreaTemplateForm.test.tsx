import { beforeEach, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { LanguageProvider } from '@/i18n/LanguageProvider';
import { WorkspaceTheme } from '@/components/common/WorkspaceTheme';
import AreaTemplateForm from './AreaTemplateForm';
import LocationAreasTab from './LocationAreasTab';
import { MemoryRouter, useLocation } from 'react-router-dom';
import type { Area } from './types';
const m = vi.hoisted(() => ({ create: vi.fn(), area: vi.fn(), invalidate: vi.fn(), edit: vi.fn(), item: vi.fn(), add: vi.fn(), archive: vi.fn(), areas: vi.fn() }));
vi.mock('./api', () => ({ createArea: m.create, getArea: m.area, getAreas: m.areas, getMappingTemplates: vi.fn().mockResolvedValue([]), addItems: m.add, archiveArea: m.archive, editArea: m.edit, editItem: m.item }));
vi.mock('@/lib/invalidateWorkspace', () => ({ invalidateWorkspace: m.invalidate }));
function mount(language = 'en', areaId?: number) { localStorage.setItem('hygene-ops.language', language); const close = vi.fn(), created = vi.fn(); render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><LanguageProvider><WorkspaceTheme.Provider value><AreaTemplateForm areaId={areaId} locationId={20} close={close} created={created} /></WorkspaceTheme.Provider></LanguageProvider></QueryClientProvider>); return { close, created }; }
beforeEach(() => { vi.resetAllMocks(); localStorage.clear(); m.create.mockResolvedValue({ id: 70 }); m.invalidate.mockResolvedValue(undefined); m.area.mockResolvedValue(structuredClone(savedArea)); m.edit.mockResolvedValue({}); m.item.mockResolvedValue({}); m.add.mockResolvedValue({}); m.archive.mockResolvedValue({}); m.areas.mockResolvedValue([structuredClone(savedArea)]); });
it('creates through the actual saved-area contract with real fixture counts inside an accessible dialog', async () => {
  const { created } = mount(); expect(screen.getByRole('dialog', { name: 'Prepare area template' })).toBeInTheDocument(); const button = screen.getByRole('button', { name: 'Create area template' }); expect(button).toBeDisabled(); fireEvent.change(screen.getByLabelText('Area name'), { target: { value: ' Saved area ' } }); fireEvent.click(button);
  await waitFor(() => expect(created).toHaveBeenCalledWith(70)); expect(m.create).toHaveBeenCalledWith(20, { name: 'Saved area', roomType: 'WASHROOM', layoutInstructions: '', counts: [{ fixtureType: 'FLOOR', count: 1 }] });
});
it('requires valid fixture capacity and translates all built-in fields in Urdu', () => {
  mount('ur'); expect(screen.getByRole('dialog', { name: 'علاقے کا سانچہ تیار کریں' })).toBeInTheDocument(); fireEvent.change(screen.getByLabelText('علاقے کا نام'), { target: { value: 'User saved name' } }); fireEvent.change(screen.getByLabelText('بیسن'), { target: { value: '200' } });
  expect(screen.getByRole('alert')).toHaveTextContent('زیادہ سے زیادہ 200 فکسچر منتخب کریں۔'); expect(screen.getByRole('button', { name: 'علاقے کا سانچہ بنائیں' })).toBeDisabled(); expect(document.documentElement.dir).toBe('rtl'); expect(m.create).not.toHaveBeenCalled();
});
it('pending creation blocks duplicate submission and Escape dismissal', async () => {
  let finish!: (value: unknown) => void; m.create.mockImplementation(() => new Promise(resolve => { finish = resolve; })); const { close, created } = mount(); fireEvent.change(screen.getByLabelText('Area name'), { target: { value: 'Saved area' } }); fireEvent.click(screen.getByRole('button', { name: 'Create area template' })); expect(screen.getByRole('button', { name: 'Saving…' })).toBeDisabled(); fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' }); expect(close).not.toHaveBeenCalled(); expect(m.create).toHaveBeenCalledTimes(1); finish({ id: 71 }); await waitFor(() => expect(created).toHaveBeenCalledTimes(1));
});
it('lost creation response preserves the draft and prevents a blind duplicate retry', async () => {
  m.create.mockRejectedValue(new Error('private transport detail')); const { close, created } = mount(); fireEvent.change(screen.getByLabelText('Area name'), { target: { value: 'Uncertain area' } }); fireEvent.click(screen.getByRole('button', { name: 'Create area template' })); expect(await screen.findByRole('alert')).toHaveTextContent('Area creation could not be confirmed.'); expect(screen.getByLabelText('Area name')).toHaveValue('Uncertain area'); expect(screen.getByRole('button', { name: 'Create area template' })).toBeDisabled(); fireEvent.click(screen.getByRole('button', { name: 'Close and check areas' })); expect(close).toHaveBeenCalled(); expect(created).not.toHaveBeenCalled(); expect(m.create).toHaveBeenCalledTimes(1);
});
it('a definitive denied save keeps the draft and presents a translated error', async () => {
  m.create.mockRejectedValue({ response: { status: 403 } }); mount('ur'); fireEvent.change(screen.getByLabelText('علاقے کا نام'), { target: { value: 'Retained name' } }); fireEvent.click(screen.getByRole('button', { name: 'علاقے کا سانچہ بنائیں' })); expect(await screen.findByRole('alert')).toHaveTextContent('اس اقدام کی اجازت نہیں۔'); expect(screen.getByLabelText('علاقے کا نام')).toHaveValue('Retained name'); expect(screen.getByRole('button', { name: 'علاقے کا سانچہ بنائیں' })).toBeEnabled();
});

const savedArea: Area = { id: 70, locationId: 20, name: 'Saved room', roomType: 'WASHROOM', status: 'ACTIVE', inventoryVersion: 3, qrVersion: 1, layoutInstructions: 'Saved instructions', items: [
  { id: 11, areaId: 70, stableCode: 'SINK-01', displayName: 'Left basin', fixtureType: 'SINK', positionHint: null, sequence: 1, identificationMode: 'ORDERED_CONTEXT', existingNumber: null, status: 'ACTIVE', rubricKey: 'sink', requiredViews: [{ key: 'front', instructions: 'Front view', mandatory: true }, { key: 'wide', mandatory: false }] },
  { id: 12, areaId: 70, stableCode: 'FLOOR-01', displayName: 'Floor corner', fixtureType: 'FLOOR', positionHint: 'Near the door', sequence: 2, identificationMode: 'ORDERED_CONTEXT', existingNumber: null, status: 'MAINTENANCE', rubricKey: 'floor', requiredViews: [{ key: 'wide', mandatory: true }] },
] };
async function editReady() { await screen.findByDisplayValue('Saved room'); }
it('room presets reset counts and send only general room fixtures', async () => {
  mount(); fireEvent.change(screen.getByLabelText('Area name'), { target: { value: 'General area' } }); fireEvent.change(screen.getByLabelText('Sink'), { target: { value: '4' } }); fireEvent.click(screen.getByRole('button', { name: 'General room' }));
  expect(screen.queryByLabelText('Sink')).not.toBeInTheDocument(); fireEvent.change(screen.getByLabelText('Bin'), { target: { value: '2' } }); fireEvent.click(screen.getByRole('button', { name: 'Create area template' }));
  await waitFor(() => expect(m.create).toHaveBeenCalledWith(20, { name: 'General area', roomType: 'GENERAL', layoutInstructions: '', counts: [{ fixtureType: 'BIN', count: 2 }, { fixtureType: 'FLOOR', count: 1 }] }));
});
it('allows exactly 200 fixtures but blocks empty inventory and totals over 200', async () => {
  mount(); fireEvent.change(screen.getByLabelText('Area name'), { target: { value: 'Capacity area' } }); fireEvent.change(screen.getByLabelText('Floor zone'), { target: { value: '0' } }); expect(screen.getByRole('button', { name: 'Create area template' })).toBeDisabled();
  fireEvent.change(screen.getByLabelText('Sink'), { target: { value: '200' } }); expect(screen.getByRole('button', { name: 'Create area template' })).toBeEnabled(); fireEvent.click(screen.getByRole('button', { name: 'Create area template' }));
  await waitFor(() => expect(m.create).toHaveBeenCalledWith(20, expect.objectContaining({ counts: [{ fixtureType: 'SINK', count: 200 }] })));
});
it('editing preserves future-only wording and saves metadata with the current version', async () => {
  mount('en', 70); await editReady(); expect(screen.getByRole('dialog')).toHaveAccessibleDescription('Template changes apply to future tasks. Existing tasks keep their required photos.');
  fireEvent.change(screen.getByLabelText('Area name'), { target: { value: ' Renamed room ' } }); fireEvent.change(screen.getByLabelText('Cleaning instructions (optional)'), { target: { value: 'New instructions' } }); fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
  await waitFor(() => expect(m.edit).toHaveBeenCalledWith(70, { name: 'Renamed room', layoutInstructions: 'New instructions', expectedInventoryVersion: 3 })); expect(m.create).not.toHaveBeenCalled();
});
it('fixture status and removal preserve fixture metadata and inventory version', async () => {
  mount('en', 70); await editReady(); fireEvent.change(screen.getByLabelText('Status: Left basin'), { target: { value: 'MAINTENANCE' } }); await waitFor(() => expect(m.item).toHaveBeenCalledWith(70, 11, expect.objectContaining({ status: 'MAINTENANCE', displayName: 'Left basin', expectedInventoryVersion: 3 })));
  await screen.findByText('Fixture saved.'); fireEvent.click(screen.getByRole('button', { name: 'Remove from template: Floor corner' })); await waitFor(() => expect(m.item).toHaveBeenCalledWith(70, 12, expect.objectContaining({ status: 'RETIRED', positionHint: 'Near the door', expectedInventoryVersion: 3 })));
});
it('fixture rename remains reachable and trims the saved name', async () => {
  mount('en', 70); await editReady(); fireEvent.click(screen.getByRole('button', { name: 'Edit Left basin' })); fireEvent.change(screen.getByLabelText('Fixture name'), { target: { value: ' Renamed basin ' } }); fireEvent.click(screen.getByRole('button', { name: 'Save fixture' })); await waitFor(() => expect(m.item).toHaveBeenCalledWith(70, 11, expect.objectContaining({ displayName: 'Renamed basin', expectedInventoryVersion: 3 })));
});
it('adding fixtures shows generated names and respects maintenance capacity', async () => {
  mount('en', 70); await editReady(); fireEvent.click(screen.getByRole('button', { name: 'Add fixtures' })); fireEvent.change(screen.getByLabelText('Fixture type'), { target: { value: 'SINK' } }); fireEvent.change(screen.getByLabelText('Count'), { target: { value: '199' } }); expect(screen.getByRole('alert')).toHaveTextContent('Choose at most 200 fixtures.'); expect(screen.getAllByRole('button', { name: 'Add fixtures' })[1]).toBeDisabled();
  fireEvent.change(screen.getByLabelText('Count'), { target: { value: '2' } }); expect(screen.getByText('Sink 02, Sink 03')).toBeInTheDocument(); fireEvent.click(screen.getAllByRole('button', { name: 'Add fixtures' })[1]); await waitFor(() => expect(m.add).toHaveBeenCalledWith(70, [{ fixtureType: 'SINK', count: 2 }], 3));
});
it('200 nonretired fixtures disable adding, including maintenance', async () => {
  m.area.mockResolvedValue({ ...savedArea, items: Array.from({ length: 200 }, (_, i) => ({ ...savedArea.items[1], id: i + 1, displayName: `Fixture ${i}` })) }); mount('en', 70); await editReady(); expect(screen.getByRole('button', { name: 'Add fixtures' })).toBeDisabled(); expect(m.add).not.toHaveBeenCalled();
});
it('archive requires explicit confirmation and Cancel does not write', async () => {
  mount('en', 70); await editReady(); fireEvent.click(screen.getByRole('button', { name: 'Archive template' })); expect(m.archive).not.toHaveBeenCalled(); expect(screen.getByText('Archive this template? It will no longer be available for new schedules. Existing tasks and evidence stay saved.')).toBeInTheDocument(); fireEvent.click(within(screen.getByRole('button', { name: 'Confirm archive' }).parentElement!).getByRole('button', { name: 'Cancel' })); expect(screen.queryByRole('button', { name: 'Confirm archive' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Archive template' })); fireEvent.click(screen.getByRole('button', { name: 'Confirm archive' })); await waitFor(() => expect(m.archive).toHaveBeenCalledExactlyOnceWith(70, 3));
});
it('draft activation remains explicit and empty drafts cannot activate', async () => {
  m.area.mockResolvedValue({ ...savedArea, status: 'DRAFT', items: [] }); mount('en', 70); await editReady(); expect(screen.getByRole('button', { name: 'Activate area' })).toBeDisabled(); expect(screen.getByText('Choose at least one fixture.')).toBeInTheDocument();
});
it('activates a saved draft through the existing versioned contract', async () => {
  m.area.mockResolvedValue({ ...savedArea, status: 'DRAFT' }); mount('en', 70); await editReady(); fireEvent.click(screen.getByRole('button', { name: 'Activate area' })); await waitFor(() => expect(m.edit).toHaveBeenCalledWith(70, { status: 'ACTIVE', expectedInventoryVersion: 3 }));
});
it('archived areas keep records readable and disable every mutation', async () => {
  m.area.mockResolvedValue({ ...savedArea, status: 'ARCHIVED' }); mount('en', 70); await editReady(); expect(screen.getByLabelText('Area name')).toBeDisabled(); expect(screen.getByRole('button', { name: 'Save changes' })).toBeDisabled(); expect(screen.getByRole('button', { name: 'Add fixtures' })).toBeDisabled(); expect(screen.queryByRole('button', { name: 'Archive template' })).not.toBeInTheDocument(); expect(screen.getByRole('button', { name: 'Cancel' })).toBeEnabled();
});
it('load failure offers retry without invented fields', async () => {
  m.area.mockRejectedValue(new Error('private detail')); mount('en', 70); await screen.findByRole('alert'); expect(screen.queryByLabelText('Area name')).not.toBeInTheDocument(); m.area.mockResolvedValue(savedArea); fireEvent.click(screen.getByRole('button', { name: 'Retry' })); await editReady();
});
it('a foreign-location area fails closed', async () => {
  m.area.mockResolvedValue({ ...savedArea, locationId: 21 }); mount('en', 70); await screen.findByRole('alert'); expect(screen.queryByLabelText('Area name')).not.toBeInTheDocument(); expect(screen.getByRole('button', { name: 'Save changes' })).toBeDisabled();
});
it('409 refresh preserves metadata and fixture drafts and uses the fresh version on retry', async () => {
  m.item.mockRejectedValueOnce({ response: { status: 409 } }); mount('en', 70); await editReady(); fireEvent.change(screen.getByLabelText('Area name'), { target: { value: 'Unsaved room' } }); fireEvent.click(screen.getByRole('button', { name: 'Edit Left basin' })); fireEvent.change(screen.getByLabelText('Fixture name'), { target: { value: 'Unsaved basin' } }); m.area.mockResolvedValue({ ...savedArea, inventoryVersion: 4 }); fireEvent.click(screen.getByRole('button', { name: 'Save fixture' })); await screen.findByText('The template was refreshed. Your edits are preserved; review them and save again.'); expect(screen.getByLabelText('Area name')).toHaveValue('Unsaved room'); expect(screen.getByLabelText('Fixture name')).toHaveValue('Unsaved basin'); fireEvent.click(screen.getByRole('button', { name: 'Save fixture' })); await waitFor(() => expect(m.item).toHaveBeenLastCalledWith(70, 11, expect.objectContaining({ displayName: 'Unsaved basin', expectedInventoryVersion: 4 })));
});
it('standard viewers mount only after disclosure and pending privacy never shows an image', async () => {
  m.area.mockResolvedValue({ ...savedArea, standards: [{ id: 2, mediaAssetId: 'protected-standard', caption: 'Saved standard', privacyState: 'PENDING', areaItemId: null }] }); mount('en', 70); await editReady(); expect(screen.queryByText('Photo saved. Privacy review pending.')).not.toBeInTheDocument(); const details = screen.getByText('Standard photos').closest('details')!; details.open = true; fireEvent(details, new Event('toggle'));  await screen.findByText('Photo saved. Privacy review pending.'); expect(screen.queryByRole('img')).not.toBeInTheDocument(); expect(screen.getByRole('button', { name: 'Retry privacy check' })).toBeInTheDocument();
});
function CurrentPath() { const location = useLocation(); return <output aria-label="Current route">{location.search}</output>; }
function mountList(path = '/locations/20?tab=areas&keep=yes') {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(<QueryClientProvider client={qc}><LanguageProvider><WorkspaceTheme.Provider value><MemoryRouter initialEntries={[path]}><div className="workspace"><LocationAreasTab locationId={20} /><CurrentPath /></div></MemoryRouter></WorkspaceTheme.Provider></LanguageProvider></QueryClientProvider>); return { ...view, qc };
}
it('list counts active mandatory photos, includes maintenance fixtures, and preserves names', async () => {
  mountList(); await screen.findByText('Saved room'); expect(screen.getByText('1 required photo views')).toBeInTheDocument(); expect(screen.getByText('2 fixtures selected')).toBeInTheDocument(); expect(screen.getByText('Floor corner')).toBeInTheDocument();
});
it('all five status filters and search remain reachable', async () => {
  m.areas.mockResolvedValue([savedArea, { ...savedArea, id: 71, name: 'Draft room', status: 'DRAFT' }, { ...savedArea, id: 72, name: 'Archived room', status: 'ARCHIVED' }]); mountList(); await screen.findByText('Saved room'); expect(screen.queryByText('Archived room')).not.toBeInTheDocument();
  for (const [filter, name] of [['Archived', 'Archived room'], ['Draft', 'Draft room'], ['Active', 'Saved room'], ['All areas', 'Archived room'], ['Current areas', 'Saved room']]) {
    fireEvent.keyDown(screen.getByRole('button', { name: /Area status:/ }), { key: 'ArrowDown' }); fireEvent.click(await screen.findByRole('menuitemradio', { name: filter })); expect(screen.getByText(name)).toBeInTheDocument();
  }
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'missing' } }); expect(screen.getByRole('heading', { name: 'No areas match these filters.' })).toBeInTheDocument(); fireEvent.click(screen.getByRole('button', { name: 'Clear filters' })); expect(screen.getByText('Saved room')).toBeInTheDocument();
});
it('editor URL preserves unrelated parameters and closes back to the list', async () => {
  mountList(); await screen.findByText('Saved room'); fireEvent.click(screen.getByRole('button', { name: 'Edit Saved room' })); await editReady(); expect(screen.getByLabelText('Current route')).toHaveTextContent('?tab=areas&keep=yes&area=70'); fireEvent.click(screen.getByRole('button', { name: 'Cancel' })); await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument()); expect(screen.getByLabelText('Current route')).toHaveTextContent('?tab=areas&keep=yes');
});
it('archive blocks dismissal through the write and refresh, then Escape clears only the editor URL', async () => {
  let finishArchive!: (value: unknown) => void;
  let finishRefresh!: () => void;
  m.archive.mockImplementation(() => new Promise(resolve => { finishArchive = resolve; }));
  m.invalidate.mockImplementation(() => new Promise<void>(resolve => { finishRefresh = resolve; }));
  const { qc } = mountList('/locations/20?tab=areas&keep=yes&area=70');
  await editReady();
  const dialog = screen.getByRole('dialog', { name: 'Edit area template' });
  fireEvent.click(within(dialog).getByRole('button', { name: 'Archive template' }));
  fireEvent.click(within(dialog).getByRole('button', { name: 'Confirm archive' }));
  expect(m.archive).toHaveBeenCalledExactlyOnceWith(70, 3);
  expect(within(dialog).getByRole('button', { name: 'Saving…' })).toBeDisabled();
  fireEvent.keyDown(dialog, { key: 'Escape' });
  fireEvent.click(within(dialog).getByRole('button', { name: 'Close' }));
  expect(dialog).toBeInTheDocument();
  expect(screen.getByLabelText('Current route').textContent).toBe('?tab=areas&keep=yes&area=70');

  await act(async () => { finishArchive({}); });
  expect(m.invalidate).toHaveBeenCalledTimes(1);
  // The archive can already be visible while other workspace reads are pending.
  act(() => { qc.setQueryData(['area', 70], { ...savedArea, status: 'ARCHIVED' }); });
  expect(await within(dialog).findByText('Archived', { exact: true })).toBeInTheDocument();
  expect(within(dialog).getByRole('button', { name: 'Cancel' })).toBeDisabled();
  fireEvent.keyDown(dialog, { key: 'Escape' });
  fireEvent.click(within(dialog).getByRole('button', { name: 'Close' }));
  expect(dialog).toBeInTheDocument();
  expect(screen.getByLabelText('Current route').textContent).toBe('?tab=areas&keep=yes&area=70');

  await act(async () => { finishRefresh(); });
  await waitFor(() => expect(within(dialog).getByRole('button', { name: 'Cancel' })).toBeEnabled());
  expect(within(dialog).getByLabelText('Area name')).toBeDisabled();
  fireEvent.keyDown(dialog, { key: 'Escape' });
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  expect(screen.getByLabelText('Current route').textContent).toBe('?tab=areas&keep=yes');
  expect(m.archive).toHaveBeenCalledTimes(1);
});
it('empty list teaches creation and opens the existing creation URL', async () => {
  m.areas.mockResolvedValue([]); mountList(); await screen.findByRole('heading', { name: 'Add area template' }); const empty = screen.getByRole('heading', { name: 'Add area template' }).parentElement!; fireEvent.click(within(empty).getByRole('button', { name: 'Add area template' })); expect(screen.getByLabelText('Current route')).toHaveTextContent('newArea=1'); expect(screen.getByRole('dialog', { name: 'Prepare area template' })).toBeInTheDocument();
});
it('list failure retries and background failure preserves saved content and search focus', async () => {
  m.areas.mockRejectedValueOnce(new Error('offline')); const { qc } = mountList(); await screen.findByRole('button', { name: 'Retry' }); fireEvent.click(screen.getByRole('button', { name: 'Retry' })); await screen.findByText('Saved room'); const search = screen.getByRole('searchbox'); fireEvent.change(search, { target: { value: 'Saved' } }); search.focus(); m.areas.mockRejectedValue(new Error('offline')); await act(async () => { await qc.invalidateQueries({ queryKey: ['areas', 20] }); }); expect(screen.getByText('Saved room')).toBeInTheDocument(); expect(search).toHaveFocus(); expect(search).toHaveValue('Saved'); expect(await screen.findByText(/Check your connection and try again. Your saved records have not changed./)).toBeInTheDocument();
});
