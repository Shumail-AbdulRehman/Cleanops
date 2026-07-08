import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../prisma/prisma.js';
import { ApiError } from '../utils/ApiError.js';
import { assertLocationAccess } from '../utils/scope.js';
import { assertAccountAction } from './accountAccess.service.js';
import { writeAuditLog } from './auditLog.service.js';
import type { VerificationActor } from './verification-v2/authorization.service.js';
import type { VerificationTransaction } from './verification-v2/transaction.js';

type Db = Pick<typeof prisma, '$transaction'>;
const uuid = z.uuid().transform(value => value.toLowerCase());
const reason = z.string().trim().min(1).max(1000).refine(value => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value));
const appendInput = z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('NOTE'), reason, requestId: uuid }).strict(),
    z.object({ kind: z.literal('ACKNOWLEDGEMENT'), reason, requestId: uuid, parentId: uuid }).strict(),
]);
const pageInput = z.object({ after: uuid.optional(),
    limit: z.string().regex(/^[1-9]\d?$/).transform(Number).pipe(z.number().max(50)).optional() }).strict();
const select = { id: true, attendanceId: true, actorRole: true, actorId: true, kind: true, reason: true, parentId: true, createdAt: true } satisfies Prisma.AttendanceAnnotationSelect;
type Annotation = Prisma.AttendanceAnnotationGetPayload<{ select: typeof select }>;
const dto = (row: Annotation) => ({ id: row.id, attendanceId: row.attendanceId, actorRole: row.actorRole, actorId: row.actorId,
    kind: row.kind, reason: row.reason, parentId: row.parentId, createdAt: row.createdAt });
function tenantActor(actor: VerificationActor) {
    if (!actor || !['ADMIN', 'MANAGER', 'STAFF'].includes(actor.role) || !Number.isSafeInteger(actor.id) || actor.id < 1 ||
        !Number.isSafeInteger(actor.companyId) || actor.companyId < 1) throw new ApiError(403, 'Tenant account required');
}
function attendanceId(raw: unknown): number {
    const value = typeof raw === 'string' && /^[1-9]\d{0,9}$/.test(raw) ? Number(raw) : raw;
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1 || value > 2147483647) throw new ApiError(400, 'Invalid attendance identifier');
    return value;
}
async function scopedAttendance(tx: VerificationTransaction, actor: VerificationActor, id: number) {
    const row = await tx.attendance.findFirst({ where: { id, staff: { companyId: actor.companyId }, location: { companyId: actor.companyId },
        ...(actor.role === 'STAFF' ? { staffId: actor.id } : {}) }, select: { id: true, staffId: true, locationId: true } });
    if (!row) throw new ApiError(404, 'Attendance record not found');
    if (actor.role === 'MANAGER') {
        const assignment = await tx.managerLocation.findUnique({ where: { managerId_locationId: { managerId: actor.id, locationId: row.locationId } }, select: { locationId: true } });
        assertLocationAccess({ role: actor.role, locationIds: assignment ? [assignment.locationId] : [] }, row.locationId);
    }
    return row;
}

export async function listAttendanceAnnotations(actor: VerificationActor, rawId: unknown, rawQuery: unknown = {}, db: Db = prisma) {
    tenantActor(actor); const id = attendanceId(rawId), parsed = pageInput.safeParse(rawQuery);
    if (!parsed.success) throw new ApiError(400, 'Invalid annotation paging');
    const { after, limit = 25 } = parsed.data;
    return db.$transaction(async tx => {
        await assertAccountAction(actor, 'READ_OPERATIONAL', tx);
        await scopedAttendance(tx, actor, id);
        const where = { companyId: actor.companyId, attendanceId: id };
        if (after && !await tx.attendanceAnnotation.findFirst({ where: { ...where, id: after }, select: { id: true } })) throw new ApiError(400, 'Invalid annotation cursor');
        const rows = await tx.attendanceAnnotation.findMany({ where, select, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], take: limit + 1,
            ...(after ? { cursor: { id: after }, skip: 1 } : {}) });
        const page = rows.slice(0, limit);
        return { attendanceId: id, items: page.map(dto), nextCursor: rows.length > limit ? page.at(-1)!.id : null };
    }, { isolationLevel: 'RepeatableRead' });
}

