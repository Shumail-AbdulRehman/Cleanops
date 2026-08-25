import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';
import { OverviewRevenue, type OverviewRevenueProps } from './OverviewRevenue';

const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const fixture: OverviewRevenueProps = {
  figures: { paying: 20, mrrChange: 0.125 },
  months: months.map((_, index) => ({
    month: `2026-${String(index + 1).padStart(2, '0')}`,
    partial: index === 11,
    mrrEstimate: { amount: 100 + index, currency: 'USD' },
    collected: { amount: 200 + index, currency: 'USD' },
    signups: { STARTER: index, PRO: 1, ADVANCED: 0 },
  })),
  plans: [
    { plan: 'STARTER', paying: 9, mrr: { amount: 31, currency: 'USD' } },
    { plan: 'PRO', paying: 7, mrr: { amount: 92, currency: 'USD' } },
    { plan: 'ADVANCED', paying: 4, mrr: { amount: 143, currency: 'USD' } },
  ],
};

function CurrentSearch() {
  return <output aria-label="Current search">{useLocation().search}</output>;
}

function showOverview(search = '', data = fixture) {
  return render(
    <MemoryRouter initialEntries={[`/platform${search}`]}>
      <OverviewRevenue {...data} />
      <CurrentSearch />
    </MemoryRouter>,
  );
}

afterEach(cleanup);

describe('OverviewRevenue', () => {
  it('starts with estimated recurring revenue, its average, and the reported monthly change', () => {
    showOverview();
    const revenue = within(screen.getByRole('region', { name: 'Revenue' }));
    expect(revenue.getByRole('button', { name: 'Recurring', pressed: true })).toBeVisible();
    expect(revenue.getByText(/estimated recurring revenue at each month end/i)).toBeVisible();
    const chart = within(revenue.getByRole('img', { name: /estimated recurring revenue.*latest \$111/i }));
    expect(chart.getByText(/12-month average/)).toBeVisible();
    expect(revenue.getByText('Change from the month before')).toBeVisible();
    expect(revenue.getByText('+12.5%')).toBeVisible();
  });

  it('switches to collected payments and preserves unrelated search parameters', () => {
    showOverview('?filter=keep');
    fireEvent.click(screen.getByRole('button', { name: 'Collected' }));
    const chart = screen.getByRole('img', { name: /collected payments.*\$211 so far/i });
    expect(within(chart).getByText(/12-month average/)).toBeVisible();
    expect(screen.queryByText('Change from the month before')).toBeNull();
    expect(screen.getByRole('status', { name: 'Current search' })).toHaveTextContent('?filter=keep&revenue=collected');
    fireEvent.click(screen.getByRole('button', { name: 'Recurring' }));
    expect(screen.getByRole('status', { name: 'Current search' })).toHaveTextContent(/^\?filter=keep$/);
  });

  it('restores the collected and table selections from the URL and shows every month and value', () => {
    showOverview('?revenue=collected&revenueView=table&signupsView=table');
    const revenue = within(screen.getByRole('table', { name: 'Collected payments' }));
    expect(revenue.getAllByRole('row')).toHaveLength(13);
    months.forEach((month, index) => {
      const monthLabel = `${month} 26${index === 11 ? ' (so far)' : ''}`;
      const row = within(revenue.getByRole('row', { name: new RegExp(month) }));
      expect(row.getByRole('rowheader', { name: monthLabel })).toBeVisible();
      expect(row.getByRole('cell', { name: `$${200 + index}` })).toBeVisible();
    });
    expect(screen.getByRole('table', { name: 'Sign-ups by plan' })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Chart for Revenue' }));
    expect(screen.getByRole('img', { name: /collected payments/i })).toBeVisible();
    expect(screen.getByRole('status', { name: 'Current search' })).toHaveTextContent(
      /^\?revenue=collected&signupsView=table$/,
    );
  });

  it('shows the paying total in the donut and counts and monthly revenue by plan', () => {
    showOverview();
    const paying = within(screen.getByRole('region', { name: 'Paying companies by plan' }));
    const donut = within(paying.getByRole('img', { name: /starter 9, pro 7, enterprise 4/i }));
    expect(donut.getByText('20')).toBeVisible();
    expect(donut.getByText('paying')).toBeVisible();
    const rows = within(paying.getByRole('list')).getAllByRole('listitem');
    expect(rows.map(row => row.textContent)).toEqual(['Starter$31/mo9', 'Pro$92/mo7', 'Enterprise$143/mo4']);
  });

  it('marks the current signup month as partial in the chart and table', () => {
    showOverview();
    expect(screen.getByRole('img', { name: /sign-ups by plan.*so far/i })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Table for Sign-ups by plan' }));
    const table = within(screen.getByRole('table', { name: 'Sign-ups by plan' }));
    expect(table.getByRole('columnheader', { name: 'Enterprise' })).toBeVisible();
    expect(table.getByRole('rowheader', { name: 'Dec 26 (so far)' })).toBeVisible();
    expect(screen.getByRole('status', { name: 'Current search' })).toHaveTextContent('?signupsView=table');
  });

  it('shows unavailable revenue instead of drawing a chart and preserves missing values in the table', () => {
    showOverview('', {
      ...fixture,
      figures: { ...fixture.figures, mrrChange: null },
      months: fixture.months.map((month, index) => index === 11 ? { ...month, mrrEstimate: null } : month),
      plans: fixture.plans.map(plan => ({ ...plan, mrr: null })),
    });
    const revenue = within(screen.getByRole('region', { name: 'Revenue' }));
    expect(revenue.queryByRole('img')).toBeNull();
    expect(revenue.getAllByText('Not available')).toHaveLength(2);
    const paying = within(screen.getByRole('region', { name: 'Paying companies by plan' }));
    expect(paying.getAllByText('Not available')).toHaveLength(3);
    expect(paying.getByRole('img')).toBeVisible();
    fireEvent.click(revenue.getByRole('button', { name: 'Table for Revenue' }));
    const table = within(revenue.getByRole('table', { name: 'Estimated recurring revenue' }));
    expect(table.getByRole('row', { name: 'Dec 26 Not available' })).toBeVisible();
    expect(table.getByRole('row', { name: 'Nov 26 $110' })).toBeVisible();
  });

  it('renders real zero values for a new platform', () => {
    showOverview('', {
      figures: { paying: 0, mrrChange: null },
      months: fixture.months.map(month => ({
        ...month,
        mrrEstimate: { amount: 0, currency: 'USD' },
        signups: { STARTER: 0, PRO: 0, ADVANCED: 0 },
      })),
      plans: fixture.plans.map(plan => ({ ...plan, paying: 0, mrr: { amount: 0, currency: 'USD' } })),
    });
    expect(screen.getByRole('img', { name: /estimated recurring revenue.*latest \$0/i })).toBeVisible();
    expect(screen.getByRole('img', { name: /starter 0, pro 0, enterprise 0/i })).toBeVisible();
    expect(screen.getAllByText('$0/mo')).toHaveLength(3);
  });
});
