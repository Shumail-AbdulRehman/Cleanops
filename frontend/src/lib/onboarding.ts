import type { SubscriptionSummary } from '../pages/Subscription/types';

// Returning customers manage expired/cancelled subscriptions in billing.
// Only a workspace that has never subscribed needs first-run plan selection.
export const needsPlanSelection = (company: SubscriptionSummary['company']) =>
  company.subscriptionStatus !== 'ACTIVE' && !company.billingSubscriptionId;
