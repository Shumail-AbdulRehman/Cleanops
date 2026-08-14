import type { ReactNode } from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { createMemoryRouter, MemoryRouter, RouterProvider } from 'react-router-dom';
import { beforeEach, expect, it, vi } from 'vitest';
import { LanguageProvider } from '@/i18n/LanguageProvider';
import { translate } from '@/i18n/translations';
import WorkThroughDay, { type WorkThroughDayProps } from './WorkThroughDay';
import ByLocationList from './ByLocationList';
import type { OperationOverview } from './operations';

const chart = vi.hoisted(() => ({ points: [] as Array<{ hour: number; due: number; submitted: number | null }> }));
vi.mock('recharts', () => ({
  ResponsiveContainer: ({ children }: { children: ReactNode }) => children,
  LineChart: ({ children, data }: { children: ReactNode; data: typeof chart.points }) => { chart.points = data; return <div>{children}</div>; },
  ReferenceLine: ({ label }: { label: { value: string } }) => <span>{label.value}</span>,
  ReferenceDot: ({ label }: { label: { value: string } }) => <span>{label.value}</span>,
  Line: () => null, CartesianGrid: () => null, XAxis: () => null, YAxis: () => null, Tooltip: () => null,
}));
const base: WorkThroughDayProps = {
  asOf: '2026-11-11T10:40:00Z', date: 'today', timezone: 'Asia/Karachi',
  hourly: [{ hour: 7, due: 0, submitted: 0 }, { hour: 12, due: 16, submitted: 14 }, { hour: 15, due: 29, submitted: 26 }, { hour: 18, due: 32, submitted: null }],
};
function mount(children: ReactNode, language = 'en') {
  localStorage.setItem('hygene-ops.language', language);
  return render(<LanguageProvider><MemoryRouter><div className="workspace">{children}</div></MemoryRouter></LanguageProvider>);
}
function work(extra: Partial<WorkThroughDayProps> = {}, language = 'en') { return mount(<WorkThroughDay {...base} {...extra} />, language); }
function figures(language: 'en' | 'ur' = 'en') {
  fireEvent.click(screen.getByText(translate('View hourly figures', language), { selector: 'summary' }));
  return screen.getByRole('table', { name: translate('View hourly figures', language) });
}
type Comparison = OperationOverview['comparison'];
const row = (id: number, tasks = 10, submitted = 5, name = `Synthetic site ${id}`): Comparison[number] => ({ location: { id, name, timezone: 'Asia/Karachi' }, tasks, submitted, present: 3, scheduled: 4, reviews: 2 });
const params = new URLSearchParams('date=2026-11-10&locationId=99&status=overdue&taskId=9&page=2&q=old');
function list(comparison: Comparison, language = 'en') { return mount(<ByLocationList comparison={comparison} params={params} />, language); }
beforeEach(() => { localStorage.clear(); chart.points = []; });

