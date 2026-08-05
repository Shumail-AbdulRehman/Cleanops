import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CheckoutEventNames, type CheckoutEventsData, type InitializePaddleOptions, type Paddle, type PaddleEventData,
} from '@paddle/paddle-js';

const sdk = vi.hoisted(() => ({ initialize: vi.fn() }));
vi.mock('@paddle/paddle-js', async (importOriginal) => ({
  ...await importOriginal<typeof import('@paddle/paddle-js')>(),
  initializePaddle: sdk.initialize,
}));

const scriptSelector = 'script[src="https://cdn.paddle.com/paddle/v2/paddle.js"]';
let paddle: Paddle;
const loadModule = () => import('./paddle');
const callback = () => (sdk.initialize.mock.calls.at(-1)![0] as InitializePaddleOptions).eventCallback!;

beforeEach(() => {
  vi.resetModules();
  vi.stubEnv('VITE_PADDLE_ENVIRONMENT', 'sandbox');
  vi.stubEnv('VITE_PADDLE_CLIENT_TOKEN', 'test_public_fixture');
  paddle = { Initialized: true } as Paddle;
  window.PaddleBillingV1 = paddle;
  sdk.initialize.mockReset().mockResolvedValue(paddle);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  delete window.PaddleBillingV1;
  document.querySelectorAll(scriptSelector).forEach((script) => script.remove());
});

it('times out a shared script attempt at 15 seconds and successfully retries', async () => {
  vi.useFakeTimers();
  delete window.PaddleBillingV1;
  const { getPaddle } = await loadModule();
  const first = getPaddle();
  const rejected = expect(first).rejects.toThrow('loading timed out');
  expect(getPaddle()).toBe(first);
  const expired = document.querySelector(scriptSelector)!;
  await vi.advanceTimersByTimeAsync(14_999);
  expect(expired.isConnected).toBe(true);
  expect(sdk.initialize).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);
  await rejected;
  expect(expired.isConnected).toBe(false);
  expect(vi.getTimerCount()).toBe(0);

  const retry = getPaddle();
  const script = document.querySelector(scriptSelector)!;
  expect(script).not.toBe(expired);
  expect(document.querySelectorAll(scriptSelector)).toHaveLength(1);
  // An expired tag's late events cannot reject or resolve the next attempt.
  expired.dispatchEvent(new Event('load'));
  expired.dispatchEvent(new Event('error'));
  window.PaddleBillingV1 = paddle;
  script.dispatchEvent(new Event('load'));
  expect(await retry).toBe(paddle);
  expect(vi.getTimerCount()).toBe(0);
  await vi.advanceTimersByTimeAsync(15_000);
  expect(script.isConnected).toBe(true);
  expect(getPaddle()).toBe(retry);
  expect(sdk.initialize).toHaveBeenCalledOnce();
});

it.each(['load', 'error', 'timeout'])('watches an existing script and cleans up after %s', async (outcome) => {
  vi.useFakeTimers();
  delete window.PaddleBillingV1;
  const script = document.createElement('script');
  script.src = 'https://cdn.paddle.com/paddle/v2/paddle.js';
  document.head.appendChild(script);
  const { getPaddle } = await loadModule();
  const pending = getPaddle();
  expect(document.querySelectorAll(scriptSelector)).toHaveLength(1);
  if (outcome === 'load') {
    window.PaddleBillingV1 = paddle;
    script.dispatchEvent(new Event('load'));
    expect(await pending).toBe(paddle);
    expect(script.isConnected).toBe(true);
  } else {
    const rejected = expect(pending).rejects.toThrow(outcome === 'timeout' ? 'timed out' : 'could not be loaded');
    if (outcome === 'timeout') await vi.advanceTimersByTimeAsync(15_000);
    else script.dispatchEvent(new Event('error'));
    await rejected;
    expect(script.isConnected).toBe(false);
    expect(sdk.initialize).not.toHaveBeenCalled();
  }
  expect(vi.getTimerCount()).toBe(0);
});

