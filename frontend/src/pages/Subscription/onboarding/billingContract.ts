import type { BillingCatalogEntry, BillingCheckoutResume, BillingConfirmResult, BillingLifecycle, BillingReconcileResult, CheckoutReadiness, ValidatedBillingCheckout, ValidatedBillingLifecycle } from '../types';

const invalid = (): never => { throw new Error('Billing response is unavailable'); };
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return invalid();
  return value as Record<string, unknown>;
}
function text(value: unknown): string { return typeof value === 'string' && value.length > 0 ? value : invalid(); }
function bool(value: unknown): boolean { return typeof value === 'boolean' ? value : invalid(); }
function count(value: unknown): number { return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : invalid(); }
function oneOf<T extends string>(value: unknown, options: readonly T[]): T {
  return typeof value === 'string' && options.includes(value as T) ? value as T : invalid();
}
const plan = (value: unknown) => oneOf(value, ['STARTER', 'PRO', 'ADVANCED'] as const);
const interval = (value: unknown) => oneOf(value, ['month', 'year'] as const);
function id(value: unknown, prefix: string): string {
  return typeof value === 'string' && new RegExp(`^${prefix}_[a-z0-9]{26}$`).test(value) ? value : invalid();
}
function timestamp(value: unknown): string {
  const result = text(value);
  return /^\d{4}-\d\d-\d\dT/.test(result) && Number.isFinite(Date.parse(result)) ? result : invalid();
}
const nullableDate = (value: unknown) => value === null ? null : timestamp(value);
function capacity(value: unknown) {
  const row = object(value);
  return { locations: count(row.locations), staff: count(row.staff), managers: count(row.managers) };
}
function subscription(value: unknown): BillingLifecycle['subscription'] {
  if (value === null) return null;
  const row = object(value);
  return {
    status: text(row.status), plan: row.plan === null ? null : plan(row.plan), catalogQualified: bool(row.catalogQualified),
    periodStart: nullableDate(row.periodStart), periodEnd: nullableDate(row.periodEnd),
    scheduledChangeAction: row.scheduledChangeAction === null ? null : text(row.scheduledChangeAction),
    scheduledChangeAt: nullableDate(row.scheduledChangeAt), lastEventAt: timestamp(row.lastEventAt),
    priceId: row.priceId == null ? null : id(row.priceId, 'pri'),
    interval: row.interval == null ? null : interval(row.interval),
  };
}
function resume(value: unknown): BillingCheckoutResume | null {
  if (value == null) return null;
  const row = object(value);
  return { plan: plan(row.plan), interval: interval(row.interval), transactionId: id(row.transactionId, 'txn') };
}
const reasons: readonly CheckoutReadiness[] = ['UNKNOWN', 'BILLING_DISABLED', 'OWNER_VERIFICATION_REQUIRED', 'COMPANY_RESTRICTED', 'RECONCILIATION_PENDING', 'LINKED_SUBSCRIPTION', 'READY'];

/** Validate raw DTO data after unwrapping the existing API envelope. Never coerce authorization flags. */
export function parseBillingLifecycle(value: unknown, expectedCompanyId?: number): ValidatedBillingLifecycle {
  const row = object(value), company = object(row.company), companyId = count(company.id);
  if (companyId === 0 || (expectedCompanyId !== undefined && companyId !== expectedCompanyId)) return invalid();
  return {
    company: { id: companyId, name: text(company.name), plan: plan(company.plan), isActive: bool(company.isActive), operationalStatus: oneOf(company.operationalStatus, ['ACTIVE', 'SUSPENDED'] as const) },
    usage: capacity(row.usage), limits: capacity(row.limits), subscription: subscription(row.subscription),
    reconciliationRequired: bool(row.reconciliationRequired), billingConfigured: bool(row.billingConfigured), ownerVerified: bool(row.ownerVerified),
    billingEnvironment: row.billingEnvironment == null ? null : oneOf(row.billingEnvironment, ['sandbox', 'production'] as const),
    ...(row.onboardingRequired === undefined ? {} : { onboardingRequired: bool(row.onboardingRequired) }),
    providerState: oneOf(row.providerState, ['MIRRORED', 'AWAITING_PROVIDER', 'NOT_LINKED'] as const),
    portalAvailable: bool(row.portalAvailable), checkoutAvailable: bool(row.checkoutAvailable),
    workspaceAccessAllowed: row.workspaceAccessAllowed === undefined ? false : bool(row.workspaceAccessAllowed),
    checkoutReadiness: row.checkoutReadiness === undefined ? 'UNKNOWN' : oneOf(row.checkoutReadiness, reasons),
    checkoutResume: resume(row.checkoutResume),
    onboardingStep: row.onboardingStep == null ? null : oneOf(row.onboardingStep, ['CHOOSE_PLAN', 'PAYMENT', 'CONFIRMING', 'WORKSPACE', 'ACCOUNT', 'RECONCILE', 'RESTRICTED', 'VERIFY_EMAIL', 'UNAVAILABLE'] as const),
    recoveryReason: row.recoveryReason == null ? null : oneOf(row.recoveryReason, ['EMAIL_CONFLICT', 'CUSTOMER_UNRESOLVED', 'BILLING_DISABLED', 'PRICE_NOT_READY'] as const),
  };
}

export function parseBillingCatalog(value: unknown): BillingCatalogEntry[] {
  if (!Array.isArray(value) || value.length > 6) return invalid();
  const seen = new Set<string>(), prices = new Set<string>();
  return value.map(value => {
    const row = object(value), code = plan(row.plan), cycle = interval(row.interval), priceId = id(row.priceId, 'pri');
    const key = `${code}:${cycle}`;
    if (seen.has(key) || prices.has(priceId)) return invalid();
    seen.add(key); prices.add(priceId);
    if (typeof row.amount !== 'string' || !/^(0|[1-9]\d*)$/.test(row.amount) || row.amount.length > 32) return invalid();
    if (typeof row.currencyCode !== 'string' || !/^[A-Z]{3}$/.test(row.currencyCode)) return invalid();
    // Ignore legacy provider trial data, including malformed leftovers from an older deployment.
    return { plan: code, interval: cycle, priceId, productId: id(row.productId, 'pro'), amount: row.amount, currencyCode: row.currencyCode, trialPeriod: null };
  });
}
export function parseBillingCheckout(value: unknown): ValidatedBillingCheckout {
  const row = object(value);
  return { transactionId: id(row.transactionId, 'txn'), reused: bool(row.reused), replaced: row.replaced === undefined ? false : bool(row.replaced) };
}

/** Outcomes describe server observations; only lifecycle capabilities can authorize access. */
export function parseBillingConfirm(value: unknown, expectedCompanyId?: number): BillingConfirmResult & { lifecycle: ValidatedBillingLifecycle } {
  const row = object(value);
  return { outcome: oneOf(row.outcome, ['ACTIVE', 'PROCESSING', 'NOT_PAID', 'NO_CHECKOUT'] as const), lifecycle: parseBillingLifecycle(row.lifecycle, expectedCompanyId) };
}

export function parseBillingReconcile(value: unknown, expectedCompanyId?: number): BillingReconcileResult & { lifecycle: ValidatedBillingLifecycle } {
  const row = object(value);
  return { outcome: oneOf(row.outcome, ['RESUMABLE', 'CLEARED', 'IN_PROGRESS', 'PAID', 'UNRESOLVED', 'CONFLICT'] as const), lifecycle: parseBillingLifecycle(row.lifecycle, expectedCompanyId) };
}
