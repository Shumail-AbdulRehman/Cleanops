import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlatformCompaniesResponse, PlatformCompanyListItem } from '../api/consoleApi';
import { useConsoleCompanies, useConsoleOverview } from '../api/consoleQueries';
import { CompaniesListPage } from './CompaniesListPage';

vi.mock('../api/consoleQueries', () => ({
  useConsoleCompanies: vi.fn(),
  useConsoleOverview: vi.fn(),
}));

const company: PlatformCompanyListItem = {
  id: 1,
  name: 'Test Company One',
  plan: 'STARTER',
  isActive: true,
  operationalStatus: 'ACTIVE',
  accountVersion: 1,
  createdAt: '2026-11-01T08:00:00.000Z',
  updatedAt: '2026-11-01T08:00:00.000Z',
  counts: { managers: 1, staff: 3, locations: 1 },
  limits: { managers: 1, staff: 3, locations: 1 },
  owner: { name: 'Test Owner', email: 'owner@example.test' },
  subscription: 'NONE',
  monthly: null,
  activity14: [],
  lastActiveAt: null,
};

function response(data: PlatformCompaniesResponse) {
  return { data } as ReturnType<typeof useConsoleCompanies>;
}

function LocationDisplay() {
  const { pathname, search } = useLocation();
  return <output aria-label="Current URL">{pathname}{search}</output>;
}

function renderPage(search = '') {
  render(
    <MemoryRouter initialEntries={[`/platform/companies${search}`]}>
      <Routes>
        <Route path="/platform/companies" element={<CompaniesListPage />} />
        <Route path="/platform/companies/:id" element={<h1>Company details</h1>} />
      </Routes>
      <LocationDisplay />
    </MemoryRouter>,
  );
}

function currentParams() {
  const url = screen.getByLabelText('Current URL').textContent ?? '';
  return new URL(url, 'http://localhost').searchParams;
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(useConsoleOverview).mockReturnValue({} as ReturnType<typeof useConsoleOverview>);
  vi.mocked(useConsoleCompanies).mockReturnValue(response({ items: [company], nextCursor: null }));
});

afterEach(cleanup);

