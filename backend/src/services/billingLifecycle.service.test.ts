import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHmac } from 'node:crypto';
import express from 'express';
import type { Request, Response, NextFunction } from 'express';
import { once } from 'node:events';
import subscriptionRouter from '../routes/subscription.route.js';
import { Environment, Paddle } from '@paddle/paddle-node-sdk';
import type { AuditLog } from '@prisma/client';
const m = vi.hoisted(() => ({
  owner: vi.fn(), company: vi.fn(), customer: vi.fn(), subscription: vi.fn(), subscriptions: vi.fn(), count: vi.fn(),
  auditFind: vi.fn(), auditMany: vi.fn(), auditCreate: vi.fn(), transaction: vi.fn(),
  priceGet: vi.fn(), productGet: vi.fn(), customerCreate: vi.fn(), transactionCreate: vi.fn(), portalCreate: vi.fn(), provider: vi.fn(),
}));
vi.mock('../prisma/prisma.js', () => ({ prisma: {} }));
import * as paddleConfig from '../config/paddle.js';
import { getPaddleCatalog, configuredPlanForPrice, requireBillingActivation, getPaddleWebhookSecret } from '../config/paddle.js';
import { createBillingCheckout, createBillingPortal, getBillingCatalog, getBillingLifecycle } from './billingLifecycle.service.js';
import { createBillingCheckout as sharedCheckout } from './billingCheckout.service.js';
import { getBillingCatalog as sharedCatalog } from './billingCatalog.service.js';
const priceId = 'pri_00000000000000000000000001', customerId = 'ctm_00000000000000000000000001', transactionId = 'txn_00000000000000000000000001';
const actor = { id: 1, role: 'ADMIN' as const, companyId: 42 };
const now = new Date('2026-11-07T12:00:00Z');
const company = { id: 42, name: 'Synthetic company', isActive: true, operationalStatus: 'ACTIVE', plan: 'STARTER', billingCustomerId: customerId, billingSubscriptionId: null };
const owner = { id: 1, email: 'owner@example.invalid', name: 'Synthetic owner', emailVerifiedAt: now, company };
const dbObject = { manager: { findFirst: m.owner, count: m.count }, company: { findUnique: m.company }, paddleCustomer: { findFirst: m.customer },
  paddleTransaction: { findFirst: m.transaction }, paddleSubscription: { findFirst: m.subscription, findMany: m.subscriptions },
  location: { count: m.count }, staff: { count: m.count }, auditLog: { findFirst: m.auditFind, findMany: m.auditMany, create: m.auditCreate } };
const deps = { db: dbObject as unknown as NonNullable<Parameters<typeof getBillingLifecycle>[1]>['db'],
  now: () => now, provider: m.provider };