describe('configuration validation before SDK initialization', () => {
  it.each([
    ['', 'test_fixture', 'VITE_PADDLE_ENVIRONMENT is required'],
    ['  ', 'test_fixture', 'VITE_PADDLE_ENVIRONMENT is required'],
    [undefined, 'test_fixture', 'VITE_PADDLE_ENVIRONMENT is required'],
    ['Sandbox', 'test_fixture', 'must be either'],
    ['staging', 'test_fixture', 'must be either'],
    ['sandbox', '', 'VITE_PADDLE_CLIENT_TOKEN is required'],
    ['sandbox', undefined, 'VITE_PADDLE_CLIENT_TOKEN is required'],
    ['sandbox', 'live_fixture', 'beginning with test_'],
    ['sandbox', 'prefix_test_fixture', 'beginning with test_'],
    ['production', 'test_fixture', 'beginning with live_'],
    ['production', 'prefix_live_fixture', 'beginning with live_'],
  ])('rejects environment %s and token case %#', async (environment, token, message) => {
    vi.stubEnv('VITE_PADDLE_ENVIRONMENT', environment);
    vi.stubEnv('VITE_PADDLE_CLIENT_TOKEN', token);
    const { getPaddle } = await loadModule();
    await expect(getPaddle()).rejects.toThrow(message);
    expect(sdk.initialize).not.toHaveBeenCalled();
    expect(document.querySelector(scriptSelector)).toBeNull();
  });

  it.each(['sandbox', 'production'])('accepts and trims valid %s configuration', async (environment) => {
    const token = environment === 'sandbox' ? 'test_public_fixture' : 'live_public_fixture';
    vi.stubEnv('VITE_PADDLE_ENVIRONMENT', ` ${environment} `);
    vi.stubEnv('VITE_PADDLE_CLIENT_TOKEN', ` ${token} `);
    const { getPaddle } = await loadModule();
    expect(await getPaddle()).toBe(paddle);
    expect(sdk.initialize).toHaveBeenCalledWith({ environment, token, eventCallback: expect.any(Function) });
  });

  it('can recover from configuration failure on the next explicit call', async () => {
    vi.stubEnv('VITE_PADDLE_ENVIRONMENT', 'invalid');
    const { getPaddle } = await loadModule();
    await expect(getPaddle()).rejects.toThrow();
    vi.stubEnv('VITE_PADDLE_ENVIRONMENT', 'sandbox');
    expect(await getPaddle()).toBe(paddle);
  });
});

it('shares in-flight initialization and retains a successful singleton after cleanup', async () => {
  let resolve!: (value: Paddle) => void;
  sdk.initialize.mockReturnValue(new Promise<Paddle>((done) => { resolve = done; }));
  const { getPaddle, subscribePaddleEvents } = await loadModule();
  const unsubscribe = subscribePaddleEvents(vi.fn());
  const first = getPaddle();
  expect(getPaddle()).toBe(first);
  await Promise.resolve();
  expect(sdk.initialize).toHaveBeenCalledOnce();
  resolve(paddle);
  expect(await first).toBe(paddle);
  unsubscribe();
  vi.stubEnv('VITE_PADDLE_CLIENT_TOKEN', '');
  expect(getPaddle()).toBe(first);
  expect(await getPaddle()).toBe(paddle);
  expect(sdk.initialize).toHaveBeenCalledOnce();
});

it.each(['reject', 'undefined', 'uninitialized'])('retries %s initialization only on an explicit call', async (failure) => {
  if (failure === 'reject') sdk.initialize.mockRejectedValueOnce(new Error('network failure'));
  else sdk.initialize.mockResolvedValueOnce(failure === 'undefined' ? undefined : { Initialized: false });
  const { getPaddle } = await loadModule();
  const first = getPaddle();
  expect(getPaddle()).toBe(first);
  await expect(first).rejects.toThrow();
  expect(sdk.initialize).toHaveBeenCalledOnce();
  const retry = getPaddle();
  expect(getPaddle()).toBe(retry);
  expect(await retry).toBe(paddle);
  expect(sdk.initialize).toHaveBeenCalledTimes(2);
});

