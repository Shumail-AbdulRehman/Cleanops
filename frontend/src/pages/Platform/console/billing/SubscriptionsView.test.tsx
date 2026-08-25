import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  ConsoleCompanyFilters,
  ConsoleSubscriptionFilters,
  PlatformCompaniesResponse,
  PlatformSubscriptionsResponse,
} from '../api/consoleApi';
import { BillingTabs } from './BillingTabs';
import { SubscriptionsView } from './SubscriptionsView';

const { useConsoleCompanies, useConsoleSubscriptions, refetch } = vi.hoisted(() => ({
  useConsoleCompanies: vi.fn<(filters: ConsoleCompanyFilters) => {
    data?: {
      items: Pick<PlatformCompaniesResponse['items'][number], 'id' | 'monthly'>[];
      nextCursor: string | null;
    };
    isPending?: boolean;
    isError?: boolean;
  }>(),
  useConsoleSubscriptions: vi.fn<(filters: ConsoleSubscriptionFilters) => {
    data?: PlatformSubscriptionsResponse;
    isPending?: boolean;
    isError?: boolean;
    refetch: () => Promise<void>;
  }>(),
  refetch: vi.fn(async () => {}),
}));

vi.mock('../api/consoleQueries', () => ({ useConsoleCompanies, useConsoleSubscriptions }));

const usd = (amount: number) => ({ amount, currency: 'USD' });
const subscription: PlatformSubscriptionsResponse['items'][number] = {
  companyId: 52,
  name: 'Example Facilities',
  owner: { name: 'Account Owner', email: 'owner@example.test' },
  plan: 'PRO',
  interval: 'year',
  amount: usd(480),
  status: 'ACTIVE',
  renewsOrEndsAt: '2026-11-29T22:00:00Z',
  paddleUrl: 'https://example.test/subscriptions/sub_52',
};
const response: PlatformSubscriptionsResponse = {
  summary: {
    mrrByPlan: [
      { plan: 'STARTER', mrr: usd(30) },
      { plan: 'PRO', mrr: usd(120) },
      { plan: 'ADVANCED', mrr: null },
    ],
    averagePerPaying: usd(50),
    renewals: [
      { week: '2026-11-23', count: 2, amount: usd(80) },
      { week: '2026-11-30', count: 4, amount: usd(160) },
      { week: '2026-12-07', count: 0, amount: usd(0) },
      { week: '2026-12-14', count: 1, amount: null },
    ],
    endingSoon: [{ companyId: 18, name: 'Example Janitorial', renewsOrEndsAt: '2026-12-02' }],
    cancelled: 3,
  },
  statusCounts: { ACTIVE: 7, PAST_DUE: 1, SCHEDULED_CANCEL: 1, CANCELLED: 3, NONE: 0 },
  items: [subscription],
  nextCursor: null,
};

function LocationReadout() {
  const { pathname, search } = useLocation();
  return <output aria-label="Current address">{pathname}{search}</output>;
}

function renderView(search = '') {
  return render(
    <MemoryRouter initialEntries={[`/platform/subscriptions${search}`]}>
      <SubscriptionsView />
      <LocationReadout />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  useConsoleCompanies.mockReturnValue({ data: { items: [{ id: 18, monthly: usd(45) }], nextCursor: null } });
  useConsoleSubscriptions.mockReturnValue({ data: response, refetch });
});

describe('billing tabs', () => {
  it.each([
    ['/platform/subscriptions?status=ACTIVE', 'Subscriptions', 'Payments'],
    ['/platform/subscriptions/payments', 'Payments', 'Subscriptions'],
  ])('marks the current route at %s', (path, current, other) => {
    render(<MemoryRouter initialEntries={[path]}><BillingTabs /></MemoryRouter>);
    const tabs = within(screen.getByRole('navigation', { name: 'Billing' }));
    expect(tabs.getByRole('link', { name: current })).toHaveAttribute('aria-current', 'page');
    expect(tabs.getByRole('link', { name: other })).not.toHaveAttribute('aria-current');
    expect(tabs.getByRole('link', { name: 'Payments' })).toHaveAttribute('href', '/platform/subscriptions/payments');
    expect(tabs.getByRole('link', { name: 'Subscriptions' })).toHaveAttribute('href', '/platform/subscriptions');
  });
});

