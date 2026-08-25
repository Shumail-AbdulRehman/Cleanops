import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getInquiries, getInquiry, saveInquiry, type HandlingStatus, type InquiryDetail } from '../../serviceApi';
import { InquiriesPage } from './InquiriesPage';

vi.mock('../../serviceApi', () => ({
  getInquiries: vi.fn(),
  getInquiry: vi.fn(),
  saveInquiry: vi.fn(),
}));

function makeInquiry(id: string, company: string, status: HandlingStatus, requestedStaff = 30): InquiryDetail {
  return {
    id, company, requestedStaff, requestedLocations: 3, createdAt: '2026-11-12T16:00:00Z',
    contactVerification: 'UNVERIFIED', handling: { status, version: 3, owner: null, updatedAt: null },
    contactName: 'Sales Contact', contactEmail: 'sales@example.test', requirements: 'We need a demo.',
  };
}

const first = makeInquiry('first', 'First Company', 'NEW');
const second = makeInquiry('second', 'Second Company', 'IN_PROGRESS', 210);
const third = makeInquiry('third', 'Third Company', 'CLOSED');
const fixtures = [first, second, third];

function summary({ id, company, requestedStaff, requestedLocations, createdAt, handling, contactVerification }: InquiryDetail) {
  return { id, company, requestedStaff, requestedLocations, createdAt, handling, contactVerification };
}

function CurrentUrl() {
  const { pathname, search } = useLocation();
  return <output aria-label="Current URL">{pathname}{search}</output>;
}

