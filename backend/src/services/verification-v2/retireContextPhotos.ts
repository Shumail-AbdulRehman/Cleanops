import { Prisma } from '@prisma/client';
import type { VerificationTransaction } from './transaction.js';
import type { VerificationActor } from './authorization.service.js';
import { captureContextPolicy, requiredContextKeys } from './contextPolicy.js';

/** Explicit product-policy change on an authorized, locked task. Evidence is retained. */
export async function retireContextPhotos(tx: VerificationTransaction, actor: VerificationActor, taskId: number) {
  const sessions = await tx.captureSession.findMany({
    where: { taskInstanceId: taskId, task: { status: { not: 'COMPLETED' } }, locationCheck: { path: ['captureWorkflow'], equals: 'SEQUENTIAL_CLEF_V1' } },
    select: { id: true, locationCheck: true, contextStatus: true },
  });
  const retired = sessions.filter(session => requiredContextKeys(session.locationCheck).length > 0);
  for (const session of retired) {
    await tx.captureSession.update({ where: { id: session.id }, data: {
      locationCheck: { ...(session.locationCheck as Prisma.JsonObject), captureContextPolicy: captureContextPolicy([]) },
      contextStatus: 'ACCEPTABLE', contextAttemptIds: [], rowVersion: { increment: 1 },
    } });
  }
  if (!retired.length) return;
  const contexts = await tx.verificationAttempt.findMany({
    where: { sessionId: { in: retired.map(session => session.id) }, contextKey: { not: null }, media: { privacyState: { in: ['SAFE', 'NOT_REQUIRED'] } } },
    select: { id: true },
  });
  // Remove only obsolete context/origin obligations. Service/privacy/duplicate
  // issues remain independently reviewable; no fixture result or GPS is accepted.
  const result = await tx.verificationIssue.updateMany({ where: {
    exception: { taskInstanceId: taskId }, requirementId: null,
    latestAttemptId: { in: contexts.map(attempt => attempt.id) },
    reasonCode: { in: ['CONTEXT_UNCERTAIN', 'PHOTO_ORIGIN_UNCERTAIN'] }, state: { not: 'RESOLVED' },
  }, data: { state: 'RESOLVED', resolvedAt: new Date() } });
  await tx.verificationException.updateMany({ where: { taskInstanceId: taskId }, data: { rowVersion: { increment: 1 } } });
  await tx.auditLog.create({ data: {
    companyId: actor.companyId, actorType: actor.role, actorId: actor.id,
    entityType: 'TaskInstance', entityId: taskId, action: 'CONTEXT_PHOTO_REQUIREMENTS_RETIRED',
    oldValue: { sessions: retired.map(session => ({ id: session.id, requiredKeys: requiredContextKeys(session.locationCheck), contextStatus: session.contextStatus })) },
    newValue: { policyVersion: 2, requiredContextKeys: [], resolvedObsoleteIssues: result.count, retainedEvidence: true },
  } });
}
