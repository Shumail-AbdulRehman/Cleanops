import type { ReactNode } from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { createMemoryRouter, MemoryRouter, RouterProvider } from 'react-router-dom';
import { beforeEach, expect, it } from 'vitest';
import { LanguageProvider } from '@/i18n/LanguageProvider';
import { translate } from '@/i18n/translations';
import TodayPulse, { TodayAside } from './TodayPulse';
import { localTime, type OperationOverview, type OperationTask } from './operations';

const site = { id: 7, name: 'Original site نام', timezone: 'Asia/Karachi' };
const task = (id: number, extra: Partial<OperationTask> = {}): OperationTask => ({
  id, title: `Original task ${id}`, areaNameSnapshot: `Original room ${id}`, shiftStart: '2026-11-11T12:00:00Z', shiftEnd: '2026-11-11T13:00:00Z',
  status: 'PENDING', rawStatus: 'PENDING', staffSubmittedAt: null, verificationVersion: 1, verificationState: 'PENDING', completionOutcome: null,
  locationId: site.id, staffId: 2, templateId: null, carryOver: false, location: site, staff: { id: 2, name: 'Original worker نام' }, verificationException: null, ...extra,
});
const base: OperationOverview = {
  locations: [site], selected: [site], days: [{ locationId: site.id, localDate: '2026-11-11', timezone: site.timezone }], asOf: '2026-11-11T10:40:00Z', date: 'today',
  metrics: { present: 18, scheduled: 20, totalStaff: 30, totalTasks: 32, submitted: 26, reviewCount: 4, verified: 3, accepted: 1 },
  chart: { submitted: 26, inProgress: 2, notStarted: 1, overdue: 3 },
  attention: [{ key: 'staff:2', kind: 'attendance', staff: { id: 2, name: 'Original missing worker' }, location: site, reasonCode: 'MISSING_CHECKIN' }],
  comparison: [], tasks: [task(1)],
};
const params = new URLSearchParams('locationId=7&date=2026-11-10&tab=staff&status=all&attendance=present&page=3&taskId=9&q=old');
function mount(children: ReactNode, language = 'en') {
  localStorage.setItem('hygene-ops.language', language);
  return render(<LanguageProvider><MemoryRouter><div className="workspace">{children}</div></MemoryRouter></LanguageProvider>);
}
function pulse(data = base, language = 'en', scope = params) { return mount(<TodayPulse data={data} params={scope} />, language); }
function aside(data = base, language = 'en', scope = params) { return mount(<TodayAside data={data} params={scope} />, language); }
beforeEach(() => { localStorage.clear(); });