describe('subscriptions view', () => {
  it('shows plan revenue, weekly counts and amounts, and named ending companies', () => {
    renderView();
    const revenue = within(screen.getByRole('region', { name: 'Recurring revenue by plan' }));
    const [starter, pro, enterprise] = within(revenue.getByRole('list')).getAllByRole('listitem');
    expect(starter).toHaveTextContent(/Starter\s*\$30/);
    expect(pro).toHaveTextContent(/Pro\s*\$120/);
    expect(enterprise).toHaveTextContent(/Enterprise\s*Not available/);
    expect(revenue.getByText('Average per paying company').parentElement).toHaveTextContent('$50');

    const weeks = within(screen.getByRole('list', { name: 'Weekly renewal counts and amounts' })).getAllByRole('listitem');
    expect(weeks).toHaveLength(4);
    expect(weeks[0]).toHaveTextContent(/2\s*Nov 23, 2026\s*\$80/);
    expect(weeks[1]).toHaveTextContent(/4\s*Nov 30, 2026\s*\$160/);
    expect(weeks[2]).toHaveTextContent(/0\s*Dec 7, 2026\s*\$0/);
    expect(weeks[3]).toHaveTextContent(/1\s*Dec 14, 2026\s*Not available/);

    const ending = within(screen.getByRole('region', { name: 'Ending soon' }));
    expect(ending.getByRole('link', { name: 'Example Janitorial' })).toHaveAttribute('href', '/platform/companies/18');
    expect(ending.getByText('Ends Dec 2, 2026')).toBeVisible();
    expect(ending.getByText('$45')).toBeVisible();
    expect(ending.getByText('cancelled to date').parentElement).toHaveTextContent(/3\s*cancelled to date/);
  });

  it('finds the ending company by ID across company search pages', () => {
    useConsoleCompanies.mockImplementation(({ after }) => ({
      data: after
        ? { items: [{ id: 18, monthly: usd(37.50) }], nextCursor: null }
        : { items: [{ id: 19, monthly: usd(99) }], nextCursor: 'more-companies' },
    }));
    renderView();
    const ending = within(screen.getByRole('region', { name: 'Ending soon' }));
    expect(ending.getByText('$37.50')).toBeVisible();
    expect(ending.queryByText('$99')).not.toBeInTheDocument();
    expect(useConsoleCompanies).toHaveBeenLastCalledWith({
      q: 'Example Janitorial', subscription: 'SCHEDULED_CANCEL', after: 'more-companies',
    });
  });

  it('shows an unavailable monthly value when the company read returns null', () => {
    useConsoleCompanies.mockReturnValue({ data: { items: [{ id: 18, monthly: null }], nextCursor: null } });
    renderView();
    const ending = within(screen.getByRole('region', { name: 'Ending soon' }));
    expect(ending.getByText('Not available')).toBeVisible();
  });

  it('uses the status in the URL, updates the query, and preserves other parameters', () => {
    renderView('?status=PAST_DUE&keep=1');
    const group = within(screen.getByRole('group', { name: 'Subscription status' }));
    expect(group.getByRole('button', { name: /^Past due\s*1$/ })).toHaveAttribute('aria-pressed', 'true');
    expect(useConsoleSubscriptions).toHaveBeenLastCalledWith({ status: 'PAST_DUE', cursor: undefined });

    fireEvent.click(group.getByRole('button', { name: /^Scheduled to cancel\s*1$/ }));
    expect(screen.getByLabelText('Current address')).toHaveTextContent('?status=SCHEDULED_CANCEL&keep=1');
    expect(screen.getByRole('button', { name: /^Scheduled to cancel\s*1$/ })).toHaveAttribute('aria-pressed', 'true');
    expect(useConsoleSubscriptions).toHaveBeenLastCalledWith({ status: 'SCHEDULED_CANCEL', cursor: undefined });

    fireEvent.click(screen.getByRole('button', { name: /^All\s*12$/ }));
    expect(screen.getByLabelText('Current address')).toHaveTextContent('/platform/subscriptions?keep=1');
    expect(useConsoleSubscriptions).toHaveBeenLastCalledWith({ status: undefined, cursor: undefined });
  });

  it('opens the company from the row and exposes only the server-provided Paddle link for billing', () => {
    renderView();
    const row = screen.getByRole('row', { name: /Example Facilities/ });
    const rowContent = within(row);
    expect(rowContent.getByRole('link', { name: 'Example Facilities' })).toHaveAttribute('href', '/platform/companies/52');
    expect(rowContent.getByText('Account Owner')).toBeVisible();
    expect(rowContent.getByText('Yearly')).toBeVisible();
    expect(rowContent.getByText('$480')).toBeVisible();
    expect(rowContent.getByText('Renews Nov 30, 2026')).toBeVisible();
    const paddle = rowContent.getByRole('link', { name: 'Open in Paddle for Example Facilities' });
    expect(paddle).toHaveAttribute('href', subscription.paddleUrl);
    expect(paddle).toHaveAttribute('target', '_blank');
    expect(paddle).toHaveAttribute('rel', 'noopener noreferrer');
    expect(screen.getByText(/updates through the signed webhook/)).toBeVisible();
    const billingActions = /^(cancel|pause|change|refund)\b/i;
    expect(screen.queryByRole('button', { name: billingActions })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: billingActions })).not.toBeInTheDocument();

    fireEvent.click(paddle);
    expect(screen.getByLabelText('Current address')).toHaveTextContent('/platform/subscriptions');
    fireEvent.keyDown(row, { key: 'Enter' });
    expect(screen.getByLabelText('Current address')).toHaveTextContent('/platform/companies/52');
  });

  it('pages with the returned cursor and resets pagination on a status change', () => {
    const nextCursor = 'cursor-for-second-page';
    useConsoleSubscriptions.mockImplementation(({ cursor }) => ({
      data: cursor ? { ...response, items: [{ ...subscription, companyId: 53, name: 'Second Company' }] }
        : { ...response, nextCursor },
      refetch,
    }));
    renderView();

    expect(screen.getByRole('button', { name: 'Previous' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(useConsoleSubscriptions).toHaveBeenLastCalledWith({ status: undefined, cursor: nextCursor });
    expect(screen.getByRole('row', { name: /Second Company/ })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Previous' }));
    expect(screen.getByRole('row', { name: /Example Facilities/ })).toBeVisible();

    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    fireEvent.click(screen.getByRole('button', { name: /^Active\s*7$/ }));
    expect(useConsoleSubscriptions).toHaveBeenLastCalledWith({ status: 'ACTIVE', cursor: undefined });
    expect(screen.getByRole('button', { name: 'Previous' })).toBeDisabled();
  });

  it('shows unavailable row values without creating a Paddle link', () => {
    const item = { ...subscription, interval: null, amount: null, owner: null, renewsOrEndsAt: null, paddleUrl: null };
    useConsoleSubscriptions.mockReturnValue({ data: { ...response, items: [item] }, refetch });
    renderView();
    const row = within(screen.getByRole('row', { name: /Example Facilities/ }));
    expect(row.getAllByText('Not available')).toHaveLength(5);
    expect(row.queryByRole('link', { name: /Paddle/ })).not.toBeInTheDocument();
  });

  it('shows loading while waiting for subscriptions', () => {
    useConsoleSubscriptions.mockReturnValue({ isPending: true, refetch });
    renderView();
    expect(screen.getByRole('status', { name: '' })).toHaveTextContent('Loading subscriptions…');
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it.each([
    ['', 'No subscriptions yet'],
    ['?status=CANCELLED', 'No subscriptions with this status'],
  ])('shows the appropriate empty state for %s', (search, heading) => {
    useConsoleSubscriptions.mockReturnValue({ data: { ...response, items: [] }, refetch });
    renderView(search);
    expect(screen.getByRole('heading', { name: heading })).toBeVisible();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('shows an error and retries the current query', () => {
    useConsoleSubscriptions.mockReturnValue({ isError: true, refetch });
    renderView();
    expect(screen.getByRole('alert')).toHaveTextContent('Could not load subscriptions.');
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });
});
