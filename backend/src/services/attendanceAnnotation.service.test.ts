import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { appendAttendanceAnnotation, listAttendanceAnnotations } from './attendanceAnnotation.service.js';
import type { VerificationActor } from './verification-v2/authorization.service.js';
const owner: VerificationActor = { id: 7, companyId: 1, role: 'ADMIN' };
const manager: VerificationActor = { id: 7, companyId: 1, role: 'MANAGER', locationIds: [99] };
const staff: VerificationActor = { id: 5, companyId: 1, role: 'STAFF', locationId: 99 };
const note = () => ({ kind: 'NOTE', reason: '  Synthetic missed checkout explanation  ', requestId: randomUUID() });
function harness() {
    const attendance = { id: 10, staffId: 5, locationId: 2, checkInTime: new Date('2026-10-20'), checkOutTime: null, status: 'CHECKED_IN', checkInImage: 'PRIVATE', latitude: 'PRIVATE' };
    let company: any = { id: 1, isActive: true, operationalStatus: 'ACTIVE', plan: 'STARTER', billingCustomerId: null, billingSubscriptionId: null };
    let rows: any[] = [], audits: any[] = [];
    const tx = {
        $queryRaw: vi.fn(async () => []),
        staff: { findFirst: vi.fn(async (): Promise<any> => ({ id: 5, companyId: 1, role: 'STAFF', isActive: true, locationId: 99 })) },
        manager: { findFirst: vi.fn(async (): Promise<any> => ({ id: 7, companyId: 1, isActive: true })) },
        company: { findUnique: vi.fn(async () => company) }, paddleSubscription: { findFirst: vi.fn(async () => null) },
        managerLocation: { findUnique: vi.fn(async (): Promise<any> => ({ locationId: 2 })) },
        attendance: {
            findFirst: vi.fn(async ({ where }: any): Promise<any> => where.staffId && where.staffId !== attendance.staffId ? null : { ...attendance }),
            update: vi.fn(async () => { throw new Error('Never rewrite attendance'); }),
        },
        attendanceAnnotation: {
            findUnique: vi.fn(async ({ where }: any): Promise<any> => {
                const key = where.companyId_actorRole_actorId_requestId;
                return rows.find(row => row.companyId === key.companyId && row.actorRole === key.actorRole && row.actorId === key.actorId && row.requestId === key.requestId) ?? null;
            }),
            findFirst: vi.fn(async ({ where }: any): Promise<any> => rows.find(row => Object.entries(where).every(([key, value]) => row[key] === value)) ?? null),
            findMany: vi.fn(async (): Promise<any[]> => rows),
            create: vi.fn(async ({ data }: any): Promise<any> => { const row = { ...data, id: randomUUID(), createdAt: new Date(), privateField: 'PRIVATE' }; rows.push(row); return row; }),
        },
        auditLog: { create: vi.fn(async ({ data }: any) => { const row = { ...data, id: audits.length + 1 }; audits.push(row); return row; }) },
    };
    const db = { $transaction: vi.fn(async (run: any) => { const before = [...rows], prior = [...audits];
        try { return await run(tx); } catch (error) { rows = before; audits = prior; throw error; } }) };
    return { tx, db: db as any, attendance, get rows() { return rows; }, get audits() { return audits; }, setCompany: (change: any) => { company = { ...company, ...change }; } };
}

