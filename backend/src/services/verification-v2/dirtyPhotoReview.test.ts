import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { createServer } from 'node:http';
import express, { type RequestHandler } from 'express';
import type { Prisma } from '@prisma/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import exceptionRouter from '../../routes/verificationException.route.js';
import type { BufferedPhotoProvider } from './bufferedPhoto.provider.js';
import { processDirectPhoto } from './directPhoto.service.js';
import { originalPublicId } from './evidence.service.js';
import { inspectImage, sha256 } from './quality.service.js';

const { prisma, requireTaskAccess } = vi.hoisted(() => ({
  requireTaskAccess: vi.fn(),
  prisma: {
    $queryRaw: vi.fn(),
    $transaction: vi.fn(),
    area: { findUnique: vi.fn(), findUniqueOrThrow: vi.fn() },
    evidenceAsset: { findFirst: vi.fn(), findMany: vi.fn(), upsert: vi.fn() },
    exceptionEvent: { create: vi.fn(), findMany: vi.fn(), findUnique: vi.fn() },
    location: { findUnique: vi.fn() },
    manager: { findMany: vi.fn() },
    staff: { findFirst: vi.fn(), findMany: vi.fn() },
    taskAssignment: { findFirst: vi.fn(), findMany: vi.fn() },
    taskEvidenceRequirement: { findFirst: vi.fn(), findUniqueOrThrow: vi.fn(), update: vi.fn() },
    taskInstance: { findUnique: vi.fn(), findUniqueOrThrow: vi.fn(), update: vi.fn() },
    taskVerificationItem: { findMany: vi.fn() },
    verificationAttempt: { count: vi.fn(), findFirst: vi.fn(), findMany: vi.fn(), findUniqueOrThrow: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
    verificationDecision: { count: vi.fn(), create: vi.fn(), findMany: vi.fn() },
    verificationException: { findFirst: vi.fn(), findUniqueOrThrow: vi.fn(), update: vi.fn() },
    verificationIssue: { findFirst: vi.fn(), findMany: vi.fn(), updateMany: vi.fn() },
    verificationRequest: { create: vi.fn(), findUnique: vi.fn() },
  },
}));

vi.mock('../../prisma/prisma.js', () => ({ prisma }));
vi.mock('../../middlewares/auth.middleware.js', () => ({
  verifyJwt: ((req, _res, next) => {
    Object.assign(req, { user: { id: 2, companyId: 1, role: 'MANAGER' } });
    next();
  }) satisfies RequestHandler,
}));
vi.mock('../../middlewares/accountAccess.middleware.js', () => ({
  accountAccess: () => ((_req, _res, next) => next()) satisfies RequestHandler,
}));
vi.mock('../auditLog.service.js', () => ({ writeAuditLog: vi.fn() }));
vi.mock('./authorization.service.js', () => ({
  requireTaskAccess, requireLocationAccess: vi.fn(), requireOperationalRole: vi.fn(),
}));
vi.mock('./completion.service.js', () => ({ finalizeTask: vi.fn() }));
vi.mock('./cleanliness.service.js', () => ({ autoPassAllowed: () => false }));
vi.mock('./launchReviewContext.js', () => ({ reviewReplacementContext: vi.fn() }));
vi.mock('./launchQualification.js', () => ({ requireLaunchPhotoQualification: vi.fn() }));
vi.mock('./media.service.js', () => ({ storePrivateImage: vi.fn(), discardPrivateImages: vi.fn(), privateImageBytes: vi.fn() }));
vi.mock('./bufferedPhoto.provider.js', () => ({ BufferedClefProvider: class {}, bufferedEvaluatorVersion: () => 'test-v1' }));
vi.mock('./quality.service.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('./quality.service.js')>(),
  inspectImage: vi.fn(),
}));

const now = new Date('2026-11-22T09:00:00+05:00');
const task = {
  id: 7, staffId: 1, assignmentEpoch: 0, locationId: 3, status: 'IN_PROGRESS',
  isActive: true, verificationVersion: 2, startedAt: new Date('2026-11-22T08:30:00+05:00'),
  shiftEnd: new Date('2026-11-22T10:00:00+05:00'), location: { isActive: true, company: { isActive: true } },
};
const item = { typeSnapshot: 'SINK', rubricSnapshot: { version: 1 }, mandatory: true };
const staff = { id: 1, companyId: 1, role: 'STAFF' as const };

beforeEach(() => {
  vi.resetAllMocks();
  vi.setSystemTime(now);
  prisma.$transaction.mockImplementation((run) => run(prisma));
  requireTaskAccess.mockResolvedValue(task);
});

afterEach(() => vi.useRealTimers());

