import { describe, expect, it } from 'vitest';
import type { BillingCatalogEntryDto, BillingCheckoutDto, BillingConfirmDto, BillingConfirmOutcome, BillingLifecycleDto, BillingOnboardingStep, BillingReconcileDto, BillingReconcileOutcome, BillingRecoveryReason } from '../../../../../backend/src/types/billingLifecycle';
import type { BillingCatalogEntry, BillingCheckout, BillingConfirmResult, BillingLifecycle, BillingReconcileResult } from '../types';
import { parseBillingCatalog, parseBillingCheckout, parseBillingConfirm, parseBillingLifecycle, parseBillingReconcile } from './billingContract';
import { deriveBillingViewState } from './billingViewState';
const txn = 'txn_' + 'a'.repeat(26);
const price = 'pri_' + 'b'.repeat(26);
const catalog: BillingCatalogEntryDto = { plan: 'PRO', interval: 'month', priceId: price, productId: 'pro_' + 'c'.repeat(26), amount: '1234', currencyCode: 'USD', trialPeriod: null };
function lifecycle(): BillingLifecycleDto {
  return { company: { id: 42, name: 'Fixture', plan: 'PRO', isActive: true, operationalStatus: 'ACTIVE' }, usage: { locations: 0, staff: 0, managers: 1 }, limits: { locations: 5, staff: 25, managers: 3 }, subscription: null, reconciliationRequired: false, billingConfigured: true, ownerVerified: false, billingEnvironment: 'sandbox', onboardingRequired: true, providerState: 'NOT_LINKED', portalAvailable: false, checkoutAvailable: true };
}
// Compile fixtures against both declarations; no backend implementation is bundled.
const compatibility: BillingLifecycle = lifecycle();
const steps = ['CHOOSE_PLAN', 'PAYMENT', 'CONFIRMING', 'WORKSPACE', 'ACCOUNT', 'RECONCILE', 'RESTRICTED', 'VERIFY_EMAIL', 'UNAVAILABLE'] as const satisfies readonly BillingOnboardingStep[];
const recoveryReasons = [null, 'EMAIL_CONFLICT', 'CUSTOMER_UNRESOLVED', 'BILLING_DISABLED', 'PRICE_NOT_READY'] as const satisfies readonly BillingRecoveryReason[];
const confirmOutcomes = ['ACTIVE', 'PROCESSING', 'NOT_PAID', 'NO_CHECKOUT'] as const satisfies readonly BillingConfirmOutcome[];
const reconcileOutcomes = ['RESUMABLE', 'CLEARED', 'IN_PROGRESS', 'PAID', 'UNRESOLVED', 'CONFLICT'] as const satisfies readonly BillingReconcileOutcome[];
describe('billing lifecycle wire boundary', () => {
  it('fails closed for additive legacy fields and never mutates input', () => {
    const before = structuredClone(compatibility);
    expect(parseBillingLifecycle(compatibility)).toMatchObject({ workspaceAccessAllowed: false, checkoutReadiness: 'UNKNOWN', checkoutResume: null, onboardingStep: null, recoveryReason: null });
    expect(compatibility).toEqual(before);
  });
  it.each(steps)('accepts step %s without deriving access from it', onboardingStep => {
    const wire: BillingLifecycleDto = { ...lifecycle(), onboardingStep };
    const client: BillingLifecycle = wire;
    expect(parseBillingLifecycle(client, 42)).toMatchObject({ onboardingStep, recoveryReason: null, workspaceAccessAllowed: false });
  });
  it.each(recoveryReasons)('accepts recovery reason %s', recoveryReason => {
    expect(parseBillingLifecycle({ ...lifecycle(), recoveryReason }).recoveryReason).toBe(recoveryReason);
  });
  it('keeps missing and normalized null steps unprivileged and safe to parse again', () => {
    const parsed = parseBillingLifecycle(lifecycle(), 42);
    expect(parsed.onboardingStep).toBeNull();
    expect(parsed.workspaceAccessAllowed).toBe(false);
    expect(parseBillingLifecycle(parsed, 42)).toEqual(parsed);
    const owner = { companyId: 42, ownerId: 7 };
    expect(deriveBillingViewState({ owner, dataOwner: owner, data: parsed, read: 'fresh' }).canOpenWorkspace).toBe(false);
  });
  it('preserves explicit server access on an existing subscriber during rollout', () => {
    expect(parseBillingLifecycle({ ...lifecycle(), workspaceAccessAllowed: true }, 42)).toMatchObject({ onboardingStep: null, workspaceAccessAllowed: true });
  });
  it.each(['onboardingStep', 'recoveryReason'])('rejects unknown and malformed %s without leaking the value', field => {
    for (const value of ['PRIVATE_UNKNOWN_VALUE', '', 'workspace', true, 1, [], {}]) {
      expect(() => parseBillingLifecycle({ ...lifecycle(), [field]: value })).toThrow('Billing response is unavailable');
    }
  });
  it('rejects the wrong company when an owner scope is supplied', () => {
    expect(() => parseBillingLifecycle(lifecycle(), 99)).toThrow('Billing response is unavailable');
  });
  it('accepts a prepared draft with exact saved selection', () => {
    expect(parseBillingLifecycle({ ...lifecycle(), checkoutReadiness: 'READY', checkoutResume: { plan: 'PRO', interval: 'year', transactionId: txn } }).checkoutResume).toEqual({ plan: 'PRO', interval: 'year', transactionId: txn });
  });
  it.each(['unknown', 'active', 'trialing'])('accepts mirrored %s facts without inferring access', status => {
    const row = lifecycle();
    row.subscription = { status, plan: 'PRO', catalogQualified: true, priceId: price, interval: 'month', periodStart: '2026-11-01T00:00:00Z', periodEnd: '2026-12-01T00:00:00Z', scheduledChangeAction: null, scheduledChangeAt: null, lastEventAt: '2026-11-06T00:00:00Z' };
    expect(parseBillingLifecycle(row).workspaceAccessAllowed).toBe(false);
    expect(parseBillingLifecycle({ ...row, workspaceAccessAllowed: true }).workspaceAccessAllowed).toBe(true);
  });
  it('retains restricted and actual over-limit counts without inventing ready', () => {
    const row = lifecycle(); row.company.operationalStatus = 'SUSPENDED'; row.usage.staff = 100;
    expect(parseBillingLifecycle(row)).toMatchObject({ company: { operationalStatus: 'SUSPENDED' }, usage: { staff: 100 }, workspaceAccessAllowed: false });
  });
  it.each(['checkoutAvailable', 'portalAvailable', 'billingConfigured', 'ownerVerified', 'reconciliationRequired', 'workspaceAccessAllowed', 'onboardingRequired'])('does not coerce %s', field => {
    expect(() => parseBillingLifecycle({ ...lifecycle(), [field]: 'true' })).toThrow('Billing response is unavailable');
  });
  it.each([0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, '42'])('rejects malformed company id %s', id => {
    const row = lifecycle(); expect(() => parseBillingLifecycle({ ...row, company: { ...row.company, id } })).toThrow();
  });
  it.each([{ checkoutReadiness: 'SECRET_CONFIGURATION_VALUE' }, { providerState: 'PAID' }, { checkoutResume: { plan: 'FREE', interval: 'month', transactionId: txn } }, { checkoutResume: { plan: 'PRO', interval: 'week', transactionId: txn } }, { checkoutResume: { plan: 'PRO', interval: 'month', transactionId: 'txn_fake' } }])('rejects malformed enum/resume %j', patch => {
    expect(() => parseBillingLifecycle({ ...lifecycle(), ...patch })).toThrow();
  });
  it('returns only public fields, not unknown sensitive payloads', () => {
    expect(JSON.stringify(parseBillingLifecycle({ ...lifecycle(), secret: 'private', portalUrl: 'https://private.invalid' }))).not.toMatch(/private|portalUrl|secret/);
  });
  it.each([null, [], {}, { company: null }])('rejects invalid required structure %j', row => {
    expect(() => parseBillingLifecycle(row)).toThrow();
  });
});
describe('provider catalog and checkout wire boundary', () => {
  it('preserves exact amount, currency and interval, with no trial', () => {
    expect(parseBillingCatalog([catalog])).toEqual([catalog]);
    const withoutTrial: BillingCatalogEntryDto = { plan: 'PRO', interval: 'year', priceId: price, productId: catalog.productId, amount: '0', currencyCode: 'JPY' };
    const client: BillingCatalogEntry = withoutTrial;
    expect(parseBillingCatalog([client])[0]).toEqual({ ...client, trialPeriod: null });
  });
  it.each([undefined, null, { interval: 'day', frequency: 5, requiresPaymentMethod: true }, { interval: 'day', frequency: 5 }, { interval: 'day', frequency: 0 }, { interval: 'day', frequency: 1, requiresPaymentMethod: 'true' }, 'PRIVATE_LEGACY_TRIAL'])('ignores leftover trial metadata %# without mutating input', trialPeriod => {
    const row = { ...catalog, trialPeriod }, before = structuredClone(row);
    expect(parseBillingCatalog([row])).toEqual([{ ...catalog, trialPeriod: null }]);
    expect(row).toEqual(before);
  });
  it.each([{ amount: 1234 }, { amount: '-1' }, { amount: '1.5' }, { amount: 'NaN' }, { amount: '01' }, { currencyCode: 'usd' }, { priceId: 'pri_fake' }, { productId: 'pro_fake' }, { interval: 'week' }, { plan: 'FREE' }])('rejects malformed price %j', patch => {
    expect(() => parseBillingCatalog([{ ...catalog, ...patch }])).toThrow();
  });
  it('accepts empty/partial catalogs but rejects duplicate price or plan/interval', () => {
    expect(parseBillingCatalog([])).toEqual([]);
    expect(() => parseBillingCatalog([catalog, catalog])).toThrow();
    expect(() => parseBillingCatalog([catalog, { ...catalog, interval: 'year' }])).toThrow();
  });
  it('validates checkout actions without retaining extra response fields', () => {
    expect(parseBillingCheckout({ transactionId: txn, reused: true, secret: 'private' })).toEqual({ transactionId: txn, reused: true, replaced: false });
    expect(() => parseBillingCheckout({ transactionId: txn, reused: 'false' })).toThrow();
    expect(() => parseBillingCheckout({ transactionId: 'txn_fake', reused: false })).toThrow();
  });
  it.each([false, true])('retains the server replacement fact %s', replaced => {
    const wire: BillingCheckoutDto = { transactionId: txn, reused: false, replaced };
    const client: BillingCheckout = wire;
    expect(parseBillingCheckout(client)).toEqual(wire);
  });
  it.each([null, 'true', 1, {}, []])('rejects a malformed replacement flag %#', replaced => {
    expect(() => parseBillingCheckout({ transactionId: txn, reused: false, replaced })).toThrow('Billing response is unavailable');
  });
});

