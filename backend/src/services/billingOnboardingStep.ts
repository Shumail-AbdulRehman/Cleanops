import type {
    BillingLifecycleDto,
    BillingOnboardingStep,
    BillingRecoveryReason,
} from '../types/billingLifecycle.js';

/** Facts computed by the lifecycle reader. No provider rows, I/O or clock required. */
export type BillingOnboardingFacts = {
    company: Readonly<Pick<BillingLifecycleDto['company'], 'isActive' | 'operationalStatus'>>;
    workspaceAccessAllowed: boolean;
    /** A company subscription linkage, even when its mirror is missing or expired. */
    hasLinkedSubscription: boolean;
    billingConfigured: boolean;
    catalogUsable: boolean;
    /** Whether the price being considered has a trial; never offer it for purchase. */
    priceHasTrial: boolean;
    liveMode: boolean;
    ownerVerified: boolean;
    latestDraftPaid: boolean;
    subscriptionStatusUnknown: boolean;
    openReservation: boolean;
    recordedConflict: Extract<BillingRecoveryReason, 'EMAIL_CONFLICT' | 'CUSTOMER_UNRESOLVED'> | null;
    resumableDraft: boolean;
};

export type BillingOnboardingDecision = {
    onboardingStep: BillingOnboardingStep;
    recoveryReason: BillingRecoveryReason;
};

/** First match wins, in ARCHITECTURE.md order. This selects a step, never grants access. */
export function decideBillingOnboardingStep(facts: Readonly<BillingOnboardingFacts>): BillingOnboardingDecision {
    const step = (onboardingStep: BillingOnboardingStep, recoveryReason: BillingRecoveryReason = null): BillingOnboardingDecision =>
        ({ onboardingStep, recoveryReason });

    if (!facts.company.isActive || facts.company.operationalStatus === 'SUSPENDED') return step('RESTRICTED');
    if (facts.workspaceAccessAllowed) return step('WORKSPACE');
    if (facts.hasLinkedSubscription) return step('ACCOUNT');
    if (!facts.billingConfigured) return step('UNAVAILABLE', 'BILLING_DISABLED');
    if (!facts.catalogUsable || facts.priceHasTrial) return step('UNAVAILABLE', 'PRICE_NOT_READY');
    if (facts.liveMode && !facts.ownerVerified) return step('VERIFY_EMAIL');
    if (facts.latestDraftPaid || facts.subscriptionStatusUnknown) return step('CONFIRMING');
    if (facts.openReservation || facts.recordedConflict !== null) {
        return step('RECONCILE', facts.recordedConflict ?? 'CUSTOMER_UNRESOLVED');
    }
    if (facts.resumableDraft) return step('PAYMENT');
    return step('CHOOSE_PLAN');
}
