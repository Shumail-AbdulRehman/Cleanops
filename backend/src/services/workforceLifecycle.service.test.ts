import { beforeEach, describe, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ tx: {
    $queryRaw: vi.fn(), staff: { findFirst: vi.fn(), update: vi.fn() }, manager: { findFirst: vi.fn(), update: vi.fn() },
    managerLocation: { findUnique: vi.fn(), findMany: vi.fn(), deleteMany: vi.fn() }, location: { findFirst: vi.fn() },
    attendance: { findFirst: vi.fn() }, taskTemplate: { updateMany: vi.fn() }, taskInstance: { updateMany: vi.fn() },
    taskAssignment: { updateMany: vi.fn() }, staffPushDevice: { updateMany: vi.fn() },
    credentialToken: { updateMany: vi.fn() }, captureSession: { updateMany: vi.fn() }, auditLog: { create: vi.fn() },
} }));
vi.mock('../prisma/prisma.js', () => ({ prisma: {} }));
import { deactivateWorkforce, transferStaff } from './workforceLifecycle.service.js';
const owner = { id: 1, companyId: 42, role: 'ADMIN' as const };
const manager = { id: 2, companyId: 42, role: 'MANAGER' as const };
const staff = { id: 7, companyId: 42, role: 'STAFF' as const, isActive: true, locationId: 20 };
const db = { $transaction: async (run: (tx: unknown) => unknown) => run(m.tx) } as unknown as NonNullable<Parameters<typeof transferStaff>[4]>;
const input = { reason: 'Worker requested site transfer', expectedLocationId: 20 };
beforeEach(() => {
    vi.resetAllMocks();
    m.tx.manager.findFirst.mockResolvedValue({ id: 2, role: 'MANAGER', isActive: true });
    m.tx.staff.findFirst.mockResolvedValue({ ...staff });
    m.tx.location.findFirst.mockImplementation(async ({ where }) => ({ id: where.id, companyId: 42, isActive: true }));
    m.tx.managerLocation.findUnique.mockResolvedValue({ managerId: 2 });
    m.tx.managerLocation.findMany.mockResolvedValue([{ locationId: 20 }]);
    m.tx.attendance.findFirst.mockResolvedValue(null);
    m.tx.$queryRaw.mockImplementation(async (sql: TemplateStringsArray) => sql.join('').includes('TaskInstance') ? [{ id: 9 }] : [{ id: 7 }]);
    for (const method of [m.tx.taskTemplate.updateMany, m.tx.taskInstance.updateMany, m.tx.captureSession.updateMany]) method.mockResolvedValue({ count: 1 });
});
const transfer = (actor = owner as typeof owner | typeof manager, body: unknown = input) => transferStaff(actor, 7, 30, body, db);
const offboard = (actor = owner as typeof owner | typeof manager, body: unknown = { reason: 'Employment ended' }) => deactivateWorkforce(actor, 'staff', 7, body, db);

describe('live tenant/site lifecycle authorization', () => {
    it('rejects staff actors before database work', async () => {
        await expect(transferStaff({ ...staff, id: 7 }, 7, 30, input, db)).rejects.toMatchObject({ statusCode: 403 });
        expect(m.tx.$queryRaw).not.toHaveBeenCalled();
    });
    it.each([0, -1, 1.5, NaN])('rejects invalid target identifiers %s', async id => {
        await expect(transferStaff(owner, id, 30, input, db)).rejects.toMatchObject({ statusCode: 400 });
    });
    it.each([undefined, {}, { reason: '' }, { reason: ' ', expectedLocationId: 20 }, { ...input, extra: 'unsafe' }])('requires explicit reason and current source', async body => {
        await expect(transferStaff(owner, 7, 30, body, db)).rejects.toMatchObject({ statusCode: 400 });
        expect(m.tx.staff.update).not.toHaveBeenCalled();
    });
    it('queries staff and live actor within the tenant rather than trusting request scopes', async () => {
        m.tx.staff.findFirst.mockResolvedValue(null);
        await expect(transfer()).rejects.toMatchObject({ statusCode: 404 });
        expect(m.tx.staff.findFirst).toHaveBeenCalledWith({ where: { id: 7, companyId: 42, role: 'STAFF' } });
        expect(m.tx.manager.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ companyId: 42, isActive: true, company: { isActive: true, operationalStatus: "ACTIVE" } }) }));
        expect(m.tx.staff.update).not.toHaveBeenCalled();
    });
    it('denies a deactivated issuer', async () => {
        m.tx.manager.findFirst.mockResolvedValue(null);
        await expect(transfer()).rejects.toMatchObject({ statusCode: 403 });
        expect(m.tx.staff.findFirst).not.toHaveBeenCalled();
    });
    it('requires both old and new assigned sites for a manager', async () => {
        m.tx.managerLocation.findUnique.mockImplementation(async ({ where }) => where.managerId_locationId.locationId === 20 ? {} : null);
        await expect(transfer(manager)).rejects.toMatchObject({ statusCode: 403 });
        expect(m.tx.staff.update).not.toHaveBeenCalled();
    });
    it('denies managers access to unassigned staff', async () => {
        m.tx.staff.findFirst.mockResolvedValue({ ...staff, locationId: null });
        await expect(offboard(manager)).rejects.toMatchObject({ statusCode: 403 });
    });
    it('denies cross-tenant or inactive destinations', async () => {
        m.tx.location.findFirst.mockImplementation(async ({ where }) => where.id === 30 ? null : { id: 20, isActive: true });
        await expect(transfer()).rejects.toMatchObject({ statusCode: 404 });
        m.tx.location.findFirst.mockResolvedValue({ id: 30, isActive: false });
        await expect(transfer()).rejects.toMatchObject({ statusCode: 409 });
    });
});