function openPage(url = '/platform/inquiries') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[url]}>
        <CurrentUrl />
        <InquiriesPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const details = () => screen.getByRole('region', { name: 'Inquiry details' });

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: false }));
  vi.mocked(getInquiries).mockResolvedValue({ items: fixtures.map(summary), nextCursor: null });
  vi.mocked(getInquiry).mockImplementation(async id => fixtures.find(inquiry => inquiry.id === id)!);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('InquiriesPage', () => {
  it('counts and filters the list by handling status', async () => {
    openPage();
    const chips = await screen.findByRole('group', { name: 'Inquiry status' });
    const list = screen.getByRole('list', { name: 'Inquiries' });
    expect(within(chips).getByRole('button', { name: /^All\s*3$/ })).toHaveAttribute('aria-pressed', 'true');
    for (const [label, company] of [['New', first.company], ['In progress', second.company], ['Closed', third.company]]) {
      const chip = within(chips).getByRole('button', { name: new RegExp(`^${label}\\s*1$`) });
      fireEvent.click(chip);
      expect(chip).toHaveAttribute('aria-pressed', 'true');
      expect(within(list).getAllByRole('button')).toHaveLength(1);
      expect(within(list).getByRole('button', { name: new RegExp(company) })).toBeVisible();
    }
  });

  it('includes later cursor pages in counts and filters', async () => {
    vi.mocked(getInquiries)
      .mockResolvedValueOnce({ items: [summary(first)], nextCursor: 'next' })
      .mockResolvedValueOnce({ items: [summary(third)], nextCursor: null });
    openPage();
    fireEvent.click(await screen.findByRole('button', { name: /^Closed\s*1$/ }));
    expect(getInquiries).toHaveBeenLastCalledWith({ after: 'next' }, expect.any(AbortSignal));
    expect(within(screen.getByRole('list')).getByRole('button', { name: /Third Company/ })).toBeVisible();
  });

  it('selects in the URL and focuses and scrolls to details on a phone', async () => {
    vi.mocked(window.matchMedia).mockReturnValue({ matches: true } as MediaQueryList);
    openPage('/platform/inquiries?from=overview');
    await screen.findByRole('heading', { name: first.company });
    const scroll = vi.fn();
    details().scrollIntoView = scroll;
    const row = screen.getByRole('button', { name: /Second Company/ });
    fireEvent.click(row);
    expect(screen.getByLabelText('Current URL')).toHaveTextContent('/platform/inquiries?from=overview&inquiry=second');
    expect(row).toHaveAttribute('aria-pressed', 'true');
    expect(details()).toHaveFocus();
    expect(scroll).toHaveBeenCalledWith({ block: 'start' });
    expect(await within(details()).findByRole('heading', { name: second.company })).toBeVisible();
    expect(within(details()).getByText('210')).toBeVisible();
    expect(within(details()).getByText('Above Enterprise limits')).toBeVisible();
  });

  it('opens a linked detail, renders requirements as text and previews only the first line', async () => {
    const line = '<img src="invalid" alt="unexpected markup">';
    vi.mocked(getInquiry).mockImplementation(async id => id === second.id
      ? { ...second, requirements: line + '\nSecond line.' }
      : fixtures.find(inquiry => inquiry.id === id)!);
    openPage('/platform/inquiries?inquiry=second');
    const heading = await screen.findByRole('heading', { name: second.company });
    expect(heading).toBeVisible();
    const detail = within(details());
    expect(detail.getByText(line + ' Second line.')).toBeVisible();
    expect(detail.queryByRole('img')).toBeNull();
    expect(detail.getByRole('link', { name: 'Email' })).toHaveAttribute('href', 'mailto:sales@example.test');
    expect(detail.getByText('sales@example.test')).toBeVisible();
    const row = within(screen.getByRole('button', { name: /Second Company/ }));
    expect(row.getByText(line)).toBeVisible();
    expect(row.queryByText(/Second line/)).toBeNull();
  });

  it('requires a nonblank note and saves the status, ownership, version and note', async () => {
    vi.mocked(saveInquiry).mockResolvedValue({ handling: { ...first.handling, status: 'IN_PROGRESS', version: 4 }, changed: true });
    openPage();
    fireEvent.click(await screen.findByRole('radio', { name: 'In progress' }));
    const save = screen.getByRole('button', { name: 'Save status' });
    expect(save).toBeDisabled();
    fireEvent.change(screen.getByRole('textbox', { name: 'Note' }), { target: { value: '   ' } });
    expect(save).toBeDisabled();
    expect(saveInquiry).not.toHaveBeenCalled();
    fireEvent.change(screen.getByRole('textbox', { name: 'Note' }), { target: { value: '  Demo booked.  ' } });
    fireEvent.click(save);
    await waitFor(() => expect(saveInquiry).toHaveBeenCalledWith(first.id, {
      status: 'IN_PROGRESS', ownership: 'SELF', expectedVersion: 3, reason: 'Demo booked.',
    }));
    expect(await screen.findByText('Inquiry updated.')).toBeVisible();
    expect(screen.getByRole('button', { name: /^In progress\s*2$/ })).toBeVisible();
    expect(screen.getByRole('textbox', { name: 'Note' })).toHaveValue('');
  });

  it('reports a version conflict and lets the operator reload the latest status', async () => {
    vi.mocked(saveInquiry).mockRejectedValue(Object.assign(new Error('Conflict'), { status: 409 }));
    openPage();
    fireEvent.click(await screen.findByRole('radio', { name: 'In progress' }));
    const note = screen.getByRole('textbox', { name: 'Note' });
    fireEvent.change(note, { target: { value: 'Followed up.' } });
    const save = screen.getByRole('button', { name: 'Save status' });
    fireEvent.click(save);
    expect(await screen.findByRole('alert')).toHaveTextContent('This inquiry changed. Reload it before saving again.');
    expect(save).toBeDisabled();
    vi.mocked(getInquiry).mockRejectedValueOnce(new Error('Unavailable'));
    fireEvent.click(screen.getByRole('button', { name: 'Reload inquiry' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Could not reload the inquiry. Try again.'));
    expect(note).toHaveValue('Followed up.');
    expect(save).toBeDisabled();
    const handling = { ...first.handling, status: 'CLOSED' as const, version: 4 };
    vi.mocked(getInquiry).mockResolvedValueOnce({ ...first, handling });
    fireEvent.click(screen.getByRole('button', { name: 'Reload inquiry' }));
    await waitFor(() => expect(screen.getByRole('radio', { name: 'Closed' })).toBeChecked());
    expect(note).toHaveValue('Followed up.');
    expect(screen.queryByRole('alert')).toBeNull();
    fireEvent.click(save);
    await waitFor(() => expect(saveInquiry).toHaveBeenLastCalledWith(first.id, {
      status: 'CLOSED', ownership: 'SELF', expectedVersion: 4, reason: 'Followed up.',
    }));
    expect(await screen.findByRole('alert')).toBeVisible();
  });

  it('shows a loading state while the list is pending', () => {
    vi.mocked(getInquiries).mockImplementation(() => new Promise(() => {}));
    openPage();
    expect(screen.getByText('Loading inquiries…')).toBeVisible();
    expect(getInquiry).not.toHaveBeenCalled();
  });

  it('shows an empty state for a new platform', async () => {
    vi.mocked(getInquiries).mockResolvedValue({ items: [], nextCursor: null });
    openPage();
    expect(await screen.findByText('No inquiries yet.')).toBeVisible();
    expect(getInquiry).not.toHaveBeenCalled();
  });

  it('shows a list error and retries the failed read', async () => {
    vi.mocked(getInquiries).mockRejectedValueOnce(new Error('Unavailable'));
    openPage();
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load inquiries.');
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByRole('heading', { name: first.company })).toBeVisible();
  });
});
