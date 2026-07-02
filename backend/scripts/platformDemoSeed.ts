import { randomBytes } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import type { Prisma, PrismaClient } from '@prisma/client';
import bcrypt from 'bcrypt';
import { formatInTimeZone } from 'date-fns-tz';
import { getPaddleCatalog, type PaddleCatalogEntry } from '../src/config/paddle.js';
import { localOperatorEnvironmentAllowed } from '../src/services/localOperatorSession.service.js';
import { visibleRubricV1, viewSurfaces } from '../src/services/verification-v2/rubrics.js';
import { getZonedDayRange } from '../src/utils/dateTime.js';

const NAME_MARKER = 'Platform Demo 28 - ';
const BILLING_MARKER = 'demo_platform28_';
const PHOTO_MARKER = 'demo_platform29_';
const EMAIL_MARKER = '@platform-demo-28.invalid';
const ZONE = 'Asia/Karachi';
const COMPANY_COUNT = 40;
const DAYS = 84;
const ACTIVITY_SLOTS = 4;
const STAFF_SLOTS = 40;
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

// These positive IDs work with the console's company routes and avoid the normal sequences.
const firstId = 1_928_000_000;
const activityRangeSize = COMPANY_COUNT * DAYS * ACTIVITY_SLOTS;
const ranges = {
  company: { gte: firstId, lt: firstId + COMPANY_COUNT },
  manager: { gte: firstId + 100, lt: firstId + 100 + COMPANY_COUNT * 3 },
  location: { gte: firstId + 300, lt: firstId + 300 + COMPANY_COUNT * 2 },
  staff: { gte: firstId + 500, lt: firstId + 500 + COMPANY_COUNT * STAFF_SLOTS },
  task: { gte: firstId + 10_000, lt: firstId + 10_000 + activityRangeSize },
  attendance: { gte: firstId + 30_000, lt: firstId + 30_000 + activityRangeSize },
  area: { gte: firstId + 50_000, lt: firstId + 50_000 + COMPANY_COUNT * 2 },
  areaItem: { gte: firstId + 51_000, lt: firstId + 51_000 + COMPANY_COUNT * 2 },
  verificationItem: { gte: firstId + 52_000, lt: firstId + 52_000 + activityRangeSize },
  assignment: { gte: firstId + 66_000, lt: firstId + 66_000 + activityRangeSize },
};

const plans = ['STARTER', 'PRO', 'ADVANCED'] as const;
const states = ['ACTIVE', 'ACTIVE', 'PAST_DUE', 'ACTIVE', 'SCHEDULED_CANCEL', 'ACTIVE', 'CANCELLED', 'NONE'] as const;
const namePrefixes = ['Aster', 'Birch', 'Cedar', 'Clover', 'Fern', 'Hazel', 'Iris', 'Willow'];
const nameSuffixes = ['Building Care', 'Site Services', 'Facility Care', 'Property Services', 'Janitorial'];
const photoStates = ['PASSED', 'RECAPTURE_REQUIRED', 'REVIEW_REQUIRED', 'CLEANING_REQUIRED'] as const;
const areaName = `${NAME_MARKER}Washroom`;
const fixtureName = `${NAME_MARKER}Floor`;
const view = { key: 'wide_zone', instructions: 'Show the whole floor zone.', mandatory: true };
const assignmentReason = `${NAME_MARKER}Historical photo outcome`;
const unavailableTotals = 'Transaction totals unavailable. The configured catalog contains price IDs only.';

type DemoPlan = {
  companies: Prisma.CompanyCreateManyInput[];
  managers: Omit<Prisma.ManagerCreateManyInput, 'password'>[];
  locations: Prisma.LocationCreateManyInput[];
  staff: Omit<Prisma.StaffCreateManyInput, 'password'>[];
  customers: Prisma.PaddleCustomerCreateManyInput[];
  subscriptions: Prisma.PaddleSubscriptionCreateManyInput[];
  transactions: Prisma.PaddleTransactionCreateManyInput[];
  tasks: Prisma.TaskInstanceCreateManyInput[];
  attendance: Prisma.AttendanceCreateManyInput[];
  areas: Prisma.AreaCreateManyInput[];
  areaItems: Prisma.AreaItemCreateManyInput[];
  assignments: Prisma.TaskAssignmentCreateManyInput[];
  verificationItems: Prisma.TaskVerificationItemCreateManyInput[];
  requirements: (Prisma.TaskEvidenceRequirementCreateManyInput & { id: string; currentAttemptId: string })[];
  sessions: Prisma.CaptureSessionCreateManyInput[];
  slots: Prisma.CaptureSlotCreateManyInput[];
  attempts: Prisma.VerificationAttemptCreateManyInput[];
};

