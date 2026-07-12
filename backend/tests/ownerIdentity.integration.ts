import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import bcrypt from 'bcrypt';
import { assertIsolatedMediaDatabase } from '../src/services/attendanceMediaTransition.service.js';
const url = process.env.OWNER_IDENTITY_TEST_DATABASE_URL;
assertIsolatedMediaDatabase(url, process.env.NODE_ENV); process.env.DATABASE_URL = url;
const { prisma } = await import('../src/prisma/prisma.js');
const { registerCompany } = await import('../src/services/companyRegistration.service.js');
const { createOwnerIdentityService } = await import('../src/services/ownerIdentity.service.js');
const { assertCredentialSession } = await import('../src/services/credentialSession.service.js');
const suffix = randomUUID(), currentPassword = 'synthetic-current-owner-password', newPassword = 'synthetic-new-owner-password';
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const denied = (code: number) => (error: any) => error.statusCode === code;
const messages: any[] = [];
const service = createOwnerIdentityService({ delivery: () => async message => { messages.push(message); } });
try {
    const owner = await registerCompany({ name: 'Synthetic identity owner', companyName: `Synthetic identity ${suffix}`, email: `${suffix}@example.invalid`, password: currentPassword });
    const companyBefore = await prisma.company.findUniqueOrThrow({ where: { id: owner.companyId } });
    const before = await prisma.manager.findUniqueOrThrow({ where: { id: owner.id } });
    assert.equal(before.emailVerifiedAt, null); assert.equal((await service.status(owner)).bootstrapRequired, false);
    assert.equal(await prisma.auditLog.count({ where: { companyId: owner.companyId, entityId: owner.id, action: 'OWNER_EMAIL_ENROLLMENT_ALLOWED' } }), 1);
    const request = await service.requestVerification(owner, { currentPassword }); assert.deepEqual(request, { requestAccepted: true, deliveryConfirmed: false });
    const verification = messages[0]; assert.ok(verification); assert.equal(JSON.stringify(request).includes(verification.token), false);
    const stored = await prisma.credentialToken.findUniqueOrThrow({ where: { tokenHash: hash(verification.token) } });
    assert.equal(stored.targetEmail, owner.email); assert.equal(stored.companyId, owner.companyId); assert.equal(stored.managerId, owner.id);
    assert.equal(+stored.expiresAt - +stored.createdAt, 24 * 60 * 60000);
    await assert.rejects(service.complete({ token: verification.token, newPassword }, 'RESET_OWNER_PASSWORD'), denied(400));
    const verifyRace = await Promise.allSettled([1, 2].map(() => service.complete({ token: verification.token }, 'VERIFY_OWNER_EMAIL')));
    assert.equal(verifyRace.filter(row => row.status === 'fulfilled').length, 1); assert.equal(verifyRace.filter(row => row.status === 'rejected' && row.reason.statusCode === 400).length, 1);
    const verified = await prisma.manager.findUniqueOrThrow({ where: { id: owner.id } });
    assert.ok(verified.emailVerifiedAt); assert.equal(verified.credentialVersion, before.credentialVersion + 1); assert.equal(verified.password, before.password); assert.equal(verified.refreshToken, null);
    assert.throws(() => assertCredentialSession(verified, { credentialVersion: before.credentialVersion }));
    const accepted = await service.requestRecovery({ email: owner.email }); await service.whenIdle();
    assert.deepEqual(await service.requestRecovery({ email: `${suffix}-unknown@example.invalid` }), accepted); await service.whenIdle();
    assert.equal(messages.length, 2); const recovery = messages.at(-1);
    const resetStored = await prisma.credentialToken.findUniqueOrThrow({ where: { tokenHash: hash(recovery.token) } });
    assert.equal(+resetStored.expiresAt - +resetStored.createdAt, 30 * 60000);
    const future = createOwnerIdentityService({ now: () => new Date(Date.now() + 31 * 60000) });
    await assert.rejects(future.complete({ token: recovery.token, newPassword }, 'RESET_OWNER_PASSWORD'), denied(400));
    await prisma.company.update({ where: { id: owner.companyId }, data: { isActive: false, operationalStatus: 'SUSPENDED' } });
    const resetRace = await Promise.allSettled([1, 2].map(() => service.complete({ token: recovery.token, newPassword }, 'RESET_OWNER_PASSWORD')));
    assert.equal(resetRace.filter(row => row.status === 'fulfilled').length, 1); assert.equal(resetRace.filter(row => row.status === 'rejected' && row.reason.statusCode === 400).length, 1);
    const reset = await prisma.manager.findUniqueOrThrow({ where: { id: owner.id } });
    assert.equal(await bcrypt.compare(newPassword, reset.password), true); assert.equal(reset.credentialVersion, verified.credentialVersion + 1); assert.equal(reset.refreshToken, null);
    assert.throws(() => assertCredentialSession(reset, { credentialVersion: verified.credentialVersion }));
    const companyAfter = await prisma.company.findUniqueOrThrow({ where: { id: owner.companyId } });
    assert.equal(companyAfter.isActive, false); assert.equal(companyAfter.operationalStatus, 'SUSPENDED'); assert.equal(companyAfter.plan, companyBefore.plan); assert.equal(companyAfter.billingCustomerId, companyBefore.billingCustomerId);
    await service.requestRecovery({ email: owner.email }); await service.whenIdle(); const rollbackToken = messages.at(-1).token;
    const broken = new Proxy(prisma, { get(target, key) {
        if (key === '$transaction') return (run: any) => target.$transaction(tx => run(new Proxy(tx, { get(inner, prop) {
            if (prop === 'auditLog') return { findFirst: tx.auditLog.findFirst.bind(tx.auditLog), create: async () => { throw new Error('Synthetic owner audit failure'); } };
            return Reflect.get(inner, prop);
        } })));
        return Reflect.get(target, key);
    } });
    const brokenService = createOwnerIdentityService({ db: broken });
    await assert.rejects(brokenService.complete({ token: rollbackToken, newPassword: 'synthetic-rollback-password' }, 'RESET_OWNER_PASSWORD'), /Synthetic owner audit failure/);
    assert.deepEqual(await prisma.manager.findUniqueOrThrow({ where: { id: owner.id } }), reset);
    assert.equal((await prisma.credentialToken.findUniqueOrThrow({ where: { tokenHash: hash(rollbackToken) } })).consumedAt, null);
    const legacy = await prisma.manager.create({ data: { name: 'Synthetic legacy owner', role: 'ADMIN', companyId: owner.companyId,
        email: `${suffix}-legacy@example.invalid`, password: currentPassword } });
    const legacyActor = { id: legacy.id, companyId: legacy.companyId, role: 'ADMIN' as const };
    assert.equal((await service.status(legacyActor)).bootstrapRequired, true);
    await assert.rejects(service.requestVerification(legacyActor, { currentPassword }), denied(403));
    const prior = messages.length; await service.requestRecovery({ email: legacy.email }); await service.whenIdle(); assert.equal(messages.length, prior);
    // Explicit synthetic qualified-bootstrap marker, never a real identity proof or production change.
    await prisma.auditLog.create({ data: { companyId: legacy.companyId, actorType: 'SYSTEM', actorId: null, entityType: 'MANAGER', entityId: legacy.id,
        action: 'OWNER_EMAIL_ENROLLMENT_ALLOWED', reason: 'Synthetic bootstrap fixture only', newValue: { source: 'IDENTITY_CHECKED_BOOTSTRAP', emailHash: hash(legacy.email), proofReference: 'synthetic-not-real-proof' } } });
    assert.equal((await service.status(legacyActor)).bootstrapRequired, false);
    await service.requestVerification(legacyActor, { currentPassword }); assert.equal(messages.length, prior + 1);
    const audit = await prisma.auditLog.findMany({ where: { companyId: owner.companyId } });
    for (const message of messages) assert.equal(JSON.stringify(audit).includes(message.token), false);
    assert.equal(await prisma.credentialToken.count({ where: { companyId: owner.companyId, managerId: owner.id, consumedAt: null } }), 1, 'only rolled-back reset link remains live');
    console.log('PASS isolated owner identity: atomic signup enrollment; legacy fail-closed/bootstrap fixture; scoped hashed24h/30m links; verification/reset concurrent consume one winner; bcrypt once; old epoch revoked; suspended company unchanged; neutral public requests; actual audit-failure credential/token rollback; no raw link tokens persisted. No real mail/provider/production calls.');
} finally { await service.whenIdle(); await prisma.$disconnect(); }