let audits: AuditLog[];
function fact(id: number, action: string, newValue: unknown, change: Partial<AuditLog> = {}): AuditLog {
  return { id, action, newValue, companyId: 42, entityType: 'BILLING_OPERATION', entityId: 42,
    actorType: 'ADMIN', actorId: 1, oldValue: null, reason: null, createdAt: new Date(+now - 180_000), ...change } as AuditLog;
}
function checkoutAudit(requested: object = { plan: 'STARTER', interval: 'month', priceId }, saved: object | null = { reservationId: 10, transactionId, customerId }) {
  audits.push(fact(10, 'CHECKOUT_RESERVED', requested));
  if (saved) audits.push(fact(11, 'CHECKOUT_READY', saved));
}
function linked(change: object = {}, companyChange: object = {}) {
  const linkedCompany = { ...company, billingSubscriptionId: 'sub_fixture', ...companyChange };
  m.owner.mockResolvedValue({ ...owner, company: linkedCompany }); m.company.mockResolvedValue(linkedCompany);
  m.subscription.mockResolvedValue({ ...qualifiedSubscription(), ...change });
}
function qualifiedSubscription() {
  return { id: 'sub_fixture', companyId: 42, customerId, priceId, status: 'active',
    currentBillingPeriodStart: new Date('2026-11-01T00:00:00Z'), currentBillingPeriodEnd: new Date('2026-12-01T00:00:00Z'),
    canceledAt: null, pausedAt: null, scheduledChangeAction: null, scheduledChangeAt: null, lastEventAt: new Date('2026-11-01T00:00:00Z') };
}
beforeEach(() => {
  vi.resetAllMocks(); audits = [];
  vi.stubEnv('PADDLE_ENVIRONMENT', 'sandbox'); vi.stubEnv('PADDLE_BILLING_ENABLED', 'true'); vi.stubEnv('PADDLE_API_KEY', 'isolated-credential-fixture-000000000000000');
  vi.stubEnv('PADDLE_PRICE_CATALOG_JSON', JSON.stringify([{ plan: 'STARTER', interval: 'month', priceId }])); vi.stubEnv('PADDLE_CHECKOUT_URL', 'https://workspace.example.invalid/choose-plan');
  m.company.mockResolvedValue({ ...company }); m.owner.mockResolvedValue({ ...owner, company: { ...company } });
  m.customer.mockResolvedValue({ id: customerId, companyId: 42 }); m.subscription.mockResolvedValue(null); m.subscriptions.mockResolvedValue([]); m.count.mockResolvedValue(1);
  m.transaction.mockResolvedValue(null);
  m.portalCreate.mockResolvedValue({ customerId, urls: { general: { overview: 'https://sandbox-customer-portal.paddle.com/cpl_fixture?token=temporary-fixture' } } });
  m.provider.mockReturnValue({ prices: { get: m.priceGet }, products: { get: m.productGet }, customers: { create: m.customerCreate },
    transactions: { create: m.transactionCreate }, customerPortalSessions: { create: m.portalCreate } });
  type Query = { where: { action: string | { in: string[] }; newValue?: { equals: number }; companyId: number; entityId: number; entityType: string } };
  const matches = ({ where }: Query) => audits.filter(row => row.companyId === where.companyId && row.entityId === where.entityId && row.entityType === where.entityType &&
    (typeof where.action === 'string' ? row.action === where.action : where.action.in.includes(row.action)) &&
    (!where.newValue || (row.newValue as { reservationId?: number } | null)?.reservationId === where.newValue.equals)).sort((a, b) => b.id - a.id);
  m.auditFind.mockImplementation(async (query: Query) => matches(query)[0] ?? null);
  m.auditMany.mockImplementation(async (query: Query) => matches(query));
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

it('re-exports the shared catalog and checkout implementations without wrappers or duplicate logic', () => {
  expect(getBillingCatalog).toBe(sharedCatalog); expect(createBillingCheckout).toBe(sharedCheckout);
});
describe('explicit qualified catalog and activation', () => {
  it.each(['', 'short', 'your_placeholder_webhook_secret_123456789'])('does not accept absent/weak/placeholder webhook verification secret', value => {
    vi.stubEnv('PADDLE_WEBHOOK_SECRET', value); expect(() => getPaddleWebhookSecret()).toThrow();
  });
  it('has no built-in prices, trial length or production environment default', () => {
    expect(getPaddleCatalog()).toEqual([{ plan: 'STARTER', interval: 'month', priceId }]);
    expect(configuredPlanForPrice('pri_unknown')).toBeUndefined();
    expect(configuredPlanForPrice(priceId)).toBe('STARTER');
  });
  it.each(['PADDLE_ENVIRONMENT', 'PADDLE_PRICE_CATALOG_JSON', 'PADDLE_API_KEY', 'PADDLE_BILLING_ENABLED'])('requires %s before activation', key => {
    vi.stubEnv(key, ''); expect(() => requireBillingActivation()).toThrow();
  });
  it.each(['null', '[]', '{}', 'bad', '[{"plan":"FREE","interval":"month","priceId":"bad"}]',
    JSON.stringify([{ plan: 'STARTER', interval: 'month', priceId }, { plan: 'PRO', interval: 'month', priceId }]),
    JSON.stringify([{ plan: 'STARTER', interval: 'month', priceId, amount: 'invented' }])])('rejects unavailable, duplicate or unapproved catalog %s', value => {
    vi.stubEnv('PADDLE_PRICE_CATALOG_JSON', value); expect(() => getPaddleCatalog()).toThrow(); expect(configuredPlanForPrice(priceId)).toBeUndefined();
  });
  it('shows safe metadata without exposing provider URLs, credentials or pretending billing is configured', async () => {
    vi.stubEnv('PADDLE_BILLING_ENABLED', 'false');
    const result = await getBillingLifecycle(actor, deps);
    expect(result.billingConfigured).toBe(false); expect(result.checkoutAvailable).toBe(false); expect(result.portalAvailable).toBe(false);
    expect(JSON.stringify(result)).not.toContain('credential-fixture'); expect(JSON.stringify(result)).not.toContain('password');
    expect(m.priceGet).not.toHaveBeenCalled();
  });
  it('retains owner recovery facts for a legacy inactive company while denying checkout before provider access', async () => {
    m.company.mockResolvedValue({ ...company, isActive: false });
    m.owner.mockResolvedValue({ ...owner, company: { ...company, isActive: false, operationalStatus: 'ACTIVE' } });
    const result = await getBillingLifecycle(actor, deps);
    expect(result.company).toMatchObject({ id: actor.companyId, isActive: false, operationalStatus: 'ACTIVE' });
    expect(result.checkoutAvailable).toBe(false);
    expect(result.portalAvailable).toBe(true);
    expect(m.priceGet).not.toHaveBeenCalled();
    expect(m.customerCreate).not.toHaveBeenCalled();
    expect(m.transactionCreate).not.toHaveBeenCalled();
    expect(m.auditCreate).not.toHaveBeenCalled();
  });
  it('shows an unresolved request as unavailable rather than offering a duplicate checkout', async () => {
    checkoutAudit(undefined, null);
    const result = await getBillingLifecycle(actor, deps);
    expect(result.reconciliationRequired).toBe(true); expect(result.checkoutAvailable).toBe(false);
    expect(m.transactionCreate).not.toHaveBeenCalled();
  });
  it('does not treat an early transaction placeholder as completed onboarding', async () => {
    m.company.mockResolvedValue({ ...company, billingSubscriptionId: 'sub_fixture' });
    m.owner.mockResolvedValue({ ...owner, company: { ...company, billingSubscriptionId: 'sub_fixture' } });
    m.subscription.mockResolvedValue({ ...qualifiedSubscription(), status: 'unknown' });
    expect(await getBillingLifecycle(actor, deps)).toMatchObject({ providerState: 'MIRRORED', onboardingRequired: true, checkoutAvailable: false });
    m.subscription.mockResolvedValue({ ...qualifiedSubscription(), status: 'trialing' });
    expect(await getBillingLifecycle(actor, deps)).toMatchObject({ onboardingRequired: false });
  });
});
describe('owner-only provider portal', () => {
  it.each(['MANAGER', 'STAFF'] as const)('denies %s before touching provider data', async role => {
    await expect(createBillingPortal({ ...actor, role }, {}, deps)).rejects.toMatchObject({ statusCode: 403 }); expect(m.portalCreate).not.toHaveBeenCalled();
  });
  it('rejects client company/customer/subscription selection', async () => {
    await expect(createBillingPortal(actor, { companyId: 99 }, deps)).rejects.toMatchObject({ statusCode: 400 }); expect(m.portalCreate).not.toHaveBeenCalled();
  });
  it('queries the exact canonical customer in the actor tenant and returns a fresh unpersisted hosted URL', async () => {
    m.subscriptions.mockResolvedValue([{ id: 'sub_fixture' }]);
    const result = await createBillingPortal(actor, {}, deps);
    expect(result.url).toContain('https://sandbox-customer-portal.paddle.com/');
    expect(m.customer).toHaveBeenCalledWith({ where: { id: customerId, companyId: 42 } });
    expect(m.portalCreate).toHaveBeenCalledWith(customerId, ['sub_fixture']); expect(m.auditCreate).not.toHaveBeenCalled();
  });
  it('does not grant portal access based on company billing ID without its tenant mirror', async () => {
    m.customer.mockResolvedValue(null); await expect(createBillingPortal(actor, {}, deps)).rejects.toMatchObject({ statusCode: 409 }); expect(m.portalCreate).not.toHaveBeenCalled();
  });
  it.each(['http://customer-portal.paddle.com/', 'https://attacker.example/', 'https://user:password@customer-portal.paddle.com/'])('rejects unsafe provider URL %s', url => {
    m.portalCreate.mockResolvedValue({ customerId, urls: { general: { overview: url } } }); return expect(createBillingPortal(actor, {}, deps)).rejects.toMatchObject({ statusCode: 503 });
  });
  it('does not expose raw provider error payloads', async () => {
    m.portalCreate.mockRejectedValue(new Error('private-provider-body'));
    await expect(createBillingPortal(actor, {}, deps)).rejects.toMatchObject({ statusCode: 503, message: 'Billing is unavailable. Please try again later.' });
  });
});
describe('installed Paddle signature verifier', () => {
  it('verifies actual raw signed bytes and rejects tampering using the existing SDK', async () => {
    const sdk = new Paddle('isolated-no-network-fixture', { environment: Environment.sandbox });
    const secret = 'isolated-signature-fixture', ts = Math.floor(Date.now() / 1000);
    const raw = JSON.stringify({ event_id: 'evt_fixture', event_type: 'customer.created', occurred_at: new Date().toISOString(), notification_id: 'ntf_fixture', data: { id: customerId, email: 'fixture@example.invalid', name: 'Synthetic customer', status: 'active', locale: 'en', custom_data: null, created_at: new Date().toISOString(), updated_at: new Date().toISOString() } });
    const signature = `ts=${ts};h1=${createHmac('sha256', secret).update(`${ts}:${raw}`).digest('hex')}`;
    expect((await sdk.webhooks.unmarshal(raw, secret, signature)).eventId).toBe('evt_fixture');
    await expect(sdk.webhooks.unmarshal(raw + ' ', secret, signature)).rejects.toThrow();
  });
});

describe('subscription router public/private boundary', () => {
  it('keeps existing public pricing context outside the new protected manage namespace', async () => {
    const app = express(); app.use('/subscription', subscriptionRouter);
    app.use((error: { statusCode?: number }, _req: Request, res: Response, _next: NextFunction) => { res.status(error.statusCode ?? 500).json({ failed: true }); });
    const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
    const address = server.address(); if (!address || typeof address === 'string') throw new Error('Expected isolated local listener');
    try {
      const publicResponse = await fetch(`http://127.0.0.1:${address.port}/subscription/pricing-context`);
      expect(publicResponse.status).toBe(200);
      const privateResponse = await fetch(`http://127.0.0.1:${address.port}/subscription/manage/lifecycle`);
      expect(privateResponse.status).toBe(401);
    } finally { server.close(); await once(server, 'close'); }
  });
});

describe('authoritative workspace permission and public readiness DTO', () => {
  const now = new Date('2026-11-07T12:00:00Z');
  const timedDeps = { ...deps, now: () => now };
  function linked(change: object = {}, companyChange: object = {}) {
    const linkedCompany = { ...company, billingSubscriptionId: 'sub_fixture', ...companyChange };
    m.owner.mockResolvedValue({ ...owner, company: linkedCompany });
    m.company.mockResolvedValue(linkedCompany);
    m.subscription.mockResolvedValue({ ...qualifiedSubscription(), ...change });
  }
  it.each(['active', 'trialing'])('grants permission only for the actual qualified current %s window', async (status) => {
    linked({ status });
    const result = await getBillingLifecycle(actor, timedDeps);
    expect(result).toMatchObject({ workspaceAccessAllowed: true, checkoutReadiness: 'LINKED_SUBSCRIPTION', checkoutAvailable: false, checkoutResume: null,
      subscription: { priceId, interval: 'month', catalogQualified: true, periodStart: '2026-11-01T00:00:00.000Z', periodEnd: '2026-12-01T00:00:00.000Z' } });
    expect(m.transactionCreate).not.toHaveBeenCalled();
    expect(m.priceGet).not.toHaveBeenCalled();
  });
  it.each([
    { currentBillingPeriodStart: null }, { currentBillingPeriodEnd: null },
    { currentBillingPeriodStart: new Date('2026-12-02T00:00:00Z') },
    { currentBillingPeriodEnd: now }, { currentBillingPeriodStart: new Date('invalid') },
    { canceledAt: now }, { pausedAt: now },
    { scheduledChangeAction: 'cancel', scheduledChangeAt: now },
    { scheduledChangeAction: 'pause', scheduledChangeAt: now },
    { status: 'past_due' }, { status: 'canceled' }, { status: 'paused' }, { status: 'unknown' },
    { priceId: 'pri_00000000000000000000000099' },
    { companyId: 99 }, { customerId: 'ctm_foreign' }, { id: 'sub_foreign' },
  ])('does not authorize from active-looking or mismatched facts: %#', async (change) => {
    linked(change);
    expect(await getBillingLifecycle(actor, timedDeps)).toMatchObject({ workspaceAccessAllowed: false, checkoutAvailable: false, checkoutResume: null });
  });
  it('does not qualify a catalog price mapped to a different company plan', async () => {
    linked({}, { plan: 'PRO' });
    expect(await getBillingLifecycle(actor, timedDeps)).toMatchObject({ workspaceAccessAllowed: false, subscription: { catalogQualified: false } });
  });
  it.each([{ isActive: false }, { operationalStatus: 'SUSPENDED' }])('administrative restriction overrides a paid window: %#', async (change) => {
    linked({}, change);
    expect(await getBillingLifecycle(actor, timedDeps)).toMatchObject({ workspaceAccessAllowed: false, checkoutReadiness: 'COMPANY_RESTRICTED', checkoutAvailable: false, checkoutResume: null });
  });
  it('does not conflate disabled purchasing with revoking an existing qualified entitlement', async () => {
    linked(); vi.stubEnv('PADDLE_BILLING_ENABLED', 'false');
    expect(await getBillingLifecycle(actor, timedDeps)).toMatchObject({ workspaceAccessAllowed: true, checkoutReadiness: 'BILLING_DISABLED', checkoutAvailable: false });
  });
  it('returns explicit false/null for a never-subscribed owner', async () => {
    expect(await getBillingLifecycle(actor, timedDeps)).toMatchObject({ workspaceAccessAllowed: false, checkoutReadiness: 'READY', checkoutResume: null, checkoutAvailable: true });
  });
  it.each(['PADDLE_ENVIRONMENT', 'PADDLE_API_KEY', 'PADDLE_PRICE_CATALOG_JSON', 'PADDLE_CHECKOUT_URL'])('missing %s never advertises a ready checkout', async (key) => {
    vi.stubEnv(key, '');
    const result = await getBillingLifecycle(actor, timedDeps);
    expect(result).toMatchObject({ workspaceAccessAllowed: false, checkoutReadiness: 'BILLING_DISABLED', checkoutAvailable: false, checkoutResume: null });
    expect(JSON.stringify(result)).not.toContain('credential-fixture');
  });
  it('keeps production owner verification mandatory and sandbox verification unchanged', async () => {
    m.owner.mockResolvedValue({ ...owner, emailVerifiedAt: null });
    vi.stubEnv('PADDLE_ENVIRONMENT', 'production');
    expect(await getBillingLifecycle(actor, timedDeps)).toMatchObject({ ownerVerified: false, checkoutReadiness: 'OWNER_VERIFICATION_REQUIRED' });
    vi.stubEnv('PADDLE_ENVIRONMENT', 'sandbox');
    expect(await getBillingLifecycle(actor, timedDeps)).toMatchObject({ ownerVerified: false, checkoutReadiness: 'READY' });
  });
  it('propagates unexpected database failures instead of reporting ready or empty success', async () => {
    m.company.mockRejectedValue(new Error('database read failed'));
    await expect(getBillingLifecycle(actor, timedDeps)).rejects.toThrow('database read failed');
  });
});


describe('local lifecycle assembly and ordered onboarding decisions', () => {
  beforeEach(() => {
    // A status read must never initialize an SDK client or make a network call,
    // including through a shared service rather than the explicit provider seam.
    vi.spyOn(paddleConfig, 'getPaddleClient').mockImplementation(() => { throw new Error('Unexpected Paddle client'); });
    vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Unexpected network request'); }));
  });
  afterEach(() => {
    expect(m.provider).not.toHaveBeenCalled();
    expect(paddleConfig.getPaddleClient).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
    for (const call of [m.priceGet, m.productGet, m.customerCreate, m.transactionCreate, m.portalCreate, m.auditCreate]) expect(call).not.toHaveBeenCalled();
  });
  it('returns all existing fields and an explicit plan selection decision for a new company', async () => {
    expect(await getBillingLifecycle(actor, deps)).toEqual({
      company: { id: company.id, name: company.name, isActive: true, operationalStatus: 'ACTIVE', plan: 'STARTER' },
      usage: { locations: 1, staff: 1, managers: 1 }, limits: { locations: 1, staff: 3, managers: 1 },
      subscription: null, workspaceAccessAllowed: false, checkoutReadiness: 'READY', checkoutResume: null,
      reconciliationRequired: false, billingConfigured: true, ownerVerified: true, billingEnvironment: 'sandbox',
      onboardingRequired: true, providerState: 'AWAITING_PROVIDER', portalAvailable: true, checkoutAvailable: true,
      onboardingStep: 'CHOOSE_PLAN', recoveryReason: null,
    });
    expect(m.owner).toHaveBeenCalledWith(expect.objectContaining({ where: { id: actor.id, companyId: actor.companyId, role: 'ADMIN', isActive: true } }));
    expect(m.count).toHaveBeenCalledWith({ where: { companyId: 42, isActive: true } });
  });
  it.each(['MANAGER', 'STAFF'] as const)('refuses %s before reading any company facts', async role => {
    await expect(getBillingLifecycle({ ...actor, role }, deps)).rejects.toMatchObject({ statusCode: 403 });
    expect(m.owner).not.toHaveBeenCalled(); expect(m.company).not.toHaveBeenCalled();
  });
  it.each([null, { ...owner, id: 2 }, { ...owner, company: { ...company, id: 99 } }])('rejects a missing or mismatched active owner: %#', async value => {
    m.owner.mockResolvedValue(value);
    await expect(getBillingLifecycle(actor, deps)).rejects.toMatchObject({ statusCode: 403 });
    expect(m.company).not.toHaveBeenCalled();
  });
  it('rejects a foreign company returned by the account read', async () => {
    m.company.mockResolvedValue({ ...company, id: 99 });
    await expect(getBillingLifecycle(actor, deps)).rejects.toMatchObject({ statusCode: 403 });
  });
  it('retains NOT_LINKED facts for a company without a customer', async () => {
    m.company.mockResolvedValue({ ...company, billingCustomerId: null });
    expect(await getBillingLifecycle(actor, deps)).toMatchObject({ onboardingStep: 'CHOOSE_PLAN', recoveryReason: null, providerState: 'NOT_LINKED', portalAvailable: false });
    expect(m.customer).not.toHaveBeenCalled();
  });
  it.each([{ isActive: false }, { operationalStatus: 'SUSPENDED' }])('restriction overrides paid access, disabled billing and verification: %#', async change => {
    linked({}, change); checkoutAudit();
    m.transaction.mockResolvedValue({ id: transactionId, companyId: 42, customerId, status: 'paid' });
    vi.stubEnv('PADDLE_BILLING_ENABLED', 'false');
    expect(await getBillingLifecycle(actor, deps)).toMatchObject({ onboardingStep: 'RESTRICTED', recoveryReason: null, workspaceAccessAllowed: false, checkoutResume: null });
  });
  it.each(['active', 'trialing'])('qualified %s entitlement wins over purchase and email readiness', async status => {
    linked({ status }); vi.stubEnv('PADDLE_BILLING_ENABLED', 'false'); vi.stubEnv('PADDLE_CHECKOUT_URL', '');
    expect(await getBillingLifecycle(actor, deps)).toMatchObject({ onboardingStep: 'WORKSPACE', recoveryReason: null, workspaceAccessAllowed: true, checkoutAvailable: false });
  });
  it.each(['past_due', 'canceled', 'paused', 'unknown'])('linked %s subscriber without access goes to ACCOUNT even with billing disabled', async status => {
    linked({ status }); vi.stubEnv('PADDLE_BILLING_ENABLED', 'false');
    expect(await getBillingLifecycle(actor, deps)).toMatchObject({ onboardingStep: 'ACCOUNT', recoveryReason: null, workspaceAccessAllowed: false });
  });
  it.each([null, { ...qualifiedSubscription(), companyId: 99 }, { ...qualifiedSubscription(), customerId: 'ctm_foreign' }])('canonical subscription linkage still returns ACCOUNT for a missing/foreign mirror: %#', async subscription => {
    linked(); m.subscription.mockResolvedValue(subscription);
    expect(await getBillingLifecycle(actor, deps)).toMatchObject({ onboardingStep: 'ACCOUNT', recoveryReason: null, subscription: null, workspaceAccessAllowed: false });
  });
  it('sends an expired subscriber to ACCOUNT', async () => {
    linked({ currentBillingPeriodEnd: now });
    expect(await getBillingLifecycle(actor, deps)).toMatchObject({ onboardingStep: 'ACCOUNT', recoveryReason: null, workspaceAccessAllowed: false });
  });
  it('disabled billing wins over paid-pending and an unusable checkout URL', async () => {
    vi.stubEnv('PADDLE_BILLING_ENABLED', 'false'); vi.stubEnv('PADDLE_CHECKOUT_URL', ''); checkoutAudit();
    m.transaction.mockResolvedValue({ id: transactionId, companyId: 42, customerId, status: 'paid' });
    expect(await getBillingLifecycle(actor, deps)).toMatchObject({ onboardingStep: 'UNAVAILABLE', recoveryReason: 'BILLING_DISABLED', billingConfigured: false });
  });
  it.each(['', 'http://example.invalid', 'https://user:password@example.invalid', 'https://example.invalid/?query=1'])('unusable purchase configuration returns PRICE_NOT_READY: %s', async url => {
    vi.stubEnv('PADDLE_CHECKOUT_URL', url);
    await expect(getBillingLifecycle(actor, deps)).resolves.toMatchObject({ onboardingStep: 'UNAVAILABLE', recoveryReason: 'PRICE_NOT_READY', billingConfigured: true, checkoutAvailable: false });
  });
  it('production requires email verification before a paid-pending or resumable draft', async () => {
    vi.stubEnv('PADDLE_ENVIRONMENT', 'production'); m.owner.mockResolvedValue({ ...owner, emailVerifiedAt: null }); checkoutAudit();
    m.transaction.mockResolvedValue({ id: transactionId, companyId: 42, customerId, status: 'completed' });
    expect(await getBillingLifecycle(actor, deps)).toMatchObject({ onboardingStep: 'VERIFY_EMAIL', recoveryReason: null, ownerVerified: false, checkoutResume: null });
  });
  it.each(['sandbox', 'production'])('verified %s owner can choose a plan', async environment => {
    vi.stubEnv('PADDLE_ENVIRONMENT', environment);
    expect(await getBillingLifecycle(actor, deps)).toMatchObject({ onboardingStep: 'CHOOSE_PLAN', recoveryReason: null, ownerVerified: true });
  });
  it('keeps the sandbox email exception without marking the email verified', async () => {
    m.owner.mockResolvedValue({ ...owner, emailVerifiedAt: null });
    expect(await getBillingLifecycle(actor, deps)).toMatchObject({ onboardingStep: 'CHOOSE_PLAN', recoveryReason: null, ownerVerified: false, checkoutAvailable: true });
  });
  it.each(['paid', 'billed', 'completed'])('the exact %s draft mirror returns CONFIRMING without granting access', async status => {
    checkoutAudit(); m.transaction.mockResolvedValue({ id: transactionId, companyId: 42, customerId, status });
    expect(await getBillingLifecycle(actor, deps)).toMatchObject({ onboardingStep: 'CONFIRMING', recoveryReason: null, workspaceAccessAllowed: false, checkoutAvailable: false, checkoutResume: null, reconciliationRequired: true });
    expect(m.transaction).toHaveBeenCalledWith({ where: { id: transactionId, companyId: 42, customerId } });
  });
  it('paid-pending takes precedence over an open customer reservation', async () => {
    checkoutAudit(); audits.push(fact(12, 'CUSTOMER_CREATE_RESERVED', {}));
    m.transaction.mockResolvedValue({ id: transactionId, companyId: 42, customerId, status: 'completed' });
    expect(await getBillingLifecycle(actor, deps)).toMatchObject({ onboardingStep: 'CONFIRMING', recoveryReason: null, checkoutResume: null });
  });
  it('fulfilment releases the checkout hold and delegates to current subscription access', async () => {
    linked(); checkoutAudit(); m.transaction.mockResolvedValue({ id: transactionId, companyId: 42, customerId, status: 'completed', subscriptionId: 'sub_fixture' });
    expect(await getBillingLifecycle(actor, deps)).toMatchObject({ onboardingStep: 'WORKSPACE', recoveryReason: null, reconciliationRequired: false, checkoutReadiness: 'LINKED_SUBSCRIPTION', checkoutResume: null });
  });
  it.each(['CUSTOMER_CREATE', 'CHECKOUT'])('open %s reservation returns RECONCILE both inside and after grace', async operation => {
    for (const age of [0, 119_999, 120_000, 180_000]) {
      audits = [fact(10, `${operation}_RESERVED`, {}, { createdAt: new Date(+now - age) })];
      expect(await getBillingLifecycle(actor, deps)).toMatchObject({ onboardingStep: 'RECONCILE', recoveryReason: 'CUSTOMER_UNRESOLVED', reconciliationRequired: true, checkoutAvailable: false });
    }
  });
  it('the latest customer EMAIL_CONFLICT failure returns its recorded reason', async () => {
    audits.push(fact(7, 'CUSTOMER_CREATE_RESERVED', {}), fact(8, 'CUSTOMER_CREATE_FAILED', { reservationId: 7, code: 'EMAIL_CONFLICT' }));
    expect(await getBillingLifecycle(actor, deps)).toMatchObject({ onboardingStep: 'RECONCILE', recoveryReason: 'EMAIL_CONFLICT', reconciliationRequired: true, checkoutAvailable: false });
  });
  it.each(['CUSTOMER_CREATE', 'CHECKOUT'])('a proven non-conflict %s failure permits another selection', async operation => {
    audits.push(fact(7, `${operation}_RESERVED`, {}), fact(8, `${operation}_FAILED`, { reservationId: 7, code: 'REJECTED' }));
    expect(await getBillingLifecycle(actor, deps)).toMatchObject({ onboardingStep: 'CHOOSE_PLAN', recoveryReason: null, reconciliationRequired: false });
  });
  it('a newer successful customer reservation supersedes an older email conflict', async () => {
    audits.push(fact(7, 'CUSTOMER_CREATE_RESERVED', {}), fact(8, 'CUSTOMER_CREATE_FAILED', { reservationId: 7, code: 'EMAIL_CONFLICT' }),
      fact(9, 'CUSTOMER_CREATE_RESERVED', {}), fact(10, 'CUSTOMER_CREATE_READY', { reservationId: 9, customerId }));
    expect(await getBillingLifecycle(actor, deps)).toMatchObject({ onboardingStep: 'CHOOSE_PLAN', recoveryReason: null, reconciliationRequired: false });
  });
  it.each([null, { id: customerId, companyId: 99 }, { id: 'ctm_foreign', companyId: 42 }])('a missing/mismatched canonical customer requires reconciliation: %#', async customer => {
    checkoutAudit(); m.customer.mockResolvedValue(customer);
    m.transaction.mockResolvedValue({ id: transactionId, companyId: 42, customerId, status: 'completed' });
    expect(await getBillingLifecycle(actor, deps)).toMatchObject({ onboardingStep: 'RECONCILE', recoveryReason: 'CUSTOMER_UNRESOLVED', checkoutResume: null, portalAvailable: false });
  });
  it.each([null, 'draft', 'ready'])('a prepared draft with mirror %s returns PAYMENT and the exact saved selection', async status => {
    checkoutAudit(); m.transaction.mockResolvedValue(status ? { id: transactionId, companyId: 42, customerId, status } : null);
    expect(await getBillingLifecycle(actor, deps)).toMatchObject({ onboardingStep: 'PAYMENT', recoveryReason: null, checkoutResume: { plan: 'STARTER', interval: 'month', transactionId }, reconciliationRequired: false });
  });
  it('restores a yearly PRO selection rather than deriving it from the current company plan', async () => {
    const yearlyPrice = 'pri_00000000000000000000000002';
    vi.stubEnv('PADDLE_PRICE_CATALOG_JSON', JSON.stringify([{ plan: 'PRO', interval: 'year', priceId: yearlyPrice }]));
    checkoutAudit({ plan: 'PRO', interval: 'year', priceId: yearlyPrice });
    expect(await getBillingLifecycle(actor, deps)).toMatchObject({ onboardingStep: 'PAYMENT', checkoutResume: { plan: 'PRO', interval: 'year', transactionId } });
  });
  it.each(['past_due', 'unknown', 'unrecognized'])('uncertain transaction status %s stays in RECONCILE', async status => {
    checkoutAudit(); m.transaction.mockResolvedValue({ id: transactionId, companyId: 42, customerId, status });
    expect(await getBillingLifecycle(actor, deps)).toMatchObject({ onboardingStep: 'RECONCILE', recoveryReason: 'CUSTOMER_UNRESOLVED', checkoutResume: null });
  });
  it.each([
    { reservationId: 99, transactionId, customerId }, { reservationId: 10, transactionId: 'txn_bad', customerId },
    { reservationId: 10, transactionId, customerId: 'ctm_foreign' }, { reservationId: 10, transactionId },
    { reservationId: 10, transactionId, customerId, confirmedByProvider: true },
  ])('malformed or unproven READY facts cannot resume: %#', async saved => {
    checkoutAudit(undefined, saved);
    expect(await getBillingLifecycle(actor, deps)).toMatchObject({ onboardingStep: 'RECONCILE', recoveryReason: 'CUSTOMER_UNRESOLVED', checkoutResume: null });
  });
  it('a legacy READY without a customer can resume only through its same-tenant mirror', async () => {
    checkoutAudit(undefined, { reservationId: 10, transactionId });
    m.transaction.mockResolvedValue({ id: transactionId, companyId: 42, customerId, status: 'draft' });
    expect(await getBillingLifecycle(actor, deps)).toMatchObject({ onboardingStep: 'PAYMENT', checkoutResume: { transactionId } });
  });
  it.each([{ companyId: 99 }, { customerId: 'ctm_foreign' }, { id: 'txn_foreign' }])('foreign paid mirrors cannot select CONFIRMING or grant access: %#', async change => {
    checkoutAudit(); m.transaction.mockResolvedValue({ id: transactionId, companyId: 42, customerId, status: 'paid', ...change });
    expect(await getBillingLifecycle(actor, deps)).toMatchObject({ onboardingStep: 'RECONCILE', recoveryReason: 'CUSTOMER_UNRESOLVED', checkoutResume: null, workspaceAccessAllowed: false });
  });
  it('an unrelated paid mirror cannot override a missing READY', async () => {
    checkoutAudit(undefined, null); m.transaction.mockResolvedValue({ id: transactionId, companyId: 42, customerId, status: 'paid' });
    expect(await getBillingLifecycle(actor, deps)).toMatchObject({ onboardingStep: 'RECONCILE', recoveryReason: 'CUSTOMER_UNRESOLVED' });
    expect(m.transaction).not.toHaveBeenCalled();
  });
  it('a proven canceled draft permits selection again', async () => {
    checkoutAudit(); audits.push(fact(12, 'CHECKOUT_CANCELED', { reservationId: 10, transactionId }));
    expect(await getBillingLifecycle(actor, deps)).toMatchObject({ onboardingStep: 'CHOOSE_PLAN', recoveryReason: null, checkoutResume: null, reconciliationRequired: false });
  });
  it('a same-tenant canceled mirror also clears a prepared hold', async () => {
    checkoutAudit(); m.transaction.mockResolvedValue({ id: transactionId, companyId: 42, customerId, status: 'canceled' });
    expect(await getBillingLifecycle(actor, deps)).toMatchObject({ onboardingStep: 'CHOOSE_PLAN', recoveryReason: null, reconciliationRequired: false });
  });
  it('evaluates the correlated subscription returned in the DTO when it changes during the read', async () => {
    linked(); m.subscription.mockResolvedValueOnce(qualifiedSubscription()).mockResolvedValueOnce({ ...qualifiedSubscription(), status: 'canceled' });
    expect(await getBillingLifecycle(actor, deps)).toMatchObject({ onboardingStep: 'ACCOUNT', workspaceAccessAllowed: false, subscription: { status: 'canceled' } });
  });
  it('propagates reservation database failures rather than manufacturing a safe next step', async () => {
    m.auditMany.mockRejectedValue(new Error('fixture database read failed')); checkoutAudit();
    await expect(getBillingLifecycle(actor, deps)).rejects.toThrow('fixture database read failed');
  });
});
