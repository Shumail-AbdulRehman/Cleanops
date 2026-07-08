import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EventName, Subscription, SubscriptionCreatedNotification, SubscriptionNotification, type EventEntity } from '@paddle/paddle-node-sdk';
import type { PaddleCustomer, PaddleSubscription, PaddleTransaction } from '@prisma/client';
import { applyPaddleSubscription, processPaddleEvent, subscriptionGrantsPaidAccess } from "./paddleFulfillment.service.js";
import { evaluateAccountAccess, readAccountState, type AccountState } from './accountAccess.service.js';

vi.mock('../prisma/prisma.js', () => ({ prisma: {} }));

const now = new Date('2026-11-09T12:00:00Z');
const customerId = 'ctm_00000000000000000000000001';
const subscriptionId = 'sub_00000000000000000000000001';
const priceId = 'pri_00000000000000000000000001';
const proPriceId = 'pri_00000000000000000000000002';
const productId = 'pro_00000000000000000000000001';
const scope = { companyId: 42, customerId };
const at = (offset: number) => new Date(+now + offset).toISOString();

// Construct real installed SDK entities without a client or network request.
function providerData(change: Partial<ConstructorParameters<typeof Subscription>[0]> = {}): ConstructorParameters<typeof Subscription>[0] {
  return {
    id: subscriptionId, customer_id: customerId, address_id: 'add_fixture', status: 'active', currency_code: 'USD',
    created_at: at(-60_000), updated_at: at(0), collection_mode: 'automatic', management_urls: null,
    current_billing_period: { starts_at: at(-3_600_000), ends_at: at(3_600_000) },
    billing_cycle: { interval: 'month', frequency: 1 },
    items: [{ status: 'active', quantity: 1, recurring: true, created_at: at(-60_000), updated_at: at(0),
      price: { id: priceId, product_id: productId, description: 'Fixture price', type: 'standard',
        billing_cycle: { interval: 'month', frequency: 1 }, trial_period: null, tax_mode: 'account_setting',
        unit_price: { amount: '1234', currency_code: 'USD' }, unit_price_overrides: [], quantity: { minimum: 1, maximum: 1 },
        status: 'active', created_at: at(-60_000), updated_at: at(0) },
      product: { id: productId, name: 'Fixture product', tax_category: 'standard', status: 'active', created_at: at(-60_000), updated_at: at(0) },
    }],
    ...change,
  };
}

function subscriptionEvent(data = providerData(), occurredAt = data.updated_at, id = 'evt_fixture', eventType = EventName.SubscriptionUpdated): EventEntity {
  const notificationData = { ...data, discount: null };
  const notification = eventType === EventName.SubscriptionCreated
    ? new SubscriptionCreatedNotification({ ...notificationData, transaction_id: 'txn_fixture' })
    : new SubscriptionNotification(notificationData);
  return { eventId: id, eventType, occurredAt, data: notification } as EventEntity;
}

// A transactional memory fixture exercises both public entry paths and the real
// access policy. It checks requested locks, not PostgreSQL's lock implementation.
function table<T extends { id: string }>(defaults: Partial<T> = {}) {
  const rows = new Map<string, T>();
  const defined = (data: Partial<T>) => Object.fromEntries(Object.entries(data).filter(([, value]) => value !== undefined));
  const matches = (row: T, where: Partial<T>) => Object.entries(where).every(([key, value]) => row[key as keyof T] === value);
  const findUnique = vi.fn(async ({ where }: { where: { id: string } }) => structuredClone(rows.get(where.id) ?? null));
  const update = vi.fn(async ({ where, data }: { where: { id: string }; data: Partial<T> }) => {
    const current = rows.get(where.id);
    if (!current) throw new Error('Missing fixture row');
    const row = { ...current, ...defined(data) } as T; rows.set(where.id, row); return structuredClone(row);
  });
  return { rows, findUnique, update,
    findFirst: vi.fn(async ({ where }: { where: Partial<T> }) => structuredClone([...rows.values()].find(row => matches(row, where)) ?? null)),
    findUniqueOrThrow: vi.fn(async (args: { where: { id: string } }) => {
      const row = await findUnique(args); if (!row) throw new Error('Missing fixture row'); return row;
    }),
    upsert: vi.fn(async ({ where, create, update: change }: { where: { id: string }; create: Partial<T>; update: Partial<T> }) => {
      const current = rows.get(where.id);
      const row = { ...defaults, ...current, ...defined(current ? change : create) } as T;
      rows.set(where.id, row); return structuredClone(row);
    }),
    updateMany: vi.fn(async ({ where, data }: { where: Partial<T>; data: Partial<T> }) => {
      let count = 0;
      for (const row of rows.values()) if (matches(row, where)) { await update({ where: { id: row.id }, data }); count++; }
      return { count };
    }),
    findMany: vi.fn(async ({ where }: { where: Partial<T> }) => structuredClone([...rows.values()].filter(row => matches(row, where)))),
  };
}

