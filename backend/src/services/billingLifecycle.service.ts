import type { Paddle } from '@paddle/paddle-node-sdk';
import { z } from 'zod';
import { prisma } from '../prisma/prisma.js';
import { ApiError } from '../utils/ApiError.js';
import { requireBillingActivation, configuredEntryForPrice, getPaddleCheckoutUrl } from '../config/paddle.js';
import { PLAN_DEFINITIONS } from './subscription.service.js';
import { readAccountState, evaluateAccountAccess } from './accountAccess.service.js';
import { decideBillingOnboardingStep } from './billingOnboardingStep.js';
import { inspectBillingCheckout, readBillingReservation } from './billingReservations.service.js';
import { billingProvider } from './billingProvider.js';
import type { BillingLifecycleDto } from '../types/billingLifecycle.js';
import type { VerificationActor } from './verification-v2/authorization.service.js';

// Keep existing route imports working; these modules own the implementation.
export { getBillingCatalog } from './billingCatalog.service.js';
export { createBillingCheckout } from './billingCheckout.service.js';

type Db = typeof prisma;
type Deps = { now?: () => Date; db?: Db; provider?: () => Pick<Paddle, 'customerPortalSessions'> };
const unavailable = () => new ApiError(503, 'Billing is unavailable. Please try again later.');
const conflict = (message: string) => new ApiError(409, message);
async function ownerAccount(actor: VerificationActor, db: Pick<Db, 'manager'>) {
    if (actor.role !== 'ADMIN') throw new ApiError(403, 'Company owner access required');
    const owner = await db.manager.findFirst({ where: { id: actor.id, companyId: actor.companyId, role: 'ADMIN', isActive: true },
        select: { id: true, name: true, email: true, emailVerifiedAt: true, company: true } });
    if (!owner || owner.id !== actor.id || owner.company.id !== actor.companyId) throw new ApiError(403, 'Active company owner required');
    return owner;
}
// Sandbox onboarding deliberately skips email verification; live checkout still requires it.
const verificationSatisfied = (owner: { emailVerifiedAt: Date | null }) => process.env.PADDLE_ENVIRONMENT === 'sandbox' || !!owner.emailVerifiedAt;
function activated() { try { requireBillingActivation(); } catch { throw unavailable(); } }
function provider(deps: Deps) { try { return deps.provider ? deps.provider() : billingProvider; } catch { throw unavailable(); } }
async function callProvider<T>(call: () => Promise<T>) {
    try { return await call(); } catch { throw unavailable(); }
}

