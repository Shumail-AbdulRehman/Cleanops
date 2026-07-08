import type { Customer, Transaction } from '@paddle/paddle-node-sdk';
import { prisma } from '../prisma/prisma.js';
import { configuredEntryForPrice } from '../config/paddle.js';
import type { BillingReconcileOutcome } from '../types/billingLifecycle.js';
import { ApiError } from '../utils/ApiError.js';
import { billingProvider, BILLING_PROVIDER_MAX_PAGES, type BillingProvider } from './billingProvider.js';
import { readBillingReservation, recordBillingReservationFact, type BillingReservationState } from './billingReservations.service.js';
import type { VerificationActor } from './verification-v2/authorization.service.js';
import type { VerificationTransaction } from './verification-v2/transaction.js';

export const BILLING_RECONCILE_MAX_PAGES = 10;
type Deps = {
    db?: typeof prisma;
    provider?: { customers: Pick<BillingProvider['customers'], 'list'>; transactions: Pick<BillingProvider['transactions'], 'list'> };
    now?: () => Date;
};
const object = (value: unknown): Record<string, unknown> =>
    value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const customerIdValid = (id: unknown): id is string => typeof id === 'string' && /^ctm_[a-z0-9]{26}$/.test(id);
const transactionIdValid = (id: unknown): id is string => typeof id === 'string' && /^txn_[a-z0-9]{26}$/.test(id);
const sameEmail = (left: string, right: string) => left.toLowerCase() === right.toLowerCase();
const paid = (status: string) => ['paid', 'billed', 'completed'].includes(status);
const validDates = (entity: Customer | Transaction) =>
    Number.isFinite(+new Date(entity.createdAt)) && Number.isFinite(+new Date(entity.updatedAt));

async function ownerAccount(actor: VerificationActor, tx: VerificationTransaction) {
    if (actor.role !== 'ADMIN') throw new ApiError(403, 'Company owner access required');
    const owner = await tx.manager.findFirst({ where: { id: actor.id, companyId: actor.companyId, role: 'ADMIN', isActive: true },
        select: { id: true, email: true, emailVerifiedAt: true, company: true } });
    if (!owner || owner.id !== actor.id || owner.company.id !== actor.companyId) throw new ApiError(403, 'Active company owner required');
    if (!owner.company.isActive || owner.company.operationalStatus !== 'ACTIVE') throw new ApiError(403, 'Company operations are suspended');
    return owner;
}

async function lockedState(actor: VerificationActor, tx: VerificationTransaction, deps: Deps) {
    await tx.$queryRaw`SELECT id FROM "Company" WHERE id=${actor.companyId} FOR UPDATE`;
    const owner = await ownerAccount(actor, tx);
    const customer = await readBillingReservation(owner.company, 'CUSTOMER_CREATE', { ...deps, tx });
    const checkout = await readBillingReservation(owner.company, 'CHECKOUT', { ...deps, tx });
    return { owner, customer, checkout };
}
type State = Awaited<ReturnType<typeof lockedState>>;

async function settledOutcome(state: State, tx: VerificationTransaction): Promise<BillingReconcileOutcome> {
    if (state.customer.kind === 'inProgress' || state.checkout.kind === 'inProgress') return 'IN_PROGRESS';
    if (state.customer.kind === 'reconcile' || state.checkout.kind === 'reconcile') return 'UNRESOLVED';
    if (state.customer.kind === 'closed' && state.customer.fact.action === 'CUSTOMER_CREATE_FAILED' &&
        object(state.customer.fact.newValue).code === 'EMAIL_CONFLICT') return 'CONFLICT';
    if (state.checkout.kind !== 'closed' || state.checkout.fact.action !== 'CHECKOUT_READY') return 'CLEARED';
    const saved = object(state.checkout.fact.newValue);
    const mirror = await tx.paddleTransaction.findFirst({ where: { id: String(saved.transactionId) } });
    if (mirror && (mirror.companyId !== state.owner.company.id || mirror.customerId !== state.owner.company.billingCustomerId)) return 'UNRESOLVED';
    if (mirror && paid(mirror.status)) return 'PAID';
    if (mirror?.status === 'canceled') return 'CLEARED';
    return !mirror || ['draft', 'ready'].includes(mirror.status) ? 'RESUMABLE' : 'UNRESOLVED';
}

/** Repair only existing reservations. No provider writes, subscription writes or
 * access grants occur here. Route composition adds the fresh lifecycle DTO.
 */
