import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ company: vi.fn(), subscription: vi.fn(), staff: vi.fn(), manager: vi.fn(), task: vi.fn(), attendance: vi.fn(), auditFind: vi.fn(), auditCreate: vi.fn(), count: vi.fn(), lock: vi.fn() }));
vi.mock('../prisma/prisma.js', () => ({ prisma: { company: { findUnique: m.company }, paddleSubscription: { findFirst: m.subscription }, staff: { findFirst: m.staff }, manager: { findFirst: m.manager } } }));
import { accountAccess } from '../middlewares/accountAccess.middleware.js';
import type { Request, Response } from 'express';
import { assertAccountAction, assertAccountCompletion, evaluateAccountAccess, readAccountState, recordWorkEntitlement, subscriptionWindow, withAccountCapacity, type AccountAction, type AccountRole, type AccountState } from './accountAccess.service.js';
const now = new Date('2026-10-20T12:00:00Z');
const from = new Date(+now - 3600000), until = new Date(+now + 3600000);
const owner = { id: 1, companyId: 42, role: 'ADMIN' as const }, worker = { id: 7, companyId: 42, role: 'STAFF' as const };
function state(): AccountState { return { company: { id: 42, plan: 'STARTER', isActive: true, operationalStatus: 'ACTIVE', billingCustomerId: 'customer-fixture', billingSubscriptionId: 'subscription-fixture' },
    subscription: { priceId: 'pri_00000000000000000000000001', id: 'subscription-fixture', companyId: 42, customerId: 'customer-fixture', status: 'active', currentBillingPeriodStart: from, currentBillingPeriodEnd: until, canceledAt: null, pausedAt: null, scheduledChangeAction: null, scheduledChangeAt: null } }; }
