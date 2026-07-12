import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import type { Customer, Transaction, Subscription, EventEntity } from '@paddle/paddle-node-sdk';
import type { BillingProvider } from '../src/services/billingProvider.js';
import { assertIsolatedMediaDatabase } from '../src/services/attendanceMediaTransition.service.js';
// No checkout .env files and no fallback to DATABASE_URL, even on startup failure.
process.env.DOTENV_CONFIG_PATH = '/dev/null';
const url = process.env.BILLING_LIFECYCLE_TEST_DATABASE_URL;
assertIsolatedMediaDatabase(url, process.env.NODE_ENV);
const target = new URL(url!);
assert(!target.search && !target.hash, 'Query overrides are forbidden');
process.env.DATABASE_URL = url;
process.env.PADDLE_ENVIRONMENT = 'sandbox';
const priceId = 'pri_00000000000000000000000001', otherPriceId = 'pri_00000000000000000000000002';
process.env.PADDLE_PRICE_CATALOG_JSON = JSON.stringify([{ plan: 'STARTER', interval: 'month', priceId }, { plan: 'PRO', interval: 'month', priceId: otherPriceId }]);
process.env.PADDLE_BILLING_ENABLED = 'true';
process.env.PADDLE_API_KEY = 'isolated-non-network-credential-fixture-000000';
process.env.PADDLE_CHECKOUT_URL = 'https://workspace.example.invalid/choose-plan';
// All provider operations below are injected; accidental default transport fails.
globalThis.fetch = async () => { throw new Error('Real network forbidden in SQL42'); };
const { prisma } = await import('../src/prisma/prisma.js');
const { registerCompany } = await import('../src/services/companyRegistration.service.js');
const { processPaddleEvent, companyHasPaidAccess } = await import('../src/services/paddleFulfillment.service.js');
const { createBillingCheckout, getBillingLifecycle } = await import('../src/services/billingLifecycle.service.js');
const { confirmBillingCheckout } = await import('../src/services/billingConfirm.service.js');
const { reconcileBillingReservations } = await import('../src/services/billingReconcile.service.js');
const { reserveBillingOperation, readBillingReservation } = await import('../src/services/billingReservations.service.js');
const { BillingProviderError } = await import('../src/services/billingProvider.js');
const now = new Date();
const id = (prefix: string) => `${prefix}_${randomUUID().replaceAll('-', '').slice(0, 26)}`;
const owner = (label: string) => registerCompany({ name: 'SQL42 synthetic owner', companyName: `SQL42 ${label}`, email: `${randomUUID()}@example.invalid`, password: 'synthetic-owner-password' });
type Owner = Awaited<ReturnType<typeof owner>>;
function providerFor(actor: Owner) {
  let creates = 0, cancels = 0;
  const customer = { id: id('ctm'), email: actor.email, name: 'Synthetic', status: 'active', createdAt: now.toISOString(), updatedAt: now.toISOString(), customData: {} } as Customer;
  const drafts = new Map<string, Transaction>();
  const subscriptions = new Map<string, Subscription>();
  const provider = {
    customers: { create: async () => customer, list: async () => ({ data: [customer], hasMore: false }) },
    prices: { get: async (requested: string) => ({ id: requested, productId: 'pro_fixture', status: 'active', billingCycle: { interval: 'month', frequency: 1 }, unitPrice: { amount: '1800', currencyCode: 'USD' }, trialPeriod: null }) },
    products: { get: async () => ({ id: 'pro_fixture', status: 'active' }) },
    transactions: {
      create: async (input: { items: { priceId: string }[]; customData: object }) => {
        creates++;
        const draft = { id: id('txn'), customerId: customer.id, status: 'draft', subscriptionId: null, customData: input.customData, items: [{ quantity: 1, price: { id: input.items[0].priceId, productId: 'pro_fixture' } }], currencyCode: 'USD', createdAt: now.toISOString(), updatedAt: now.toISOString(), invoiceNumber: null } as Transaction;
        drafts.set(draft.id, draft); return draft;
      },
      get: async (key: string) => { const draft = drafts.get(key); assert(draft, 'Unknown fixture transaction'); return draft; },
      update: async (key: string) => { cancels++; const draft = drafts.get(key)!; draft.status = 'canceled'; return draft; },
      list: async () => ({ data: [...drafts.values()], hasMore: false }),
    },
    subscriptions: { get: async (key: string) => { const sub = subscriptions.get(key); assert(sub); return sub; } },
  } as unknown as BillingProvider;
  return { provider, customer, drafts, subscriptions, counts: () => ({ creates, cancels }) };
}
async function prepare(label: string) {
  const actor = await owner(label), p = providerFor(actor);
  const result = await createBillingCheckout(actor, { plan: 'STARTER', interval: 'month' }, { db: prisma, provider: p.provider });
  return { actor, ...p, result };
}
function subscription(customerId: string, price = priceId, status = 'active'): Subscription {
  return { id: id('sub'), customerId, status, items: [{ quantity: 1, recurring: true, price: { id: price, productId: 'pro_fixture' } }], currentBillingPeriod: { startsAt: new Date(+now - 3600000).toISOString(), endsAt: new Date(+now + 3600000).toISOString() }, createdAt: now.toISOString(), updatedAt: now.toISOString(), canceledAt: null, pausedAt: null, scheduledChange: null, customData: {} } as Subscription;
}
function event(type: string, data: object, at = now, eventId = id('evt')) {
  return { eventId, eventType: type, occurredAt: at.toISOString(), data } as unknown as EventEntity;
}
async function age(actor: Owner, action: string) {
  await prisma.auditLog.updateMany({ where: { companyId: actor.companyId, action }, data: { createdAt: new Date(+now - 180000) } });
}
try {
  await test('SQL42-01 concurrent checkout company locks allow one customer and one draft', async () => {
    const actor = await owner('locks'), p = providerFor(actor);
    const results = await Promise.allSettled(Array.from({ length: 4 }, () => createBillingCheckout(actor, { plan: 'STARTER', interval: 'month' }, { db: prisma, provider: p.provider })));
    assert(results.some(row => row.status === 'fulfilled')); assert.equal(p.counts().creates, 1);
    assert.equal(await prisma.auditLog.count({ where: { companyId: actor.companyId, action: 'CHECKOUT_RESERVED' } }), 1);
    assert.equal(await prisma.auditLog.count({ where: { companyId: actor.companyId, action: 'CUSTOMER_CREATE_RESERVED' } }), 1);
  });
  await test('SQL42-02 exact saved draft resumes with no second provider create', async () => {
    const p = await prepare('resume');
    assert.equal((await createBillingCheckout(p.actor, { plan: 'STARTER', interval: 'month' }, { db: prisma, provider: p.provider })).transactionId, p.result.transactionId);
    assert.deepEqual((await getBillingLifecycle(p.actor)).checkoutResume, { plan: 'STARTER', interval: 'month', transactionId: p.result.transactionId }); assert.equal(p.counts().creates, 1);
  });
  await test('SQL42-03 replacement appends cancellation and preserves old reservation facts', async () => {
    const p = await prepare('replace'); const before = await prisma.auditLog.findMany({ where: { companyId: p.actor.companyId }, orderBy: { id: 'asc' } });
    const result = await createBillingCheckout(p.actor, { plan: 'PRO', interval: 'month' }, { db: prisma, provider: p.provider });
    assert.equal(result.replaced, true); assert.notEqual(result.transactionId, p.result.transactionId);
    assert.deepEqual(p.counts(), { creates: 2, cancels: 1 });
    const after = await prisma.auditLog.findMany({ where: { companyId: p.actor.companyId }, orderBy: { id: 'asc' } });
    assert.deepEqual(after.slice(0, before.length), before); assert.equal(after.filter(row => row.action === 'CHECKOUT_CANCELED').length, 1);
    assert.equal((await getBillingLifecycle(p.actor)).checkoutResume?.plan, 'PRO');
  });
  await test('SQL42-04 another tab pays before replacement cannot create or cancel', async () => {
    const p = await prepare('paid-replace'); p.drafts.get(p.result.transactionId)!.status = 'completed';
    await assert.rejects(createBillingCheckout(p.actor, { plan: 'PRO', interval: 'month' }, { db: prisma, provider: p.provider }), /already been paid/); assert.deepEqual(p.counts(), { creates: 1, cancels: 0 });
  });
  await test('SQL42-05 definite customer rejection closes reservation and permits retry', async () => {
    const actor = await owner('reject'), p = providerFor(actor), create = p.provider.customers.create;
    p.provider.customers.create = async () => { throw new BillingProviderError('customers.create', { classification: 'REJECTED', providerCode: 'invalid_field', customerId: null }); };
    await assert.rejects(createBillingCheckout(actor, { plan: 'STARTER', interval: 'month' }, { db: prisma, provider: p.provider }));
    assert.equal(await prisma.auditLog.count({ where: { companyId: actor.companyId, action: 'CUSTOMER_CREATE_FAILED' } }), 1);
    p.provider.customers.create = create; await createBillingCheckout(actor, { plan: 'STARTER', interval: 'month' }, { db: prisma, provider: p.provider }); assert.equal(p.counts().creates, 1);
  });
  for (const foreign of [false, true]) await test(`SQL42-06-07 duplicate customer ${foreign ? 'foreign conflict' : 'sandbox adoption'}`, async () => {
    const actor = await owner('duplicate'), p = providerFor(actor);
    if (foreign) { const other = await owner('foreign'); await prisma.company.update({ where: { id: other.companyId }, data: { billingCustomerId: p.customer.id } }); }
    p.provider.customers.create = async () => { throw new BillingProviderError('customers.create', { classification: 'CUSTOMER_EXISTS', providerCode: 'customer_already_exists', customerId: p.customer.id }); };
    if (foreign) {
      await assert.rejects(createBillingCheckout(actor, { plan: 'STARTER', interval: 'month' }, { db: prisma, provider: p.provider }), /already associated/);
      assert.equal((await prisma.company.findUniqueOrThrow({ where: { id: actor.companyId } })).billingCustomerId, null); assert.equal(p.counts().creates, 0);
    } else { await createBillingCheckout(actor, { plan: 'STARTER', interval: 'month' }, { db: prisma, provider: p.provider }); assert.equal((await prisma.company.findUniqueOrThrow({ where: { id: actor.companyId } })).billingCustomerId, p.customer.id); }
  });
  await test('SQL42-08 old stuck customer reservation reconciles without creating', async () => {
    const actor = await owner('stuck-customer'), p = providerFor(actor);
    await reserveBillingOperation(actor, 'CUSTOMER_CREATE', {}, { db: prisma });
    assert.equal(await reconcileBillingReservations(actor, { db: prisma, provider: p.provider }), 'IN_PROGRESS');
    await age(actor, 'CUSTOMER_CREATE_RESERVED');
    assert.equal(await reconcileBillingReservations(actor, { db: prisma, provider: p.provider }), 'CLEARED');
    assert.equal((await prisma.company.findUniqueOrThrow({ where: { id: actor.companyId } })).billingCustomerId, p.customer.id); assert.equal(p.counts().creates, 0);
  });
  for (const found of [false, true]) await test(`SQL42-09-10 lost checkout response ${found ? 'resumes' : 'clears'}`, async () => {
    const actor = await owner('lost'), p = providerFor(actor), create = p.provider.transactions.create;
    p.provider.transactions.create = async (...args) => { if (found) await create(...args); throw new Error('Synthetic lost response'); };
    await assert.rejects(createBillingCheckout(actor, { plan: 'STARTER', interval: 'month' }, { db: prisma, provider: p.provider }));
    const before = await prisma.auditLog.findMany({ where: { companyId: actor.companyId, action: 'CHECKOUT_RESERVED' } });
    await assert.rejects(createBillingCheckout(actor, { plan: 'STARTER', interval: 'month' }, { db: prisma, provider: p.provider }));
    await age(actor, 'CHECKOUT_RESERVED');
    assert.equal(await reconcileBillingReservations(actor, { db: prisma, provider: p.provider }), found ? 'RESUMABLE' : 'CLEARED');
    assert.equal(await prisma.auditLog.count({ where: { id: before[0].id } }), 1);
    assert.equal((await getBillingLifecycle(actor)).workspaceAccessAllowed, false);
    if (found) assert.equal((await getBillingLifecycle(actor)).checkoutResume?.transactionId, [...p.drafts.keys()][0]);
  });
  await test('SQL42-11 paid without subscription remains processing and grants nothing', async () => {
    const p = await prepare('processing'); p.drafts.get(p.result.transactionId)!.status = 'completed';
    const result = await confirmBillingCheckout(p.actor, { db: prisma, provider: p.provider }); assert.equal(result.outcome, 'PROCESSING'); assert.equal(result.lifecycle.workspaceAccessAllowed, false);
  });
  for (const field of ['customer', 'price']) await test(`SQL42-12 foreign ${field} server read grants nothing`, async () => {
    const p = await prepare('mismatch'), sub = subscription(p.customer.id); p.subscriptions.set(sub.id, sub);
    const draft = p.drafts.get(p.result.transactionId)!; draft.status = 'completed'; draft.subscriptionId = sub.id;
    if (field === 'customer') draft.customerId = id('ctm'); else draft.items[0].price.id = otherPriceId;
    const result = await confirmBillingCheckout(p.actor, { db: prisma, provider: p.provider, log: () => {} }); assert.equal(result.outcome, 'PROCESSING'); assert.equal(await companyHasPaidAccess(p.actor.companyId), false);
  });
  for (const webhook of ['before', 'never', 'late']) await test(`SQL42-13-14-15 webhook ${webhook}, server confirmation and idempotent entitlement`, async () => {
    const p = await prepare('fulfillment'), sub = subscription(p.customer.id); p.subscriptions.set(sub.id, sub);
    const draft = p.drafts.get(p.result.transactionId)!; draft.status = 'completed'; draft.subscriptionId = sub.id;
    const delivery = event('subscription.created', sub);
    if (webhook === 'before') await processPaddleEvent(delivery);
    const result = await confirmBillingCheckout(p.actor, { db: prisma, provider: p.provider }); assert.equal(result.outcome, 'ACTIVE');
    if (webhook === 'late') { await processPaddleEvent(delivery); assert.equal((await processPaddleEvent(delivery)).duplicate, true); }
    assert.equal((await getBillingLifecycle(p.actor)).workspaceAccessAllowed, true); assert.equal(await prisma.paddleSubscription.count({ where: { companyId: p.actor.companyId } }), 1); assert.equal(p.counts().creates, 1);
  });
  await test('SQL42-16 suspended company paid confirmation never lifts suspension', async () => {
    const p = await prepare('suspended'), sub = subscription(p.customer.id); p.subscriptions.set(sub.id, sub); const draft = p.drafts.get(p.result.transactionId)!; draft.status = 'completed'; draft.subscriptionId = sub.id;
    await prisma.company.update({ where: { id: p.actor.companyId }, data: { operationalStatus: 'SUSPENDED' } });
    const result = await confirmBillingCheckout(p.actor, { db: prisma, provider: p.provider }); assert.equal(result.lifecycle.workspaceAccessAllowed, false); assert.equal(result.lifecycle.onboardingStep, 'RESTRICTED');
  });
  await test('SQL42-17 existing trialing subscription retains access', async () => {
    const p = await prepare('trialing'); await processPaddleEvent(event('subscription.created', subscription(p.customer.id, priceId, 'trialing'))); assert.equal((await getBillingLifecycle(p.actor)).workspaceAccessAllowed, true);
  });
  await test('SQL42-18 trial catalog is refused before draft creation', async () => {
    const actor = await owner('trial-price'), p = providerFor(actor), get = p.provider.prices.get;
    p.provider.prices.get = async (...args) => ({ ...await get(...args), trialPeriod: { interval: 'day', frequency: 7 } });
    await assert.rejects(createBillingCheckout(actor, { plan: 'STARTER', interval: 'month' }, { db: prisma, provider: p.provider })); assert.equal(p.counts().creates, 0);
  });
  await test('SQL42-19 live unverified owner cannot start checkout', async () => {
    const actor = await owner('live-unverified'), p = providerFor(actor); process.env.PADDLE_ENVIRONMENT = 'production';
    try { await assert.rejects(createBillingCheckout(actor, { plan: 'STARTER', interval: 'month' }, { db: prisma, provider: p.provider }), /Verify/); assert.equal(p.counts().creates, 0); }
    finally { process.env.PADDLE_ENVIRONMENT = 'sandbox'; }
  });
  await test('SQL42-20 reservation reader rejects a foreign transaction mirror', async () => {
    const p = await prepare('foreign-mirror'), other = await owner('foreign-company');
    await prisma.paddleTransaction.create({ data: { id: p.result.transactionId, companyId: other.companyId, customerId: p.customer.id, status: 'draft', currencyCode: 'USD', paddleUpdatedAt: now, lastEventAt: now } });
    const company = await prisma.company.findUniqueOrThrow({ where: { id: p.actor.companyId } }); assert.notEqual((await readBillingReservation(company, 'CHECKOUT', { db: prisma })).kind, 'closed');
    assert.equal((await getBillingLifecycle(p.actor)).checkoutResume, null);
  });
  await test('SQL42-21 signed event concurrency deduplicates and older cancellation cannot regress access', async () => {
    const p = await prepare('event-ordering'), sub = subscription(p.customer.id), delivery = event('subscription.created', sub);
    const results = await Promise.all([processPaddleEvent(delivery), processPaddleEvent(delivery)]);
    assert.equal(results.filter(row => row.duplicate).length, 1);
    const old = new Date(+now - 60000);
    await processPaddleEvent(event('subscription.canceled', { ...sub, status: 'canceled', updatedAt: old.toISOString(), currentBillingPeriod: null }, old));
    assert.equal((await prisma.paddleSubscription.findUniqueOrThrow({ where: { id: sub.id } })).status, 'active');
    assert.equal(await companyHasPaidAccess(p.actor.companyId), true);
    const failingDb = { $transaction: (run: (tx: unknown) => unknown) => prisma.$transaction(async tx => run(new Proxy(tx, {
      get(target, property) {
        if (property === 'paddleWebhookEvent') return { ...target.paddleWebhookEvent, create: async () => { throw new Error('Synthetic event marker failure'); } };
        const value = Reflect.get(target, property); return typeof value === 'function' ? value.bind(target) : value;
      },
    }))) } as unknown as NonNullable<Parameters<typeof processPaddleEvent>[1]>;
    const before = await prisma.company.findUniqueOrThrow({ where: { id: p.actor.companyId } });
    const failed = event('subscription.updated', { ...sub, items: [{ quantity: 1, recurring: true, price: { id: otherPriceId, productId: 'pro_fixture' } }], updatedAt: new Date(+now + 60000).toISOString() }, new Date(+now + 60000));
    await assert.rejects(processPaddleEvent(failed, failingDb), /marker failure/);
    assert.deepEqual(await prisma.company.findUniqueOrThrow({ where: { id: p.actor.companyId } }), before);
    assert.equal(await prisma.paddleWebhookEvent.count({ where: { id: failed.eventId } }), 0);
  });
  await test('SQL42-22 early paid placeholder converges only after subscription facts arrive', async () => {
    const p = await prepare('placeholder'), sub = subscription(p.customer.id);
    const draft = p.drafts.get(p.result.transactionId)!;
    await processPaddleEvent(event('transaction.completed', { ...draft, status: 'completed', subscriptionId: sub.id }));
    assert.equal((await prisma.paddleSubscription.findUniqueOrThrow({ where: { id: sub.id } })).status, 'unknown');
    assert.equal(await companyHasPaidAccess(p.actor.companyId), false);
    await processPaddleEvent(event('subscription.created', sub));
    assert.equal((await getBillingLifecycle(p.actor)).workspaceAccessAllowed, true);
  });
  await test('SQL42-23 READY persistence rollback retains RESERVED and forbids duplicate creation', async () => {
    const actor = await owner('ready-persistence'), p = providerFor(actor);
    const failingDb = new Proxy(prisma, { get(target, property) {
      if (property === '$transaction') return (run: (tx: unknown) => unknown) => prisma.$transaction(async tx => run(new Proxy(tx, { get(inner, key) {
        if (key === 'auditLog') return { ...inner.auditLog, create: async (args: Parameters<typeof inner.auditLog.create>[0]) => {
          if (args?.data.action === 'CHECKOUT_READY') throw new Error('Synthetic READY persistence failure');
          return inner.auditLog.create(args);
        } };
        const value = Reflect.get(inner, key); return typeof value === 'function' ? value.bind(inner) : value;
      } })));
      const value = Reflect.get(target, property); return typeof value === 'function' ? value.bind(target) : value;
    } });
    await assert.rejects(createBillingCheckout(actor, { plan: 'STARTER', interval: 'month' }, { db: failingDb, provider: p.provider }), /persistence failure/);
    await assert.rejects(createBillingCheckout(actor, { plan: 'STARTER', interval: 'month' }, { db: prisma, provider: p.provider }));
    assert.equal(p.counts().creates, 1);
    assert.equal(await prisma.auditLog.count({ where: { companyId: actor.companyId, action: 'CHECKOUT_RESERVED' } }), 1);
    assert.equal(await prisma.auditLog.count({ where: { companyId: actor.companyId, action: 'CHECKOUT_READY' } }), 0);
  });

  await test('SQL42-24 webhook email and customData cannot select a tenant', async () => {
    const p = await prepare('canonical-customer'), other = await owner('untrusted-metadata');
    await processPaddleEvent(event('customer.created', { ...p.customer, email: other.email, customData: { companyId: other.companyId } }));
    assert.equal((await prisma.paddleCustomer.findUniqueOrThrow({ where: { id: p.customer.id } })).companyId, p.actor.companyId);
    const impostor = id('ctm');
    await processPaddleEvent(event('customer.created', { ...p.customer, id: impostor, email: other.email, customData: { companyId: other.companyId } }));
    assert.equal((await prisma.paddleCustomer.findUniqueOrThrow({ where: { id: impostor } })).companyId, null);
    assert.equal((await prisma.company.findUniqueOrThrow({ where: { id: other.companyId } })).billingCustomerId, null);
    await assert.rejects(getBillingLifecycle({ ...p.actor, companyId: other.companyId }), /owner/);
  });
  await test('SQL42-25 unknown catalog and future expired missing periods never grant access', async () => {
    const p = await prepare('invalid-entitlement'), sub = subscription(p.customer.id);
    await processPaddleEvent(event('subscription.created', sub));
    await prisma.paddleSubscription.update({ where: { id: sub.id }, data: { priceId: 'pri_99999999999999999999999999' } });
    assert.equal(await companyHasPaidAccess(p.actor.companyId), false);
    await prisma.paddleSubscription.update({ where: { id: sub.id }, data: { priceId } });
    for (const [start, end] of [[new Date(+now + 3600000), new Date(+now + 7200000)], [new Date(+now - 7200000), new Date(+now - 3600000)], [null, null]]) {
      await prisma.paddleSubscription.update({ where: { id: sub.id }, data: { currentBillingPeriodStart: start, currentBillingPeriodEnd: end } });
      assert.equal((await getBillingLifecycle(p.actor, { now: () => now })).workspaceAccessAllowed, false);
    }
  });
  await test('SQL42-26 uncertain customer creation retains its hold and cannot create twice', async () => {
    const actor = await owner('uncertain-customer'), p = providerFor(actor); let customerCreates = 0;
    p.provider.customers.create = async () => { customerCreates++; throw new Error('Synthetic lost customer response'); };
    await assert.rejects(createBillingCheckout(actor, { plan: 'STARTER', interval: 'month' }, { db: prisma, provider: p.provider }));
    const reservation = await prisma.auditLog.findFirstOrThrow({ where: { companyId: actor.companyId, action: 'CUSTOMER_CREATE_RESERVED' } });
    await assert.rejects(createBillingCheckout(actor, { plan: 'STARTER', interval: 'month' }, { db: prisma, provider: p.provider }));
    assert.equal(customerCreates, 1); assert.equal(p.counts().creates, 0);
    assert.equal((await getBillingLifecycle(actor)).reconciliationRequired, true);
    assert.equal(await prisma.auditLog.count({ where: { id: reservation.id } }), 1);
    assert.equal(await prisma.auditLog.count({ where: { companyId: actor.companyId, action: 'CUSTOMER_CREATE_FAILED' } }), 0);
  });

} finally { await prisma.$disconnect(); }
