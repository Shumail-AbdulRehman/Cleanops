import type { PrismaClient } from '@prisma/client';
import { formatInTimeZone } from 'date-fns-tz';
import { describe, expect, it, vi } from 'vitest';
import { getPaddleCatalog } from '../src/config/paddle.js';
import { guardedDatabaseUrl, planPlatformDemo, runPlatformDemoSeed } from './platformDemoSeed.js';

const localUrl = 'postgresql://demo:demo@127.0.0.1:56445/hygene_ops_local';
const disposableUrl = 'postgres://demo:demo@127.0.0.1:5432/priv_e2e_test_0123456789abcdef0123456789abcdef';
const localEnv = { DATABASE_URL: localUrl };
const catalogEntries = ['STARTER', 'PRO', 'ADVANCED'].flatMap((plan, planIndex) =>
  ['month', 'year'].map((interval, intervalIndex) => ({
    plan, interval, priceId: `pri_${String(planIndex * 2 + intervalIndex).padStart(26, '0')}`,
  })),
);
const billingEnv = {
  ...localEnv, PADDLE_ENVIRONMENT: 'sandbox', PADDLE_PRICE_CATALOG_JSON: JSON.stringify(catalogEntries),
};
const now = new Date('2026-11-20T13:00:00Z');
const timeZone = 'Asia/Karachi';

describe('platform demo seed guard', () => {
  it.each([
    ['missing URL', undefined],
    ['malformed URL', 'postgresql:'],
    ['Heroku URL', 'postgresql://demo:demo@ec2-1-2-3-4.compute-1.amazonaws.com:5432/db?sslmode=require'],
    ['remote demo database', 'postgresql://demo:demo@192.0.2.1:56445/hygene_ops_local'],
    ['localhost alias', localUrl.replace('127.0.0.1', 'localhost')],
    ['loopback on the wrong port', localUrl.replace('56445', '5432')],
    ['non-demo loopback database', localUrl.replace('hygene_ops_local', 'postgres')],
    ['non-disposable e2e database', localUrl.replace('hygene_ops_local', 'priv_e2e_test')],
    ['near-miss disposable database', localUrl.replace('hygene_ops_local', 'priv_e2e_test_123456')],
    ['connection overrides', `${localUrl}?host=example.com`],
    ['fragment', `${localUrl}#unexpected`],
    ['wrong protocol', localUrl.replace('postgresql:', 'http:')],
  ])('rejects %s before connecting in every mode', async (_label, url) => {
    const connect = vi.fn();
    for (const args of [[], ['--apply'], ['--remove']]) {
      await expect(runPlatformDemoSeed(args, { DATABASE_URL: url }, { connect })).rejects.toThrow('allowed loopback');
    }
    expect(connect).not.toHaveBeenCalled();
  });

  it('accepts the local operator demo database and its exact disposable database pattern', () => {
    expect(guardedDatabaseUrl(localEnv)).toBe(localUrl);
    expect(guardedDatabaseUrl({ DATABASE_URL: disposableUrl })).toBe(disposableUrl);
  });

  it('refuses production mode even when the URL is on the allowlist', async () => {
    const connect = vi.fn();
    await expect(runPlatformDemoSeed(['--apply'], { ...localEnv, NODE_ENV: 'production' }, { connect }))
      .rejects.toThrow('Production mode is refused');
    expect(connect).not.toHaveBeenCalled();
  });

  it.each([['default', []], ['explicit', ['--dry-run']]])('uses a write-free %s dry run', async (_label, args) => {
    const connect = vi.fn();
    const print = vi.fn();
    await runPlatformDemoSeed(args, billingEnv, { connect, now: () => now, print });
    expect(connect).not.toHaveBeenCalled();
    expect(print).toHaveBeenCalledExactlyOnceWith(
      expect.stringMatching(/^Would create \{"companies":40,.*"attempts":[1-9]\d*\}\. Transaction totals unavailable/),
    );
  });

  it.each([
    ['absent', undefined, /Paddle catalog unavailable/],
    ['invalid', '{}', /Paddle catalog unavailable/],
    ['missing a plan', JSON.stringify(catalogEntries.slice(0, 4)), /missing a configured price for ADVANCED/],
  ])('reports an %s catalog before connecting, in dry-run and apply', async (_label, json, message) => {
    const env = { ...billingEnv, PADDLE_PRICE_CATALOG_JSON: json };
    const connect = vi.fn();
    const print = vi.fn();
    await runPlatformDemoSeed([], env, { connect, now: () => now, print });
    expect(print).toHaveBeenCalledExactlyOnceWith(expect.stringMatching(message));
    await expect(runPlatformDemoSeed(['--apply'], env, { connect, now: () => now })).rejects.toThrow(message);
    expect(connect).not.toHaveBeenCalled();
  });

  it.each([['--unknown'], ['--apply', '--remove']])('refuses invalid or conflicting arguments', async (...args) => {
    const connect = vi.fn();
    await expect(runPlatformDemoSeed(args, localEnv, { connect })).rejects.toThrow('Use one of');
    expect(connect).not.toHaveBeenCalled();
  });
});

