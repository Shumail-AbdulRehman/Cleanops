import type { Customer } from '@paddle/paddle-node-sdk';
import { prisma } from '../prisma/prisma.js';
import { ApiError } from '../utils/ApiError.js';
import { billingProvider, BillingProviderError, type BillingProvider } from './billingProvider.js';
import { recordBillingReservationFact, reserveBillingOperation } from './billingReservations.service.js';
import type { VerificationActor } from './verification-v2/authorization.service.js';
import type { VerificationTransaction } from './verification-v2/transaction.js';

type Deps = {
    db?: typeof prisma;
    provider?: Pick<BillingProvider, 'customers'>;
    now?: () => Date;
};
const unresolved = () => new ApiError(503, 'Billing account provisioning needs reconciliation.', [{ code: 'CUSTOMER_UNRESOLVED' }]);
const emailConflict = () => new ApiError(409, 'The billing email is already associated with another account.', [{ code: 'EMAIL_CONFLICT' }]);
const sameEmail = (left: string, right: string) => left.toLowerCase() === right.toLowerCase();
const validCustomer = (customer: Customer) => /^ctm_[a-z0-9]{26}$/.test(customer.id) && customer.status === 'active';
const verified = (owner: { emailVerifiedAt: Date | null }) => process.env.PADDLE_ENVIRONMENT === 'sandbox' || !!owner.emailVerifiedAt;

async function ownerAccount(actor: VerificationActor, tx: Pick<VerificationTransaction, 'manager'>) {
    if (actor.role !== 'ADMIN') throw new ApiError(403, 'Company owner access required');
    const owner = await tx.manager.findFirst({
        where: { id: actor.id, companyId: actor.companyId, role: 'ADMIN', isActive: true },
        select: { id: true, email: true, name: true, emailVerifiedAt: true, company: true },
    });
    if (!owner || owner.id !== actor.id || owner.company.id !== actor.companyId) throw new ApiError(403, 'Active company owner required');
    return owner;
}

/** Ensure a single company-scoped customer. Uncertain writes remain reserved;
 * recovery of existing holds belongs to the reconciliation service.
 */
export async function ensureBillingCustomer(actor: VerificationActor, deps: Deps = {}): Promise<string> {
    const db = deps.db ?? prisma, provider = deps.provider ?? billingProvider;
    // The facts service acquires the Company lock before either read below.
    const { reservation, owner } = await db.$transaction(async tx => {
        const reservation = await reserveBillingOperation(actor, 'CUSTOMER_CREATE', {}, { ...deps, tx });
        const owner = await ownerAccount(actor, tx);
        if ('existingCustomerId' in reservation) {
            const mirror = await tx.paddleCustomer.findUnique({ where: { id: reservation.existingCustomerId } });
            if (!mirror || mirror.id !== reservation.existingCustomerId || mirror.companyId !== actor.companyId) throw unresolved();
        }
        return { reservation, owner };
    });
    if ('existingCustomerId' in reservation) return reservation.existingCustomerId;
    if (!('reservationId' in reservation)) throw unresolved();
    const { reservationId } = reservation;
    const failed = (code: string) => recordBillingReservationFact(actor, { action: 'CUSTOMER_CREATE_FAILED', reservationId, code }, deps);
    let customer: Customer;
    let adopted = false;
    try {
        customer = await provider.customers.create({
            email: owner.email, name: owner.name,
            customData: { companyId: actor.companyId, customerReservationId: reservationId },
        });
    } catch (error) {
        if (!(error instanceof BillingProviderError)) throw unresolved();
        if (error.classification === 'REJECTED' || error.classification === 'RATE_LIMITED') {
            await failed(error.providerCode ?? error.classification);
            throw new ApiError(503, 'Billing is unavailable. Please try again later.');
        }
        if (error.classification !== 'CUSTOMER_EXISTS') throw unresolved();
        // Never trust an ID parsed from provider error detail. Confirm through
        // the exact email filter, explicitly including archived customers.
        let matches: Awaited<ReturnType<BillingProvider['customers']['list']>>;
        try { matches = await provider.customers.list({ email: owner.email, status: ['active', 'archived'] }); }
        catch { throw unresolved(); }
        if (matches.hasMore) throw unresolved();
        if (matches.data.length !== 1 || !validCustomer(matches.data[0]) ||
            !sameEmail(matches.data[0].email, owner.email) || !verified(owner)) {
            await failed('EMAIL_CONFLICT');
            throw emailConflict();
        }
        customer = matches.data[0];
        adopted = true;
    }
    if (!validCustomer(customer) || !sameEmail(customer.email, owner.email)) throw unresolved();
    const updatedAt = new Date(customer.updatedAt), createdAt = new Date(customer.createdAt);
    if (!Number.isFinite(+updatedAt) || !Number.isFinite(+createdAt)) throw unresolved();

    const linked = await db.$transaction(async tx => {
        await tx.$queryRaw`SELECT id FROM "Company" WHERE id=${actor.companyId} FOR UPDATE`;
        const fresh = await ownerAccount(actor, tx);
        if (!fresh.company.isActive || fresh.company.operationalStatus !== 'ACTIVE') throw new ApiError(403, 'Company operations are suspended');
        const mirror = await tx.paddleCustomer.findUnique({ where: { id: customer.id } });
        const companyMirror = await tx.paddleCustomer.findUnique({ where: { companyId: actor.companyId } });
        const canonical = await tx.company.findUnique({ where: { billingCustomerId: customer.id }, select: { id: true } });
        if (!sameEmail(fresh.email, owner.email) || !verified(fresh) ||
            (fresh.company.billingCustomerId && fresh.company.billingCustomerId !== customer.id) ||
            (mirror?.companyId != null && mirror.companyId !== actor.companyId) ||
            (companyMirror && companyMirror.id !== customer.id) ||
            (canonical && canonical.id !== actor.companyId) || (adopted && mirror?.status === 'archived')) {
            if (!adopted) throw unresolved();
            // Return instead of throwing so the failure fact commits.
            await recordBillingReservationFact(actor, { action: 'CUSTOMER_CREATE_FAILED', reservationId, code: 'EMAIL_CONFLICT' }, { ...deps, tx });
            return false;
        }
        // Preserve newer webhook fields when attaching an existing mirror.
        await tx.paddleCustomer.upsert({ where: { id: customer.id },
            create: { id: customer.id, companyId: actor.companyId, email: customer.email, name: customer.name, status: customer.status,
                paddleUpdatedAt: updatedAt, lastEventAt: updatedAt, paddleCreatedAt: createdAt },
            update: { companyId: actor.companyId },
        });
        await tx.company.update({ where: { id: actor.companyId }, data: { billingCustomerId: customer.id } });
        await recordBillingReservationFact(actor, { action: 'CUSTOMER_CREATE_READY', reservationId, customerId: customer.id,
            ...(adopted ? { adopted: true } : {}) }, { ...deps, tx });
        return true;
    });
    if (!linked) throw emailConflict();
    return customer.id;
}