const tx = { company: { findUnique: m.company }, paddleSubscription: { findFirst: m.subscription }, staff: { findFirst: m.staff, count: m.count }, manager: { findFirst: m.manager, count: m.count }, location: { count: m.count }, taskInstance: { findFirst: m.task }, attendance: { findFirst: m.attendance }, auditLog: { findFirst: m.auditFind, create: m.auditCreate }, $queryRaw: m.lock } as unknown as Parameters<typeof readAccountState>[1];
const db = { $transaction: async (run: (tx: unknown) => unknown) => run(tx) } as unknown as NonNullable<Parameters<typeof withAccountCapacity>[3]>;
afterEach(() => vi.unstubAllEnvs());
beforeEach(() => { vi.stubEnv('PADDLE_ENVIRONMENT', 'sandbox'); vi.stubEnv('PADDLE_PRICE_CATALOG_JSON', JSON.stringify([{ plan: 'STARTER', interval: 'month', priceId: 'pri_00000000000000000000000001' }])); vi.resetAllMocks(); const current = state(); m.company.mockResolvedValue(current.company); m.subscription.mockResolvedValue(current.subscription); m.staff.mockResolvedValue({ id: 7 }); m.manager.mockResolvedValue({ id: 1 }); m.count.mockResolvedValue(0); m.task.mockResolvedValue({ startedAt: now }); m.attendance.mockResolvedValue({ checkInTime: now }); });
const roles: AccountRole[] = ['ADMIN', 'MANAGER', 'STAFF', 'SYSTEM'];
describe('plain account restriction policy', () => {
    it.each(roles)('%s retains operational reads when unentitled', role => {
        const current = state(); current.subscription = null;
        expect(() => evaluateAccountAccess(current, role, 'READ_OPERATIONAL', now)).not.toThrow();
        expect(() => evaluateAccountAccess(current, role, 'START_WORK', now)).toThrow('active subscription');
    });
    it.each(roles)('%s cannot operate a suspended account', role => {
        const current = state(); current.company.operationalStatus = 'SUSPENDED';
        for (const action of ['READ_OPERATIONAL', 'START_WORK', 'MANAGE_WORK', 'COMPLETE_WORK', 'ADD_CAPACITY'] as AccountAction[]) expect(() => evaluateAccountAccess(current, role, action, now)).toThrow('suspended');
    });
    it('treats legacy inactive company as suspended even if status says ACTIVE', () => {
        const current = state(); current.company.isActive = false;
        expect(() => evaluateAccountAccess(current, 'ADMIN', 'READ_OPERATIONAL', now)).toThrow('suspended');
    });
    it('permits only owner billing, own security and support while suspended', () => {
        const current = state(); current.company.operationalStatus = 'SUSPENDED';
        expect(() => evaluateAccountAccess(current, 'ADMIN', 'OWNER_BILLING', now)).not.toThrow();
        for (const role of ['MANAGER', 'STAFF', 'SYSTEM'] as AccountRole[]) expect(() => evaluateAccountAccess(current, role, 'OWNER_BILLING', now)).toThrow('owner');
        for (const role of ['ADMIN', 'MANAGER', 'STAFF'] as AccountRole[]) for (const action of ['OWN_SECURITY', 'SUPPORT'] as AccountAction[]) expect(() => evaluateAccountAccess(current, role, action, now)).not.toThrow();
    });
    it('never removes assigned manager reads or work because a lower plan lacks managerAccess', () => {
        expect(() => evaluateAccountAccess(state(), 'MANAGER', 'READ_OPERATIONAL', now)).not.toThrow();
        expect(() => evaluateAccountAccess(state(), 'MANAGER', 'MANAGE_WORK', now)).not.toThrow();
    });
    it.each(['MANAGE_WORK', 'ADD_CAPACITY'] as AccountAction[])('staff cannot %s', action => {
        expect(() => evaluateAccountAccess(state(), 'STAFF', action, now)).toThrow('Manager');
    });
    it.each(['ADMIN', 'MANAGER', 'SYSTEM'] as AccountRole[])('%s cannot finish staff work', role => {
        expect(() => evaluateAccountAccess(state(), role, 'COMPLETE_WORK', now)).toThrow('Staff');
    });
    it.each(['active', 'trialing'])('uses provider %s and its actual period for new work', status => {
        const current = state(); current.subscription!.status = status;
        expect(() => evaluateAccountAccess(current, 'STAFF', 'START_WORK', now)).not.toThrow();
        expect(() => evaluateAccountAccess(current, 'STAFF', 'START_WORK', until)).toThrow('active subscription');
    });
    it.each(['past_due', 'canceled', 'paused', 'unknown'])('does not invent grace for %s', status => {
        const current = state(); current.subscription!.status = status;
        expect(() => evaluateAccountAccess(current, 'STAFF', 'START_WORK', now)).toThrow('active subscription');
    });
    it.each([
        { currentBillingPeriodEnd: null }, { currentBillingPeriodStart: null },
        { currentBillingPeriodStart: until }, { currentBillingPeriodEnd: from },
        { canceledAt: from }, { pausedAt: from }, { scheduledChangeAction: 'cancel', scheduledChangeAt: now },
    ])('fails closed for unavailable/ended provider period %j', change => {
        const current = state(); Object.assign(current.subscription!, change);
        expect(() => evaluateAccountAccess(current, 'STAFF', 'START_WORK', now)).toThrow('active subscription');
    });
    it.each([{ id: 'other' }, { companyId: 99 }, { customerId: 'foreign' }])('never accepts another billing linkage %j', change => {
        const current = state(); Object.assign(current.subscription!, change);
        expect(subscriptionWindow(current)).toBeNull();
    });
    it('permits only server-proven already-started completion after loss of entitlement', () => {
        const current = state(); current.subscription = null;
        expect(() => evaluateAccountAccess(current, 'STAFF', 'COMPLETE_WORK', now, { startedAt: now, entitledFrom: from, entitledUntil: until })).not.toThrow();
        expect(() => evaluateAccountAccess(current, 'STAFF', 'COMPLETE_WORK', now)).toThrow('active subscription');
        expect(() => evaluateAccountAccess(current, 'STAFF', 'COMPLETE_WORK', now, { startedAt: new Date(+until + 1), entitledFrom: from, entitledUntil: until })).toThrow();
        current.company.operationalStatus = 'SUSPENDED';
        expect(() => evaluateAccountAccess(current, 'STAFF', 'COMPLETE_WORK', now, { startedAt: now, entitledFrom: from, entitledUntil: until })).toThrow('suspended');
    });
});

