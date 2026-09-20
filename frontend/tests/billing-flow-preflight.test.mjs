import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { checkBillingFlow, main } from '../../scripts/billing-flow-preflight.mjs';

const price = 'pri_' + '0'.repeat(26);
const setup = () => ({
  PADDLE_ENVIRONMENT: 'sandbox', VITE_PADDLE_ENVIRONMENT: 'sandbox',
  VITE_PADDLE_CLIENT_TOKEN: 'test_private-client-sentinel', PADDLE_BILLING_ENABLED: 'true',
  PADDLE_API_KEY: 'private-api-sentinel-' + 'k'.repeat(32),
  PADDLE_WEBHOOK_SECRET: 'private-webhook-sentinel-' + 's'.repeat(32),
  PADDLE_PRICE_CATALOG_JSON: JSON.stringify([{ plan: 'STARTER', interval: 'month', priceId: price }]),
  PADDLE_CHECKOUT_URL: 'https://private-link.invalid/choose-plan', TRUST_PROXY_HOPS: '2',
});
const status = (env, name) => checkBillingFlow(env).find(check => check.name === name).status;

test('missing and blank configuration report only fixed names and MISSING', () => {
  for (const env of [{}, Object.fromEntries(Object.keys(setup()).map(name => [name, ' \n ']))]) {
    const lines = [];
    assert.equal(main(env, line => lines.push(line)), 1);
    assert.equal(lines.length, 9);
    assert.ok(lines.every(line => /^[A-Z_]+: MISSING$/.test(line)));
  }
});

test('valid sandbox configuration succeeds without mutating its environment', () => {
  const env = Object.freeze(setup());
  const lines = [];
  assert.equal(main(env, line => lines.push(line)), 0);
  assert.ok(checkBillingFlow(env).every(check => check.status === 'VALID'));
  assert.ok(lines.every(line => /^[A-Z_]+: VALID$/.test(line)));
});

test('mixed and production environments fail a sandbox release', () => {
  for (const patch of [
    { VITE_PADDLE_ENVIRONMENT: 'production' }, { PADDLE_ENVIRONMENT: 'production' },
    { PADDLE_ENVIRONMENT: 'production', VITE_PADDLE_ENVIRONMENT: 'production', VITE_PADDLE_CLIENT_TOKEN: 'live_private-sentinel' },
    { VITE_PADDLE_CLIENT_TOKEN: 'live_private-sentinel' }, { VITE_PADDLE_CLIENT_TOKEN: 'test_' },
    { PADDLE_BILLING_ENABLED: 'false' },
  ]) assert.equal(main({ ...setup(), ...patch }, () => {}), 1);
});

test('catalog uses shared strict configuration validation', () => {
  const item = { plan: 'STARTER', interval: 'month', priceId: price };
  const invalid = ['secret-malformed-json', 'null', '{}', '[]',
    JSON.stringify([item, item]), JSON.stringify([{ ...item, trialPeriod: null }]),
    JSON.stringify([{ ...item, priceId: 'pri_invalid' }]),
    JSON.stringify([{ ...item, plan: 'UNKNOWN' }]), JSON.stringify([{ ...item, interval: 'week' }]),
    JSON.stringify([item, { ...item, interval: 'year' }]),
    JSON.stringify([item, { ...item, priceId: 'pri_' + '1'.repeat(26) }]),
  ];
  for (const value of invalid) assert.equal(status({ ...setup(), PADDLE_PRICE_CATALOG_JSON: value }, 'PADDLE_PRICE_CATALOG_JSON'), 'INVALID');
  const fullCatalog = ['STARTER', 'PRO', 'ADVANCED'].flatMap((plan, index) => ['month', 'year'].map((interval, offset) => ({
    plan, interval, priceId: 'pri_' + String(index * 2 + offset).padStart(26, '0'),
  })));
  assert.equal(status({ ...setup(), PADDLE_PRICE_CATALOG_JSON: JSON.stringify(fullCatalog) }, 'PADDLE_PRICE_CATALOG_JSON'), 'VALID');
});

test('credentials reject short and placeholder values without returning them', () => {
  for (const name of ['PADDLE_API_KEY', 'PADDLE_WEBHOOK_SECRET']) {
    for (const value of ['short-secret', 'your_placeholder_' + 'x'.repeat(40)]) {
      assert.equal(status({ ...setup(), [name]: value }, name), 'INVALID');
    }
  }
});

test('default payment link must be HTTPS without credentials, query or fragment', () => {
  for (const value of ['secret-invalid-url', 'http://app.invalid', 'https://user:secret@app.invalid', 'https://app.invalid/?token=secret', 'https://app.invalid/#secret']) {
    assert.equal(status({ ...setup(), PADDLE_CHECKOUT_URL: value }, 'PADDLE_CHECKOUT_URL'), 'INVALID');
  }
});

test('hop count requires an explicit canonical nonnegative safe integer', () => {
  for (const value of ['-1', '1.5', 'true', ' 2', '2 ', '02', '1e2', '9007199254740992']) {
    assert.equal(status({ ...setup(), TRUST_PROXY_HOPS: value }, 'TRUST_PROXY_HOPS'), 'INVALID');
  }
  for (const value of ['0', '1', '2']) assert.equal(status({ ...setup(), TRUST_PROXY_HOPS: value }, 'TRUST_PROXY_HOPS'), 'VALID');
});

test('CLI reports only names and statuses, on success and failure, with correct exit codes', () => {
  for (const env of [setup(), {}, Object.fromEntries(Object.keys(setup()).map(name => [name, 'private-sentinel\nforged output']))]) {
    const child = spawnSync(process.execPath, ['--experimental-strip-types', new URL('../../scripts/billing-flow-preflight.mjs', import.meta.url).pathname], {
      env, encoding: 'utf8',
    });
    assert.equal(child.error, undefined);
    assert.equal(child.status, Object.keys(env).length && env.PADDLE_ENVIRONMENT === 'sandbox' ? 0 : 1);
    assert.equal(child.stderr, '');
    const lines = child.stdout.trim().split('\n');
    assert.equal(lines.length, 9);
    assert.ok(lines.every(line => /^[A-Z_]+: (VALID|MISSING|INVALID)$/.test(line)));
    for (const value of Object.values(env)) assert.ok(!child.stdout.includes(value));
    assert.ok(!JSON.stringify(checkBillingFlow(env)).includes('private-sentinel'));
  }
});