describe('persisted historical annotation authorization', () => {
    it.each(['PLATFORM_OPERATOR', 'SYSTEM', '', undefined])('denies invalid actor role %s without database access', async role => {
        const h = harness(), actor = { ...owner, role } as VerificationActor;
        await expect(appendAttendanceAnnotation(actor, 10, note(), h.db)).rejects.toMatchObject({ statusCode: 403 });
        await expect(listAttendanceAnnotations(actor, 10, {}, h.db)).rejects.toMatchObject({ statusCode: 403 });
        expect(h.db.$transaction).not.toHaveBeenCalled();
    });
    it('uses attendance historical site and persisted manager assignment, ignoring claimed current sites', async () => {
        const h = harness(); await appendAttendanceAnnotation(manager, 10, note(), h.db);
        expect(h.tx.managerLocation.findUnique).toHaveBeenCalledWith({ where: { managerId_locationId: { managerId: 7, locationId: 2 } }, select: { locationId: true } });
        expect(h.tx.attendance.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 10, staff: { companyId: 1 }, location: { companyId: 1 } } }));
    });
    it('denies unassigned manager even when token claims historical site access', async () => {
        const h = harness(); h.tx.managerLocation.findUnique.mockResolvedValue(null);
        const actor = { ...manager, locationIds: [2] };
        await expect(appendAttendanceAnnotation(actor, 10, note(), h.db)).rejects.toMatchObject({ statusCode: 403 });
        await expect(listAttendanceAnnotations(actor, 10, {}, h.db)).rejects.toMatchObject({ statusCode: 403 });
        expect(h.tx.attendanceAnnotation.create).not.toHaveBeenCalled();
    });
    it('allows transferred staff own historical attendance without current-site authority', async () => {
        const h = harness(); await appendAttendanceAnnotation(staff, 10, note(), h.db);
        expect(h.tx.attendance.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 10, staffId: 5, staff: { companyId: 1 }, location: { companyId: 1 } } }));
        expect(h.tx.managerLocation.findUnique).not.toHaveBeenCalled();
    });
    it('prevents staff/manager numeric ID collisions from granting another worker access', async () => {
        const h = harness(); await expect(appendAttendanceAnnotation({ ...staff, id: 7 }, 10, note(), h.db)).rejects.toMatchObject({ statusCode: 404 });
        expect(h.rows).toHaveLength(0);
    });
    it('returns missing for cross-company or inconsistent worker/site tenant binding', async () => {
        const h = harness(); h.tx.attendance.findFirst.mockResolvedValue(null);
        await expect(appendAttendanceAnnotation(owner, 10, note(), h.db)).rejects.toMatchObject({ statusCode: 404 });
        await expect(listAttendanceAnnotations(owner, 10, {}, h.db)).rejects.toMatchObject({ statusCode: 404 });
    });
    it.each(['STAFF', 'ADMIN'])('denies revoked/inactive/wrong-tenant persisted %s identity', async role => {
        const h = harness(); h.tx.staff.findFirst.mockResolvedValue(null); h.tx.manager.findFirst.mockResolvedValue(null);
        await expect(appendAttendanceAnnotation({ ...owner, role } as VerificationActor, 10, note(), h.db)).rejects.toMatchObject({ statusCode: 403 });
    });
    it.each([{ isActive: false }, { operationalStatus: 'SUSPENDED' }])('denies operational context for restricted company %j', async patch => {
        const h = harness(); h.setCompany(patch);
        await expect(appendAttendanceAnnotation(owner, 10, note(), h.db)).rejects.toMatchObject({ statusCode: 403 });
        await expect(listAttendanceAnnotations(owner, 10, {}, h.db)).rejects.toMatchObject({ statusCode: 403 });
    });
});

