import { describe, expect, it, vi } from 'vitest';
import { PLAN_DEFINITIONS } from '../subscription.service.js';
import {
  estimatedMrrAtMonthEnd, isCloseToPlanLimit, isPaying, isRecurring, karachiDay, lastActiveAt,
  lastDays, lastEightWeekStarts, lastTwelveMonths, moneyFromMinorUnits, monthlyValue,
  paddleDashboardUrl, photoOutcome, planLimits, subscriptionState, sumMoney,
} from './rules.js';

vi.mock('../../prisma/prisma.js', () => ({ prisma: {} }));

const usd = (amount: number) => ({ amount, currency: 'USD' });

describe('subscription rules', () => {
  const company = { billingSubscriptionId: 'linked' };

  it.each([
    ['canceled', null, 'CANCELLED'],
    ['past_due', 'cancel', 'PAST_DUE'],
    ['active', 'cancel', 'SCHEDULED_CANCEL'],
    ['active', 'pause', 'ACTIVE'],
    ['active', null, 'ACTIVE'],
    ['trialing', 'cancel', 'ACTIVE'],
    ['paused', null, 'NONE'],
    ['unknown', null, 'NONE'],
  ] as const)('maps %s with scheduled action %s to %s', (status, scheduledChangeAction, expected) => {
    expect(subscriptionState(company, { id: 'linked', status, scheduledChangeAction })).toBe(expected);
  });

  it('requires a linked subscription and its matching mirror', () => {
    const mirror = { id: 'other', status: 'active', scheduledChangeAction: null };
    expect(subscriptionState({ billingSubscriptionId: null }, mirror)).toBe('NONE');
    expect(subscriptionState(company, mirror)).toBe('NONE');
    expect(subscriptionState(company, null)).toBe('NONE');
  });

  it.each([
    ['ACTIVE', true, true],
    ['SCHEDULED_CANCEL', true, true],
    ['PAST_DUE', true, false],
    ['CANCELLED', false, false],
    ['NONE', false, false],
  ] as const)('defines paying and recurring eligibility for %s', (state, paying, recurring) => {
    expect(isPaying(state)).toBe(paying);
    expect(isRecurring(state)).toBe(recurring);
  });
});

describe('money and monthly estimates', () => {
  it('converts minor units based on the currency and preserves zero', () => {
    expect(moneyFromMinorUnits('12345', 'USD')).toEqual(usd(123.45));
    expect(moneyFromMinorUnits('12345', 'JPY')).toEqual({ amount: 12345, currency: 'JPY' });
    expect(moneyFromMinorUnits('12345', 'BHD')).toEqual({ amount: 12.345, currency: 'BHD' });
    expect(moneyFromMinorUnits('0', 'USD')).toEqual(usd(0));
  });

  it.each([null, '12.34', '1e3', '9007199254740992'])('returns null for unknown or unusable amount %s', amount => {
    expect(moneyFromMinorUnits(amount, 'USD')).toBeNull();
  });

  it('returns null for an invalid currency', () => {
    expect(moneyFromMinorUnits('100', 'US')).toBeNull();
  });

  it('keeps monthly prices and divides a yearly price by twelve', () => {
    expect(monthlyValue({ amount: '18000', currencyCode: 'USD', interval: 'month' })).toEqual(usd(180));
    expect(monthlyValue({ amount: '18000', currencyCode: 'USD', interval: 'year' })).toEqual(usd(15));
    expect(monthlyValue({ amount: 'unknown', currencyCode: 'USD', interval: 'year' })).toBeNull();
    expect(monthlyValue(undefined)).toBeNull();
    expect(monthlyValue(null)).toBeNull();
  });

  it('sums known amounts in one currency', () => {
    expect(sumMoney([usd(10), usd(15)])).toEqual(usd(25));
    expect(sumMoney([usd(10), null])).toBeNull();
    expect(sumMoney([null, usd(10)])).toBeNull();
    expect(sumMoney([usd(10), { amount: 5, currency: 'JPY' }])).toBeNull();
    expect(sumMoney([], 'USD')).toEqual(usd(0));
    expect(sumMoney([])).toBeNull();
  });

  it('estimates MRR using creation and cancellation dates at the month-end boundary', () => {
    const monthEnd = new Date('2026-11-30T18:59:59.999Z');
    const beforeEnd = new Date('2026-11-30T18:59:59.998Z');
    const afterEnd = new Date('2026-11-30T19:00:00.000Z');

    expect(estimatedMrrAtMonthEnd([
      { createdAt: beforeEnd, canceledAt: beforeEnd, monthly: null },
      { createdAt: afterEnd, canceledAt: null, monthly: null },
      { createdAt: monthEnd, canceledAt: null, monthly: usd(10) },
      { createdAt: beforeEnd, canceledAt: monthEnd, monthly: usd(20) },
      { createdAt: beforeEnd, canceledAt: afterEnd, monthly: usd(30) },
    ], monthEnd)).toEqual(usd(60));

    expect(estimatedMrrAtMonthEnd([{ createdAt: beforeEnd, canceledAt: null, monthly: null }], monthEnd)).toBeNull();
    expect(estimatedMrrAtMonthEnd([{ createdAt: null, canceledAt: null, monthly: usd(5) }], monthEnd)).toBeNull();
    expect(estimatedMrrAtMonthEnd([], monthEnd, 'USD')).toEqual(usd(0));
  });
});

