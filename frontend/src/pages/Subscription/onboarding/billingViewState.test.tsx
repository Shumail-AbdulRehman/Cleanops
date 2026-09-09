import { expect, it } from 'vitest';
import type { BillingLifecycle, PlanDefinition } from '../types';
import { billingPlanDefinition, deriveBillingViewState, type BillingViewInput, type BillingViewKind } from './billingViewState';
const owner = { companyId: 42, ownerId: 1 };
function lifecycle(): BillingLifecycle {
  return { company: { id: 42, name: 'Fixture', plan: 'PRO', isActive: true, operationalStatus: 'ACTIVE' }, usage: { locations: 10, staff: 100, managers: 9 }, limits: { locations: 5, staff: 25, managers: 3 },
    subscription: null, providerState: 'NOT_LINKED', billingConfigured: true, billingEnvironment: 'sandbox', ownerVerified: false,
    reconciliationRequired: false, checkoutAvailable: true, portalAvailable: false, checkoutReadiness: 'READY', workspaceAccessAllowed: false, checkoutResume: null, onboardingStep: 'CHOOSE_PLAN' };
}
function input(data = lifecycle()): BillingViewInput { return { owner, dataOwner: owner, read: 'fresh', data }; }
const subscription = { status: 'active', plan: 'PRO' as const, catalogQualified: true, priceId: 'pri_' + 'a'.repeat(26), interval: 'month' as const,
  periodStart: '2026-11-01T00:00:00Z', periodEnd: '2026-12-01T00:00:00Z', scheduledChangeAction: null, scheduledChangeAt: null, lastEventAt: '2026-11-07T00:00:00Z' };
