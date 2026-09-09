import { describe, expect, it } from 'vitest';
import {
  checkoutActions, checkoutFormUsable, checkoutReducer, checkoutStatuses, checkoutWaits,
  createCheckoutState, type CheckoutEvent, type CheckoutState, type CheckoutStatus,
} from './checkoutMachine';

const state = (status: CheckoutStatus): CheckoutState => ({ status, sessionId: 1, transactionId: 'txn_current' });
const facts = (onboardingStep: 'PAYMENT' | 'CHOOSE_PLAN' | 'CONFIRMING' | 'WORKSPACE' | 'RECONCILE' | 'RESTRICTED' | 'ACCOUNT' | 'UNAVAILABLE' | 'VERIFY_EMAIL' | null): CheckoutEvent => ({
  type: 'serverFactsRead', sessionId: 1,
  facts: { onboardingStep, checkoutResume: { transactionId: 'txn_current', plan: 'PRO', interval: 'month' } },
});
const event = (type: Exclude<CheckoutEvent['type'], 'serverFactsRead'>): CheckoutEvent => ({ type, sessionId: 1, transactionId: 'txn_current' });
const events = [facts('PAYMENT'), ...([
  'prepareStarted', 'prepareSucceeded', 'prepareFailed', 'prepareTimedOut', 'scriptFailed',
  'frameLoaded', 'frameTimeout', 'checkout.error', 'paymentAttempted', 'checkout.payment.failed',
  'checkout.payment.error', 'completed', 'offline', 'online', 'replaceStarted', 'replaced', 'tryAgain',
] as const).map(event)];
// Independent transition oracle: unspecified source states must retain object identity.
const transitions: Record<CheckoutEvent['type'], Partial<Record<CheckoutStatus, CheckoutStatus>>> = {
  serverFactsRead: { checking: 'frameLoading', unresolved: 'frameLoading', offline: 'frameLoading' },
  prepareStarted: { checking: 'preparing' },
  prepareSucceeded: { preparing: 'frameLoading' },
  prepareFailed: { preparing: 'frameFailed', replacing: 'frameFailed' },
  prepareTimedOut: { preparing: 'unresolved', replacing: 'unresolved' },
  scriptFailed: { checking: 'frameFailed', frameLoading: 'frameFailed' },
  frameLoaded: { frameLoading: 'ready' }, frameTimeout: { frameLoading: 'frameFailed' },
  'checkout.error': { frameLoading: 'frameFailed', ready: 'frameFailed', paying: 'frameFailed', declined: 'frameFailed' },
  paymentAttempted: { ready: 'paying', declined: 'paying' },
  'checkout.payment.failed': { ready: 'declined', paying: 'declined', declined: 'declined' },
  'checkout.payment.error': { frameLoading: 'frameFailed', ready: 'frameFailed', paying: 'frameFailed', declined: 'frameFailed' },
  completed: { frameLoading: 'confirming', ready: 'confirming', paying: 'confirming', declined: 'confirming' },
  offline: { checking: 'offline', preparing: 'offline', frameLoading: 'offline', ready: 'offline', paying: 'offline', declined: 'offline', frameFailed: 'offline', replacing: 'offline' },
  online: { offline: 'checking' },
  replaceStarted: { frameLoading: 'replacing', ready: 'replacing', declined: 'replacing', frameFailed: 'replacing' },
  replaced: { replacing: 'frameLoading' }, tryAgain: { frameFailed: 'frameLoading', offline: 'checking' },
};

describe.each(checkoutStatuses)('%s state/event table', (status) => {
  it.each(events)('$type', (input) => {
    const before = state(status);
    const after = checkoutReducer(before, input);
    expect(after.status).toBe(transitions[input.type][status] ?? status);
    expect(after.sessionId).toBe(1);
    expect(after.transactionId).toBe('txn_current');
    if (!(status in transitions[input.type])) expect(after).toBe(before);
  });
  it.each(events)('ignores stale session $type', (input) => {
    const before = state(status);
    expect(checkoutReducer(before, { ...input, sessionId: 0 })).toBe(before);
  });
});

it.each(checkoutStatuses)('%s has exactly the architecture actions or an explicit wait', (status) => {
  const expected = {
    checking: [], preparing: [], frameLoading: ['changePlan'], ready: ['changePlan'], paying: [],
    declined: ['changePlan'], frameFailed: ['tryAgain', 'changePlan'], offline: ['tryAgain'],
    replacing: [], confirming: [], unresolved: ['checkStatus'], restricted: ['contactSupport'],
  };
  expect(checkoutActions[status]).toEqual(expected[status]);
  expect(checkoutActions[status].length > 0 || Boolean(checkoutWaits[status])).toBe(true);
});

