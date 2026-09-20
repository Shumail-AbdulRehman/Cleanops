import { test } from 'node:test';
import assert from 'node:assert/strict';
import { needsPlanSelection } from '../src/lib/onboarding.ts';

test('newly registered company must choose a plan', () => {
  assert.equal(needsPlanSelection({ subscriptionStatus: 'CANCELLED', billingSubscriptionId: null }), true);
});
test('a returning unpaid signup resumes plan selection', () => {
  assert.equal(needsPlanSelection({ subscriptionStatus: 'CANCELLED', billingCustomerId: 'ctm_pending', billingSubscriptionId: null }), true);
});
test('active subscriptions and legacy active accounts can enter their workspace', () => {
  for (const billingSubscriptionId of [null, 'sub_active']) {
    assert.equal(needsPlanSelection({ subscriptionStatus: 'ACTIVE', billingSubscriptionId }), false);
  }
});
test('existing cancelled or past-due subscriptions keep access to billing', () => {
  for (const subscriptionStatus of ['CANCELLED', 'PAST_DUE']) {
    assert.equal(needsPlanSelection({ subscriptionStatus, billingSubscriptionId: 'sub_existing' }), false);
  }
});
