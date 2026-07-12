import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { assertIsolatedMediaDatabase } from '../src/services/attendanceMediaTransition.service.js';
const url = process.env.ATTENDANCE_ANNOTATION_TEST_DATABASE_URL;
assertIsolatedMediaDatabase(url, process.env.NODE_ENV); process.env.DATABASE_URL = url;
const { prisma } = await import('../src/prisma/prisma.js');
const { registerCompany } = await import('../src/services/companyRegistration.service.js');
const { appendAttendanceAnnotation, listAttendanceAnnotations } = await import('../src/services/attendanceAnnotation.service.js');
const suffix = randomUUID(), now = new Date();
const denied = (code: number) => (error: any) => error.statusCode === code;
try {
    const owner = await registerCompany({ name: 'Synthetic annotation owner', companyName: `Synthetic annotations ${suffix}`,
        email: `${suffix}-owner@example.invalid`, password: 'synthetic-owner-password' });
    const other = await registerCompany({ name: 'Synthetic other owner', companyName: `Synthetic other annotations ${suffix}`,
        email: `${suffix}-other@example.invalid`, password: 'synthetic-owner-password' });
    const companyId = owner.companyId;
    const oldSite = await prisma.location.create({ data: { name: 'Synthetic historical site', address: 'Fixture', companyId, latitude: '31', longitude: '74' } });
    const newSite = await prisma.location.create({ data: { name: 'Synthetic current site', address: 'Fixture', companyId, latitude: '31', longitude: '74' } });
    const worker = await prisma.staff.create({ data: { name: 'Synthetic transferred staff', email: `${suffix}-staff@example.invalid`, password: 'synthetic-worker-password', companyId, locationId: newSite.id } });
    const managerRow = await prisma.manager.create({ data: { name: 'Synthetic historical manager', email: `${suffix}-manager@example.invalid`, password: 'synthetic-manager-password', companyId, role: 'MANAGER' } });
    await prisma.managerLocation.create({ data: { managerId: managerRow.id, locationId: oldSite.id } });
    const manager = { id: managerRow.id, companyId, role: 'MANAGER' as const, locationIds: [newSite.id] };
    const staff = { id: worker.id, companyId, role: 'STAFF' as const, locationId: newSite.id };
    const data = { staffId: worker.id, locationId: oldSite.id, date: now, expectedStart: now, expectedEnd: new Date(+now + 3600000),
        checkInTime: now, checkInImage: `attendance:v1:${companyId}:${worker.id}:${randomUUID()}`, status: 'CHECKED_IN' as const };
    const attendance = await prisma.attendance.create({ data });
    // Another historical record only for proving parent/cursor/request binding.
    const second = await prisma.attendance.create({ data: { ...data, date: new Date(+now - 86400000), expectedStart: new Date(+now - 86400000), expectedEnd: new Date(+now - 82800000) } });
    const input = { kind: 'NOTE', reason: 'Synthetic connection failure reported', requestId: randomUUID() };
    const retry = await Promise.all([appendAttendanceAnnotation(staff, attendance.id, input), appendAttendanceAnnotation(staff, attendance.id, input)]);
    assert.equal(retry.filter(row => row.reused).length, 1); assert.equal(retry[0]!.annotation.id, retry[1]!.annotation.id);
    assert.equal(await prisma.attendanceAnnotation.count({ where: { attendanceId: attendance.id } }), 1);
    assert.equal(await prisma.auditLog.count({ where: { companyId, entityType: 'ATTENDANCE', entityId: attendance.id, action: 'ATTENDANCE_NOTE_ADDED' } }), 1);
    const parent = retry[0]!.annotation;
    const ackInput = { kind: 'ACKNOWLEDGEMENT', reason: 'Synthetic manager review', parentId: parent.id, requestId: randomUUID() };
    const ack = await appendAttendanceAnnotation(manager, attendance.id, ackInput);
    assert.equal(ack.annotation.parentId, parent.id); assert.equal(ack.annotation.actorRole, 'MANAGER'); assert.ok(ack.annotation.createdAt instanceof Date);
    await assert.rejects(appendAttendanceAnnotation(staff, attendance.id, { ...ackInput, requestId: randomUUID() }), denied(403));
    await assert.rejects(appendAttendanceAnnotation(manager, second.id, { ...ackInput, requestId: randomUUID() }), denied(404));
    await assert.rejects(appendAttendanceAnnotation(owner, attendance.id, { ...ackInput, parentId: ack.annotation.id, requestId: randomUUID() }), denied(404));
    await assert.rejects(appendAttendanceAnnotation(staff, attendance.id, { ...input, reason: 'Different immutable context' }), denied(409));
    await assert.rejects(appendAttendanceAnnotation(other, attendance.id, { ...input, requestId: randomUUID() }), denied(404));
    await assert.rejects(listAttendanceAnnotations(other, attendance.id), denied(404));
    await assert.rejects(listAttendanceAnnotations(staff, second.id, { after: parent.id }), denied(400));
    const firstPage = await listAttendanceAnnotations(staff, attendance.id, { limit: '1' }); assert.equal(firstPage.items.length, 1); assert.ok(firstPage.nextCursor);
    const secondPage = await listAttendanceAnnotations(staff, attendance.id, { limit: '1', after: firstPage.nextCursor });
    assert.equal(secondPage.items.length, 1); assert.notEqual(firstPage.items[0]!.id, secondPage.items[0]!.id); assert.equal(secondPage.nextCursor, null);
    assert.deepEqual(await prisma.attendance.findUniqueOrThrow({ where: { id: attendance.id } }), attendance);
    assert.equal(JSON.stringify(firstPage).includes('checkInImage'), false);
    await assert.rejects(prisma.attendanceAnnotation.update({ where: { id: parent.id }, data: { reason: 'Synthetic forbidden rewrite' } }));
    await assert.rejects(prisma.attendanceAnnotation.delete({ where: { id: parent.id } }));
    const broken = new Proxy(prisma, { get(target, key) {
        if (key === '$transaction') return (run: any) => target.$transaction(tx => run(new Proxy(tx, { get(inner, prop) {
            if (prop === 'auditLog') return { create: async () => { throw new Error('Synthetic annotation audit failure'); } };
            return Reflect.get(inner, prop);
        } })));
        return Reflect.get(target, key);
    } });
    const failed = { ...input, requestId: randomUUID() };
    await assert.rejects(appendAttendanceAnnotation(staff, attendance.id, failed, broken), /Synthetic annotation audit failure/);
    assert.equal(await prisma.attendanceAnnotation.count({ where: { companyId, requestId: failed.requestId } }), 0);
    assert.equal((await appendAttendanceAnnotation(staff, attendance.id, failed)).reused, false);
    const contested = { ...input, requestId: randomUUID() };
    const race = await Promise.allSettled([attendance.id, second.id].map(id => appendAttendanceAnnotation(owner, id, contested)));
    assert.equal(race.filter(row => row.status === 'fulfilled').length, 1);
    assert.equal(race.filter(row => row.status === 'rejected' && row.reason.statusCode === 409).length, 1);
    await prisma.managerLocation.delete({ where: { managerId_locationId: { managerId: manager.id, locationId: oldSite.id } } });
    await assert.rejects(appendAttendanceAnnotation({ ...manager, locationIds: [oldSite.id] }, attendance.id, ackInput), denied(403));
    await assert.rejects(listAttendanceAnnotations(manager, attendance.id), denied(403));
    await prisma.staff.update({ where: { id: worker.id }, data: { isActive: false } });
    await assert.rejects(appendAttendanceAnnotation(staff, attendance.id, input), denied(403));
    await prisma.company.update({ where: { id: companyId }, data: { operationalStatus: 'SUSPENDED' } });
    await assert.rejects(listAttendanceAnnotations(owner, attendance.id), denied(403));
    assert.deepEqual(await prisma.attendance.findUniqueOrThrow({ where: { id: attendance.id } }), attendance);
    console.log('PASS isolated attendance annotations: concurrent exact retry one immutable row/audit; cross-record request conflict; transferred staff own history; historical manager scope and revoked scope; tenant/parent/cursor denial; chronological paging; audit-failure rollback; SQL update/delete denial; original attendance/photo/time/status unchanged. No production/provider calls.');
} finally { await prisma.$disconnect(); }
