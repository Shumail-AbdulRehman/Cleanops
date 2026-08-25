import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getInquiries, type Inquiry } from '../../serviceApi';
import { OverviewAttention, type OverviewAttentionProps } from './OverviewAttention';

vi.mock('../../serviceApi', () => ({ getInquiries: vi.fn() }));

const date = '2026-11-10T20:00:00Z';
const running: OverviewAttentionProps = {
  attention: {
    items: [
      { companyId: 1, name: 'Alder Services', kind: 'PAST_DUE', plan: 'STARTER', date },
      { companyId: 2, name: 'Birch Cleaning', kind: 'SUSPENDED', plan: 'PRO', date: null },
      { companyId: 3, name: 'Cedar Partners', kind: 'SCHEDULED_CANCEL', plan: 'ADVANCED', date },
    ],
    mrrAtRisk: { amount: 72.25, currency: 'USD' },
  },
  upgrades: ['Elm', 'Maple', 'Oak', 'Willow'].map((name, index) => ({
    companyId: index + 10, name, plan: 'PRO', staff: 23 + index, staffLimit: 25,
  })),
};

function inquiry(id: string, company: string, status: Inquiry['handling']['status']): Inquiry {
  return {
    id, company, requestedLocations: 12, requestedStaff: 90, createdAt: date,
    contactVerification: 'UNVERIFIED',
    handling: { version: 0, status, owner: null, updatedAt: null },
  };
}

function renderAttention(props = running) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter><OverviewAttention {...props} /></MemoryRouter>
    </QueryClientProvider>,
  );
}

function panel(name: string) {
  return within(screen.getByRole('region', { name }));
}

beforeEach(() => {
  vi.mocked(getInquiries).mockReset().mockResolvedValue({ items: [], nextCursor: null });
});

describe('OverviewAttention', () => {
  it('shows each reason, its date or unavailable fallback, and monthly revenue at risk', async () => {
    renderAttention();
    const attention = panel('Needs attention');
    expect(attention.getByText('Payment past due · Starter · Nov 11, 2026')).toBeVisible();
    expect(attention.getByText('Account suspended · Pro · Not available')).toBeVisible();
    expect(attention.getByText('Scheduled to cancel · Enterprise · Nov 11, 2026')).toBeVisible();
    expect(attention.getByRole('link', { name: 'Open Alder Services' })).toHaveAttribute('href', '/platform/companies/1');
    expect(attention.getByRole('link', { name: 'Open Birch Cleaning' })).toHaveAttribute('href', '/platform/companies/2');
    expect(attention.getByRole('link', { name: 'Open Cedar Partners' })).toHaveAttribute('href', '/platform/companies/3');
    expect(attention.getByText('Monthly revenue at risk')).toBeVisible();
    expect(attention.getByText('$72.25')).toBeVisible();
    await screen.findByText('No new inquiries are waiting for a reply.');
  });

  it('shows only new inquiries from the first page and links to reply and all inquiries', async () => {
    vi.mocked(getInquiries).mockResolvedValue({
      items: [
        inquiry('new & 1', 'Pine Operations', 'NEW'),
        inquiry('working', 'Cypress Services', 'IN_PROGRESS'),
        inquiry('closed', 'Spruce Cleaning', 'CLOSED'),
      ],
      nextCursor: 'next-page',
    });

    renderAttention();
    const inquiries = panel('Enterprise inquiries');
    expect(await inquiries.findByRole('link', { name: 'Reply to Pine Operations' }))
      .toHaveAttribute('href', '/platform/inquiries?inquiry=new+%26+1');
    expect(inquiries.getByText('12 locations · 90 staff · Nov 11, 2026')).toBeVisible();
    expect(inquiries.queryByText('Cypress Services')).not.toBeInTheDocument();
    expect(inquiries.queryByText('Spruce Cleaning')).not.toBeInTheDocument();
    expect(inquiries.getByRole('link', { name: 'All inquiries' })).toHaveAttribute('href', '/platform/inquiries');
    expect(getInquiries).toHaveBeenCalledExactlyOnceWith({}, expect.any(AbortSignal));
  });

  it('shows the first three companies near their limit and a link for the rest', async () => {
    renderAttention();
    const upgrades = panel('Close to plan limit');
    expect(upgrades.getAllByRole('listitem')).toHaveLength(3);
    expect(upgrades.getByText('23 of 25 staff on Pro')).toBeVisible();
    expect(upgrades.getByRole('link', { name: 'Open Elm' })).toHaveAttribute('href', '/platform/companies/10');
    expect(upgrades.getByRole('link', { name: 'Open Oak' })).toHaveAttribute('href', '/platform/companies/12');
    expect(upgrades.queryByText('Willow')).not.toBeInTheDocument();
    expect(upgrades.getByRole('link', { name: '1 more in Companies' })).toHaveAttribute('href', '/platform/companies');
    await screen.findByText('No new inquiries are waiting for a reply.');
  });

  it('shows an empty message in each panel and preserves unavailable revenue', async () => {
    renderAttention({ attention: { items: [], mrrAtRisk: null }, upgrades: [] });
    const attention = panel('Needs attention');
    expect(attention.getByText('No companies need attention right now.')).toBeVisible();
    expect(attention.getByText('Not available')).toBeVisible();
    expect(await panel('Enterprise inquiries').findByText('No new inquiries are waiting for a reply.')).toBeVisible();
    expect(panel('Close to plan limit').getByText('No companies are close to their staff limit.')).toBeVisible();
  });

  it('shows inquiry loading and failure, then retries on request', async () => {
    vi.mocked(getInquiries).mockRejectedValueOnce(new Error('Unavailable'));
    renderAttention();
    const inquiries = panel('Enterprise inquiries');
    expect(inquiries.getByRole('status')).toHaveTextContent('Loading inquiries…');
    expect(await inquiries.findByRole('alert')).toHaveTextContent('Unable to load inquiries.');
    expect(inquiries.queryByText('No new inquiries are waiting for a reply.')).not.toBeInTheDocument();
    fireEvent.click(inquiries.getByRole('button', { name: 'Retry' }));
    expect(await inquiries.findByText('No new inquiries are waiting for a reply.')).toBeVisible();
    expect(getInquiries).toHaveBeenCalledTimes(2);
  });
});
