import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlatformOverviewResponse } from '../api/consoleApi';
import { useConsoleOverview } from '../api/consoleQueries';
import { CompanySummaryCards } from './CompanySummaryCards';

vi.mock('../api/consoleQueries', () => ({ useConsoleOverview: vi.fn() }));

type SummaryOverview = Pick<PlatformOverviewResponse, 'companiesByPlan' | 'statusCounts' | 'months'> & {
  figures: Pick<PlatformOverviewResponse['figures'], 'companies'>;
};

const overview: SummaryOverview = {
  figures: { companies: 8 },
  companiesByPlan: [
    { plan: 'STARTER', companies: 2, averageStaff: 1.5, largestStaff: 2 },
    { plan: 'PRO', companies: 5, averageStaff: 6.6, largestStaff: 11 },
    { plan: 'ADVANCED', companies: 1, averageStaff: 15, largestStaff: 15 },
  ],
  statusCounts: { ACTIVE: 3, PAST_DUE: 2, SCHEDULED_CANCEL: 1, CANCELLED: 0, NONE: 2 },
  months: Array.from({ length: 12 }, (_, index) => ({
    month: index === 11 ? '2026-01' : `2025-${String(index + 2).padStart(2, '0')}`,
    partial: index === 11,
    signups: { STARTER: index === 11 ? 1 : 0, PRO: index === 10 ? 2 : 0, ADVANCED: index === 10 ? 1 : 0 },
    mrrEstimate: null,
    collected: null,
  })),
};

function mockOverview(result: { data?: SummaryOverview; isPending?: boolean; isError?: boolean }) {
  vi.mocked(useConsoleOverview).mockReturnValue(result as ReturnType<typeof useConsoleOverview>);
}

beforeEach(() => mockOverview({ data: overview }));
afterEach(cleanup);

describe('CompanySummaryCards', () => {
  it('shows plan counts and their sum in the donut', () => {
    render(<CompanySummaryCards />);
    const card = within(screen.getByRole('region', { name: 'All companies by plan' }));
    const items = within(card.getByRole('list', { name: 'Plan counts' })).getAllByRole('listitem');
    expect(items).toHaveLength(3);
    expect(items[0]).toHaveTextContent(/Starter\s*2/);
    expect(items[1]).toHaveTextContent(/Pro\s*5/);
    expect(items[2]).toHaveTextContent(/Enterprise\s*1/);
    expect(within(card.getByRole('img', { name: /Companies by plan/ })).getByText('8')).toBeVisible();
  });

  it('lists all five subscription states including a zero count', () => {
    render(<CompanySummaryCards />);
    const items = within(screen.getByRole('list', { name: 'Subscription counts' })).getAllByRole('listitem');
    expect(items).toHaveLength(5);
    expect(items[0]).toHaveTextContent(/Active\s*3/);
    expect(items[1]).toHaveTextContent(/Past due\s*2/);
    expect(items[2]).toHaveTextContent(/Scheduled to cancel\s*1/);
    expect(items[3]).toHaveTextContent(/Cancelled\s*0/);
    expect(items[4]).toHaveTextContent(/Never paid\s*2/);
  });

  it('shows sign-ups this month, the previous month and twelve months of history', () => {
    render(<CompanySummaryCards />);
    const card = within(screen.getByRole('region', { name: 'Signed up this month' }));
    expect(card.getByText('1')).toBeVisible();
    expect(card.getByText('3 in December')).toBeVisible();
    const chart = card.getByRole('img', { name: /Monthly sign-ups/ });
    expect(chart).toHaveAccessibleName(/February 2025: 0.*December 2025: 3, January 2026: 1/);
    expect(chart.getAttribute('aria-label')?.split(', ')).toHaveLength(12);
  });

  it('shows rounded averages weighted by company count and the largest company', () => {
    render(<CompanySummaryCards />);
    const card = within(screen.getByRole('region', { name: 'Staff per company' }));
    expect(card.getByText('6')).toBeVisible();
    expect(card.getByText('on average · largest 15')).toBeVisible();
    const rows = within(card.getByRole('list', { name: 'Average staff by plan' })).getAllByRole('listitem');
    expect(rows[1]).toHaveTextContent(/Pro\s*7/);
  });

  it('preserves unavailable plan values without including empty plans in the overall average', () => {
    const [starter, pro, enterprise] = overview.companiesByPlan;
    mockOverview({ data: {
      ...overview,
      figures: { companies: 7 },
      companiesByPlan: [starter, pro, { ...enterprise, companies: 0, averageStaff: null, largestStaff: null }],
    } });
    render(<CompanySummaryCards />);
    const card = within(screen.getByRole('region', { name: 'Staff per company' }));
    expect(card.getByText('5')).toBeVisible();
    expect(card.getByText('on average · largest 11')).toBeVisible();
    const rows = within(card.getByRole('list', { name: 'Average staff by plan' })).getAllByRole('listitem');
    expect(rows[2]).toHaveTextContent(/Enterprise\s*Not available/);
  });

  it('shows a loading status before any cards render', () => {
    mockOverview({ isPending: true });
    render(<CompanySummaryCards />);
    expect(screen.getByRole('status', { name: 'Loading company summary' })).toBeVisible();
    expect(screen.queryByRole('heading')).not.toBeInTheDocument();
  });

  it('renders nothing when there are no companies', () => {
    mockOverview({ data: { ...overview, figures: { companies: 0 } } });
    const { container } = render(<CompanySummaryCards />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows a single quiet error line while keeping surrounding content visible', () => {
    mockOverview({ isError: true });
    render(<><CompanySummaryCards /><table aria-label="Companies" /></>);
    expect(screen.getByRole('status')).toHaveTextContent('Company summary unavailable.');
    expect(screen.queryByRole('heading')).not.toBeInTheDocument();
    expect(screen.getByRole('table', { name: 'Companies' })).toBeVisible();
  });
});
