import {describe,it,expect,vi,beforeEach} from 'vitest';
import {assertDeletionAllowed} from './retention.service.js';
const count=vi.fn();const tx=Object.fromEntries(['area','evidenceAsset','verificationException','taskTemplateItem','taskInstance','captureSession','verificationAttempt','taskAssignment','verificationDecision','areaStandardPhoto','exceptionReadReceipt'].map(name=>[name,{count}])) as unknown as Parameters<typeof assertDeletionAllowed>[0];
beforeEach(()=>count.mockReset().mockResolvedValue(0));
describe('retained evidence deletion protection',()=>{
 for(const entity of ['location','staff','manager','taskTemplate'] as const)it(`blocks ${entity} before deleting or queuing media`,async()=>{count.mockResolvedValueOnce(1);await expect(assertDeletionAllowed(tx,entity,1)).rejects.toMatchObject({statusCode:409,errors:[expect.objectContaining({code:'EVIDENCE_RETAINED'})]});});
 it('keeps unrelated legacy deletion available',async()=>{await expect(assertDeletionAllowed(tx,'staff',1)).resolves.toBeUndefined();});
});
