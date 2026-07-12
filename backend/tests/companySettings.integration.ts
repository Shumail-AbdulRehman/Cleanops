import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { assertIsolatedMediaDatabase } from '../src/services/attendanceMediaTransition.service.js';
const url = process.env.COMPANY_SETTINGS_TEST_DATABASE_URL;
assertIsolatedMediaDatabase(url, process.env.NODE_ENV); process.env.DATABASE_URL = url;
const { prisma } = await import('../src/prisma/prisma.js');
const { registerCompany } = await import('../src/services/companyRegistration.service.js');
const { getCompanySettings, updateCompanySettings } = await import('../src/services/companySettings.service.js');
const { setPlatformCompanyStatus } = await import('../src/services/platformCompany.service.js');
const suffix = randomUUID();
try {
    const owner = await registerCompany({ name: 'Synthetic settings owner', companyName: `Synthetic company settings ${suffix}`,
        email: `${suffix}@example.invalid`, password: 'synthetic-owner-password' });
    const other = await prisma.company.create({ data: { name: `Synthetic untouched company ${suffix}` } });
    const ownerBefore = await prisma.manager.findUniqueOrThrow({ where: { id: owner.id } });
    const companyBefore = await prisma.company.findUniqueOrThrow({ where: { id: owner.companyId } });
    await assert.rejects(getCompanySettings({ ...owner, companyId: other.id }), (error: any) => error.statusCode === 403);
    const race = await Promise.allSettled(['Synthetic name A', 'Synthetic name B'].map(name => updateCompanySettings(owner, { name, expectedVersion: 0 })));
    assert.equal(race.filter(row => row.status === 'fulfilled').length, 1);
    assert.equal(race.filter(row => row.status === 'rejected' && row.reason.statusCode === 409).length, 1);
    const saved = await getCompanySettings(owner); assert.equal(saved.accountVersion, 1);
    const audits = await prisma.auditLog.findMany({ where: { companyId: owner.companyId, entityType: 'COMPANY_SETTINGS' } });
    assert.equal(audits.length, 1); assert.equal(audits[0]!.actorId, owner.id); assert.equal(audits[0]!.actorType, 'ADMIN');
    assert.equal((audits[0]!.newValue as any).name, saved.name); assert.ok(audits[0]!.createdAt instanceof Date);
    const broken = new Proxy(prisma, { get(target, key) {
        if (key === '$transaction') return (run: any) => target.$transaction(tx => run(new Proxy(tx, { get(inner, prop) {
            if (prop === 'auditLog') return { create: async () => { throw new Error('Synthetic settings audit failure'); } };
            return Reflect.get(inner, prop);
        } })));
        return Reflect.get(target, key);
    } });
    await assert.rejects(updateCompanySettings(owner, { name: 'Synthetic failed save', expectedVersion: 1 }, broken), /Synthetic settings audit failure/);
    assert.deepEqual(await getCompanySettings(owner), saved);
    const concurrentStatus = await Promise.allSettled([
        updateCompanySettings(owner, { name: 'Synthetic rename versus suspension', expectedVersion: 1 }),
        setPlatformCompanyStatus({ kind: 'PLATFORM_OPERATOR', issuer: 'https://identity.example.invalid/', subject: 'synthetic-operator' }, owner.companyId,
            { operationalStatus: 'SUSPENDED', expectedVersion: 1, reason: 'Synthetic concurrency review' }),
    ]);
    assert.equal(concurrentStatus.filter(row => row.status === 'fulfilled').length, 1);
    assert.equal(concurrentStatus.filter(row => row.status === 'rejected' && [403, 409].includes(row.reason.statusCode)).length, 1);
    const after = await prisma.company.findUniqueOrThrow({ where: { id: owner.companyId } });
    assert.equal(after.accountVersion, 2);
    assert.equal(after.billingCustomerId, companyBefore.billingCustomerId); assert.equal(after.billingSubscriptionId, companyBefore.billingSubscriptionId);
    assert.equal(after.plan, companyBefore.plan); assert.equal(after.subscriptionStatus, companyBefore.subscriptionStatus);
    assert.deepEqual(await prisma.manager.findUniqueOrThrow({ where: { id: owner.id } }), ownerBefore);
    assert.deepEqual(await prisma.company.findUniqueOrThrow({ where: { id: other.id } }), other);
    console.log('PASS isolated company settings: persisted owner/tenant denial; concurrent rename one winner; durable actor/name/time audit; real audit failure rollback; shared status/settings version one winner; billing/owner/other company unchanged. No production or provider calls.');
} finally { await prisma.$disconnect(); }