it('shows real attendance/submission totals and both accessible distribution labels', () => {
  pulse();
  expect(screen.getByRole('img', { name: '18 of 20 scheduled staff checked in' })).toBeInTheDocument();
  expect(screen.getByRole('img', { name: 'Work submitted: 26, In progress: 2, Not started: 1, Overdue: 3' })).toBeInTheDocument();
  const summary = screen.getByRole('region', { name: 'Daily summary' });
  expect(within(summary).getAllByRole('heading', { level: 2 }).map(item => item.textContent)).toEqual(['Team attendance', 'Today’s task progress', 'Needs attention']);
  expect(within(screen.getByRole('region', { name: 'Team attendance' })).getByText('18')).toBeInTheDocument();
  expect(screen.getByRole('region', { name: 'Today’s task progress' })).toHaveTextContent('26/ 32 Work submitted');
});
it.each([
  ['Work submitted 26', 'submitted'], ['In progress 2', 'in-progress'], ['Not started 1', 'not-started'], ['Overdue 3', 'overdue'],
])('preserves date/location and task filter for %s', (name, status) => {
  pulse(); const legend = screen.getByRole('navigation', { name: 'Task status' });
  expect(within(legend).getByRole('link', { name })).toHaveAttribute('href', `/today-status?locationId=7&date=2026-11-10&tab=tasks&status=${status}`);
  expect(params.toString()).toContain('page=3&taskId=9&q=old');
});
it('keeps attendance and all three scoped attention destinations', () => {
  pulse();
  expect(screen.getByRole('link', { name: 'View attendance' })).toHaveAttribute('href', '/today-status?locationId=7&date=2026-11-10&tab=staff');
  const links = within(screen.getByRole('navigation', { name: 'Needs attention' }));
  expect(links.getByRole('link', { name: 'Missing check-ins 1' })).toHaveAttribute('href', '/today-status?locationId=7&date=2026-11-10&tab=staff&attendance=absent');
  expect(links.getByRole('link', { name: 'Overdue tasks 3' })).toHaveAttribute('href', '/today-status?locationId=7&date=2026-11-10&tab=tasks&status=overdue');
  expect(links.getByRole('link', { name: 'Photo reviews 4' })).toHaveAttribute('href', '/exceptions?locationId=7&date=2026-11-10&queue=needs-me&period=date');
});
it('labels the bounded missing-check-in preview rather than subtracting future scheduled staff', () => {
  pulse({ ...base, metrics: { ...base.metrics, scheduled: 200, present: 1 } });
  expect(screen.getByRole('link', { name: 'Missing check-ins 1' })).toHaveAccessibleDescription('Missing check-ins is a preview. Open attendance for the full list.');
  expect(screen.queryByText('199')).not.toBeInTheDocument();
});
it.each([new URLSearchParams(), new URLSearchParams('date=today')])('uses today scope and today review period when the date is current: %s', scope => {
  pulse(base, 'en', scope);
  expect(screen.getByRole('link', { name: 'Photo reviews 4' })).toHaveAttribute('href', '/exceptions?date=today&queue=needs-me&period=today');
});
it('renders true zeros and guidance with valid accessible empty bars and reachable filters', () => {
  pulse({ ...base, metrics: { ...base.metrics, present: 0, scheduled: 0, totalTasks: 0, submitted: 0, reviewCount: 0 }, chart: { submitted: 0, inProgress: 0, notStarted: 0, overdue: 0 }, attention: [], tasks: [] });
  expect(screen.getByRole('img', { name: '0 of 0 scheduled staff checked in' })).toBeInTheDocument();
  expect(screen.getByRole('img', { name: 'Work submitted: 0, In progress: 0, Not started: 0, Overdue: 0' })).toBeInTheDocument();
  expect(screen.getByText('Nothing is scheduled yet')).toBeInTheDocument();
  expect(within(screen.getByRole('navigation', { name: 'Task status' })).getAllByRole('link')).toHaveLength(4);
  expect(screen.getByRole('link', { name: 'Photo reviews 0' })).toBeInTheDocument();
});
it('does not replace submitted work with verified or accepted totals', () => {
  pulse({ ...base, metrics: { ...base.metrics, verified: 32, accepted: 32 } });
  expect(screen.getByRole('link', { name: 'Work submitted 26' })).toBeInTheDocument();
  expect(screen.queryByText('Verified')).not.toBeInTheDocument(); expect(screen.queryByText('Complete')).not.toBeInTheDocument();
});
it('keeps the original aside guidance, missing-worker names, overdue and review links', () => {
  aside();
  expect(screen.getByText('Check expected attendance for this day.')).toBeInTheDocument();
  expect(screen.getByText('Original missing worker')).toBeInTheDocument();
  expect(screen.getByText('Past their scheduled end time')).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: '4 photo reviews need attention' })).toBeInTheDocument();
  expect(screen.getByText('Inspect the evidence and record a decision in your review workspace.')).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'View missing check-ins' })).toHaveAttribute('href', '/today-status?locationId=7&date=2026-11-10&tab=staff&attendance=absent');
  expect(screen.getByRole('link', { name: 'View overdue tasks' })).toHaveAttribute('href', '/today-status?locationId=7&date=2026-11-10&tab=tasks&status=overdue');
  expect(screen.getByRole('link', { name: 'Open Photo Reviews' })).toHaveAttribute('href', '/exceptions?locationId=7&date=2026-11-10&queue=needs-me&period=date');
});
it('lists two earliest upcoming tasks from the loaded snapshot, excluding submitted, cancelled, completed and already-started work', () => {
  const tasks = [task(3, { shiftStart: '2026-11-11T13:00:00Z' }), task(2), task(1, { shiftStart: '2026-11-11T11:00:00Z' }),
    task(4, { staffSubmittedAt: '2026-11-11T10:00:00Z' }), task(5, { status: 'CANCELLED' }), task(6, { status: 'COMPLETED' }), task(7, { shiftStart: base.asOf })];
  aside({ ...base, tasks });
  const upcoming = screen.getByRole('region', { name: 'Coming up' });
  expect(within(upcoming).getAllByRole('link').map(link => link.textContent)).toEqual([
    expect.stringContaining('Original room 1'), expect.stringContaining('Original room 2'),
  ]);
  expect(within(upcoming).queryByText('Original room 3')).not.toBeInTheDocument();
  expect(within(upcoming).getAllByRole('link')[0]).toHaveAttribute('href', '/today-status?locationId=7&date=2026-11-10&tab=tasks&taskId=1');
  expect(tasks.map(item => item.id)).toEqual([3, 2, 1, 4, 5, 6, 7]);
});
it('formats Coming up using each task’s location timezone and preserves title/unassigned fallbacks', () => {
  const entry = task(1, { areaNameSnapshot: null, staff: null, staffId: null, location: { ...site, timezone: 'America/New_York' } });
  aside({ ...base, tasks: [entry] });
  expect(screen.getByText(localTime(entry.shiftStart, entry.location.timezone))).toBeInTheDocument();
  expect(screen.getByText(entry.title)).toBeInTheDocument(); expect(screen.getByText('Unassigned')).toBeInTheDocument();
  expect(screen.getByText(site.name)).toBeInTheDocument();
});
it('shows the empty Coming up state without inventing future work', () => {
  aside({ ...base, tasks: [] });
  expect(screen.getByText('No upcoming tasks in the loaded summary.')).toBeInTheDocument();
  expect(within(screen.getByRole('region', { name: 'Coming up' })).queryByRole('link')).not.toBeInTheDocument();
});
it.each([0, 1])('keeps the review action for %s reviews with appropriate singular/plural copy', count => {
  aside({ ...base, metrics: { ...base.metrics, reviewCount: count } });
  expect(screen.getByRole('heading', { name: count ? '1 photo review needs attention' : '0 photo reviews need attention' })).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Open Photo Reviews' })).toBeInTheDocument();
  if (!count) expect(screen.queryByText('No issues right now')).not.toBeInTheDocument();
});
it('uses real router navigation for a summary status link', () => {
  const router = createMemoryRouter([{ path: '*', element: <TodayPulse data={base} params={params} /> }]);
  render(<LanguageProvider><RouterProvider router={router} /></LanguageProvider>);
  fireEvent.click(screen.getByRole('link', { name: 'Overdue 3' }));
  expect(router.state.location.pathname).toBe('/today-status'); expect(router.state.location.search).toBe('?locationId=7&date=2026-11-10&tab=tasks&status=overdue');
});
it('translates summary and aside while preserving record names in Urdu', () => {
  mount(<><TodayPulse data={base} params={params} /><TodayAside data={base} params={params} /></>, 'ur');
  expect(screen.getByRole('heading', { name: translate('Team attendance', 'ur') })).toBeInTheDocument();
  expect(screen.getByRole('img', { name: translate('{present} of {scheduled} scheduled staff checked in', 'ur', { present: 18, scheduled: 20 }) })).toBeInTheDocument();
  expect(screen.getByRole('navigation', { name: translate('Task status', 'ur') })).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: translate('Coming up', 'ur') })).toBeInTheDocument();
  expect(screen.getByRole('link', { name: translate('Open Photo Reviews', 'ur') })).toBeInTheDocument();
  expect(screen.getByText('Original worker نام')).toBeInTheDocument();
  expect(screen.getByText('Original missing worker')).toBeInTheDocument(); expect(document.documentElement.dir).toBe('rtl');
});
it('keeps mounted records and focus when the caller supplies refreshed counts', () => {
  const view = pulse(); const link = screen.getByRole('link', { name: 'View attendance' }); link.focus();
  view.rerender(<LanguageProvider><MemoryRouter><div className="workspace"><TodayPulse data={{ ...base, metrics: { ...base.metrics, present: 19 } }} params={params} /></div></MemoryRouter></LanguageProvider>);
  expect(screen.getByRole('img', { name: '19 of 20 scheduled staff checked in' })).toBeInTheDocument(); expect(link).toHaveFocus();
});
