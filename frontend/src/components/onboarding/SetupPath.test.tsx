import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it } from 'vitest';
import { LanguageProvider } from '@/i18n/LanguageProvider';
import { translate } from '@/i18n/translations';
import type { SetupSite } from '@/pages/Setup/api';
import SetupPath, { buildSetupSteps, type BuildSetupStepsInput } from './SetupPath';

function site(counts: Partial<SetupSite['counts']> = {}): SetupSite {
  return { id: 20, name: 'Synthetic site', timezone: 'Asia/Karachi', setupReady: false, reasons: [],
    counts: { staffWithShift: 0, activeAreas: 0, readySchedules: 0, tasksToday: 0, unassignedTasksToday: 0, ...counts } };
}
function Route() { return <output aria-label="Current route">{useLocation().pathname}{useLocation().search}</output>; }
function mount(input: BuildSetupStepsInput) {
  return render(<LanguageProvider><MemoryRouter><div className="workspace"><SetupPath steps={buildSetupSteps(input)} /><Route /></div></MemoryRouter></LanguageProvider>);
}
beforeEach(() => { localStorage.clear(); });

describe('saved setup rules', () => {
  it('keeps the four original titles, descriptions and order', () => {
    expect(buildSetupSteps({ owner: true, manageWork: true }).map(({ title, description }) => [title, description])).toEqual([
      ['Create a location', 'Set the site name, timezone and check-in area.'],
      ['Add staff and a shift', 'Assign staff to this location and confirm their working hours.'],
      ['Prepare an area template', 'Name the fixtures and required photo views.'],
      ['Create the first schedule', 'Use the existing daily or one-time schedule.'],
    ]);
  });
  it('keeps links without a location, enabling only owner location creation', () => {
    const steps = buildSetupSteps({ owner: true, manageWork: true });
    expect(steps.map(s => s.href)).toEqual(['/locations?create=1', '/staff', '/locations?tab=areas&newArea=1', '/locations?tab=templates&newSchedule=1']);
    expect(steps.map(s => s.allowed)).toEqual([true, false, false, false]);
    expect(steps.every(s => !s.done)).toBe(true);
  });
  it('keeps creation links scoped to the saved location', () => {
    const steps = buildSetupSteps({ selected: site(), owner: true, manageWork: true });
    expect(steps.map(s => s.href)).toEqual(['/locations/20', '/staff?locationId=20', '/locations/20?tab=areas&newArea=1', '/locations/20?tab=templates&newSchedule=1']);
    expect(steps.map(s => s.allowed)).toEqual([true, true, true, false]);
  });
  it.each([[0, 0, false], [1, 0, false], [0, 1, false], [1, 1, true]])('requires both staff shifts (%i) and areas (%i) for schedules', (staffWithShift, activeAreas, allowed) => {
    const step = buildSetupSteps({ selected: site({ staffWithShift: Number(staffWithShift), activeAreas: Number(activeAreas) }), owner: false, manageWork: true })[3];
    expect(step.allowed).toBe(allowed);
    expect(step.done).toBe(false);
    if (!allowed) expect(step.disabledReason).toBe('Prepare an area template and a staff shift first.');
  });
  it('uses review links for saved areas and schedules, without creation intent', () => {
    const steps = buildSetupSteps({ selected: site({ staffWithShift: 1, activeAreas: 1, readySchedules: 1 }), owner: false, manageWork: false });
    expect(steps.every(s => s.done && s.allowed)).toBe(true);
    expect(steps[2]).toMatchObject({ href: '/locations/20?tab=areas', action: 'Review area templates' });
    expect(steps[3]).toMatchObject({ href: '/locations/20?tab=templates', action: 'Review cleaning schedules' });
  });
  it.each([true, false])('keeps the read-only team and location review links for owner=%s', owner => {
    const steps = buildSetupSteps({ selected: site(), owner, manageWork: false });
    expect(steps.map(s => s.allowed)).toEqual([true, true, false, false]);
    expect(steps.every(s => s.primary === false)).toBe(true);
    expect(steps[2].disabledReason).toContain(owner ? 'Review plan activation' : 'Ask your company owner');
    expect(steps[3].hint).toBe('Prepare an area template and a staff shift first.');
  });
  it('fails closed when the server access flag is missing', () => {
    const steps = buildSetupSteps({ selected: site(), owner: true });
    expect(steps[2]).toMatchObject({ allowed: false, disabledReason: 'New-work access is unavailable' });
  });
  it('does not allow managers without an assigned location to create one', () => {
    const steps = buildSetupSteps({ owner: false, manageWork: true });
    expect(steps.every(s => !s.allowed)).toBe(true);
    expect(steps[0].disabledReason).toBe('Ask your owner to assign a location before setting up its team or schedules.');
  });
  it('does not mutate cached readiness or mark a step done from unrelated task counts', () => {
    const selected = site({ tasksToday: 99, unassignedTasksToday: 99 });
    const before = structuredClone(selected);
    const steps = buildSetupSteps({ selected, owner: true, manageWork: true });
    expect(selected).toEqual(before);
    expect(steps.map(s => s.done)).toEqual([true, false, false, false]);
    steps[0].done = false;
    expect(buildSetupSteps({ selected, owner: true, manageWork: true })[0].done).toBe(true);
  });
});