export async function appendAttendanceAnnotation(actor: VerificationActor, rawId: unknown, raw: unknown, db: Db = prisma) {
    tenantActor(actor); const id = attendanceId(rawId), parsed = appendInput.safeParse(raw);
    if (!parsed.success) throw new ApiError(400, 'Enter a reason and a valid annotation request');
    const input = parsed.data, parentId = input.kind === 'ACKNOWLEDGEMENT' ? input.parentId : null;
    if (input.kind === 'ACKNOWLEDGEMENT' && actor.role === 'STAFF') throw new ApiError(403, 'Owner or assigned-site manager acknowledgement required');
    return db.$transaction(async tx => {
        // Immutable rows cannot be upserted. Serialize this actor/request across
        // attendance IDs, then compare exact saved intent before reusing it.
        const key = `attendance-annotation:${actor.companyId}:${actor.role}:${actor.id}:${input.requestId}`;
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 1523))::text`;
        await tx.$queryRaw`SELECT id FROM "Company" WHERE id=${actor.companyId} FOR SHARE`;
        if (actor.role === 'STAFF') await tx.$queryRaw`SELECT id FROM "Staff" WHERE id=${actor.id} FOR SHARE`;
        else await tx.$queryRaw`SELECT id FROM "Manager" WHERE id=${actor.id} FOR SHARE`;
        // Context does not create paid work/capacity; suspended accounts remain denied.
        await assertAccountAction(actor, 'READ_OPERATIONAL', tx);
        const initial = await scopedAttendance(tx, actor, id);
        // Same actor→target staff→attendance order as workforce/attendance writes.
        await tx.$queryRaw`SELECT id FROM "Staff" WHERE id=${initial.staffId} FOR SHARE`;
        await tx.$queryRaw`SELECT id FROM "Attendance" WHERE id=${id} FOR SHARE`;
        if (actor.role === 'MANAGER') await tx.$queryRaw`SELECT "managerId" FROM "ManagerLocation" WHERE "managerId"=${actor.id} AND "locationId"=${initial.locationId} FOR SHARE`;
        const row = await scopedAttendance(tx, actor, id);
        if (row.staffId !== initial.staffId || row.locationId !== initial.locationId) throw new ApiError(409, 'Attendance context changed. Reload before trying again.');
        const existing = await tx.attendanceAnnotation.findUnique({ where: { companyId_actorRole_actorId_requestId: {
            companyId: actor.companyId, actorRole: actor.role, actorId: actor.id, requestId: input.requestId,
        } }, select });
        if (existing) {
            if (existing.attendanceId !== id || existing.kind !== input.kind || existing.reason !== input.reason || existing.parentId !== parentId)
                throw new ApiError(409, 'This request identifier was already used for different context');
            return { annotation: dto(existing), reused: true };
        }
        if (parentId && !await tx.attendanceAnnotation.findFirst({ where: { id: parentId, companyId: actor.companyId, attendanceId: id, kind: 'NOTE' }, select: { id: true } }))
            throw new ApiError(404, 'Original attendance note not found');
        const saved = await tx.attendanceAnnotation.create({ data: { companyId: actor.companyId, attendanceId: id, actorRole: actor.role,
            actorId: actor.id, kind: input.kind, reason: input.reason, requestId: input.requestId, parentId }, select });
        await writeAuditLog({ companyId: actor.companyId, actorType: actor.role, actorId: actor.id, entityType: 'ATTENDANCE', entityId: id,
            action: input.kind === 'NOTE' ? 'ATTENDANCE_NOTE_ADDED' : 'ATTENDANCE_ACKNOWLEDGED',
            newValue: { annotationId: saved.id, kind: saved.kind, parentId: saved.parentId } }, tx);
        return { annotation: dto(saved), reused: false };
    });
}