const resume = { plan: 'PRO' as const, interval: 'year' as const, transactionId: 'txn_' + 'b'.repeat(26) };
const cases: Array<{ name: string; patch?: Partial<BillingLifecycle>; read?: Partial<BillingViewInput>; kind: BillingViewKind }> = [
  { name: 'new owner', kind: 'choose-plan' },
  { name: 'loading', read: { read: 'loading', data: undefined }, kind: 'checking' },
  { name: 'saved exact draft', patch: { checkoutResume: resume, onboardingStep: 'PAYMENT' }, kind: 'resume' },
  { name: 'server permission', patch: { workspaceAccessAllowed: true, onboardingStep: 'WORKSPACE' }, kind: 'confirmed' },
  { name: 'missing server step', patch: { onboardingStep: null }, kind: 'unavailable' },
  { name: 'server hold', patch: { reconciliationRequired: true, onboardingStep: 'RECONCILE' }, kind: 'uncertain' },
  { name: 'hold reason', patch: { checkoutReadiness: 'RECONCILIATION_PENDING', onboardingStep: 'RECONCILE' }, kind: 'uncertain' },
  { name: 'confirming step', patch: { onboardingStep: 'CONFIRMING' }, kind: 'pending' },
  { name: 'unknown subscription', patch: { onboardingStep: 'CONFIRMING', subscription: { ...subscription, status: 'unknown' }, providerState: 'MIRRORED' }, kind: 'pending' },
  { name: 'linked subscriber', patch: { onboardingStep: 'ACCOUNT', subscription, providerState: 'MIRRORED', checkoutReadiness: 'LINKED_SUBSCRIPTION' }, kind: 'existing' },
  { name: 'linked mirror missing', patch: { checkoutReadiness: 'LINKED_SUBSCRIPTION', onboardingStep: 'ACCOUNT' }, kind: 'existing' },
  { name: 'awaiting provider', patch: { providerState: 'AWAITING_PROVIDER', checkoutAvailable: false, onboardingStep: 'CONFIRMING' }, kind: 'pending' },
  { name: 'customer created but still allowed to select', patch: { providerState: 'AWAITING_PROVIDER' }, kind: 'choose-plan' },
  { name: 'disabled', patch: { checkoutReadiness: 'BILLING_DISABLED', billingConfigured: false, onboardingStep: 'UNAVAILABLE' }, kind: 'unavailable' },
  { name: 'unverified live', patch: { checkoutReadiness: 'OWNER_VERIFICATION_REQUIRED', billingEnvironment: 'production', onboardingStep: 'VERIFY_EMAIL' }, kind: 'unavailable' },
  { name: 'legacy no readiness', patch: { checkoutReadiness: undefined, workspaceAccessAllowed: undefined, onboardingStep: undefined }, kind: 'unavailable' },
  { name: 'stale ready', patch: { workspaceAccessAllowed: true, onboardingStep: 'WORKSPACE' }, read: { read: 'stale' }, kind: 'unavailable' },
  { name: 'error ready', patch: { workspaceAccessAllowed: true, onboardingStep: 'WORKSPACE' }, read: { read: 'error' }, kind: 'unavailable' },
  { name: 'unauthorized ready', patch: { workspaceAccessAllowed: true, onboardingStep: 'WORKSPACE' }, read: { httpStatus: 401 }, kind: 'unavailable' },
  { name: 'forbidden', read: { httpStatus: 403 }, kind: 'unavailable' },
  { name: 'owner changed', read: { dataOwner: { ...owner, ownerId: 2 } }, kind: 'unavailable' },
  { name: 'company changed', read: { dataOwner: { ...owner, companyId: 99 } }, kind: 'unavailable' },
  { name: 'no actor', read: { owner: null }, kind: 'unavailable' },
  { name: 'missing result identity', read: { dataOwner: null }, kind: 'unavailable' },
  { name: 'bad result', read: { data: {} }, kind: 'unavailable' },
];
it.each(cases)('$name → $kind', ({ patch, read, kind }) => {
  const data = { ...lifecycle(), ...patch };
  const before = structuredClone(data);
  const result = deriveBillingViewState({ ...input(data), ...read });
  expect(result.kind).toBe(kind);
  expect(result.canOpenWorkspace).toBe(kind === 'confirmed');
  expect(result.canChoosePlan).toBe(kind === 'choose-plan');
  expect(result.resume).toEqual(kind === 'resume' ? resume : null);
  expect(data).toEqual(before);
});
it.each(['active', 'trialing', 'past_due', 'canceled', 'paused'])('%s status/period facts cannot invent permission or a fresh purchase', (status) => {
  const result = deriveBillingViewState(input({ ...lifecycle(), onboardingStep: 'ACCOUNT', subscription: { ...subscription, status, periodStart: null, periodEnd: null }, providerState: 'MIRRORED' }));
  expect(result).toMatchObject({ kind: 'existing', canChoosePlan: false, canOpenWorkspace: false });
});
it.each([false, true])('restriction overrides even explicit server permission=%s', (workspaceAccessAllowed) => {
  const data = lifecycle(); data.workspaceAccessAllowed = workspaceAccessAllowed; data.company.operationalStatus = 'SUSPENDED';
  expect(deriveBillingViewState(input(data))).toMatchObject({ kind: 'restricted', canChoosePlan: false, canOpenWorkspace: false });
});
it('retains exact over-limit counts and safe stale display while denying actions', () => {
  const data = lifecycle(); data.portalAvailable = true;
  const result = deriveBillingViewState({ ...input(data), read: 'stale' });
  expect(result.data?.usage).toEqual({ locations: 10, staff: 100, managers: 9 });
  expect(result).toMatchObject({ canChoosePlan: false, canOpenWorkspace: false, canOpenPortal: false, resume: null });
});
it('does not expose foreign-company payloads even if the query key claims current identity', () => {
  const data = lifecycle(); data.company.id = 99;
  expect(deriveBillingViewState(input(data))).toMatchObject({ kind: 'unavailable', data: null });
});
it('uses fresh server permission independently of new-purchase activation', () => {
  expect(deriveBillingViewState(input({ ...lifecycle(), workspaceAccessAllowed: true, checkoutReadiness: 'BILLING_DISABLED', billingConfigured: false, onboardingStep: 'WORKSPACE' }))).toMatchObject({ kind: 'confirmed', canChoosePlan: false });
});
it('reads API capacities instead of copying backend plan limits and labels Enterprise', () => {
  const supplied = { code: 'ADVANCED', name: 'ADVANCED', description: 'Provided', limits: { locations: 17, staff: 150, managers: 7 }, features: { managerAccess: true, automaticAssignment: true, automaticReassignment: true, inventoryVerification: true }, featureLabels: [] } satisfies PlanDefinition;
  expect(billingPlanDefinition([supplied], 'ADVANCED')).toEqual({ ...supplied, name: 'Enterprise' });
  expect(supplied.name).toBe('ADVANCED');
  expect(billingPlanDefinition([], 'PRO')).toBeNull();
  expect(billingPlanDefinition([supplied, supplied], 'ADVANCED')).toBeNull();
});
it.each([
  { checkoutAvailable: false }, { billingConfigured: false }, { checkoutReadiness: 'UNKNOWN' as const },
  { reconciliationRequired: true },
])('saved draft cannot override missing checkout capability: %#', (patch) => {
  const result = deriveBillingViewState(input({ ...lifecycle(), checkoutResume: resume, onboardingStep: 'PAYMENT', ...patch }));
  expect(result.resume).toBeNull();
  expect(result.canChoosePlan).toBe(false);
  expect(result.canOpenWorkspace).toBe(false);
});
it('fresh linked billing exposes only the server portal capability without authorizing another purchase', () => {
  expect(deriveBillingViewState(input({ ...lifecycle(), onboardingStep: 'ACCOUNT', providerState: 'MIRRORED', subscription, portalAvailable: true }))).toMatchObject({ kind: 'existing', canOpenPortal: true, canChoosePlan: false });
});
it('legacy inactive company never displays workspace-ready', () => {
  const data = lifecycle(); data.company.isActive = false; data.workspaceAccessAllowed = true;
  expect(deriveBillingViewState(input(data))).toMatchObject({ kind: 'restricted', canOpenWorkspace: false });
});
it('saved transactions never substitute for a missing server step', () => {
  expect(deriveBillingViewState(input({ ...lifecycle(), checkoutResume: resume, onboardingStep: null }))).toMatchObject({ kind: 'unavailable', step: null, resume: null });
});
it('legacy fields cannot override an explicit confirming step', () => {
  expect(deriveBillingViewState(input({ ...lifecycle(), onboardingStep: 'CONFIRMING', workspaceAccessAllowed: true, subscription, checkoutResume: resume }))).toMatchObject({ kind: 'pending', step: 'CONFIRMING', canOpenWorkspace: false });
});
