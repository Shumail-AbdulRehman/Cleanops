import { configuredPlanForPrice } from "../config/paddle.js";
import type { Prisma } from '@prisma/client';
import { prisma } from '../prisma/prisma.js';
import { writeAuditLog } from './auditLog.service.js';
import { ApiError } from '../utils/ApiError.js';
import { PLAN_DEFINITIONS, type LimitedResource } from './subscription.service.js';
import { subscriptionGrantsPaidAccess } from './paddleFulfillment.service.js';
import type { VerificationActor } from './verification-v2/authorization.service.js';
import type { VerificationTransaction } from './verification-v2/transaction.js';

export type AccountAction = 'READ_OPERATIONAL' | 'START_WORK' | 'MANAGE_WORK' | 'COMPLETE_WORK' | 'ADD_CAPACITY' | 'OWN_SECURITY' | 'OWNER_BILLING' | 'SUPPORT' | 'ANNOTATE_ATTENDANCE';
export type AccountRole = VerificationActor['role'] | 'SYSTEM';
type CompanyState = Pick<Prisma.CompanyGetPayload<object>, 'id' | 'plan' | 'isActive' | 'operationalStatus' | 'billingCustomerId' | 'billingSubscriptionId'>;
type SubscriptionState = Pick<Prisma.PaddleSubscriptionGetPayload<object>, 'id' | 'companyId' | 'customerId' | 'priceId' | 'status' | 'currentBillingPeriodStart' | 'currentBillingPeriodEnd' | 'canceledAt' | 'pausedAt' | 'scheduledChangeAction' | 'scheduledChangeAt'>;
export type AccountState = { company: CompanyState; subscription: SubscriptionState | null };
export type WorkEntitlement = { startedAt: Date; entitledFrom: Date; entitledUntil: Date };
const deny = (code: string, message: string) => new ApiError(403, message, [{ code }]);
const timestamp = (date: Date | null | undefined) => date instanceof Date && Number.isFinite(+date) ? +date : null;

/** Effective provider window only: no local trial clock, grace days or guessed duration. */
export function subscriptionWindow(state: AccountState) {
    const sub = state.subscription, company = state.company;
    if (!sub || sub.id !== company.billingSubscriptionId || sub.customerId !== company.billingCustomerId || sub.companyId !== company.id) return null;
    const start = timestamp(sub.currentBillingPeriodStart), end = timestamp(sub.currentBillingPeriodEnd);
    if (start === null || end === null || end <= start) return null;
    const boundaries = [end, timestamp(sub.canceledAt), timestamp(sub.pausedAt),
        ['cancel', 'pause'].includes(sub.scheduledChangeAction ?? '') ? timestamp(sub.scheduledChangeAt) : null].filter((value): value is number => value !== null);
    return { start, end: Math.min(...boundaries) };
}

export function evaluateAccountAccess(state: AccountState, role: AccountRole, action: AccountAction, now = new Date(), grant?: WorkEntitlement | null) {
    if (action === 'OWNER_BILLING') {
        if (role !== 'ADMIN') throw deny('OWNER_REQUIRED', 'Company owner access required');
        return;
    }
    if (action === 'ANNOTATE_ATTENDANCE' && role === 'SYSTEM') throw deny('PERSON_REQUIRED', 'Authenticated account required');
    if (action === 'OWN_SECURITY' || action === 'SUPPORT') {
        if (role === 'SYSTEM') throw deny('PERSON_REQUIRED', 'Authenticated account required');
        return;
    }
    if (!state.company.isActive || state.company.operationalStatus !== 'ACTIVE') throw deny('ACCOUNT_SUSPENDED', 'Company operations are suspended');
    if (action === 'READ_OPERATIONAL') return;
    if ((action === 'MANAGE_WORK' || action === 'ADD_CAPACITY') && !['ADMIN', 'MANAGER', 'SYSTEM'].includes(role)) throw deny('MANAGER_REQUIRED', 'Manager or owner access required');
    if (action === 'COMPLETE_WORK' && role !== 'STAFF') throw deny('STAFF_REQUIRED', 'Staff account required');
    const window = subscriptionWindow(state);
    const entitled = window && subscriptionGrantsPaidAccess(state.subscription!.status) && window.start <= +now && +now < window.end;
    if (entitled) return;
    // The calling completion adapter supplies a persisted own-work start, never a request claim.
    const started = timestamp(grant?.startedAt), from = timestamp(grant?.entitledFrom), until = timestamp(grant?.entitledUntil);
    if (action === 'COMPLETE_WORK' && started !== null && from !== null && until !== null && started >= from && started < until && started <= +now) return;
    throw deny('SUBSCRIPTION_REQUIRED', 'An active subscription is required to begin work or add capacity');
}