const frameEvents = ['frameLoaded', 'frameTimeout', 'checkout.error', 'paymentAttempted', 'checkout.payment.failed', 'checkout.payment.error', 'completed'] as const;
describe.each(checkoutStatuses)('%s transaction guards', (status) => {
  it.each(frameEvents)('ignores foreign $0', (type) => {
    const before = state(status);
    expect(checkoutReducer(before, { type, sessionId: 1, transactionId: 'txn_old' })).toBe(before);
  });
  it.each(frameEvents)('guards transactionless $0', (type) => {
    const before = state(status);
    const after = checkoutReducer(before, { type, sessionId: 1, transactionId: null });
    if (type === 'checkout.error' && status === 'frameLoading') expect(after.status).toBe('frameFailed');
    else expect(after).toBe(before);
  });
});

it('keeps the same usable form after decline and permits another payment attempt', () => {
  const declined = checkoutReducer(state('paying'), event('checkout.payment.failed'));
  expect(checkoutFormUsable(declined)).toBe(true);
  expect(declined.transactionId).toBe('txn_current');
  expect(checkoutReducer(declined, event('paymentAttempted')).status).toBe('paying');
  expect(checkoutFormUsable(checkoutReducer(state('paying'), event('checkout.payment.error')))).toBe(false);
});

it.each(['preparing', 'replacing'] as const)('never retries an unknown %s outcome without fresh server facts', (status) => {
  const unresolved = checkoutReducer(state(status), event('prepareTimedOut'));
  expect(unresolved.status).toBe('unresolved');
  for (const type of ['prepareStarted', 'replaceStarted', 'tryAgain', 'prepareSucceeded', 'replaced', 'online'] as const) {
    expect(checkoutReducer(unresolved, event(type))).toBe(unresolved);
  }
  expect(checkoutReducer(unresolved, facts('PAYMENT')).status).toBe('frameLoading');
  const cleared = checkoutReducer(unresolved, facts('CHOOSE_PLAN'));
  expect(cleared.transactionId).toBeNull();
  expect(checkoutReducer(cleared, event('prepareStarted')).status).toBe('preparing');
});

it.each(['checking', 'preparing', 'frameLoading', 'ready', 'paying', 'declined', 'frameFailed', 'replacing'] as const)('recovers safely from offline during %s', (status) => {
  const offline = checkoutReducer(state(status), event('offline'));
  const expected = ['preparing', 'replacing', 'paying'].includes(status) ? 'unresolved' : status;
  expect(checkoutReducer(offline, event('online')).status).toBe(expected);
  expect(checkoutReducer(offline, event('tryAgain')).status).toBe(expected);
});

it.each(['CONFIRMING', 'WORKSPACE', 'RECONCILE', 'RESTRICTED', 'ACCOUNT', 'UNAVAILABLE', 'VERIFY_EMAIL', null] as const)('uses fresh server step %s without granting access', (step) => {
  const expected = step === 'CONFIRMING' || step === 'WORKSPACE' ? 'confirming'
    : step === 'RECONCILE' || step === null ? 'unresolved' : 'restricted';
  expect(checkoutReducer(createCheckoutState(1), facts(step)).status).toBe(expected);
});
it('treats payment without a draft as unresolved', () => {
  expect(checkoutReducer(createCheckoutState(1), { type: 'serverFactsRead', sessionId: 1, facts: { onboardingStep: 'PAYMENT', checkoutResume: null } }).status).toBe('unresolved');
});
it.each(checkoutStatuses)('administrative restriction interrupts %s', (status) => {
  expect(checkoutReducer(state(status), facts('RESTRICTED')).status).toBe('restricted');
});
it('does not reopen a usable form on background refetch', () => {
  const before = state('declined');
  expect(checkoutReducer(before, facts('PAYMENT'))).toBe(before);
});
it('replaces the draft and ignores delayed events from the prior transaction', () => {
  const replacing = checkoutReducer(state('ready'), event('replaceStarted'));
  const next = checkoutReducer(replacing, { type: 'replaced', sessionId: 1, transactionId: 'txn_new' });
  expect(next.transactionId).toBe('txn_new');
  expect(checkoutReducer(next, event('completed'))).toBe(next);
});
it('allows retry of a script failure before any draft exists', () => {
  const failed = checkoutReducer(createCheckoutState(1), event('scriptFailed'));
  expect(checkoutReducer(failed, event('tryAgain'))).toEqual(createCheckoutState(1));
});
it.each(['prepareSucceeded', 'replaced'] as const)('rejects an empty transaction from %s', (type) => {
  const before = state(type === 'replaced' ? 'replacing' : 'preparing');
  expect(checkoutReducer(before, { type, sessionId: 1, transactionId: ' ' })).toBe(before);
});
it('does not mutate reducer inputs', () => {
  const before = Object.freeze(state('ready'));
  const input = Object.freeze(event('paymentAttempted'));
  expect(checkoutReducer(before, input).status).toBe('paying');
  expect(before.status).toBe('ready');
});