it('retries failed CDN downloads and missing globals with the installed SDK loader', async () => {
  vi.useFakeTimers();
  delete window.PaddleBillingV1;
  const realSdk = await vi.importActual<typeof import('@paddle/paddle-js')>('@paddle/paddle-js');
  sdk.initialize.mockImplementation(realSdk.initializePaddle);
  const { getPaddle } = await loadModule();
  for (const failureEvent of ['error', 'load', 'timeout']) {
    const first = getPaddle();
    expect(getPaddle()).toBe(first);
    const failedScript = document.querySelector(scriptSelector)!;
    const rejected = expect(first).rejects.toThrow(failureEvent === 'timeout' ? 'timed out' : 'could not be loaded');
    if (failureEvent === 'timeout') await vi.advanceTimersByTimeAsync(15_000);
    else failedScript.dispatchEvent(new Event(failureEvent));
    await rejected;
    expect(failedScript.isConnected).toBe(false);
    expect(sdk.initialize).not.toHaveBeenCalled();
  }
  const retry = getPaddle();
  expect(getPaddle()).toBe(retry);
  const script = document.querySelector(scriptSelector)!;
  expect(document.querySelectorAll(scriptSelector)).toHaveLength(1);
  const initialize = vi.fn(() => { paddle.Initialized = true; });
  paddle = { Initialized: false, Environment: { set: vi.fn() }, Initialize: initialize } as unknown as Paddle;
  window.PaddleBillingV1 = paddle;
  script.dispatchEvent(new Event('load'));
  expect(await retry).toBe(paddle);
  expect(sdk.initialize).toHaveBeenCalledOnce();
  expect(initialize).toHaveBeenCalledWith(expect.objectContaining({ eventCallback: expect.any(Function) }));
});

it('fans out installed closed/completed events once and stops on unsubscribe', async () => {
  const { getPaddle, subscribePaddleEvents, CheckoutEventNames } = await loadModule();
  const first = vi.fn();
  const second = vi.fn();
  const unsubscribeFirst = subscribePaddleEvents(first);
  expect(sdk.initialize).not.toHaveBeenCalled();
  await getPaddle();
  const unsubscribeSecond = subscribePaddleEvents(second);
  for (const name of [CheckoutEventNames.CHECKOUT_CLOSED, CheckoutEventNames.CHECKOUT_COMPLETED]) {
    const event: PaddleEventData = { name };
    callback()(event);
    expect(first).toHaveBeenLastCalledWith(event);
    expect(second).toHaveBeenLastCalledWith(event);
  }
  expect(first).toHaveBeenCalledTimes(2);
  expect(second).toHaveBeenCalledTimes(2);
  unsubscribeFirst();
  unsubscribeFirst();
  callback()({});
  expect(first).toHaveBeenCalledTimes(2);
  expect(second).toHaveBeenCalledTimes(3);
  unsubscribeSecond();
  callback()({});
  expect(second).toHaveBeenCalledTimes(3);
  expect(sdk.initialize).toHaveBeenCalledOnce();
});

it('gives duplicate listener registrations independent cleanup', async () => {
  const { getPaddle, subscribePaddleEvents } = await loadModule();
  const listener = vi.fn();
  const unsubscribe = subscribePaddleEvents(listener);
  const unsubscribeOther = subscribePaddleEvents(listener);
  await getPaddle();
  unsubscribe();
  callback()({});
  expect(listener).toHaveBeenCalledOnce();
  unsubscribeOther();
  callback()({});
  expect(listener).toHaveBeenCalledOnce();
});

it('isolates throwing consumers and honors cleanup during delivery', async () => {
  const { getPaddle, subscribePaddleEvents } = await loadModule();
  const late = vi.fn();
  let unsubscribeRemoved = () => {};
  let unsubscribeLate = () => {};
  const unsubscribeFirst = subscribePaddleEvents(() => {
    unsubscribeRemoved();
    unsubscribeLate = subscribePaddleEvents(late);
    throw new Error('consumer failure');
  });
  const removed = vi.fn();
  unsubscribeRemoved = subscribePaddleEvents(removed);
  const remaining = vi.fn();
  const unsubscribeRemaining = subscribePaddleEvents(remaining);
  await getPaddle();
  expect(() => callback()({})).not.toThrow();
  expect(removed).not.toHaveBeenCalled();
  expect(late).not.toHaveBeenCalled();
  expect(remaining).toHaveBeenCalledOnce();
  unsubscribeFirst();
  callback()({});
  expect(late).toHaveBeenCalledOnce();
  unsubscribeLate();
  unsubscribeRemaining();
});

