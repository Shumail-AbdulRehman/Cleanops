import type { PaddleCatalogEntry } from '../../config/paddle.js';
import type { PLAN_DEFINITIONS, PlanCode } from '../subscription.service.js';

/** Money uses major units. Calendar keys are local to Asia/Karachi. */
export type Money = { amount: number; currency: string };
export type DayCount = { day: string; count: number };
export type MonthKey = { month: string; partial: boolean };
export type SubscriptionState = 'ACTIVE' | 'PAST_DUE' | 'SCHEDULED_CANCEL' | 'CANCELLED' | 'NONE';
export type StatusCounts = Record<SubscriptionState, number>;
export type PlanLimits = (typeof PLAN_DEFINITIONS)[PlanCode]['limits'];
export type PhotoCounts = { passed: number; retake: number; manager: number; cleaning: number };

type CompanyRef = { companyId: number; name: string };
type Owner = { name: string; email: string };
type Payment = {
  id: string;
  date: string;
  invoice: string | null;
  amount: Money | null;
  status: 'PAID' | 'PAST_DUE';
};

export type PlatformOverviewResponse = {
  asOf: string;
  figures: {
    companies: number;
    newThisMonth: number;
    paying: number;
    payingShare: number | null;
    mrr: Money | null;
    mrrChange: number | null;
    pastDue: (CompanyRef & { monthly: Money | null })[];
    activeStaff: number;
  };
  attention: {
    items: (CompanyRef & {
      kind: 'PAST_DUE' | 'SUSPENDED' | 'SCHEDULED_CANCEL';
      plan: PlanCode;
      date: string | null;
    })[];
    mrrAtRisk: Money | null;
  };
  upgrades: (CompanyRef & { plan: PlanCode; staff: number; staffLimit: number })[];
  plans: { plan: PlanCode; paying: number; mrr: Money | null }[];
  companiesByPlan: { plan: PlanCode; companies: number; averageStaff: number | null; largestStaff: number | null }[];
  months: (MonthKey & { signups: Record<PlanCode, number>; mrrEstimate: Money | null; collected: Money | null })[];
  funnel: { signedUp: number; checkedOut: number; paying: number; workedThisWeek: number };
  statusCounts: StatusCounts;
  tasksPerDay: DayCount[];
  checkinsPerDay: DayCount[];
  photos: PhotoCounts;
  busiest: (CompanyRef & { tasks: number })[];
  system: { database: 'OK' | 'UNAVAILABLE'; lastWebhookAt: string | null; photoChecks: boolean | null };
};

export type PlatformCompanyListItemAdditions = {
  subscription: SubscriptionState;
  monthly: Money | null;
  owner: Owner | null;
  lastActiveAt: string | null;
  activity14: DayCount[];
  limits: PlanLimits;
};

export type PlatformCompanyInsightsResponse = {
  owner: Owner | null;
  limits: PlanLimits;
  usage: { locations: number; staff: number; managers: number };
  lastActiveAt: string | null;
  activity30: DayCount[];
  calendar35: DayCount[];
  photos: PhotoCounts;
  onTimeShare: number | null;
  payments: Payment[];
  paidToDate: Money | null;
  paddle: { customerUrl: string } | null;
};

type SubscriptionItem = CompanyRef & {
  owner: Owner | null;
  plan: PlanCode;
  interval: PaddleCatalogEntry['interval'] | null;
  amount: Money | null;
  status: SubscriptionState;
  renewsOrEndsAt: string | null;
  paddleUrl: string | null;
};

export type PlatformSubscriptionsResponse = {
  summary: {
    mrrByPlan: { plan: PlanCode; mrr: Money | null }[];
    averagePerPaying: Money | null;
    renewals: { week: string; count: number; amount: Money | null }[];
    endingSoon: Pick<SubscriptionItem, 'companyId' | 'name' | 'renewsOrEndsAt'>[];
    cancelled: number;
  };
  statusCounts: StatusCounts;
  items: SubscriptionItem[];
  nextCursor: string | null;
};

export type PlatformPaymentsResponse = {
  summary: {
    weekly: { week: string; collected: Money | null }[];
    paid: number;
    pastDue: number;
    collected: Money | null;
    count: number;
  };
  items: (Payment & { companyId: number; companyName: string; paddleUrl: string | null })[];
  nextCursor: string | null;
};

type EndpointFields = {
  '/api/platform/overview': keyof PlatformOverviewResponse;
  '/api/platform/companies': keyof PlatformCompanyListItemAdditions;
  '/api/platform/companies/:id/insights': keyof PlatformCompanyInsightsResponse;
  '/api/platform/subscriptions': keyof PlatformSubscriptionsResponse;
  '/api/platform/payments': keyof PlatformPaymentsResponse;
};

/** Top-level response keys, with the added item keys for the existing companies endpoint. */
export const PLATFORM_INSIGHT_FIELDS = {
  '/api/platform/overview': [
    'asOf', 'figures', 'attention', 'upgrades', 'plans', 'companiesByPlan', 'months', 'funnel',
    'statusCounts', 'tasksPerDay', 'checkinsPerDay', 'photos', 'busiest', 'system',
  ],
  '/api/platform/companies': ['subscription', 'monthly', 'owner', 'lastActiveAt', 'activity14', 'limits'],
  '/api/platform/companies/:id/insights': [
    'owner', 'limits', 'usage', 'lastActiveAt', 'activity30', 'calendar35', 'photos', 'onTimeShare',
    'payments', 'paidToDate', 'paddle',
  ],
  '/api/platform/subscriptions': ['summary', 'statusCounts', 'items', 'nextCursor'],
  '/api/platform/payments': ['summary', 'items', 'nextCursor'],
} as const satisfies { [Path in keyof EndpointFields]: readonly EndpointFields[Path][] };
