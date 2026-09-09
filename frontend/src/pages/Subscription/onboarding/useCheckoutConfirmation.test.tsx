import { StrictMode, type ReactNode } from 'react';
import { act, cleanup, renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { BillingConfirmResult, ValidatedBillingLifecycle } from '../types';
import { billingLifecycleKey } from '../queries';
import { billingRequest, BillingRequestError, BILLING_REQUEST_LIMITS } from './billingRequest';
import { useCheckoutConfirmation } from './useCheckoutConfirmation';

const m = vi.hoisted(() => ({
  user: { id: 7, companyId: 42, role: 'ADMIN' } as { id: number; companyId: number; role: string } | null,
  confirm: vi.fn(),
}));
vi.mock('@/hooks/useAuth', () => ({ default: () => ({ user: m.user }) }));
vi.mock('../api', () => ({ confirmBillingCheckout: m.confirm }));

type Result = BillingConfirmResult & { lifecycle: ValidatedBillingLifecycle };
const clients: QueryClient[] = [];
let facts: ValidatedBillingLifecycle;
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const processing = (): Result => ({ outcome: 'PROCESSING', lifecycle: structuredClone(facts) });
const active = (): Result => ({ outcome: 'ACTIVE', lifecycle: { ...structuredClone(facts), workspaceAccessAllowed: true, onboardingStep: 'WORKSPACE' } });
async function flush() { await act(async () => { await Promise.resolve(); }); }
async function advance(ms: number) { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); }
function mount(strict = false) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  clients.push(client);
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>
    {strict ? <StrictMode>{children}</StrictMode> : children}
  </QueryClientProvider>;
  return { ...renderHook(() => useCheckoutConfirmation(), { wrapper }), client };
}
beforeEach(() => {
  vi.useFakeTimers(); vi.resetAllMocks(); vi.setSystemTime(new Date('2026-11-10T00:00:00Z'));
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
  m.user = { id: 7, companyId: 42, role: 'ADMIN' };
  facts = {
    company: { id: 42, name: 'Fixture', plan: 'PRO', isActive: true, operationalStatus: 'ACTIVE' },
    usage: { locations: 0, staff: 0, managers: 1 }, limits: { locations: 5, staff: 25, managers: 3 }, subscription: null,
    reconciliationRequired: false, billingConfigured: true, ownerVerified: false, billingEnvironment: 'sandbox',
    providerState: 'AWAITING_PROVIDER', portalAvailable: false, checkoutAvailable: false, checkoutReadiness: 'UNKNOWN',
    workspaceAccessAllowed: false, checkoutResume: null, onboardingStep: 'CONFIRMING', recoveryReason: null,
  };
  m.confirm.mockImplementation(async () => processing());
});
afterEach(() => { cleanup(); clients.splice(0).forEach(client => client.clear()); vi.useRealTimers(); });

it('uses 2, 3, 5, 8 then repeated 13-second gaps and stops at the fixed 120-second deadline', async () => {
  const start = Date.now(); const calls: number[] = [];
  m.confirm.mockImplementation(async () => { calls.push(Date.now() - start); return processing(); });
  const h = mount(); await flush();
  expect(h.result.current.status).toBe('waiting');
  expect(h.result.current.outcome).toBeNull(); expect(h.result.current.consecutiveNotPaid).toBe(0);
  await advance(1_999); expect(m.confirm).not.toHaveBeenCalled();
  await advance(1); expect(calls).toEqual([2_000]);
  await advance(117_999);
  expect(calls).toEqual([2_000, 5_000, 10_000, 18_000, 31_000, 44_000, 57_000, 70_000, 83_000, 96_000, 109_000]);
  expect(h.result.current.status).toBe('slow');
  await advance(1); expect(h.result.current.status).toBe('timedOut');
  await advance(240_000); expect(m.confirm).toHaveBeenCalledTimes(11);
});

it('reports slow at exactly 20 seconds while a call is hung, then times out at exactly 120 seconds', async () => {
  const pending = deferred<Result>(); m.confirm.mockReturnValue(pending.promise);
  const h = mount(); await flush(); await advance(19_999);
  expect(h.result.current.status).toBe('waiting'); expect(m.confirm).toHaveBeenCalledOnce();
  await advance(1); expect(h.result.current.status).toBe('slow');
  await advance(99_999); expect(h.result.current.status).toBe('slow');
  const signal = m.confirm.mock.calls[0][0] as AbortSignal;
  expect(signal.aborted).toBe(false);
  await advance(1); expect(h.result.current.status).toBe('timedOut'); expect(signal.aborted).toBe(true);
  pending.resolve(active()); await flush();
  expect(h.result.current.status).toBe('timedOut');
  expect(h.client.getQueryData(billingLifecycleKey(42, 7))).toBeUndefined();
  await advance(120_000); expect(m.confirm).toHaveBeenCalledOnce();
});

