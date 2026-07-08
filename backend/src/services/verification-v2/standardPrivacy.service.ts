import { randomUUID } from 'node:crypto';
import { prisma } from '../../prisma/prisma.js';
import { ApiError } from '../../utils/ApiError.js';
import { requireAreaAccess, requireOperationalRole, type VerificationActor } from './authorization.service.js';
import { assessPrivacy } from './coverage.service.js';
import { ClefImageProvider, type ImageAssessmentProvider } from './provider.service.js';
import { privateImageBytes } from './media.service.js';
import { writeAuditLog } from '../auditLog.service.js';

const MAX_CHECKS = 4;
const CHECK_LEASE_MS = 60_000;
/** Standards are optional guidance, never task evidence. Failed safety calls leave delivery restricted. */
export async function screenStandardPrivacy(actor: VerificationActor, standardId: number,
  provider: ImageAssessmentProvider = new ClefImageProvider(), read = privateImageBytes) {
  requireOperationalRole(actor);
  const standard = await prisma.areaStandardPhoto.findFirst({
    where: { id: standardId, area: { location: { companyId: actor.companyId } } }, include: { media: true },
  });
  if (!standard) throw new ApiError(404, 'Standard not found');
  await requireAreaAccess(actor, standard.areaId);
  const scope = { companyId: actor.companyId, entityType: 'AREA_STANDARD_PHOTO', entityId: standardId };
  const checkId = randomUUID();
  const started = await prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM "AreaStandardPhoto" WHERE id=${standardId} FOR UPDATE`;
    const fresh = await tx.evidenceAsset.findUniqueOrThrow({ where: { id: standard.mediaAssetId } });
    if (fresh.privacyState !== 'PENDING') return false;
    const [checks, last] = await Promise.all([
      tx.auditLog.count({ where: { ...scope, action: 'STANDARD_PRIVACY_STARTED' } }),
      tx.auditLog.findFirst({ where: { ...scope, action: 'STANDARD_PRIVACY_STARTED' }, orderBy: { id: 'desc' } }),
    ]);
    if (last && Date.now() - +last.createdAt < CHECK_LEASE_MS && !await tx.auditLog.findFirst({
      where: { ...scope, action: 'STANDARD_PRIVACY_FINISHED', newValue: { path: ['checkId'], equals: (last.newValue as { checkId: string }).checkId } },
    })) throw new ApiError(409, 'Privacy check is already running', [{ code: 'PRIVACY_CHECK_RUNNING' }]);
    if (checks >= MAX_CHECKS) throw new ApiError(503, 'Privacy service retries exhausted; this photo remains restricted', [{ code: 'SERVICE_FAILURE' }]);
    await writeAuditLog({ ...scope, actorType: actor.role, actorId: actor.id, action: 'STANDARD_PRIVACY_STARTED', newValue: { checkId } }, tx);
    return true;
  });
  if (!started) return { standardId, privacyState: (await prisma.evidenceAsset.findUniqueOrThrow({ where: { id: standard.mediaAssetId } })).privacyState };
  const before = Date.now();
  let assessment: Awaited<ReturnType<typeof assessPrivacy>> | null = null;
  try {
    if (standard.media.deliveryType !== 'authenticated' || !standard.media.sanitizedPublicId) throw new Error('Invalid protected derivative');
    assessment = await assessPrivacy(provider, await read(standard.media.sanitizedPublicId, 'jpg'));
  } catch { /* Refusal, malformed output, storage outage: never publish an unscreened thumbnail. */ }
  return prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM "AreaStandardPhoto" WHERE id=${standardId} FOR UPDATE`;
    const last = await tx.auditLog.findFirst({ where: { ...scope, action: 'STANDARD_PRIVACY_STARTED' }, orderBy: { id: 'desc' } });
    const current = (last?.newValue as { checkId?: string } | null)?.checkId === checkId;
    if (assessment && (current || assessment.result.status !== 'SAFE')) await tx.evidenceAsset.updateMany({
      where: { id: standard.mediaAssetId, privacyState: { not: 'HOLD' } },
      data: { privacyState: assessment.result.status === 'SAFE' ? 'SAFE' : 'HOLD' },
    });
    await writeAuditLog({ ...scope, actorType: 'SYSTEM', action: 'STANDARD_PRIVACY_FINISHED',
      reason: assessment ? assessment.result.reasonCode : 'SERVICE_FAILURE',
      newValue: { checkId, evaluatorVersion: 'standard-clef-privacy-v1', assessment, latencyMs: Date.now() - before } }, tx);
    const asset = await tx.evidenceAsset.findUniqueOrThrow({ where: { id: standard.mediaAssetId } });
    return { standardId, privacyState: asset.privacyState, reasonCode: assessment?.result.reasonCode ?? 'SERVICE_FAILURE' };
  });
}
