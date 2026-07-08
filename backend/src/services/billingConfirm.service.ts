import type { Subscription, Transaction } from '@paddle/paddle-node-sdk';
import { prisma } from '../prisma/prisma.js';
import { configuredEntryForPrice } from '../config/paddle.js';
import { ApiError } from '../utils/ApiError.js';
import { operationalLog } from '../utils/operationalLog.js';
import type { BillingConfirmDto, BillingConfirmOutcome } from '../types/billingLifecycle.js';
import { billingProvider, type BillingProvider } from './billingProvider.js';
import { readBillingReservation } from './billingReservations.service.js';
import { getBillingLifecycle } from './billingLifecycle.service.js';
import { applyPaddleSubscription } from './paddleFulfillment.service.js';
import type { VerificationActor } from './verification-v2/authorization.service.js';
import type { VerificationTransaction } from './verification-v2/transaction.js';

type Deps = {
    db?: typeof prisma;
    provider?: Pick<BillingProvider, 'transactions' | 'subscriptions'>;
    now?: () => Date;
    log?: typeof operationalLog;
};
const object = (value: unknown): Record<string, unknown> =>
    value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const unavailable = () => new ApiError(503, 'Billing confirmation is unavailable. Please keep waiting and try again.');

async function ownerAccount(actor: VerificationActor, db: Pick<VerificationTransaction, 'manager'>) {
    if (actor.role !== 'ADMIN') throw new ApiError(403, 'Company owner access required');
    const owner = await db.manager.findFirst({
        where: { id: actor.id, companyId: actor.companyId, role: 'ADMIN', isActive: true },
        select: { id: true, company: true },
    });
    if (!owner || owner.id !== actor.id || owner.company.id !== actor.companyId) throw new ApiError(403, 'Active company owner required');
    return owner;
}

function transactionMismatch(transaction: Transaction, expected: { transactionId: string; customerId: string; reservationId: number; companyId: number; priceId: string }) {
    if (transaction.id !== expected.transactionId) return 'TRANSACTION_ID_MISMATCH';
    if (transaction.customerId !== expected.customerId) return 'TRANSACTION_CUSTOMER_MISMATCH';
    const metadata = object(transaction.customData);
    if (metadata.checkoutReservationId !== expected.reservationId ||
        (metadata.companyId !== undefined && metadata.companyId !== expected.companyId)) return 'TRANSACTION_RESERVATION_MISMATCH';
    if (transaction.items.length !== 1 || transaction.items[0].quantity !== 1) return 'TRANSACTION_ITEMS_MISMATCH';
    const priceId = transaction.items[0].price?.id;
    if (priceId !== expected.priceId || !configuredEntryForPrice(priceId)) return 'TRANSACTION_PRICE_MISMATCH';
    return null;
}

function subscriptionMismatch(subscription: Subscription, expected: { subscriptionId: string; customerId: string; priceId: string }) {
    if (subscription.id !== expected.subscriptionId) return 'SUBSCRIPTION_ID_MISMATCH';
    if (subscription.customerId !== expected.customerId) return 'SUBSCRIPTION_CUSTOMER_MISMATCH';
    if (subscription.items.length !== 1 || subscription.items[0].quantity !== 1 || !subscription.items[0].recurring) return 'SUBSCRIPTION_ITEMS_MISMATCH';
    const priceId = subscription.items[0].price?.id;
    if (priceId !== expected.priceId || !configuredEntryForPrice(priceId)) return 'SUBSCRIPTION_PRICE_MISMATCH';
    return null;
}

/** No client-selected transaction or tenant. Only a verified server read may
 * reach shared fulfilment; every result includes a fresh server lifecycle.
 */
