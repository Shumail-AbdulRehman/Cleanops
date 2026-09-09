import { StrictMode, type ReactNode } from 'react';
import { act, cleanup, renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { NormalizedPaddleEvent, PaddleEventListener } from '@/lib/paddle';
import type { ValidatedBillingLifecycle } from '../types';
import { billingRequest, BillingRequestError, BILLING_REQUEST_LIMITS } from './billingRequest';
import { billingLifecycleKey } from '../queries';
import { useCheckoutSession, type CheckoutSelection } from './useCheckoutSession';

const m = vi.hoisted(() => ({
  user: { id: 7, companyId: 42, role: 'ADMIN' } as { id: number; companyId: number; role: string } | null,
  actor: vi.fn(), read: vi.fn(), prepare: vi.fn(), sdk: vi.fn(), open: vi.fn(), close: vi.fn(),
  rawListeners: new Set<PaddleEventListener>(),
  listeners: new Set<(event: NormalizedPaddleEvent) => void>(),
}));
vi.mock('@/hooks/useAuth', () => ({ default: () => ({ user: m.user }) }));
vi.mock('@/api/auth', () => ({ getCurrentUser: m.actor }));
vi.mock('../api', () => ({ getBillingLifecycle: m.read, prepareBillingCheckout: m.prepare }));
vi.mock('@/lib/paddle', () => ({
  getPaddle: m.sdk, openInlineCheckout: m.open,
  CheckoutEventNames: { CHECKOUT_PAYMENT_INITIATED: 'checkout.payment.initiated' },
  subscribePaddleEvents: (listener: PaddleEventListener) => {
    m.rawListeners.add(listener); return () => { m.rawListeners.delete(listener); };
  },
  subscribeNormalizedPaddleEvents: (listener: (event: NormalizedPaddleEvent) => void) => {
    m.listeners.add(listener); return () => { m.listeners.delete(listener); };
  },
}));
const selection: CheckoutSelection = { plan: 'PRO', interval: 'month' };
const transactionId = 'txn_' + 'a'.repeat(26);
const replacementId = 'txn_' + 'b'.repeat(26);
let facts: ValidatedBillingLifecycle;
const clients: QueryClient[] = [];
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
async function flush() { await act(async () => { for (let i = 0; i < 40; i++) await Promise.resolve(); }); }
function mount({ strict = false, chosen = selection as CheckoutSelection | undefined } = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  clients.push(client);
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>
    {strict ? <StrictMode>{children}</StrictMode> : children}
  </QueryClientProvider>;
  const hook = renderHook(({ chosen }) => useCheckoutSession(chosen), { wrapper, initialProps: { chosen } });
  act(() => hook.result.current.registerFrameTarget('checkout-fixture'));
  return { ...hook, client };
}
async function emit(event: NormalizedPaddleEvent) {
  await act(async () => { for (const listener of [...m.listeners]) listener(event); });
}
async function ready() { const h = mount(); await flush(); await emit({ type: 'loaded', transactionId }); return h; }
beforeEach(() => {
  vi.useFakeTimers(); vi.resetAllMocks(); m.listeners.clear(); m.rawListeners.clear();
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
  m.user = { id: 7, companyId: 42, role: 'ADMIN' };
  facts = {
    company: { id: 42, name: 'Fixture', plan: 'PRO', isActive: true, operationalStatus: 'ACTIVE' },
    usage: { locations: 0, staff: 0, managers: 1 }, limits: { locations: 5, staff: 25, managers: 3 }, subscription: null,
    reconciliationRequired: false, billingConfigured: true, ownerVerified: false, billingEnvironment: 'sandbox',
    providerState: 'NOT_LINKED', portalAvailable: false, checkoutAvailable: true, checkoutReadiness: 'READY',
    workspaceAccessAllowed: false, checkoutResume: null, onboardingStep: 'CHOOSE_PLAN', recoveryReason: null,
  };
  m.actor.mockImplementation(async () => ({ ...m.user }));
  m.read.mockImplementation(async () => structuredClone(facts));
  m.sdk.mockResolvedValue({ Checkout: { close: m.close } });
  m.open.mockResolvedValue(undefined);
  m.prepare.mockImplementation(async () => {
    facts = { ...facts, onboardingStep: 'PAYMENT', checkoutResume: { ...selection, transactionId } };
    return { transactionId, reused: false, replaced: false };
  });
});
afterEach(() => { cleanup(); clients.splice(0).forEach(client => client.clear()); vi.useRealTimers(); });

it('prepares once under StrictMode double mount, after owner/facts/SDK checks, then opens the registered target', async () => {
  const h = mount({ strict: true }); await flush();
  expect(m.prepare).toHaveBeenCalledExactlyOnceWith('PRO', 'month', expect.any(AbortSignal));
  expect(m.actor).toHaveBeenCalledBefore(m.read); expect(m.read).toHaveBeenCalledBefore(m.sdk);
  expect(m.sdk).toHaveBeenCalledBefore(m.prepare);
  expect(m.open).toHaveBeenCalledExactlyOnceWith({ transactionId, frameTarget: 'checkout-fixture' });
  expect(h.result.current.status).toBe('frameLoading');
  await emit({ type: 'loaded', transactionId }); expect(h.result.current.status).toBe('ready');
});
it('waits for a frame target without creating or opening a second draft', async () => {
  const h = mount(); act(() => h.result.current.registerFrameTarget(null)); await flush();
  expect(m.prepare).toHaveBeenCalledOnce(); expect(m.open).not.toHaveBeenCalled();
  act(() => h.result.current.registerFrameTarget('late-target')); await flush();
  expect(m.open).toHaveBeenCalledExactlyOnceWith({ transactionId, frameTarget: 'late-target' });
});
it('SDK failure creates no draft and explicit retry loads SDK before the single prepare', async () => {
  m.sdk.mockRejectedValueOnce(new Error('private SDK error')); const h = mount(); await flush();
  expect(h.result.current.status).toBe('frameFailed'); expect(m.prepare).not.toHaveBeenCalled();
  await act(async () => { await h.result.current.tryAgain(); });
  expect(m.prepare).toHaveBeenCalledOnce(); expect(m.open).toHaveBeenCalledOnce();
});
it('watchdog reaches frameFailed after exactly 20 seconds and retries the same transaction', async () => {
  const h = mount(); await flush();
  await act(async () => { vi.advanceTimersByTime(19_999); }); expect(h.result.current.status).toBe('frameLoading');
  await act(async () => { vi.advanceTimersByTime(1); }); expect(h.result.current.status).toBe('frameFailed');
  await act(async () => { await h.result.current.tryAgain(); });
  expect(m.prepare).toHaveBeenCalledOnce(); expect(m.open).toHaveBeenCalledTimes(2); expect(m.close).toHaveBeenCalledOnce();
});
it('only loaded marks readiness, cancels watchdog, and exposes only normalized latest amounts', async () => {
  const h = mount(); await flush();
  const totals = { subtotal: 10, tax: 2, total: 12, discount: 0 };
  await emit({ type: 'updated', transactionId, totals, currencyCode: 'USD' }); expect(h.result.current.status).toBe('frameLoading');
  await emit({ type: 'loaded', transactionId, totals }); expect(h.result.current.totals).toEqual({ totals, currencyCode: 'USD' });
  const recurringTotals = { ...totals, total: 20 };
  await emit({ type: 'updated', transactionId, recurringTotals });
  expect(h.result.current.totals).toEqual({ totals, recurringTotals, currencyCode: 'USD' });
  await act(async () => { vi.advanceTimersByTime(30_000); }); expect(h.result.current.status).toBe('ready');
});
it('decline keeps the same usable draft, totals and open form', async () => {
  const h = await ready(); await emit({ type: 'paymentFailed', transactionId });
  expect(h.result.current.status).toBe('declined'); expect(h.result.current.prepared?.transactionId).toBe(transactionId);
  expect(m.open).toHaveBeenCalledOnce(); expect(m.prepare).toHaveBeenCalledOnce(); expect(m.close).not.toHaveBeenCalled();
});
it('timeout after send becomes unresolved and every retry/change-plan call sends no second POST', async () => {
  m.prepare.mockImplementation((_plan, _interval, signal) => billingRequest(() => new Promise(() => {}), BILLING_REQUEST_LIMITS.prepare, signal));
  const h = mount(); await flush(); expect(h.result.current.status).toBe('preparing');
  await act(async () => { vi.advanceTimersByTime(45_000); });
  expect(h.result.current.status).toBe('unresolved'); expect(h.result.current.actionBusy).toBe(false);
  await act(async () => { await h.result.current.tryAgain(); await h.result.current.changePlan({ plan: 'STARTER', interval: 'year' }); });
  expect(m.prepare).toHaveBeenCalledOnce(); expect(m.open).not.toHaveBeenCalled();
});
it('status check has its own lock and can complete during a hung prepare without sending another purchase', async () => {
  const pending = deferred<{ transactionId: string }>(); m.prepare.mockReturnValue(pending.promise);
  const h = mount(); await flush(); expect(h.result.current.actionBusy).toBe(true);
  const readCount = m.read.mock.calls.length;
  await act(async () => { await h.result.current.checkStatus(); });
  expect(m.read).toHaveBeenCalledTimes(readCount + 1); expect(h.result.current.statusBusy).toBe(false);
  expect(h.result.current.actionBusy).toBe(true); expect(h.result.current.status).toBe('preparing');
  await act(async () => { await h.result.current.changePlan(selection); }); expect(m.prepare).toHaveBeenCalledOnce();
  pending.resolve({ transactionId }); await flush(); expect(h.result.current.status).toBe('frameLoading');
});
it('coalesces double status clicks independently of the action lock', async () => {
  const h = await ready(); const pending = deferred<ValidatedBillingLifecycle>(); m.read.mockReturnValue(pending.promise);
  let first!: Promise<void>; await act(async () => { first = h.result.current.checkStatus(); }); await flush();
  expect(h.result.current.statusBusy).toBe(true);
  await act(async () => { await h.result.current.checkStatus(); });
  const count = m.read.mock.calls.length; pending.resolve(facts); await act(async () => { await first; });
  expect(m.read).toHaveBeenCalledTimes(count); expect(h.result.current.statusBusy).toBe(false);
});
it('status recovery resumes a server-proven draft after a lost response without preparing again', async () => {
  m.prepare.mockRejectedValueOnce(new BillingRequestError('timed_out_after_send', true));
  const h = mount(); await flush(); expect(h.result.current.status).toBe('unresolved');
  facts.onboardingStep = 'PAYMENT'; facts.checkoutResume = { ...selection, transactionId };
  await act(async () => { await h.result.current.checkStatus(); });
  expect(h.result.current.status).toBe('frameLoading'); expect(m.prepare).toHaveBeenCalledOnce(); expect(m.open).toHaveBeenCalledOnce();
});
it('resumes the server selection ahead of a different URL selection with zero prepare calls', async () => {
  facts.onboardingStep = 'PAYMENT'; facts.checkoutResume = { plan: 'STARTER', interval: 'year', transactionId };
  const h = mount(); await flush(); expect(h.result.current.prepared).toEqual(facts.checkoutResume);
  expect(m.prepare).not.toHaveBeenCalled(); expect(m.open).toHaveBeenCalledOnce();
});
it('changePlan uses one replacement POST, tears down the old frame, and ignores its late events', async () => {
  const h = await ready(); const oldListener = [...m.listeners][0];
  m.prepare.mockResolvedValueOnce({ transactionId: replacementId, replaced: true, reused: false });
  await act(async () => { await h.result.current.changePlan({ plan: 'STARTER', interval: 'year' }); });
  expect(m.prepare).toHaveBeenLastCalledWith('STARTER', 'year', expect.any(AbortSignal));
  expect(m.prepare).toHaveBeenCalledTimes(2); expect(m.close).toHaveBeenCalledOnce(); expect(m.open).toHaveBeenCalledTimes(2);
  expect(h.result.current.prepared).toEqual({ plan: 'STARTER', interval: 'year', transactionId: replacementId });
  await act(async () => { oldListener({ type: 'completed', transactionId }); });
  await emit({ type: 'completed', transactionId }); expect(h.result.current.status).toBe('frameLoading');
  await emit({ type: 'loaded', transactionId: replacementId }); expect(h.result.current.status).toBe('ready');
});
it('unknown replacement never reopens the old frame or sends another POST', async () => {
  const h = await ready(); m.prepare.mockRejectedValueOnce(new BillingRequestError('offline', true));
  await act(async () => { await h.result.current.changePlan({ plan: 'ADVANCED', interval: 'year' }); });
  expect(h.result.current.status).toBe('unresolved');
  await act(async () => { await h.result.current.tryAgain(); await h.result.current.changePlan(selection); });
  expect(m.prepare).toHaveBeenCalledTimes(2); expect(m.open).toHaveBeenCalledOnce();
});
it.each(['sdk', 'prepare', 'read'] as const)('owner change discards late %s results and old events', async (stage) => {
  const pending = deferred<never>();
  if (stage === 'sdk') m.sdk.mockReturnValueOnce(pending.promise);
  if (stage === 'prepare') m.prepare.mockReturnValueOnce(pending.promise);
  if (stage === 'read') m.read.mockReturnValueOnce(pending.promise);
  const h = mount(); await flush();
  m.user = { id: 8, companyId: 55, role: 'ADMIN' };
  facts = { ...facts, company: { ...facts.company, id: 55 }, onboardingStep: 'RESTRICTED' };
  h.rerender({ chosen: selection }); await flush();
  pending.resolve((stage === 'sdk' ? { Checkout: { close: m.close } } : stage === 'read' ? { ...facts, company: { ...facts.company, id: 42 } } : { transactionId }) as never);
  await flush(); expect(m.open).not.toHaveBeenCalled(); expect(h.result.current.prepared).toBeNull(); expect(h.result.current.status).toBe('restricted');
  expect(h.client.getQueryData(billingLifecycleKey(42, 7))).toBeUndefined();
});
it('unmount aborts prepare, unsubscribes, closes its frame, and ignores retained callbacks', async () => {
  const h = await ready(); const listener = [...m.listeners][0]; h.unmount();
  expect(m.listeners.size).toBe(0); expect(m.close).toHaveBeenCalledOnce();
  await act(async () => { listener({ type: 'completed', transactionId }); }); expect(m.open).toHaveBeenCalledOnce();
});
it.each([null, { id: 7, companyId: 42, role: 'MANAGER' }])('rejects non-owner identity %j before any API/SDK call', async user => {
  m.user = user; const h = mount(); await flush(); expect(h.result.current.status).toBe('restricted');
  expect(m.actor).not.toHaveBeenCalled(); expect(m.prepare).not.toHaveBeenCalled(); expect(m.sdk).not.toHaveBeenCalled();
});
it('rejects a remote identity change and a restriction arising during SDK loading', async () => {
  m.sdk.mockImplementationOnce(async () => { facts.company.operationalStatus = 'SUSPENDED'; return { Checkout: { close: m.close } }; });
  const h = mount(); await flush(); expect(h.result.current.status).toBe('restricted'); expect(m.prepare).not.toHaveBeenCalled();
});
it('rechecks the actor after SDK loading before preparing', async () => {
  m.actor.mockResolvedValueOnce(m.user).mockResolvedValueOnce({ id: 9, companyId: 42, role: 'ADMIN' });
  const h = mount(); await flush(); expect(h.result.current.status).toBe('restricted'); expect(m.prepare).not.toHaveBeenCalled();
});
it('completion only moves to confirming, never grants cached workspace access or permits replacement', async () => {
  const h = await ready(); await emit({ type: 'completed', transactionId }); expect(h.result.current.status).toBe('confirming');
  expect(h.client.getQueryData<ValidatedBillingLifecycle>(billingLifecycleKey(42, 7))?.workspaceAccessAllowed).toBe(false);
  await act(async () => { await h.result.current.changePlan(selection); }); expect(m.prepare).toHaveBeenCalledOnce();
});
it('background refetch, repeat registration and selection/language rerenders keep the same frame', async () => {
  const h = await ready(); const callback = h.result.current.registerFrameTarget;
  act(() => h.client.setQueryData(billingLifecycleKey(42, 7), structuredClone(facts)));
  h.rerender({ chosen: { plan: 'ADVANCED', interval: 'year' } });
  act(() => h.result.current.registerFrameTarget('checkout-fixture')); await flush();
  expect(h.result.current.registerFrameTarget).toBe(callback); expect(h.result.current.status).toBe('ready');
  expect(m.open).toHaveBeenCalledOnce(); expect(m.close).not.toHaveBeenCalled(); expect(m.prepare).toHaveBeenCalledOnce();
});
it('background restriction tears down a ready form', async () => {
  const h = await ready(); act(() => h.client.setQueryData(billingLifecycleKey(42, 7), { ...facts, onboardingStep: 'RESTRICTED' }));
  expect(h.result.current.status).toBe('restricted'); expect(m.close).toHaveBeenCalledOnce();
});
it('background draft change tears down the former draft and opens only the new server draft', async () => {
  const h = await ready(); act(() => h.client.setQueryData(billingLifecycleKey(42, 7), { ...facts, checkoutResume: { ...selection, transactionId: replacementId } }));
  expect(h.result.current.prepared?.transactionId).toBe(replacementId); expect(m.close).toHaveBeenCalledOnce(); expect(m.open).toHaveBeenCalledTimes(2);
});
it('online/offline preserves a ready form and offline arrival cannot prepare until online', async () => {
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
  const h = mount(); await flush(); expect(h.result.current.status).toBe('offline'); expect(m.prepare).not.toHaveBeenCalled();
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
  act(() => window.dispatchEvent(new Event('online'))); await flush(); await emit({ type: 'loaded', transactionId });
  act(() => window.dispatchEvent(new Event('offline'))); expect(h.result.current.status).toBe('offline');
  act(() => window.dispatchEvent(new Event('online'))); expect(h.result.current.status).toBe('ready'); expect(m.open).toHaveBeenCalledOnce();
});
it.each(['paymentError', 'openError'] as const)('handles %s without automatic prepare or reopen', async type => {
  const h = await ready(); await emit({ type, transactionId }); expect(h.result.current.status).toBe('frameFailed');
  expect(m.prepare).toHaveBeenCalledOnce(); expect(m.open).toHaveBeenCalledOnce();
});
it('ignores foreign and transactionless completion/amounts, but accepts a flat loading error', async () => {
  const h = mount(); await flush();
  await emit({ type: 'completed', transactionId: replacementId }); await emit({ type: 'loaded' }); await emit({ type: 'completed' });
  expect(h.result.current.status).toBe('frameLoading'); expect(h.result.current.totals).toBeNull();
  await emit({ type: 'openError' }); expect(h.result.current.status).toBe('frameFailed');
});
it('known not-sent failure allows explicit retry after a fresh read', async () => {
  m.prepare.mockRejectedValueOnce(new BillingRequestError('not_sent', false));
  const h = mount(); await flush(); expect(h.result.current.status).toBe('frameFailed');
  await act(async () => { await h.result.current.tryAgain(); }); expect(m.prepare).toHaveBeenCalledTimes(2);
});
it('failed lifecycle read is bounded and gives check status without creating a draft', async () => {
  m.read.mockRejectedValueOnce(new BillingRequestError('offline', true)); const h = mount(); await flush();
  expect(h.result.current.status).toBe('unresolved'); expect(h.result.current.actionBusy).toBe(false); expect(m.prepare).not.toHaveBeenCalled();
});

it('payment initiation locks plan changes, decline unlocks the same draft, and a lost payment result ends in status recovery', async () => {
  const h = await ready();
  const attempt = async (id = transactionId) => {
    await act(async () => { for (const listener of m.rawListeners) listener({ name: 'checkout.payment.initiated', data: { transaction_id: id } } as Parameters<PaddleEventListener>[0]); });
  };
  await attempt(replacementId); expect(h.result.current.status).toBe('ready');
  await attempt(); expect(h.result.current.status).toBe('paying');
  await act(async () => { await h.result.current.changePlan(selection); }); expect(m.prepare).toHaveBeenCalledOnce();
  await emit({ type: 'paymentFailed', transactionId }); expect(h.result.current.status).toBe('declined');
  await act(async () => { vi.advanceTimersByTime(20_000); }); expect(h.result.current.status).toBe('declined');
  await attempt(); await act(async () => { vi.advanceTimersByTime(20_000); });
  expect(h.result.current.status).toBe('unresolved'); expect(m.prepare).toHaveBeenCalledOnce();
  await act(async () => { await h.result.current.checkStatus(); }); expect(h.result.current.status).toBe('frameLoading');
  expect(m.prepare).toHaveBeenCalledOnce();
});
it('status recovery loads the SDK if the initial read failed before SDK setup', async () => {
  m.read.mockRejectedValueOnce(new BillingRequestError('offline', true)); const h = mount(); await flush();
  facts.onboardingStep = 'PAYMENT'; facts.checkoutResume = { ...selection, transactionId };
  await act(async () => { await h.result.current.checkStatus(); }); expect(m.sdk).toHaveBeenCalledOnce();
  expect(m.open).toHaveBeenCalledOnce(); expect(m.prepare).not.toHaveBeenCalled();
});
it('status recovery can prepare only after fresh facts prove the prior reservation cleared', async () => {
  m.prepare.mockRejectedValueOnce(new BillingRequestError('timed_out_after_send', true));
  const h = mount(); await flush(); expect(h.result.current.status).toBe('unresolved');
  facts.onboardingStep = 'RECONCILE'; await act(async () => { await h.result.current.checkStatus(); });
  expect(m.prepare).toHaveBeenCalledOnce(); expect(h.result.current.status).toBe('unresolved');
  facts.onboardingStep = 'CHOOSE_PLAN'; await act(async () => { await h.result.current.checkStatus(); });
  expect(m.prepare).toHaveBeenCalledTimes(2); expect(h.result.current.status).toBe('frameLoading');
});
it.each(['CONFIRMING', 'WORKSPACE', 'RECONCILE', 'ACCOUNT', 'UNAVAILABLE', 'VERIFY_EMAIL', null] as const)('does not prepare for server step %s', async step => {
  facts.onboardingStep = step; const h = mount(); await flush();
  expect(m.prepare).not.toHaveBeenCalled(); expect(m.open).not.toHaveBeenCalled();
  expect(h.result.current.status).not.toBe('checking');
});
it('a paid server background read moves a ready form to confirmation without another purchase', async () => {
  const h = await ready(); act(() => h.client.setQueryData(billingLifecycleKey(42, 7), { ...facts, onboardingStep: 'CONFIRMING' }));
  expect(h.result.current.status).toBe('confirming'); expect(m.close).toHaveBeenCalledOnce(); expect(m.prepare).toHaveBeenCalledOnce();
});
it('cleans up pending mutation signal and watchdog on unmount', async () => {
  const pending = deferred<{ transactionId: string }>(); let signal: AbortSignal | undefined;
  m.prepare.mockImplementation((_plan, _interval, value) => { signal = value; return pending.promise; });
  const h = mount(); await flush(); h.unmount(); expect(signal?.aborted).toBe(true);
  pending.resolve({ transactionId }); await flush(); expect(m.open).not.toHaveBeenCalled();
  expect(m.listeners.size).toBe(0); expect(m.rawListeners.size).toBe(0);
});
