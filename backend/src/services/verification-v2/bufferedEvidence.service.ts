import { prisma } from '../../prisma/prisma.js';
import { ApiError } from '../../utils/ApiError.js';
import { requireTaskAccess, type VerificationActor } from './authorization.service.js';
import { inspectImage, sha256 } from './quality.service.js';
import { saveBufferedPhoto, photoStorageState } from './evidenceBuffer.js';
import { enqueueVerificationJob } from './jobQueue.service.js';
import { bufferedEvaluatorVersion } from './bufferedPhoto.provider.js';
import { originalPublicId } from './evidence.service.js';
import { verificationEvent } from './latency.js';

/** Receipt acknowledges an encrypted temporary copy, never a Cloudinary upload. */
export async function stageReservedEvidence(actor: VerificationActor, attemptId: string, bytes: Buffer, diagnostics?: Record<string, unknown>) {
  const start = Date.now();
  if (actor.role !== 'STAFF') throw new ApiError(403, 'Staff account required');
  const attempt = await prisma.verificationAttempt.findUnique({ where: { id: attemptId }, include: { session: true, media: true } });
  if (!attempt || attempt.staffId !== actor.id) throw new ApiError(404, 'Capture not found');
  await requireTaskAccess(actor, attempt.session.taskInstanceId, { staffMutation: true });
  if (sha256(bytes) !== attempt.committedHash) throw new ApiError(409, 'Different bytes require a new photo.');
  if (attempt.media) return { attemptId, assetId: attempt.media.id, state: attempt.state, storage: photoStorageState(attempt.media) };
  const info = await inspectImage(bytes);
  if (info.sha256 !== attempt.committedHash) throw new ApiError(409, 'Different bytes require a new photo.');
  await saveBufferedPhoto(actor.companyId, attempt.id, bytes);
  const timing = { ingestionStartedAt: new Date(start).toISOString(), bufferedAt: new Date().toISOString(), ingestionMs: Date.now() - start, client: diagnostics };
  const acknowledgment = await prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM "TaskInstance" WHERE id=${attempt.session.taskInstanceId} FOR UPDATE`;
    const fresh = await tx.verificationAttempt.findUniqueOrThrow({ where: { id: attemptId }, include: { media: true, session: { include: { task: true } }, slot: true, requirement: true } });
    if (fresh.media) return { attemptId, assetId: fresh.media.id, state: fresh.state, storage: photoStorageState(fresh.media) };
    const asset = await tx.evidenceAsset.create({ data: {
      companyId: actor.companyId, locationId: fresh.session.task.locationId, taskInstanceId: fresh.session.taskInstanceId,
      originalPublicId: originalPublicId(actor.companyId, attemptId), deliveryType: 'authenticated', privacyState: 'BUFFERED',
      format: info.format, bytes: info.bytes, width: info.width, height: info.height,
      sha256: info.sha256, normalizedHash: info.normalizedHash, perceptualHash: info.perceptualHash,
    } });
    await tx.verificationAttempt.update({ where: { id: attemptId }, data: {
      mediaAssetId: asset.id, receivedAt: new Date(), state: 'RECEIVED',
      qualityResult: JSON.parse(JSON.stringify({ ...info.quality, workflow: 'BUFFERED_PHOTO_V1' })),
    } });
    await enqueueVerificationJob(tx, { companyId: actor.companyId, attemptId, stage: 'PHOTO', evaluatorVersion: bufferedEvaluatorVersion(), result: JSON.parse(JSON.stringify({ timing, workflow: 'BUFFERED_PHOTO_V1' })) });
    return { attemptId, assetId: asset.id, state: 'RECEIVED', storage: 'buffered' };
  });
  verificationEvent('PHOTO_BUFFERED', { taskId: attempt.session.taskInstanceId, attemptId, sessionId: attempt.sessionId }, timing);
  return acknowledgment;
}