it('shows the positive behind pill and both named legend series', () => {
  work();
  expect(screen.getByText('3 tasks behind')).toBeInTheDocument();
  const legend = screen.getByRole('list', { name: 'Work status' });
  expect(within(legend).getByText('Work submitted')).toBeInTheDocument();
  expect(within(legend).getByText('Due by this time')).toBeInTheDocument();
});
it.each([29, 31, null])('does not claim tasks behind when current submissions are %s', submitted => {
  work({ hourly: [{ hour: 15, due: 29, submitted }] });
  expect(screen.queryByText(/tasks behind/)).not.toBeInTheDocument();
});
it('lists every server hour and preserves missing future submissions in the disclosed table', () => {
  work(); const table = figures();
  expect(within(table).getAllByRole('row')).toHaveLength(5);
  expect(within(table).getAllByRole('rowheader').map(cell => cell.textContent)).toEqual(['7:00 am', '12:00 pm', '3:00 pm', '6:00 pm']);
  expect(within(table).getAllByRole('row').at(-1)).toHaveTextContent('32Not recorded');
  expect(within(table).getAllByRole('columnheader').map(cell => cell.textContent)).toEqual(['Time', 'Due by this time', 'Work submitted']);
});
it.each([undefined, []])('hides a missing/empty hourly chart with guidance', hourly => {
  work({ hourly });
  expect(screen.queryByRole('img', { name: 'Work through the day' })).not.toBeInTheDocument();
  expect(screen.queryByText('Now')).not.toBeInTheDocument();
  expect(screen.queryByText('View hourly figures')).not.toBeInTheDocument();
  expect(screen.getByText('Hourly figures are not available for this day.')).toBeInTheDocument();
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});
it('uses the API snapshot and timezone for Now and an accessible summary', () => {
  work();
  expect(screen.getByText('Now')).toBeInTheDocument();
  expect(screen.getByRole('img', { name: 'Work through the day' })).toHaveAccessibleDescription('By 3:00 pm, 29 tasks were due and 26 were submitted. 32 tasks are due by the end of the day.');
  expect(within(screen.getByRole('img')).getByText('32')).toBeInTheDocument();
  expect(within(screen.getByRole('img')).getByText('26')).toBeInTheDocument();
});
it('clips today’s submitted series and table at the snapshot hour without mutating cached data', () => {
  const hourly = [{ hour: 15, due: 29, submitted: 26 }, { hour: 18, due: 32, submitted: 32 }];
  work({ hourly }); figures();
  expect(chart.points).toEqual([hourly[0], { hour: 18, due: 32, submitted: null }]);
  expect(hourly[1].submitted).toBe(32);
  expect(within(screen.getByRole('img')).getByText('26')).toBeInTheDocument();
});
it('draws all past hours without a Now marker or behind claim', () => {
  const hourly = base.hourly!.map(point => ({ ...point, submitted: point.hour === 18 ? 30 : point.submitted }));
  work({ date: '2026-11-10', hourly });
  expect(screen.queryByText('Now')).not.toBeInTheDocument();
  expect(screen.queryByText(/tasks behind/)).not.toBeInTheDocument();
  expect(chart.points.at(-1)?.submitted).toBe(30);
  expect(screen.getByRole('img')).toHaveAccessibleDescription('By 6:00 pm, 32 tasks were due and 30 were submitted. 32 tasks are due by the end of the day.');
});
it('handles future dates without inventing observations or a Now marker', () => {
  work({ date: '2026-11-12', hourly: [{ hour: 15, due: 29, submitted: null }] });
  expect(screen.queryByText('Now')).not.toBeInTheDocument();
  expect(screen.queryByText(/tasks behind/)).not.toBeInTheDocument();
  expect(screen.getByRole('img')).toHaveAccessibleDescription(/Not recorded/);
  expect(within(figures()).getByRole('cell', { name: 'Not recorded' })).toBeInTheDocument();
});
it('does not fabricate current counts before the first bucket', () => {
  work({ asOf: '2026-11-11T00:00:00Z' });
  expect(screen.queryByText(/tasks behind/)).not.toBeInTheDocument();
  expect(screen.getByRole('img')).toHaveAccessibleDescription('No data');
  expect(chart.points.every(point => point.submitted === null)).toBe(true);
});
it('supports a one-hour day and true zero submissions', () => {
  work({ hourly: [{ hour: 15, due: 0, submitted: 0 }] });
  expect(screen.getByRole('img')).toHaveAccessibleDescription(/0 tasks were due and 0 were submitted/);
  expect(within(figures()).getAllByRole('cell', { name: '0' })).toHaveLength(2);
});
it('shows initial skeletons without fake figures', () => {
  work({ hourly: undefined, loading: true });
  expect(screen.getByRole('status')).toHaveAttribute('aria-busy', 'true');
  expect(screen.queryByRole('img', { name: 'Work through the day' })).not.toBeInTheDocument();
  expect(screen.queryByText('Hourly figures are not available for this day.')).not.toBeInTheDocument();
});
it('offers Retry and saved-record reassurance on initial failure', () => {
  const retry = vi.fn(); work({ hourly: undefined, error: new Error('Private details'), retry });
  const alert = screen.getByRole('alert');
  expect(alert).toHaveTextContent('Your saved records have not changed.');
  expect(screen.queryByText('Private details')).not.toBeInTheDocument();
  fireEvent.click(within(alert).getByRole('button', { name: 'Retry' })); expect(retry).toHaveBeenCalledOnce();
});
it('keeps cached charts, an open disclosure and focus through a background refresh/failure', () => {
  const { rerender } = work(); figures();
  const summary = screen.getByText('View hourly figures', { selector: 'summary' }); summary.focus();
  rerender(<LanguageProvider><MemoryRouter><div className="workspace"><WorkThroughDay {...base} loading error={new Error('refresh failed')} retry={() => {}} /></div></MemoryRouter></LanguageProvider>);
  expect(screen.getByRole('img', { name: 'Work through the day' })).toBeInTheDocument();
  expect(screen.getByRole('table')).toBeVisible(); expect(summary).toHaveFocus();
});
it('translates chart legends, summary, behind counts and table headings into Urdu', () => {
  work({}, 'ur');
  expect(screen.getByText(translate('{count} tasks behind', 'ur', { count: 3 }))).toBeInTheDocument();
  expect(screen.getByRole('img', { name: translate('Work through the day', 'ur') })).toHaveAccessibleDescription(/کام/);
  expect(within(figures('ur')).getByRole('columnheader', { name: translate('Due by this time', 'ur') })).toBeInTheDocument();
});
it('sorts by submitted share rather than task count and leaves the source untouched', () => {
  const comparison = [row(1, 2, 1), row(2, 20, 4), row(3, 10, 9)]; list(comparison);
  expect(screen.getAllByRole('link').map(link => link.getAttribute('aria-label'))).toEqual(['View daily records: Synthetic site 2', 'View daily records: Synthetic site 1', 'View daily records: Synthetic site 3']);
  expect(comparison.map(item => item.location.id)).toEqual([1, 2, 3]);
  expect(screen.getByRole('meter', { name: 'Synthetic site 2' })).toHaveAttribute('aria-valuetext', '4 of 20');
  expect(screen.getAllByText('3 of 4 staff checked in')).toHaveLength(3);
});
it('keeps stable rate ties and places unmeasured locations after measured zero progress', () => {
  list([row(1, 0, 0), row(2, 10, 0), row(3, 0, 0), row(4, 10, 0)]);
  expect(screen.getAllByRole('link').map(link => link.textContent)).toEqual([expect.stringContaining('Synthetic site 2'), expect.stringContaining('Synthetic site 4'), expect.stringContaining('Synthetic site 1'), expect.stringContaining('Synthetic site 3')]);
  expect(screen.getByRole('img', { name: 'Synthetic site 1: Not recorded' })).toBeInTheDocument();
  expect(screen.getAllByText('0 submitted · 0 due')).toHaveLength(2);
});
it('uses the exact daily scope link per location and discards stale task/filter parameters', () => {
  list([row(42)]);
  expect(screen.getByRole('link', { name: 'View daily records: Synthetic site 42' })).toHaveAttribute('href', '/today-status?locationId=42&date=2026-11-10');
  expect(params.get('locationId')).toBe('99');
});
it.each([0, 1, 6])('shows no extra link for %s locations', count => {
  list(Array.from({ length: count }, (_, i) => row(i + 1)));
  expect(screen.queryByRole('link', { name: 'View all locations' })).not.toBeInTheDocument();
  if (!count) expect(screen.getByText('No locations in this scope.')).toBeInTheDocument();
});
it('limits to the six lowest rates and links to Overview with the selected scope', () => {
  list(Array.from({ length: 8 }, (_, i) => row(i + 1, 10, 8 - i)));
  expect(screen.getAllByRole('link')).toHaveLength(7);
  expect(screen.queryByRole('link', { name: 'View daily records: Synthetic site 1' })).not.toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'View all locations' })).toHaveAttribute('href', '/dashboard?locationId=99&date=2026-11-10');
});
it('navigates through the real router on a location link', async () => {
  const router = createMemoryRouter([{ path: '*', element: <ByLocationList comparison={[row(42)]} params={params} /> }]);
  render(<LanguageProvider><RouterProvider router={router} /></LanguageProvider>);
  fireEvent.click(screen.getByRole('link', { name: 'View daily records: Synthetic site 42' }));
  expect(router.state.location.pathname).toBe('/today-status'); expect(router.state.location.search).toBe('?locationId=42&date=2026-11-10');
});
it('translates list counts without translating record names', () => {
  list([row(1, 10, 4, 'Original نام')], 'ur');
  expect(screen.getByRole('link', { name: translate('View daily records: {name}', 'ur', { name: 'Original نام' }) })).toBeInTheDocument();
  expect(screen.getByRole('meter', { name: 'Original نام' })).toHaveAttribute('aria-valuetext', translate('{count} of {total}', 'ur', { count: 4, total: 10 }));
  expect(screen.getByText(translate('{count} of {total} staff checked in', 'ur', { count: 3, total: 4 }))).toBeInTheDocument();
});
it('supports loading and retry for the list without claiming an empty scope', () => {
  const retry = vi.fn();
  const view = mount(<ByLocationList params={params} loading />);
  expect(screen.getByRole('status')).toHaveAttribute('aria-busy', 'true'); expect(screen.queryByText('No locations in this scope.')).not.toBeInTheDocument();
  view.rerender(<LanguageProvider><MemoryRouter><ByLocationList params={params} error={new Error('failed')} retry={retry} /></MemoryRouter></LanguageProvider>);
  fireEvent.click(screen.getByRole('button', { name: 'Retry' })); expect(retry).toHaveBeenCalledOnce();
});