it('waits for settlement before the next gap and never overlaps requests', async () => {
  const pending = deferred<Result>(); m.confirm.mockReturnValueOnce(pending.promise);
  const h = mount(); await flush(); await advance(12_000);
  expect(m.confirm).toHaveBeenCalledOnce();
  pending.resolve(processing()); await flush();
  await advance(2_999); expect(m.confirm).toHaveBeenCalledOnce();
  await advance(1); expect(m.confirm).toHaveBeenCalledTimes(2);
  expect(h.result.current.status).toBe('waiting');
});

it('a real transport timeout can retry reads but cannot extend the overall window', async () => {
  let inFlight = 0, maximum = 0;
  m.confirm.mockImplementation((signal: AbortSignal) => billingRequest(inner => {
    inFlight++; maximum = Math.max(maximum, inFlight);
    inner.addEventListener('abort', () => { inFlight--; }, { once: true });
    return new Promise<Result>(() => {});
  }, BILLING_REQUEST_LIMITS.confirm, signal));
  const h = mount(); await flush(); await advance(119_999);
  expect(h.result.current.status).toBe('slow'); expect(inFlight).toBe(1);
  await advance(1); expect(h.result.current.status).toBe('timedOut');
  expect(maximum).toBe(1); expect(inFlight).toBe(0);
  await advance(120_000); expect(m.confirm).toHaveBeenCalledTimes(5);
});

it('caches every successful result under the exact company/owner key and stops on server-confirmed access', async () => {
  const first = processing(), last = active();
  m.confirm.mockResolvedValueOnce(first).mockResolvedValueOnce(last);
  const h = mount(); await flush();
  h.client.setQueryData(billingLifecycleKey(42, 99), { sentinel: true });
  await advance(2_000);
  expect(m.confirm).toHaveBeenLastCalledWith(expect.any(AbortSignal), 42);
  expect(h.client.getQueryData(billingLifecycleKey(42, 7))).toEqual(first.lifecycle);
  expect(h.result.current.lifecycle).toEqual(first.lifecycle);
  expect(h.result.current.outcome).toBe('PROCESSING'); expect(h.result.current.consecutiveNotPaid).toBe(0);
  await advance(3_000); expect(h.result.current.status).toBe('active');
  expect(h.result.current.lifecycle).toEqual(last.lifecycle);
  expect(h.result.current.outcome).toBe('ACTIVE'); expect(h.result.current.consecutiveNotPaid).toBe(0);
  expect(h.client.getQueryData(billingLifecycleKey(42, 7))).toEqual(last.lifecycle);
  expect(h.client.getQueryData(billingLifecycleKey(42, 99))).toEqual({ sentinel: true });
  expect(h.client.getQueryData(['billing-lifecycle'])).toBeUndefined();
  expect((m.confirm.mock.calls[1][0] as AbortSignal).aborted).toBe(true);
  await advance(240_000); expect(h.result.current.status).toBe('active'); expect(m.confirm).toHaveBeenCalledTimes(2);
});

it.each([401, 403])('stops immediately on HTTP %s without later slow/timeout updates', async status => {
  m.confirm.mockRejectedValueOnce(new BillingRequestError('server', true, status));
  const h = mount(); await flush(); await advance(2_000);
  expect(h.result.current.status).toBe('denied');
  expect((m.confirm.mock.calls[0][0] as AbortSignal).aborted).toBe(true);
  await advance(240_000); expect(h.result.current.status).toBe('denied'); expect(m.confirm).toHaveBeenCalledOnce();
  expect(h.client.getQueryData(billingLifecycleKey(42, 7))).toBeUndefined();
});

it.each([
  new BillingRequestError('server', true, 503),
  new BillingRequestError('offline', false),
  new BillingRequestError('timed_out_after_send', true),
  null,
])('continues after transient failure %j without parallel calls', async error => {
  m.confirm.mockRejectedValueOnce(error).mockResolvedValueOnce(active());
  const h = mount(); await flush(); await advance(2_000);
  expect(h.result.current.status).toBe('waiting');
  await advance(2_999); expect(m.confirm).toHaveBeenCalledOnce();
  await advance(1); expect(m.confirm).toHaveBeenCalledTimes(2); expect(h.result.current.status).toBe('active');
});