describe('immutable idempotent note and acknowledgement append', () => {
    it('records server identity/time, trimmed reason and audit while preserving original facts and excluding private fields', async () => {
        const h = harness(), before = structuredClone(h.attendance);
        const result = await appendAttendanceAnnotation(staff, '10', note(), h.db);
        expect(result).toMatchObject({ reused: false, annotation: { actorRole: 'STAFF', actorId: 5, attendanceId: 10, reason: 'Synthetic missed checkout explanation', createdAt: expect.any(Date), parentId: null } });
        expect(Object.keys(result.annotation).sort()).toEqual(['id', 'attendanceId', 'actorRole', 'actorId', 'kind', 'reason', 'parentId', 'createdAt'].sort());
        expect(h.attendance).toEqual(before); expect(h.tx.attendance.update).not.toHaveBeenCalled();
        expect(JSON.stringify(result)).not.toContain('PRIVATE');
        expect(h.audits).toEqual([expect.objectContaining({ companyId: 1, actorType: 'STAFF', actorId: 5, entityId: 10, entityType: 'ATTENDANCE', action: 'ATTENDANCE_NOTE_ADDED',
            newValue: { annotationId: result.annotation.id, kind: 'NOTE', parentId: null } })]);
    });
    it('reuses exact same actor/request/intent without a second row or audit', async () => {
        const h = harness(), input = note();
        const first = await appendAttendanceAnnotation(owner, 10, input, h.db);
        const second = await appendAttendanceAnnotation(owner, 10, { ...input, requestId: input.requestId.toUpperCase() }, h.db);
        expect(second).toEqual({ ...first, reused: true }); expect(h.rows).toHaveLength(1); expect(h.audits).toHaveLength(1);
    });
    it('denies reused request ID with different reason or attendance', async () => {
        const h = harness(), input = note(); await appendAttendanceAnnotation(owner, 10, input, h.db);
        await expect(appendAttendanceAnnotation(owner, 10, { ...input, reason: 'Changed context' }, h.db)).rejects.toMatchObject({ statusCode: 409 });
        await expect(appendAttendanceAnnotation(owner, 11, input, h.db)).rejects.toMatchObject({ statusCode: 409 });
        expect(h.rows).toHaveLength(1);
    });
    it('checks current scope before returning an old idempotent response', async () => {
        const h = harness(), input = note(); await appendAttendanceAnnotation(manager, 10, input, h.db);
        h.tx.managerLocation.findUnique.mockResolvedValue(null);
        await expect(appendAttendanceAnnotation(manager, 10, input, h.db)).rejects.toMatchObject({ statusCode: 403 });
    });
    it('keeps staff and manager request namespaces distinct even with colliding numeric IDs', async () => {
        const h = harness(), input = note();
        await appendAttendanceAnnotation({ ...staff, id: 5 }, 10, input, h.db);
        await appendAttendanceAnnotation({ ...manager, id: 5 }, 10, input, h.db);
        expect(h.rows).toHaveLength(2); expect(h.rows.map(row => row.actorRole)).toEqual(['STAFF', 'MANAGER']);
    });
    it.each(['ADMIN', 'MANAGER'])('appends %s acknowledgement tied to a NOTE without updating parent or original facts', async role => {
        const h = harness(), parent = await appendAttendanceAnnotation(staff, 10, note(), h.db), saved = structuredClone(h.rows[0]);
        const ack = await appendAttendanceAnnotation({ ...owner, role } as VerificationActor, 10, { kind: 'ACKNOWLEDGEMENT', reason: 'Reviewed with worker', parentId: parent.annotation.id, requestId: randomUUID() }, h.db);
        expect(ack.annotation).toMatchObject({ kind: 'ACKNOWLEDGEMENT', parentId: parent.annotation.id, actorRole: role });
        expect(h.rows[0]).toEqual(saved); expect(h.audits[1].action).toBe('ATTENDANCE_ACKNOWLEDGED');
    });
    it('denies staff acknowledgements before writing', async () => {
        const h = harness(); await expect(appendAttendanceAnnotation(staff, 10, { kind: 'ACKNOWLEDGEMENT', reason: 'Review', parentId: randomUUID(), requestId: randomUUID() }, h.db)).rejects.toMatchObject({ statusCode: 403 });
        expect(h.db.$transaction).not.toHaveBeenCalled();
    });
    it('rejects missing/other-company/other-attendance/non-note parent using exact scoped lookup', async () => {
        const h = harness(), parentId = randomUUID();
        await expect(appendAttendanceAnnotation(owner, 10, { kind: 'ACKNOWLEDGEMENT', reason: 'Review', parentId, requestId: randomUUID() }, h.db)).rejects.toMatchObject({ statusCode: 404 });
        expect(h.tx.attendanceAnnotation.findFirst).toHaveBeenCalledWith({ where: { id: parentId, companyId: 1, attendanceId: 10, kind: 'NOTE' }, select: { id: true } });
        expect(h.rows).toHaveLength(0);
    });
    it('rolls back annotation when audit storage fails', async () => {
        const h = harness(); h.tx.auditLog.create.mockRejectedValueOnce(new Error('Synthetic audit outage'));
        await expect(appendAttendanceAnnotation(owner, 10, note(), h.db)).rejects.toThrow('Synthetic audit outage');
        expect(h.rows).toHaveLength(0); expect(h.audits).toHaveLength(0);
    });
    it('conflicts if attendance bindings change while locks are acquired', async () => {
        const h = harness(); h.tx.attendance.findFirst.mockResolvedValueOnce(h.attendance).mockResolvedValueOnce({ ...h.attendance, locationId: 9 });
        await expect(appendAttendanceAnnotation(owner, 10, note(), h.db)).rejects.toMatchObject({ statusCode: 409 });
        expect(h.rows).toHaveLength(0);
    });
    it.each([{ reason: '' }, { reason: '  ' }, { reason: 'a'.repeat(1001) }, { reason: 'bad\u0000value' }, { requestId: 'bad' }, { kind: 'EDIT' },
        { actorRole: 'ADMIN' }, { actorId: 99 }, { companyId: 2 }, { createdAt: '2020-01-01' }, { parentId: randomUUID() }, { correctedHours: 8 }, { checkInTime: '2026-10-20' }])('rejects invalid/forged/correction input %j', async patch => {
        const h = harness(); await expect(appendAttendanceAnnotation(owner, 10, { ...note(), ...patch }, h.db)).rejects.toMatchObject({ statusCode: 400 });
        expect(h.db.$transaction).not.toHaveBeenCalled();
    });
    it('accepts multiline Urdu context using the same immutable contract', async () => {
        const h = harness(); const reason = 'انٹرنیٹ کی خرابی\nروانگی درج نہیں ہوئی';
        expect(await appendAttendanceAnnotation(staff, 10, { ...note(), reason }, h.db)).toMatchObject({ annotation: { reason } });
    });
});

