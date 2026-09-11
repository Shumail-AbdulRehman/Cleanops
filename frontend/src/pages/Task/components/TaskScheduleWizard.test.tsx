import { beforeEach, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { LanguageProvider } from '@/i18n/LanguageProvider';
import { WorkspaceTheme } from '@/components/common/WorkspaceTheme';
import type { Area } from '@/pages/Area/types';
import TaskScheduleWizard from './TaskScheduleWizard';
const m = vi.hoisted(() => ({ areas: vi.fn(), create: vi.fn(), assign: vi.fn(), get: vi.fn(), invalidate: vi.fn() }));
vi.mock('@/pages/Area/api', () => ({ getAreas: m.areas, getArea: vi.fn(), getMappingTemplates: vi.fn() }));
vi.mock('@/pages/Task/api', () => ({ createTaskTemplate: m.create, getTaskTemplate: m.get }));
vi.mock('@/pages/Assignment/api', () => ({ assignStaffToTaskTemplate: m.assign }));
vi.mock('@/lib/invalidateWorkspace', () => ({ invalidateWorkspace: m.invalidate }));
const area: Area = { id: 10, locationId: 20, name: 'Saved washroom', roomType: 'WASHROOM', status: 'ACTIVE', inventoryVersion: 3, qrVersion: 1, layoutInstructions: null, items: [{ id: 11, areaId: 10, stableCode: 'SINK-01', displayName: 'Left basin', fixtureType: 'SINK', positionHint: 'By the door', sequence: 1, identificationMode: 'ORDERED_CONTEXT', existingNumber: null, status: 'ACTIVE', rubricKey: 'sink', requiredViews: [{ key: 'front', mandatory: true }] }] };
function mount(language = 'en', zone = 'Asia/Karachi') {
  localStorage.setItem('hygene-ops.language', language);
  const changed = vi.fn(), created = vi.fn();
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><LanguageProvider><WorkspaceTheme.Provider value><MemoryRouter><TaskScheduleWizard locationId={20} locationName="Saved site" timeZone={zone} staffOptions={[{ id: 7, name: 'Saved worker', email: 'fixture@example.invalid', shiftStart: '08:00', shiftEnd: '16:00', isActive: true }]} open onOpenChange={changed} onCreated={created} /></MemoryRouter></WorkspaceTheme.Provider></LanguageProvider></QueryClientProvider>);
  return { changed, created };
}
async function task() {
  await screen.findByRole('option', { name: 'Saved washroom' });
  fireEvent.change(screen.getByLabelText('Task title'), { target: { value: 'Clean saved room' } });
  fireEvent.change(screen.getByLabelText('Area template'), { target: { value: '10' } });
}
async function review() {
  await task(); fireEvent.click(screen.getByRole('button', { name: 'Next' }));
  fireEvent.change(screen.getByLabelText('Assign staff'), { target: { value: '7' } }); fireEvent.click(screen.getByRole('button', { name: 'Next' }));
  fireEvent.change(screen.getByLabelText('Recurrence'), { target: { value: 'ONCE' } });
  fireEvent.change(screen.getByLabelText('Start time (Asia/Karachi)'), { target: { value: '09:00' } });
  fireEvent.change(screen.getByLabelText('End time (Asia/Karachi)'), { target: { value: '10:00' } });
  fireEvent.click(screen.getByRole('button', { name: 'Next' }));
}
beforeEach(() => { vi.resetAllMocks(); localStorage.clear(); m.areas.mockResolvedValue(structuredClone([area])); m.create.mockResolvedValue({ data: { id: 60 } }); m.invalidate.mockResolvedValue(undefined); });
it('keeps title, mandatory selection and date validation explicit before any write', async () => {
  mount(); await screen.findByRole('option', { name: 'Saved washroom' }); fireEvent.click(screen.getByRole('button', { name: 'Next' }));
  expect(screen.getByRole('alert')).toHaveTextContent('Add a task title.'); expect(screen.getByLabelText('Task title')).toHaveAttribute('aria-describedby', 'schedule-error');
  await task(); fireEvent.change(screen.getByLabelText('Required inventory'), { target: { value: 'SUBSET' } }); fireEvent.click(screen.getByRole('button', { name: 'Next' }));
  expect(screen.getByRole('alert')).toHaveTextContent('Choose at least one mandatory item.');
  fireEvent.click(screen.getByRole('checkbox', { name: 'Include Left basin' })); fireEvent.click(screen.getByRole('button', { name: 'Next' })); fireEvent.click(screen.getByRole('button', { name: 'Next' })); fireEvent.click(screen.getByRole('button', { name: 'Next' }));
  expect(screen.getByRole('alert')).toHaveTextContent('Choose a date, start time, and end time.'); expect(m.create).not.toHaveBeenCalled();
});
it('saves the reviewed ONCE contract with the exact site worker area inventory and wall times', async () => {
  const { created } = mount(); await review();
  expect(screen.getByText(/1 mandatory fixtures, 0 optional fixtures, 1 required photos/)).toBeInTheDocument();
  expect(screen.getByText(/A task QR is available only after an occurrence exists/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Create schedule' })); await waitFor(() => expect(created).toHaveBeenCalledWith({ templateId: 60, assignment: 'manual' }));
  const payload = m.create.mock.calls[0][0]; expect(payload).toMatchObject({ title: 'Clean saved room', locationId: 20, staffId: 7, areaId: 10, recurringType: 'ONCE', inventorySelection: 'ALL', expectedInventoryVersion: 3 });
  expect(payload.shiftStart.toISOString().slice(11, 16)).toBe('04:00'); expect(payload.shiftEnd.toISOString().slice(11, 16)).toBe('05:00'); expect(payload.recurringEndDate).toBeUndefined(); expect(m.assign).not.toHaveBeenCalled();
});
it('pending save blocks repeated creation and dismissal until the receipt arrives', async () => {
  let finish!: (value: unknown) => void; m.create.mockImplementation(() => new Promise(resolve => { finish = resolve; })); const { changed, created } = mount(); await review();
  fireEvent.click(screen.getByRole('button', { name: 'Create schedule' })); const busy = screen.getByRole('button', { name: 'Creating…' }); expect(busy).toBeDisabled(); fireEvent.click(busy); fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
  expect(changed).not.toHaveBeenCalled(); expect(m.create).toHaveBeenCalledTimes(1); finish({ data: { id: 61 } }); await waitFor(() => expect(created).toHaveBeenCalledTimes(1));
});
it('a lost create response gives an uncertain outcome without automatic duplicate retry or raw errors', async () => {
  m.create.mockRejectedValue(new Error('private transport detail')); const { changed, created } = mount(); await review(); fireEvent.click(screen.getByRole('button', { name: 'Create schedule' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Creation could not be confirmed.'); expect(screen.queryByText('private transport detail')).not.toBeInTheDocument(); expect(screen.queryByRole('button', { name: 'Create schedule' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Close and check schedule list' })); expect(changed).toHaveBeenCalledWith(false); expect(created).not.toHaveBeenCalled(); expect(m.create).toHaveBeenCalledTimes(1);
});
it('409 refresh preserves the draft and uses the current inventory version on deliberate retry', async () => {
  m.create.mockRejectedValueOnce({ response: { status: 409, data: { message: 'Inventory changed' } } }).mockResolvedValueOnce({ data: { id: 62 } }); const { created } = mount(); await review();
  m.areas.mockResolvedValue([{ ...area, inventoryVersion: 4 }]); fireEvent.click(screen.getByRole('button', { name: 'Create schedule' })); await screen.findByText('Inventory refreshed. Review the selected fixtures before retrying. Your draft is preserved.');
  expect(screen.getByLabelText('Task title')).toHaveValue('Clean saved room'); expect(screen.getByLabelText('Area template')).toHaveValue('10');
  fireEvent.click(screen.getByRole('button', { name: 'Next' })); fireEvent.click(screen.getByRole('button', { name: 'Next' })); fireEvent.click(screen.getByRole('button', { name: 'Next' })); fireEvent.click(screen.getByRole('button', { name: 'Create schedule' }));
  await waitFor(() => expect(created).toHaveBeenCalledTimes(1)); expect(m.create.mock.calls[1][0].expectedInventoryVersion).toBe(4);
});
it('failed inventory reads are distinct from empty data and block continuing until retry', async () => {
  m.areas.mockRejectedValueOnce(new Error('private provider detail')); mount(); await screen.findByText('Area inventory could not load. Retry before continuing.'); expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();
  expect(screen.queryByText('Set up and activate an area first.')).not.toBeInTheDocument(); m.areas.mockResolvedValue([area]); fireEvent.click(screen.getByRole('button', { name: 'Retry loading areas' })); await screen.findByRole('option', { name: 'Saved washroom' }); expect(screen.getByRole('button', { name: 'Next' })).toBeEnabled();
});
it('Urdu translates labels, mandatory controls and validation while preserving saved names', async () => {
  mount('ur'); await screen.findByRole('option', { name: 'Saved washroom' }); expect(screen.getByRole('dialog', { name: 'صفائی کا شیڈول بنائیں' })).toBeInTheDocument(); fireEvent.click(screen.getByRole('button', { name: 'اگلا' })); expect(screen.getByRole('alert')).toHaveTextContent('کام کا عنوان لکھیں۔');
  fireEvent.change(screen.getByLabelText('کام کا عنوان'), { target: { value: 'User entered text' } }); fireEvent.change(screen.getByLabelText('علاقے کا سانچہ'), { target: { value: '10' } }); expect(screen.getByRole('checkbox', { name: 'لازمی: Left basin' })).toBeInTheDocument(); expect(document.documentElement.dir).toBe('rtl');
});