function fixture(companyChange: Partial<AccountState['company']> = {}) {
  let company: AccountState['company'] & { subscriptionStatus: string; planUpdatedAt: Date } = {
    id: 42, plan: 'STARTER', isActive: true, operationalStatus: 'ACTIVE', billingCustomerId: customerId,
    billingSubscriptionId: null, subscriptionStatus: 'CANCELLED', planUpdatedAt: new Date(0), ...companyChange,
  };
  const customer = table<PaddleCustomer>({ companyId: null, email: null });
  const subscription = table<PaddleSubscription>({ companyId: null, scheduledChangeAction: null, scheduledChangeAt: null,
    currentBillingPeriodStart: null, currentBillingPeriodEnd: null, canceledAt: null, pausedAt: null });
  const transaction = table<PaddleTransaction>({ companyId: null });
  const events = new Map<string, object>();
  const query = vi.fn(async (_sql: TemplateStringsArray, ..._values: unknown[]) => []);
  const companyUpdate = vi.fn(async ({ data }: { data: Partial<typeof company> }) => { company = { ...company, ...data }; return structuredClone(company); });
  const eventCreate = vi.fn(async ({ data }: { data: { id: string } }) => { events.set(data.id, structuredClone(data)); return data; });
  const client = {
    $queryRaw: query,
    company: {
      findFirst: vi.fn(async ({ where }: { where: { billingCustomerId: string } }) =>
        company.billingCustomerId === where.billingCustomerId ? { id: company.id } : null),
      findUnique: vi.fn(async () => structuredClone(company)),
      findUniqueOrThrow: vi.fn(async () => structuredClone(company)), update: companyUpdate,
    },
    paddleCustomer: customer,
    paddleSubscription: { ...subscription, findMany: vi.fn(async (args: { where: Partial<PaddleSubscription> }) =>
      (await subscription.findMany(args)).sort((a, b) => +b.lastEventAt - +a.lastEventAt || +b.paddleUpdatedAt - +a.paddleUpdatedAt)) },
    paddleTransaction: transaction,
    paddleWebhookEvent: { findUnique: vi.fn(async ({ where }: { where: { id: string } }) => events.get(where.id) ?? null), create: eventCreate },
  };
  const runTransaction = vi.fn(async (run: (tx: typeof client) => Promise<unknown>) => {
    const before = structuredClone({ company, customers: customer.rows, subscriptions: subscription.rows, transactions: transaction.rows, events });
    try { return await run(client); } catch (error) {
      company = before.company;
      for (const [rows, saved] of [[customer.rows, before.customers], [subscription.rows, before.subscriptions],
        [transaction.rows, before.transactions], [events, before.events]] as const) {
        rows.clear(); for (const [id, row] of saved) (rows as Map<string, object>).set(id, row);
      }
      throw error;
    }
  });
  const db = { $transaction: runTransaction } as unknown as NonNullable<Parameters<typeof processPaddleEvent>[1]>;
  const state = (): AccountState => ({ company, subscription: subscription.rows.get(company.billingSubscriptionId ?? '') ?? null });
  return { db, client, query, runTransaction, companyUpdate, eventCreate, customer, subscription, transaction, events, state,
    company: () => structuredClone(company),
    canWork: async () => {
      const account = await readAccountState(company.id, client as unknown as NonNullable<Parameters<typeof readAccountState>[1]>);
      try { evaluateAccountAccess(account, 'ADMIN', 'START_WORK', now); return true; } catch { return false; }
    },
    read: (data = providerData()) => applyPaddleSubscription(new Subscription(data), scope, db),
    webhook: (data = providerData(), occurredAt = data.updated_at, id = 'evt_fixture', type = EventName.SubscriptionUpdated) =>
      processPaddleEvent(subscriptionEvent(data, occurredAt, id, type), db),
  };
}

beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(now);
  vi.stubEnv('PADDLE_ENVIRONMENT', 'sandbox');
  vi.stubEnv('PADDLE_PRICE_CATALOG_JSON', JSON.stringify([
    { plan: 'STARTER', interval: 'month', priceId }, { plan: 'PRO', interval: 'month', priceId: proPriceId },
  ]));
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });

describe("subscriptionGrantsPaidAccess", () => {
  it.each(["active", "trialing", "ACTIVE", "TRIALING"])(
    "grants access for %s",
    (status) => expect(subscriptionGrantsPaidAccess(status)).toBe(true),
  );

  it.each(["canceled", "paused", "past_due"])(
    "does not grant access for %s",
    (status) => expect(subscriptionGrantsPaidAccess(status)).toBe(false),
  );
});

describe('shared subscription fulfilment', () => {
  it.each(['active', 'trialing', 'past_due', 'paused', 'canceled'] as const)(
    'produces identical company state and access for a new %s subscription through either entry path', async status => {
      const data = providerData({ status, canceled_at: status === 'canceled' ? at(0) : null, paused_at: status === 'paused' ? at(0) : null });
      if (status === 'trialing') data.items[0]!.price.trial_period = { interval: 'day', frequency: 7 };
      const read = fixture(), webhook = fixture();
      await read.read(data); await webhook.webhook(data, at(0), 'evt_new', EventName.SubscriptionCreated);
      expect(read.company()).toEqual(webhook.company());
      expect(read.state().subscription).toEqual(webhook.state().subscription);
      expect(await read.canWork()).toBe(status === 'active' || status === 'trialing');
      expect(await webhook.canWork()).toBe(await read.canWork());
      expect(read.company()).toMatchObject({ billingSubscriptionId: subscriptionId, plan: 'STARTER',
        subscriptionStatus: ['active', 'trialing'].includes(status) ? 'ACTIVE' : status === 'past_due' ? 'PAST_DUE' : 'CANCELLED' });
      expect(read.events.size).toBe(0);
      expect(read.client.paddleWebhookEvent.findUnique).not.toHaveBeenCalled();
      expect(read.eventCreate).not.toHaveBeenCalled();
      expect(webhook.events.size).toBe(1);
    },
  );

  it('maps SDK periods, scheduled changes, price and product through the webhook handler', async () => {
    const data = providerData({ scheduled_change: { action: 'pause', effective_at: at(1_000), resume_at: null } });
    data.items[0]!.price.id = proPriceId;
    const read = fixture(), webhook = fixture();
    await read.read(data); await webhook.webhook(data);
    expect(read.company()).toEqual(webhook.company());
    expect(read.company().plan).toBe('PRO');
    expect(read.state().subscription).toMatchObject({ priceId: proPriceId, productId, scheduledChangeAction: 'pause',
      scheduledChangeAt: new Date(at(1_000)), currentBillingPeriodStart: new Date(at(-3_600_000)), currentBillingPeriodEnd: new Date(at(3_600_000)) });
    expect(await read.canWork()).toBe(true);
  });

  it('preserves recurring-price selection and the fallback for a nonrecurring item', async () => {
    const data = providerData();
    const extra = structuredClone(data.items[0]!); extra.recurring = false; extra.price.id = proPriceId;
    data.items.unshift(extra);
    const f = fixture(); await f.read(data);
    expect(f.company().plan).toBe('STARTER');
    const next = providerData({ updated_at: at(1_000), items: [extra] });
    await f.read(next); expect(f.company().plan).toBe('PRO');
  });

  it('clears obsolete scheduled/canceled/paused facts when newer provider data resumes a subscription', async () => {
    const f = fixture();
    await f.read(providerData({ status: 'paused', paused_at: at(0), canceled_at: at(0), scheduled_change: { action: 'cancel', effective_at: at(0), resume_at: null } }));
    expect(await f.canWork()).toBe(false);
    await f.read(providerData({ updated_at: at(1_000) }));
    expect(f.state().subscription).toMatchObject({ scheduledChangeAction: null, scheduledChangeAt: null, canceledAt: null, pausedAt: null });
    expect(await f.canWork()).toBe(true);
  });

  it.each([
    { current_billing_period: null },
    { current_billing_period: { starts_at: at(-3_600_000), ends_at: at(0) } },
    { current_billing_period: { starts_at: at(1_000), ends_at: at(3_600_000) } },
    { scheduled_change: { action: 'cancel' as const, effective_at: at(0), resume_at: null } },
  ])('retains the exact effective-window access policy: %j', async change => {
    const read = fixture(), webhook = fixture();
    const data = providerData(change); await read.read(data); await webhook.webhook(data);
    expect(read.company()).toEqual(webhook.company());
    expect(await read.canWork()).toBe(false); expect(await webhook.canWork()).toBe(false);
  });

  it('mirrors an unconfigured price without granting access or inventing a plan', async () => {
    const data = providerData(); data.items[0]!.price.id = 'pri_99999999999999999999999999';
    const read = fixture(), webhook = fixture(); await read.read(data); await webhook.webhook(data);
    expect(read.company()).toEqual(webhook.company());
    expect(read.company()).toMatchObject({ plan: 'STARTER', subscriptionStatus: 'CANCELLED' });
    expect(await read.canWork()).toBe(false); expect(await webhook.canWork()).toBe(false);
  });

  it.each([{ operationalStatus: 'SUSPENDED' as const }, { isActive: false }])('keeps administrative restrictions: %j', async restriction => {
    const read = fixture(restriction), webhook = fixture(restriction);
    await read.read(); await webhook.webhook();
    expect(read.company()).toEqual(webhook.company());
    expect(read.company()).toMatchObject(restriction);
    expect(await read.canWork()).toBe(false); expect(await webhook.canWork()).toBe(false);
  });

  it.each(['read', 'webhook'] as const)('takes company then customer locks before subscription writes via %s', async entry => {
    const f = fixture(); await f[entry]();
    expect(f.runTransaction).toHaveBeenCalledOnce();
    const locks = f.query.mock.calls.map(([sql, ...values]) => ({ sql: sql.join('?'), values }));
    const entityLocks = entry === 'webhook' ? locks.slice(1) : locks;
    expect(entityLocks).toEqual([
      { sql: 'SELECT id FROM "Company" WHERE id=? FOR UPDATE', values: [42] },
      { sql: 'SELECT pg_advisory_xact_lock(hashtextextended(?, 1516))::text', values: [customerId] },
    ]);
    expect(f.query.mock.invocationCallOrder.at(-1)).toBeLessThan(f.subscription.upsert.mock.invocationCallOrder[0]!);
    expect(f.query.mock.invocationCallOrder.at(-1)).toBeLessThan(f.companyUpdate.mock.invocationCallOrder[0]!);
  });
});

