import type { Transaction } from '@paddle/paddle-node-sdk';
import { z } from 'zod';
import { getPaddleCheckoutUrl, requireBillingActivation } from '../config/paddle.js';
import { prisma } from '../prisma/prisma.js';
import type { BillingCheckoutDto } from '../types/billingLifecycle.js';
import { ApiError } from '../utils/ApiError.js';
import { createBillingCatalog, getBillingCatalog } from './billingCatalog.service.js';
import { ensureBillingCustomer } from './billingCustomer.service.js';
import { billingProvider, BillingProviderError, type BillingProvider } from './billingProvider.js';
import { inspectBillingCheckout, readBillingReservation, recordBillingReservationFact, reserveBillingOperation } from './billingReservations.service.js';
import type { VerificationActor } from './verification-v2/authorization.service.js';
import type { VerificationTransaction } from './verification-v2/transaction.js';

type Deps = {
    db?: typeof prisma;
    provider?: Pick<BillingProvider, 'customers' | 'products'> & {
        prices: Pick<BillingProvider['prices'], 'get'>;
        transactions: Pick<BillingProvider['transactions'], 'create' | 'get' | 'update'>;
    };
    now?: () => Date;
};
const checkoutInput = z.object({ plan: z.enum(['STARTER', 'PRO', 'ADVANCED']), interval: z.enum(['month', 'year']) }).strict();
const unresolved = () => new ApiError(503, 'Checkout needs reconciliation before another purchase can begin.', [{ code: 'CHECKOUT_UNRESOLVED' }]);
const paid = () => new ApiError(409, 'This checkout has already been paid or billed. Check its activation status.', [{ code: 'CHECKOUT_PAID' }]);
const conflict = () => new ApiError(409, 'The previous checkout needs reconciliation before another can begin.', [{ code: 'RECONCILIATION_REQUIRED' }]);
const isPaid = (status: string) => ['paid', 'billed', 'completed'].includes(status);

async function ownerAccount(actor: VerificationActor, db: Pick<VerificationTransaction, 'manager'>) {
    if (actor.role !== 'ADMIN') throw new ApiError(403, 'Company owner access required');
    const owner = await db.manager.findFirst({ where: { id: actor.id, companyId: actor.companyId, role: 'ADMIN', isActive: true },
        select: { id: true, emailVerifiedAt: true, company: true } });
    if (!owner || owner.id !== actor.id || owner.company.id !== actor.companyId) throw new ApiError(403, 'Active company owner required');
    if (!owner.company.isActive || owner.company.operationalStatus !== 'ACTIVE') throw new ApiError(403, 'Company operations are suspended');
    if (process.env.PADDLE_ENVIRONMENT !== 'sandbox' && !owner.emailVerifiedAt) throw new ApiError(403, 'Verify your account email before starting checkout');
    if (owner.company.billingSubscriptionId) throw new ApiError(409, 'Use the billing portal to manage the linked subscription.');
    return owner;
}

function correlated(transaction: Transaction, customerId: string, reservationId: number, transactionId?: string) {
    return /^txn_[a-z0-9]{26}$/.test(transaction.id) && (!transactionId || transaction.id === transactionId) &&
        transaction.customerId === customerId &&
        (transaction.customData?.checkoutReservationId == null || transaction.customData.checkoutReservationId === reservationId);
}

/** Additive until the lifecycle/route specs adopt this service. Provider writes
 * use the shared gateway; only proven failure/cancellation closes a hold.
 */