describe('SetupPath', () => {
  it('renders done, next and locked states with a single current step', () => {
    mount({ selected: site(), owner: true, manageWork: true });
    const rows = screen.getAllByRole('listitem');
    expect(rows).toHaveLength(4);
    expect(within(rows[0]).getByText('Configured')).toBeVisible();
    expect(rows[0]).not.toHaveAttribute('aria-current');
    expect(rows[1]).toHaveAttribute('aria-current', 'step');
    expect(screen.getAllByText('Not configured')).toHaveLength(3);
    expect(within(rows[1]).getByText('Use Edit on an existing team member to add their shift.')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Add cleaning schedule' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Add cleaning schedule' })).toHaveAccessibleDescription('Prepare an area template and a staff shift first.');
  });
  it('navigates through the real location-scoped team link', () => {
    mount({ selected: site(), owner: true, manageWork: true });
    fireEvent.click(screen.getByRole('link', { name: 'Open team and shifts' }));
    expect(screen.getByLabelText('Current route')).toHaveTextContent('/staff?locationId=20');
  });
  it('offers the creation deep link for an empty owner workspace', () => {
    mount({ owner: true, manageWork: true });
    expect(screen.getByRole('link', { name: 'Add location' })).toHaveAttribute('href', '/locations?create=1');
    expect(screen.getAllByRole('button')).toHaveLength(3);
    expect(screen.getByRole('listitem', { current: 'step' })).toHaveTextContent('Create a location');
    expect(screen.getByRole('button', { name: 'Add area template' })).toHaveAccessibleDescription('Create a location to begin. Nothing is marked complete until it is saved.');
  });
  it.each([true, false])('explains disabled read-only creation actions for owner=%s', owner => {
    mount({ selected: site(), owner, manageWork: false });
    const button = screen.getByRole('button', { name: 'Add area template' });
    expect(button).toBeDisabled();
    expect(button).toHaveAccessibleDescription(owner
      ? 'This workspace is read-only for new work. Review plan activation to add or change setup.'
      : 'This workspace is read-only for new work. Ask your company owner to review plan activation.');
    expect(screen.queryByRole('link', { name: 'Add area template' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open team and shifts' })).toBeVisible();
  });
  it('keeps every review action and has no current step when all four are done', () => {
    mount({ selected: site({ staffWithShift: 1, activeAreas: 1, readySchedules: 1 }), owner: true, manageWork: false });
    expect(screen.getAllByText('Configured')).toHaveLength(4);
    expect(screen.getAllByRole('link')).toHaveLength(4);
    expect(screen.queryByRole('listitem', { current: 'step' })).not.toBeInTheDocument();
  });
  it('translates its interface and access explanation under Urdu', () => {
    localStorage.setItem('hygene-ops.language', 'ur');
    mount({ selected: site(), owner: true, manageWork: false });
    expect(document.documentElement).toHaveAttribute('dir', 'rtl');
    expect(screen.getByRole('list', { name: translate('Your setup checklist', 'ur') })).toBeVisible();
    expect(screen.getByRole('heading', { name: translate('Prepare an area template', 'ur') })).toBeVisible();
    expect(screen.getByRole('button', { name: translate('Add area template', 'ur') })).toHaveAccessibleDescription(translate('This workspace is read-only for new work. Review plan activation to add or change setup.', 'ur'));
  });
  it('associates disabled reasons uniquely across two independent instances', () => {
    const steps = buildSetupSteps({ owner: true, manageWork: false });
    render(<LanguageProvider><MemoryRouter><SetupPath steps={steps} /><SetupPath steps={steps} /></MemoryRouter></LanguageProvider>);
    const ids = screen.getAllByRole('button').map(button => button.getAttribute('aria-describedby'));
    expect(new Set(ids).size).toBe(8);
    screen.getAllByRole('button').forEach(button => expect(button).toHaveAccessibleDescription());
  });
});