describe('subscription ordering across reads and webhooks', () => {
  it('writes no event marker on repeated reads; the real webhook still applies and then deduplicates', async () => {
    const f = fixture(); await f.read(); await f.read();
    expect(f.events.size).toBe(0);
    expect(await f.webhook(providerData(), at(500), 'evt_real')).toEqual({ duplicate: false });
    expect(f.events.has('evt_real')).toBe(true);
    expect(f.subscription.rows.get(subscriptionId)?.lastEventAt).toEqual(new Date(at(500)));
    const before = f.subscription.upsert.mock.calls.length;
    expect(await f.webhook(providerData(), at(500), 'evt_real')).toEqual({ duplicate: true });
    expect(f.subscription.upsert).toHaveBeenCalledTimes(before);
    expect(f.eventCreate).toHaveBeenCalledOnce(); expect(await f.canWork()).toBe(true);
  });

  it('accepts a newer cancellation webhook after a server read', async () => {
    const f = fixture(); await f.read();
    await f.webhook(providerData({ status: 'canceled', canceled_at: at(1_000), updated_at: at(1_000) }), at(2_000));
    expect(f.state().subscription?.status).toBe('canceled'); expect(await f.canWork()).toBe(false);
  });

  it.each([at(-1_000), at(0), at(10_000)])('does not regress a server-read version from an older webhook occurring at %s', async occurredAt => {
    const f = fixture(); await f.read();
    const before = structuredClone(f.state());
    await f.webhook(providerData({ status: 'canceled', canceled_at: at(-1_000), updated_at: at(-1_000) }), occurredAt);
    expect(f.state()).toEqual(before); expect(f.events.size).toBe(1); expect(await f.canWork()).toBe(true);
  });

  it('does not regress a webhook version with an older server read', async () => {
    const f = fixture(); await f.webhook(providerData(), at(10_000));
    await f.read(providerData({ status: 'canceled', canceled_at: at(-1_000), updated_at: at(-1_000) }));
    expect(f.state().subscription?.status).toBe('active'); expect(await f.canWork()).toBe(true);
  });

  it('applies a newer provider read even when its updatedAt precedes the previous event occurredAt', async () => {
    const f = fixture(); await f.webhook(providerData(), at(10_000));
    await f.read(providerData({ status: 'paused', paused_at: at(1_000), updated_at: at(1_000) }));
    expect(f.state().subscription?.status).toBe('paused'); expect(await f.canWork()).toBe(false);
  });

  it('uses provider version rather than local read time so a later newer webhook can apply', async () => {
    const f = fixture(); vi.setSystemTime(new Date(at(60_000))); await f.read();
    await f.webhook(providerData({ status: 'past_due', updated_at: at(1_000) }), at(2_000));
    expect(f.state().subscription?.status).toBe('past_due'); expect(await f.canWork()).toBe(false);
  });

  it('keeps the event timestamp tie-breaker for equal subscription versions', async () => {
    const f = fixture(); await f.webhook(providerData(), at(1_000), 'evt_first');
    await f.webhook(providerData({ status: 'past_due' }), at(500), 'evt_old');
    await f.read(providerData({ status: 'past_due' }));
    expect(f.state().subscription?.status).toBe('active');
    await f.webhook(providerData({ status: 'past_due' }), at(2_000), 'evt_new');
    expect(f.state().subscription?.status).toBe('past_due');
  });
});

