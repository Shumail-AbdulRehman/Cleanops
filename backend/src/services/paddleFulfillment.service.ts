import { writeAuditLog } from "./auditLog.service.js";
import { configuredPlanForPrice } from "../config/paddle.js";
import { ApiError } from "../utils/ApiError.js";
import {
  EventName,
  type CustomerNotification,
  type EventEntity,
  type Subscription,
  type SubscriptionNotification,
  type TransactionNotification,
} from "@paddle/paddle-node-sdk";
import { prisma } from "../prisma/prisma.js";

// The API entity and webhook entity have different price types. Keep only the
// provider facts fulfilment consumes, rather than casting one SDK type to another.
type SubscriptionPayload = Pick<SubscriptionNotification,
  'id' | 'customerId' | 'status' | 'createdAt' | 'updatedAt' | 'canceledAt' | 'pausedAt'
  | 'scheduledChange' | 'currentBillingPeriod'> & {
  items: { recurring: boolean; price: { id: string; productId: string } | null }[];
};

const subscriptionPayloadFromProvider = (data: Subscription): SubscriptionPayload => ({
  id: data.id,
  customerId: data.customerId,
  status: data.status,
  createdAt: data.createdAt,
  updatedAt: data.updatedAt,
  canceledAt: data.canceledAt,
  pausedAt: data.pausedAt,
  scheduledChange: data.scheduledChange,
  currentBillingPeriod: data.currentBillingPeriod,
  items: data.items.map(item => ({ recurring: item.recurring, price: { id: item.price.id, productId: item.price.productId } })),
});

type Db = Omit<typeof prisma, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'>;

const epoch = new Date(0);

const asDate = (value: string | null | undefined) => value ? new Date(value) : null;

const shouldApplyEntityVersion = (
  current: { paddleUpdatedAt: Date; lastEventAt: Date } | null,
  paddleUpdatedAt: Date,
  eventAt: Date,
) => !current || eventAt > current.lastEventAt
  || (eventAt.getTime() === current.lastEventAt.getTime() && paddleUpdatedAt >= current.paddleUpdatedAt);

// A read has no event timestamp. Provider version is authoritative for both
// subscription entry paths; delivery time only breaks ties for the same version.
// Customer/transaction event ordering retains its existing behaviour.
const shouldApplySubscriptionVersion = (
  current: { paddleUpdatedAt: Date; lastEventAt: Date } | null,
  paddleUpdatedAt: Date,
  eventAt: Date,
) => !current || paddleUpdatedAt > current.paddleUpdatedAt
  || (paddleUpdatedAt.getTime() === current.paddleUpdatedAt.getTime() && eventAt >= current.lastEventAt);


export const subscriptionGrantsPaidAccess = (status: string) =>
  status.toLowerCase() === "active" || status.toLowerCase() === "trialing";

const toCompanyStatus = (status: string): "ACTIVE" | "PAST_DUE" | "CANCELLED" => {
  if (subscriptionGrantsPaidAccess(status)) return "ACTIVE";
  if (status.toLowerCase() === "past_due") return "PAST_DUE";
  return "CANCELLED";
};

const ensureCustomerExists = async (customerId: string, client: Db) => client.paddleCustomer.upsert({
  where: { id: customerId },
  create: { id: customerId, status: 'unknown', paddleUpdatedAt: epoch, lastEventAt: epoch }, update: {},
});

