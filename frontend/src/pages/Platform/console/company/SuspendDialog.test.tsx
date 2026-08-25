import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setCompanyStatus, type CompanyDetail, type CompanySummary } from '../../companyApi';
import { operatorQueryScope } from '../../operatorSession';
import { CompanyHeader } from './CompanyHeader';

vi.mock('../../companyApi', () => ({ setCompanyStatus: vi.fn() }));

const company: CompanySummary = {
  id: 42,
  name: 'Example Company',
  plan: 'STARTER',
  isActive: true,
  operationalStatus: 'ACTIVE',
  accountVersion: 3,
  createdAt: '2026-01-03T08:00:00Z',
  updatedAt: '2026-01-03T08:00:00Z',
  counts: { managers: 1, staff: 2, locations: 1 },
};

const detail: CompanyDetail = {
  company: { ...company, suspendedAt: null, suspensionReason: null },
  operationalReadAllowed: true,
  billingConfigured: true,
  mirroredSubscriptionStatus: 'NONE',
  providerState: 'NOT_LINKED',
  subscription: null,
  activity: [],
};

const suspendedCompany: CompanySummary = { ...company, operationalStatus: 'SUSPENDED', accountVersion: 4 };
const suspensionReason = 'Owner requested a pause.';
const suspendedDetail: CompanyDetail = {
  ...detail,
  company: {
    ...suspendedCompany,
    suspendedAt: '2026-11-20T11:00:00Z',
    suspensionReason,
  },
};

function renderHeader(initialDetail = detail, refreshedDetail = initialDetail) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  const getDetail = vi.fn(async () => refreshedDetail);
  const insightsKey = [...operatorQueryScope, 'console', 'company-insights', initialDetail.company.id];
  const anotherScope = ['tenant', 'companies'];
  queryClient.setQueryData(insightsKey, { lastActiveAt: null, paddle: null });
  queryClient.setQueryData(anotherScope, []);

  function Header() {
    const result = useQuery({
      queryKey: [...operatorQueryScope, 'companies', initialDetail.company.id],
      queryFn: getDetail,
      initialData: initialDetail,
    });
    return <CompanyHeader detail={result.data} />;
  }

  render(<QueryClientProvider client={queryClient}><Header /></QueryClientProvider>);
  return { queryClient, getDetail, insightsKey, anotherScope };
}

