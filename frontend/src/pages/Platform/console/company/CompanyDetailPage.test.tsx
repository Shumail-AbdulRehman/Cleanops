import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getCompany, type CompanyDetail } from '../../companyApi';
import { getInquiries } from '../../serviceApi';
import { getConsoleCompanyInsights, type PlatformCompanyInsightsResponse } from '../api/consoleApi';
import { CompanyDetailLayout, CompanyDetailPage } from './CompanyDetailPage';

vi.mock('../../companyApi', () => ({ getCompany: vi.fn(), setCompanyStatus: vi.fn() }));
vi.mock('../../serviceApi', () => ({ getInquiries: vi.fn() }));
vi.mock('../api/consoleApi', () => ({ getConsoleCompanyInsights: vi.fn() }));

const customerId = 'ctm_0123456789abcdefghijklmnop';
const detail: CompanyDetail = {
  company: {
    id: 42, name: 'Example Services', plan: 'PRO', isActive: true, operationalStatus: 'ACTIVE',
    accountVersion: 1, createdAt: '2026-01-02T00:00:00Z', updatedAt: '2026-11-19T00:00:00Z',
    suspendedAt: null, suspensionReason: null, counts: { managers: 2, staff: 12, locations: 4 },
  },
  operationalReadAllowed: true,
  billingConfigured: true,
  mirroredSubscriptionStatus: 'ACTIVE',
  providerState: 'MIRRORED',
  subscription: {
    status: 'active', plan: 'PRO', catalogQualified: true, periodStart: '2026-11-01T00:00:00Z',
    periodEnd: '2026-12-01T00:00:00Z', canceledAt: null, pausedAt: null, scheduledChangeAction: null,
    scheduledChangeAt: null, lastEventAt: '2026-11-01T00:00:00Z', mirroredAt: '2026-11-01T00:00:00Z',
  },
  activity: [],
};

const days = Array.from({ length: 35 }, (_, index) => ({
  day: new Date(Date.UTC(2026, 9, 16 + index)).toISOString().slice(0, 10),
  count: index % 7,
}));
const insights: PlatformCompanyInsightsResponse = {
  owner: { name: 'Example Owner', email: 'owner@example.test' },
  limits: { managers: 3, staff: 25, locations: 5 },
  usage: { managers: 2, staff: 12, locations: 4 },
  lastActiveAt: '2026-11-19T00:00:00Z',
  activity30: days.slice(-30),
  calendar35: days,
  photos: { passed: 23, retake: 5, manager: 3, cleaning: 1 },
  onTimeShare: 0.5,
  payments: [
    { id: 'one', date: '2026-10-01T00:00:00Z', invoice: 'INV-1', amount: { amount: 45, currency: 'USD' }, status: 'PAID' },
    { id: 'two', date: '2026-11-01T00:00:00Z', invoice: 'INV-2', amount: null, status: 'PAST_DUE' },
  ],
  paidToDate: { amount: 45, currency: 'USD' },
  paddle: { customerUrl: `https://vendors.paddle.com/customers/${customerId}` },
};

function CompaniesDestination() {
  const { search } = useLocation();
  return <p>{`Companies search ${search}`}</p>;
}

function renderPage(path = '/platform/companies/42') {
  const client = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/platform/companies" element={<CompaniesDestination />} />
          <Route path="/platform/companies/:id" element={<CompanyDetailLayout />}>
            <Route index element={<CompanyDetailPage />} />
          </Route>
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(getCompany).mockResolvedValue(detail);
  vi.mocked(getConsoleCompanyInsights).mockResolvedValue(insights);
  vi.mocked(getInquiries).mockResolvedValue({ items: [], nextCursor: null });
});

afterEach(() => vi.unstubAllGlobals());