describe('platform demo seed plan', () => {
  const catalog = getPaddleCatalog(billingEnv);
  const plan = planPlatformDemo(now, catalog);

  it('spans 12 consecutive signup months and all three plans', () => {
    expect(plan.companies).toHaveLength(40);
    expect(new Set(plan.companies.map(company => company.plan))).toEqual(new Set(['STARTER', 'PRO', 'ADVANCED']));
    const months = plan.companies.map(company => formatInTimeZone(company.createdAt as Date, timeZone, 'yyyy-MM'));
    expect([...new Set(months)]).toEqual([
      '2025-12', '2026-01', '2026-02', '2026-03', '2026-04', '2026-05',
      '2026-06', '2026-07', '2026-08', '2026-09', '2026-10', '2026-11',
    ]);
    expect(new Set(plan.companies.map(company => company.name)).size).toBe(40);
  });

  it('links billing mirrors for all five console states with paid and overdue invoices', () => {
    const subscriptions = new Map(plan.subscriptions.map(row => [row.id, row]));
    const customers = new Map(plan.customers.map(row => [row.id, row]));
    const states = plan.companies.map(company => {
      if (company.billingCustomerId) expect(customers.get(company.billingCustomerId)?.companyId).toBe(company.id);
      if (!company.billingSubscriptionId) return 'NONE';
      const subscription = subscriptions.get(company.billingSubscriptionId);
      expect(subscription?.companyId).toBe(company.id);
      expect(subscription?.customerId).toBe(company.billingCustomerId);
      return subscription?.scheduledChangeAction === 'cancel' ? 'SCHEDULED_CANCEL' : subscription?.status;
    });
    expect(new Set(states)).toEqual(new Set(['NONE', 'active', 'past_due', 'SCHEDULED_CANCEL', 'canceled']));
    expect(new Set(plan.transactions.map(row => row.status))).toEqual(new Set(['completed', 'past_due', 'draft']));
    for (const row of plan.transactions) {
      expect(customers.get(row.customerId!)?.companyId).toBe(row.companyId);
      if (row.subscriptionId) expect(subscriptions.get(row.subscriptionId)?.companyId).toBe(row.companyId);
      expect(row.total).toBeNull();
      expect(row.currencyCode).toBe('');
    }
  });

  it.each([['full', catalog], ['one interval per plan', catalog.filter(entry => entry.interval === 'year')]] as const)(
    'uses the %s catalog for each plan, billing period and linked invoice cadence',
    (_label, entries) => {
      const seeded = planPlatformDemo(now, entries);
      const pricesUsed = new Set<string>();
      const companies = new Map(seeded.companies.map(row => [row.id, row]));
      const monthIndex = (date: Date | string) => {
        const [year, month] = formatInTimeZone(date, timeZone, 'yyyy-MM').split('-').map(Number);
        return year * 12 + month;
      };
      for (const subscription of seeded.subscriptions) {
        const entry = entries.find(price => price.priceId === subscription.priceId)!;
        expect(entry?.plan).toBe(companies.get(subscription.companyId!)?.plan);
        pricesUsed.add(entry.priceId);
        const intervalMonths = entry.interval === 'year' ? 12 : 1;
        expect(monthIndex(subscription.currentBillingPeriodEnd!) - monthIndex(subscription.currentBillingPeriodStart!))
          .toBe(intervalMonths);
        const invoices = seeded.transactions.filter(row => row.subscriptionId === subscription.id);
        expect(invoices.length).toBeGreaterThan(0);
        for (const [cycle, invoice] of invoices.entries()) {
          expect(monthIndex(invoice.paddleCreatedAt!) - monthIndex(subscription.paddleCreatedAt!)).toBe(cycle * intervalMonths);
        }
      }
      expect(pricesUsed).toEqual(new Set(entries.map(entry => entry.priceId)));
    },
  );

  it('keeps locations, staff and managers within plan capacity and creates one owner per company', () => {
    const limits = { STARTER: [1, 3, 1], PRO: [5, 25, 3], ADVANCED: [20, 200, 20] };
    for (const company of plan.companies) {
      const locations = plan.locations.filter(row => row.companyId === company.id);
      const staff = plan.staff.filter(row => row.companyId === company.id);
      const managers = plan.managers.filter(row => row.companyId === company.id);
      const capacity = limits[company.plan!];
      expect(managers.filter(row => row.role === 'ADMIN')).toHaveLength(1);
      for (const [index, count] of [locations.length, staff.length, managers.length - 1].entries()) {
        expect(count).toBeGreaterThan(0);
        expect(count).toBeLessThanOrEqual(capacity[index]);
      }
      const locationIds = new Set(locations.map(row => row.id));
      expect(staff.every(row => locationIds.has(row.locationId!))).toBe(true);
    }
  });

  it('plans dated historical activity on 84 Karachi days with fewer rows on Sundays', () => {
    for (const rows of [plan.tasks, plan.attendance]) {
      const dates = rows.map(row => formatInTimeZone(row.date, timeZone, 'yyyy-MM-dd-e'));
      const days = new Set(dates);
      expect(days.size).toBe(84);
      expect([...days].sort()[0]).toMatch(/^2026-08-29/);
      expect([...days].sort().at(-1)).toMatch(/^2026-11-20/);
      const sundayRows = dates.filter(date => date.endsWith('-1')).length;
      expect(sundayRows).toBeGreaterThan(0);
      expect(sundayRows / 12).toBeLessThan((dates.length - sundayRows) / 72);
    }
    expect(plan.tasks.every(row => new Date(row.completedAt!) <= now && !row.staffId && !row.templateId)).toBe(true);
    expect(plan.attendance.every(row => new Date(row.checkInTime!) <= now)).toBe(true);
  });

  it('marks every row and keeps credentials and media out of the plan', () => {
    const marker = /^Platform Demo 28 - /;
    const email = /@platform-demo-28\.invalid$/;
    const paddleId = /^demo_platform28_/;
    expect([...plan.companies, ...plan.locations].every(row => marker.test(row.name))).toBe(true);
    expect([...plan.staff, ...plan.managers].every(row => email.test(row.email) && !('password' in row))).toBe(true);
    expect([...plan.customers, ...plan.subscriptions, ...plan.transactions].every(row => paddleId.test(row.id))).toBe(true);
    expect(plan.tasks.every(row => marker.test(row.title) && !row.proofImageUrls)).toBe(true);
    expect(plan.attendance.every(row => !row.checkInImage && !row.checkOutImage)).toBe(true);
    const integerRows = [...plan.companies, ...plan.locations, ...plan.staff, ...plan.managers, ...plan.tasks, ...plan.attendance];
    expect(integerRows.every(row => row.id! >= 1_928_000_000 && row.id! < 1_928_043_440)).toBe(true);
    expect(new Set(integerRows.map(row => row.id)).size).toBe(integerRows.length);
  });

  it('records four outcomes on recent tasks through marked, media-free verification chains', () => {
    expect(new Set(plan.attempts.map(row => row.state))).toEqual(new Set([
      'PASSED', 'RECAPTURE_REQUIRED', 'REVIEW_REQUIRED', 'CLEANING_REQUIRED',
    ]));
    expect(plan.attempts.length).toBeLessThan(plan.tasks.length);
    const tasks = new Map(plan.tasks.map(row => [row.id, row]));
    const areas = new Map(plan.areas.map(row => [row.id, row]));
    const fixtures = new Map(plan.areaItems.map(row => [row.id, row]));
    const assignments = new Map(plan.assignments.map(row => [row.id, row]));
    const staff = new Map(plan.staff.map(row => [row.id, row]));
    const snapshots = new Map(plan.verificationItems.map(row => [row.id, row]));
    const requirements = new Map(plan.requirements.map(row => [row.id, row]));
    const sessions = new Map(plan.sessions.map(row => [row.id, row]));
    const slots = new Map(plan.slots.map(row => [row.id, row]));
    const earliest = new Date('2026-10-21T19:00:00Z');

    for (const attempt of plan.attempts) {
      const session = sessions.get(attempt.sessionId)!;
      const slot = slots.get(attempt.slotId)!;
      const requirement = requirements.get(attempt.requirementId!)!;
      const snapshot = snapshots.get(requirement.taskVerificationItemId)!;
      const fixture = fixtures.get(snapshot.sourceAreaItemId)!;
      const assignment = assignments.get(session.assignmentId)!;
      const task = tasks.get(session.taskInstanceId)!;
      const area = areas.get(session.areaId)!;

      expect(attempt.mediaAssetId).toBeNull();
      expect(attempt.createdAt).toEqual(task.completedAt);
      expect(new Date(attempt.createdAt!).getTime()).toBeGreaterThanOrEqual(earliest.getTime());
      expect(new Date(attempt.createdAt!).getTime()).toBeLessThanOrEqual(now.getTime());
      expect(session).toMatchObject({ state: 'CLOSED', staffId: attempt.staffId, areaId: task.areaId });
      expect(slot).toMatchObject({ sessionId: session.id, requirementId: requirement.id, attemptId: attempt.id });
      expect(requirement).toMatchObject({ currentAttemptId: attempt.id, state: attempt.state });
      expect(snapshot).toMatchObject({ taskInstanceId: task.id, areaId: area.id, state: attempt.state });
      expect(fixture.areaId).toBe(area.id);
      expect(area.locationId).toBe(task.locationId);
      expect(assignment).toMatchObject({ taskInstanceId: task.id, staffId: session.staffId, isCurrent: false });
      expect(staff.get(assignment.staffId)?.locationId).toBe(task.locationId);
    }

    const textRows = [...plan.requirements, ...plan.sessions, ...plan.slots, ...plan.attempts];
    expect(textRows.every(row => row.id?.startsWith('demo_platform29_'))).toBe(true);
    const numericRows = [...plan.areas, ...plan.areaItems, ...plan.verificationItems, ...plan.assignments];
    expect(numericRows.every(row => row.id! >= 1_928_050_000 && row.id! < 1_928_079_440)).toBe(true);
    expect(new Set(numericRows.map(row => row.id)).size).toBe(numericRows.length);
  });
});

