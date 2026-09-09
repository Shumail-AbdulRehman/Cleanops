import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { billingRequest, BILLING_REQUEST_LIMITS, BillingRequestError } from './billingRequest';

beforeEach(() => vi.useFakeTimers());
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

it('centralizes the architecture deadlines', () => {
  expect(BILLING_REQUEST_LIMITS).toEqual({ read: 15000, confirm: 20000, reconcile: 30000, prepare: 45000 });
});
it('never invokes the operation when already cancelled', async () => {
  const caller = new AbortController(); caller.abort();
  const request = vi.fn();
  await expect(billingRequest(request, 15000, caller.signal)).rejects.toMatchObject({ kind: 'not_sent', sent: false });
  expect(request).not.toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
});
it('reports offline before dispatch without invoking the operation', async () => {
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
  const request = vi.fn();
  await expect(billingRequest(request, 15000)).rejects.toMatchObject({ kind: 'offline', sent: false });
  expect(request).not.toHaveBeenCalled();
});
it('ends an adapter that never settles and aborts its composed signal', async () => {
  const request = vi.fn(() => new Promise<never>(() => {}));
  const promise = billingRequest(request, 15000);
  const assertion = expect(promise).rejects.toMatchObject({ kind: 'timed_out_after_send', sent: true });
  await vi.advanceTimersByTimeAsync(14999);
  expect(request.mock.calls[0]).toBeDefined();
  await vi.advanceTimersByTimeAsync(1); await assertion;
  expect(request).toHaveBeenCalledOnce();
  expect(vi.getTimerCount()).toBe(0);
});
it('cancels promptly and removes the caller listener', async () => {
  const caller = new AbortController();
  const remove = vi.spyOn(caller.signal, 'removeEventListener');
  let composed: AbortSignal | undefined;
  const promise = billingRequest(signal => { composed = signal; return new Promise(() => {}); }, 45000, caller.signal);
  const assertion = expect(promise).rejects.toMatchObject({ kind: 'timed_out_after_send', sent: true });
  caller.abort(); await assertion;
  expect(composed?.aborted).toBe(true);
  expect(remove).toHaveBeenCalledWith('abort', expect.any(Function));
  expect(vi.getTimerCount()).toBe(0);
});
it('discards success returned synchronously after caller cancellation', async () => {
  const caller = new AbortController();
  await expect(billingRequest(async () => { caller.abort(); return 'late'; }, 15000, caller.signal))
    .rejects.toMatchObject({ kind: 'timed_out_after_send' });
});
it('consumes a late rejection after timeout', async () => {
  let rejectLate!: (error: Error) => void;
  const promise = billingRequest(() => new Promise((_, reject) => { rejectLate = reject; }), 20);
  const assertion = expect(promise).rejects.toBeInstanceOf(BillingRequestError);
  await vi.advanceTimersByTimeAsync(20); await assertion;
  rejectLate(new Error('late adapter failure'));
  await Promise.resolve();
});
it('cleans up on success without aborting a completed operation', async () => {
  const caller = new AbortController();
  const remove = vi.spyOn(caller.signal, 'removeEventListener');
  let composed: AbortSignal | undefined;
  await expect(billingRequest(async signal => { composed = signal; return 42; }, 100, caller.signal)).resolves.toBe(42);
  expect(vi.getTimerCount()).toBe(0);
  expect(remove).toHaveBeenCalledWith('abort', expect.any(Function));
  caller.abort(); expect(composed?.aborted).toBe(false);
});
it.each([401, 403, 409, 503])('classifies server status %s and retains only status and code', async status => {
  const error = await billingRequest(() => Promise.reject({ response: { status, data: { code: 'BILLING_BUSY', secret: 'synthetic' } } }), 100).catch(error => error);
  expect(error).toMatchObject({ kind: 'server', sent: true, status, code: 'BILLING_BUSY' });
  expect(error.response).toEqual({ status, data: { code: 'BILLING_BUSY' } });
  expect(JSON.stringify(error)).not.toContain('synthetic');
  expect(vi.getTimerCount()).toBe(0);
});
it('does not coerce an invalid server code', async () => {
  await expect(billingRequest(() => Promise.reject({ response: { status: 500, data: { code: {} } } }), 100))
    .rejects.toMatchObject({ kind: 'server', status: 500, code: null });
});
it.each(['ECONNABORTED', 'ETIMEDOUT'])('classifies adapter timeout %s conservatively', async code => {
  await expect(billingRequest(() => Promise.reject({ code }), 100))
    .rejects.toMatchObject({ kind: 'timed_out_after_send', sent: true });
});
it('reports a lost connection after dispatch without claiming it is safe to repeat', async () => {
  await expect(billingRequest(() => Promise.reject(new Error('network lost')), 100))
    .rejects.toMatchObject({ kind: 'offline', sent: true });
});

it('cleans up a synchronous dispatch error', async () => {
  await expect(billingRequest(() => { throw new Error('dispatch failed'); }, 100))
    .rejects.toMatchObject({ kind: 'offline', sent: true });
  expect(vi.getTimerCount()).toBe(0);
});
it('consumes both failures if a synchronous adapter cancels then throws', async () => {
  const caller = new AbortController();
  await expect(billingRequest(() => { caller.abort(); throw new Error('adapter canceled'); }, 100, caller.signal))
    .rejects.toMatchObject({ kind: 'timed_out_after_send', sent: true });
  expect(vi.getTimerCount()).toBe(0);
});