describe('known customer and tenant boundaries', () => {
  it('refuses a subscription for another customer before opening a transaction', async () => {
    const f = fixture();
    await expect(f.read(providerData({ customer_id: 'ctm_foreign' }))).rejects.toMatchObject({ statusCode: 409 });
    expect(f.runTransaction).not.toHaveBeenCalled(); expect(f.company().billingSubscriptionId).toBeNull();
  });

  it.each([null, 'ctm_other'])('refuses a customer not canonically linked to the expected company: %s', async billingCustomerId => {
    const f = fixture({ billingCustomerId });
    await expect(f.read()).rejects.toMatchObject({ statusCode: 409 });
    expect(f.subscription.rows.size).toBe(0); expect(f.customer.rows.size).toBe(0); expect(f.companyUpdate).not.toHaveBeenCalled();
  });

  it('refuses a company mismatch even if the customer is linked to another valid company', async () => {
    const f = fixture({ id: 99 });
    await expect(f.read()).rejects.toMatchObject({ statusCode: 409 });
    expect(f.companyUpdate).not.toHaveBeenCalled(); expect(f.events.size).toBe(0);
  });

  it('refuses an existing customer mirror owned by another company', async () => {
    const f = fixture(); f.customer.rows.set(customerId, { id: customerId, companyId: 99 } as PaddleCustomer);
    await expect(f.read()).rejects.toMatchObject({ statusCode: 409 });
    expect(f.companyUpdate).not.toHaveBeenCalled(); expect(f.subscription.rows.size).toBe(0);
    expect(f.customer.rows.get(customerId)?.companyId).toBe(99);
  });

  it.each([{ customerId: 'ctm_foreign' }, { companyId: 99 }])('refuses an existing subscription linkage mismatch: %j', async change => {
    const f = fixture(); await f.read();
    const row = f.subscription.rows.get(subscriptionId)!; f.subscription.rows.set(subscriptionId, { ...row, ...change });
    const before = structuredClone(f.state());
    await expect(f.read(providerData({ updated_at: at(1_000) }))).rejects.toMatchObject({ statusCode: 409 });
    expect(f.state()).toEqual(before);
  });

  it('keeps unlinked webhook subscriptions as mirrors and never trusts customData for ownership', async () => {
    const f = fixture({ billingCustomerId: null });
    await f.webhook(providerData({ custom_data: { companyId: 42 } }));
    expect(f.companyUpdate).not.toHaveBeenCalled();
    expect(f.subscription.rows.get(subscriptionId)?.companyId).toBeNull(); expect(await f.canWork()).toBe(false);
  });

  it.each([0, -1, 1.5, Number.NaN])('rejects an invalid company scope %s', async companyId => {
    const f = fixture();
    await expect(applyPaddleSubscription(new Subscription(providerData()), { companyId, customerId }, f.db)).rejects.toMatchObject({ statusCode: 409 });
    expect(f.runTransaction).not.toHaveBeenCalled();
  });

  it('rejects an invalid provider version before writing', async () => {
    const f = fixture(); await expect(f.read(providerData({ updated_at: 'invalid' }))).rejects.toMatchObject({ statusCode: 400 });
    expect(f.runTransaction).not.toHaveBeenCalled();
  });

  it('rolls back server-read mirrors and linkage when access synchronization fails', async () => {
    const f = fixture(); f.companyUpdate.mockRejectedValueOnce(new Error('fixture write failure'));
    await expect(f.read()).rejects.toThrow('fixture write failure');
    expect(f.subscription.rows.size).toBe(0); expect(f.customer.rows.size).toBe(0);
    expect(f.company().billingSubscriptionId).toBeNull(); expect(f.events.size).toBe(0);
  });

  it('preserves webhook atomicity if the deduplication marker fails', async () => {
    const f = fixture(); f.eventCreate.mockRejectedValueOnce(new Error('fixture marker failure'));
    await expect(f.webhook()).rejects.toThrow('fixture marker failure');
    expect(f.subscription.rows.size).toBe(0); expect(f.company().billingSubscriptionId).toBeNull();
    expect(f.events.size).toBe(0);
    expect(await f.webhook()).toEqual({ duplicate: false }); expect(await f.canWork()).toBe(true);
  });
});

