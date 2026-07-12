import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { assertIsolatedMediaDatabase } from '../src/services/attendanceMediaTransition.service.js';
const url = process.env.PLATFORM_COMPANY_TEST_DATABASE_URL;
assertIsolatedMediaDatabase(url, process.env.NODE_ENV); process.env.DATABASE_URL = url;
const { prisma } = await import('../src/prisma/prisma.js');
const { registerCompany } = await import('../src/services/companyRegistration.service.js');
const { getPlatformCompany, setPlatformCompanyStatus } = await import('../src/services/platformCompany.service.js');
const { assertAccountAction } = await import('../src/services/accountAccess.service.js');
const actor = { kind: 'PLATFORM_OPERATOR' as const, issuer: 'https://identity.example.invalid/', subject: 'synthetic-isolated-operator' };
const suffix = randomUUID();
try {
    const owner = await registerCompany({ name: 'Synthetic operator boundary owner', companyName: `Synthetic platform fixture ${suffix}`,
        email: `${suffix}@example.invalid`, password: 'synthetic-owner-password' });
    const companyId = owner.companyId, before = await prisma.company.findUniqueOrThrow({ where: { id: companyId } });
    const second = await prisma.company.create({ data: { name: `Synthetic untouched fixture ${suffix}` } });
    const write = { expectedVersion: 0, operationalStatus: 'SUSPENDED', reason: 'Synthetic isolated review' };
    const race = await Promise.allSettled([setPlatformCompanyStatus(actor, companyId, write), setPlatformCompanyStatus(actor, companyId, write)]);
    assert.equal(race.filter(row => row.status === 'fulfilled').length, 1);
    const failed = race.find(row => row.status === 'rejected');
    assert.equal(failed?.status === 'rejected' ? failed.reason.statusCode : undefined, 409);
    const suspended = await prisma.company.findUniqueOrThrow({ where: { id: companyId } });
    assert.equal(suspended.accountVersion, 1); assert.equal(suspended.isActive, before.isActive);
    assert.equal(suspended.subscriptionStatus, before.subscriptionStatus); assert.equal(suspended.plan, before.plan);
    assert.ok(suspended.suspendedAt); assert.equal(suspended.suspensionReason, write.reason);
    await assert.rejects(assertAccountAction(owner, 'READ_OPERATIONAL'), (error: any) => error.statusCode === 403);
    await assertAccountAction(owner, 'OWNER_BILLING'); await assertAccountAction(owner, 'OWN_SECURITY');
    const audits = await prisma.auditLog.findMany({ where: { companyId, entityType: 'COMPANY_ACCOUNT' } });
    assert.equal(audits.length, 1); assert.equal(audits[0]!.actorType, 'PLATFORM_OPERATOR'); assert.equal(audits[0]!.actorId, null);
    assert.deepEqual((audits[0]!.newValue as any).operator, { issuer: actor.issuer, subject: actor.subject });
    assert.equal(audits[0]!.reason, write.reason); assert.ok(audits[0]!.createdAt instanceof Date);
    // Inject a storage failure at the audit boundary; the real Company UPDATE must roll back.
    const broken = new Proxy(prisma, { get(target, key) {
        if (key === '$transaction') return (run: any) => target.$transaction(tx => run(new Proxy(tx, { get(inner, prop) {
            if (prop === 'auditLog') return { create: async () => { throw new Error('Synthetic audit storage failure'); } };
            return Reflect.get(inner, prop);
        } })));
        return Reflect.get(target, key);
    } });
    await assert.rejects(setPlatformCompanyStatus(actor, companyId, { ...write, expectedVersion: 1, operationalStatus: 'ACTIVE' }, broken), /Synthetic audit storage failure/);
    assert.deepEqual(await prisma.company.findUniqueOrThrow({ where: { id: companyId } }), suspended);
    const result = await setPlatformCompanyStatus(actor, companyId, { ...write, expectedVersion: 1, operationalStatus: 'ACTIVE' });
    assert.equal(result.changed, true); assert.equal(result.company.accountVersion, 2);
    await assertAccountAction(owner, 'READ_OPERATIONAL');
    assert.equal((await getPlatformCompany(actor, companyId)).activity.length, 2);
    const ownerAfter = await prisma.manager.findUniqueOrThrow({ where: { id: owner.id } });
    assert.equal(ownerAfter.isActive, true); assert.equal(ownerAfter.companyId, companyId);
    assert.deepEqual(await prisma.company.findUniqueOrThrow({ where: { id: second.id } }), second);
    const reactivated = await prisma.company.findUniqueOrThrow({ where: { id: companyId } });
    assert.equal(reactivated.suspendedAt, null); assert.equal(reactivated.suspensionReason, null);
    assert.equal(reactivated.billingCustomerId, before.billingCustomerId); assert.equal(reactivated.billingSubscriptionId, before.billingSubscriptionId);
    console.log('PASS isolated platform company persistence: concurrent one winner/one conflict; issuer/subject/reason/time durable; real status UPDATE rolls back on audit failure; suspension policy preserves owner billing/security; reactivation preserves billing/owner/other company. No production or provider calls.');
} finally { await prisma.$disconnect(); }