it.each(['NOT_PAID', 'NO_CHECKOUT'] as const)('keeps waiting and caches a %s response', async outcome => {
  const result = { outcome, lifecycle: facts }; m.confirm.mockResolvedValue(result);
  const h = mount(); await flush(); await advance(2_000);
  expect(h.result.current.status).toBe('waiting'); expect(h.result.current.lifecycle).toEqual(facts);
  expect(h.result.current.outcome).toBe(outcome);
  expect(h.result.current.consecutiveNotPaid).toBe(outcome === 'NOT_PAID' ? 1 : 0);
  expect(h.client.getQueryData(billingLifecycleKey(42, 7))).toEqual(facts);
  await advance(3_000); expect(m.confirm).toHaveBeenCalledTimes(2);
  expect(h.result.current.consecutiveNotPaid).toBe(outcome === 'NOT_PAID' ? 2 : 0);
});

it.each(['PROCESSING', 'NO_CHECKOUT', 'ACTIVE'] as const)('%s resets the consecutive NOT_PAID count', async outcome => {
  m.confirm.mockResolvedValueOnce({ outcome: 'NOT_PAID', lifecycle: facts })
    .mockResolvedValueOnce({ outcome: 'NOT_PAID', lifecycle: facts })
    .mockResolvedValueOnce({ outcome, lifecycle: facts })
    .mockResolvedValueOnce({ outcome: 'NOT_PAID', lifecycle: facts });
  const h = mount(); await flush(); await advance(5_000);
  expect(h.result.current.outcome).toBe('NOT_PAID'); expect(h.result.current.consecutiveNotPaid).toBe(2);
  await advance(5_000);
  expect(h.result.current.outcome).toBe(outcome); expect(h.result.current.consecutiveNotPaid).toBe(0);
  await advance(8_000);
  expect(h.result.current.outcome).toBe('NOT_PAID'); expect(h.result.current.consecutiveNotPaid).toBe(1);
});

it('a failed read preserves the latest accepted outcome but breaks the unpaid streak', async () => {
  m.confirm.mockResolvedValueOnce({ outcome: 'NOT_PAID', lifecycle: facts })
    .mockRejectedValueOnce(new BillingRequestError('server', true, 503))
    .mockResolvedValue({ outcome: 'NOT_PAID', lifecycle: facts });
  const h = mount(); await flush(); await advance(2_000);
  expect(h.result.current.consecutiveNotPaid).toBe(1);
  await advance(3_000);
  expect(h.result.current.status).toBe('waiting');
  expect(h.result.current.outcome).toBe('NOT_PAID'); expect(h.result.current.consecutiveNotPaid).toBe(0);
  await advance(5_000); expect(h.result.current.consecutiveNotPaid).toBe(1);
});

it('retry clears the outcome and unpaid streak and ignores the previous run response', async () => {
  const pending = deferred<Result>();
  m.confirm.mockResolvedValueOnce({ outcome: 'NOT_PAID', lifecycle: facts }).mockReturnValueOnce(pending.promise)
    .mockResolvedValue({ outcome: 'NOT_PAID', lifecycle: facts });
  const h = mount(); await flush(); await advance(5_000);
  expect(h.result.current.outcome).toBe('NOT_PAID'); expect(h.result.current.consecutiveNotPaid).toBe(1);
  act(() => h.result.current.retry());
  expect(h.result.current.outcome).toBeNull(); expect(h.result.current.consecutiveNotPaid).toBe(0);
  pending.resolve({ outcome: 'NO_CHECKOUT', lifecycle: facts }); await flush();
  expect(h.result.current.outcome).toBeNull(); expect(h.result.current.consecutiveNotPaid).toBe(0);
  await advance(2_000);
  expect(h.result.current.outcome).toBe('NOT_PAID'); expect(h.result.current.consecutiveNotPaid).toBe(1);
});

it.each(['owner', 'company', 'role'] as const)('%s changes synchronously clear the outcome and unpaid streak', async changed => {
  m.confirm.mockResolvedValue({ outcome: 'NOT_PAID', lifecycle: facts });
  const h = mount(); await flush(); await advance(5_000);
  expect(h.result.current.consecutiveNotPaid).toBe(2);
  m.user = changed === 'owner' ? { id: 8, companyId: 42, role: 'ADMIN' }
    : changed === 'company' ? { id: 7, companyId: 55, role: 'ADMIN' }
      : { id: 7, companyId: 42, role: 'MANAGER' };
  h.rerender();
  expect(h.result.current.outcome).toBeNull(); expect(h.result.current.consecutiveNotPaid).toBe(0);
  await flush();
  facts.company.id = m.user.companyId;
  await advance(2_000);
  expect(h.result.current.consecutiveNotPaid).toBe(changed === 'role' ? 0 : 1);
});

