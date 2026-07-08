import { z } from 'zod';
import { prepareStaffAttendance } from '../utils/syncAttendanceWindow.js';
import { prisma } from '../prisma/prisma.js';
import { ApiError } from '../utils/ApiError.js';
import { writeAuditLog } from './auditLog.service.js';
import { markCurrentAssignmentsForTasks } from './taskAssignment.service.js';
import { requireActiveActor, requireLocationAccess, requireOperationalRole, type VerificationActor } from './verification-v2/authorization.service.js';

type Db = Pick<typeof prisma, '$transaction'>;
type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];
const reason = z.string().trim().min(1).max(1000);
export const offboardInput = z.object({ reason }).strict();
export const transferInput = z.object({ reason, expectedLocationId: z.number().int().positive().nullable() }).strict();
function identifier(id: number) {
    if (!Number.isSafeInteger(id) || id < 1) throw new ApiError(400, 'Invalid workforce identifier');
}
function parse<T>(schema: z.ZodType<T>, raw: unknown): T {
    const result = schema.safeParse(raw);
    if (!result.success) throw new ApiError(400, 'Enter a reason and refresh the current workforce record');
    return result.data;
}
async function lockActor(tx: Tx, actor: VerificationActor) {
    requireOperationalRole(actor);
    // Credential changes/offboarding take the same actor lock before target rows.
    await tx.$queryRaw`SELECT id FROM "Manager" WHERE id=${actor.id} FOR SHARE`;
    await requireActiveActor(actor, tx);
}
async function scopedStaff(tx: Tx, actor: VerificationActor, staffId: number) {
    await tx.$queryRaw`SELECT id FROM "Staff" WHERE id=${staffId} FOR UPDATE`;
    const staff = await tx.staff.findFirst({ where: { id: staffId, companyId: actor.companyId, role: 'STAFF' } });
    if (!staff) throw new ApiError(404, 'Staff account not found');
    if (actor.role === 'MANAGER' && staff.locationId === null) throw new ApiError(403, 'Assigned-site access required');
    if (staff.locationId !== null) await requireLocationAccess(actor, staff.locationId, tx);
    return staff;
}
async function revokeStaffAccess(tx: Tx, staffId: number, companyId: number, at: Date) {
    await tx.staffPushDevice.updateMany({ where: { staffId, companyId }, data: { enabled: false } });
    await tx.credentialToken.updateMany({ where: { staffId, companyId, consumedAt: null }, data: { consumedAt: at } });
    const captures = await tx.captureSession.updateMany({ where: { staffId, state: { in: ['ACTIVE', 'PAUSED'] } }, data: { state: 'REVOKED', closedAt: at, rowVersion: { increment: 1 } } });
    return captures.count;
}
async function releaseStaffWork(tx: Tx, staffId: number, companyId: number, locationId: number | null, action: string) {
    // Preserve submitted/completed work and every evidence/attendance row. Only
    // incomplete, unsubmitted eligibility is removed; existing triggers revoke epochs.
    const tasks = await tx.$queryRaw<{ id: number }[]>`SELECT t.id FROM "TaskInstance" t JOIN "Location" l ON l.id=t."locationId"
        WHERE t."staffId"=${staffId} AND l."companyId"=${companyId} AND t."locationId"=${locationId} AND t."staffSubmittedAt" IS NULL
        AND t.status IN ('PENDING','IN_PROGRESS','NOT_COMPLETED_INTIME') ORDER BY t.id FOR UPDATE OF t`;
    const taskIds = tasks.map(task => task.id);
    const schedules = await tx.taskTemplate.updateMany({ where: { staffId, locationId: locationId ?? -1, isActive: true, location: { companyId } }, data: { staffId: null } });
    await markCurrentAssignmentsForTasks(taskIds, 'CANCELLED', action, tx as typeof prisma);
    await tx.taskInstance.updateMany({ where: { id: { in: taskIds } }, data: { staffId: null } });
    return { releasedTaskCount: taskIds.length, releasedScheduleCount: schedules.count };
}