class SeedError extends Error {}

async function seedStep<T>(step: string, run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof SeedError) throw error;
    throw new SeedError(`Platform demo seed failed while ${step}.`);
  }
}

export function guardedDatabaseUrl(env: NodeJS.ProcessEnv): string {
  const url = env.DATABASE_URL;
  // This CLI uses the sign-in database allowlist without enabling sign-in.
  if (!url || env.NODE_ENV === 'production' || !localOperatorEnvironmentAllowed({
    DATABASE_URL: url,
    NODE_ENV: 'development',
    LOCAL_PLATFORM_LOGIN_ENABLED: 'true',
  })) {
    throw new SeedError('Set DATABASE_URL to the allowed loopback demo or disposable database. Production mode is refused.');
  }
  return url;
}

const at = (start: Date, milliseconds: number) => new Date(start.getTime() + milliseconds);

function priceFor(plan: PaddleCatalogEntry['plan'], interval: PaddleCatalogEntry['interval'], catalog: readonly PaddleCatalogEntry[]) {
  const prices = catalog.filter(entry => entry.plan === plan);
  const price = prices.find(entry => entry.interval === interval) ?? prices[0];
  if (!price) throw new SeedError(`PADDLE_PRICE_CATALOG_JSON is missing a configured price for ${plan}.`);
  return price;
}

function readCatalog(env: NodeJS.ProcessEnv) {
  try {
    return getPaddleCatalog(env);
  } catch {
    throw new SeedError('Paddle catalog unavailable. Set PADDLE_ENVIRONMENT and a valid PADDLE_PRICE_CATALOG_JSON.');
  }
}

function addPhotoOutcome(
  plan: DemoPlan,
  task: Prisma.TaskInstanceCreateManyInput & { id: number; startedAt: Date; completedAt: Date },
  staffId: number,
  state: typeof photoStates[number],
  photoLocations: Set<number>,
) {
  const locationOffset = task.locationId - ranges.location.gte;
  const areaId = ranges.area.gte + locationOffset;
  const areaItemId = ranges.areaItem.gte + locationOffset;
  const stableCode = `${PHOTO_MARKER}floor`;
  if (!photoLocations.has(task.locationId)) {
    photoLocations.add(task.locationId);
    plan.areas.push({
      id: areaId, locationId: task.locationId, name: areaName, roomType: 'WASHROOM', status: 'ARCHIVED', createdAt: task.date,
    });
    plan.areaItems.push({
      id: areaItemId, areaId, stableCode, displayName: fixtureName, fixtureType: 'FLOOR_ZONE',
      sequence: 1, rubricKey: 'visible-v1', requiredViews: [view], createdAt: task.date,
    });
  }

  const offset = task.id - ranges.task.gte;
  const itemId = ranges.verificationItem.gte + offset;
  const assignmentId = ranges.assignment.gte + offset;
  const requirementId = `${PHOTO_MARKER}requirement_${offset}`;
  const sessionId = `${PHOTO_MARKER}session_${offset}`;
  const slotId = `${PHOTO_MARKER}slot_${offset}`;
  const attemptId = `${PHOTO_MARKER}attempt_${offset}`;
  const { startedAt, completedAt } = task;

  task.areaId = areaId;
  task.areaNameSnapshot = areaName;
  task.inventoryVersion = 1;
  plan.assignments.push({
    id: assignmentId, taskInstanceId: task.id, staffId, isCurrent: false, status: 'COMPLETED',
    reason: assignmentReason, assignedAt: startedAt, startedAt, completedAt, createdAt: startedAt,
  });
  plan.verificationItems.push({
    id: itemId, taskInstanceId: task.id, areaId, sourceAreaItemId: areaItemId,
    itemCodeSnapshot: stableCode, nameSnapshot: fixtureName, typeSnapshot: 'FLOOR_ZONE', orderSnapshot: 1,
    identificationSnapshot: { mode: 'ORDERED_CONTEXT' },
    rubricSnapshot: { key: 'visible-v1', ...visibleRubricV1, views: [view], surfacesByView: { [view.key]: viewSurfaces[view.key] } },
    state,
  });
  plan.requirements.push({
    id: requirementId, taskVerificationItemId: itemId, viewKey: view.key,
    instructionsSnapshot: view.instructions, currentAttemptId: attemptId, state,
  });
  plan.sessions.push({
    id: sessionId, taskInstanceId: task.id, areaId, staffId, assignmentId, assignmentEpoch: 0,
    deviceId: `${PHOTO_MARKER}device`, clientBootId: `${PHOTO_MARKER}boot`, qrVersion: 1, policyVersion: 1,
    issuedAt: startedAt, serverTimeAnchor: startedAt, captureExpiresAt: completedAt, uploadExpiresAt: completedAt,
    closedAt: completedAt, state: 'CLOSED', presenceStatus: 'DEMO', locationCheck: { source: 'demo' },
  });
  plan.slots.push({
    id: slotId, sessionId, requirementId, attemptId, sequence: 0,
    nonceHash: '0'.repeat(64), activatedAt: startedAt, expiresAt: completedAt,
  });
  plan.attempts.push({
    id: attemptId, sessionId, slotId, requirementId, staffId, assignmentEpoch: 0,
    clientCaptureId: attemptId, claimedCapturedAt: completedAt,
    anchoredElapsedMs: BigInt(completedAt.getTime() - startedAt.getTime()), timingEvidence: 'UNCERTAIN',
    mediaAssetId: null, state, createdAt: completedAt,
  });
}