it('foreign-company responses cannot publish an outcome or continue an unpaid streak', async () => {
  const foreign = structuredClone(facts); foreign.company.id = 55;
  m.confirm.mockResolvedValueOnce({ outcome: 'NOT_PAID', lifecycle: facts })
    .mockResolvedValueOnce({ outcome: 'NO_CHECKOUT', lifecycle: foreign })
    .mockResolvedValue({ outcome: 'NOT_PAID', lifecycle: facts });
  const h = mount(); await flush(); await advance(5_000);
  expect(h.result.current.outcome).toBe('NOT_PAID'); expect(h.result.current.consecutiveNotPaid).toBe(0);
  await advance(5_000); expect(h.result.current.consecutiveNotPaid).toBe(1);
});

it.each(['missing-access', 'suspended', 'inactive'] as const)('does not report active for %s server facts', async condition => {
  const result = active();
  if (condition === 'missing-access') result.lifecycle.workspaceAccessAllowed = false;
  if (condition === 'suspended') result.lifecycle.company.operationalStatus = 'SUSPENDED';
  if (condition === 'inactive') result.lifecycle.company.isActive = false;
  m.confirm.mockResolvedValue(result);
  const h = mount(); await flush(); await advance(2_000);
  expect(h.result.current.status).toBe('waiting');
  expect(h.client.getQueryData(billingLifecycleKey(42, 7))).toEqual(result.lifecycle);
});

it('never treats previously cached access as a new confirmation', async () => {
  const h = mount(); h.client.setQueryData(billingLifecycleKey(42, 7), active().lifecycle);
  await flush(); expect(h.result.current.status).toBe('waiting'); expect(h.result.current.lifecycle).toBeNull();
  await advance(2_000); expect(h.result.current.status).toBe('waiting');
  expect(h.client.getQueryData<ValidatedBillingLifecycle>(billingLifecycleKey(42, 7))?.workspaceAccessAllowed).toBe(false);
});

it('manual retry resets both clocks and starts the gap sequence again', async () => {
  const h = mount(); await flush(); await advance(120_000);
  expect(h.result.current.status).toBe('timedOut'); const calls = m.confirm.mock.calls.length;
  const retry = h.result.current.retry;
  act(() => retry()); expect(h.result.current.status).toBe('waiting'); expect(h.result.current.lifecycle).toBeNull();
  await advance(1_999); expect(m.confirm).toHaveBeenCalledTimes(calls);
  await advance(1); expect(m.confirm).toHaveBeenCalledTimes(calls + 1);
  await advance(3_000); expect(m.confirm).toHaveBeenCalledTimes(calls + 2);
  await advance(14_999); expect(h.result.current.status).toBe('waiting');
  await advance(1); expect(h.result.current.status).toBe('slow');
  await advance(99_999); expect(h.result.current.status).toBe('slow');
  await advance(1); expect(h.result.current.status).toBe('timedOut'); expect(h.result.current.retry).toBe(retry);
});

it('retry cancels a pending call, ignores its late result, and repeated clicks leave one polling loop', async () => {
  const pending = deferred<Result>(); m.confirm.mockReturnValueOnce(pending.promise);
  const h = mount(); await flush(); await advance(2_000);
  const oldSignal = m.confirm.mock.calls[0][0] as AbortSignal;
  act(() => { h.result.current.retry(); h.result.current.retry(); h.result.current.retry(); });
  expect(oldSignal.aborted).toBe(true);
  pending.resolve(active()); await flush(); expect(h.result.current.status).toBe('waiting');
  expect(h.client.getQueryData(billingLifecycleKey(42, 7))).toBeUndefined();
  await advance(2_000); expect(m.confirm).toHaveBeenCalledTimes(2);
  await advance(3_000); expect(m.confirm).toHaveBeenCalledTimes(3);
});