describe('transaction webhook order remains independent', () => {
  const types = [EventName.TransactionCreated, EventName.TransactionUpdated, EventName.TransactionCanceled, EventName.TransactionPaid,
    EventName.TransactionReady, EventName.TransactionBilled, EventName.TransactionPastDue, EventName.TransactionCompleted];
  it.each(types.flatMap(type => [true, false].map(transactionFirst => ({ type, transactionFirst }))))(
    'accepts $type with transactionFirst=$transactionFirst without suppressing subscription fulfilment', async ({ type, transactionFirst }) => {
      const f = fixture();
      const event = { eventId: 'evt_transaction', eventType: type, occurredAt: at(10_000), data: {
        id: 'txn_fixture', customerId, subscriptionId, status: type.slice('transaction.'.length), currencyCode: 'USD', invoiceNumber: null,
        createdAt: at(-60_000), updatedAt: at(10_000), customData: null, items: [{ quantity: 1, price: { id: priceId, productId } }],
        details: { totals: { grandTotal: '1234' } },
      } } as unknown as EventEntity;
      if (transactionFirst) {
        await processPaddleEvent(event, f.db);
        expect(f.state().subscription?.status).toBe('unknown'); expect(await f.canWork()).toBe(false);
        await f.webhook();
      } else {
        await f.read(); await processPaddleEvent(event, f.db);
      }
      expect(f.state().subscription?.status).toBe('active'); expect(await f.canWork()).toBe(true);
      expect(f.transaction.rows.get('txn_fixture')).toMatchObject({ companyId: 42, customerId, subscriptionId });
      expect(f.events.has('evt_transaction')).toBe(true);
    },
  );
});