describe('CompanyDetailPage', () => {
  it('renders all seven panels with the company name in the shell', async () => {
    renderPage();
    expect(await screen.findByRole('heading', { level: 1, name: 'Example Services' })).toBeVisible();
    await screen.findByRole('region', { name: 'Usage against plan' });
    for (const name of ['Usage against plan', 'Activity', 'Payments', 'Account', 'Subscription', 'Work quality', 'Platform history']) {
      expect(screen.getByRole('region', { name })).toBeVisible();
    }
    expect(getCompany).toHaveBeenCalledWith(42, expect.any(AbortSignal));
    expect(getConsoleCompanyInsights).toHaveBeenCalledWith(42, expect.any(AbortSignal));

    const account = within(screen.getByRole('region', { name: 'Account' }));
    expect(account.getByText('Example Owner')).toBeVisible();
    expect(account.getByRole('link', { name: 'owner@example.test' })).toHaveAttribute('href', 'mailto:owner@example.test');
    expect(account.queryByText(/phone/i)).toBeNull();

    const subscription = within(screen.getByRole('region', { name: 'Subscription' }));
    expect(subscription.getByText('View only')).toBeVisible();
    expect(subscription.getByText(customerId)).toBeVisible();
    expect(subscription.getByText('Nov 1, 2026 to Dec 1, 2026')).toBeVisible();
    expect(subscription.getAllByText('Not available')).toHaveLength(2);
    expect(subscription.getByText(/signed webhook/)).toBeVisible();
    expect(subscription.queryByRole('button')).toBeNull();
    expect(subscription.queryByRole('link')).toBeNull();
  });

  it('lists payments newest first and displays paid to date and unknown amounts', async () => {
    renderPage();
    const payments = within(await screen.findByRole('region', { name: 'Payments' }));
    expect(payments.getByText('$45', { selector: 'strong' })).toBeVisible();
    expect(payments.getByText('paid to date')).toBeVisible();
    const [, newest, oldest] = within(payments.getByRole('table')).getAllByRole('row');
    expect(within(newest).getByText('INV-2')).toBeVisible();
    expect(within(newest).getByText('Past due')).toBeVisible();
    expect(within(newest).getByText('Not available')).toBeVisible();
    expect(within(oldest).getByText('INV-1')).toBeVisible();
    expect(within(oldest).getByText('Paid')).toBeVisible();
  });

  it('includes the suspension and reactivation audit entries before company creation', async () => {
    vi.mocked(getCompany).mockResolvedValue({
      ...detail,
      company: {
        ...detail.company, operationalStatus: 'SUSPENDED', suspendedAt: '2026-11-19T04:00:00Z',
        suspensionReason: 'Owner requested a pause.',
      },
      activity: [
        { id: 7, action: 'COMPANY_SUSPENDED', reason: 'Owner requested a pause.', createdAt: '2026-11-19T04:00:00Z' },
        { id: 6, action: 'COMPANY_REACTIVATED', reason: 'Account review completed.', createdAt: '2026-11-01T00:00:00Z' },
      ],
    });
    renderPage();
    const history = within(await screen.findByRole('region', { name: 'Platform history' }));
    const [suspension, reactivation, creation] = history.getAllByRole('listitem');
    expect(suspension).toHaveTextContent('Company suspended');
    expect(suspension).toHaveTextContent('Nov 19, 2026');
    expect(suspension).toHaveTextContent('Owner requested a pause.');
    expect(reactivation).toHaveTextContent('Company reactivated');
    expect(reactivation).toHaveTextContent('Account review completed.');
    expect(creation).toHaveTextContent('Company created');
    expect(screen.getByRole('button', { name: 'Reactivate' })).toBeVisible();
  });

  it('shows the never-paid and unused company states', async () => {
    vi.mocked(getCompany).mockResolvedValue({ ...detail, providerState: 'NOT_LINKED', subscription: null });
    vi.mocked(getConsoleCompanyInsights).mockResolvedValue({
      ...insights, owner: null, lastActiveAt: null, paddle: null, payments: [], paidToDate: null,
    });
    renderPage();
    const subscription = within(await screen.findByRole('region', { name: 'Subscription' }));
    expect(subscription.getByText('This company has not paid for a subscription.')).toBeVisible();
    expect(subscription.queryByText('Price')).toBeNull();
    expect(screen.getByText('No activity yet')).toBeVisible();
    expect(screen.getByText('No payments yet.')).toBeVisible();
    expect(screen.queryByRole('region', { name: 'Work quality' })).toBeNull();
  });

  it('shows a skeleton while either read is pending', () => {
    vi.mocked(getConsoleCompanyInsights).mockImplementation(() => new Promise(() => {}));
    renderPage();
    expect(screen.getByRole('status', { name: 'Loading company details' })).toBeVisible();
    expect(screen.queryByRole('region', { name: 'Account' })).toBeNull();
  });

  it('shows not found for a 404 and links back to the opening Companies filters', async () => {
    vi.mocked(getCompany).mockRejectedValue(Object.assign(new Error(), { status: 404 }));
    vi.stubGlobal('navigation', {
      currentEntry: { index: 1 },
      entries: () => [{ url: `${window.location.origin}/platform/companies?q=example&plan=PRO` }, {}],
    });
    renderPage();
    expect(await screen.findByText('Company not found.')).toBeVisible();
    const back = within(screen.getByRole('banner')).getByRole('link', { name: 'Companies' });
    expect(back).toHaveAttribute('href', '/platform/companies?q=example&plan=PRO');
    fireEvent.click(back);
    expect(screen.getByText('Companies search ?q=example&plan=PRO')).toBeVisible();
  });

  it('handles an invalid route ID without loading either endpoint', () => {
    renderPage('/platform/companies/0');
    expect(screen.getByText('Company not found.')).toBeVisible();
    expect(getCompany).not.toHaveBeenCalled();
    expect(getConsoleCompanyInsights).not.toHaveBeenCalled();
  });

  it('retries an unsuccessful read and then displays the record', async () => {
    vi.mocked(getCompany).mockRejectedValueOnce(Object.assign(new Error(), { status: 503 }));
    renderPage();
    expect(await screen.findByRole('alert')).toHaveTextContent('Company details could not be loaded.');
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByRole('region', { name: 'Account' })).toBeVisible();
    expect(getCompany).toHaveBeenCalledTimes(2);
  });
});
