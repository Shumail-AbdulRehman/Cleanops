import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { LanguageProvider } from '@/i18n/LanguageProvider';
import LocationFormDialog from './LocationFormDialog';

const m = vi.hoisted(() => ({ create: vi.fn(), update: vi.fn(), position: vi.fn(), error: undefined as unknown }));
vi.mock('./queries', () => ({
  useCreateLocation: () => ({ mutateAsync: m.create, error: m.error, isError: !!m.error }),
  useUpdateLocation: () => ({ mutateAsync: m.update, error: m.error, isError: !!m.error }),
}));
vi.mock('./currentPosition', () => ({ getPreciseCurrentPosition: m.position }));
vi.mock('./LocationMapPicker', () => ({
  default: ({ latitude, longitude, radius, disabled, onSelect }: {
    latitude: string; longitude: string; radius: number; disabled: boolean;
    onSelect(position: { lat: number; lng: number }, address?: string, name?: string): void;
  }) => <section aria-label="Synthetic map">
    <output aria-label="Map radius">{radius}</output>
    <output aria-label="Map point">{latitude}, {longitude}</output>
    <button type="button" disabled={disabled} onClick={() => onSelect({ lat: 32.1234567, lng: 73.9876543 }, 'Saved search address', 'Saved place name')}>Select synthetic place</button>
    <button type="button" disabled={disabled} onClick={() => onSelect({ lat: 31.25, lng: 74.125 })}>Move synthetic pin</button>
  </section>,
}));
const site = { id: 22, name: 'Saved site', address: 'Saved street', latitude: '31', longitude: '74', timezone: 'Asia/Karachi', radiusMeters: 150 };
function mount(location?: typeof site) {
  const changed = vi.fn(), saved = vi.fn();
  render(<LanguageProvider><LocationFormDialog open onOpenChange={changed} onSaved={saved} location={location} /></LanguageProvider>);
  return { changed, saved };
}
function coordinates() { fireEvent.click(screen.getByText('Coordinates & timezone')); }
function field(label: string, value: string) { fireEvent.change(screen.getByLabelText(label), { target: { value } }); }
function fill() {
  field('Location name', 'Synthetic saved site'); field('Street address', 'Synthetic address');
  coordinates(); field('Latitude', '31'); field('Longitude', '74');
}
function save() { fireEvent.click(screen.getByRole('button', { name: 'Create location' })); }
beforeEach(() => {
  vi.resetAllMocks(); m.error = undefined; localStorage.clear();
  Object.defineProperty(navigator, 'geolocation', { configurable: true, value: {} });
});
it('protects a pending location save from duplicate submit and Escape dismissal', async () => {
  let finish!: () => void;
  m.create.mockImplementation(() => new Promise<void>(resolve => { finish = resolve; }));
  const { changed, saved } = mount(); fill();
  // The sticky footer submits its associated form, outside the scroll body.
  const form = (screen.getByRole('button', { name: 'Create location' }) as HTMLButtonElement).form!;
  fireEvent.submit(form); await waitFor(() => expect(m.create).toHaveBeenCalledTimes(1));
  fireEvent.submit(form); fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
  fireEvent.click(screen.getByRole('button', { name: 'Close' }));
  expect(changed).not.toHaveBeenCalled(); expect(screen.getByRole('button', { name: 'Saving...' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
  finish(); await waitFor(() => expect(saved).toHaveBeenCalledTimes(1)); expect(m.create).toHaveBeenCalledTimes(1);
});
it('keeps an unknown create outcome explicit and prevents a duplicate retry', async () => {
  m.create.mockRejectedValue(new Error('private transport')); mount(); fill(); save();
  await screen.findByText('Location creation could not be confirmed. Close and check the location list before creating again.');
  expect(screen.getByRole('button', { name: 'Create location' })).toBeDisabled();
  expect(screen.getByLabelText('Location name')).toHaveValue('Synthetic saved site'); expect(screen.queryByText('private transport')).not.toBeInTheDocument();
});
it('has a labelled dialog, a collapsed coordinates disclosure and a linked footer', () => {
  mount(); expect(screen.getByRole('dialog', { name: 'Add location' })).toHaveAccessibleDescription('Find your site and set where your team can check in.');
  expect(screen.getByLabelText('Latitude')).not.toBeVisible();
  expect((screen.getByRole('button', { name: 'Create location' }) as HTMLButtonElement).form).toBeTruthy();
  expect(screen.getByLabelText('Attendance radius')).toHaveValue(500);
});
it('shows required field errors, opens coordinates and focuses the first invalid field', async () => {
  mount(); save();
  expect(await screen.findByText('Name is required')).toBeVisible(); expect(screen.getByText('Address is required')).toBeVisible();
  expect(screen.getAllByText('Choose a location on the map or enter coordinates')).toHaveLength(2);
  expect(screen.getByLabelText('Location name')).toHaveFocus(); expect(screen.getByLabelText('Latitude')).toBeVisible();
  for (const label of ['Location name', 'Street address', 'Latitude', 'Longitude']) expect(screen.getByLabelText(label)).toHaveAttribute('aria-invalid', 'true');
  expect(m.create).not.toHaveBeenCalled();
});
it.each(['Location name', 'Street address'])('rejects whitespace in %s', async label => {
  mount(); fill(); field(label, '   '); save();
  await screen.findByText(label === 'Location name' ? 'Name is required' : 'Address is required'); expect(m.create).not.toHaveBeenCalled();
});
it.each([['Location name', 201, 'Name must be 200 characters or fewer.'], ['Street address', 1001, 'Address must be 1,000 characters or fewer.']] as const)('retains the length limit for %s', async (label, length, message) => {
  mount(); fill(); field(label, 'x'.repeat(length)); save(); await screen.findByText(message); expect(m.create).not.toHaveBeenCalled();
});
it.each([['Latitude', '91'], ['Latitude', '-91'], ['Longitude', '181'], ['Longitude', '-181']])('rejects out-of-range %s %s', async (label, value) => {
  mount(); fill(); field(label, value); save(); expect(await screen.findByText('Enter valid coordinates')).toBeVisible(); expect(m.create).not.toHaveBeenCalled();
});
it.each(['24', '5001', '25.5'])('rejects radius %s and describes its error', async value => {
  mount(); fill(); field('Attendance radius', value); save();
  const message = value === '25.5' ? 'Use a whole number of metres' : 'Choose a radius between 25 and 5,000 m';
  expect(await screen.findByText(message)).toBeVisible(); expect(screen.getByLabelText('Attendance radius')).toHaveAccessibleDescription(expect.stringContaining(message)); expect(m.create).not.toHaveBeenCalled();
});
it.each([50, 100, 250, 500])('selects the %i metre preset, forwards it to the map and saves it', async radius => {
  m.create.mockResolvedValue({}); const { saved } = mount(); fill();
  const presets = screen.getByRole('group', { name: 'Suggested attendance radii' });
  fireEvent.click(within(presets).getByRole('button', { name: `${radius} m` }));
  expect(within(presets).getByRole('button', { name: `${radius} m` })).toHaveAttribute('aria-pressed', 'true');
  expect(screen.getByLabelText('Attendance radius')).toHaveValue(radius); expect(screen.getByLabelText('Map radius')).toHaveTextContent(String(radius));
  save(); await waitFor(() => expect(saved).toHaveBeenCalledOnce());
  expect(m.create).toHaveBeenCalledWith({ name: 'Synthetic saved site', address: 'Synthetic address', latitude: '31', longitude: '74', timezone: undefined, radiusMeters: radius });
});
it.each([25, 5000])('keeps the custom radius boundary %i', async radius => {
  m.create.mockResolvedValue({}); mount(); fill(); field('Attendance radius', String(radius)); save();
  await waitFor(() => expect(m.create).toHaveBeenCalledWith(expect.objectContaining({ radiusMeters: radius })));
});
it('keeps saved edit values including a custom radius and sends the exact update payload', async () => {
  m.update.mockResolvedValue({}); const { saved } = mount(site);
  expect(screen.getByRole('dialog', { name: 'Edit location' })).toBeVisible(); expect(screen.getByLabelText('Location name')).toHaveValue(site.name);
  expect(screen.getByLabelText('Attendance radius')).toHaveValue(150); coordinates(); expect(screen.getByLabelText('Timezone')).toHaveValue('Asia/Karachi');
  fireEvent.click(screen.getByRole('button', { name: 'Save changes' })); await waitFor(() => expect(saved).toHaveBeenCalledOnce());
  const { id, ...data } = site; expect(m.update).toHaveBeenCalledWith({ id, data }); expect(m.create).not.toHaveBeenCalled();
});
it('autofills a searched address/name and resets timezone after moving the pin', async () => {
  m.create.mockResolvedValue({}); mount(); fireEvent.click(screen.getByRole('button', { name: 'Select synthetic place' }));
  expect(screen.getByLabelText('Location name')).toHaveValue('Saved place name'); expect(screen.getByLabelText('Street address')).toHaveValue('Saved search address');
  coordinates(); expect(screen.getByLabelText('Latitude')).toHaveValue(32.123457); expect(screen.getByLabelText('Longitude')).toHaveValue(73.987654);
  field('Timezone', 'Asia/Karachi'); fireEvent.click(screen.getByRole('button', { name: 'Move synthetic pin' }));
  expect(screen.getByLabelText('Timezone')).toHaveValue(''); expect(screen.getByText('Pin updated. Check the address before saving.')).toBeVisible();
  save(); await waitFor(() => expect(m.create).toHaveBeenCalledWith(expect.objectContaining({ timezone: undefined, latitude: '31.250000', longitude: '74.125000' })));
});
it('retains an existing name when selecting a new place', () => {
  mount(site); fireEvent.click(screen.getByRole('button', { name: 'Select synthetic place' }));
  expect(screen.getByLabelText('Location name')).toHaveValue('Saved site'); expect(screen.getByLabelText('Street address')).toHaveValue('Saved search address');
});
it('manual coordinate changes reset timezone to auto-detect', () => {
  mount(site); coordinates(); field('Latitude', '30'); expect(screen.getByLabelText('Timezone')).toHaveValue('');
});
it('uses precise device position and reports accuracy without inventing an address', async () => {
  m.position.mockResolvedValue({ coords: { latitude: 31.5, longitude: 74.3, accuracy: 18.2 } }); mount();
  fireEvent.click(screen.getByRole('button', { name: 'Use my position' }));
  expect(await screen.findByText('Device position selected. Accuracy: 18 m. Check the pin and address.')).toBeVisible();
  expect(screen.getByLabelText('Map point')).toHaveTextContent('31.500000, 74.300000'); expect(screen.getByLabelText('Street address')).toHaveValue('');
});
it('keeps geolocation failures visible and leaves the saved point unchanged', async () => {
  const message = "Location permission was denied. Allow location access in your browser, or enter the site's coordinates manually.";
  m.position.mockRejectedValue(new Error(message)); mount(site); fireEvent.click(screen.getByRole('button', { name: 'Use my position' }));
  expect(await screen.findByRole('alert')).toHaveTextContent(message); expect(screen.getByLabelText('Map point')).toHaveTextContent('31, 74');
});
it('aborts a pending device reading on close', async () => {
  let signal!: AbortSignal; m.position.mockImplementation((_geo, next) => { signal = next; return new Promise(() => {}); });
  const { unmount } = render(<LanguageProvider><LocationFormDialog open onOpenChange={vi.fn()} onSaved={vi.fn()} /></LanguageProvider>);
  fireEvent.click(screen.getByRole('button', { name: 'Use my position' })); await screen.findByRole('button', { name: 'Locating...' }); unmount(); expect(signal.aborted).toBe(true);
});
it.each([
  ['CAPACITY_REACHED', 'Your plan’s location capacity has been reached. Review Plan & billing. Your draft is kept.'],
  ['SUBSCRIPTION_REQUIRED', 'An active subscription is required to add locations. Review Plan & billing. Your draft is kept.'],
])('retains the draft and server %s failure', (_code, message) => {
  m.error = { response: { status: 409, data: { errors: [{ code: _code }] } } }; mount(site);
  expect(screen.getByRole('alert')).toHaveTextContent(message); expect(screen.getByLabelText('Location name')).toHaveValue(site.name);
});
it('keeps edit retry available after a transport failure', async () => {
  m.update.mockRejectedValueOnce(new Error('private transport')).mockResolvedValueOnce({}); const { saved } = mount(site);
  fireEvent.click(screen.getByRole('button', { name: 'Save changes' })); await waitFor(() => expect(m.update).toHaveBeenCalledOnce());
  await waitFor(() => expect(screen.getByRole('button', { name: 'Save changes' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: 'Save changes' })); await waitFor(() => expect(saved).toHaveBeenCalledOnce());
});
it('returns focus to the opener and can reopen the controlled panel', async () => {
  function Harness() { const [open, setOpen] = useState(false); return <><button onClick={() => setOpen(true)}>Open editor</button><LocationFormDialog open={open} onOpenChange={setOpen} onSaved={vi.fn()} /></>; }
  render(<LanguageProvider><Harness /></LanguageProvider>); const opener = screen.getByRole('button', { name: 'Open editor' }); opener.focus(); fireEvent.click(opener);
  await screen.findByRole('dialog'); fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument()); expect(opener).toHaveFocus();
  fireEvent.click(opener); expect(await screen.findByRole('dialog', { name: 'Add location' })).toBeVisible();
});
it.each(['Cancel', 'Close'])('dismisses through %s when idle', button => {
  const { changed } = mount(); fireEvent.click(screen.getByRole('button', { name: button })); expect(changed).toHaveBeenCalledWith(false);
});
it('preserves the external Google Maps interaction exemption', () => {
  mount(); const map = document.createElement('div'); map.className = 'gm-style'; document.body.append(map);
  const event = new CustomEvent('dismissableLayer.pointerDownOutside', { cancelable: true });
  act(() => { map.dispatchEvent(event); }); expect(event.defaultPrevented).toBe(true); map.remove();
});
it('mirrors the Urdu dialog and preserves saved record values', () => {
  localStorage.setItem('hygene-ops.language', 'ur'); mount(site);
  const dialog = screen.getByRole('dialog'); expect(dialog).toHaveAttribute('dir', 'rtl'); expect(dialog).toHaveAccessibleName('مقام میں ترمیم');
  expect(screen.getByDisplayValue('Saved site')).toBeVisible(); expect(screen.getByDisplayValue('Saved street')).toBeVisible();
});