describe('CompaniesListPage', () => {
  it('writes the search and all three filters to the URL and the query, clearing the cursor', () => {
    renderPage('?after=25');
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search companies' }), { target: { value: 'Test Co' } });

    for (const [name, option] of [
      ['Plan: All plans', 'Pro'],
      ['Subscription: Any subscription', 'Active'],
      ['Account status: Any account status', 'Suspended'],
    ]) {
      fireEvent.keyDown(screen.getByRole('button', { name }), { key: 'Enter' });
      fireEvent.click(screen.getByRole('menuitemradio', { name: option }));
    }

    const filters = { q: 'Test Co', plan: 'PRO', subscription: 'ACTIVE', status: 'SUSPENDED' };
    expect(Object.fromEntries(currentParams())).toEqual(filters);
    expect(useConsoleCompanies).toHaveBeenLastCalledWith({ ...filters, after: undefined });

    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(currentParams().size).toBe(0);
    expect(useConsoleCompanies).toHaveBeenLastCalledWith({});
  });

  it('preselects Past due from an Overview link and shows both subscription and suspension', () => {
    vi.mocked(useConsoleCompanies).mockReturnValue(response({
      items: [{
        ...company,
        subscription: 'PAST_DUE',
        operationalStatus: 'SUSPENDED',
        monthly: { currency: 'USD', amount: 18 },
        activity14: [{ day: '2026-11-18', count: 4 }],
      }],
      nextCursor: null,
    }));
    renderPage('?subscription=PAST_DUE');

    expect(screen.getByRole('button', { name: 'Subscription: Past due' })).toBeVisible();
    expect(useConsoleCompanies).toHaveBeenLastCalledWith({ subscription: 'PAST_DUE' });
    const row = within(screen.getByRole('row', { name: /Test Company One/ }));
    expect(row.getByText('Past due')).toBeVisible();
    expect(row.getByText('Account suspended')).toBeVisible();
    expect(row.getByText('$18')).toBeVisible();
    expect(row.getByRole('img', { name: /Task activity over 14 days: Nov 18, 2026: 4/ })).toBeVisible();
  });

  it('shows the owner, a one-location ratio without a meter and the never-paid state', () => {
    renderPage();

    const row = within(screen.getByRole('row', { name: /Test Company One/ }));
    expect(row.getByText('Test Owner')).toBeVisible();
    expect(row.getByText('Never paid')).toBeVisible();
    expect(row.getByText('No work yet')).toBeVisible();
    expect(row.getByText('1 / 1')).toBeVisible();
    expect(row.queryByRole('meter', { name: 'Location usage' })).not.toBeInTheDocument();
    expect(row.getByRole('meter', { name: 'Staff usage' })).toHaveAttribute('aria-valuetext', '3 of 3');
    expect(row.getByText('—')).toBeVisible();
    expect(row.getAllByText('Not available')).toHaveLength(2);
  });

  it('uses a focusable row link with native Enter activation to open the company', () => {
    renderPage();
    const link = screen.getByRole('link', { name: 'Open Test Company One' });
    link.focus();
    expect(link).toHaveFocus();
    expect(fireEvent.keyDown(link, { key: 'Enter' })).toBe(true);
    // jsdom does not dispatch the click that follows native keyboard activation.
    fireEvent.click(link);

    expect(screen.getByRole('heading', { name: 'Company details' })).toBeVisible();
    expect(screen.getByLabelText('Current URL')).toHaveTextContent('/platform/companies/1');
  });

  it('shows the loading skeleton', () => {
    vi.mocked(useConsoleCompanies).mockReturnValue({ isPending: true } as ReturnType<typeof useConsoleCompanies>);
    renderPage();

    expect(screen.getByRole('status', { name: 'Loading companies' })).toBeVisible();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('shows the new-platform state when an unfiltered result is empty', () => {
    vi.mocked(useConsoleCompanies).mockReturnValue(response({ items: [], nextCursor: null }));
    renderPage();

    expect(screen.getByText('No companies yet.')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Clear' })).not.toBeInTheDocument();
  });

  it('offers Clear when no companies match and removes the filter', () => {
    vi.mocked(useConsoleCompanies).mockImplementation(({ plan } = {}) =>
      response({ items: plan ? [] : [company], nextCursor: null }));
    renderPage('?plan=ADVANCED');

    expect(screen.getByText('No companies match these filters.')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
    expect(screen.getByRole('link', { name: 'Open Test Company One' })).toBeVisible();
    expect(currentParams().size).toBe(0);
  });

  it('offers Retry after a request fails', () => {
    const refetch = vi.fn();
    vi.mocked(useConsoleCompanies).mockReturnValue({ isError: true, refetch } as unknown as ReturnType<typeof useConsoleCompanies>);
    renderPage();

    expect(screen.getByRole('alert')).toHaveTextContent('Companies could not be loaded.');
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('requests each Next cursor and restores prior cursors with Previous', () => {
    vi.mocked(useConsoleCompanies).mockImplementation(({ after } = {}) =>
      response({ items: [company], nextCursor: after === '50' ? null : after === '25' ? '50' : '25' }));
    renderPage('?plan=STARTER');
    const previous = screen.getByRole('button', { name: 'Previous' });
    const next = screen.getByRole('button', { name: 'Next' });
    expect(previous).toBeDisabled();

    fireEvent.click(next);
    expect(currentParams().get('after')).toBe('25');
    expect(useConsoleCompanies).toHaveBeenLastCalledWith({ plan: 'STARTER', after: '25' });
    fireEvent.click(next);
    expect(next).toBeDisabled();
    expect(useConsoleCompanies).toHaveBeenLastCalledWith({ plan: 'STARTER', after: '50' });

    fireEvent.click(previous);
    expect(useConsoleCompanies).toHaveBeenLastCalledWith({ plan: 'STARTER', after: '25' });
    fireEvent.click(previous);
    expect(previous).toBeDisabled();
    expect(currentParams().has('after')).toBe(false);
    expect(useConsoleCompanies).toHaveBeenLastCalledWith({ plan: 'STARTER' });
  });
});
