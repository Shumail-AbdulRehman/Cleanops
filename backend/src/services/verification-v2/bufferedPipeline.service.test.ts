import { requireLaunchPhotoQualification } from './launchQualification.js';
vi.mock('./launchQualification.js',()=>({requireLaunchPhotoQualification:vi.fn()}));
import { beforeEach, expect, it, vi } from 'vitest';
vi.mock('../../prisma/prisma.js', () => ({ prisma: { verificationAttempt: { findUniqueOrThrow: vi.fn() }, verificationJob: { findFirst: vi.fn(), updateMany: vi.fn() } } }));
vi.mock('./pipeline.service.js', () => ({ applyDecision: vi.fn() }));
vi.mock('./captureSession.service.js', () => ({ lockTask: vi.fn() }));
vi.mock('./completion.service.js', () => ({ finalizeTask: vi.fn() }));
vi.mock('./jobQueue.service.js', () => ({ publishJobResult: vi.fn() }));
vi.mock('./quality.service.js', () => ({ sha256: () => 'hash', inspectImage: vi.fn(async () => ({ sanitized: Buffer.from('sanitized'), sha256: 'hash' })) }));
vi.mock('./cleanliness.service.js', async importOriginal => ({ ...await importOriginal<typeof import('./cleanliness.service.js')>(), autoPassAllowed: () => true }));
import { prisma } from '../../prisma/prisma.js';
import { publishJobResult } from './jobQueue.service.js';
import { applyDecision } from './pipeline.service.js';
import { bufferedDecision, processBufferedPhoto } from './bufferedPipeline.service.js';
import { bufferedEvaluatorVersion, type BufferedAssessment } from './bufferedPhoto.provider.js';
function assessment(verdict: 'CLEAN' | 'DIRTY' | 'CANNOT_ASSESS' = 'CLEAN', originality: BufferedAssessment['originality'] = 'DIRECT'): BufferedAssessment {
  return { originality, objectMatch: 'MATCH', viewMatch: 'MATCH', cleanliness: { verdict, surfaces: [{ surface: 'basin', verdict }], confidence: .98, reasonCode: verdict === 'DIRTY' ? 'CLEANING_REQUIRED' : verdict === 'CLEAN' ? 'CLEAN' : 'CANNOT_ASSESS' }, metadata: {} as any };
}
let tx: any;
beforeEach(() => {
  vi.clearAllMocks();vi.mocked(requireLaunchPhotoQualification).mockReset();
  vi.mocked(prisma.verificationAttempt.findUniqueOrThrow).mockResolvedValue({ id: 'attempt', committedHash: 'hash', session: { taskInstanceId: 7 }, media: { id: 'asset', companyId: 1, deliveryType: 'authenticated', privacyState: 'BUFFERED', originalPublicId: 'verification/1/attempts/attempt/original' }, qualityResult: { acceptable: true }, requirement: { viewKey: 'basin_tap', item: { typeSnapshot: 'SINK', rubricSnapshot: { version: 1 } } } } as any);
  vi.mocked(prisma.verificationJob.findFirst).mockResolvedValue({ id: 'job' } as any);
  vi.mocked(prisma.verificationJob.updateMany).mockResolvedValue({ count: 1 });
  tx = { evidenceAsset: { update: vi.fn() } };
  vi.mocked(publishJobResult).mockImplementation(async (_job, _result, apply) => { await apply?.(tx); return true; });
});
const job = () => ({ id: 'job', attemptId: 'attempt', companyId: 1, stage: 'PHOTO', evaluatorVersion: bufferedEvaluatorVersion(), leaseToken: 'lease' } as any);
function io() { return { read: vi.fn(async () => Buffer.from('bytes')), remove: vi.fn(async () => {}), store: vi.fn(async () => ({ asset_id: 'cloud-id' } as any)) }; }
it('a dirty photo is kept for review and temporary bytes are deleted after publication', async () => {
  const storage = io();
  const provider = { evaluate: vi.fn(async () => assessment('DIRTY')) };
  expect(await processBufferedPhoto(job(), provider, storage)).toBe(true);
  expect(storage.store.mock.calls).toEqual([
    [Buffer.from('bytes'), 'verification/1/attempts/attempt/original', 'hash'],
    [Buffer.from('sanitized'), 'verification/1/attempts/attempt/review', 'hash'],
  ]);
  expect(tx.evidenceAsset.update).toHaveBeenCalledWith(expect.objectContaining({
    data: expect.objectContaining({
      deliveryType: 'authenticated', privacyState: 'NOT_REQUIRED',
      sanitizedPublicId: 'verification/1/attempts/attempt/review',
    }),
  }));
  expect(applyDecision).toHaveBeenCalledWith(tx, 'attempt', 'CLEANING_REQUIRED', 'CLEANING_REQUIRED', expect.anything());
  expect(storage.remove).toHaveBeenCalledOnce();
  expect(storage.remove.mock.invocationCallOrder[0]).toBeGreaterThan(vi.mocked(publishJobResult).mock.invocationCallOrder[0]!);
});
it('a screen photo is reported without any Cloudinary upload and temporary bytes are deleted after commit', async () => {
  const storage = io();
  const provider = { evaluate: vi.fn(async () => assessment('CLEAN', 'SCREEN_RECAPTURE')) };
  expect(await processBufferedPhoto(job(), provider, storage)).toBe(true);
  expect(storage.store).not.toHaveBeenCalled(); expect(storage.remove).toHaveBeenCalledOnce();
  expect(applyDecision).toHaveBeenCalledWith(tx, 'attempt', 'RECAPTURE_REQUIRED', 'PHOTO_OF_SCREEN', expect.anything());
});
it.each(['CLEAN', 'CANNOT_ASSESS'] as const)('%s uploads only after one completed AI call and deletes the buffer after publication', async verdict => {
  const storage = io(); const provider = { evaluate: vi.fn(async () => assessment(verdict)) };
  await processBufferedPhoto(job(), provider, storage);
  expect(provider.evaluate).toHaveBeenCalledOnce(); expect(storage.store).toHaveBeenCalledTimes(2);
  expect(provider.evaluate.mock.invocationCallOrder[0]).toBeLessThan(storage.store.mock.invocationCallOrder[0]!);
  expect(storage.remove.mock.invocationCallOrder[0]).toBeGreaterThan(vi.mocked(publishJobResult).mock.invocationCallOrder[0]!);
  expect(tx.evidenceAsset.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ deliveryType: 'authenticated', privacyState: 'NOT_REQUIRED' }) }));
});
it('storage failure retains the buffer and recorded assessment; retry does not call AI again', async () => {
  const storage = io(); storage.store.mockRejectedValueOnce(new Error('Storage unavailable'));
  const provider = { evaluate: vi.fn(async () => assessment()) };
  await expect(processBufferedPhoto(job(), provider, storage)).rejects.toThrow('Storage unavailable');
  expect(storage.remove).not.toHaveBeenCalled(); expect(publishJobResult).not.toHaveBeenCalled();
  const saved = vi.mocked(prisma.verificationJob.updateMany).mock.calls[0]![0]!.data!.result;
  await processBufferedPhoto({ ...job(), result: saved }, provider, storage);
  expect(provider.evaluate).toHaveBeenCalledOnce(); expect(storage.remove).toHaveBeenCalledOnce();
});
it('model failure retains bytes and does not fabricate dirt or upload', async () => {
  const storage = io(); const provider = { evaluate: vi.fn(async () => { throw new Error('Timeout'); }) };
  await expect(processBufferedPhoto(job(), provider, storage)).rejects.toThrow('Timeout');
  expect(storage.store).not.toHaveBeenCalled(); expect(storage.remove).not.toHaveBeenCalled(); expect(applyDecision).not.toHaveBeenCalled();
});
it('expired leases neither call AI nor delete evidence', async () => {
  vi.mocked(prisma.verificationJob.findFirst).mockResolvedValue(null);
  const storage = io(), provider = { evaluate: vi.fn(async () => assessment()) };
  expect(await processBufferedPhoto(job(), provider, storage)).toBe(false);
  expect(storage.read).not.toHaveBeenCalled(); expect(provider.evaluate).not.toHaveBeenCalled(); expect(storage.remove).not.toHaveBeenCalled();
});
it('lost publication retains the temporary buffer', async () => {
  vi.mocked(publishJobResult).mockResolvedValue(false);
  const storage = io(); expect(await processBufferedPhoto(job(), { evaluate: async () => assessment('DIRTY') }, storage)).toBe(false);
  expect(storage.remove).not.toHaveBeenCalled();
});
it('known visible dirt takes precedence over an uncertain origin and keeps the photo', () => {
  expect(bufferedDecision(assessment('DIRTY', 'UNCERTAIN'), false)).toMatchObject({ state: 'CLEANING_REQUIRED', keep: true });
  expect(bufferedDecision(assessment('CLEAN'), false)).toMatchObject({ state: 'REVIEW_REQUIRED', keep: true });
});

it('real active qualification blocks buffered replay including a cached approval, before reading or storing bytes',async()=>{
 const actual=await vi.importActual<typeof import('./launchQualification.js')>('./launchQualification.js');
 vi.mocked(requireLaunchPhotoQualification).mockImplementation(actual.requireLaunchPhotoQualification);
 const storage=io(),provider={evaluate:vi.fn(async()=>assessment())};
 await expect(processBufferedPhoto({...job(),result:{decision:{state:'PASSED',reason:'CLEAN',keep:true}}},provider,storage)).rejects.toMatchObject({statusCode:503});
 expect(storage.read).not.toHaveBeenCalled();expect(storage.store).not.toHaveBeenCalled();expect(storage.remove).not.toHaveBeenCalled();expect(provider.evaluate).not.toHaveBeenCalled();expect(publishJobResult).not.toHaveBeenCalled();
});
