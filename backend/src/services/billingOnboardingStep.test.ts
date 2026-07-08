import { describe, expect, it } from 'vitest';
import { decideBillingOnboardingStep, type BillingOnboardingFacts, type BillingOnboardingDecision } from './billingOnboardingStep.js';

function facts(change: Partial<BillingOnboardingFacts> = {}): BillingOnboardingFacts {
    return {
        company: { isActive: true, operationalStatus: 'ACTIVE' },
        workspaceAccessAllowed: false,
        hasLinkedSubscription: false,
        billingConfigured: true,
        catalogUsable: true,
        priceHasTrial: false,
        liveMode: false,
        ownerVerified: false,
        latestDraftPaid: false,
        subscriptionStatusUnknown: false,
        openReservation: false,
        recordedConflict: null,
        resumableDraft: false,
        ...change,
    };
}

type Row = { name: string; change: Partial<BillingOnboardingFacts>; expected: BillingOnboardingDecision };
// Architecture order, including each alternative within a row.
const rows: Row[] = [
    { name: 'inactive company', change: { company: { isActive: false, operationalStatus: 'ACTIVE' } }, expected: { onboardingStep: 'RESTRICTED', recoveryReason: null } },
    { name: 'suspended company', change: { company: { isActive: true, operationalStatus: 'SUSPENDED' } }, expected: { onboardingStep: 'RESTRICTED', recoveryReason: null } },
    { name: 'workspace access allowed', change: { workspaceAccessAllowed: true }, expected: { onboardingStep: 'WORKSPACE', recoveryReason: null } },
    { name: 'linked subscriber without access', change: { hasLinkedSubscription: true }, expected: { onboardingStep: 'ACCOUNT', recoveryReason: null } },
    { name: 'billing disabled', change: { billingConfigured: false }, expected: { onboardingStep: 'UNAVAILABLE', recoveryReason: 'BILLING_DISABLED' } },
    { name: 'unusable catalog', change: { catalogUsable: false }, expected: { onboardingStep: 'UNAVAILABLE', recoveryReason: 'PRICE_NOT_READY' } },
    { name: 'price has a trial', change: { priceHasTrial: true }, expected: { onboardingStep: 'UNAVAILABLE', recoveryReason: 'PRICE_NOT_READY' } },
    { name: 'unverified live owner', change: { liveMode: true }, expected: { onboardingStep: 'VERIFY_EMAIL', recoveryReason: null } },
    { name: 'paid draft pending activation', change: { latestDraftPaid: true }, expected: { onboardingStep: 'CONFIRMING', recoveryReason: null } },
    { name: 'unknown subscription status', change: { subscriptionStatusUnknown: true }, expected: { onboardingStep: 'CONFIRMING', recoveryReason: null } },
    { name: 'open reservation', change: { openReservation: true }, expected: { onboardingStep: 'RECONCILE', recoveryReason: 'CUSTOMER_UNRESOLVED' } },
    { name: 'email conflict', change: { recordedConflict: 'EMAIL_CONFLICT' }, expected: { onboardingStep: 'RECONCILE', recoveryReason: 'EMAIL_CONFLICT' } },
    { name: 'unresolved customer', change: { recordedConflict: 'CUSTOMER_UNRESOLVED' }, expected: { onboardingStep: 'RECONCILE', recoveryReason: 'CUSTOMER_UNRESOLVED' } },
    { name: 'resumable unpaid draft', change: { resumableDraft: true }, expected: { onboardingStep: 'PAYMENT', recoveryReason: null } },
    { name: 'no earlier match', change: {}, expected: { onboardingStep: 'CHOOSE_PLAN', recoveryReason: null } },
];

describe('server onboarding decision', () => {
    it.each(rows)('$name', ({ change, expected }) => {
        expect(decideBillingOnboardingStep(facts(change))).toEqual(expected);
    });

    // All earlier/later decision-row pairs, including each alternative trigger.
    const conflicts = rows.flatMap((earlier, index) => rows.slice(index + 1)
        .filter(later => later.expected.onboardingStep !== earlier.expected.onboardingStep).map(later => ({
        name: `${earlier.name} beats ${later.name}`,
        earlier,
        later,
    })));
    it.each(conflicts)('$name', ({ earlier, later }) => {
        expect(decideBillingOnboardingStep(facts({ ...later.change, ...earlier.change }))).toEqual(earlier.expected);
    });

    it.each([
        { liveMode: false, ownerVerified: false },
        { liveMode: false, ownerVerified: true },
        { liveMode: true, ownerVerified: true },
    ])('allows plan selection for verification facts %j', change => {
        expect(decideBillingOnboardingStep(facts(change))).toEqual({ onboardingStep: 'CHOOSE_PLAN', recoveryReason: null });
    });

    it('suspension beats payment and every other fact at once', () => {
        expect(decideBillingOnboardingStep(facts({
            company: { isActive: true, operationalStatus: 'SUSPENDED' },
            workspaceAccessAllowed: true, hasLinkedSubscription: true, billingConfigured: false,
            catalogUsable: false, priceHasTrial: true, liveMode: true, latestDraftPaid: true,
            subscriptionStatusUnknown: true, openReservation: true,
            recordedConflict: 'EMAIL_CONFLICT', resumableDraft: true,
        }))).toEqual({ onboardingStep: 'RESTRICTED', recoveryReason: null });
    });

    it('sends an expired linked subscriber to ACCOUNT even when checkout facts exist', () => {
        expect(decideBillingOnboardingStep(facts({
            hasLinkedSubscription: true, workspaceAccessAllowed: false,
            latestDraftPaid: true, resumableDraft: true, openReservation: true,
        }))).toEqual({ onboardingStep: 'ACCOUNT', recoveryReason: null });
    });

    it('preserves a recorded email conflict while a reservation is open', () => {
        expect(decideBillingOnboardingStep(facts({ openReservation: true, recordedConflict: 'EMAIL_CONFLICT' })))
            .toEqual({ onboardingStep: 'RECONCILE', recoveryReason: 'EMAIL_CONFLICT' });
    });

    it('reports disabled billing before catalog readiness when both are unavailable', () => {
        expect(decideBillingOnboardingStep(facts({ billingConfigured: false, catalogUsable: false, priceHasTrial: true })))
            .toEqual({ onboardingStep: 'UNAVAILABLE', recoveryReason: 'BILLING_DISABLED' });
    });

    it('does not mutate facts and returns a fresh decision on repeated reads', () => {
        const input = Object.freeze({ ...facts(), company: Object.freeze(facts().company) });
        const before = structuredClone(input);
        const first = decideBillingOnboardingStep(input);
        expect(decideBillingOnboardingStep(input)).toEqual(first);
        expect(decideBillingOnboardingStep(input)).not.toBe(first);
        expect(input).toEqual(before);
    });
});
