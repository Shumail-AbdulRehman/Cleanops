import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { configuredEntryForPrice, configuredPlanForPrice, getPaddleCatalog, getPaddleCheckoutUrl, requireBillingActivation } from './paddle.js';

const priceId = 'pri_00000000000000000000000001';
const fixtureKey = 'isolated-credential-fixture-000000000000000';
const catalog = [{ plan: 'STARTER', interval: 'month', priceId }];
beforeEach(() => {
  vi.stubEnv('PADDLE_ENVIRONMENT', 'sandbox');
  vi.stubEnv('PADDLE_BILLING_ENABLED', 'true');
  vi.stubEnv('PADDLE_PRICE_CATALOG_JSON', JSON.stringify(catalog));
  vi.stubEnv('PADDLE_API_KEY', fixtureKey);
  vi.stubEnv('PADDLE_CHECKOUT_URL', 'https://workspace.example.invalid/choose-plan');
});
afterEach(() => vi.unstubAllEnvs());

describe('fail-closed activated configuration', () => {
  it.each([
    ['PADDLE_BILLING_ENABLED', 'false'], ['PADDLE_BILLING_ENABLED', 'TRUE'],
    ['PADDLE_ENVIRONMENT', ''], ['PADDLE_ENVIRONMENT', 'staging'],
    ['PADDLE_PRICE_CATALOG_JSON', ''], ['PADDLE_PRICE_CATALOG_JSON', 'private-malformed-config'],
    ['PADDLE_PRICE_CATALOG_JSON', '[]'], ['PADDLE_PRICE_CATALOG_JSON', 'null'],
    ['PADDLE_API_KEY', ''], ['PADDLE_API_KEY', 'short'],
    ['PADDLE_API_KEY', 'your_placeholder_private_key_0000000000000000'],
  ])('rejects invalid %s without exposing values', (key, value) => {
    vi.stubEnv(key, value);
    let failure: unknown;
    try { requireBillingActivation(); } catch (error) { failure = error; }
    expect(failure).toBeInstanceOf(Error);
    const message = (failure as Error).message;
    expect(message).not.toContain(fixtureKey);
    expect(message).not.toContain('private-malformed-config');
    expect(message).not.toContain('your_placeholder_private_key');
  });

  it.each(['sandbox', 'production'])('retains explicit %s activation with valid config', (environment) => {
    vi.stubEnv('PADDLE_ENVIRONMENT', environment);
    expect(() => requireBillingActivation()).not.toThrow();
  });

  it('maps exact approved plan/interval/price and never guesses another combination', () => {
    vi.stubEnv('PADDLE_PRICE_CATALOG_JSON', JSON.stringify([...catalog, { plan: 'PRO', interval: 'year', priceId: 'pri_00000000000000000000000002' }]));
    expect(configuredEntryForPrice(priceId)).toEqual(catalog[0]);
    expect(configuredPlanForPrice(priceId)).toBe('STARTER');
    expect(configuredEntryForPrice('pri_00000000000000000000000002')).toMatchObject({ plan: 'PRO', interval: 'year' });
    expect(configuredEntryForPrice('pri_00000000000000000000000003')).toBeUndefined();
    vi.stubEnv('PADDLE_PRICE_CATALOG_JSON', 'bad');
    expect(configuredEntryForPrice(priceId)).toBeUndefined();
  });

  it.each([
    { entries: [...catalog, { plan: 'STARTER', interval: 'month', priceId: 'pri_00000000000000000000000002' }] },
    { entries: [...catalog, { plan: 'PRO', interval: 'year', priceId }] },
    { entries: [{ plan: 'STARTER', interval: 'week', priceId }] },
    { entries: [{ plan: 'FREE', interval: 'month', priceId }] },
  ])('rejects duplicate or unsupported catalog %j', ({ entries }) => {
    vi.stubEnv('PADDLE_PRICE_CATALOG_JSON', JSON.stringify(entries));
    expect(() => getPaddleCatalog()).toThrow('Billing catalog is unavailable');
  });
});

it.each(['', 'not-a-url', 'http://workspace.example.invalid/choose-plan', 'https://user:private@workspace.example.invalid/choose-plan', 'https://workspace.example.invalid/choose-plan?private=1', 'https://workspace.example.invalid/choose-plan#private'])('rejects unusable checkout destination without revealing it: case %#', (destination) => {
  vi.stubEnv('PADDLE_CHECKOUT_URL', destination);
  expect(() => getPaddleCheckoutUrl()).toThrow('Billing checkout configuration is unavailable');
  // Missing checkout settings must not remove authorized catalog/portal reads.
  expect(() => requireBillingActivation()).not.toThrow();
});

it('returns the configured HTTPS checkout destination without altering its route', () => {
  expect(getPaddleCheckoutUrl().href).toBe('https://workspace.example.invalid/choose-plan');
});