describe('persisted actor, work and entitlement facts', () => {
    it('does not trust a disabled principal or nonexistent company', async () => {
        m.manager.mockResolvedValue(null);
        await expect(assertAccountAction(owner, 'READ_OPERATIONAL', tx, now)).rejects.toMatchObject({ statusCode: 403 });
        m.company.mockResolvedValue(null);
        await expect(readAccountState(42, tx)).rejects.toMatchObject({ statusCode: 404 });
    });
    it('looks up the exact tenant/provider customer/subscription pair', async () => {
        await readAccountState(42, tx);
        expect(m.subscription).toHaveBeenCalledWith({ where: { id: 'subscription-fixture', companyId: 42, customerId: 'customer-fixture' } });
    });
    it('records a server-owned entitlement in the same work transaction', async () => {
        await recordWorkEntitlement(worker, { kind: 'task', id: 9 }, tx!, now);
        expect(m.task).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ id: 9, staffId: 7, location: { companyId: 42 } }) }));
        expect(m.auditCreate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ companyId: 42, actorId: 7, action: 'WORK_ENTITLEMENT_GRANTED', newValue: { startedAt: now.toISOString(), entitledFrom: from.toISOString(), entitledUntil: until.toISOString(), subscriptionId: 'subscription-fixture' } }) }));
    });
    it.each(['task', 'attendance'] as const)('allows persisted own %s completion with its exact start grant', async kind => {
        m.subscription.mockResolvedValue(null);
        m.auditFind.mockResolvedValue({ newValue: { startedAt: now.toISOString(), entitledFrom: from.toISOString(), entitledUntil: until.toISOString() } });
        await expect(assertAccountCompletion(worker, { kind, id: 9 }, tx, now)).resolves.toBeDefined();
        expect(m.auditFind).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ companyId: 42, actorId: 7, entityId: 9, entityType: kind === 'task' ? 'TASK_INSTANCE' : 'ATTENDANCE' }) }));
    });
    it.each([null, { startedAt: from.toISOString(), entitledFrom: from.toISOString(), entitledUntil: until.toISOString() }, { startedAt: now.toISOString(), entitledFrom: 'invalid', entitledUntil: until.toISOString() }])('rejects missing/mismatched/unproven legacy completion grant', async value => {
        m.subscription.mockResolvedValue(null); m.auditFind.mockResolvedValue(value ? { newValue: value } : null);
        await expect(assertAccountCompletion(worker, { kind: 'task', id: 9 }, tx, now)).rejects.toMatchObject({ statusCode: 403 });
    });
    it('never lets request start claims qualify another worker/tenant/task', async () => {
        m.task.mockResolvedValue(null);
        await expect(recordWorkEntitlement(worker, { kind: 'task', id: 9 }, tx!, now)).rejects.toMatchObject({ statusCode: 404 });
        expect(m.auditCreate).not.toHaveBeenCalled();
    });
});