export function planPlatformDemo(now: Date, catalog: readonly PaddleCatalogEntry[]): DemoPlan {
  const plan: DemoPlan = {
    companies: [], managers: [], locations: [], staff: [], customers: [], subscriptions: [],
    transactions: [], tasks: [], attendance: [], areas: [], areaItems: [], assignments: [],
    verificationItems: [], requirements: [], sessions: [], slots: [], attempts: [],
  };
  const photoLocations = new Set<number>();
  const [year, month] = formatInTimeZone(now, ZONE, 'yyyy-MM').split('-').map(Number);
  const today = getZonedDayRange(now, ZONE).start;

  for (let index = 0; index < COMPANY_COUNT; index++) {
    const id = ranges.company.gte + index;
    const key = `${BILLING_MARKER}${index}`;
    const name = `${NAME_MARKER}${namePrefixes[index % 8]} ${nameSuffixes[Math.floor(index / 8)]}`;
    const planName = plans[index % plans.length];
    const state = states[index % states.length];
    const signupMonth = new Date(Date.UTC(year, month - 12 + Math.floor(index * 12 / COMPANY_COUNT), 1));
    const signupStart = getZonedDayRange(signupMonth, ZONE).start;
    const createdAt = new Date(Math.min(at(signupStart, index % 4 * 4 * DAY).getTime(), today.getTime()));
    const ownerEmail = `owner.${index}${EMAIL_MARKER}`;
    const subscriptionId = state === 'NONE' ? null : `${key}_subscription`;
    const attemptedCheckout = state === 'NONE' && index % 3 === 0;
    const customerId = subscriptionId || attemptedCheckout ? `${key}_customer` : null;
    const canceledAt = state === 'CANCELLED'
      ? new Date(Math.max(createdAt.getTime(), today.getTime() - (index % 15 + 1) * DAY))
      : null;
    const suspended = index === 13;

    plan.companies.push({
      id, name, plan: planName, createdAt, planUpdatedAt: createdAt,
      billingCustomerId: customerId, billingSubscriptionId: subscriptionId,
      subscriptionStatus: state === 'NONE' || state === 'CANCELLED' ? 'CANCELLED' : state === 'PAST_DUE' ? 'PAST_DUE' : 'ACTIVE',
      operationalStatus: suspended ? 'SUSPENDED' : 'ACTIVE',
      isActive: !suspended,
      suspendedAt: suspended ? at(today, -DAY) : null,
    });

    const managerCount = planName === 'STARTER' ? 1 : 2;
    for (let slot = 0; slot <= managerCount; slot++) {
      plan.managers.push({
        id: ranges.manager.gte + index * 3 + slot,
        companyId: id, role: slot === 0 ? 'ADMIN' : 'MANAGER',
        name: `${NAME_MARKER}${slot === 0 ? 'Owner' : `Manager ${slot}`}`,
        email: slot === 0 ? ownerEmail : `manager.${index}.${slot}${EMAIL_MARKER}`,
        createdAt,
      });
    }

    const locationCount = planName === 'STARTER' ? 1 : 2;
    const firstLocation = ranges.location.gte + index * 2;
    for (let slot = 0; slot < locationCount; slot++) {
      plan.locations.push({
        id: firstLocation + slot, companyId: id, name: `${NAME_MARKER}Site ${slot + 1}`,
        address: `${NAME_MARKER}Training site`, latitude: '33.6844', longitude: '73.0479', timezone: ZONE, createdAt,
      });
    }

    const staffCount = planName === 'STARTER' ? 3 : planName === 'PRO' ? 13 + index % 11 : 26 + index % 12;
    const firstStaff = ranges.staff.gte + index * STAFF_SLOTS;
    for (let slot = 0; slot < staffCount; slot++) {
      plan.staff.push({
        id: firstStaff + slot, companyId: id, name: `${NAME_MARKER}Staff ${slot + 1}`,
        email: `staff.${index}.${slot}${EMAIL_MARKER}`, locationId: firstLocation + slot % locationCount,
        shiftStart: at(createdAt, 8 * HOUR), shiftEnd: at(createdAt, 16 * HOUR), createdAt,
      });
    }

    if (customerId) {
      const price = priceFor(planName, index % 2 === 0 ? 'month' : 'year', catalog);
      plan.customers.push({
        id: customerId, companyId: id, name, email: ownerEmail, status: 'active',
        paddleCreatedAt: createdAt, paddleUpdatedAt: createdAt, lastEventAt: createdAt, createdAt,
      });
      const lastBillingDate = canceledAt ?? now;
      const [billingYear, billingMonth, billingDay] = formatInTimeZone(createdAt, ZONE, 'yyyy-MM-dd').split('-').map(Number);
      const intervalMonths = price.interval === 'year' ? 12 : 1;
      const billingDate = (cycle: number) => getZonedDayRange(
        new Date(Date.UTC(billingYear, billingMonth - 1 + cycle * intervalMonths, billingDay)), ZONE,
      ).start;
      let cycle = 0;
      let periodStart = createdAt;
      let periodEnd = billingDate(1);
      while (subscriptionId && periodEnd <= lastBillingDate) {
        cycle++;
        periodStart = periodEnd;
        periodEnd = billingDate(cycle + 1);
      }
      if (subscriptionId) {
        plan.subscriptions.push({
          id: subscriptionId, customerId, companyId: id,
          status: state === 'CANCELLED' ? 'canceled' : state === 'PAST_DUE' ? 'past_due' : 'active',
          priceId: price.priceId,
          productId: `${BILLING_MARKER}product_${planName.toLowerCase()}`,
          scheduledChangeAction: state === 'SCHEDULED_CANCEL' ? 'cancel' : null,
          scheduledChangeAt: state === 'SCHEDULED_CANCEL' ? periodEnd : null,
          currentBillingPeriodStart: periodStart, currentBillingPeriodEnd: periodEnd, canceledAt,
          paddleCreatedAt: createdAt, paddleUpdatedAt: lastBillingDate, lastEventAt: lastBillingDate, createdAt,
        });
      }
      for (let payment = 0; payment <= (subscriptionId ? cycle : 0); payment++) {
        const date = billingDate(payment);
        const status = !subscriptionId ? 'draft' : state === 'PAST_DUE' && payment === cycle ? 'past_due' : 'completed';
        plan.transactions.push({
          id: `${key}_transaction_${payment}`, companyId: id, customerId, subscriptionId,
          status, currencyCode: '', total: null,
          invoiceNumber: status === 'draft' ? null : `DEMO-28-${index}-${payment}`,
          paddleCreatedAt: date, paddleUpdatedAt: date, lastEventAt: date, createdAt: date,
        });
      }
    }

    if (!subscriptionId) continue;
    for (let age = DAYS - 1; age >= 0; age--) {
      const date = at(today, -age * DAY);
      if (date < createdAt || (canceledAt && date >= canceledAt)) continue;
      const sunday = formatInTimeZone(date, ZONE, 'i') === '7';
      const slots = sunday ? Number(index % 3 === 0) : 2 + (index + age) % 3;
      const shiftStart = at(date, 8 * HOUR);
      const shiftEnd = at(date, 16 * HOUR);
      const checkInTime = at(shiftStart, (index + age) % 12 * 60_000);
      if (checkInTime > now) continue;
      for (let slot = 0; slot < slots; slot++) {
        const staffSlot = (age * 4 + slot) % staffCount;
        const locationId = firstLocation + staffSlot % locationCount;
        const offset = (index * DAYS + age) * ACTIVITY_SLOTS + slot;
        if (slot < staffCount) {
          plan.attendance.push({
            id: ranges.attendance.gte + offset, staffId: firstStaff + staffSlot, locationId, date,
            expectedStart: shiftStart, expectedEnd: shiftEnd, checkInTime,
            checkOutTime: shiftEnd <= now ? shiftEnd : null,
            status: shiftEnd <= now ? 'CHECKED_OUT' : 'CHECKED_IN', createdAt: checkInTime,
          });
        }
        const taskEnd = at(shiftStart, (slot + 1) * HOUR);
        const late = (index + age + slot) % 7 === 0;
        const completedAt = at(taskEnd, (late ? 10 : -5) * 60_000);
        if (completedAt > now) continue;
        // Historical location activity has no template or current assignment.
        const task = {
          id: ranges.task.gte + offset, locationId, date, title: `${NAME_MARKER}Site cleaning ${slot + 1}`,
          shiftStart: at(taskEnd, -HOUR), shiftEnd: taskEnd, startedAt: at(taskEnd, -HOUR),
          status: 'COMPLETED', completedAt, staffSubmittedAt: completedAt, createdAt: date,
          completionOutcome: 'LEGACY_RECORDED', isLate: late, completionTiming: late ? 'LATE' : 'ON_TIME',
          lateMinutes: late ? 10 : 0, completionLateMinutes: late ? 10 : 0,
        } satisfies Prisma.TaskInstanceCreateManyInput;
        if (age < 30 && slot === 0 && (index + age) % 3 === 0) {
          addPhotoOutcome(plan, task, firstStaff + staffSlot, photoStates[(index + Math.floor(age / 3)) % photoStates.length], photoLocations);
        }
        plan.tasks.push(task);
      }
    }
  }
  return plan;
}