it.each(['owner', 'company'] as const)('cancels the old %s scope and discards its late result', async changed => {
  const pending = deferred<Result>(); m.confirm.mockReturnValueOnce(pending.promise);
  const h = mount(); await flush(); await advance(2_000);
  const oldSignal = m.confirm.mock.calls[0][0] as AbortSignal;
  m.user = changed === 'owner' ? { id: 8, companyId: 42, role: 'ADMIN' } : { id: 7, companyId: 55, role: 'ADMIN' };
  h.rerender(); expect(h.result.current.status).toBe('waiting'); expect(h.result.current.lifecycle).toBeNull();
  expect(oldSignal.aborted).toBe(true);
  pending.resolve(active()); await flush();
  expect(h.client.getQueryData(billingLifecycleKey(42, 7))).toBeUndefined();
  facts.company.id = m.user.companyId;
  await advance(2_000); expect(m.confirm).toHaveBeenCalledTimes(2);
  expect(m.confirm).toHaveBeenLastCalledWith(expect.any(AbortSignal), m.user.companyId);
  expect(h.client.getQueryData(billingLifecycleKey(m.user.companyId, m.user.id))).toEqual(facts);
});

it('same-owner identity/language rerenders preserve the polling window', async () => {
  const h = mount(); await flush(); await advance(1_000);
  m.user = { ...m.user! }; h.rerender(); await flush();
  await advance(1_000); expect(m.confirm).toHaveBeenCalledOnce();
  await advance(118_000); expect(h.result.current.status).toBe('timedOut');
});

it.each([null, { id: 7, companyId: 42, role: 'MANAGER' }, { id: 7, companyId: 42, role: 'STAFF' }])('never sends a request for non-owner %j', async user => {
  m.user = user; const h = mount(); await flush();
  act(() => h.result.current.retry()); await advance(240_000);
  expect(h.result.current.status).toBe('denied'); expect(m.confirm).not.toHaveBeenCalled();
});

it('loss of owner role aborts pending work and a late denial cannot affect a new owner', async () => {
  const pending = deferred<Result>(); m.confirm.mockReturnValueOnce(pending.promise);
  const h = mount(); await flush(); await advance(2_000);
  const signal = m.confirm.mock.calls[0][0] as AbortSignal;
  m.user = { id: 7, companyId: 42, role: 'MANAGER' }; h.rerender();
  expect(signal.aborted).toBe(true); expect(h.result.current.status).toBe('denied');
  m.user = { id: 8, companyId: 42, role: 'ADMIN' }; h.rerender(); await flush();
  pending.reject(new BillingRequestError('server', true, 403)); await flush();
  expect(h.result.current.status).toBe('waiting');
  await advance(2_000); expect(m.confirm).toHaveBeenCalledTimes(2);
});

it('ignores foreign-company results without poisoning either cache', async () => {
  const result = active(); result.lifecycle.company.id = 55; m.confirm.mockResolvedValue(result);
  const h = mount(); await flush(); await advance(2_000);
  expect(h.result.current.status).toBe('waiting'); expect(h.result.current.lifecycle).toBeNull();
  expect(h.client.getQueryData(billingLifecycleKey(42, 7))).toBeUndefined();
  expect(h.client.getQueryData(billingLifecycleKey(55, 7))).toBeUndefined();
  await advance(3_000); expect(m.confirm).toHaveBeenCalledTimes(2);
});

it('unmount clears timers before the first call and retained retry is inert', async () => {
  const h = mount(); await flush(); const retry = h.result.current.retry; h.unmount();
  retry(); await advance(240_000); expect(m.confirm).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0);
});

it.each(['resolve', 'reject'] as const)('unmount aborts an in-flight call and consumes a late %s', async settlement => {
  const pending = deferred<Result>(); m.confirm.mockReturnValueOnce(pending.promise);
  const h = mount(); await flush(); await advance(2_000);
  const signal = m.confirm.mock.calls[0][0] as AbortSignal; h.unmount(); expect(signal.aborted).toBe(true);
  if (settlement === 'resolve') pending.resolve(active()); else pending.reject(new Error('late failure'));
  await flush(); await advance(240_000);
  expect(m.confirm).toHaveBeenCalledOnce(); expect(vi.getTimerCount()).toBe(0);
  expect(h.client.getQueryData(billingLifecycleKey(42, 7))).toBeUndefined();
});

it('StrictMode replay leaves exactly one timer sequence and one request', async () => {
  m.confirm.mockResolvedValue(active()); const h = mount(true); await flush(); await advance(2_000);
  expect(m.confirm).toHaveBeenCalledOnce(); expect(h.result.current.status).toBe('active');
  await advance(240_000); expect(m.confirm).toHaveBeenCalledOnce(); expect(vi.getTimerCount()).toBe(0);
});