it('opens successive inline checkouts with exact settings and one initialization', async () => {
  const open = vi.fn();
  paddle.Checkout = { open, close: vi.fn(), updateCheckout: vi.fn(), updateItems: vi.fn() };
  const { openInlineCheckout, subscribeNormalizedPaddleEvents } = await loadModule();
  const listener = vi.fn();
  const unsubscribe = subscribeNormalizedPaddleEvents(listener);
  for (const transactionId of ['txn_first', 'txn_second']) {
    await openInlineCheckout({ transactionId, frameTarget: 'payment-frame' });
    expect(open).toHaveBeenLastCalledWith({
      transactionId,
      settings: {
        displayMode: 'inline', variant: 'one-page', frameTarget: 'payment-frame',
        frameInitialHeight: 450,
        frameStyle: 'width: 100%; min-width: 312px; background-color: transparent; border: none;',
        allowLogout: false, showAddDiscounts: false, theme: 'light', locale: 'en',
      },
    });
    expect(open.mock.calls.at(-1)![0].settings).not.toHaveProperty('successUrl');
  }
  expect(sdk.initialize).toHaveBeenCalledOnce();
  expect(listener).not.toHaveBeenCalled(); // An open return value cannot establish readiness.
  unsubscribe();
});

it('propagates script and synchronous open failures to the inline caller', async () => {
  const open = vi.fn().mockImplementationOnce(() => { throw new Error('Open failed'); });
  paddle.Checkout = { open, close: vi.fn(), updateCheckout: vi.fn(), updateItems: vi.fn() };
  const { openInlineCheckout } = await loadModule();
  sdk.initialize.mockRejectedValueOnce(new Error('SDK failed'));
  const options = { transactionId: 'txn_fixture', frameTarget: 'payment-frame' };
  await expect(openInlineCheckout(options)).rejects.toThrow('SDK failed');
  expect(open).not.toHaveBeenCalled();
  await expect(openInlineCheckout(options)).rejects.toThrow('Open failed');
  await expect(openInlineCheckout(options)).resolves.toBeUndefined();
  expect(sdk.initialize).toHaveBeenCalledTimes(2);
});

const totals = { subtotal: 1200, discount: 0, tax: 120, total: 1320, balance: 1320, credit: 0 };
const recurringTotals = { subtotal: 1500, discount: 0, tax: 150, total: 1650 };
const eventWithData = (name: CheckoutEventNames): PaddleEventData => ({
  name,
  data: {
    transaction_id: 'txn_fixture', currency_code: 'USD', totals, recurring_totals: recurringTotals,
    customer: { email: 'private@example.invalid' },
    payment: { method_details: { card: { last4: '0000' } } },
  } as CheckoutEventsData,
});

it.each([
  [CheckoutEventNames.CHECKOUT_LOADED, 'loaded'],
  [CheckoutEventNames.CHECKOUT_UPDATED, 'updated'],
  [CheckoutEventNames.CHECKOUT_ITEMS_UPDATED, 'updated'],
])('delivers %s totals without carrying customer or payment data', async (name, type) => {
  const { getPaddle, subscribeNormalizedPaddleEvents } = await loadModule();
  const listener = vi.fn();
  const unsubscribe = subscribeNormalizedPaddleEvents(listener);
  expect(sdk.initialize).not.toHaveBeenCalled();
  await getPaddle();
  const event = eventWithData(name as CheckoutEventNames);
  callback()(event);
  expect(listener).toHaveBeenCalledExactlyOnceWith({
    type, transactionId: 'txn_fixture', totals, recurringTotals, currencyCode: 'USD',
  });
  expect(listener.mock.calls[0][0].totals).not.toBe(event.data!.totals);
  expect(listener.mock.calls[0][0].recurringTotals).not.toBe(event.data!.recurring_totals);
  unsubscribe();
  callback()(event);
  expect(listener).toHaveBeenCalledOnce();
});