const markedCompany = { id: ranges.company, name: { startsWith: NAME_MARKER } } satisfies Prisma.CompanyWhereInput;
const companyScope = { company: markedCompany };
// Prisma emits LIKE for startsWith. Match the underscores in our markers literally.
const literalMarker = (marker: string) => ({ startsWith: marker.replaceAll('_', '\\_') });
const billingScope = { id: literalMarker(BILLING_MARKER), ...companyScope };
const markedLocation = { id: ranges.location, name: { startsWith: NAME_MARKER }, ...companyScope };
const markedStaff = { id: ranges.staff, email: { endsWith: EMAIL_MARKER }, ...companyScope };
const markedTask = { id: ranges.task, title: { startsWith: NAME_MARKER }, location: markedLocation };
const markedArea = { id: ranges.area, name: areaName, location: markedLocation };
const markedAreaItem = { id: ranges.areaItem, stableCode: literalMarker(PHOTO_MARKER), area: markedArea };
const markedPhotoTask = { ...markedTask, area: markedArea };
const markedVerificationItem = {
  id: ranges.verificationItem, task: markedPhotoTask, item: markedAreaItem,
};
const markedRequirement = { id: literalMarker(`${PHOTO_MARKER}requirement_`), item: markedVerificationItem };
const markedSession = { id: literalMarker(`${PHOTO_MARKER}session_`), task: markedPhotoTask };
const noChildren = { none: {} };

