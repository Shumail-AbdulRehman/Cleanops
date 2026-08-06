import { beforeEach, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { LanguageProvider } from '@/i18n/LanguageProvider';
import TemplateInventoryEditor from './TemplateInventoryEditor';
import type { Area } from './types';
const m = vi.hoisted(() => ({ area: vi.fn(), map: vi.fn(), invalidate: vi.fn() }));
vi.mock('./api', () => ({ getArea: m.area, getAreas: vi.fn(), getMappingTemplates: vi.fn(), mapTemplate: m.map }));
vi.mock('@/lib/invalidateWorkspace', () => ({ invalidateWorkspace: m.invalidate }));
const area: Area = { id: 10, locationId: 20, name: 'Saved area', roomType: 'WASHROOM', status: 'ACTIVE', inventoryVersion: 3, qrVersion: 1, layoutInstructions: null, templates: [{ id: 60, title: 'Saved schedule', setupStatus: 'READY', isActive: true, inventorySelection: 'ALL', inventoryItems: [] }], items: [{ id: 11, areaId: 10, stableCode: 'SINK-01', displayName: 'Left basin', fixtureType: 'SINK', positionHint: null, sequence: 1, identificationMode: 'ORDERED_CONTEXT', existingNumber: null, status: 'ACTIVE', rubricKey: 'sink', requiredViews: [{ key: 'front', mandatory: true }] }] };
function mount(language = 'en') { localStorage.setItem('hygene-ops.language', language); const submitted = vi.fn(event => event.preventDefault()); render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><LanguageProvider><form onSubmit={submitted}><TemplateInventoryEditor templateId={60} areaId={10} /></form></LanguageProvider></QueryClientProvider>); return submitted; }
beforeEach(() => { vi.resetAllMocks(); localStorage.clear(); m.area.mockResolvedValue(structuredClone(area)); m.map.mockResolvedValue({}); m.invalidate.mockResolvedValue(undefined); });
it('preserves mandatory selection, sends current inventory version and never submits a containing form', async () => {
  const submitted = mount(); await screen.findByText('Future inventory: Saved area'); fireEvent.change(screen.getByLabelText('Required inventory'), { target: { value: 'SUBSET' } });
  expect(screen.getByRole('button', { name: 'Save future inventory' })).toBeDisabled(); expect(screen.getByRole('alert')).toHaveTextContent('Choose at least one mandatory item.');
  fireEvent.click(screen.getByRole('checkbox', { name: 'Include Left basin' })); fireEvent.click(screen.getByRole('button', { name: 'Save future inventory' })); await screen.findByRole('status');
  expect(m.map).toHaveBeenCalledWith(60, { areaId: 10, inventorySelection: 'SUBSET', selectedItems: [{ areaItemId: 11, mandatory: true }], expectedInventoryVersion: 3 }); expect(submitted).not.toHaveBeenCalled();
});
it('409 keeps the draft and requires reviewing fresh inventory before retrying', async () => {
  m.map.mockRejectedValueOnce({ response: { status: 409 } }); mount(); await screen.findByText('Future inventory: Saved area'); fireEvent.click(screen.getByRole('checkbox', { name: 'Mandatory: Left basin' }));
  expect(screen.getByRole('button', { name: 'Save future inventory' })).toBeDisabled(); fireEvent.click(screen.getByRole('checkbox', { name: 'Mandatory: Left basin' })); m.area.mockResolvedValue({ ...area, inventoryVersion: 4 }); fireEvent.click(screen.getByRole('button', { name: 'Save future inventory' }));
  await screen.findByText('The saved inventory changed elsewhere. Review your preserved selection before retrying.'); expect(screen.getByRole('checkbox', { name: 'Mandatory: Left basin' })).toBeChecked(); expect(screen.getByRole('button', { name: 'Save future inventory' })).toBeEnabled();
});
it('pending save disables controls and rejects repeated writes', async () => {
  let finish!: () => void; m.map.mockImplementation(() => new Promise<void>(resolve => { finish = resolve; })); mount(); await screen.findByText('Future inventory: Saved area'); fireEvent.click(screen.getByRole('checkbox', { name: 'Mandatory: Left basin' })); fireEvent.click(screen.getByRole('checkbox', { name: 'Mandatory: Left basin' })); fireEvent.click(screen.getByRole('button', { name: 'Save future inventory' }));
  expect(screen.getByRole('button', { name: 'Saving inventory…' })).toBeDisabled(); expect(screen.getByLabelText('Required inventory')).toBeDisabled(); expect(m.map).toHaveBeenCalledTimes(1); finish(); await screen.findByRole('status');
});
it('reports denied saves as errors in Urdu without exposing transport details', async () => {
  m.map.mockRejectedValue({ response: { status: 403, data: { message: 'private detail' } } }); mount('ur'); await screen.findByText('آئندہ کی فہرست: Saved area'); fireEvent.click(screen.getByRole('checkbox', { name: 'لازمی: Left basin' })); fireEvent.click(screen.getByRole('checkbox', { name: 'لازمی: Left basin' })); fireEvent.click(screen.getByRole('button', { name: 'آئندہ کی فہرست محفوظ کریں' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('اس اقدام کی اجازت نہیں۔'); expect(screen.queryByRole('status')).not.toBeInTheDocument(); expect(screen.queryByText('private detail')).not.toBeInTheDocument();
});
it('preserves edited selection after failed conflict refresh and provides an explicit reload', async () => {
  m.map.mockRejectedValue({ response: { status: 409 } }); mount(); await screen.findByText('Future inventory: Saved area'); fireEvent.click(screen.getByRole('checkbox', { name: 'Mandatory: Left basin' })); fireEvent.click(screen.getByRole('checkbox', { name: 'Mandatory: Left basin' })); m.area.mockRejectedValue(new Error('offline')); fireEvent.click(screen.getByRole('button', { name: 'Save future inventory' }));
  await screen.findByText('Inventory could not refresh. Your draft is preserved. Retry loading areas.'); expect(screen.getByRole('checkbox', { name: 'Mandatory: Left basin' })).toBeChecked(); expect(screen.getByRole('button', { name: 'Save future inventory' })).toBeDisabled(); m.area.mockResolvedValue(area); fireEvent.click(screen.getByRole('button', { name: 'Retry inventory' })); await waitFor(() => expect(screen.getByRole('button', { name: 'Save future inventory' })).toBeEnabled());
});
