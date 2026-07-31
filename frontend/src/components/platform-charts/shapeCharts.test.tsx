import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { CalendarHeatmap } from './CalendarHeatmap';
import { DonutChart } from './DonutChart';
import { FunnelSteps } from './FunnelSteps';
import { MiniBars } from './MiniBars';
import { RankedBars } from './RankedBars';
import { RingGauge } from './RingGauge';
import { StatusStackBar } from './StatusStackBar';

afterEach(cleanup);

describe('platform shape charts', () => {
  it('names every donut part and draws only positive parts', () => {
    render(<DonutChart label="Companies by plan" centerCaption="Companies" parts={[
      { label: 'Starter', value: 4, tone: 'starter' },
      { label: 'Pro', value: 0, tone: 'pro' },
      { label: 'Enterprise', value: 1, tone: 'enterprise' },
    ]} />);

    const chart = screen.getByRole('img', { name: 'Companies by plan: Starter 4, Pro 0, Enterprise 1' });
    expect(within(chart).getByText('Companies')).toBeTruthy();
    expect(within(chart).getByText('5')).toBeTruthy();
    expect(chart.querySelectorAll('circle')).toHaveLength(2);
    expect(within(chart).queryByText('Pro: 0')).toBeNull();
  });

  it('reports an unavailable donut total when any part is unknown', () => {
    render(<DonutChart label="Monthly value" parts={[
      { label: 'Starter', value: 20, tone: 'starter' },
      { label: 'Pro', value: null, tone: 'pro' },
    ]} />);
    const chart = screen.getByRole('img', { name: 'Monthly value: Starter 20, Pro Not available' });
    expect(within(chart).getByText('Not available')).toBeTruthy();
  });

  it('shows and announces the rounded share', () => {
    render(<RingGauge label="Photos passed" share={82.6} />);
    const chart = screen.getByRole('img', { name: 'Photos passed: 83%' });
    expect(within(chart).getByText('83%')).toBeTruthy();
  });

  it('shows unavailable shares as text', () => {
    render(<RingGauge label="Photos passed" share={null} />);
    const chart = screen.getByRole('img', { name: 'Photos passed: Not available' });
    expect(within(chart).getByText('Not available')).toBeTruthy();
    expect(within(chart).queryByText('0%')).toBeNull();
  });

  it('places dated heatmap cells in Monday-first weeks with blank dates left as gaps', () => {
    render(<CalendarHeatmap label="Daily work" unit="tasks" days={[
      { date: '2026-11-08', count: 0 },
      { date: '2026-11-09', count: 4 },
      { date: '2026-11-11', count: 2 },
    ]} />);
    const chart = screen.getByRole('img', { name: 'Daily work: 6 tasks' });
    const monday = within(chart).getByTitle('2026-11-09: 4 tasks');
    const sunday = within(chart).getByTitle('2026-11-08: 0 tasks');
    const wednesday = within(chart).getByTitle('2026-11-11: 2 tasks');
    expect(monday.style.gridRow).toBe('1');
    expect(sunday.style.gridRow).toBe('7');
    expect(Number(monday.style.gridColumn)).toBe(Number(sunday.style.gridColumn) + 1);
    expect(wednesday.style.gridColumn).toBe(monday.style.gridColumn);
    expect(wednesday.style.gridRow).toBe('3');
    expect(screen.getByText('Less')).toBeTruthy();
    expect(screen.getByText('More')).toBeTruthy();
  });

  it('shows an empty calendar message and distinguishes unknown from zero', () => {
    const { rerender } = render(<CalendarHeatmap label="Daily work" days={[]} />);
    expect(screen.getByText('No activity yet')).toBeTruthy();
    rerender(<CalendarHeatmap label="Daily work" days={[{ date: '2026-11-09', count: null }]} />);
    const chart = screen.getByRole('img', { name: 'Daily work: Not available' });
    expect(within(chart).getByTitle('2026-11-09: Not available')).toBeTruthy();
  });

  it('keeps long ranked names whole and links only rows with a destination', () => {
    const name = 'A company with a long name that wraps onto more than one line';
    render(<RankedBars label="Busiest companies" rows={[
      { name, value: 18, href: '/platform/companies/42' },
      { name: 'Another company', value: null },
    ]} />);
    const list = screen.getByRole('list', { name: 'Busiest companies' });
    const link = within(list).getByRole('link', { name: `${name}, 18` });
    expect(link.getAttribute('href')).toBe('/platform/companies/42');
    expect(within(link).getByText(name)).toBeTruthy();
    expect(within(list).getAllByRole('link')).toHaveLength(1);
    expect(within(list).getByText('Not available')).toBeTruthy();
  });

  it('uses the previous step for conversion and the first step for bar width', () => {
    render(<FunnelSteps label="Conversion" steps={[
      { label: 'Signed up', count: 20 },
      { label: 'Checked out', count: 10 },
      { label: 'Paying', count: 8 },
    ]} />);
    const rows = within(screen.getByRole('list', { name: 'Conversion' })).getAllByRole('listitem');
    expect(within(rows[1]).getByText('50%')).toBeTruthy();
    expect(within(rows[2]).getByText('80%')).toBeTruthy();
    expect(rows[2].querySelector<HTMLElement>('[aria-hidden="true"]')?.style.width).toBe('40%');
  });

  it('reports an unavailable conversion after a step with zero participants', () => {
    render(<FunnelSteps label="Conversion" steps={[
      { label: 'Signed up', count: 0 },
      { label: 'Checked out', count: 0 },
    ]} />);
    expect(screen.getByText('Not available')).toBeTruthy();
    expect(screen.queryByText('NaN%')).toBeNull();
  });

  it('hides the mini bars from assistive technology and highlights the last column', () => {
    const { container } = render(<MiniBars values={[1, 3, 2]} />);
    expect(screen.queryByRole('img')).toBeNull();
    const svg = container.querySelector('svg');
    expect(svg?.getAttribute('aria-hidden')).toBe('true');
    const bars = svg?.querySelectorAll('rect');
    expect(bars).toHaveLength(3);
    expect(bars?.[2].getAttribute('data-highlight')).toBe('true');
  });

  it('skips empty subscription states and names the remaining counts', () => {
    render(<StatusStackBar label="Subscription mix" counts={{ ACTIVE: 5, PAST_DUE: 0, NONE: 2 }} />);
    const chart = screen.getByRole('img', { name: 'Subscription mix: Active 5, Never paid 2' });
    expect(chart.children).toHaveLength(2);
    expect(within(chart).getByTitle('Active 5')).toBeTruthy();
    expect(within(chart).queryByTitle(/Past due/)).toBeNull();
  });
});