async function removePhotoHistory(tx: Prisma.TransactionClient) {
  // Resolve the shared ancestor scopes once to avoid repeating the same joins
  // through a slot, its session, and its requirement.
  const scopedRequirements = await tx.taskEvidenceRequirement.findMany({ where: markedRequirement, select: { id: true } });
  const scopedSessions = await tx.captureSession.findMany({ where: markedSession, select: { id: true } });
  const requirementIds = { in: scopedRequirements.map(row => row.id) };
  const sessionIds = { in: scopedSessions.map(row => row.id) };
  const markedSlot = { id: literalMarker(`${PHOTO_MARKER}slot_`), sessionId: sessionIds, requirementId: requirementIds };
  const markedAttempts = await tx.verificationAttempt.findMany({ where: {
    id: literalMarker(`${PHOTO_MARKER}attempt_`), sessionId: sessionIds, slot: markedSlot,
    requirementId: requirementIds, mediaAssetId: null, jobs: noChildren,
  }, select: { id: true } });
  let consumedSlots = 0;
  if (markedAttempts.length) {
    // The slot and its attempt reference each other with RESTRICT foreign keys.
    // Remove the marked pair in one statement so both FK checks can still run.
    await tx.$executeRaw`ALTER TABLE "VerificationAttempt" DISABLE TRIGGER retain_attempt`;
    consumedSlots = await tx.$executeRaw`
      WITH removed_attempts AS (
        DELETE FROM "VerificationAttempt" WHERE id = ANY(${markedAttempts.map(row => row.id)}::text[])
        RETURNING id, "slotId"
      )
      DELETE FROM "CaptureSlot" AS slot USING removed_attempts AS attempt
      WHERE slot.id = attempt."slotId" AND slot."attemptId" = attempt.id`;
    await tx.$executeRaw`ALTER TABLE "VerificationAttempt" ENABLE TRIGGER retain_attempt`;
  }
  const emptySlots = await tx.captureSlot.deleteMany({ where: { ...markedSlot, attempt: null } });
  const sessions = await tx.captureSession.deleteMany({ where: { id: sessionIds, slots: noChildren, attempts: noChildren } });
  let requirements = 0;
  let verificationItems = 0;
  // Only the marked history deletes below need an exception to retention.
  // The table locks keep the trigger changes private to this transaction.
  const removableRequirements = {
    id: requirementIds, slots: noChildren, attempts: noChildren, issues: noChildren, decisions: noChildren,
  };
  if (await tx.taskEvidenceRequirement.count({ where: removableRequirements })) {
    await tx.$executeRaw`ALTER TABLE "TaskEvidenceRequirement" DISABLE TRIGGER immutable_requirement`;
    requirements = (await tx.taskEvidenceRequirement.deleteMany({ where: removableRequirements })).count;
    await tx.$executeRaw`ALTER TABLE "TaskEvidenceRequirement" ENABLE TRIGGER immutable_requirement`;
  }
  const removableItems = { ...markedVerificationItem, requirements: noChildren };
  if (await tx.taskVerificationItem.count({ where: removableItems })) {
    await tx.$executeRaw`ALTER TABLE "TaskVerificationItem" DISABLE TRIGGER immutable_task_item`;
    verificationItems = (await tx.taskVerificationItem.deleteMany({ where: removableItems })).count;
    await tx.$executeRaw`ALTER TABLE "TaskVerificationItem" ENABLE TRIGGER immutable_task_item`;
  }
  return {
    verificationItems, requirements, sessions: sessions.count,
    slots: consumedSlots + emptySlots.count, attempts: markedAttempts.length,
  };
}