describe('confirmation and reconciliation wire boundaries', () => {
  it.each(confirmOutcomes)('accepts confirm outcome %s with validated lifecycle', outcome => {
    const wire: BillingConfirmDto = { outcome, lifecycle: { ...lifecycle(), onboardingStep: 'CONFIRMING' } };
    const client: BillingConfirmResult = wire;
    expect(parseBillingConfirm(client, 42)).toEqual({ outcome, lifecycle: parseBillingLifecycle(wire.lifecycle, 42) });
    expect(parseBillingConfirm(client, 42).lifecycle.workspaceAccessAllowed).toBe(false);
  });
  it.each(reconcileOutcomes)('accepts reconcile outcome %s with validated lifecycle', outcome => {
    const wire: BillingReconcileDto = { outcome, lifecycle: { ...lifecycle(), onboardingStep: 'RECONCILE' } };
    const client: BillingReconcileResult = wire;
    expect(parseBillingReconcile(client, 42)).toEqual({ outcome, lifecycle: parseBillingLifecycle(wire.lifecycle, 42) });
    expect(parseBillingReconcile(client, 42).lifecycle.workspaceAccessAllowed).toBe(false);
  });
  const parsers = [
    { name: 'confirm', parse: parseBillingConfirm, outcome: 'ACTIVE', otherOutcome: 'PAID' },
    { name: 'reconcile', parse: parseBillingReconcile, outcome: 'PAID', otherOutcome: 'ACTIVE' },
  ];
  describe.each(parsers)('$name', ({ parse, outcome, otherOutcome }) => {
    it.each([undefined, null, '', 'UNKNOWN_PRIVATE_OUTCOME', true, 1, [], {}])('rejects missing, unknown or malformed outcome %#', value => {
      expect(() => parse({ outcome: value, lifecycle: lifecycle() }, 42)).toThrow('Billing response is unavailable');
    });
    it('rejects outcomes from the other operation', () => {
      expect(() => parse({ outcome: otherOutcome, lifecycle: lifecycle() }, 42)).toThrow('Billing response is unavailable');
    });
    it.each([undefined, null, {}, { ...lifecycle(), workspaceAccessAllowed: 'true' }, { ...lifecycle(), onboardingStep: 'UNKNOWN' }, { ...lifecycle(), recoveryReason: 'UNKNOWN' }])('rejects missing or malformed nested lifecycle %#', value => {
      expect(() => parse({ outcome, lifecycle: value }, 42)).toThrow('Billing response is unavailable');
    });
    it.each([undefined, null, [], 'ACTIVE'])('rejects malformed result structure %#', value => {
      expect(() => parse(value, 42)).toThrow('Billing response is unavailable');
    });
    it('rejects a nested lifecycle from another company', () => {
      expect(() => parse({ outcome, lifecycle: { ...lifecycle(), company: { ...lifecycle().company, id: 99 } } }, 42)).toThrow('Billing response is unavailable');
    });
    it('strips extra fields at each level without changing input or inferring permission', () => {
      const row = { outcome, email: 'private', providerError: 'private', lifecycle: { ...lifecycle(), secret: 'private', company: { ...lifecycle().company, otherCompanyId: 99 } } };
      const before = structuredClone(row), parsed = parse(row, 42);
      expect(parsed).toEqual({ outcome, lifecycle: parseBillingLifecycle(lifecycle(), 42) });
      expect(JSON.stringify(parsed)).not.toMatch(/private|otherCompanyId|secret/);
      expect(row).toEqual(before);
      expect(parse(parsed, 42)).toEqual(parsed);
    });
    it('retains explicit server workspace permission', () => {
      expect(parse({ outcome, lifecycle: { ...lifecycle(), workspaceAccessAllowed: true } }, 42).lifecycle.workspaceAccessAllowed).toBe(true);
    });
  });
});
