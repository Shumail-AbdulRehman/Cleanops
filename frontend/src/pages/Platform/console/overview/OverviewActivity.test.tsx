import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { ComponentProps } from 'react';
import { OverviewActivity } from './OverviewActivity';

type ActivityData = ComponentProps<typeof OverviewActivity>['data'];

const statuses = [
  ['ACTIVE', 'Active', 10],
  ['PAST_DUE', 'Past due', 4],
  ['SCHEDULED_CANCEL', 'Scheduled to cancel', 2],
  ['CANCELLED', 'Cancelled', 1],
  ['NONE', 'Never paid', 13],
] as const;

const busiest = Array.from({ length: 6 }, (_, index) => ({
  companyId: 100 + index,
  name: `Test Company ${index + 1}`,
  tasks: 12 - index,
}));

const tasksPerDay = Array.from({ length: 84 }, (_, index) => ({
  day: new Date(Date.UTC(2026, 7, 27 + index)).toISOString().slice(0, 10),
  count: index % 7,
}));

const running: ActivityData = {
  funnel: { signedUp: 30, checkedOut: 24, paying: 16, workedThisWeek: 12 },
  statusCounts: { ACTIVE: 10, PAST_DUE: 4, SCHEDULED_CANCEL: 2, CANCELLED: 1, NONE: 13 },
  tasksPerDay,
  photos: { passed: 10, retake: 3, manager: 1, cleaning: 1 },
  busiest,
  system: { database: 'OK', lastWebhookAt: '2026-11-19T05:15:00.000Z', photoChecks: true },
};

describe('OverviewActivity', () => {
  it('shows the funnel counts and the share of each preceding step', () => {
    render(<OverviewActivity data={running} />);

    const funnel = screen.getByRole('list', { name: 'Company funnel' });
    const rows = within(funnel).getAllByRole('listitem');
    expect(rows).toHaveLength(4);
    expect(rows[0]).toHaveTextContent(/Signed up\s*30/);
    expect(rows[1]).toHaveTextContent(/Completed checkout\s*24\s*80%/);
    expect(rows[2]).toHaveTextContent(/Still paying\s*16\s*67%/);
    expect(rows[3]).toHaveTextContent(/Worked this week\s*12\s*75%/);
  });

  it('links each subscription state and its count to the matching filter', () => {
    render(<OverviewActivity data={running} />);

    const states = screen.getByRole('list', { name: 'Subscription states' });
    expect(within(states).getAllByRole('link')).toHaveLength(5);
    for (const [state, label, count] of statuses) {
      expect(within(states).getByRole('link', { name: `${label} ${count}` }))
        .toHaveAttribute('href', `/platform/companies?subscription=${state}`);
    }
  });

  it('shows the sum of the daily task counts in the panel and calendar summary', () => {
    render(<OverviewActivity data={running} />);

    const work = screen.getByRole('region', { name: 'Work done on the platform' });
    expect(within(work).getByText('252')).toBeVisible();
    expect(within(work).getByRole('img', { name: '12-week task activity: 252 tasks' })).toBeInTheDocument();
  });

  it('shows the rounded photo pass share, passed count and the other outcomes', () => {
    render(<OverviewActivity data={running} />);

    const photos = screen.getByRole('region', { name: 'Photo checks' });
    expect(within(photos).getByRole('img', { name: 'First-time pass rate: 67%' })).toBeVisible();
    expect(within(photos).getByText('10')).toBeVisible();
    expect(within(photos).getByText('passed first time')).toBeVisible();
    const outcomes = within(photos).getByRole('list', { name: 'Other photo check results' });
    const [retake, manager, cleaning] = within(outcomes).getAllByRole('listitem');
    expect(retake).toHaveTextContent(/Retake needed\s*3/);
    expect(manager).toHaveTextContent(/Sent to a manager\s*1/);
    expect(cleaning).toHaveTextContent(/Needs cleaning\s*1/);
  });

  it('links all six ranked companies to their details', () => {
    render(<OverviewActivity data={running} />);

    const rankings = screen.getByRole('list', { name: 'Company activity rankings' });
    expect(within(rankings).getAllByRole('link')).toHaveLength(6);
    for (const { name, companyId, tasks } of busiest) {
      expect(within(rankings).getByRole('link', { name: `${name}, ${tasks}` }))
        .toHaveAttribute('href', `/platform/companies/${companyId}`);
    }
  });

  it('labels all three system observations in words', () => {
    render(<OverviewActivity data={running} />);

    const system = within(screen.getByRole('region', { name: 'System status' }));
    expect(system.getByText('Database')).toBeVisible();
    expect(system.getByText('Reachable')).toBeVisible();
    expect(system.getByText('Last Paddle webhook')).toBeVisible();
    expect(system.getByText(/10:15/)).toHaveAttribute('datetime', running.system.lastWebhookAt);
    expect(system.getByText('Photo checks')).toBeVisible();
    expect(system.getByText('On, owner switch (no privacy screening)')).toBeVisible();
  });

  it('shows each new-platform message when the known activity counts are empty', () => {
    render(<OverviewActivity data={{
      funnel: { signedUp: 0, checkedOut: 0, paying: 0, workedThisWeek: 0 },
      statusCounts: { ACTIVE: 0, PAST_DUE: 0, SCHEDULED_CANCEL: 0, CANCELLED: 0, NONE: 0 },
      tasksPerDay: tasksPerDay.map((day) => ({ ...day, count: 0 })),
      photos: { passed: 0, retake: 0, manager: 0, cleaning: 0 },
      busiest: [],
      system: { database: 'OK', lastWebhookAt: null, photoChecks: false },
    }} />);

    expect(screen.getByText('No sign-ups yet')).toBeVisible();
    expect(screen.getByText('No subscriptions yet')).toBeVisible();
    expect(within(screen.getByRole('region', { name: 'Work done on the platform' })).getByText('No activity yet')).toBeVisible();
    expect(screen.getByText('No photos yet')).toBeVisible();
    expect(within(screen.getByRole('region', { name: 'Busiest companies' })).getByText('No activity yet')).toBeVisible();
    expect(screen.getByText('none received yet')).toBeVisible();
    expect(screen.getByText('Owner switch off')).toBeVisible();
  });

  it('shows unavailable values for partial read failures', () => {
    render(<OverviewActivity data={{
      funnel: null,
      statusCounts: null,
      tasksPerDay: null,
      photos: null,
      busiest: null,
      system: { database: 'UNAVAILABLE', lastWebhookAt: null, photoChecks: null },
    }} />);

    expect(screen.getAllByText('Not available')).toHaveLength(6);
    expect(screen.getByText('Unavailable')).toBeVisible();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    expect(screen.queryByText(/No activity yet|No subscriptions yet|No sign-ups yet|No photos yet/)).not.toBeInTheDocument();
  });
});