describe('atomic capacity boundary', () => {
    it('locks company then subscription, rechecks capacity and uses the same transaction for creation', async () => {
        m.count.mockResolvedValueOnce(2).mockResolvedValueOnce(3);
        const create = vi.fn(async client => { expect(client).toBe(tx); return { id: 8 }; });
        expect(await withAccountCapacity(owner, 'staff', create, db, now)).toEqual({ id: 8 });
        expect(m.lock).toHaveBeenCalledBefore(m.company); expect(m.count).toHaveBeenCalledBefore(create);
        expect(m.count).toHaveBeenCalledWith({ where: { companyId: 42, isActive: true } });
    });
    it.each(['locations', 'staff', 'managers'] as const)('blocks net-new %s while at/above its existing plan limit', async resource => {
        m.count.mockResolvedValue(500); const create = vi.fn();
        await expect(withAccountCapacity(owner, resource, create, db, now)).rejects.toMatchObject({ statusCode: 403 });
        expect(create).not.toHaveBeenCalled();
        expect(() => evaluateAccountAccess(state(), 'MANAGER', 'READ_OPERATIONAL', now)).not.toThrow();
    });
    it('rejects a multi-create callback which would exceed the limit', async () => {
        m.count.mockResolvedValueOnce(2).mockResolvedValueOnce(4);
        await expect(withAccountCapacity(owner, 'staff', async () => {}, db, now)).rejects.toMatchObject({ statusCode: 403 });
    });
    it('denies capacity to staff and manager creation of owners/sites', async () => {
        await expect(withAccountCapacity(worker, 'staff', async () => {}, db, now)).rejects.toMatchObject({ statusCode: 403 });
        await expect(withAccountCapacity({ ...owner, role: 'MANAGER' }, 'locations', async () => {}, db, now)).rejects.toMatchObject({ statusCode: 403 });
        await expect(withAccountCapacity({ ...owner, role: 'MANAGER' }, 'managers', async () => {}, db, now)).rejects.toMatchObject({ statusCode: 403 });
    });
    it('blocks suspended or unentitled creation before calling creator', async () => {
        m.subscription.mockResolvedValue(null); const create = vi.fn();
        await expect(withAccountCapacity(owner, 'staff', create, db, now)).rejects.toMatchObject({ statusCode: 403 });
        expect(create).not.toHaveBeenCalled();
    });
});

describe('account policy middleware boundary', () => {
    it('denies an absent tenant identity', async () => {
        const next = vi.fn();
        await accountAccess('READ_OPERATIONAL')({} as Request, {} as Response, next);
        expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 401 }));
        expect(m.company).not.toHaveBeenCalled();
    });
    it('denies an operator context even if a tenant field is accidentally attached', async () => {
        const next = vi.fn();
        await accountAccess('READ_OPERATIONAL')({ user: owner, operator: { kind: 'PLATFORM_OPERATOR' } } as unknown as Request, {} as Response, next);
        expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 401 }));
    });
    it('checks current persistence and permits an active unpaid tenant read', async () => {
        const next = vi.fn(); m.subscription.mockResolvedValue(null);
        await accountAccess('READ_OPERATIONAL')({ user: owner } as Request, {} as Response, next);
        expect(next).toHaveBeenCalledWith(); expect(m.manager).toHaveBeenCalled();
    });
    it('propagates a suspension denial', async () => {
        const next = vi.fn(); m.company.mockResolvedValue({ ...state().company, operationalStatus: 'SUSPENDED' });
        await accountAccess('READ_OPERATIONAL')({ user: owner } as Request, {} as Response, next);
        expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 403 }));
    });
});

it.each(['ADMIN','MANAGER','STAFF'] as const)('attendance context write by %s needs active current entitlement but no capacity',role=>{
 expect(()=>evaluateAccountAccess(state(),role,'ANNOTATE_ATTENDANCE',now)).not.toThrow();
 const expired=state();expired.subscription=null;expect(()=>evaluateAccountAccess(expired,role,'ANNOTATE_ATTENDANCE',now)).toThrow('active subscription');
 const suspended=state();suspended.company.operationalStatus='SUSPENDED';expect(()=>evaluateAccountAccess(suspended,role,'ANNOTATE_ATTENDANCE',now)).toThrow('suspended');
});