export async function readAccountState(companyId: number, tx: VerificationTransaction = prisma): Promise<AccountState> {
    const company = await tx.company.findUnique({ where: { id: companyId }, select: {
        id: true, plan: true, isActive: true, operationalStatus: true, billingCustomerId: true, billingSubscriptionId: true,
    } });
    if (!company) throw new ApiError(404, 'Company account not found');
    const subscription = company.billingSubscriptionId && company.billingCustomerId ? await tx.paddleSubscription.findFirst({ where: {
        id: company.billingSubscriptionId, companyId, customerId: company.billingCustomerId,
    } }) : null;
    return { company, subscription: subscription && configuredPlanForPrice(subscription.priceId) === company.plan ? subscription : null };
}
async function currentActor(actor: VerificationActor, tx: VerificationTransaction) {
    const where = { id: actor.id, companyId: actor.companyId, role: actor.role, isActive: true };
    const found = actor.role === 'STAFF' ? await tx.staff.findFirst({ where }) : await tx.manager.findFirst({ where });
    if (!found) throw deny('ACTIVE_ACCOUNT_REQUIRED', 'Active account required');
}
export async function assertAccountAction(actor: VerificationActor, action: Exclude<AccountAction, 'COMPLETE_WORK'>, tx: VerificationTransaction = prisma, now = new Date()) {
    await currentActor(actor, tx);
    const state = await readAccountState(actor.companyId, tx);
    evaluateAccountAccess(state, actor.role, action, now);
    return state;
}

async function startedWorkAt(actor: VerificationActor, work: { kind: 'task' | 'attendance'; id: number }, tx: VerificationTransaction, now: Date, allowSubmitted = false) {
    if (!['task', 'attendance'].includes(work.kind) || !Number.isSafeInteger(work.id) || work.id < 1) throw new ApiError(400, 'Invalid work identifier');
    const row = work.kind === 'task'
        ? await tx.taskInstance.findFirst({ where: { id: work.id, staffId: actor.id, isActive: true, location: { companyId: actor.companyId }, status: { in: ['IN_PROGRESS', 'NOT_COMPLETED_INTIME'] }, ...(allowSubmitted ? {} : {staffSubmittedAt: null}) }, select: { startedAt: true } })
        : await tx.attendance.findFirst({ where: { id: work.id, staffId: actor.id, location: { companyId: actor.companyId }, checkInTime: { not: null }, checkOutTime: null }, select: { checkInTime: true } });
    if (!row) throw new ApiError(404, 'Started work not found');
    const startedAt = 'startedAt' in row ? row.startedAt : row.checkInTime;
    if (!startedAt || +startedAt > +now) throw new ApiError(409, 'This work has not started');
    return startedAt;
}