describe('company activity and plan limits', () => {
  it('uses the latest task or check-in timestamp and handles missing activity', () => {
    const earlier = new Date('2026-11-18T12:00:00Z');
    const later = new Date('2026-11-19T12:00:00Z');
    expect(lastActiveAt(earlier, later)).toEqual(later);
    expect(lastActiveAt(later, earlier)).toEqual(later);
    expect(lastActiveAt(later, later)).toEqual(later);
    expect(lastActiveAt(later, null)).toEqual(later);
    expect(lastActiveAt(undefined, later)).toEqual(later);
    expect(lastActiveAt()).toBeNull();
  });

  it.each(['STARTER', 'PRO', 'ADVANCED'] as const)('reads %s limits from the subscription service', plan => {
    expect(planLimits(plan)).toEqual(PLAN_DEFINITIONS[plan].limits);
    expect(planLimits(plan)).not.toBe(PLAN_DEFINITIONS[plan].limits);
  });

  it('flags eligible plans at 90 percent and above', () => {
    const { staff } = planLimits('PRO');
    expect(isCloseToPlanLimit('PRO', Math.ceil(staff * 0.9) - 1)).toBe(false);
    expect(isCloseToPlanLimit('PRO', staff * 0.9)).toBe(true);
    expect(isCloseToPlanLimit('PRO', staff)).toBe(true);
  });

  it('excludes Enterprise and one-location Starter even at their staff limit', () => {
    expect(planLimits('STARTER').locations).toBe(1);
    expect(isCloseToPlanLimit('STARTER', planLimits('STARTER').staff)).toBe(false);
    expect(isCloseToPlanLimit('ADVANCED', planLimits('ADVANCED').staff)).toBe(false);
  });
});

describe('photo outcomes', () => {
  it.each([
    ['PASSED', 'passed'],
    ['RECAPTURE_REQUIRED', 'retake'],
    ['REVIEW_REQUIRED', 'manager'],
    ['CLEANING_REQUIRED', 'cleaning'],
  ] as const)('counts %s as %s', (state, expected) => {
    expect(photoOutcome(state)).toBe(expected);
  });

  it.each([
    'RESERVED', 'STORING', 'RECEIVED', 'QUALITY_CHECK', 'COVERAGE_CHECK', 'CLEANLINESS_CHECK',
    'RETRY_WAIT', 'SERVICE_FAILURE', 'PRIVACY_HOLD',
  ] as const)('leaves %s uncounted', state => {
    expect(photoOutcome(state)).toBeNull();
  });
});

describe('Paddle dashboard links', () => {
  const suffix = 'a'.repeat(26);

  it.each([
    ['customer', `ctm_${suffix}`, 'customers-v2'],
    ['subscription', `sub_${suffix}`, 'subscriptions-v2'],
    ['transaction', `txn_${suffix}`, 'transactions-v2'],
  ] as const)('builds %s links on the configured dashboard', (kind, id, path) => {
    expect(paddleDashboardUrl('production', kind, id)).toBe(`https://vendors.paddle.com/${path}/${id}`);
    expect(paddleDashboardUrl('sandbox', kind, id)).toBe(`https://sandbox-vendors.paddle.com/${path}/${id}`);
  });

  it('omits links when configuration or a valid stored ID is missing', () => {
    expect(paddleDashboardUrl(null, 'customer', `ctm_${suffix}`)).toBeNull();
    expect(paddleDashboardUrl('production', 'customer', null)).toBeNull();
    expect(paddleDashboardUrl('production', 'customer', `sub_${suffix}`)).toBeNull();
    expect(paddleDashboardUrl('production', 'customer', 'ctm_../transactions?x=y')).toBeNull();
  });
});

describe('Karachi calendar buckets', () => {
  it.each([
    ['2026-11-30T18:59:59.999Z', '2026-11-30'],
    ['2026-11-30T19:00:00.000Z', '2026-12-01'],
    ['2026-11-30T23:30:00.000Z', '2026-12-01'],
    ['2026-12-31T19:00:00.000Z', '2027-01-01'],
  ])('labels %s as %s', (instant, day) => {
    expect(karachiDay(new Date(instant))).toBe(day);
  });

  it('returns ordered daily buckets including the local day and leap day', () => {
    const instant = new Date('2024-02-29T23:30:00Z');
    expect(lastDays(instant, 3)).toEqual(['2024-02-28', '2024-02-29', '2024-03-01']);
    expect(lastDays(instant, 0)).toEqual([]);
  });

  it('returns twelve ordered month keys with only the local current month partial', () => {
    const months = lastTwelveMonths(new Date('2026-12-31T23:30:00Z'));
    expect(months.map(({ month }) => month)).toEqual([
      '2026-02', '2026-03', '2026-04', '2026-05', '2026-06', '2026-07',
      '2026-08', '2026-09', '2026-10', '2026-11', '2026-12', '2027-01',
    ]);
    expect(months.filter(({ partial }) => partial)).toEqual([{ month: '2027-01', partial: true }]);
  });

  it('returns eight Monday starts through the current Karachi week', () => {
    const sunday = new Date('2026-11-29T18:59:59.999Z');
    const monday = new Date('2026-11-29T19:00:00.000Z');
    expect(lastEightWeekStarts(monday)).toEqual([
      '2026-10-12', '2026-10-19', '2026-10-26', '2026-11-02',
      '2026-11-09', '2026-11-16', '2026-11-23', '2026-11-30',
    ]);
    expect(lastEightWeekStarts(sunday).at(-1)).toBe('2026-11-23');
  });
});
