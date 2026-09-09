import type { ValidatedBillingLifecycle } from '../types';

export const checkoutStatuses = [
  'checking', 'preparing', 'frameLoading', 'ready', 'paying', 'declined',
  'frameFailed', 'offline', 'replacing', 'confirming', 'unresolved', 'restricted',
] as const;
export type CheckoutStatus = typeof checkoutStatuses[number];
export type CheckoutAction = 'changePlan' | 'tryAgain' | 'checkStatus' | 'contactSupport';

/** UI capabilities only. Effects and deadlines belong to the session controller. */
export const checkoutActions: Readonly<Record<CheckoutStatus, readonly CheckoutAction[]>> = {
  checking: [], preparing: [], frameLoading: ['changePlan'], ready: ['changePlan'],
  paying: [], declined: ['changePlan'], frameFailed: ['tryAgain', 'changePlan'],
  offline: ['tryAgain'], replacing: [], confirming: [], unresolved: ['checkStatus'],
  restricted: ['contactSupport'],
};
export const checkoutWaits: Readonly<Partial<Record<CheckoutStatus, string>>> = {
  checking: 'Server read deadline', preparing: 'Prepare request deadline',
  paying: 'Payment result or status check deadline', replacing: 'Replacement request deadline',
  confirming: 'Hand off to activation polling',
};

export type CheckoutState = {
  status: CheckoutStatus;
  /** Monotonic generation supplied by the controller on owner/session change. */
  sessionId: number;
  transactionId: string | null;
  onlineStatus?: CheckoutStatus;
};
export function createCheckoutState(sessionId: number): CheckoutState {
  return { status: 'checking', sessionId, transactionId: null };
}

type FrameEvent = 'frameLoaded' | 'frameTimeout' | 'checkout.error' |
  'paymentAttempted' | 'checkout.payment.failed' | 'checkout.payment.error' | 'completed';
type NamedEvent<T extends string> = { [K in T]: { type: K } }[T];
type Facts = Pick<ValidatedBillingLifecycle, 'onboardingStep' | 'checkoutResume'>;
export type CheckoutEvent = { sessionId: number } & (
  | { type: 'serverFactsRead'; facts: Facts }
  | NamedEvent<'prepareStarted' | 'prepareFailed' | 'prepareTimedOut' | 'scriptFailed' |
      'offline' | 'online' | 'replaceStarted' | 'tryAgain'>
  | { type: 'prepareSucceeded' | 'replaced'; transactionId: string }
  | { type: FrameEvent; transactionId: string | null }
);

const frameStatuses: readonly CheckoutStatus[] = ['frameLoading', 'ready', 'paying', 'declined'];

/** No React, provider, clock, storage or I/O. Completion never grants workspace access. */
export function checkoutReducer(state: CheckoutState, event: CheckoutEvent): CheckoutState {
  if (event.sessionId !== state.sessionId) return state;
  const move = (status: CheckoutStatus): CheckoutState =>
    status === state.status ? state : { ...state, status, onlineStatus: undefined };

  if (event.type === 'serverFactsRead') {
    const { onboardingStep, checkoutResume } = event.facts;
    if (onboardingStep === 'RESTRICTED') return move('restricted');
    // Background refetches cannot interrupt an in-flight operation or reopen a frame.
    if (!['checking', 'unresolved', 'offline'].includes(state.status)) return state;
    if (onboardingStep === 'CONFIRMING' || onboardingStep === 'WORKSPACE') return move('confirming');
    if (onboardingStep === 'PAYMENT' && checkoutResume) {
      return { ...state, status: 'frameLoading', transactionId: checkoutResume.transactionId, onlineStatus: undefined };
    }
    if (onboardingStep === 'CHOOSE_PLAN') {
      return { ...state, status: 'checking', transactionId: null, onlineStatus: undefined };
    }
    return move(onboardingStep === null || onboardingStep === 'RECONCILE' || onboardingStep === 'PAYMENT'
      ? 'unresolved' : 'restricted');
  }
  if (event.type === 'offline') {
    if (['offline', 'confirming', 'restricted', 'unresolved'].includes(state.status)) return state;
    const onlineStatus = ['preparing', 'replacing', 'paying'].includes(state.status) ? 'unresolved' : state.status;
    return { ...state, status: 'offline', onlineStatus };
  }
  if (event.type === 'online') return state.status === 'offline' ? move(state.onlineStatus ?? 'checking') : state;
  if (event.type === 'tryAgain') {
    if (state.status === 'frameFailed') return move(state.transactionId ? 'frameLoading' : 'checking');
    return state.status === 'offline' ? move(state.onlineStatus ?? 'checking') : state;
  }
  if (event.type === 'prepareStarted') return state.status === 'checking' ? move('preparing') : state;
  if (event.type === 'replaceStarted') return checkoutActions[state.status].includes('changePlan') ? move('replacing') : state;
  if (event.type === 'prepareSucceeded' || event.type === 'replaced') {
    const expected = event.type === 'replaced' ? 'replacing' : 'preparing';
    return state.status === expected && event.transactionId.trim()
      ? { ...state, status: 'frameLoading', transactionId: event.transactionId, onlineStatus: undefined } : state;
  }
  if (event.type === 'prepareTimedOut') {
    return ['preparing', 'replacing'].includes(state.status) ? move('unresolved') : state;
  }
  // prepareFailed means proven failure before sending; unknown outcomes use prepareTimedOut.
  if (event.type === 'prepareFailed') {
    return ['preparing', 'replacing'].includes(state.status) ? move('frameFailed') : state;
  }
  if (event.type === 'scriptFailed') {
    return ['checking', 'frameLoading'].includes(state.status) ? move('frameFailed') : state;
  }
  // A provider-wide error without a transaction can only fail a loading frame.
  if (event.transactionId === null) {
    return event.type === 'checkout.error' && state.status === 'frameLoading' ? move('frameFailed') : state;
  }
  if (event.transactionId !== state.transactionId || !frameStatuses.includes(state.status)) return state;
  switch (event.type) {
    case 'frameLoaded': return state.status === 'frameLoading' ? move('ready') : state;
    case 'frameTimeout': return state.status === 'frameLoading' ? move('frameFailed') : state;
    case 'paymentAttempted': return ['ready', 'declined'].includes(state.status) ? move('paying') : state;
    case 'checkout.payment.failed':
      return ['ready', 'paying', 'declined'].includes(state.status) ? move('declined') : state;
    case 'checkout.payment.error':
    case 'checkout.error': return move('frameFailed');
    case 'completed': return move('confirming');
    default: return state;
  }
}

/** Declines keep the exact draft and mounted form available for another card attempt. */
export function checkoutFormUsable(state: CheckoutState): boolean {
  return state.status === 'ready' || state.status === 'declined';
}