export async function assertAccountCompletion(actor: VerificationActor, work: { kind: 'task' | 'attendance'; id: number }, tx: VerificationTransaction = prisma, now = new Date(), allowSubmitted = false) {
    if (actor.role !== 'STAFF') throw deny('STAFF_REQUIRED', 'Staff account required');
    if (!Number.isSafeInteger(work.id) || work.id < 1) throw new ApiError(400, 'Invalid work identifier');
    await currentActor(actor, tx);
    const state = await readAccountState(actor.companyId, tx);
    const startedAt = await startedWorkAt(actor, work, tx, now, allowSubmitted);
    const audit = await tx.auditLog.findFirst({ where: { companyId: actor.companyId, actorType: 'STAFF', actorId: actor.id,
        entityType: work.kind === 'task' ? 'TASK_INSTANCE' : 'ATTENDANCE', entityId: work.id, action: 'WORK_ENTITLEMENT_GRANTED' }, orderBy: { createdAt: 'desc' } });
    const saved = audit?.newValue as Record<string, unknown> | undefined;
    const grant = saved && typeof saved.startedAt === 'string' && typeof saved.entitledFrom === 'string' && typeof saved.entitledUntil === 'string' && saved.startedAt === startedAt.toISOString()
        ? { startedAt, entitledFrom: new Date(saved.entitledFrom), entitledUntil: new Date(saved.entitledUntil) } : null;
    evaluateAccountAccess(state, actor.role, 'COMPLETE_WORK', now, grant);
    // Existing task/site/assignment, deadline and evidence checks remain mandatory.
    return state;
}

/** Call in the same locked transaction that starts this own task/shift in26. */
export async function recordWorkEntitlement(actor: VerificationActor, work: { kind: 'task' | 'attendance'; id: number }, tx: VerificationTransaction, now = new Date()) {
    if (actor.role !== 'STAFF') throw deny('STAFF_REQUIRED', 'Staff account required');
    const state = await assertAccountAction(actor, 'START_WORK', tx, now);
    const startedAt = await startedWorkAt(actor, work, tx, now);
    const window = subscriptionWindow(state)!;
    if (+startedAt < window.start || +startedAt >= window.end) throw deny('START_ENTITLEMENT_UNPROVEN', 'Work start entitlement could not be verified');
    await writeAuditLog({ companyId: actor.companyId, actorType: 'STAFF', actorId: actor.id,
        entityType: work.kind === 'task' ? 'TASK_INSTANCE' : 'ATTENDANCE', entityId: work.id, action: 'WORK_ENTITLEMENT_GRANTED',
        newValue: { startedAt: startedAt.toISOString(), entitledFrom: new Date(window.start).toISOString(), entitledUntil: new Date(window.end).toISOString(), subscriptionId: state.subscription!.id } }, tx);
}

/** The creator callback must use this transaction; never reserve quota outside it. */
export async function withAccountCapacity<T>(actor: VerificationActor, resource: LimitedResource, create: (tx: VerificationTransaction) => Promise<T>, db: Pick<typeof prisma, '$transaction'> = prisma, now = new Date()) {
    if (!['locations', 'staff', 'managers'].includes(resource)) throw new ApiError(400, 'Invalid capacity resource');
    if (actor.role !== 'ADMIN' && !(actor.role === 'MANAGER' && resource === 'staff')) throw deny('CAPACITY_ROLE_REQUIRED', 'Owner or assigned-site staff management required');
    return db.$transaction(async tx => {
        await tx.$queryRaw`SELECT id FROM "Company" WHERE id=${actor.companyId} FOR UPDATE`;
        // All subscription mutation adapters in15 take the company lock first.
        await tx.$queryRaw`SELECT id FROM "PaddleSubscription" WHERE id=(SELECT "billingSubscriptionId" FROM "Company" WHERE id=${actor.companyId}) FOR SHARE`;
        const state = await assertAccountAction(actor, 'ADD_CAPACITY', tx, now);
        const limit = PLAN_DEFINITIONS[state.company.plan].limits[resource];
        const count = () => resource === 'locations' ? tx.location.count({ where: { companyId: actor.companyId, isActive: true } })
            : resource === 'staff' ? tx.staff.count({ where: { companyId: actor.companyId, isActive: true } })
                : tx.manager.count({ where: { companyId: actor.companyId, isActive: true } });
        if (await count() >= limit) throw deny('CAPACITY_REACHED', 'This account has reached its plan capacity');
        const result = await create(tx);
        if (await count() > limit) throw deny('CAPACITY_REACHED', 'This change exceeds the account plan capacity');
        return result;
    });
}