async function removeDemo(tx: Prisma.TransactionClient) {
  // Prevent new FK references between the checks below and the parent deletes.
  await seedStep('locking demo tables for removal', () => tx.$executeRaw`
    LOCK TABLE "Company", "PaddleCustomer", "PaddleSubscription", "PaddleTransaction",
      "Manager", "Staff", "Location", "TaskInstance", "Attendance", "Area", "AreaItem", "TaskAssignment",
      "TaskVerificationItem", "TaskEvidenceRequirement", "CaptureSession", "CaptureSlot", "VerificationAttempt" IN EXCLUSIVE MODE`);
  const photoHistory = await seedStep('removing demo photo history', () => removePhotoHistory(tx));
  const assignments = await tx.taskAssignment.deleteMany({ where: {
    id: ranges.assignment, reason: assignmentReason, isCurrent: false, taskInstance: markedPhotoTask, staff: markedStaff,
  } });
  const tasks = await tx.taskInstance.deleteMany({ where: {
    ...markedTask,
    assignments: noChildren, completionAttempts: noChildren, areaSubmissions: noChildren, referenceImages: noChildren,
    verificationItems: noChildren, captureSessions: noChildren, evidenceAssets: noChildren,
    followUpVerificationDecisions: noChildren, verificationException: null,
  } });
  const areaItems = await tx.areaItem.deleteMany({ where: {
    ...markedAreaItem, selections: noChildren, snapshots: noChildren, standards: noChildren,
  } });
  const areas = await tx.area.deleteMany({ where: {
    ...markedArea, items: noChildren, standards: noChildren, templates: noChildren, instances: noChildren, exceptions: noChildren,
  } });
  const attendance = await tx.attendance.deleteMany({ where: {
    id: ranges.attendance, staff: markedStaff, location: markedLocation,
  } });
  const transactions = await tx.paddleTransaction.deleteMany({ where: billingScope });
  const subscriptions = await tx.paddleSubscription.deleteMany({ where: { ...billingScope, transactions: noChildren } });
  const customers = await tx.paddleCustomer.deleteMany({ where: {
    ...billingScope, subscriptions: noChildren, transactions: noChildren,
  } });
  const staff = await tx.staff.deleteMany({ where: {
    ...markedStaff, taskTemplates: noChildren, taskInstances: noChildren, taskAssignments: noChildren,
    notifications: noChildren, pushDevices: noChildren,
  } });
  const managers = await tx.manager.deleteMany({ where: {
    id: ranges.manager, email: { endsWith: EMAIL_MARKER }, ...companyScope, assignedLocations: noChildren,
  } });
  const locations = await tx.location.deleteMany({ where: {
    ...markedLocation, staff: noChildren, managerAssignments: noChildren, areas: noChildren,
  } });
  const companies = await tx.company.deleteMany({ where: {
    ...markedCompany, paddleCustomer: null, paddleSubscriptions: noChildren, paddleTransactions: noChildren,
    managers: noChildren, staff: noChildren, locations: noChildren,
  } });
  if (await tx.company.count({ where: markedCompany })) {
    throw new SeedError('Demo removal rolled back because a marked company still has linked records.');
  }
  return {
    companies: companies.count, managers: managers.count, locations: locations.count, staff: staff.count,
    customers: customers.count, subscriptions: subscriptions.count, transactions: transactions.count,
    tasks: tasks.count, attendance: attendance.count, areas: areas.count, areaItems: areaItems.count,
    assignments: assignments.count, ...photoHistory,
  };
}

