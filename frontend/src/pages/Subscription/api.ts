import { client } from '@/api/client';
import type { AxiosRequestConfig } from 'axios';
import {
  parseBillingLifecycle, parseBillingCatalog, parseBillingCheckout,
  parseBillingConfirm, parseBillingReconcile,
} from './onboarding/billingContract';
import { billingRequest, BILLING_REQUEST_LIMITS } from './onboarding/billingRequest';
import type { ApiEnvelope, BillingCatalogEntry, PlanCode, PricingContext, SubscriptionSummary } from './types';

export type PublicPlanPrice = Pick<BillingCatalogEntry, 'plan' | 'interval' | 'amount' | 'currencyCode'>;

export async function getPublicPlanPrices(signal?: AbortSignal): Promise<PublicPlanPrice[]> {
  const response = await billingRequest(
    signal => client.get<ApiEnvelope<PublicPlanPrice[]>>('/subscription/prices', { signal }),
    BILLING_REQUEST_LIMITS.read, signal,
  );
  const entries = response.data.data;
  if (!Array.isArray(entries) || entries.length === 0 || entries.some(entry =>
    !entry || !['STARTER', 'PRO', 'ADVANCED'].includes(entry.plan) || !['month', 'year'].includes(entry.interval) ||
    typeof entry.amount !== 'string' || !/^\d+$/.test(entry.amount) || !/^[A-Z]{3}$/.test(entry.currencyCode)
  )) throw new Error('Plan prices are unavailable');
  return entries.map(({ plan, interval, amount, currencyCode }) => ({ plan, interval, amount, currencyCode }));
}

// The shared refresh interceptor checks _retry before replaying a request.
// Billing mutations must never be replayed, even following a 401 response.
const mutationConfig = (signal: AbortSignal): AxiosRequestConfig & { _retry: true } => ({ signal, _retry: true });

export const getPricingContext = async () => {
  const response = await billingRequest(
    signal => client.get<ApiEnvelope<PricingContext>>('/subscription/pricing-context', { signal }),
    BILLING_REQUEST_LIMITS.read,
  );
  return response.data.data;
};

export const getSubscription = async (signal?: AbortSignal, companyId?: number) => {
  const response = await billingRequest(
    signal => client.get<ApiEnvelope<SubscriptionSummary>>('/subscription', { signal }),
    BILLING_REQUEST_LIMITS.read, signal,
  );
  if (companyId !== undefined && response.data.data.company.id !== companyId) throw new Error('Billing response is unavailable');
  return response.data.data;
};

export const createCustomerPortalSession = async () => {
  const response = await billingRequest(
    signal => client.post<ApiEnvelope<{ url: string }>>('/subscription/portal-session', {}, mutationConfig(signal)),
    BILLING_REQUEST_LIMITS.prepare,
  );
  return response.data.data;
};

export async function getBillingLifecycle(signal?: AbortSignal, companyId?: number) {
  const response = await billingRequest(
    signal => client.get<ApiEnvelope<unknown>>('/subscription/manage/lifecycle', { signal }),
    BILLING_REQUEST_LIMITS.read, signal,
  );
  return parseBillingLifecycle(response.data.data, companyId);
}

export async function getBillingCatalog(signal?: AbortSignal) {
  const response = await billingRequest(
    signal => client.get<ApiEnvelope<unknown>>('/subscription/manage/catalog', { signal }),
    BILLING_REQUEST_LIMITS.read, signal,
  );
  return parseBillingCatalog(response.data.data);
}

export async function prepareBillingCheckout(plan: PlanCode, interval: 'month' | 'year', signal?: AbortSignal) {
  const response = await billingRequest(
    signal => client.post<ApiEnvelope<unknown>>('/subscription/manage/checkout', { plan, interval }, mutationConfig(signal)),
    BILLING_REQUEST_LIMITS.prepare, signal,
  );
  return parseBillingCheckout(response.data.data);
}

export async function confirmBillingCheckout(signal?: AbortSignal, companyId?: number) {
  const response = await billingRequest(
    signal => client.post<ApiEnvelope<unknown>>('/subscription/manage/checkout/confirm', {}, mutationConfig(signal)),
    BILLING_REQUEST_LIMITS.confirm, signal,
  );
  return parseBillingConfirm(response.data.data, companyId);
}

export async function reconcileBillingCheckout(signal?: AbortSignal, companyId?: number) {
  const response = await billingRequest(
    signal => client.post<ApiEnvelope<unknown>>('/subscription/manage/checkout/reconcile', {}, mutationConfig(signal)),
    BILLING_REQUEST_LIMITS.reconcile, signal,
  );
  return parseBillingReconcile(response.data.data, companyId);
}

function approvedPortal(value: unknown): string {
  try {
    if (typeof value !== 'string' || /[\s\\]/.test(value)) throw new Error();
    const url = new URL(value);
    // Explicit ports (including :443 normalized away by URL) are not accepted.
    const authority = value.match(/^https:\/\/([^/?#]+)/)?.[1];
    if (!authority || authority.includes(':') || url.protocol !== 'https:' || url.username || url.password || url.port ||
      !['customer-portal.paddle.com', 'sandbox-customer-portal.paddle.com'].includes(url.hostname)) throw new Error();
    return url.toString();
  } catch { throw new Error('Billing portal unavailable'); }
}

export async function prepareBillingPortal(signal?: AbortSignal) {
  const response = await billingRequest(
    signal => client.post<ApiEnvelope<{ url: unknown }>>('/subscription/manage/managed-portal', {}, mutationConfig(signal)),
    BILLING_REQUEST_LIMITS.prepare, signal,
  );
  return { url: approvedPortal(response.data.data?.url) };
}

export function navigateToBillingPortal(value: string) {
  window.location.assign(approvedPortal(value));
}
