import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ChartTable } from './ChartTable';
import { ColumnChart } from './ColumnChart';
import { LineAreaChart } from './LineAreaChart';
import { StackedColumnChart } from './StackedColumnChart';
import { chartScale, thinLabels } from './chartScale';

const data = [{ label: 'Jan', value: 7 }, { label: 'Feb', value: 3 }];
const signups = [
  { label: 'Jan', parts: { STARTER: 2, PRO: 3, ADVANCED: 4 } },
  { label: 'Feb', parts: { STARTER: 1, PRO: 2, ADVANCED: 3 } },
];

describe('platform chart scale', () => {
  it('uses clean whole-number ticks for counts', () => {
    expect(chartScale(7)).toEqual({ ticks: [0, 2, 4, 6, 8], top: 8 });
    expect(chartScale(0)).toEqual({ ticks: [0, 1], top: 1 });
    expect(chartScale(4.1).ticks.every(Number.isInteger)).toBe(true);
  });

  it('leaves room for the endpoints and thins interior labels', () => {
    const labels = Array.from({ length: 20 }, (_, index) => `Day ${index + 1}`);
    const positions = labels.map((_, index) => 40 + index * 12);
    const ticks = thinLabels(labels, positions, 280);

    expect(ticks[0].text).toBe('Day 1');
    expect(ticks.at(-1)?.text).toBe('Day 20');
    expect(ticks.length).toBeLessThan(labels.length);
    expect(ticks.slice(1).every((tick, index) => tick.start > ticks[index].end)).toBe(true);

    const [first, last] = thinLabels(['The first long period', 'The last long period'], [60, 160], 190);
    expect(first.end).toBeLessThan(last.start);
  });
});

describe('platform axis charts', () => {
  it('labels money ticks, the mean, the last value and the partial period', () => {
    render(<ColumnChart label="Collected revenue" data={data} money average="12-month average" partialLast labelLast />);

    const chart = screen.getByRole('img', { name: 'Collected revenue, Jan to Feb. Latest $3 so far, highest $7.' });
    expect(within(chart).getByText('$8')).toBeInTheDocument();
    expect(within(chart).getByText('12-month average $5')).toBeInTheDocument();
    expect(within(chart).getByText('so far')).toBeInTheDocument();
    expect(screen.getByText('$3 so far')).toBeInTheDocument();
    expect(chart.querySelector('[tabindex]')).toBeNull();
  });

  it('shows the end callout and reference line in a full chart and omits axes in compact mode', () => {
    const { rerender } = render(<LineAreaChart label="Revenue" data={data} average />);

    expect(screen.getByRole('img', { name: 'Revenue, Jan to Feb. Latest 3, highest 7.' })).toBeInTheDocument();
    expect(screen.getByText('Average 5')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();

    rerender(<LineAreaChart label="Revenue" data={data} average compact />);
    expect(screen.getByRole('img', { name: 'Revenue, Jan to Feb. Latest 3, highest 7.' })).toBeInTheDocument();
    expect(screen.queryByText('Average 5')).toBeNull();
    expect(screen.queryByText('Jan')).toBeNull();
    expect(screen.queryByText('8')).toBeNull();
  });

  it('shows the total and the plans on hover, including the partial period', () => {
    render(<StackedColumnChart label="Sign-ups" data={signups} partialLast />);

    const chart = screen.getByRole('img', { name: 'Sign-ups, Jan to Feb. Latest 6 so far, highest 9.' });
    const bands = chart.querySelectorAll('rect[aria-hidden="true"]');
    fireEvent.pointerEnter(bands[1]);

    const tooltip = screen.getByRole('tooltip');
    expect(tooltip).toHaveTextContent('Feb (so far)');
    expect(within(tooltip).getByText('6')).toBeInTheDocument();
    expect(tooltip).toHaveTextContent('Starter1');
    expect(tooltip).toHaveTextContent('Pro2');
    expect(tooltip).toHaveTextContent('Enterprise3');

    fireEvent.pointerLeave(bands[1]);
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('leaves an empty axis with zero data and distinguishes known zero from unavailable', () => {
    const { rerender } = render(<ColumnChart label="Activity" data={[]} average />);
    const empty = screen.getByRole('img', { name: 'Activity. No data. Latest Not available, highest Not available.' });
    expect(within(empty).getByText('0')).toBeInTheDocument();
    expect(screen.queryByText(/average/i)).toBeNull();

    rerender(<LineAreaChart label="Activity" data={[{ label: 'Jan', value: 0 }, { label: 'Feb', value: null }]} />);
    expect(screen.getByRole('img', { name: 'Activity, Jan to Feb. Latest Not available, highest 0.' })).toBeInTheDocument();
    expect(screen.getByText('Not available')).toBeInTheDocument();
  });

  it('redraws the ticks when the chart container narrows', () => {
    let resize: (width: number) => void = () => {};
    vi.stubGlobal('ResizeObserver', class {
      constructor(callback: (entries: { contentRect: { width: number } }[]) => void) {
        resize = width => callback([{ contentRect: { width } }]);
      }
      observe() {}
      disconnect() {}
    });

    try {
      const days = Array.from({ length: 15 }, (_, index) => ({ label: `Day ${index + 1}`, value: index }));
      render(<ColumnChart label="Activity" data={days} />);
      const chart = screen.getByRole('img');
      act(() => resize(800));
      const count = within(chart).getAllByText(/^Day /).length;
      act(() => resize(310));
      expect(within(chart).getAllByText(/^Day /).length).toBeLessThan(count);
      expect(within(chart).getByText('Day 1')).toBeInTheDocument();
      expect(within(chart).getByText('Day 15')).toBeInTheDocument();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('platform chart table', () => {
  it('lists every label and value and marks unavailable and partial values', () => {
    render(<ChartTable label="Revenue" data={[...data, { label: 'Mar', value: null }]} money partialLast />);

    const table = screen.getByRole('table', { name: 'Revenue' });
    expect(within(table).getAllByRole('row')).toHaveLength(4);
    expect(within(table).getByRole('row', { name: 'Jan $7' })).toBeInTheDocument();
    expect(within(table).getByRole('row', { name: 'Feb $3' })).toBeInTheDocument();
    expect(within(table).getByRole('row', { name: 'Mar (so far) Not available' })).toBeInTheDocument();
  });

  it('lists all stacked values and their totals', () => {
    render(<ChartTable label="Sign-ups" data={signups} />);
    expect(screen.getByRole('columnheader', { name: 'Enterprise' })).toBeInTheDocument();
    expect(screen.getByRole('row', { name: 'Jan 2 3 4 9' })).toBeInTheDocument();
    expect(screen.getByRole('row', { name: 'Feb 1 2 3 6' })).toBeInTheDocument();
  });
});