it.each([
  [CheckoutEventNames.CHECKOUT_PAYMENT_FAILED, 'paymentFailed'],
  [CheckoutEventNames.CHECKOUT_PAYMENT_ERROR, 'paymentError'],
  [CheckoutEventNames.CHECKOUT_ERROR, 'openError'],
  [CheckoutEventNames.CHECKOUT_FAILED, 'openError'],
  [CheckoutEventNames.CHECKOUT_COMPLETED, 'completed'],
  [CheckoutEventNames.CHECKOUT_CLOSED, 'closed'],
])('normalizes %s with its transaction and excludes unrelated payloads', async (name, type) => {
  const { normalizePaddleEvent } = await loadModule();
  expect(normalizePaddleEvent(eventWithData(name as CheckoutEventNames))).toEqual({
    type, transactionId: 'txn_fixture',
  });
});

it.each([
  [CheckoutEventNames.CHECKOUT_ERROR, 'front-end_error', 'checkout_invalid', 'openError'],
  [CheckoutEventNames.CHECKOUT_ERROR, 'api_error', 'transaction_not_found', 'openError'],
  [CheckoutEventNames.CHECKOUT_PAYMENT_ERROR, 'api_error', 'no_payment_methods_available', 'paymentError'],
])('delivers flat %s %s without data or an invented transaction', async (name, errorType, code, type) => {
  const { getPaddle, subscribePaddleEvents, subscribeNormalizedPaddleEvents } = await loadModule();
  const raw = vi.fn();
  const normalized = vi.fn();
  const unsubscribeRaw = subscribePaddleEvents(raw);
  const unsubscribeNormalized = subscribeNormalizedPaddleEvents(normalized);
  await getPaddle();
  const event = {
    name: name as CheckoutEventNames, type: errorType, code,
    detail: 'Provider detail must remain outside normalized events', documentation_url: 'https://example.invalid',
  };
  callback()(event);
  expect(raw).toHaveBeenCalledExactlyOnceWith(event);
  expect(normalized).toHaveBeenCalledExactlyOnceWith({ type });
  unsubscribeRaw();
  unsubscribeNormalized();
});

it('does not invent totals or transaction IDs on data-free events and ignores unrelated events', async () => {
  const { normalizePaddleEvent } = await loadModule();
  expect(normalizePaddleEvent({ name: CheckoutEventNames.CHECKOUT_LOADED })).toEqual({ type: 'loaded' });
  expect(normalizePaddleEvent({ name: CheckoutEventNames.CHECKOUT_UPDATED })).toEqual({ type: 'updated' });
  expect(normalizePaddleEvent({ name: CheckoutEventNames.CHECKOUT_CLOSED })).toEqual({ type: 'closed' });
  expect(normalizePaddleEvent({})).toBeNull();
  expect(normalizePaddleEvent({ name: CheckoutEventNames.CHECKOUT_PAYMENT_INITIATED })).toBeNull();
});

it('isolates normalized listener failures from raw and normalized consumers', async () => {
  const { getPaddle, subscribePaddleEvents, subscribeNormalizedPaddleEvents } = await loadModule();
  const unsubscribeThrowing = subscribeNormalizedPaddleEvents(() => { throw new Error('consumer failed'); });
  const raw = vi.fn();
  const normalized = vi.fn();
  const unsubscribeRaw = subscribePaddleEvents(raw);
  const unsubscribeFirst = subscribeNormalizedPaddleEvents(normalized);
  const unsubscribeSecond = subscribeNormalizedPaddleEvents(normalized);
  await getPaddle();
  callback()({});
  expect(normalized).not.toHaveBeenCalled();
  const event = eventWithData(CheckoutEventNames.CHECKOUT_COMPLETED);
  expect(() => callback()(event)).not.toThrow();
  expect(raw).toHaveBeenLastCalledWith(event);
  expect(normalized).toHaveBeenCalledTimes(2);
  expect(normalized).toHaveBeenLastCalledWith({ type: 'completed', transactionId: 'txn_fixture' });
  unsubscribeFirst();
  callback()(event);
  expect(normalized).toHaveBeenCalledTimes(3);
  unsubscribeSecond();
  unsubscribeSecond();
  callback()(event);
  expect(normalized).toHaveBeenCalledTimes(3);
  unsubscribeThrowing();
  unsubscribeRaw();
});
