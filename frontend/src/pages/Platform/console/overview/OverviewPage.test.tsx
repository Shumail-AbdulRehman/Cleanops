import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlatformOverviewResponse } from '../api/consoleApi';
import OverviewPage from './OverviewPage';

const { getOverview } = vi.hoisted(() => ({ getOverview: vi.fn() }));

vi.mock('../api/consoleApi', () => ({ getConsoleOverview: getOverview }));
vi.mock('../../serviceApi', () => ({
  getInquiries: () => Promise.resolve({ items: [], nextCursor: null }),
}));

function response(companies: number): PlatformOverviewResponse {
  const money = { amount: companies * 20, currency: 'USD' };
  const counts = { STARTER: companies, PRO: 0, ADVANCED: 0 };
  const day = { day: '2026-11-18', count: companies };

  return {
    asOf: '2026-11-19T00:00:00Z',
    figures: {
      companies,
      newThisMonth: companies,
      paying: companies,
      payingShare: companies ? 1 : null,
      mrr: money,
      mrrChange: companies ? 0 : null,
      pastDue: [],
      activeStaff: companies,
    },
    attention: { items: [], mrrAtRisk: { amount: 0, currency: 'USD' } },
    upgrades: [],
    plans: [{ plan: 'STARTER', paying: companies, mrr: money }],
    companiesByPlan: [],
    months: [{ month: '2026-11', signups: counts, mrrEstimate: money, collected: money, partial: true }],
    funnel: { signedUp: companies, checkedOut: companies, paying: companies, workedThisWeek: companies },
    statusCounts: { ACTIVE: companies, PAST_DUE: 0, SCHEDULED_CANCEL: 0, CANCELLED: 0, NONE: 0 },
    tasksPerDay: [day],
    checkinsPerDay: [day],
    photos: { passed: companies, retake: 0, manager: 0, cleaning: 0 },
    busiest: companies ? [{ companyId: 101, name: 'Test Company', tasks: companies }] : [],
    system: { database: 'OK', lastWebhookAt: null, photoChecks: false },
  };
}

function renderOverview() {
  const client = new QueryClient();
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/platform']}><OverviewPage /></MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('OverviewPage', () => {
  beforeEach(() => { getOverview.mockReset(); });

  it('fetches once and presents the panels in reading order', async () => {
    getOverview.mockResolvedValue(response(2));
    renderOverview();

    await screen.findByText('No new inquiries are waiting for a reply.');
    expect(getOverview).toHaveBeenCalledTimes(1);
    expect(screen.getAllByRole('heading', { level: 2 }).map(heading => heading.textContent)).toEqual([
      'Monthly recurring revenue',
      'Companies',
      'Paying companies',
      'Past due',
      'Staff using the app',
      'Needs attention',
      'Enterprise inquiries',
      'Close to plan limit',
      'Revenue',
      'Paying companies by plan',
      'Sign-ups by plan',
      'From sign-up to paying',
      'Subscription status',
      'Work done on the platform',
      'Photo checks',
      'Busiest companies',
      'System status',
    ]);
  });

  it('announces the static loading placeholders while the request is pending', () => {
    getOverview.mockReturnValue(new Promise(() => {}));
    renderOverview();

    expect(screen.getByRole('status', { name: 'Loading Overview…', busy: true })).toBeVisible();
    expect(screen.queryByRole('region', { name: 'Overview figures' })).not.toBeInTheDocument();
  });

  it('explains the error and fetches the overview again on Retry', async () => {
    getOverview
      .mockRejectedValueOnce(Object.assign(new Error('Session expired'), { status: 401 }))
      .mockResolvedValueOnce(response(2));
    renderOverview();

    expect(await screen.findByRole('alert')).toHaveTextContent('Nothing was changed.');
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));

    expect(await screen.findByRole('region', { name: 'Overview figures' })).toBeVisible();
    expect(getOverview).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('shows the new-platform banner with zero figures and empty panels', async () => {
    getOverview.mockResolvedValue(response(0));
    renderOverview();

    expect(await screen.findByRole('heading', { name: 'No companies yet' })).toBeVisible();
    const figures = screen.getByRole('region', { name: 'Overview figures' });
    expect(within(figures).getAllByText('0').length).toBeGreaterThan(0);
    expect(screen.getByText('No companies need attention right now.')).toBeVisible();
    expect(screen.getByText('No sign-ups yet')).toBeVisible();
    expect(screen.getByText('No photos yet')).toBeVisible();
  });

  it('keeps the other panels visible when the usage group is unavailable', async () => {
    getOverview.mockResolvedValue({ ...response(2), tasksPerDay: null, photos: null, busiest: null });
    renderOverview();

    expect(await screen.findByRole('region', { name: 'Overview figures' })).toBeVisible();
    for (const name of ['Work done on the platform', 'Photo checks', 'Busiest companies']) {
      expect(within(screen.getByRole('region', { name })).getByText('Not available')).toBeVisible();
    }
    for (const name of ['Revenue', 'From sign-up to paying', 'Subscription status', 'System status']) {
      const panel = screen.getByRole('region', { name });
      expect(panel).toBeVisible();
      expect(within(panel).queryByText('Not available')).not.toBeInTheDocument();
    }
  });
});