export async function reconcileBillingReservations(actor: VerificationActor, deps: Deps = {}): Promise<BillingReconcileOutcome> {
    const db = deps.db ?? prisma, provider = deps.provider ?? billingProvider;
    const before = await db.$transaction(async tx => {
        const state = await lockedState(actor, tx, deps);
        // Leave every reservation alone while either provider write is in flight.
        if (state.customer.kind === 'inProgress' || state.checkout.kind === 'inProgress') return { outcome: 'IN_PROGRESS' as const };
        if (state.customer.kind === 'reconcile') return { state, operation: 'CUSTOMER_CREATE' as const, reservation: state.customer.reservation };
        if (state.checkout.kind === 'reconcile') return { state, operation: 'CHECKOUT' as const, reservation: state.checkout.reservation };
        return { outcome: await settledOutcome(state, tx) };
    });
    if (before.outcome !== undefined) return before.outcome;
    const { operation, reservation } = before;

    // Provider reads run outside the database transaction. Recheck the hold and
    // owner under the same company lock before persisting any evidence.
    const finish = (apply: (tx: VerificationTransaction, state: State) => Promise<BillingReconcileOutcome>) =>
        db.$transaction(async tx => {
            const state = await lockedState(actor, tx, deps);
            const current: BillingReservationState = operation === 'CUSTOMER_CREATE' ? state.customer : state.checkout;
            if (current.kind !== 'reconcile' || current.reservation.id !== reservation.id) return settledOutcome(state, tx);
            if (state.owner.email !== before.state.owner.email ||
                state.owner.company.billingCustomerId !== before.state.owner.company.billingCustomerId) return 'UNRESOLVED';
            return apply(tx, state);
        });
    const failed = (tx: VerificationTransaction, code: string) => recordBillingReservationFact(actor,
        { action: operation === 'CUSTOMER_CREATE' ? 'CUSTOMER_CREATE_FAILED' : 'CHECKOUT_FAILED', reservationId: reservation.id, code }, { ...deps, tx });

    if (operation === 'CUSTOMER_CREATE') {
        let listing: Awaited<ReturnType<BillingProvider['customers']['list']>>;
        try { listing = await provider.customers.list({ email: before.state.owner.email, status: ['active', 'archived'] }); }
        catch { return 'UNRESOLVED'; }
        if (listing.hasMore || listing.data.length > 1) return 'UNRESOLVED';
        return finish(async (tx, state) => {
            if (!listing.data.length) { await failed(tx, 'NOT_FOUND'); return 'CLEARED'; }
            const customer = listing.data[0], metadata = object(customer.customData);
            const correlated = metadata.customerReservationId === reservation.id;
            const legacy = metadata.customerReservationId == null && (metadata.companyId == null || metadata.companyId === actor.companyId);
            const allowedAdoption = process.env.PADDLE_ENVIRONMENT === 'sandbox' || !!state.owner.emailVerifiedAt;
            const conflict = async (): Promise<BillingReconcileOutcome> => { await failed(tx, 'EMAIL_CONFLICT'); return 'CONFLICT'; };
            if (!customerIdValid(customer.id) || customer.status !== 'active' || !sameEmail(customer.email, state.owner.email) ||
                (metadata.companyId != null && metadata.companyId !== actor.companyId) ||
                (!correlated && (!legacy || !allowedAdoption))) return conflict();
            if (!validDates(customer)) return 'UNRESOLVED';
            const mirror = await tx.paddleCustomer.findUnique({ where: { id: customer.id } });
            const companyMirror = await tx.paddleCustomer.findUnique({ where: { companyId: actor.companyId } });
            const canonical = await tx.company.findUnique({ where: { billingCustomerId: customer.id }, select: { id: true } });
            if ((state.owner.company.billingCustomerId && state.owner.company.billingCustomerId !== customer.id) ||
                (mirror?.companyId != null && mirror.companyId !== actor.companyId) || mirror?.status === 'archived' ||
                (companyMirror && companyMirror.id !== customer.id) || (canonical && canonical.id !== actor.companyId)) return conflict();
            // Match spec 17's atomic linkage and preserve newer webhook fields.
            await tx.paddleCustomer.upsert({ where: { id: customer.id },
                create: { id: customer.id, companyId: actor.companyId, email: customer.email, name: customer.name, status: customer.status,
                    paddleUpdatedAt: new Date(customer.updatedAt), lastEventAt: new Date(customer.updatedAt), paddleCreatedAt: new Date(customer.createdAt) },
                update: { companyId: actor.companyId } });
            await tx.company.update({ where: { id: actor.companyId }, data: { billingCustomerId: customer.id } });
            await recordBillingReservationFact(actor, { action: 'CUSTOMER_CREATE_READY', reservationId: reservation.id, customerId: customer.id,
                ...(!correlated ? { adopted: true } : {}) }, { ...deps, tx });
            return settledOutcome({ ...state, customer: { kind: 'none' } }, tx);
        });
    }

    const customerId = before.state.owner.company.billingCustomerId;
    if (!customerIdValid(customerId)) return 'UNRESOLVED';
    const matches: Transaction[] = [], seen = new Set<string>();
    let after: string | undefined, complete = false;
    // The shared gateway caps each list at five pages. Continue with its last
    // row's cursor, allowing at most ten provider pages across both calls.
    for (let pages = 0; pages + BILLING_PROVIDER_MAX_PAGES <= BILLING_RECONCILE_MAX_PAGES; pages += BILLING_PROVIDER_MAX_PAGES) {
        let listing: Awaited<ReturnType<BillingProvider['transactions']['list']>>;
        try { listing = await provider.transactions.list({ customerId: [customerId], orderBy: 'id[ASC]', ...(after ? { after } : {}) }); }
        catch { return 'UNRESOLVED'; }
        for (const transaction of listing.data) {
            if (!transactionIdValid(transaction.id) || seen.has(transaction.id) || transaction.customerId !== customerId) return 'UNRESOLVED';
            seen.add(transaction.id);
            if (object(transaction.customData).checkoutReservationId === reservation.id) matches.push(transaction);
        }
        if (matches.length > 1) return 'UNRESOLVED';
        if (!listing.hasMore) { complete = true; break; }
        after = listing.data.at(-1)?.id;
        if (!after) return 'UNRESOLVED';
    }
    if (!complete) return 'UNRESOLVED';
    return finish(async (tx, state) => {
        if (!matches.length) { await failed(tx, 'NOT_FOUND'); return 'CLEARED'; }
        const transaction = matches[0], requested = object(reservation.newValue), metadata = object(transaction.customData);
        const entry = typeof requested.priceId === 'string' ? configuredEntryForPrice(requested.priceId) : undefined;
        if (!entry || entry.plan !== requested.plan || entry.interval !== requested.interval ||
            (metadata.companyId != null && metadata.companyId !== actor.companyId) || transaction.items.length !== 1 ||
            transaction.items[0].quantity !== 1 || transaction.items[0].price?.id !== entry.priceId || !validDates(transaction)) return 'UNRESOLVED';
        const known = await tx.paddleTransaction.findFirst({ where: { id: transaction.id } });
        if (known && (known.companyId !== actor.companyId || known.customerId !== customerId)) return 'UNRESOLVED';
        // A newer webhook version takes precedence over this provider snapshot.
        const status = known && +known.paddleUpdatedAt >= +new Date(transaction.updatedAt) ? known.status : transaction.status;
        if (status === 'canceled') {
            await recordBillingReservationFact(actor, { action: 'CHECKOUT_CANCELED', reservationId: reservation.id, transactionId: transaction.id }, { ...deps, tx });
            return 'CLEARED';
        }
        if (!['draft', 'ready'].includes(status) && !paid(status)) return 'UNRESOLVED';
        const customerMirror = await tx.paddleCustomer.findUnique({ where: { id: customerId } });
        if (!customerMirror || customerMirror.companyId !== actor.companyId) return 'UNRESOLVED';
        // A local transaction mirror is evidence for resume/confirm only. Do not
        // link a subscription or change company access from reconciliation.
        const fields = { companyId: actor.companyId, customerId, status: transaction.status, currencyCode: transaction.currencyCode,
            total: transaction.details?.totals?.grandTotal, invoiceNumber: transaction.invoiceNumber,
            paddleCreatedAt: new Date(transaction.createdAt), paddleUpdatedAt: new Date(transaction.updatedAt), lastEventAt: new Date(transaction.updatedAt) };
        await tx.paddleTransaction.upsert({ where: { id: transaction.id }, create: { id: transaction.id, ...fields },
            update: known && +known.paddleUpdatedAt >= +new Date(transaction.updatedAt) ? {} : fields });
        await recordBillingReservationFact(actor, { action: 'CHECKOUT_READY', reservationId: reservation.id,
            transactionId: transaction.id, customerId, confirmedByProvider: true }, { ...deps, tx });
        return paid(status) ? 'PAID' : 'RESUMABLE';
    });
}
