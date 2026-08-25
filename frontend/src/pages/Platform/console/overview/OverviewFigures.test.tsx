import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { OverviewFigures, type OverviewFiguresProps } from './OverviewFigures';

const running: OverviewFiguresProps = {
  figures: {
    companies: 24,
    newThisMonth: 4,
    paying: 12,
    payingShare: 0.5,
    mrr: { amount: 890, currency: 'USD' },
    mrrChange: 0.25,
    pastDue: [
      { companyId: 1, name: 'Alder Services', monthly: { amount: 19, currency: 'USD' } },
      { companyId: 2, name: 'Birch Cleaning', monthly: { amount: 49.5, currency: 'USD' } },
    ],
    activeStaff: 320,
  },
  months: Array.from({ length: 12 }, (_, index) => ({
    month: `2026-${String(index + 1).padStart(2, '0')}`,
    partial: index === 11,
    signups: { STARTER: index + 1, PRO: 0, ADVANCED: 0 },
    mrrEstimate: { amount: (index + 1) * 50, currency: 'USD' },
    collected: null,
  })),
  checkinsPerDay: Array.from({ length: 14 }, (_, index) => ({
    day: `2026-12-${String(index + 1).padStart(2, '0')}`,
    count: index + 1,
  })),
};

function renderTiles(overrides: Partial<OverviewFiguresProps> = {}) {
  render(<MemoryRouter><OverviewFigures {...running} {...overrides} /></MemoryRouter>);
  return screen.getByRole('region', { name: 'Overview figures' });
}

describe('OverviewFigures', () => {
  it('shows the five figures, their trends, and the company and subscription links', () => {
    const tiles = within(renderTiles());
    expect(tiles.getAllByRole('heading', { level: 2 }).map(heading => heading.textContent)).toEqual([
      'Monthly recurring revenue', 'Companies', 'Paying companies', 'Past due', 'Staff using the app',
    ]);
    for (const figure of ['$890', '24', '12', '2', '320']) {
      expect(tiles.getByText(figure)).toBeVisible();
    }
    expect(tiles.getByText('per month')).toBeVisible();
    expect(tiles.getByText('+25% since the end of last month')).toBeVisible();
    expect(tiles.getByText('Paid subscriptions at plan price; past due left out.')).toBeVisible();
    expect(tiles.getByText('+4 signed up this month')).toBeVisible();
    expect(tiles.getByRole('img', { name: /estimated monthly recurring revenue.*2026-01 to 2026-12.*\$600/i })).toBeVisible();
    expect(tiles.getByRole('img', { name: /monthly sign-ups, oldest to newest.*11, 12$/i })).toBeVisible();
    expect(tiles.getByRole('img', { name: 'Share of companies paying: 50%' })).toBeVisible();
    expect(tiles.getByRole('img', { name: /daily check-ins, oldest to newest.*13, 14$/i })).toBeVisible();
    expect(tiles.getByRole('link', { name: 'Companies' })).toHaveAttribute('href', '/platform/companies');
    expect(tiles.getByRole('link', { name: 'Paying companies' })).toHaveAttribute('href', '/platform/subscriptions');
  });

  it('links to the past-due filter and lists each company with its monthly amount', () => {
    renderTiles();
    expect(screen.getByRole('link', { name: 'Past due' })).toHaveAttribute('href', '/platform/companies?subscription=PAST_DUE');
    expect(screen.getByText('Paddle is retrying payment')).toBeVisible();
    const [first, second] = screen.getAllByRole('listitem');
    expect(first).toHaveTextContent('Alder Services');
    expect(first).toHaveTextContent('$19');
    expect(second).toHaveTextContent('Birch Cleaning');
    expect(second).toHaveTextContent('$49.50');
  });

  it('shows the all-current note and drops the past-due list when the count is zero', () => {
    renderTiles({ figures: { ...running.figures, pastDue: [] } });
    expect(screen.getByText('0')).toBeVisible();
    expect(screen.getByText('All payments current')).toBeVisible();
    expect(screen.queryByText('Paddle is retrying payment')).toBeNull();
    expect(screen.queryByRole('list')).toBeNull();
  });

  it('shows unavailable current revenue without a change and preserves the known trend', () => {
    renderTiles({ figures: { ...running.figures, mrr: null } });
    expect(screen.getByText('Not available')).toBeVisible();
    expect(screen.queryByText(/since the end of last month/)).toBeNull();
    expect(screen.queryByText('per month')).toBeNull();
    expect(screen.getByRole('img', { name: /estimated monthly recurring revenue/i })).toBeVisible();
  });

  it('shows incomplete figures and amounts without substituting zero', () => {
    renderTiles({
      figures: {
        ...running.figures, companies: null, newThisMonth: null, paying: null, payingShare: null,
        pastDue: [{ companyId: 1, name: 'Alder Services', monthly: null }], activeStaff: null,
      },
      months: running.months.map(month => ({ ...month, signups: null })),
      checkinsPerDay: null,
    });
    expect(screen.getAllByText('Not available')).toHaveLength(4);
    expect(screen.getByText('Sign-ups this month: Not available')).toBeVisible();
    expect(screen.getByText('Paying share: Not available')).toBeVisible();
    expect(within(screen.getByRole('listitem')).getByText('Not available')).toBeVisible();
    expect(screen.queryByRole('img', { name: /monthly sign-ups|daily check-ins|share of companies paying/i })).toBeNull();
  });

  it('shows the new platform’s five zero figures and plain notes without charts', () => {
    renderTiles({
      figures: {
        companies: 0, newThisMonth: 0, paying: 0, payingShare: null,
        mrr: { amount: 0, currency: 'USD' }, mrrChange: null, pastDue: [], activeStaff: 0,
      },
      months: running.months.map(month => ({
        ...month, signups: { STARTER: 0, PRO: 0, ADVANCED: 0 }, mrrEstimate: { amount: 0, currency: 'USD' },
      })),
      checkinsPerDay: running.checkinsPerDay?.map(day => ({ ...day, count: 0 })) ?? null,
    });
    expect(screen.getByText('$0')).toBeVisible();
    expect(screen.getAllByText('0')).toHaveLength(4);
    expect(screen.getByText('No paid subscriptions yet')).toBeVisible();
    expect(screen.getByText('None this month')).toBeVisible();
    expect(screen.getByText('All payments current')).toBeVisible();
    expect(screen.queryByRole('img')).toBeNull();
    expect(document.querySelector('svg')).toBeNull();
  });
});