describe('platform demo seed transactions', () => {
  function fakeDatabase(remainingCompanies = 0) {
    const model = () => ({ deleteMany: vi.fn().mockResolvedValue({ count: 1 }), createMany: vi.fn().mockResolvedValue({ count: 1 }) });
    const tx = {
      company: { ...model(), count: vi.fn().mockResolvedValue(remainingCompanies) },
      manager: model(), location: model(), staff: model(), paddleCustomer: model(), paddleSubscription: model(),
      paddleTransaction: model(), taskInstance: model(), attendance: model(), $executeRaw: vi.fn().mockResolvedValue(1),
      area: model(), areaItem: model(), taskAssignment: model(),
      taskVerificationItem: { ...model(), count: vi.fn().mockResolvedValue(1) },
      taskEvidenceRequirement: {
        ...model(), count: vi.fn().mockResolvedValue(1), update: vi.fn(),
        findMany: vi.fn().mockResolvedValue([{ id: 'demo_platform29_requirement_1' }]),
      },
      captureSession: { ...model(), findMany: vi.fn().mockResolvedValue([{ id: 'demo_platform29_session_1' }]) },
      captureSlot: model(),
      verificationAttempt: { ...model(), findMany: vi.fn().mockResolvedValue([{ id: 'demo_platform29_attempt_1' }]) },
    };
    const transaction = vi.fn(async (fn: (client: typeof tx) => Promise<unknown>) => fn(tx));
    const disconnect = vi.fn();
    const connect = vi.fn(async () => ({
      $transaction: transaction, $disconnect: disconnect,
    } as unknown as Pick<PrismaClient, '$transaction' | '$disconnect'>));
    return { tx, connect, transaction, disconnect };
  }

  it('creates in parent-first order in one transaction using hashes for discarded random credentials', async () => {
    const { tx, connect, transaction, disconnect } = fakeDatabase();
    const print = vi.fn();
    await runPlatformDemoSeed(['--apply'], billingEnv, { connect, now: () => now, print });

    expect(connect).toHaveBeenCalledExactlyOnceWith(localUrl);
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(tx.company.createMany).toHaveBeenCalledBefore(tx.location.createMany);
    expect(tx.location.createMany).toHaveBeenCalledBefore(tx.staff.createMany);
    expect(tx.paddleCustomer.createMany).toHaveBeenCalledBefore(tx.paddleSubscription.createMany);
    expect(tx.paddleSubscription.createMany).toHaveBeenCalledBefore(tx.paddleTransaction.createMany);
    expect(tx.staff.createMany).toHaveBeenCalledBefore(tx.attendance.createMany);
    expect(tx.location.createMany).toHaveBeenCalledBefore(tx.area.createMany);
    expect(tx.area.createMany).toHaveBeenCalledBefore(tx.areaItem.createMany);
    expect(tx.area.createMany).toHaveBeenCalledBefore(tx.taskInstance.createMany);
    expect(tx.areaItem.createMany).toHaveBeenCalledBefore(tx.taskVerificationItem.createMany);
    expect(tx.taskInstance.createMany).toHaveBeenCalledBefore(tx.taskAssignment.createMany);
    expect(tx.taskInstance.createMany).toHaveBeenCalledBefore(tx.taskVerificationItem.createMany);
    expect(tx.taskAssignment.createMany).toHaveBeenCalledBefore(tx.captureSession.createMany);
    expect(tx.taskVerificationItem.createMany).toHaveBeenCalledBefore(tx.taskEvidenceRequirement.createMany);
    expect(tx.taskEvidenceRequirement.createMany).toHaveBeenCalledBefore(tx.captureSlot.createMany);
    expect(tx.captureSession.createMany).toHaveBeenCalledBefore(tx.captureSlot.createMany);
    expect(tx.captureSlot.createMany).toHaveBeenCalledBefore(tx.verificationAttempt.createMany);
    expect(tx.verificationAttempt.createMany).toHaveBeenCalledBefore(tx.taskEvidenceRequirement.update);
    const requirements = tx.taskEvidenceRequirement.createMany.mock.calls[0][0].data;
    expect(requirements.every((row: object) => !('currentAttemptId' in row))).toBe(true);
    const slots = tx.captureSlot.createMany.mock.calls[0][0].data;
    expect(slots.every((row: object) => !('attemptId' in row))).toBe(true);
    expect(tx.taskEvidenceRequirement.update).toHaveBeenCalledTimes(requirements.length);
    for (const { data } of [tx.manager.createMany.mock.calls[0][0], tx.staff.createMany.mock.calls[0][0]]) {
      expect(data.every((row: { password: string }) => /^\$2b\$10\$[./A-Za-z0-9]{53}$/.test(row.password))).toBe(true);
    }
    expect(tx.company.deleteMany).not.toHaveBeenCalled();
    expect(disconnect).toHaveBeenCalledTimes(1);
    expect(print).toHaveBeenCalledExactlyOnceWith(expect.stringMatching(/^Created \{"companies":40,/));
  });

  it('removes marked rows child-first in one transaction and guards against implicit deletes or updates', async () => {
    const { tx, connect, transaction } = fakeDatabase();
    await runPlatformDemoSeed(['--remove'], localEnv, { connect, print: vi.fn() });
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(tx.$executeRaw).toHaveBeenCalledBefore(tx.taskInstance.deleteMany);
    expect(tx.$executeRaw).toHaveBeenCalledBefore(tx.verificationAttempt.findMany);
    expect(tx.verificationAttempt.findMany).toHaveBeenCalledBefore(tx.captureSlot.deleteMany);
    expect(tx.$executeRaw.mock.calls[2][0].join('')).toContain('DELETE FROM "CaptureSlot"');
    expect(tx.$executeRaw.mock.calls[2][1]).toEqual(['demo_platform29_attempt_1']);
    expect(tx.$executeRaw.mock.invocationCallOrder[2]).toBeLessThan(tx.captureSlot.deleteMany.mock.invocationCallOrder[0]);
    expect(tx.captureSlot.deleteMany).toHaveBeenCalledBefore(tx.captureSession.deleteMany);
    expect(tx.captureSlot.deleteMany).toHaveBeenCalledBefore(tx.taskEvidenceRequirement.deleteMany);
    expect(tx.captureSession.deleteMany).toHaveBeenCalledBefore(tx.taskInstance.deleteMany);
    expect(tx.taskEvidenceRequirement.deleteMany).toHaveBeenCalledBefore(tx.taskVerificationItem.deleteMany);
    expect(tx.taskAssignment.deleteMany).toHaveBeenCalledBefore(tx.taskInstance.deleteMany);
    expect(tx.taskVerificationItem.deleteMany).toHaveBeenCalledBefore(tx.taskInstance.deleteMany);
    expect(tx.taskVerificationItem.deleteMany).toHaveBeenCalledBefore(tx.areaItem.deleteMany);
    expect(tx.areaItem.deleteMany).toHaveBeenCalledBefore(tx.area.deleteMany);
    expect(tx.taskInstance.deleteMany).toHaveBeenCalledBefore(tx.area.deleteMany);
    expect(tx.area.deleteMany).toHaveBeenCalledBefore(tx.location.deleteMany);
    expect(tx.taskInstance.deleteMany).toHaveBeenCalledBefore(tx.location.deleteMany);
    expect(tx.attendance.deleteMany).toHaveBeenCalledBefore(tx.staff.deleteMany);
    expect(tx.paddleTransaction.deleteMany).toHaveBeenCalledBefore(tx.paddleSubscription.deleteMany);
    expect(tx.paddleSubscription.deleteMany).toHaveBeenCalledBefore(tx.paddleCustomer.deleteMany);
    expect(tx.location.deleteMany).toHaveBeenCalledBefore(tx.company.deleteMany);

    const company = { id: { gte: 1_928_000_000, lt: 1_928_000_040 }, name: { startsWith: 'Platform Demo 28 - ' } };
    const location = { company, id: { gte: 1_928_000_300, lt: 1_928_000_380 }, name: company.name };
    const staff = { company, id: { gte: 1_928_000_500, lt: 1_928_002_100 }, email: { endsWith: '@platform-demo-28.invalid' } };
    const billing = { company, id: { startsWith: 'demo\\_platform28\\_' } };
    const noChildren = { none: {} };
    const sessionIds = { in: ['demo_platform29_session_1'] };
    const requirementIds = { in: ['demo_platform29_requirement_1'] };
    expect(tx.captureSession.findMany).toHaveBeenCalledExactlyOnceWith({
      where: expect.objectContaining({ id: { startsWith: 'demo\\_platform29\\_session\\_' } }),
      select: { id: true },
    });
    expect(tx.taskEvidenceRequirement.findMany).toHaveBeenCalledExactlyOnceWith({
      where: expect.objectContaining({ id: { startsWith: 'demo\\_platform29\\_requirement\\_' } }),
      select: { id: true },
    });
    expect(tx.verificationAttempt.findMany).toHaveBeenCalledExactlyOnceWith({
      where: {
        id: { startsWith: 'demo\\_platform29\\_attempt\\_' }, mediaAssetId: null, jobs: noChildren,
        sessionId: sessionIds, requirementId: requirementIds,
        slot: { id: { startsWith: 'demo\\_platform29\\_slot\\_' }, sessionId: sessionIds, requirementId: requirementIds },
      },
      select: { id: true },
    });
    expect(tx.taskEvidenceRequirement.deleteMany).toHaveBeenCalledExactlyOnceWith({ where: expect.objectContaining({
      slots: noChildren, attempts: noChildren, issues: noChildren, decisions: noChildren,
    }) });
    expect(tx.attendance.deleteMany).toHaveBeenCalledExactlyOnceWith({ where: {
      id: { gte: 1_928_030_000, lt: 1_928_043_440 }, staff, location,
    } });
    expect(tx.taskInstance.deleteMany).toHaveBeenCalledExactlyOnceWith({ where: {
      id: { gte: 1_928_010_000, lt: 1_928_023_440 }, title: company.name, location,
      assignments: noChildren, completionAttempts: noChildren, areaSubmissions: noChildren, referenceImages: noChildren,
      verificationItems: noChildren, captureSessions: noChildren, evidenceAssets: noChildren,
      followUpVerificationDecisions: noChildren, verificationException: null,
    } });
    expect(tx.paddleTransaction.deleteMany).toHaveBeenCalledExactlyOnceWith({ where: billing });
    expect(tx.paddleSubscription.deleteMany).toHaveBeenCalledExactlyOnceWith({ where: { ...billing, transactions: noChildren } });
    expect(tx.paddleCustomer.deleteMany).toHaveBeenCalledExactlyOnceWith({ where: {
      ...billing, subscriptions: noChildren, transactions: noChildren,
    } });
    expect(tx.manager.deleteMany).toHaveBeenCalledExactlyOnceWith({ where: {
      company, id: { gte: 1_928_000_100, lt: 1_928_000_220 }, email: staff.email, assignedLocations: noChildren,
    } });
    expect(tx.staff.deleteMany).toHaveBeenCalledExactlyOnceWith({ where: {
      ...staff, taskTemplates: noChildren, taskInstances: noChildren, taskAssignments: noChildren,
      notifications: noChildren, pushDevices: noChildren,
    } });
    expect(tx.location.deleteMany).toHaveBeenCalledExactlyOnceWith({ where: {
      ...location, staff: noChildren, managerAssignments: noChildren, areas: noChildren,
    } });
    expect(tx.company.deleteMany).toHaveBeenCalledExactlyOnceWith({ where: {
      ...company, paddleCustomer: null, paddleSubscriptions: noChildren, paddleTransactions: noChildren,
      managers: noChildren, staff: noChildren, locations: noChildren,
    } });
    expect(tx.company.createMany).not.toHaveBeenCalled();
  });

  it('aborts removal when an unmarked dependent keeps a demo company in place', async () => {
    const { connect, disconnect } = fakeDatabase(1);
    const print = vi.fn();
    await expect(runPlatformDemoSeed(['--remove'], localEnv, { connect, print })).rejects.toThrow('removal rolled back');
    expect(print).not.toHaveBeenCalled();
    expect(disconnect).toHaveBeenCalledTimes(1);
  });

  it('reports the failing step without including database error details', async () => {
    const { tx, connect, disconnect } = fakeDatabase();
    tx.taskEvidenceRequirement.createMany.mockRejectedValueOnce(new Error(`Database write failed at ${localUrl}`));
    const print = vi.fn();
    await expect(runPlatformDemoSeed(['--apply'], billingEnv, { connect, now: () => now, print }))
      .rejects.toThrow(/^Platform demo seed failed while creating demo photo history\.$/);
    expect(tx.verificationAttempt.createMany).not.toHaveBeenCalled();
    expect(print).not.toHaveBeenCalled();
    expect(disconnect).toHaveBeenCalledTimes(1);
  });
});