describe('transfer and open shift boundary', () => {
    it('rejects any checked-in unclosed shift, including old missed checkout', async () => {
        m.tx.attendance.findFirst.mockResolvedValue({ id: 10 });
        await expect(transfer()).rejects.toMatchObject({ statusCode: 409, errors: [{ code: 'OPEN_SHIFT', attendanceId: 10 }] });
        expect(m.tx.attendance.findFirst).toHaveBeenCalledWith({ where: { staffId: 7, checkInTime: { not: null }, checkOutTime: null }, select: { id: true } });
        expect(m.tx.staff.update).not.toHaveBeenCalled();
        expect(m.tx.taskInstance.updateMany).not.toHaveBeenCalled();
    });
    it('rejects stale source after concurrent transfer and inactive accounts', async () => {
        m.tx.staff.findFirst.mockResolvedValueOnce({ ...staff, locationId: 40 });
        await expect(transfer()).rejects.toMatchObject({ statusCode: 409 });
        m.tx.staff.findFirst.mockResolvedValueOnce({ ...staff, isActive: false });
        await expect(transfer()).rejects.toMatchObject({ statusCode: 409 });
    });
    it('same-site request is a no-op without revoking a session', async () => {
        const result = await transferStaff(owner, 7, 20, input, db);
        expect(result).toMatchObject({ changed: false });
        expect(m.tx.staff.update).not.toHaveBeenCalled(); expect(m.tx.auditLog.create).not.toHaveBeenCalled();
    });
    it('preserves history, removes incomplete eligibility and revokes stale credential/push/capture authority', async () => {
        const result = await transfer(manager);
        expect(result).toMatchObject({ locationId: 30, releasedTaskCount: 1, releasedScheduleCount: 1, signInRequired: true, historyPreserved: true });
        expect(m.tx.staff.update).toHaveBeenCalledWith({ where: { id: 7 }, data: { locationId: 30, refreshToken: null, credentialVersion: { increment: 1 } } });
        expect(m.tx.staffPushDevice.updateMany).toHaveBeenCalledWith({ where: { staffId: 7, companyId: 42 }, data: { enabled: false } });
        expect(m.tx.credentialToken.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { staffId: 7, companyId: 42, consumedAt: null } }));
        expect(m.tx.captureSession.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ state: 'REVOKED' }) }));
        expect(m.tx.taskAssignment.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ taskInstanceId: { in: [9] }, isCurrent: true }), data: expect.objectContaining({ status: 'CANCELLED', isCurrent: false }) }));
        const taskSql = m.tx.$queryRaw.mock.calls.find(call => call[0].join('').includes('TaskInstance'))![0].join('');
        expect(taskSql).toContain('"staffSubmittedAt" IS NULL'); expect(taskSql).not.toContain("'COMPLETED'");
        expect(m.tx.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ actorId: 2, companyId: 42, action: 'STAFF_TRANSFERRED', reason: input.reason }) }));
    });
});

describe('non-destructive workforce offboarding', () => {
    it('deactivates staff without deleting attendance, identity or evidence', async () => {
        const result = await offboard();
        expect(result).toMatchObject({ isActive: false, historyPreserved: true });
        expect(m.tx.staff.update).toHaveBeenCalledWith({ where: { id: 7 }, data: { isActive: false, refreshToken: null, credentialVersion: { increment: 1 } } });
        expect(m.tx.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ reason: 'Employment ended', action: 'STAFF_DEACTIVATED' }) }));
    });
    it('repeated deactivation is idempotent without another epoch or audit change', async () => {
        m.tx.staff.findFirst.mockResolvedValue({ ...staff, isActive: false });
        expect(await offboard()).toMatchObject({ changed: false, isActive: false });
        expect(m.tx.staff.update).not.toHaveBeenCalled(); expect(m.tx.auditLog.create).not.toHaveBeenCalled();
    });
    it('denies manager-to-manager offboarding and owner self-deactivation', async () => {
        await expect(deactivateWorkforce(manager, 'manager', 3, { reason: 'Invalid' }, db)).rejects.toMatchObject({ statusCode: 403 });
        await expect(deactivateWorkforce(owner, 'manager', owner.id, { reason: 'Invalid' }, db)).rejects.toMatchObject({ statusCode: 400 });
    });
    it('allows only the owner to offboard a tenant MANAGER and records released sites for handover', async () => {
        const result = await deactivateWorkforce(owner, 'manager', 2, { reason: 'Site handover' }, db);
        expect(result).toMatchObject({ releasedLocationCount: 1, historyPreserved: true });
        expect(m.tx.manager.findFirst).toHaveBeenCalledWith({ where: { id: 2, companyId: 42, role: 'MANAGER' } });
        expect(m.tx.manager.update).toHaveBeenCalledWith({ where: { id: 2 }, data: { isActive: false, refreshToken: null, credentialVersion: { increment: 1 } } });
        expect(m.tx.managerLocation.deleteMany).toHaveBeenCalledWith({ where: { managerId: 2 } });
        expect(m.tx.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ oldValue: { isActive: true, locationIds: [20] }, reason: 'Site handover' }) }));
    });
    it('fails the whole mutation if audit persistence fails', async () => {
        m.tx.auditLog.create.mockRejectedValue(new Error('audit write failed'));
        await expect(offboard()).rejects.toThrow('audit write failed');
    });
});