it('offers acceptance for a cleaning issue with a retained photo and satisfies the requirement when accepted', async () => {
  const attempt = {
    id: randomUUID(), requirementId: randomUUID(), mediaAssetId: 'dirty-photo',
    receivedAt: now, state: 'CLEANING_REQUIRED', staffId: staff.id,
    media: { privacyState: 'NOT_REQUIRED' },
  };
  const requirement = { id: attempt.requirementId, state: 'CLEANING_REQUIRED', currentAttemptId: attempt.id };
  const issue = { id: 8, requirementId: requirement.id, latestAttemptId: attempt.id, state: 'MANAGER_REVIEW', reasonCode: 'CLEANING_REQUIRED' };
  const review = { id: 9, taskInstanceId: task.id, locationId: task.locationId, rowVersion: 1, state: 'MANAGER_REVIEW', kind: 'TASK' };

  prisma.verificationException.findFirst.mockResolvedValue(review);
  prisma.verificationException.findUniqueOrThrow.mockResolvedValue(review);
  prisma.exceptionEvent.findMany.mockResolvedValue([]);
  prisma.verificationIssue.findMany.mockResolvedValueOnce([issue]).mockResolvedValueOnce([]);
  prisma.verificationIssue.findFirst.mockResolvedValue(issue);
  prisma.verificationDecision.findMany.mockResolvedValue([]);
  prisma.verificationDecision.count.mockResolvedValue(0);
  prisma.verificationDecision.create.mockImplementation(({ data }) => ({ id: 10, ...data }));
  prisma.verificationAttempt.findMany.mockResolvedValue([attempt]);
  prisma.verificationAttempt.findFirst.mockResolvedValue(attempt);
  prisma.taskInstance.findUnique.mockResolvedValue(task);
  prisma.taskEvidenceRequirement.findFirst.mockResolvedValue(requirement);
  prisma.taskEvidenceRequirement.findUniqueOrThrow.mockResolvedValue(requirement);
  prisma.taskVerificationItem.findMany.mockResolvedValue([{ ...item, requirements: [requirement] }]);
  prisma.taskAssignment.findMany.mockResolvedValue([]);
  prisma.manager.findMany.mockResolvedValue([]);
  prisma.staff.findMany.mockResolvedValue([]);

  const app = express().use(express.json(), exceptionRouter);
  const server = createServer(app).listen(0, '127.0.0.1');
  try {
    await once(server, 'listening');
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Expected a loopback TCP address');
    const url = `http://127.0.0.1:${address.port}/verification-exceptions/${review.id}`;
    const detail = await fetch(url);
    expect(detail.status).toBe(200);
    const { data } = await detail.json();
    expect(data.issues).toEqual([expect.objectContaining({
      reasonCode: 'CLEANING_REQUIRED',
      allowedActions: expect.arrayContaining(['ACCEPT_EVIDENCE']),
      latestAttempt: expect.objectContaining({ mediaAssetId: attempt.mediaAssetId, privacyState: 'NOT_REQUIRED' }),
    })]);
    expect(data.issues[0].allowedActions).not.toContain('REQUEST_CLEANING');
    expect(data.items[0].requirements[0].allowedActions).toContain('ACCEPT_EVIDENCE');

    const action = await fetch(`${url}/actions`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        requestId: randomUUID(), expectedVersion: review.rowVersion, issueId: issue.id,
        requirementId: requirement.id, evidenceAttemptId: attempt.id, action: 'ACCEPT_EVIDENCE',
        reasonCode: 'CLEANING_REQUIRED', note: 'Reviewed the retained photo.',
      }),
    });
    expect(action.status).toBe(200);
    expect(await action.json()).toMatchObject({ data: { action: 'ACCEPT_EVIDENCE', evidenceAttemptId: attempt.id } });
    expect(prisma.taskEvidenceRequirement.update).toHaveBeenCalledWith({
      where: { id: requirement.id },
      data: { state: 'MANAGER_ACCEPTED', currentAttemptId: attempt.id, decisionVersion: { increment: 1 } },
    });
    expect(prisma.verificationIssue.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ requirementId: requirement.id }),
      data: expect.objectContaining({ state: 'RESOLVED' }),
    }));
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

