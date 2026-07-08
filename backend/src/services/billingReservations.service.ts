import type { AuditLog } from '@prisma/client';
import { prisma } from '../prisma/prisma.js';
import { configuredEntryForPrice, type PaddleCatalogEntry } from '../config/paddle.js';
import { ApiError } from '../utils/ApiError.js';
import { writeAuditLog } from './auditLog.service.js';
import type { BillingCheckoutResume } from '../types/billingLifecycle.js';
import type { VerificationActor } from './verification-v2/authorization.service.js';
import type { VerificationTransaction } from './verification-v2/transaction.js';

export const BILLING_RESERVATION_GRACE_MS = 120_000;
export type BillingReservationOperation = 'CUSTOMER_CREATE' | 'CHECKOUT';
export type BillingReservationCompany = {
  id: number;
  billingCustomerId: string | null;
  billingSubscriptionId: string | null;
};
export type BillingReservationClient = Pick<VerificationTransaction, 'auditLog' | 'manager' | 'paddleTransaction' | '$queryRaw'>;
type Deps = {
  db?: typeof prisma;
  now?: () => Date;
  /** Compose fact writes with customer/transaction linkage in the same transaction. */
  tx?: BillingReservationClient;
};
export type BillingReservationState =
  | { kind: 'none' }
  | { kind: 'inProgress' | 'reconcile'; reservation: AuditLog }
  | { kind: 'closed'; reservation: AuditLog; fact: AuditLog };
export type BillingCheckoutInspection =
  | { kind: 'resume'; selection: BillingCheckoutResume }
  | { kind: 'none' | 'canceled' | 'pending' | 'inProgress' | 'reconcile' };
export type BillingReservationFact =
  | { action: 'CUSTOMER_CREATE_READY'; reservationId: number; customerId: string; adopted?: boolean }
  | { action: 'CUSTOMER_CREATE_FAILED' | 'CHECKOUT_FAILED'; reservationId: number; code: string }
  | { action: 'CHECKOUT_READY'; reservationId: number; transactionId: string; customerId: string; confirmedByProvider?: boolean }
  | { action: 'CHECKOUT_CANCELED'; reservationId: number; transactionId: string };
export type BillingReservationResult =
  | { reservationId: number }
  | { existingCustomerId: string }
  | { ready: BillingCheckoutResume };

const objectFact = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const auditWhere = (companyId: number) => ({ companyId, entityType: 'BILLING_OPERATION', entityId: companyId });
const scoped = (fact: AuditLog, companyId: number) => fact.companyId === companyId &&
  fact.entityType === 'BILLING_OPERATION' && fact.entityId === companyId;
const transactionIdValid = (value: unknown): value is string => typeof value === 'string' && /^txn_[a-z0-9]{26}$/.test(value);
const customerIdValid = (value: unknown): value is string => typeof value === 'string' && /^ctm_[a-z0-9]{26}$/.test(value);
const conflict = (code = 'RECONCILIATION_REQUIRED') => new ApiError(409,
  'The previous billing request must be resolved before another can begin.', [{ code }]);
const client = (deps: Deps) => deps.tx ?? deps.db ?? prisma;

// Preserve the legacy resume checks: a foreign mirror is never treated as an
// absent mirror, and an unmirrored legacy READY needs an exact customer ID.
async function checkoutDetails(reservation: AuditLog, fact: AuditLog, company: BillingReservationCompany,
  db: Pick<BillingReservationClient, 'paddleTransaction'>) {
  const saved = objectFact(fact.newValue), requested = objectFact(reservation.newValue);
  const entry = typeof requested.priceId === 'string' ? configuredEntryForPrice(requested.priceId) : undefined;
  if (saved.reservationId !== reservation.id || !transactionIdValid(saved.transactionId) || !company.billingCustomerId ||
      !entry || entry.plan !== requested.plan || entry.interval !== requested.interval) return null;
  const known = await db.paddleTransaction.findFirst({ where: { id: saved.transactionId } });
  if (saved.customerId != null && saved.customerId !== company.billingCustomerId) return null;
  if (known && (known.id !== saved.transactionId || known.companyId !== company.id || known.customerId !== company.billingCustomerId)) return null;
  if (!known && (saved.confirmedByProvider === true || saved.customerId !== company.billingCustomerId)) return null;
  return { selection: { plan: entry.plan, interval: entry.interval, transactionId: saved.transactionId }, known };
}