export async function confirmBillingCheckout(actor: VerificationActor, deps: Deps = {}): Promise<BillingConfirmDto> {
    const db = deps.db ?? prisma, provider = deps.provider ?? billingProvider;
    const owner = await ownerAccount(actor, db), company = owner.company;
    const result = async (outcome: BillingConfirmOutcome): Promise<BillingConfirmDto> => ({
        outcome, lifecycle: await getBillingLifecycle(actor, { db, now: deps.now }),
    });
    const mismatch = (code: string, reservationId?: number) => {
        (deps.log ?? operationalLog)({ event: 'BILLING_CONFIRM_MISMATCH', providerCode: code, companyId: actor.companyId, reservationId });
        return result('PROCESSING');
    };
    // Reuse the reservation reader's tenant, closing-fact and mirror checks.
    let state;
    try { state = await readBillingReservation(company, 'CHECKOUT', { db, now: deps.now }); }
    catch (error) {
        if (error instanceof ApiError && error.statusCode === 409) return mismatch('RESERVATION_MISMATCH');
        throw error;
    }
    if (state.kind === 'none') return result('NO_CHECKOUT');
    if (state.kind !== 'closed') return mismatch('RESERVATION_NOT_READY', state.reservation.id);
    if (state.fact.action === 'CHECKOUT_FAILED') return result('NO_CHECKOUT');
    if (state.fact.action === 'CHECKOUT_CANCELED') return result('NOT_PAID');
    const saved = object(state.fact.newValue), requested = object(state.reservation.newValue);
    if (state.fact.action !== 'CHECKOUT_READY' || typeof saved.transactionId !== 'string' ||
        !company.billingCustomerId || typeof requested.priceId !== 'string') return mismatch('RESERVATION_MISMATCH', state.reservation.id);
    const expected = { transactionId: saved.transactionId, customerId: company.billingCustomerId,
        reservationId: state.reservation.id, companyId: company.id, priceId: requested.priceId };

    let transaction: Transaction;
    try { transaction = await provider.transactions.get(expected.transactionId); }
    catch { throw unavailable(); }
    const transactionCode = transactionMismatch(transaction, expected);
    if (transactionCode) return mismatch(transactionCode, expected.reservationId);
    if (['draft', 'ready', 'canceled'].includes(transaction.status)) return result('NOT_PAID');
    if (!['paid', 'billed', 'completed'].includes(transaction.status)) return mismatch('TRANSACTION_STATUS_UNKNOWN', expected.reservationId);
    if (!transaction.subscriptionId) return result('PROCESSING');
    if (!/^sub_[a-z0-9]{26}$/.test(transaction.subscriptionId)) return mismatch('SUBSCRIPTION_ID_MISMATCH', expected.reservationId);

    let subscription: Subscription;
    try { subscription = await provider.subscriptions.get(transaction.subscriptionId); }
    catch { throw unavailable(); }
    const subscriptionCode = subscriptionMismatch(subscription, { ...expected, subscriptionId: transaction.subscriptionId });
    if (subscriptionCode) return mismatch(subscriptionCode, expected.reservationId);

    try {
        const applied = await db.$transaction(async tx => {
            await tx.$queryRaw`SELECT id FROM "Company" WHERE id=${actor.companyId} FOR UPDATE`;
            const fresh = (await ownerAccount(actor, tx)).company;
            const latest = await readBillingReservation(fresh, 'CHECKOUT', { tx, now: deps.now });
            // Provider reads run outside locks. A replacement or ownership change
            // while waiting must not fulfil the previous checkout.
            if (fresh.billingCustomerId !== expected.customerId ||
                (fresh.billingSubscriptionId && fresh.billingSubscriptionId !== subscription.id) ||
                latest.kind !== 'closed' || latest.fact.action !== 'CHECKOUT_READY' ||
                latest.reservation.id !== expected.reservationId || object(latest.fact.newValue).transactionId !== expected.transactionId ||
                object(latest.reservation.newValue).priceId !== expected.priceId) return false;
            // Compose the shared entry point in the transaction holding the
            // company lock. Its callback API is used; no nested SQL transaction.
            const sameTransaction = {
                $transaction: async (run: (client: VerificationTransaction) => Promise<void>) => run(tx),
            } as Pick<typeof prisma, '$transaction'>;
            await applyPaddleSubscription(subscription, { companyId: company.id, customerId: expected.customerId }, sameTransaction);
            return true;
        });
        if (!applied) return mismatch('RESERVATION_CHANGED', expected.reservationId);
    } catch (error) {
        if (error instanceof ApiError && [400, 409].includes(error.statusCode)) return mismatch('FULFILLMENT_MISMATCH', expected.reservationId);
        throw error;
    }
    const confirmed = await result('PROCESSING');
    if (confirmed.lifecycle.workspaceAccessAllowed === true) confirmed.outcome = 'ACTIVE';
    return confirmed;
}
