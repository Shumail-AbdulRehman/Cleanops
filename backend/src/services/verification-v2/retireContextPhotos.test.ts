import { describe, it, expect, vi } from 'vitest';
import { retireContextPhotos } from './retireContextPhotos.js';
const actor = { role: 'STAFF' as const, companyId: 1, id: 7 };
describe('retiring entrance photos', () => {
  it('records a scoped policy change while retaining GPS, evidence and unrelated issues', async () => {
    const tx = { captureSession: { findMany: vi.fn().mockResolvedValue([{id:'s',contextStatus:'PENDING',locationCheck:{captureWorkflow:'SEQUENTIAL_CLEF_V1',latitude:24,presenceStatus:'UNCERTAIN',captureContextPolicy:{version:1,requiredKeys:['ENTRANCE']}}}]), update:vi.fn() }, verificationAttempt:{findMany:vi.fn().mockResolvedValue([{id:'entrance'}])}, verificationIssue:{updateMany:vi.fn().mockResolvedValue({count:1})}, verificationException:{updateMany:vi.fn()},auditLog:{create:vi.fn()} };
    await retireContextPhotos(tx as any, actor, 9);
    expect(tx.captureSession.findMany.mock.calls[0][0].where.taskInstanceId).toBe(9);
    const change=tx.captureSession.update.mock.calls[0][0].data;
    expect(change).not.toHaveProperty('presenceStatus');
    expect(change.locationCheck).toMatchObject({latitude:24,presenceStatus:'UNCERTAIN',captureContextPolicy:{version:2,requiredKeys:[]}});
    expect(tx.verificationIssue.updateMany.mock.calls[0][0].where).toMatchObject({exception:{taskInstanceId:9},requirementId:null,latestAttemptId:{in:['entrance']},reasonCode:{in:['CONTEXT_UNCERTAIN','PHOTO_ORIGIN_UNCERTAIN']}});
    expect(tx.auditLog.create.mock.calls[0][0].data.action).toBe('CONTEXT_PHOTO_REQUIREMENTS_RETIRED');
  });
  it('does not repeat a completed policy transition', async () => {
    const tx={captureSession:{findMany:vi.fn().mockResolvedValue([{id:'s',locationCheck:{captureContextPolicy:{version:2,requiredKeys:[]}}}]),update:vi.fn()},auditLog:{create:vi.fn()}};
    await retireContextPhotos(tx as any,actor,9);
    expect(tx.captureSession.update).not.toHaveBeenCalled();
    expect(tx.auditLog.create).not.toHaveBeenCalled();
  });
});