async function closureMatches(reservation: AuditLog, fact: AuditLog, operation: BillingReservationOperation,
  company: BillingReservationCompany, db: BillingReservationClient, facts: AuditLog[]) {
  const saved = objectFact(fact.newValue);
  if (!scoped(fact, company.id) || fact.id <= reservation.id || saved.reservationId !== reservation.id) return false;
  if (fact.action === `${operation}_FAILED`) return typeof saved.code === 'string' && /^[A-Za-z][A-Za-z0-9_]{0,79}$/.test(saved.code);
  if (fact.action === `${operation}_READY`) {
    return operation === 'CUSTOMER_CREATE'
      ? customerIdValid(saved.customerId) && saved.customerId === company.billingCustomerId
      : !!await checkoutDetails(reservation, fact, company, db);
  }
  if (operation !== 'CHECKOUT' || fact.action !== 'CHECKOUT_CANCELED' || !transactionIdValid(saved.transactionId)) return false;
  // Cancellation can follow READY, or repair a create whose READY was lost.
  // It must never cancel a different known transaction under the same hold.
  const ready = facts.find(row => scoped(row, company.id) && row.id > reservation.id && row.id < fact.id &&
    row.action === 'CHECKOUT_READY' && objectFact(row.newValue).reservationId === reservation.id);
  if (ready && objectFact(ready.newValue).transactionId !== saved.transactionId) return false;
  const known = await db.paddleTransaction.findFirst({ where: { id: saved.transactionId } });
  return !known || (known.id === saved.transactionId && known.companyId === company.id && known.customerId === company.billingCustomerId);
}

/** Read only this company's latest reservation and its correlated closing facts. */
export async function readBillingReservation(company: BillingReservationCompany, operation: BillingReservationOperation,
  deps: Deps = {}): Promise<BillingReservationState> {
  const db = client(deps);
  const reservation = await db.auditLog.findFirst({ where: { ...auditWhere(company.id), action: `${operation}_RESERVED` }, orderBy: { id: 'desc' } });
  if (!reservation) return { kind: 'none' };
  if (!scoped(reservation, company.id) || reservation.action !== `${operation}_RESERVED`) throw conflict();
  const facts = await db.auditLog.findMany({ where: { ...auditWhere(company.id),
    action: { in: [`${operation}_READY`, `${operation}_FAILED`, ...(operation === 'CHECKOUT' ? ['CHECKOUT_CANCELED'] : [])] },
    newValue: { path: ['reservationId'], equals: reservation.id } }, orderBy: { id: 'desc' } });
  for (const fact of facts) {
    if (await closureMatches(reservation, fact, operation, company, db, facts)) return { kind: 'closed', reservation, fact };
  }
  // Missing/invalid timestamps cannot prove that a provider operation ended.
  const age = +(deps.now?.() ?? new Date()) - +reservation.createdAt;
  return { kind: Number.isFinite(age) && age < BILLING_RESERVATION_GRACE_MS ? 'inProgress' : 'reconcile', reservation };
}

export async function customerReconciliationPending(company: BillingReservationCompany, deps: Deps = {}): Promise<boolean> {
  const state = await readBillingReservation(company, 'CUSTOMER_CREATE', deps);
  return state.kind === 'inProgress' || state.kind === 'reconcile';
}

async function inspectCheckoutState(state: BillingReservationState, company: BillingReservationCompany,
  db: BillingReservationClient): Promise<BillingCheckoutInspection> {
  if (state.kind !== 'closed') return { kind: state.kind };
  if (state.fact.action === 'CHECKOUT_FAILED') return { kind: 'none' };
  if (state.fact.action === 'CHECKOUT_CANCELED') return { kind: 'canceled' };
  const details = await checkoutDetails(state.reservation, state.fact, company, db);
  if (!details) return { kind: 'pending' };
  const { known, selection } = details;
  if (known?.subscriptionId) return { kind: known.subscriptionId === company.billingSubscriptionId ? 'none' : 'pending' };
  if (known?.status === 'canceled') return { kind: 'canceled' };
  if (known && !['draft', 'ready'].includes(known.status)) return { kind: 'pending' };
  return { kind: 'resume', selection };
}

export async function inspectBillingCheckout(company: BillingReservationCompany, deps: Deps = {}): Promise<BillingCheckoutInspection> {
  return inspectCheckoutState(await readBillingReservation(company, 'CHECKOUT', deps), company, client(deps));
}

async function ownerAccount(actor: VerificationActor, db: BillingReservationClient) {
  if (actor.role !== 'ADMIN') throw new ApiError(403, 'Company owner access required');
  const owner = await db.manager.findFirst({ where: { id: actor.id, companyId: actor.companyId, role: 'ADMIN', isActive: true },
    select: { id: true, emailVerifiedAt: true, company: true } });
  if (!owner || owner.id !== actor.id || owner.company.id !== actor.companyId) throw new ApiError(403, 'Active company owner required');
  return owner;
}