export async function createBillingCheckout(actor: VerificationActor, raw: unknown, deps: Deps = {}): Promise<BillingCheckoutDto> {
    const parsed = checkoutInput.safeParse(raw);
    if (!parsed.success) throw new ApiError(400, 'Choose an available plan and billing interval');
    const db = deps.db ?? prisma, provider = deps.provider ?? billingProvider;
    await ownerAccount(actor, db);
    try { requireBillingActivation(); getPaddleCheckoutUrl(); }
    catch { throw new ApiError(503, 'Billing is unavailable. Please try again later.'); }
    const catalog = await (deps.db || deps.provider || deps.now ? createBillingCatalog(deps) : getBillingCatalog)(actor);
    const selected = catalog.find(entry => entry.plan === parsed.data.plan && entry.interval === parsed.data.interval);
    if (!selected) throw new ApiError(400, 'Choose an available plan and billing interval');
    const customerId = await ensureBillingCustomer(actor, { ...deps, provider });

    // Keep the lock through the read/cancel and the new reservation. Without it,
    // two replacements could both cancel the same draft and purchase separately.
    // Two bounded provider calls need more than Prisma's default transaction budget.
    const prepared = await db.$transaction(async (tx): Promise<{ ready: BillingCheckoutDto } | { reservationId: number; replaced: boolean }> => {
        await tx.$queryRaw`SELECT id FROM "Company" WHERE id=${actor.companyId} FOR UPDATE`;
        const owner = await ownerAccount(actor, tx), company = owner.company;
        if (company.billingCustomerId !== customerId) throw conflict();
        const locked = { ...deps, tx };
        const state = await readBillingReservation(company, 'CHECKOUT', locked);
        let replaced = false;
        if (state.kind === 'closed' && state.fact.action === 'CHECKOUT_READY') {
            const saved = state.fact.newValue as { transactionId: string };
            const known = await tx.paddleTransaction.findFirst({ where: { id: saved.transactionId } });
            // The facts reader has already established tenant/customer correlation.
            if (known && isPaid(known.status)) throw paid();
            const inspection = await inspectBillingCheckout(company, locked);
            if (inspection.kind !== 'resume' && inspection.kind !== 'canceled') throw conflict();
            let draft: Transaction;
            try { draft = await provider.transactions.get(saved.transactionId); }
            catch { throw unresolved(); }
            if (!correlated(draft, customerId, state.reservation.id, saved.transactionId)) throw unresolved();
            if (isPaid(draft.status)) throw paid();
            if (draft.subscriptionId) throw conflict();
            const selection = state.reservation.newValue as { plan: string; interval: string };
            const same = selection.plan === selected.plan && selection.interval === selected.interval;
            if (draft.status === 'draft' || draft.status === 'ready') {
                if (same) return { ready: { transactionId: draft.id, reused: true, replaced: false } };
                let canceled: Transaction;
                try { canceled = await provider.transactions.update(draft.id, { status: 'canceled' }); }
                catch { throw unresolved(); }
                if (!correlated(canceled, customerId, state.reservation.id, draft.id)) throw unresolved();
                if (isPaid(canceled.status)) throw paid();
                if (canceled.status !== 'canceled' || canceled.subscriptionId) throw unresolved();
            } else if (draft.status !== 'canceled') throw unresolved();
            await recordBillingReservationFact(actor, { action: 'CHECKOUT_CANCELED', reservationId: state.reservation.id,
                transactionId: draft.id }, locked);
            replaced = !same;
        }
        const reservation = await reserveBillingOperation(actor, 'CHECKOUT', selected, locked);
        if (!('reservationId' in reservation)) throw conflict();
        return { reservationId: reservation.reservationId, replaced };
    }, { timeout: 40_000 });
    if ('ready' in prepared) return prepared.ready;

    let transaction: Transaction;
    try {
        transaction = await provider.transactions.create({ collectionMode: 'automatic', customerId,
            items: [{ priceId: selected.priceId, quantity: 1 }],
            customData: { checkoutReservationId: prepared.reservationId } });
    } catch (error) {
        if (error instanceof BillingProviderError && ['REJECTED', 'RATE_LIMITED'].includes(error.classification)) {
            await recordBillingReservationFact(actor, { action: 'CHECKOUT_FAILED', reservationId: prepared.reservationId,
                code: error.providerCode ?? error.classification }, deps);
            throw new ApiError(503, 'Billing is unavailable. Please try again later.');
        }
        throw unresolved();
    }
    if (!correlated(transaction, customerId, prepared.reservationId) || transaction.status !== 'draft' || transaction.subscriptionId) throw unresolved();
    await db.$transaction(async tx => {
        await tx.$queryRaw`SELECT id FROM "Company" WHERE id=${actor.companyId} FOR UPDATE`;
        const fresh = await ownerAccount(actor, tx);
        if (fresh.company.billingCustomerId !== customerId) throw conflict();
        await recordBillingReservationFact(actor, { action: 'CHECKOUT_READY', reservationId: prepared.reservationId,
            transactionId: transaction.id, customerId }, { ...deps, tx });
    });
    return { transactionId: transaction.id, reused: false, replaced: prepared.replaced };
}