export async function transferStaff(actor: VerificationActor, staffId: number, locationId: number, raw: unknown, db: Db = prisma) {
    requireOperationalRole(actor); identifier(staffId); identifier(locationId);
    const input = parse(transferInput, raw);
    return db.$transaction(async tx => {
        await lockActor(tx, actor);
        const staff = await scopedStaff(tx, actor, staffId);
        if (!staff.isActive) throw new ApiError(409, 'Staff account is inactive');
        if (staff.locationId !== input.expectedLocationId) throw new ApiError(409, 'Staff location changed. Refresh before transferring.');
        await tx.$queryRaw`SELECT id FROM "Location" WHERE id=${locationId} FOR SHARE`;
        const destination = await requireLocationAccess(actor, locationId, tx);
        if (!destination.isActive) throw new ApiError(409, 'Destination location is inactive');
        if (staff.locationId === locationId) return { id: staffId, locationId, changed: false };
        const openShift = await tx.attendance.findFirst({ where: { staffId, checkInTime: { not: null }, checkOutTime: null }, select: { id: true } });
        if (openShift) throw new ApiError(409, 'Finish the open attendance shift before transferring.', [{ code: 'OPEN_SHIFT', attendanceId: openShift.id }]);
        const impact = await releaseStaffWork(tx, staffId, actor.companyId, staff.locationId, 'STAFF_LOCATION_CHANGED');
        await revokeStaffAccess(tx, staffId, actor.companyId, new Date());
        await tx.staff.update({ where: { id: staffId }, data: { locationId, credentialVersion: { increment: 1 }, refreshToken: null } });
        const attendanceState = await prepareStaffAttendance(tx, staffId);
        await writeAuditLog({ companyId: actor.companyId, actorType: actor.role, actorId: actor.id,
            entityType: 'STAFF', entityId: staffId, action: 'STAFF_TRANSFERRED', reason: input.reason,
            oldValue: { locationId: staff.locationId }, newValue: { locationId, attendanceState, ...impact, sessionsRevoked: true } }, tx);
        return { id: staffId, locationId, changed: true, attendanceState, ...impact, signInRequired: true, historyPreserved: true };
    });
}

export async function deactivateWorkforce(actor: VerificationActor, entity: 'staff' | 'manager', id: number, raw: unknown, db: Db = prisma) {
    requireOperationalRole(actor); identifier(id);
    if (entity === 'manager' && actor.role !== 'ADMIN') throw new ApiError(403, 'Owner account required');
    const input = parse(offboardInput, raw);
    return db.$transaction(async tx => {
        await lockActor(tx, actor);
        if (entity === 'staff') {
            const staff = await scopedStaff(tx, actor, id);
            if (!staff.isActive) return { id, isActive: false, changed: false, historyPreserved: true };
            const impact = await releaseStaffWork(tx, id, actor.companyId, staff.locationId, 'STAFF_DEACTIVATED');
            await revokeStaffAccess(tx, id, actor.companyId, new Date());
            await tx.staff.update({ where: { id }, data: { isActive: false, refreshToken: null, credentialVersion: { increment: 1 } } });
            await writeAuditLog({ companyId: actor.companyId, actorType: actor.role, actorId: actor.id, entityType: 'STAFF', entityId: id,
                action: 'STAFF_DEACTIVATED', reason: input.reason, oldValue: { isActive: true, locationId: staff.locationId }, newValue: { isActive: false, ...impact, sessionsRevoked: true } }, tx);
            return { id, isActive: false, changed: true, historyPreserved: true, ...impact };
        }
        if (id === actor.id) throw new ApiError(400, 'You cannot deactivate your own account');
        await tx.$queryRaw`SELECT id FROM "Manager" WHERE id=${id} FOR UPDATE`;
        const manager = await tx.manager.findFirst({ where: { id, companyId: actor.companyId, role: 'MANAGER' } });
        if (!manager) throw new ApiError(404, 'Manager account not found');
        if (!manager.isActive) return { id, isActive: false, changed: false, historyPreserved: true };
        const sites = await tx.managerLocation.findMany({ where: { managerId: id }, select: { locationId: true } });
        await tx.manager.update({ where: { id }, data: { isActive: false, refreshToken: null, credentialVersion: { increment: 1 } } });
        await tx.credentialToken.updateMany({ where: { managerId: id, companyId: actor.companyId, consumedAt: null }, data: { consumedAt: new Date() } });
        await tx.managerLocation.deleteMany({ where: { managerId: id } });
        await writeAuditLog({ companyId: actor.companyId, actorType: actor.role, actorId: actor.id, entityType: 'MANAGER', entityId: id,
            action: 'MANAGER_DEACTIVATED', reason: input.reason, oldValue: { isActive: true, locationIds: sites.map(site => site.locationId) },
            newValue: { isActive: false, releasedLocationCount: sites.length, sessionsRevoked: true } }, tx);
        return { id, isActive: false, changed: true, historyPreserved: true, releasedLocationCount: sites.length };
    });
}