async function withCompanyLock<T>(actor: VerificationActor, deps: Deps, run: (tx: BillingReservationClient) => Promise<T>): Promise<T> {
  const locked = async (tx: BillingReservationClient) => {
    await tx.$queryRaw`SELECT id FROM "Company" WHERE id=${actor.companyId} FOR UPDATE`;
    return run(tx);
  };
  return deps.tx ? locked(deps.tx) : (deps.db ?? prisma).$transaction(locked);
}

/** Reserve before calling a provider. Age alone never permits another write. */
export async function reserveBillingOperation(actor: VerificationActor, operation: BillingReservationOperation,
  details: Partial<PaddleCatalogEntry> = {}, deps: Deps = {}): Promise<BillingReservationResult> {
  return withCompanyLock(actor, deps, async tx => {
    const owner = await ownerAccount(actor, tx), company = owner.company;
    if ((process.env.PADDLE_ENVIRONMENT !== 'sandbox' && !owner.emailVerifiedAt) || !company.isActive || company.operationalStatus !== 'ACTIVE') {
      throw new ApiError(403, 'Verified active company access required');
    }
    const lockedDeps = { ...deps, tx };
    if (operation === 'CUSTOMER_CREATE' && company.billingCustomerId) return { existingCustomerId: company.billingCustomerId };
    if (operation === 'CHECKOUT') {
      if (company.billingSubscriptionId) throw new ApiError(409, 'Use the billing portal to manage the linked subscription.');
      if (await customerReconciliationPending(company, lockedDeps)) throw conflict();
    }
    const state = await readBillingReservation(company, operation, lockedDeps);
    if (state.kind === 'inProgress' || state.kind === 'reconcile') throw conflict(state.kind === 'inProgress' ? 'IN_PROGRESS' : 'RECONCILIATION_REQUIRED');
    if (operation === 'CHECKOUT' && state.kind === 'closed' && state.fact.action === 'CHECKOUT_READY') {
      const checkout = await inspectCheckoutState(state, company, tx);
      if (checkout.kind === 'resume') return { ready: checkout.selection };
      if (checkout.kind !== 'canceled') throw conflict();
    }
    const reservation = await writeAuditLog({ companyId: actor.companyId, actorType: 'ADMIN', actorId: actor.id,
      entityType: 'BILLING_OPERATION', entityId: actor.companyId, action: `${operation}_RESERVED`,
      newValue: operation === 'CHECKOUT' ? { plan: details.plan, interval: details.interval, priceId: details.priceId } : undefined }, tx);
    return { reservationId: reservation.id };
  });
}

/** Append a provider-established fact; never infer failure from elapsed time.
 * Pass tx when the caller must atomically mirror/link a customer or transaction.
 */
export async function recordBillingReservationFact(actor: VerificationActor, fact: BillingReservationFact, deps: Deps = {}): Promise<AuditLog> {
  return withCompanyLock(actor, deps, async tx => {
    const owner = await ownerAccount(actor, tx);
    const operation: BillingReservationOperation = fact.action.startsWith('CUSTOMER_CREATE_') ? 'CUSTOMER_CREATE' : 'CHECKOUT';
    const reservation = await tx.auditLog.findFirst({ where: { ...auditWhere(actor.companyId), id: fact.reservationId, action: `${operation}_RESERVED` } });
    if (!reservation || !scoped(reservation, actor.companyId) || reservation.id !== fact.reservationId || reservation.action !== `${operation}_RESERVED`) throw conflict();
    const { action, ...newValue } = fact;
    const facts = await tx.auditLog.findMany({ where: { ...auditWhere(actor.companyId), newValue: { path: ['reservationId'], equals: reservation.id } }, orderBy: { id: 'desc' } });
    // Validate using the same correlation rules as reads before appending.
    const candidate = { ...reservation, id: Math.max(reservation.id, ...facts.map(row => row.id)) + 1, action, newValue } as AuditLog;
    if (!await closureMatches(reservation, candidate, operation, owner.company, tx, facts)) throw conflict();
    const validFacts: AuditLog[] = [];
    for (const row of facts) {
      if (await closureMatches(reservation, row, operation, owner.company, tx, facts)) validFacts.push(row);
    }
    const existing = validFacts.find(row => row.action === action);
    if (existing) {
      const saved = objectFact(existing.newValue);
      if (Object.entries(newValue).every(([key, value]) => saved[key] === value)) return existing;
      throw conflict();
    }
    // READY can subsequently be canceled; contradictory terminal facts cannot
    // turn a proven failure/cancellation back into a new usable checkout.
    for (const row of validFacts) {
      if (!(action === 'CHECKOUT_CANCELED' && row.action === 'CHECKOUT_READY')) throw conflict();
    }
    return writeAuditLog({ companyId: actor.companyId, actorType: 'ADMIN', actorId: actor.id,
      entityType: 'BILLING_OPERATION', entityId: actor.companyId, action, newValue }, tx);
  });
}