it('rejects uploading the retained dirty photo again on a new rework attempt', async () => {
  const photo = Buffer.from('fixture photo');
  const hash = sha256(photo);
  const requirement = { id: randomUUID(), viewKey: 'basin', state: 'MISSING', currentAttemptId: '', decisionVersion: 1, item };
  const newAttempt = () => ({
    id: randomUUID(), staffId: staff.id, requirementId: requirement.id, requirement,
    committedHash: hash, assignmentEpoch: task.assignmentEpoch, state: 'RESERVED',
    media: null as (Prisma.EvidenceAssetUncheckedCreateInput & { id: string }) | null,
    mediaAssetId: null, receivedAt: null, qualityResult: null, cleanlinessResult: null,
    slot: { generation: requirement.decisionVersion },
    session: { taskInstanceId: task.id, task, areaId: 4, state: 'ACTIVE', presenceStatus: 'ACCEPTABLE', qrVersion: 1, uploadExpiresAt: task.shiftEnd },
  });
  let attempt = newAttempt();
  const media: NonNullable<typeof attempt.media>[] = [];
  requirement.currentAttemptId = attempt.id;

  vi.mocked(inspectImage).mockResolvedValue({
    sha256: hash, normalizedHash: hash, perceptualHash: '0000000000000000', hashVariants: [],
    format: 'jpeg', bytes: photo.length, width: 1800, height: 1200, sanitized: photo,
    quality: { acceptable: true, reasons: [], luminance: 100, blurVariance: 60, clippedRatio: 0,
      version: 'quality-thresholds-v1', hashAlgorithmVersion: 'dct64-v1' },
  });
  prisma.area.findUniqueOrThrow.mockResolvedValue({ qrVersion: 1 });
  prisma.staff.findFirst.mockResolvedValue(staff);
  prisma.taskInstance.findUniqueOrThrow.mockResolvedValue(task);
  prisma.taskEvidenceRequirement.findUniqueOrThrow.mockResolvedValue(requirement);
  prisma.taskEvidenceRequirement.update.mockImplementation(({ data }) => {
    requirement.state = data.state;
    requirement.decisionVersion += data.decisionVersion.increment;
  });
  prisma.verificationAttempt.count.mockResolvedValue(1);
  prisma.verificationAttempt.findUniqueOrThrow.mockImplementation(() => attempt);
  prisma.verificationAttempt.update.mockImplementation(({ data }) => Object.assign(attempt, data));
  prisma.verificationAttempt.updateMany.mockImplementation(({ data }) => {
    Object.assign(attempt, data);
    return { count: 1 };
  });
  prisma.evidenceAsset.upsert.mockImplementation(({ create }: { create: Prisma.EvidenceAssetUncheckedCreateInput }) => {
    const asset = { ...create, id: randomUUID() };
    attempt.media = asset;
    media.push(asset);
    return asset;
  });
  prisma.evidenceAsset.findFirst.mockImplementation(({ where }: { where: {
    companyId: number; privacyState: { not: string }; originalPublicId: { not: string }; OR: { sha256?: string; normalizedHash?: string }[];
  } }) => media.find((asset) => asset.companyId === where.companyId &&
    asset.privacyState !== where.privacyState.not && asset.originalPublicId !== where.originalPublicId.not &&
    where.OR.some((match) => match.sha256 === asset.sha256 || match.normalizedHash === asset.normalizedHash)) ?? null);
  prisma.evidenceAsset.findMany.mockResolvedValue([]);

  const evaluate = vi.fn<BufferedPhotoProvider['evaluate']>().mockResolvedValue({
    originality: 'DIRECT', objectMatch: 'MATCH', viewMatch: 'MATCH',
    metadata: { provider: 'test', model: 'test', providerVersion: 'test', promptVersion: 'test', requestId: null, latencyMs: 0, usage: null, costUsd: null },
    cleanliness: { verdict: 'DIRTY', surfaces: [{ surface: 'basin', verdict: 'DIRTY' }], confidence: 0.99, reasonCode: 'CLEANING_REQUIRED' },
  });
  const store = vi.fn().mockResolvedValue({ asset_id: 'stored-asset' });
  const discard = vi.fn();
  const first = await processDirectPhoto(staff, attempt.id, photo, { evaluate }, store, discard);
  expect(first).toMatchObject({ state: 'CLEANING_REQUIRED', storage: 'cloud', retryAction: 'SCAN_QR_FOR_REWORK' });
  expect(requirement.state).toBe('CLEANING_REQUIRED');
  expect(media[0]).toMatchObject({ privacyState: 'NOT_REQUIRED', sha256: hash });

  // Model the new slot allocated after staff scans the rework QR.
  requirement.state = 'MISSING';
  requirement.decisionVersion += 1;
  attempt = newAttempt();
  requirement.currentAttemptId = attempt.id;
  const retry = await processDirectPhoto(staff, attempt.id, photo, { evaluate }, store, discard);
  expect(prisma.evidenceAsset.findFirst).toHaveBeenLastCalledWith(expect.objectContaining({ where: {
    companyId: staff.companyId, privacyState: { not: 'DISCARDED' },
    originalPublicId: { not: originalPublicId(staff.companyId, attempt.id) },
    OR: [{ sha256: hash }, { normalizedHash: hash }],
  } }));
  expect(retry).toMatchObject({ state: 'RECAPTURE_REQUIRED', reasonCode: 'DUPLICATE_EVIDENCE', storage: 'discarded' });
  expect(evaluate).toHaveBeenCalledOnce();
  expect(store).toHaveBeenCalledTimes(2);
  expect(discard).not.toHaveBeenCalled();
});