async function applyDemo(tx: Prisma.TransactionClient, plan: DemoPlan, password: string) {
  if (await tx.company.count({ where: markedCompany })) {
    throw new SeedError('Demo rows already exist. Use --remove before applying again.');
  }
  await seedStep('creating demo companies, locations and users', async () => {
    await tx.company.createMany({ data: plan.companies });
    await tx.location.createMany({ data: plan.locations });
    await tx.manager.createMany({ data: plan.managers.map(row => ({ ...row, password })) });
    await tx.staff.createMany({ data: plan.staff.map(row => ({ ...row, password })) });
  });
  await seedStep('creating demo billing records', async () => {
    await tx.paddleCustomer.createMany({ data: plan.customers });
    await tx.paddleSubscription.createMany({ data: plan.subscriptions });
    await tx.paddleTransaction.createMany({ data: plan.transactions });
  });
  await seedStep('creating demo areas and tasks', async () => {
    await tx.area.createMany({ data: plan.areas });
    await tx.areaItem.createMany({ data: plan.areaItems });
    for (let offset = 0; offset < plan.tasks.length; offset += 500) {
      await tx.taskInstance.createMany({ data: plan.tasks.slice(offset, offset + 500) });
    }
  });
  await seedStep('creating demo photo history', async () => {
    await tx.taskAssignment.createMany({ data: plan.assignments });
    await tx.taskVerificationItem.createMany({ data: plan.verificationItems });
    // The requirement trigger checks that any current attempt already exists.
    await tx.taskEvidenceRequirement.createMany({
      data: plan.requirements.map(({ currentAttemptId, ...row }) => row),
    });
    await tx.captureSession.createMany({ data: plan.sessions });
    // Inserting the attempt consumes its slot and sets attemptId in PostgreSQL.
    await tx.captureSlot.createMany({ data: plan.slots.map(({ attemptId, ...row }) => row) });
    await tx.verificationAttempt.createMany({ data: plan.attempts });
    for (const { id, currentAttemptId } of plan.requirements) {
      await tx.taskEvidenceRequirement.update({ where: { id }, data: { currentAttemptId } });
    }
  });
  await seedStep('creating demo attendance', async () => {
    for (let offset = 0; offset < plan.attendance.length; offset += 500) {
      await tx.attendance.createMany({ data: plan.attendance.slice(offset, offset + 500) });
    }
  });
}