describe('SuspendDialog', () => {
  beforeEach(() => {
    vi.mocked(setCompanyStatus).mockReset();
  });

  it('lists the three effects and requires a non-blank reason', () => {
    renderHeader();
    fireEvent.click(screen.getByRole('button', { name: 'Suspend company' }));
    const dialog = screen.getByRole('dialog', { name: 'Suspend Example Company?' });
    const effects = within(dialog).getAllByRole('listitem');
    expect(effects).toHaveLength(3);
    expect(effects[0]).toHaveTextContent('can still sign in, see billing and change their own password');
    expect(effects[1]).toHaveTextContent('cannot open records, start or finish tasks, or check in');
    expect(effects[2]).toHaveTextContent('Paddle keeps billing them');
    const submit = within(dialog).getByRole('button', { name: 'Suspend company' });
    expect(submit).toBeDisabled();
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Reason' }), { target: { value: '   ' } });
    expect(submit).toBeDisabled();
    fireEvent.click(submit);
    expect(setCompanyStatus).not.toHaveBeenCalled();
  });

  it('sends the reason and version, refreshes operator reads and focuses the suspended banner', async () => {
    vi.mocked(setCompanyStatus).mockResolvedValue({ company: suspendedCompany, changed: true });
    const { queryClient, getDetail, insightsKey, anotherScope } = renderHeader(detail, suspendedDetail);
    fireEvent.click(screen.getByRole('button', { name: 'Suspend company' }));
    const dialog = screen.getByRole('dialog', { name: 'Suspend Example Company?' });
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Reason' }), {
      target: { value: '  Owner requested a pause.  ' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Suspend company' }));

    expect(await screen.findByText('Example Company is suspended.')).toBeVisible();
    expect(setCompanyStatus).toHaveBeenCalledExactlyOnceWith(42, {
      operationalStatus: 'SUSPENDED',
      expectedVersion: 3,
      reason: 'Owner requested a pause.',
    });
    expect(getDetail).toHaveBeenCalledTimes(1);
    expect(queryClient.getQueryState(insightsKey)?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(anotherScope)?.isInvalidated).toBe(false);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    const banner = screen.getByRole('region', { name: 'Account suspended on Nov 20, 2026' });
    await waitFor(() => expect(banner).toHaveFocus());
  });

  it('reactivates with the suspended version and puts focus on Suspend company', async () => {
    const reactivatedDetail = { ...detail, company: { ...detail.company, accountVersion: 5 } };
    vi.mocked(setCompanyStatus).mockResolvedValue({ company: reactivatedDetail.company, changed: true });
    renderHeader(suspendedDetail, reactivatedDetail);
    fireEvent.click(screen.getByRole('button', { name: 'Reactivate' }));
    const dialog = screen.getByRole('dialog', { name: 'Reactivate Example Company?' });
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Reason' }), {
      target: { value: 'Owner approved.' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Reactivate' }));

    expect(await screen.findByText('Example Company is active again.')).toBeVisible();
    expect(setCompanyStatus).toHaveBeenCalledExactlyOnceWith(42, {
      operationalStatus: 'ACTIVE',
      expectedVersion: 4,
      reason: 'Owner approved.',
    });
    const opener = screen.getByRole('button', { name: 'Suspend company' });
    await waitFor(() => expect(opener).toHaveFocus());
  });

  it('keeps the confirmed status when refreshing the detail fails', async () => {
    vi.mocked(setCompanyStatus).mockResolvedValue({ company: suspendedCompany, changed: true });
    const { getDetail } = renderHeader();
    getDetail.mockRejectedValueOnce(new Error('Detail unavailable'));
    fireEvent.click(screen.getByRole('button', { name: 'Suspend company' }));
    const dialog = screen.getByRole('dialog', { name: 'Suspend Example Company?' });
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Reason' }), {
      target: { value: suspensionReason },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Suspend company' }));

    expect(await screen.findByText('Example Company is suspended.')).toBeVisible();
    const banner = screen.getByRole('region', { name: 'Account suspended' });
    expect(within(banner).getByText('Suspension date · Not available')).toBeVisible();
    expect(within(banner).getByText(suspensionReason)).toBeVisible();
    await waitFor(() => expect(banner).toHaveFocus());
  });

  it('keeps the dialog and reason on a version conflict and asks the operator to reload', async () => {
    vi.mocked(setCompanyStatus).mockRejectedValue(Object.assign(new Error('Conflict'), { status: 409 }));
    const { getDetail } = renderHeader();
    fireEvent.click(screen.getByRole('button', { name: 'Suspend company' }));
    const dialog = screen.getByRole('dialog', { name: 'Suspend Example Company?' });
    const reason = within(dialog).getByRole('textbox', { name: 'Reason' });
    const submit = within(dialog).getByRole('button', { name: 'Suspend company' });
    fireEvent.change(reason, { target: { value: 'Owner requested a pause.' } });
    fireEvent.click(submit);
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'This company changed. Reload before trying again.',
    );
    expect(reason).toHaveValue('Owner requested a pause.');
    expect(submit).toBeDisabled();
    expect(getDetail).not.toHaveBeenCalled();
  });

  it('traps keyboard focus, closes on Escape and restores the opener', async () => {
    renderHeader();
    const opener = screen.getByRole('button', { name: 'Suspend company' });
    opener.focus();
    fireEvent.click(opener);
    const dialog = screen.getByRole('dialog', { name: 'Suspend Example Company?' });
    const reason = within(dialog).getByRole('textbox', { name: 'Reason' });
    const cancel = within(dialog).getByRole('button', { name: 'Cancel' });
    expect(reason).toHaveFocus();
    fireEvent.keyDown(reason, { key: 'Tab', shiftKey: true });
    expect(cancel).toHaveFocus();
    fireEvent.keyDown(cancel, { key: 'Tab' });
    expect(reason).toHaveFocus();
    fireEvent.keyDown(reason, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await waitFor(() => expect(opener).toHaveFocus());
  });
});
