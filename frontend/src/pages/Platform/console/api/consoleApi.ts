import { operatorRequest } from '../../operatorSession';

// Mirrors the platform insights API contract. Money is in major units and day keys are in Asia/Karachi.
export type Money = { amount: number; currency: string };
export type DayCount = { day: string; count: number };
export type MonthKey = { month: string; partial: boolean };
export type PlanCode = 'STARTER' | 'PRO' | 'ADVANCED';
export type SubscriptionState = 'ACTIVE' | 'PAST_DUE' | 'SCHEDULED_CANCEL' | 'CANCELLED' | 'NONE';
export type StatusCounts = Record<SubscriptionState, number>;
export type PlanLimits = { locations: number; staff: number; managers: number };
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

export type PlatformCompanyListItem = {
  id: number;
  name: string;
  plan: PlanCode;
  isActive: boolean;
  operationalStatus: 'ACTIVE' | 'SUSPENDED';
  accountVersion: number;
  createdAt: string;
  updatedAt: string;
  counts: { managers: number; staff: number; locations: number };
  subscription: SubscriptionState;
  monthly: Money | null;
  owner: Owner | null;
  lastActiveAt: string | null;
  activity14: DayCount[];
  limits: PlanLimits;
};

export type PlatformCompaniesResponse = {
  items: PlatformCompanyListItem[];
  nextCursor: string | null;
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
  interval: 'month' | 'year' | null;
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

export type ConsoleCompanyFilters = {
  q?: string;
  status?: string;
  after?: string;
  plan?: PlanCode;
  subscription?: SubscriptionState;
};

export type ConsoleSubscriptionFilters = { status?: SubscriptionState; cursor?: string };
export type ConsolePaymentFilters = { range?: 'month' | 'three' | 'all'; cursor?: string };

function withFilters(path: string, filters: Record<string, string | undefined>) {
  const params = new URLSearchParams();
  for (const [name, value] of Object.entries(filters)) {
    if (value) params.set(name, value);
  }
  const query = params.toString();
  return query ? `${path}?${query}` : path;
}

async function getData<T>(path: string, signal?: AbortSignal): Promise<T> {
  const { data } = await operatorRequest<{ data: T }>(path, { signal });
  return data;
}

export function getConsoleOverview(signal?: AbortSignal) {
  return getData<PlatformOverviewResponse>('/platform/overview', signal);
}

export function getConsoleCompanies(filters: ConsoleCompanyFilters = {}, signal?: AbortSignal) {
  return getData<PlatformCompaniesResponse>(withFilters('/platform/companies', filters), signal);
}

export function getConsoleCompanyInsights(id: number, signal?: AbortSignal) {
  return getData<PlatformCompanyInsightsResponse>(`/platform/companies/${id}/insights`, signal);
}

export function getConsoleSubscriptions(filters: ConsoleSubscriptionFilters = {}, signal?: AbortSignal) {
  return getData<PlatformSubscriptionsResponse>(withFilters('/platform/subscriptions', filters), signal);
}

export function getConsolePayments(filters: ConsolePaymentFilters = {}, signal?: AbortSignal) {
  return getData<PlatformPaymentsResponse>(withFilters('/platform/payments', filters), signal);
}
