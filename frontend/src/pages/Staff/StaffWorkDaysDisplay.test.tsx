import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { expect, it, vi } from 'vitest';
import { LanguageProvider } from '@/i18n/LanguageProvider';
import { translate, type Language } from '@/i18n/translations';
import { WEEKDAYS, type Weekday } from '@/lib/workDays';
import LocationStaffTab from '../Location/LocationStaffTab';
import StaffDetailPage from './StaffDetailPage';
import type { StaffProfileData } from './StaffOverviewTab';
import StaffPage from './StaffPage';

const queries = vi.hoisted(() => ({ staff: vi.fn(), details: vi.fn(), locations: vi.fn() }));
vi.mock('./queries', () => ({ useGetStaff: queries.staff, useGetStaffDetails: queries.details }));
vi.mock('../Location/queries', () => ({ useGetLocations: queries.locations }));
vi.mock('@/hooks/useAuth', () => ({ default: () => ({ user: { id: 1, companyId: 1, role: 'ADMIN' } }) }));

const site = { id: 2, name: 'Main site', timezone: 'UTC', isActive: true };

function renderDisplays(workDays: Weekday[] | undefined, language: Language = 'en') {
  const staff: StaffProfileData = {
    id: 7, name: 'Example worker', email: null, role: 'STAFF', isActive: true,
    locationId: site.id, location: site, workDays,
    shiftStart: '2026-11-23T09:00:00Z', shiftEnd: '2026-11-23T17:00:00Z',
    createdAt: '2026-11-01T00:00:00Z', periodLabel: 'November 2026',
    taskStats: { totalTemplates: 0, totalInstances: 0, completed: 0, pending: 0, inProgress: 0, missed: 0 },
    attendanceStats: { totalRecords: 0, present: 0, absent: 0, late: 0 },
    taskTemplates: [], taskInstances: [], attendances: [],
  };
  queries.staff.mockReturnValue({ data: { data: [staff] } });
  queries.details.mockReturnValue({ data: { data: staff }, isFetching: false });
  queries.locations.mockReturnValue({ data: { data: [site] } });
  localStorage.setItem('hygene-ops.language', language);

  render(<QueryClientProvider client={new QueryClient()}>
    <LanguageProvider>
      <MemoryRouter initialEntries={['/staff/7?month=2026-11']}>
        <Routes><Route path="/staff/:id" element={<>
          <StaffPage />
          <StaffDetailPage />
          <LocationStaffTab locationInfo={{ ...site, staff: [staff] }} locationTz={site.timezone}
            staffAdded={false} setStaffAdded={vi.fn()} staffDialogOpen={false} setStaffDialogOpen={vi.fn()} />
        </>} /></Routes>
      </MemoryRouter>
    </LanguageProvider>
  </QueryClientProvider>);

  const t = (key: string) => translate(key, language);
  const team = within(screen.getByRole('region', { name: t('Your team') }));
  const header = within(screen.getByRole('banner'));
  const profile = within(screen.getByRole('region', { name: t('Profile') }));
  const location = within(screen.getByRole('region', { name: t('Staff and shifts') }));
  return {
    team: team.getByText('09:00–17:00').parentElement!,
    header: header.getByText('09:00 (UTC) – 17:00 (UTC)').parentElement!,
    overview: within(profile.getByText(t('Shift')).parentElement!).getByRole('definition'),
    location: location.getByRole('cell', { name: /09:00 – 17:00/ }),
    workDays: within(profile.getByText(t('Work days')).parentElement!).getByRole('definition'),
  };
}

it('shows the chosen work days next to each shift and in the overview work days fact', () => {
  const displays = renderDisplays(['MON', 'WED']);
  expect(displays.team).toHaveTextContent('09:00–17:00 · Mon, Wed · UTC');
  expect(displays.header).toHaveTextContent('09:00 (UTC) – 17:00 (UTC) · Mon, Wed');
  expect(displays.overview).toHaveTextContent('09:00 – 17:00 (UTC) · Mon, Wed');
  expect(displays.location).toHaveTextContent('09:00 – 17:00 · Mon, Wed');
  expect(displays.workDays).toHaveTextContent(/^Mon, Wed$/);
});

it.each([
  { label: 'all seven days', days: [...WEEKDAYS] },
  { label: 'missing days', days: undefined },
  { label: 'an empty legacy list', days: [] },
])('keeps the original shift text and shows Every day for $label', ({ days }) => {
  const displays = renderDisplays(days);
  expect(displays.team).toHaveTextContent(/^09:00–17:00 · UTC$/);
  expect(displays.header).toHaveTextContent(/^09:00 \(UTC\) – 17:00 \(UTC\)$/);
  expect(displays.overview).toHaveTextContent(/^09:00 – 17:00 \(UTC\)$/);
  expect(displays.location).toHaveTextContent(/09:00 – 17:00$/);
  expect(displays.workDays).toHaveTextContent(/^Every day$/);
});

it('isolates translated Urdu day names beside each shift', () => {
  const { team, header, overview, location, workDays } = renderDisplays(['MON', 'WED'], 'ur');
  for (const shift of [team, header, overview, location]) {
    expect(shift).toHaveTextContent(' · پیر، بدھ');
    expect(within(shift).getByText('پیر، بدھ').tagName).toBe('BDI');
  }
  expect(workDays).toHaveTextContent(/^پیر، بدھ$/);
});
