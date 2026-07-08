import { requireLaunchPhotoQualification } from './launchQualification.js';
import { Prisma, type VerificationJob } from '@prisma/client';
import { prisma } from '../../prisma/prisma.js';
import { publishJobResult } from './jobQueue.service.js';
import { jobTiming } from "./latency.js";
import { readBufferedPhoto, removeBufferedPhoto, photoStorageState } from './evidenceBuffer.js';
import { inspectImage, sha256 } from './quality.service.js';
import { storePrivateImage } from './media.service.js';
import { BufferedClefProvider, bufferedEvaluatorVersion, type BufferedPhotoProvider, type BufferedAssessment } from './bufferedPhoto.provider.js';
import { ProviderServiceFailure } from './provider.service.js';
import { applyDecision } from './pipeline.service.js';
import { lockTask } from './captureSession.service.js';
import { finalizeTask } from './completion.service.js';
import { autoPassAllowed } from './cleanliness.service.js';
import { verificationEvent } from './latency.js';

import {bufferedDecision,type Decision} from './photoResultPolicy.js';
export {bufferedDecision} from './photoResultPolicy.js';
export async function processBufferedPhoto(job: VerificationJob, provider: BufferedPhotoProvider = new BufferedClefProvider(), io = { read: readBufferedPhoto, remove: removeBufferedPhoto, store: storePrivateImage }) {
  const start = Date.now();
  const a = await prisma.verificationAttempt.findUniqueOrThrow({ where: { id: job.attemptId }, include: { media: true, session: true, requirement: { include: { item: true } } } });
  if (!a.media || a.media.companyId !== job.companyId || !['BUFFERED', 'NOT_REQUIRED', 'DISCARDED'].includes(a.media.privacyState)) throw new Error('EVIDENCE_NOT_READY');
  if (job.evaluatorVersion !== bufferedEvaluatorVersion()) throw new ProviderServiceFailure('PROVIDER_CONFIGURATION_CHANGED');
  if (!await prisma.verificationJob.findFirst({ where: { id: job.id, state: 'RUNNING', leaseToken: job.leaseToken, leaseUntil: { gt: new Date() } }, select: { id: true } })) return false;
  requireLaunchPhotoQualification(a.requirement?.item.typeSnapshot ?? 'ROOM_CONTEXT',
    (a.requirement?.item.rubricSnapshot as {version?:number}|undefined)?.version ?? 1);
  const quality = a.qualityResult as { acceptable?: boolean; reasons?: string[] } | null;
  const persisted = job.result as { assessment?: BufferedAssessment; decision?: Decision } | null;
  let assessment = persisted?.assessment;
  let decision = persisted?.decision;
  let bytes: Buffer | undefined;
  let inspected: Awaited<ReturnType<typeof inspectImage>> | undefined;
  if (!decision) {
    if (quality?.acceptable === false) decision = { state: 'RECAPTURE_REQUIRED', reason: quality.reasons?.[0] ?? 'CANNOT_ASSESS', keep: false };
    else {
      bytes = await io.read(job.companyId, a.id);
      if (sha256(bytes) !== a.committedHash) throw new Error('BUFFER_HASH_MISMATCH');
      const info = inspected = await inspectImage(bytes);
      const providerStarted = Date.now();
      assessment = await provider.evaluate(info.sanitized, a.requirement?.item.rubricSnapshot, a.requirement?.viewKey, a.requirement?.item.typeSnapshot);
      verificationEvent('PHOTO_AI_COMPLETED', { attemptId: a.id, jobId: job.id }, { providerMs: Date.now() - providerStarted });
      const validated = !a.requirement || autoPassAllowed(a.requirement.item.typeSnapshot, (a.requirement.item.rubricSnapshot as { version: number }).version);
      decision = bufferedDecision(assessment, validated, !!a.requirement);
    }
    // Record the assessment before storage. A storage retry reuses it, not AI.
    const persisted = await prisma.verificationJob.updateMany({ where: { id: job.id, state: 'RUNNING', leaseToken: job.leaseToken, leaseUntil: { gt: new Date() } }, data: { result: JSON.parse(JSON.stringify({ timing: jobTiming(job.result), assessment, decision, workflow: 'BUFFERED_PHOTO_V1' })) } });
    if (!persisted.count) return false;
  }
  let cloud: { assetId: string; reviewPublicId: string } | undefined;
  if (decision.keep && photoStorageState(a.media) !== 'cloud') {
    bytes ??= await io.read(job.companyId, a.id);
    if (sha256(bytes) !== a.committedHash) throw new Error('BUFFER_HASH_MISMATCH');
    const info = inspected ?? await inspectImage(bytes), reviewPublicId = a.media.originalPublicId.replace(/\/original$/, '/review');
    const uploaded = await Promise.all([io.store(bytes, a.media.originalPublicId, info.sha256), io.store(info.sanitized, reviewPublicId, sha256(info.sanitized))]);
    cloud = { assetId: uploaded[0]!.asset_id, reviewPublicId };
  }
  const result = JSON.parse(JSON.stringify({ workflow: 'BUFFERED_PHOTO_V1', assessment, decision, timing: { ...jobTiming(job.result), stageExecutionMs: Date.now() - start }, storage: decision.keep ? 'cloud' : 'discarded', cloudinaryAssetId: cloud?.assetId ?? a.media.cloudinaryAssetId })) as Prisma.InputJsonObject;
  const published = await publishJobResult(job, result, async tx => {
    await lockTask(tx, a.session.taskInstanceId);
    await tx.evidenceAsset.update({ where: { id: a.media!.id }, data: decision!.keep ? {
      deliveryType: 'authenticated', privacyState: 'NOT_REQUIRED', ...(cloud ? { sanitizedPublicId: cloud.reviewPublicId } : {}),
    } : { deliveryType: 'authenticated', privacyState: 'DISCARDED', sanitizedPublicId: null } });
    const cleanliness = assessment?.cleanliness ? { result: assessment.cleanliness, metadata: assessment.metadata, workflow: 'BUFFERED_PHOTO_V1' } : { workflow: 'BUFFERED_PHOTO_V1' };
    await applyDecision(tx, a.id, decision!.state, decision!.reason, JSON.parse(JSON.stringify(cleanliness)));
    await finalizeTask(tx, a.session.taskInstanceId);
  });
  if (published) await io.remove(job.companyId, a.id);
  verificationEvent('PHOTO_FINISHED', { attemptId: a.id, jobId: job.id, taskId: a.session.taskInstanceId }, { totalMs: Date.now() - start, state: decision.state, storage: decision.keep ? 'cloud' : 'discarded' });
  return published;
}