describe('bounded annotation reads', () => {
    it('returns empty history honestly with default paging', async () => {
        const h = harness(); expect(await listAttendanceAnnotations(owner, 10, {}, h.db)).toEqual({ attendanceId: 10, items: [], nextCursor: null });
        expect(h.tx.attendanceAnnotation.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 26, where: { companyId: 1, attendanceId: 10 } }));
    });
    it('whitelists historical DTOs and scopes cursor with stable chronological order', async () => {
        const h = harness(); const first = await appendAttendanceAnnotation(owner, 10, note(), h.db); await appendAttendanceAnnotation(owner, 10, note(), h.db);
        const result = await listAttendanceAnnotations(owner, 10, { after: first.annotation.id, limit: '1' }, h.db);
        expect(result.items).toHaveLength(1); expect(result.nextCursor).toBe(result.items[0]!.id);
        expect(h.tx.attendanceAnnotation.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 2, cursor: { id: first.annotation.id }, skip: 1, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] }));
        expect(JSON.stringify(result)).not.toContain('PRIVATE');
    });
    it('rejects a cursor outside accessible attendance', async () => {
        const h = harness(); await expect(listAttendanceAnnotations(owner, 10, { after: randomUUID() }, h.db)).rejects.toMatchObject({ statusCode: 400 });
        expect(h.tx.attendanceAnnotation.findMany).not.toHaveBeenCalled();
    });
    it.each([{ limit: '0' }, { limit: '51' }, { limit: 1 }, { limit: ['1'] }, { after: 'not-uuid' }, { include: 'photos' }])('rejects malformed/unbounded queries %j', async input => {
        const h = harness(); await expect(listAttendanceAnnotations(owner, 10, input, h.db)).rejects.toMatchObject({ statusCode: 400 });
        expect(h.db.$transaction).not.toHaveBeenCalled();
    });
    it.each([0, -1, '01', '1.5', '2147483648', undefined])('rejects invalid attendance identifier %s', async id => {
        const h = harness(); await expect(listAttendanceAnnotations(owner, id, {}, h.db)).rejects.toMatchObject({ statusCode: 400 });
        await expect(appendAttendanceAnnotation(owner, id, note(), h.db)).rejects.toMatchObject({ statusCode: 400 });
    });
});

describe('attendance annotation route authentication', () => {
    it.each(['GET', 'POST'])('requires tenant JWT for %s and makes denial private/no-store', async method => {
        const express = (await import('express')).default;
        const router = (await import('../routes/attendanceAnnotation.route.js')).default;
        const app = express(); app.use(express.json()); app.use('/attendance', router);
        app.use((error: any, _req: any, res: any, _next: any) => res.status(error.statusCode ?? 500).json({ message: error.message }));
        const server = app.listen(0, '127.0.0.1'); await new Promise<void>(resolve => server.once('listening', resolve));
        const port = (server.address() as import('node:net').AddressInfo).port;
        try {
            const response = await fetch(`http://127.0.0.1:${port}/attendance/10/annotations`, { method,
                headers: { 'Content-Type': 'application/json' }, body: method === 'POST' ? JSON.stringify(note()) : undefined });
            expect(response.status).toBe(401); expect(response.headers.get('Cache-Control')).toBe('private, no-store');
        } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
    });
});
