import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { CompanyDetail } from '../../companyApi';
import { CompanyHeader } from './CompanyHeader';

const detail: CompanyDetail = {
  company: {
    id: 42,
    name: 'Example Company',
    plan: 'PRO',
    isActive: true,
    operationalStatus: 'ACTIVE',
    accountVersion: 3,
    createdAt: '2026-01-02T21:00:00Z',
    updatedAt: '2026-01-02T21:00:00Z',
    suspendedAt: null,
    suspensionReason: null,
    counts: { managers: 1, staff: 2, locations: 1 },
  },
  operationalReadAllowed: true,
  billingConfigured: true,
  mirroredSubscriptionStatus: 'ACTIVE',
  providerState: 'MIRRORED',
  subscription: {
    status: 'active',
    plan: 'PRO',
    catalogQualified: true,
    periodStart: null,
    periodEnd: null,
    canceledAt: null,
    pausedAt: null,
    scheduledChangeAction: null,
    scheduledChangeAt: null,
    lastEventAt: '2026-01-02T21:00:00Z',
    mirroredAt: '2026-01-02T21:00:00Z',
  },
  activity: [],
};

describe('CompanyHeader', () => {
  it('shows the plan, subscription and account independently and uses the server Paddle URL', () => {
    const customerUrl = 'https://vendors.paddle.com/customers/ctm_header_test';
    render(<CompanyHeader detail={detail} insights={{
      lastActiveAt: new Date().toISOString(),
      paddle: { customerUrl },
    }} />);

    expect(screen.getByText('Pro plan')).toBeVisible();
    expect(screen.getByText('Subscription active')).toBeVisible();
    expect(screen.getByText('Account active')).toBeVisible();
    expect(screen.getByText('Company #42')).toBeVisible();
    expect(screen.getByText('Signed up Jan 3, 2026')).toBeVisible();
    expect(screen.getByText('Last active Today')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Suspend company' })).toBeEnabled();
    const link = screen.getByRole('link', { name: 'Open in Paddle' });
    expect(link).toHaveAttribute('href', customerUrl);
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener');
  });

  it('shows the date, reason and reactivation action for a suspended account', () => {
    render(<CompanyHeader detail={{
      ...detail,
      company: {
        ...detail.company,
        operationalStatus: 'SUSPENDED',
        suspendedAt: '2026-11-20T11:00:00Z',
        suspensionReason: 'Owner requested a pause.',
      },
    }} />);

    const banner = screen.getByRole('region', { name: 'Account suspended on Nov 20, 2026' });
    expect(within(banner).getByText('Owner requested a pause.')).toBeVisible();
    expect(within(banner).getByRole('button', { name: 'Reactivate' })).toBeEnabled();
    expect(screen.getByText('Subscription active')).toBeVisible();
    expect(screen.getByText('Account suspended')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Suspend company' })).not.toBeInTheDocument();
  });

  it('uses the unavailable fallback and omits Paddle while insights is missing or has null fields', () => {
    const { rerender } = render(<CompanyHeader detail={detail} />);
    expect(screen.getByText('Last active Not available')).toBeVisible();
    expect(screen.queryByRole('link', { name: 'Open in Paddle' })).not.toBeInTheDocument();

    rerender(<CompanyHeader detail={detail} insights={{ lastActiveAt: null, paddle: null }} />);
    expect(screen.getByText('Last active Not available')).toBeVisible();
    expect(screen.queryByRole('link', { name: 'Open in Paddle' })).not.toBeInTheDocument();
  });

  it('shows no subscription for a company without one', () => {
    render(<CompanyHeader detail={{ ...detail, subscription: null }} />);
    expect(screen.getByText('No subscription')).toBeVisible();
  });

  it.each([
    ['active', 'cancel', 'Subscription scheduled to cancel'],
    ['trialing', null, 'Subscription active'],
    ['past_due', null, 'Subscription past due'],
    ['canceled', null, 'Subscription cancelled'],
  ])('presents the mirrored subscription status %s with scheduled action %s', (status, action, label) => {
    render(<CompanyHeader detail={{
      ...detail,
      subscription: { ...detail.subscription!, status, scheduledChangeAction: action },
    }} />);
    expect(screen.getByText(label)).toBeVisible();
  });
});
