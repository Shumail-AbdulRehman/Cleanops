import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { DayCount } from '../api/consoleApi';
import { CompanyActivityPanel, CompanyQualityPanel, CompanyUsagePanel } from './CompanyUsagePanels';

const lastActiveAt = '2026-11-02T06:00:00Z';
const calendar35: DayCount[] = Array.from({ length: 35 }, (_, index) => ({
  day: new Date(Date.UTC(2026, 9, 16 + index)).toISOString().slice(0, 10),
  count: ({ 2: 12, 5: 4, 17: 5 } as Record<number, number>)[index] ?? 0,
}));
const activity30 = calendar35.slice(-30);
const noPhotoOutcomes = { passed: 0, retake: 0, manager: 0, cleaning: 0 };

describe('CompanyUsagePanel', () => {
  it('shows each used amount against its plan limit', () => {
    render(<CompanyUsagePanel plan="PRO"
      usage={{ locations: 4, staff: 24, managers: 2 }}
      limits={{ locations: 5, staff: 25, managers: 3 }} />);

    expect(screen.getByText('Pro plan limits')).toBeVisible();
    expect(screen.getByRole('meter', { name: 'Locations', value: { min: 0, max: 5, now: 4, text: '4 / 5' } })).toBeVisible();
    expect(screen.getByRole('meter', { name: 'Staff', value: { min: 0, max: 25, now: 24, text: '24 / 25' } })).toBeVisible();
    expect(screen.getByRole('meter', { name: 'Managers', value: { min: 0, max: 3, now: 2, text: '2 / 3' } })).toBeVisible();
    expect(screen.queryByText(/has reached the plan limits/)).not.toBeInTheDocument();
  });

  it('names each reached limit, including limits of one and usage over a limit', () => {
    render(<CompanyUsagePanel plan="STARTER"
      usage={{ locations: 1, staff: 4, managers: 0 }}
      limits={{ locations: 1, staff: 3, managers: 1 }} />);

    expect(screen.getByText('The owner has reached the plan limits for locations and staff and cannot add more in those categories.')).toBeVisible();
    expect(screen.getByRole('meter', { name: 'Locations', value: { max: 1, now: 1, text: '1 / 1' } })).toBeVisible();
    expect(screen.getByRole('meter', { name: 'Staff', value: { max: 3, now: 3, text: '4 / 3' } })).toBeVisible();
  });
});

describe('CompanyActivityPanel', () => {
  it('switches between the chart and a table with all 30 days', () => {
    const name = /Tasks completed per day, last 30 days/;
    render(<CompanyActivityPanel activity30={activity30} calendar35={calendar35} lastActiveAt={lastActiveAt} />);
    expect(screen.getByRole('img', { name })).toBeVisible();

    fireEvent.click(screen.getByRole('button', { name: 'Table' }));
    const table = within(screen.getByRole('table', { name }));
    expect(table.getAllByRole('row')).toHaveLength(31);
    expect(within(table.getByRole('row', { name: '21 Oct 4' })).getByRole('cell', { name: '4' })).toBeVisible();
    expect(within(table.getByRole('row', { name: '19 Nov 0' })).getByRole('cell', { name: '0' })).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Last 5 weeks' })).toBeVisible();

    fireEvent.click(screen.getByRole('button', { name: 'Chart' }));
    expect(screen.queryByRole('table', { name })).not.toBeInTheDocument();
    expect(screen.getByRole('img', { name })).toBeVisible();
  });

  it('uses the supplied calendar, including the quiet days after suspension', () => {
    render(<CompanyActivityPanel activity30={activity30} calendar35={calendar35} lastActiveAt={lastActiveAt} />);

    const heatmap = screen.getByRole('img', { name: 'Tasks completed per day over 5 weeks: 21 tasks' });
    expect(within(heatmap).getByTitle('2026-11-02: 5 tasks')).toBeInTheDocument();
    expect(within(heatmap).getByTitle('2026-11-03: 0 tasks')).toBeInTheDocument();
    expect(within(heatmap).getByTitle('2026-11-19: 0 tasks')).toBeInTheDocument();
    for (const [term, definition] of [['Tasks, 30 days', '9'], ['Busiest day', '12'], ['Days with work', '3 of 35']]) {
      expect(screen.getByText(term).nextElementSibling).toHaveTextContent(definition);
    }
  });

  it('shows the empty state and hides quality for a company that has never worked', () => {
    const emptyCalendar = calendar35.map(day => ({ ...day, count: 0 }));
    render(<>
      <CompanyActivityPanel activity30={emptyCalendar.slice(-30)} calendar35={emptyCalendar} lastActiveAt={null} />
      <CompanyQualityPanel photos={noPhotoOutcomes} onTimeShare={null} lastActiveAt={null} />
    </>);

    expect(screen.getByText('No activity yet')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Table' })).not.toBeInTheDocument();
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Work quality' })).not.toBeInTheDocument();
  });
});

describe('CompanyQualityPanel', () => {
  it('rounds the two shares and shows the three photo outcomes requiring follow-up', () => {
    render(<CompanyQualityPanel photos={{ passed: 73, retake: 9, manager: 5, cleaning: 3 }}
      onTimeShare={0.786} lastActiveAt={lastActiveAt} />);

    expect(screen.getByRole('img', { name: 'Photos passed: 81%' })).toBeVisible();
    expect(screen.getByRole('img', { name: 'Check-ins on time: 79%' })).toBeVisible();
    const outcomes = within(screen.getByRole('list', { name: 'Photo outcomes' }));
    expect(outcomes.getAllByRole('listitem')).toHaveLength(3);
    for (const [name, value] of [['Retake needed', '9'], ['Sent to a manager', '5'], ['Cleaning required', '3']]) {
      const row = outcomes.getAllByRole('listitem').find(item => within(item).queryByText(name))!;
      expect(within(row).getByText(value)).toBeVisible();
    }
  });

  it('distinguishes unavailable shares from a measured zero', () => {
    const { rerender } = render(<CompanyQualityPanel photos={noPhotoOutcomes} onTimeShare={null} lastActiveAt={lastActiveAt} />);
    expect(screen.getByRole('img', { name: 'Photos passed: Not available' })).toBeVisible();
    expect(screen.getByRole('img', { name: 'Check-ins on time: Not available' })).toBeVisible();

    rerender(<CompanyQualityPanel photos={{ ...noPhotoOutcomes, retake: 2 }} onTimeShare={0} lastActiveAt={lastActiveAt} />);
    expect(screen.getByRole('img', { name: 'Photos passed: 0%' })).toBeVisible();
    expect(screen.getByRole('img', { name: 'Check-ins on time: 0%' })).toBeVisible();
  });
});