// Only a canonical server-established customer relationship grants tenant linkage.
// Signed events still contain customer-editable customData; email is not ownership.
const resolveCompanyId = async (customerId: string, client: Db) => {
  const company = await client.company.findFirst({ where: { billingCustomerId: customerId }, select: { id: true } });
  return company?.id;
};
const lockCustomer = async (customerId: string, client: Db, knownCompanyId?: number) => {
  const companyId = knownCompanyId ?? await resolveCompanyId(customerId, client);
  if (companyId) await client.$queryRaw`SELECT id FROM "Company" WHERE id=${companyId} FOR UPDATE`;
  // Serialize every entry path for the same customer, including unlinked mirrors.
  await client.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${customerId}, 1516))::text`;
};
const linkCustomerToCompany = async (customerId: string, companyId: number, client: Db) => {
  const customer = await client.paddleCustomer.findUniqueOrThrow({ where: { id: customerId } });
  if (customer.companyId !== null && customer.companyId !== companyId) throw new ApiError(409, 'Billing customer linkage requires review');
  await client.paddleCustomer.update({ where: { id: customerId }, data: { companyId } });
  await client.paddleSubscription.updateMany({ where: { customerId, companyId: null }, data: { companyId } });
  await client.paddleTransaction.updateMany({ where: { customerId, companyId: null }, data: { companyId } });
};

const syncCompanyAccess = async (companyId: number, client: Db) => {
  const company = await client.company.findUniqueOrThrow({ where: { id: companyId } });
  if (!company.billingCustomerId) return;
  const subscriptions = await client.paddleSubscription.findMany({
    where: { companyId, customerId: company.billingCustomerId! },
    orderBy: [{ lastEventAt: "desc" }, { paddleUpdatedAt: "desc" }],
  });
  if (subscriptions.length === 0) return;

  const { subscriptionWindow } = await import('./accountAccess.service.js');
  const now = Date.now();
  const effectiveSubscription = subscriptions.find(subscription => {
    const window = subscriptionWindow({ company: { ...company, billingSubscriptionId: subscription.id }, subscription });
    return configuredPlanForPrice(subscription.priceId) && subscriptionGrantsPaidAccess(subscription.status) && window && window.start <= now && now < window.end;
  }) ?? subscriptions[0]!;
  const plan = configuredPlanForPrice(effectiveSubscription.priceId);

  await client.company.update({
    where: { id: companyId },
    data: {
      billingCustomerId: effectiveSubscription.customerId,
      billingSubscriptionId: effectiveSubscription.id,
      subscriptionStatus: plan ? toCompanyStatus(effectiveSubscription.status) : "CANCELLED",
      ...(plan ? { plan } : {}),
      planUpdatedAt: new Date(),
    },
  });
};

export const companyHasPaidAccess = async (companyId: number) => {
  // Existing feature/quota consumers use the same exact-customer/current-period policy.
  const { readAccountState, subscriptionWindow } = await import('./accountAccess.service.js');
  const state = await readAccountState(companyId);
  const window = subscriptionWindow(state), now = Date.now();
  return !!(window && state.company.isActive && state.company.operationalStatus === 'ACTIVE' &&
    subscriptionGrantsPaidAccess(state.subscription!.status) && window.start <= now && now < window.end);
};

const handleCustomer = async (data: CustomerNotification, eventAt: Date, client: Db) => {
  const paddleUpdatedAt = new Date(data.updatedAt);
  const current = await client.paddleCustomer.findUnique({ where: { id: data.id } });

  if (shouldApplyEntityVersion(current, paddleUpdatedAt, eventAt)) {
    await client.paddleCustomer.upsert({
      where: { id: data.id },
      create: {
        id: data.id,
        email: data.email,
        name: data.name,
        locale: data.locale,
        status: data.status,
        paddleCreatedAt: asDate(data.createdAt),
        paddleUpdatedAt,
        lastEventAt: eventAt,
      },
      update: {
        email: data.email,
        name: data.name,
        locale: data.locale,
        status: data.status,
        paddleCreatedAt: asDate(data.createdAt),
        paddleUpdatedAt,
        lastEventAt: eventAt,
      },
    });
  }

  const companyId = await resolveCompanyId(data.id, client);
  if (companyId) {
    await linkCustomerToCompany(data.id, companyId, client);
    await syncCompanyAccess(companyId, client);
  }
};

const subscriptionItem = (data: SubscriptionPayload) => {
  const item = data.items.find((candidate) => candidate.recurring && candidate.price)
    ?? data.items.find((candidate) => candidate.price);
  if (!item?.price) throw new Error(`Subscription ${data.id} has no catalog price`);
  return { priceId: item.price.id, productId: item.price.productId };
};

const handleSubscription = async (data: SubscriptionPayload, eventAt: Date, client: Db) => {
  await ensureCustomerExists(data.customerId, client);
  const companyId = await resolveCompanyId(data.customerId, client);
  if (companyId) await linkCustomerToCompany(data.customerId, companyId, client);

  const { priceId, productId } = subscriptionItem(data);
  const paddleUpdatedAt = new Date(data.updatedAt);
  const current = await client.paddleSubscription.findUnique({ where: { id: data.id } });

  if (current && (current.customerId !== data.customerId || (current.companyId !== null && companyId !== undefined && current.companyId !== companyId))) throw new ApiError(409, "Billing subscription linkage requires review");
  if (shouldApplySubscriptionVersion(current, paddleUpdatedAt, eventAt)) {
    await client.paddleSubscription.upsert({
      where: { id: data.id },
      create: {
        id: data.id,
        customerId: data.customerId,
        companyId,
        status: data.status,
        priceId,
        productId,
        scheduledChangeAction: data.scheduledChange?.action,
        scheduledChangeAt: asDate(data.scheduledChange?.effectiveAt),
        currentBillingPeriodStart: asDate(data.currentBillingPeriod?.startsAt),
        currentBillingPeriodEnd: asDate(data.currentBillingPeriod?.endsAt),
        canceledAt: asDate(data.canceledAt),
        pausedAt: asDate(data.pausedAt),
        paddleCreatedAt: asDate(data.createdAt),
        paddleUpdatedAt,
        lastEventAt: eventAt,
      },
      update: {
        customerId: data.customerId,
        ...(companyId ? { companyId } : {}),
        status: data.status,
        priceId,
        productId,
        scheduledChangeAction: data.scheduledChange?.action ?? null,
        scheduledChangeAt: asDate(data.scheduledChange?.effectiveAt),
        currentBillingPeriodStart: asDate(data.currentBillingPeriod?.startsAt),
        currentBillingPeriodEnd: asDate(data.currentBillingPeriod?.endsAt),
        canceledAt: asDate(data.canceledAt),
        pausedAt: asDate(data.pausedAt),
        paddleCreatedAt: asDate(data.createdAt),
        paddleUpdatedAt,
        lastEventAt: eventAt,
      },
    });
  }

  if (companyId) await syncCompanyAccess(companyId, client);
};

/** Apply a trusted server-side Paddle read to its already established tenant.
 * Callers own transaction/payment verification. This never deduplicates or
 * synthesizes a webhook, so the real signed event can still be processed later.
 */
export const applyPaddleSubscription = async (
  subscription: Subscription,
  scope: { companyId: number; customerId: string },
  db: Pick<typeof prisma, '$transaction'> = prisma,
) => {
  if (!Number.isSafeInteger(scope.companyId) || scope.companyId < 1 || !scope.customerId || subscription.customerId !== scope.customerId) {
    throw new ApiError(409, 'Billing customer linkage requires review');
  }
  const versionAt = new Date(subscription.updatedAt);
  if (!Number.isFinite(+versionAt)) throw new ApiError(400, 'Invalid billing subscription');
  return db.$transaction(async client => {
    await lockCustomer(scope.customerId, client, scope.companyId);
    if (await resolveCompanyId(scope.customerId, client) !== scope.companyId) {
      throw new ApiError(409, 'Billing customer linkage requires review');
    }
    // Use the provider's version, never local read time: a delayed webhook with
    // newer facts must remain able to apply, even after repeated server reads.
    await handleSubscription(subscriptionPayloadFromProvider(subscription), versionAt, client);
  });
};

const ensureSubscriptionExistsFromTransaction = async (
  data: TransactionNotification,
  companyId: number | undefined,
  client: Db,
) => {
  if (!data.subscriptionId || !data.customerId) return;
  const existing = await client.paddleSubscription.findUnique({ where: { id: data.subscriptionId } });
  if (existing) return;

  const price = data.items.find((item) => item.price)?.price;
  if (!price) return;

  await client.paddleSubscription.upsert({ where: { id: data.subscriptionId },
    create: { id: data.subscriptionId, customerId: data.customerId, companyId, status: 'unknown', priceId: price.id, productId: price.productId, paddleUpdatedAt: epoch, lastEventAt: epoch }, update: {},
  });
};

async function acknowledgeCheckout(data: TransactionNotification, companyId: number, client: Db) {
  const metadata = data.customData as Record<string, unknown> | null;
  const reservationId = metadata?.checkoutReservationId;
  if (typeof reservationId !== 'number' || !Number.isSafeInteger(reservationId) || reservationId < 1) return;
  const reservation = await client.auditLog.findFirst({ where: { id: reservationId, companyId, entityType: 'BILLING_OPERATION', entityId: companyId, action: 'CHECKOUT_RESERVED' } });
  if (!reservation) return;
  const requested = reservation.newValue as Record<string, unknown> | null;
  if (data.items.length !== 1 || data.items[0]?.quantity !== 1 || data.items[0]?.price?.id !== requested?.priceId) throw new ApiError(409, 'Billing checkout correlation requires review');
  const ready = await client.auditLog.findFirst({ where: { companyId, entityType: 'BILLING_OPERATION', entityId: companyId, action: 'CHECKOUT_READY', newValue: { path: ['reservationId'], equals: reservationId } } });
  if (ready) {
    if ((ready.newValue as Record<string, unknown> | null)?.transactionId !== data.id) throw new ApiError(409, 'Billing checkout correlation requires review');
    return;
  }
  await writeAuditLog({ companyId, actorType: 'SYSTEM', entityType: 'BILLING_OPERATION', entityId: companyId, action: 'CHECKOUT_READY', newValue: { reservationId, transactionId: data.id, confirmedByProvider: true } }, client);
}

const handleTransactionCompleted = async (data: TransactionNotification, eventAt: Date, client: Db) => {
  if (data.customerId) await ensureCustomerExists(data.customerId, client);
  const companyId = data.customerId
    ? await resolveCompanyId(data.customerId, client)
    : undefined;
  if (data.customerId && companyId) await linkCustomerToCompany(data.customerId, companyId, client);
  await ensureSubscriptionExistsFromTransaction(data, companyId, client);

  const paddleUpdatedAt = new Date(data.updatedAt);
  const current = await client.paddleTransaction.findUnique({ where: { id: data.id } });
  if (shouldApplyEntityVersion(current, paddleUpdatedAt, eventAt)) {
    await client.paddleTransaction.upsert({
      where: { id: data.id },
      create: {
        id: data.id,
        customerId: data.customerId,
        subscriptionId: data.subscriptionId,
        companyId,
        status: data.status,
        currencyCode: data.currencyCode,
        total: data.details?.totals?.grandTotal,
        invoiceNumber: data.invoiceNumber,
        paddleCreatedAt: asDate(data.createdAt),
        paddleUpdatedAt,
        lastEventAt: eventAt,
      },
      update: {
        customerId: data.customerId,
        subscriptionId: data.subscriptionId,
        ...(companyId ? { companyId } : {}),
        status: data.status,
        currencyCode: data.currencyCode,
        total: data.details?.totals?.grandTotal,
        invoiceNumber: data.invoiceNumber,
        paddleCreatedAt: asDate(data.createdAt),
        paddleUpdatedAt,
        lastEventAt: eventAt,
      },
    });
  }

  if (companyId) { await acknowledgeCheckout(data, companyId, client); await syncCompanyAccess(companyId, client); }
};

export const processPaddleEvent = async (event: EventEntity, db: Pick<typeof prisma, '$transaction'> = prisma) => {
  const eventAt = new Date(event.occurredAt);
  if (!event.eventId || !Number.isFinite(+eventAt)) throw new ApiError(400, 'Invalid billing event');
  return db.$transaction(async client => {
    await client.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${event.eventId}, 1515))::text`;
    if (await client.paddleWebhookEvent.findUnique({ where: { id: event.eventId }, select: { id: true } })) return { duplicate: true };
    const data = event.data;
    const customerId = event.eventType.startsWith('customer.') ? data.id : 'customerId' in data ? data.customerId : null;
    if (typeof customerId === 'string') {
      await lockCustomer(customerId, client);
    }
    switch (event.eventType) {
      case EventName.CustomerCreated:
      case EventName.CustomerUpdated:
        await handleCustomer(event.data, eventAt, client); break;
      case EventName.SubscriptionCreated:
      case EventName.SubscriptionUpdated:
      case EventName.SubscriptionCanceled:
      case EventName.SubscriptionActivated:
      case EventName.SubscriptionPastDue:
      case EventName.SubscriptionPaused:
      case EventName.SubscriptionResumed:
      case EventName.SubscriptionTrialing:
        await handleSubscription(event.data, eventAt, client); break;
      case EventName.TransactionCreated:
      case EventName.TransactionUpdated:
      case EventName.TransactionCanceled:
      case EventName.TransactionPaid:
      case EventName.TransactionReady:
      case EventName.TransactionBilled:
      case EventName.TransactionPastDue:
      case EventName.TransactionCompleted:
        await handleTransactionCompleted(event.data, eventAt, client); break;
      default: break;
    }
    await client.paddleWebhookEvent.create({ data: { id: event.eventId, eventType: event.eventType, occurredAt: eventAt } });
    return { duplicate: false };
  });
};
