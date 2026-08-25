import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConsolePaymentFilters, PlatformPaymentsResponse } from '../api/consoleApi';
import { PaymentsView } from './PaymentsView';

const { query } = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock('../api/consoleQueries', () => ({ useConsolePayments: query }));

const path = '/platform/subscriptions/payments';
const usd = (amount: number) => ({ amount, currency: 'USD' });
const fixture: PlatformPaymentsResponse = {
  summary: {
    weekly: ['09-28', '10-05', '10-12', '10-19', '10-26', '11-02', '11-09', '11-16'].map((day, index) => ({
      week: `2026-${day}`,
      collected: index === 6 ? null : usd(15 * (index + 1)),
    })),
    paid: 3,
    pastDue: 1,
    collected: usd(120),
    count: 2,
  },
  items: [
    {
      id: 'paid', companyId: 7, companyName: 'Test Company', date: '2026-11-17T20:00:00Z',
      invoice: 'INV-7', amount: usd(120), status: 'PAID', paddleUrl: 'https://example.test/payments/paid',
    },
    {
      id: 'past-due', companyId: 8, companyName: 'Other Test Company', date: '2026-11-16T08:00:00Z',
      invoice: null, amount: null, status: 'PAST_DUE', paddleUrl: null,
    },
  ],
  nextCursor: null,
};
const empty: PlatformPaymentsResponse = {
  summary: { ...fixture.summary, paid: 0, pastDue: 0, collected: null, count: 0 },
  items: [],
  nextCursor: null,
};

function LocationText() {
  const { pathname, search } = useLocation();
  return <p>{pathname}{search}</p>;
}

function open(search = '') {
  render(<MemoryRouter initialEntries={[`${path}${search}`]}>
    <PaymentsView />
    <LocationText />
  </MemoryRouter>);
}

beforeEach(() => {
  query.mockReset().mockReturnValue({ data: fixture });
});
afterEach(cleanup);

describe('PaymentsView', () => {
  it('shows the latest week, average, paid share, past-due count and period totals', () => {
    open();
    const weekly = screen.getByRole('region', { name: 'Collected per week' });
    expect(within(weekly).getByRole('img', { name: /to 16 Nov\. Latest \$120/ })).toBeVisible();
    expect(within(weekly).getByText(/^Average \$/)).toBeVisible();
    const outcomes = screen.getByRole('region', { name: 'Payment outcomes' });
    expect(within(outcomes).getByRole('img', { name: 'Paid share: 75%' })).toBeVisible();
    expect(within(outcomes).getByText('3 of 4')).toBeVisible();
    expect(within(outcomes).getByText('Past due')).toBeVisible();
    expect(within(outcomes).getByText('1')).toBeVisible();
    expect(screen.getByText('Collected $120 · 2 payments')).toBeVisible();
    expect(screen.getByRole('link', { name: 'Payments' })).toHaveAttribute('aria-current', 'page');
  });

  it('offers the weekly values as a table with unknown totals identified', () => {
    open();
    fireEvent.click(screen.getByRole('button', { name: 'Table view' }));
    const chartTable = screen.getByRole('table', { name: 'Collected per week' });
    expect(within(chartTable).getByRole('row', { name: '9 Nov Not available' })).toBeVisible();
    expect(within(chartTable).getByRole('row', { name: '16 Nov $120' })).toBeVisible();
  });

  it('reads the URL period and writes period changes while clearing the cursor', () => {
    open('?range=month&cursor=previous');
    expect(query).toHaveBeenLastCalledWith({ range: 'month', cursor: 'previous' });
    fireEvent.click(screen.getByRole('button', { name: 'Last 3 months' }));
    expect(screen.getByText(`${path}?range=three`)).toBeVisible();
    expect(query).toHaveBeenLastCalledWith({ range: 'three', cursor: undefined });
    expect(screen.getByRole('button', { name: 'Last 3 months' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'All' }));
    expect(screen.getByText(`${path}?range=all`)).toBeVisible();
    expect(query).toHaveBeenLastCalledWith({ range: 'all', cursor: undefined });
  });

  it('uses the server cursor to make later payments accessible', () => {
    query.mockImplementation(({ cursor }: ConsolePaymentFilters) =>
      ({ data: cursor ? fixture : { ...fixture, nextCursor: 'next+page' } }));
    open('?range=all');
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
    expect(screen.getByText(`${path}?range=all&cursor=next%2Bpage`)).toBeVisible();
    expect(query).toHaveBeenLastCalledWith({ range: 'all', cursor: 'next+page' });
    fireEvent.click(screen.getByRole('button', { name: 'First page' }));
    expect(screen.getByText(`${path}?range=all`)).toBeVisible();
  });

  it('renders read-only payment rows with company and Paddle navigation', () => {
    open();
    const table = screen.getByRole('table');
    const paid = within(table).getByRole('row', { name: /INV-7/ });
    expect(within(paid).getByText('18 Nov 2026')).toBeVisible();
    expect(within(paid).getByText('Paid')).toBeVisible();
    expect(within(paid).getByRole('link', { name: 'Open in Paddle for Test Company' }))
      .toHaveAttribute('href', fixture.items[0].paddleUrl);
    expect(within(paid).getByRole('link', { name: 'Test Company' })).toHaveAttribute('href', '/platform/companies/7');
    const pastDue = within(table).getByRole('row', { name: /Other Test Company/ });
    expect(within(pastDue).getByText('Past due')).toBeVisible();
    expect(within(pastDue).getAllByText('Not available')).toHaveLength(3);
    expect(screen.queryByRole('button', { name: /refund/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /refund/i })).not.toBeInTheDocument();
    fireEvent.keyDown(paid, { key: 'Enter' });
    expect(screen.getByText('/platform/companies/7')).toBeVisible();
  });

  it('shows a loading status before payments arrive', () => {
    query.mockReturnValue({ isPending: true });
    open();
    expect(screen.getByRole('status')).toHaveTextContent('Loading payments');
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('identifies a new platform and shows unavailable values for empty summaries', () => {
    query.mockReturnValue({ data: empty });
    open();
    expect(screen.getByRole('heading', { name: 'No payments yet' })).toBeVisible();
    expect(screen.getByRole('img', { name: 'Paid share: Not available' })).toBeVisible();
    expect(screen.getByText('Collected Not available · 0 payments')).toBeVisible();
    expect(query).toHaveBeenCalledWith({ range: 'all' });
  });

  it('distinguishes a period with no payments from a new platform', () => {
    query.mockImplementation(({ range }: ConsolePaymentFilters) => ({ data: range === 'all' ? fixture : empty }));
    open('?range=month');
    expect(screen.getByRole('heading', { name: 'No payments in this period' })).toBeVisible();
  });

  it('shows an error and retries the selected period', () => {
    const refetch = vi.fn();
    query.mockReturnValue({ isError: true, refetch });
    open('?range=month');
    expect(screen.getByRole('alert')).toHaveTextContent('Payments could not be loaded.');
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(refetch).toHaveBeenCalledOnce();
  });
});
