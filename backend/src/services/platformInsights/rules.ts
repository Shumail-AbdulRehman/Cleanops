import type { AttemptState } from '@prisma/client';
import type { getPaddleEnvironment } from '../../config/paddle.js';
import type { PublicBillingCatalogEntry } from '../billingCatalog.service.js';
import { PLAN_DEFINITIONS, type PlanCode } from '../subscription.service.js';
import type { MonthKey, Money, PhotoCounts, PlanLimits, SubscriptionState } from './contract.js';

export function subscriptionState(
  company: { billingSubscriptionId: string | null },
  subscription?: { id: string; status: string; scheduledChangeAction: string | null } | null,
): SubscriptionState {
  if (!company.billingSubscriptionId || subscription?.id !== company.billingSubscriptionId) return 'NONE';

  switch (subscription.status) {
    case 'canceled': return 'CANCELLED';
    case 'past_due': return 'PAST_DUE';
    case 'active': return subscription.scheduledChangeAction === 'cancel' ? 'SCHEDULED_CANCEL' : 'ACTIVE';
    case 'trialing': return 'ACTIVE';
    default: return 'NONE';
  }
}

export function isRecurring(state: SubscriptionState): boolean {
  return state === 'ACTIVE' || state === 'SCHEDULED_CANCEL';
}

export function isPaying(state: SubscriptionState): boolean {
  return isRecurring(state) || state === 'PAST_DUE';
}

export function moneyFromMinorUnits(amount: string | null, currency: string): Money | null {
  if (amount === null || !/^-?\d+$/.test(amount) || !/^[A-Z]{3}$/.test(currency)) return null;

  const minorUnits = Number(amount);
  if (!Number.isSafeInteger(minorUnits)) return null;

  const { maximumFractionDigits } = new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions();
  if (maximumFractionDigits === undefined) return null;
  return { amount: minorUnits / 10 ** maximumFractionDigits, currency };
}

export function monthlyValue(entry: Pick<PublicBillingCatalogEntry, 'amount' | 'currencyCode' | 'interval'> | null | undefined): Money | null {
  if (!entry) return null;
  const price = moneyFromMinorUnits(entry.amount, entry.currencyCode);
  if (price && entry.interval === 'year') return { ...price, amount: price.amount / 12 };
  return price;
}

/** A currency is needed to express a known zero for an empty set. */
export function sumMoney(parts: readonly (Money | null)[], currency = parts[0]?.currency): Money | null {
  if (currency === undefined) return null;

  let amount = 0;
  for (const part of parts) {
    if (part === null || part.currency !== currency) return null;
    amount += part.amount;
  }
  return { amount, currency };
}

/** Use provider creation and cancellation dates and today's monthly values. */
export function estimatedMrrAtMonthEnd(
  subscriptions: readonly { createdAt: Date | null; canceledAt: Date | null; monthly: Money | null }[],
  monthEnd: Date,
  currency?: string,
): Money | null {
  const parts: (Money | null)[] = [];
  for (const { createdAt, canceledAt, monthly } of subscriptions) {
    if (canceledAt && canceledAt < monthEnd) continue;
    if (createdAt === null) return null;
    if (createdAt <= monthEnd) parts.push(monthly);
  }
  return sumMoney(parts, currency);
}

export function lastActiveAt(taskActivityAt?: Date | null, checkedInAt?: Date | null): Date | null {
  if (!taskActivityAt) return checkedInAt ?? null;
  if (!checkedInAt) return taskActivityAt;
  return checkedInAt > taskActivityAt ? checkedInAt : taskActivityAt;
}

export function planLimits(plan: PlanCode): PlanLimits {
  return { ...PLAN_DEFINITIONS[plan].limits };
}

export function isCloseToPlanLimit(plan: PlanCode, activeStaff: number): boolean {
  const { locations, staff } = planLimits(plan);
  return plan !== 'ADVANCED' && locations > 1 && staff > 1 && activeStaff / staff >= 0.9;
}

export function photoOutcome(state: AttemptState): keyof PhotoCounts | null {
  switch (state) {
    case 'PASSED': return 'passed';
    case 'RECAPTURE_REQUIRED': return 'retake';
    case 'REVIEW_REQUIRED': return 'manager';
    case 'CLEANING_REQUIRED': return 'cleaning';
    default: return null;
  }
}

const paddleResources = {
  customer: { prefix: 'ctm_', path: 'customers-v2' },
  subscription: { prefix: 'sub_', path: 'subscriptions-v2' },
  transaction: { prefix: 'txn_', path: 'transactions-v2' },
} as const;

export function paddleDashboardUrl(
  environment: `${ReturnType<typeof getPaddleEnvironment>}` | null,
  resource: keyof typeof paddleResources,
  id: string | null | undefined,
): string | null {
  if (environment !== 'production' && environment !== 'sandbox') return null;
  const { prefix, path } = paddleResources[resource];
  if (!id?.startsWith(prefix) || !/^[a-z0-9]{26}$/.test(id.slice(prefix.length))) return null;

  const host = environment === 'sandbox' ? 'sandbox-vendors.paddle.com' : 'vendors.paddle.com';
  return `https://${host}/${path}/${id}`;
}

const karachiDateFormatter = new Intl.DateTimeFormat('en', {
  timeZone: 'Asia/Karachi', year: 'numeric', month: '2-digit', day: '2-digit',
});

export function karachiDay(instant: Date): string {
  const parts = karachiDateFormatter.formatToParts(instant);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find(entry => entry.type === type)!.value;
  return `${part('year').padStart(4, '0')}-${part('month')}-${part('day')}`;
}

// UTC arithmetic here advances calendar labels that have already been converted to Karachi time.
function calendarDate(instant: Date): Date {
  return new Date(`${karachiDay(instant)}T00:00:00.000Z`);
}

function dayKeys(end: Date, count: number, step: number): string[] {
  return Array.from({ length: count }, (_, index) => {
    const day = new Date(end);
    day.setUTCDate(day.getUTCDate() - (count - 1 - index) * step);
    return day.toISOString().slice(0, 10);
  });
}

export function lastDays(instant: Date, count: number): string[] {
  return dayKeys(calendarDate(instant), count, 1);
}

export function lastTwelveMonths(instant: Date): MonthKey[] {
  const first = calendarDate(instant);
  first.setUTCDate(1);
  first.setUTCMonth(first.getUTCMonth() - 11);

  return Array.from({ length: 12 }, (_, index) => {
    const month = first.toISOString().slice(0, 7);
    first.setUTCMonth(first.getUTCMonth() + 1);
    return { month, partial: index === 11 };
  });
}

/** Eight Monday-start weeks, including the Karachi week containing the instant. */
export function lastEightWeekStarts(instant: Date): string[] {
  const monday = calendarDate(instant);
  monday.setUTCDate(monday.getUTCDate() - (monday.getUTCDay() + 6) % 7);
  return dayKeys(monday, 8, 7);
}
