/** Public JSON DTOs only. No Prisma rows, secrets, card fields or portal history. */
export type BillingPlanCode = 'STARTER' | 'PRO' | 'ADVANCED';
export type BillingInterval = 'month' | 'year';
export type CheckoutReadiness = 'UNKNOWN' | 'BILLING_DISABLED' | 'OWNER_VERIFICATION_REQUIRED' | 'COMPANY_RESTRICTED' | 'RECONCILIATION_PENDING' | 'LINKED_SUBSCRIPTION' | 'READY';
export type BillingCheckoutResume = { plan: BillingPlanCode; interval: BillingInterval; transactionId: string };
export type BillingCapacity = { locations: number; staff: number; managers: number };
export type BillingOnboardingStep = 'CHOOSE_PLAN' | 'PAYMENT' | 'CONFIRMING' | 'WORKSPACE' | 'ACCOUNT' | 'RECONCILE' | 'RESTRICTED' | 'VERIFY_EMAIL' | 'UNAVAILABLE';
export type BillingRecoveryReason = null | 'EMAIL_CONFLICT' | 'CUSTOMER_UNRESOLVED' | 'BILLING_DISABLED' | 'PRICE_NOT_READY';
export type BillingLifecycleDto = {
  company: { id: number; name: string; plan: BillingPlanCode; isActive: boolean; operationalStatus: 'ACTIVE' | 'SUSPENDED' };
  usage: BillingCapacity;
  limits: BillingCapacity;
  subscription: null | {
    status: string; plan: BillingPlanCode | null; catalogQualified: boolean;
    priceId?: string | null; interval?: BillingInterval | null;
    periodStart: string | null; periodEnd: string | null;
    scheduledChangeAction: string | null; scheduledChangeAt: string | null; lastEventAt: string;
  };
  reconciliationRequired: boolean; billingConfigured: boolean; ownerVerified: boolean;
  billingEnvironment?: 'sandbox' | 'production' | null; onboardingRequired?: boolean;
  providerState: 'MIRRORED' | 'AWAITING_PROVIDER' | 'NOT_LINKED';
  portalAvailable: boolean; checkoutAvailable: boolean;
  workspaceAccessAllowed?: boolean; checkoutReadiness?: CheckoutReadiness;
  checkoutResume?: BillingCheckoutResume | null;
  /** Optional until lifecycle assembly sends these fields; absence grants nothing. */
  onboardingStep?: BillingOnboardingStep | null;
  recoveryReason?: BillingRecoveryReason;
};
export type BillingCatalogEntryDto = {
  plan: BillingPlanCode; interval: BillingInterval; priceId: string; productId: string;
  amount: string; currencyCode: string;
  /** @deprecated Compatibility only for screens awaiting replacement. New checkouts have no trial. */
  trialPeriod?: null | { interval: string; frequency: number; requiresPaymentMethod?: boolean | null };
};
export type BillingCheckoutDto = {
  transactionId: string; reused: boolean;
  /** Optional until checkout replacement is implemented in spec 26. */
  replaced?: boolean;
};
export type BillingConfirmOutcome = 'ACTIVE' | 'PROCESSING' | 'NOT_PAID' | 'NO_CHECKOUT';
export type BillingConfirmDto = { outcome: BillingConfirmOutcome; lifecycle: BillingLifecycleDto };
export type BillingReconcileOutcome = 'RESUMABLE' | 'CLEARED' | 'IN_PROGRESS' | 'PAID' | 'UNRESOLVED' | 'CONFLICT';
export type BillingReconcileDto = { outcome: BillingReconcileOutcome; lifecycle: BillingLifecycleDto };
