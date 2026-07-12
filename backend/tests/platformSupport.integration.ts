import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { Request, Response } from 'express';
import { assertIsolatedMediaDatabase } from '../src/services/attendanceMediaTransition.service.js';
const url = process.env.PLATFORM_SUPPORT_TEST_DATABASE_URL;
assertIsolatedMediaDatabase(url, process.env.NODE_ENV); process.env.DATABASE_URL = url;
const { prisma } = await import('../src/prisma/prisma.js');
const { createEnterpriseInquiry } = await import('../src/controllers/enterpriseInquiry.controller.js');
const { getPlatformDiagnostics, getPlatformInquiry, listPlatformAudit, listPlatformInquiries, updatePlatformInquiry } = await import('../src/services/platformSupport.service.js');
const actor = { kind: 'PLATFORM_OPERATOR' as const, issuer: 'https://identity.example.invalid/', subject: 'synthetic-first-operator' };
const secondActor = { ...actor, subject: 'synthetic-second-operator' };
const id = randomUUID(), marker = `Synthetic support ${id}`;
const body = { requestId: id, name: 'Synthetic lead contact', email: `${id}@example.invalid`, company: marker, locations: 2, staff: 10, requirements: 'Synthetic lead requirements' };
const denied = (code: number) => (error: any) => error.statusCode === code;
try {
    let status = 0, response: any;
    const res = { status(value: number) { status = value; return this; }, json(value: unknown) { response = value; return this; } } as unknown as Response;
    await createEnterpriseInquiry({ body } as Request, res); assert.equal(status, 201); assert.equal(response.data.received, true);
    const original = await prisma.enterpriseInquiry.findUniqueOrThrow({ where: { id } });
    await createEnterpriseInquiry({ body: { ...body, requirements: 'Synthetic changed retry body' } } as Request, res);
    assert.deepEqual(await prisma.enterpriseInquiry.findUniqueOrThrow({ where: { id } }), original);
    const initial = await getPlatformInquiry(actor, id); assert.equal(initial.handling.version, 0); assert.equal(initial.contactVerification, 'UNVERIFIED');
    const update = { expectedVersion: 0, status: 'IN_PROGRESS', ownership: 'SELF', reason: 'Synthetic queue triage' };
    const race = await Promise.allSettled([actor, secondActor].map(person => updatePlatformInquiry(person, id, update)));
    assert.equal(race.filter(row => row.status === 'fulfilled').length, 1);
    assert.equal(race.filter(row => row.status === 'rejected' && row.reason.statusCode === 409).length, 1);
    const saved = await getPlatformInquiry(actor, id); assert.ok(saved.handling.version > 0); assert.equal(saved.handling.status, 'IN_PROGRESS');
    assert.ok([actor.subject, secondActor.subject].includes(saved.handling.owner!.subject));
    const audit = await prisma.auditLog.findUniqueOrThrow({ where: { id: saved.handling.version } });
    assert.equal(audit.actorType, 'PLATFORM_OPERATOR'); assert.equal(audit.actorId, null); assert.equal(audit.reason, update.reason);
    assert.equal((audit.newValue as any).operator.subject, saved.handling.owner!.subject); assert.ok(audit.createdAt instanceof Date);
    const page = await listPlatformInquiries(actor, { q: marker, limit: '1' });
    assert.equal(page.items.length, 1); assert.equal(page.items[0]!.id, id); assert.deepEqual(page.items[0]!.handling, saved.handling);
    assert.equal(JSON.stringify(page).includes(body.email), false); assert.equal(JSON.stringify(page).includes(body.requirements), false);
    const broken = new Proxy(prisma, { get(target, key) {
        if (key === '$transaction') return (run: any) => target.$transaction(tx => run(new Proxy(tx, { get(inner, prop) {
            if (prop === 'auditLog') return { ...tx.auditLog, findFirst: tx.auditLog.findFirst.bind(tx.auditLog), create: async () => { throw new Error('Synthetic support audit failure'); } };
            return Reflect.get(inner, prop);
        } })));
        return Reflect.get(target, key);
    } });
    const close = { ...update, expectedVersion: saved.handling.version, status: 'CLOSED', ownership: 'UNASSIGNED' };
    await assert.rejects(updatePlatformInquiry(actor, id, close, broken), /Synthetic support audit failure/);
    assert.deepEqual((await getPlatformInquiry(actor, id)).handling, saved.handling);
    const result = await updatePlatformInquiry(actor, id, close); assert.equal(result.handling.status, 'CLOSED'); assert.equal(result.handling.owner, null);
    assert.equal((await updatePlatformInquiry(actor, id, { ...close, expectedVersion: result.handling.version })).changed, false);
    await assert.rejects(updatePlatformInquiry(actor, id, update), denied(409));
    await assert.rejects(getPlatformInquiry({ role: 'ADMIN', id: 7, companyId: 1 } as any, id), denied(403));
    const seed = await prisma.auditLog.create({ data: { actorType: 'STAFF', actorId: 999, entityType: 'COMPANY_ACCOUNT', entityId: 0,
        action: 'COMPANY_SUSPENDED', reason: 'PRIVATE_SENTINEL', newValue: { password: 'PRIVATE_SENTINEL', photo: 'PRIVATE_SENTINEL' } } });
    const redacted = await listPlatformAudit(actor, { after: String(seed.id + 1), limit: '50' });
    assert.equal(redacted.items.some(row => row.id === seed.id), false); assert.equal(JSON.stringify(redacted).includes('PRIVATE_SENTINEL'), false);
    assert.ok(redacted.items.some(row => row.id === result.handling.version));
    for (const row of redacted.items) assert.deepEqual(Object.keys(row).sort(), ['id', 'companyId', 'action', 'actorType', 'createdAt'].sort());
    assert.equal(JSON.stringify(await getPlatformDiagnostics(actor, prisma, {})).includes('PRIVATE_SENTINEL'), false);
    assert.equal((await getPlatformDiagnostics(actor, prisma, {})).database, 'REACHABLE');
    assert.deepEqual(await prisma.enterpriseInquiry.findUniqueOrThrow({ where: { id } }), original);
    console.log('PASS isolated platform support: public durable inquiry source/retry preserved; concurrent queue change one winner/one409; operator/reason/time ownership persisted; audit failure leaves state unchanged; release/close/no-op/stale safety; operator-only reads; bounded inquiry/audit redaction; actual DB observations. No production/provider calls.');
} finally { await prisma.$disconnect(); }