export async function getBillingLifecycle(actor: VerificationActor, deps: Deps = {}): Promise<BillingLifecycleDto> {
    const db = deps.db ?? prisma, owner = await ownerAccount(actor, db);
    const account = await readAccountState(actor.companyId, db), company = account.company;
    if (company.id !== actor.companyId) throw new ApiError(403, 'Company owner access required');
    let enabled = false; try { requireBillingActivation(); enabled = true; } catch { /* Sanitized capability only. */ }
    let checkoutConfigured = false; try { getPaddleCheckoutUrl(); checkoutConfigured = true; } catch { /* Catalog reads remain available. */ }
    const rawSubscription = company.billingSubscriptionId && company.billingCustomerId
        ? await db.paddleSubscription.findFirst({ where: { id: company.billingSubscriptionId, companyId: company.id, customerId: company.billingCustomerId } }) : null;
    const subscription = rawSubscription && rawSubscription.id === company.billingSubscriptionId && rawSubscription.companyId === company.id && rawSubscription.customerId === company.billingCustomerId ? rawSubscription : null;
    const entry = subscription ? configuredEntryForPrice(subscription.priceId) : undefined;
    const customer = company.billingCustomerId ? await db.paddleCustomer.findFirst({ where: { id: company.billingCustomerId, companyId: company.id } }) : null;
    const customerLinked = !!customer && customer.id === company.billingCustomerId && customer.companyId === company.id;
    const local = { db, now: deps.now };
    const customerReservation = await readBillingReservation(company, 'CUSTOMER_CREATE', local);
    const checkoutReservation = await readBillingReservation(company, 'CHECKOUT', local);
    const checkout = await inspectBillingCheckout(company, local);
    const recordedConflict = customerReservation.kind === 'closed' && customerReservation.fact.action === 'CUSTOMER_CREATE_FAILED' &&
        (customerReservation.fact.newValue as { code?: string } | null)?.code === 'EMAIL_CONFLICT' ? 'EMAIL_CONFLICT' : null;
    const reconciliationRequired = (!!company.billingCustomerId && !customerLinked) || recordedConflict !== null ||
        customerReservation.kind === 'inProgress' || customerReservation.kind === 'reconcile' ||
        ['pending', 'inProgress', 'reconcile'].includes(checkout.kind);
    // READY has already been validated by the shared reservation reader. Read
    // that exact mirror, never an unrelated/historical transaction for a tenant.
    const saved = checkoutReservation.kind === 'closed' && checkoutReservation.fact.action === 'CHECKOUT_READY'
        ? checkoutReservation.fact.newValue as { transactionId: string } : null;
    const draft = saved && customerLinked ? await db.paddleTransaction.findFirst({ where: {
        id: saved.transactionId, companyId: company.id, customerId: company.billingCustomerId,
    } }) : null;
    const latestDraftPaid = !!draft && draft.id === saved?.transactionId && draft.companyId === company.id &&
        draft.customerId === company.billingCustomerId && ['paid', 'billed', 'completed'].includes(draft.status);
    let workspaceAccessAllowed = false;
    try {
        // Evaluate the same correlated facts returned below, not an earlier subscription read.
        evaluateAccountAccess({ company, subscription: entry?.plan === company.plan ? subscription : null }, actor.role, 'START_WORK', deps.now?.() ?? new Date());
        workspaceAccessAllowed = true;
    } catch (error) {
        if (!(error instanceof ApiError) || error.statusCode !== 403) throw error;
    }
    const checkoutReadiness = !company.isActive || company.operationalStatus !== 'ACTIVE' ? 'COMPANY_RESTRICTED'
        : !enabled || !checkoutConfigured ? 'BILLING_DISABLED'
        : !verificationSatisfied(owner) ? 'OWNER_VERIFICATION_REQUIRED'
        : company.billingSubscriptionId ? 'LINKED_SUBSCRIPTION'
        : reconciliationRequired ? 'RECONCILIATION_PENDING' : 'READY';
    const decision = decideBillingOnboardingStep({
        company, workspaceAccessAllowed, hasLinkedSubscription: !!company.billingSubscriptionId,
        billingConfigured: enabled,
        // Lifecycle is local. Provider price/trial validation belongs to the
        // shared catalog read and checkout preparation, not this status read.
        catalogUsable: checkoutConfigured, priceHasTrial: false,
        liveMode: process.env.PADDLE_ENVIRONMENT === 'production', ownerVerified: !!owner.emailVerifiedAt,
        latestDraftPaid, subscriptionStatusUnknown: subscription?.status === 'unknown',
        openReservation: reconciliationRequired, recordedConflict, resumableDraft: checkout.kind === 'resume',
    });
    const iso = (value: Date | null) => value instanceof Date && Number.isFinite(+value) ? value.toISOString() : null;
    return {
        company: { id: company.id, name: owner.company.name, plan: company.plan, isActive: company.isActive, operationalStatus: company.operationalStatus },
        usage: { locations: await db.location.count({ where: { companyId: company.id, isActive: true } }),
            staff: await db.staff.count({ where: { companyId: company.id, isActive: true } }), managers: await db.manager.count({ where: { companyId: company.id, isActive: true } }) },
        limits: PLAN_DEFINITIONS[company.plan].limits,
        subscription: subscription ? { status: subscription.status, plan: entry?.plan ?? null, catalogQualified: entry?.plan === company.plan,
            priceId: subscription.priceId, interval: entry?.interval ?? null,
            periodStart: iso(subscription.currentBillingPeriodStart), periodEnd: iso(subscription.currentBillingPeriodEnd),
            scheduledChangeAction: subscription.scheduledChangeAction, scheduledChangeAt: iso(subscription.scheduledChangeAt),
            lastEventAt: subscription.lastEventAt.toISOString() } : null,
        ...decision,
        workspaceAccessAllowed, checkoutReadiness,
        checkoutResume: checkoutReadiness === 'READY' && checkout.kind === 'resume' ? checkout.selection : null,
        reconciliationRequired,
        billingConfigured: enabled, ownerVerified: !!owner.emailVerifiedAt,
        billingEnvironment: enabled ? process.env.PADDLE_ENVIRONMENT as 'sandbox' | 'production' : null,
        onboardingRequired: !company.billingSubscriptionId || subscription?.status === 'unknown',
        providerState: subscription ? 'MIRRORED' : company.billingCustomerId ? 'AWAITING_PROVIDER' : 'NOT_LINKED',
        portalAvailable: enabled && customerLinked,
        checkoutAvailable: checkoutReadiness === 'READY',
    };
}

export async function createBillingPortal(actor: VerificationActor, raw: unknown, deps: Deps = {}) {
    if (!z.object({}).strict().safeParse(raw ?? {}).success) throw new ApiError(400, 'Invalid billing request');
    const db = deps.db ?? prisma, owner = await ownerAccount(actor, db); activated();
    if (!owner.company.billingCustomerId) throw conflict('No billing account is linked to this company.');
    const customer = await db.paddleCustomer.findFirst({ where: { id: owner.company.billingCustomerId, companyId: actor.companyId } });
    if (!customer) throw conflict('Billing details are awaiting synchronization.');
    const subscriptions = await db.paddleSubscription.findMany({ where: { customerId: customer.id, companyId: actor.companyId }, select: { id: true }, orderBy: { lastEventAt: 'desc' }, take: 25 });
    const session = await callProvider(() => provider(deps).customerPortalSessions.create(customer.id, subscriptions.map(sub => sub.id)));
    if (session.customerId !== customer.id) throw unavailable();
    let url: URL;
    try { url = new URL(session.urls.general.overview); } catch { throw unavailable(); }
    if (url.protocol !== 'https:' || url.username || url.password || !['customer-portal.paddle.com', 'sandbox-customer-portal.paddle.com'].includes(url.hostname)) throw unavailable();
    // Temporary bearer URL is returned only once, never persisted or logged.
    return { url: url.toString() };
}
