export type PlanCode = "STARTER" | "PRO" | "ADVANCED";

export type PlanDefinition = {
  code: PlanCode;
  name: string;
  description: string;
  limits: {
    locations: number;
    staff: number;
    managers: number;
  };
  features: {
    managerAccess: boolean;
    automaticAssignment: boolean;
    automaticReassignment: boolean;
    inventoryVerification:boolean;
  };
  featureLabels: string[];
};

export type SubscriptionSummary = {
  company: {
    id: number;
    name: string;
    plan: PlanCode;
    subscriptionStatus: "ACTIVE" | "PAST_DUE" | "CANCELLED";
    planUpdatedAt: string;
    billingCustomerId: string | null;
    billingSubscriptionId: string | null;
  };
  plan: PlanDefinition;
  usage: {
    locations: number;
    staff: number;
    managers: number;
  };
  availablePlans: PlanDefinition[];
};

export type ApiEnvelope<T> = {
  success: boolean;
  message: string;
  data: T;
};

export type PricingContext = {
  countryCode?: string;
};

export type BillingLifecycle = {
 company:{id:number;name:string;plan:PlanCode;isActive:boolean;operationalStatus:'ACTIVE'|'SUSPENDED'};
 usage:{locations:number;staff:number;managers:number};
 limits:PlanDefinition['limits'];
 subscription:null|{priceId?:string|null;interval?:BillingInterval|null;status:string;plan:PlanCode|null;catalogQualified:boolean;periodStart:string|null;periodEnd:string|null;scheduledChangeAction:string|null;scheduledChangeAt:string|null;lastEventAt:string};
 workspaceAccessAllowed?:boolean;checkoutReadiness?:CheckoutReadiness;checkoutResume?:BillingCheckoutResume|null;
 reconciliationRequired:boolean;billingConfigured:boolean;ownerVerified:boolean;
 billingEnvironment?:'sandbox'|'production'|null;onboardingRequired?:boolean;
 /** Optional until lifecycle assembly sends these fields; absence grants nothing. */
 onboardingStep?:BillingOnboardingStep|null;recoveryReason?:BillingRecoveryReason;
 providerState:'MIRRORED'|'AWAITING_PROVIDER'|'NOT_LINKED';portalAvailable:boolean;checkoutAvailable:boolean;
};

export type BillingCatalogEntry = {
 plan: PlanCode; interval: 'month' | 'year'; priceId: string; productId: string;
 amount: string; currencyCode: string;
 /** @deprecated Compatibility only for screens awaiting replacement. New checkouts have no trial. */
 trialPeriod?: null | {interval: string; frequency: number; requiresPaymentMethod?:boolean|null};
};
export type BillingCheckout = {
 transactionId: string; reused: boolean;
 /** Optional until checkout replacement is implemented in spec 26. */
 replaced?: boolean;
};
export type ValidatedBillingCheckout = BillingCheckout & { replaced: boolean };
export type BillingOnboardingStep = 'CHOOSE_PLAN' | 'PAYMENT' | 'CONFIRMING' | 'WORKSPACE' | 'ACCOUNT' | 'RECONCILE' | 'RESTRICTED' | 'VERIFY_EMAIL' | 'UNAVAILABLE';
export type BillingRecoveryReason = null | 'EMAIL_CONFLICT' | 'CUSTOMER_UNRESOLVED' | 'BILLING_DISABLED' | 'PRICE_NOT_READY';
export type BillingConfirmOutcome = 'ACTIVE' | 'PROCESSING' | 'NOT_PAID' | 'NO_CHECKOUT';
export type BillingConfirmResult = { outcome: BillingConfirmOutcome; lifecycle: BillingLifecycle };
export type BillingReconcileOutcome = 'RESUMABLE' | 'CLEARED' | 'IN_PROGRESS' | 'PAID' | 'UNRESOLVED' | 'CONFLICT';
export type BillingReconcileResult = { outcome: BillingReconcileOutcome; lifecycle: BillingLifecycle };

/** Additive wire fields stay optional while older deployments roll forward. */
export type BillingInterval = 'month' | 'year';
export type CheckoutReadiness = 'UNKNOWN' | 'BILLING_DISABLED' | 'OWNER_VERIFICATION_REQUIRED' | 'COMPANY_RESTRICTED' | 'RECONCILIATION_PENDING' | 'LINKED_SUBSCRIPTION' | 'READY';
export type BillingCheckoutResume = { plan: PlanCode; interval: BillingInterval; transactionId: string };
export type ValidatedBillingLifecycle = BillingLifecycle & {
  workspaceAccessAllowed: boolean;
  checkoutReadiness: CheckoutReadiness;
  checkoutResume: BillingCheckoutResume | null;
  onboardingStep: BillingOnboardingStep | null;
  recoveryReason: BillingRecoveryReason;
};