function summarize(plan: DemoPlan) {
  return Object.fromEntries(Object.entries(plan).map(([model, rows]) => [model, rows.length]));
}

type Database = Pick<PrismaClient, '$transaction' | '$disconnect'>;
async function connect(url: string): Promise<Database> {
  const { default: prismaClientPkg } = await import('@prisma/client');
  const { PrismaPg } = await import('@prisma/adapter-pg');
  const { PrismaClient } = prismaClientPkg;
  return new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
}

export async function runPlatformDemoSeed(args: string[], env: NodeJS.ProcessEnv, deps: {
  connect?: (url: string) => Promise<Database>;
  now?: () => Date;
  print?: (message: string) => void;
} = {}) {
  const mode = args[0] ?? '--dry-run';
  if (args.length > 1 || !['--dry-run', '--apply', '--remove'].includes(mode)) {
    throw new SeedError('Use one of --dry-run, --apply or --remove.');
  }
  const url = guardedDatabaseUrl(env);
  const print = deps.print ?? console.log;
  let plan: DemoPlan | null = null;
  if (mode !== '--remove') {
    try {
      plan = planPlatformDemo((deps.now ?? (() => new Date()))(), readCatalog(env));
    } catch (error) {
      if (mode !== '--dry-run' || !(error instanceof SeedError)) throw error;
      print(`Would create no rows. ${error.message}`);
      return;
    }
    if (mode === '--dry-run') {
      print(`Would create ${JSON.stringify(summarize(plan))}. ${unavailableTotals}`);
      return;
    }
  }

  const password = plan ? await seedStep('preparing demo credentials', () =>
    bcrypt.hash(randomBytes(32).toString('base64url'), 10)) : null;
  const db = await seedStep('connecting to the local database', () => (deps.connect ?? connect)(url));
  try {
    const transactionStep = mode === '--remove' ? 'removing demo rows' : 'applying demo rows';
    const counts = await seedStep(transactionStep, () => db.$transaction(async tx => {
      if (!plan || !password) return removeDemo(tx);
      await applyDemo(tx, plan, password);
      return summarize(plan);
    }, { timeout: 60_000 }));
    print(mode === '--remove'
      ? `Removed ${JSON.stringify(counts)}`
      : `Created ${JSON.stringify(counts)}. ${unavailableTotals}`);
  } finally {
    await seedStep('disconnecting from the local database', () => db.$disconnect());
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runPlatformDemoSeed(process.argv.slice(2), process.env).catch((error: unknown) => {
    console.error(error instanceof SeedError ? error.message : 'Platform demo seed failed. Check the local database and demo row markers.');
    process.exitCode = 1;
  });
}
