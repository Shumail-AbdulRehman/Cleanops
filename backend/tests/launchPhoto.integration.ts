import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { assertIsolatedMediaDatabase } from '../src/services/attendanceMediaTransition.service.js';
const url = process.env.LAUNCH_PHOTO_TEST_DATABASE_URL;
assertIsolatedMediaDatabase(url, process.env.NODE_ENV); process.env.DATABASE_URL = url;
process.env.PADDLE_ENVIRONMENT='sandbox';
process.env.PADDLE_PRICE_CATALOG_JSON=JSON.stringify([{plan:'STARTER',interval:'month',priceId:'pri_00000000000000000000000001'}]);
process.env.VERIFICATION_SLOT_SECRET = 'synthetic-photo-contract-signing-fixture-only';
const { prisma } = await import('../src/prisma/prisma.js');
const { retakeSlots } = await import('../src/services/verification-v2/captureSession.service.js');
const { finishStaffSubmission } = await import('../src/services/verification-v2/staffSubmission.service.js');
const now = new Date(), end = new Date(+now + 3600000), suffix = randomUUID();
try {
    const company = await prisma.company.create({ data: { name: `Synthetic photo contract ${suffix}` } });
    const customerId=`ctm_synthetic_photo_${suffix}`,subscriptionId=`sub_synthetic_photo_${suffix}`;
    await prisma.paddleCustomer.create({data:{id:customerId,companyId:company.id,status:'active',paddleUpdatedAt:now,lastEventAt:now}});
    await prisma.paddleSubscription.create({data:{id:subscriptionId,customerId,companyId:company.id,status:'active',priceId:'pri_00000000000000000000000001',productId:'pro_synthetic',currentBillingPeriodStart:new Date(+now-3600000),currentBillingPeriodEnd:end,paddleUpdatedAt:now,lastEventAt:now}});
    await prisma.company.update({where:{id:company.id},data:{billingCustomerId:customerId,billingSubscriptionId:subscriptionId}});
    const location = await prisma.location.create({ data: { companyId: company.id, name: 'Synthetic photo site', address: 'Fixture', latitude: '31', longitude: '74' } });
    const area = await prisma.area.create({ data: { locationId: location.id, name: 'Synthetic room', roomType: 'WASHROOM', status: 'ACTIVE' } });
    const fixture = await prisma.areaItem.create({ data: { areaId: area.id, stableCode: 'SYNTHETIC-SINK', displayName: 'Synthetic sink', fixtureType: 'SINK', sequence: 1, rubricKey: 'sink', requiredViews: [] } });
    const staff = await prisma.staff.create({ data: { companyId: company.id, locationId: location.id, name: 'Synthetic staff', email: `${suffix}@example.invalid`, password: 'synthetic-password' } });
    const owner = await prisma.manager.create({ data: { companyId: company.id, role: 'ADMIN', name: 'Synthetic owner', email: `${suffix}-owner@example.invalid`, password: 'synthetic-password' } });
    const actor = { id: staff.id, role: 'STAFF' as const, companyId: company.id };
    async function fresh(state: 'RECAPTURE_REQUIRED' | 'REVIEW_REQUIRED') {
        const task = await prisma.taskInstance.create({ data: { title: 'Synthetic photo task', locationId: location.id, areaId: area.id, staffId: staff.id,
            verificationVersion: 2, areaNameSnapshot: area.name, inventoryVersion: 1, policySnapshot: { version: 1 }, date: now, shiftStart: now, shiftEnd: end, startedAt: now, status: 'IN_PROGRESS', verificationDeadline: end, uploadDeadline: end } });
        const assignment = await prisma.taskAssignment.create({ data: { taskInstanceId: task.id, staffId: staff.id, status: 'STARTED', startedAt: now } });
        const item = await prisma.taskVerificationItem.create({ data: { taskInstanceId: task.id, areaId: area.id, sourceAreaItemId: fixture.id,
            itemCodeSnapshot: fixture.stableCode, nameSnapshot: fixture.displayName, typeSnapshot: 'SINK', orderSnapshot: 1, identificationSnapshot: {}, rubricSnapshot: {} } });
        const requirement = await prisma.taskEvidenceRequirement.create({ data: { taskVerificationItemId: item.id, viewKey: 'basin', instructionsSnapshot: 'Synthetic required view', state, decisionVersion: 1 } });
        const session = await prisma.captureSession.create({ data: { taskInstanceId: task.id, areaId: area.id, staffId: staff.id, assignmentId: assignment.id, assignmentEpoch: task.assignmentEpoch,
            deviceId: 'synthetic-device', clientBootId: 'synthetic-boot', qrVersion: area.qrVersion, policyVersion: 1, captureExpiresAt: end, uploadExpiresAt: end,
            presenceStatus: 'ACCEPTABLE', contextStatus: 'ACCEPTABLE', locationCheck: {}, serverTimeAnchor: now } });
        const slot = await prisma.captureSlot.create({ data: { sessionId: session.id, requirementId: requirement.id, sequence: 0, generation: 0, nonceHash: 'synthetic-old-nonce', expiresAt: end } });
        const media = await prisma.evidenceAsset.create({ data: { companyId: company.id, locationId: location.id, taskInstanceId: task.id, originalPublicId: `synthetic/${randomUUID()}`,
            format: 'jpg', bytes: 1, width: 640, height: 640, sha256: 'a'.repeat(64), privacyState: 'SAFE' } });
        const attempt = await prisma.verificationAttempt.create({ data: { sessionId: session.id, slotId: slot.id, requirementId: requirement.id, staffId: staff.id, assignmentEpoch: task.assignmentEpoch,
            mediaAssetId: media.id, clientCaptureId: randomUUID(), claimedCapturedAt: now, anchoredElapsedMs: 0n, timingEvidence: 'ON_TIME_SERVER_OBSERVED', receivedAt: now, state } });
        await prisma.captureSlot.update({ where: { id: slot.id }, data: { attemptId: attempt.id } });
        await prisma.taskEvidenceRequirement.update({ where: { id: requirement.id }, data: { currentAttemptId: attempt.id } });
        return { task, assignment, item, requirement, session, slot: await prisma.captureSlot.findUniqueOrThrow({ where: { id: slot.id } }), attempt };
    }
    const failed = await fresh('RECAPTURE_REQUIRED');
    const raw = { deviceId: 'synthetic-device', requirements: [{ requirementId: failed.requirement.id, expectedGeneration: 1 }] };
    const allocated = await retakeSlots(actor, failed.session.id, raw); assert.equal(allocated.length, 1); assert.equal(allocated[0]!.generation, 2); assert.notEqual(allocated[0]!.id, failed.slot.id);
    assert.equal((await retakeSlots(actor, failed.session.id, raw))[0]!.id, allocated[0]!.id);
    assert.deepEqual(await prisma.verificationAttempt.findUniqueOrThrow({ where: { id: failed.attempt.id } }), failed.attempt);
    assert.deepEqual(await prisma.captureSlot.findUniqueOrThrow({ where: { id: failed.slot.id } }), failed.slot);
    assert.equal((await prisma.taskEvidenceRequirement.findUniqueOrThrow({ where: { id: failed.requirement.id } })).currentAttemptId, null);
    const mixed = await fresh('REVIEW_REQUIRED');
    const waived = await prisma.taskEvidenceRequirement.create({ data: { taskVerificationItemId: mixed.item.id, viewKey: 'legacy-waiver', instructionsSnapshot: 'Synthetic waived legacy view', state: 'WAIVED', decisionVersion: 1 } });
    const caseRow = await prisma.verificationException.create({ data: { companyId: company.id, locationId: location.id, areaId: area.id, taskInstanceId: mixed.task.id, dedupeKey: randomUUID() } });
    await prisma.verificationDecision.create({ data: { exceptionId: caseRow.id, requirementId: waived.id, action: 'WAIVE_REQUIREMENT', reasonCode: 'CANNOT_ASSESS', actorManagerId: owner.id, expectedDecisionVersion: 0 } });
    const submitted = await finishStaffSubmission(actor, mixed.task.id); assert.ok(submitted.staffSubmittedAt);
    const after = await prisma.taskInstance.findUniqueOrThrow({ where: { id: mixed.task.id } }); assert.equal(after.completionOutcome, null); assert.equal(after.status, 'IN_PROGRESS');
    await assert.rejects(retakeSlots(actor, mixed.session.id, { deviceId: 'synthetic-device', requirements: [{ requirementId: mixed.requirement.id, expectedGeneration: 1 }] }));
    const missing = await fresh('REVIEW_REQUIRED');
    await prisma.taskEvidenceRequirement.create({ data: { taskVerificationItemId: missing.item.id, viewKey: 'missing', instructionsSnapshot: 'Synthetic missing mandatory view' } });
    await assert.rejects(finishStaffSubmission(actor, missing.task.id), (error: any) => error.statusCode === 409);
    assert.equal((await prisma.taskInstance.findUniqueOrThrow({ where: { id: missing.task.id } })).staffSubmittedAt, null);
    console.log('PASS isolated launch photo contract: failed required view allocates new immutable generation; exact allocation retry reuses slot; old slot/attempt unchanged; proven legacy waiver plus mandatory review receipt submits without verification credit; submitted replacement and missing required view denied. No real photo/provider/production calls.');
} finally { await prisma.$disconnect(); }
