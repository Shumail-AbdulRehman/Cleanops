import {afterEach,expect,it,vi} from 'vitest';
vi.mock('../../prisma/prisma.js',()=>({prisma:{}}));
vi.mock('./captureSession.service.js',()=>({lockTask:vi.fn()}));
vi.mock('./exception.service.js',()=>({raiseIssue:vi.fn()}));
import {applyDecision,contextNeedsReview} from './photoDecision.service.js';
import {raiseIssue} from './exception.service.js';

afterEach(()=>vi.clearAllMocks());
function transaction(allowed=true){
 const task={id:9,isActive:true,status:'IN_PROGRESS',assignmentEpoch:1,staffId:1,policySnapshot:{version:1,recaptureFailuresBeforeEscalation:2},location:{isActive:true,company:{isActive:true}}};
 const attempt={id:'a',staffId:1,assignmentEpoch:1,requirementId:'r',cleanlinessResult:null,receivedAt:new Date(),timingEvidence:'ON_TIME_SERVER_OBSERVED',slot:{generation:0},session:{taskInstanceId:9,state:allowed?'ACTIVE':'REVOKED',presenceStatus:'ACCEPTABLE',uploadExpiresAt:new Date(Date.now()+60000),areaId:3,qrVersion:1}};
 return {
  verificationAttempt:{findUniqueOrThrow:vi.fn().mockResolvedValue(attempt),update:vi.fn().mockResolvedValue({}),count:vi.fn().mockResolvedValue(10)},
  taskInstance:{findUniqueOrThrow:vi.fn().mockResolvedValue(task),update:vi.fn()},
  staff:{findFirst:vi.fn().mockResolvedValue({id:1})},area:{findUniqueOrThrow:vi.fn().mockResolvedValue({qrVersion:1})},
  taskEvidenceRequirement:{findUniqueOrThrow:vi.fn().mockResolvedValue({id:'r',currentAttemptId:'a',decisionVersion:0,state:'PROCESSING'}),update:vi.fn()},
 };
}
it.each(['RECAPTURE_REQUIRED','REVIEW_REQUIRED'] as const)('keeps confirmed wrong-object %s as staff retakes without threshold escalation',async state=>{
 const tx=transaction();await applyDecision(tx as any,'a',state,'WRONG_ITEM',{});
 expect(tx.verificationAttempt.update).toHaveBeenCalledWith({where:{id:'a'},data:{state:'RECAPTURE_REQUIRED',cleanlinessResult:{policyDecisionReason:'WRONG_ITEM'}}});
 expect(tx.taskEvidenceRequirement.update).toHaveBeenCalledWith({where:{id:'r'},data:{state:'RECAPTURE_REQUIRED',decisionVersion:{increment:1}}});
 expect(tx.taskInstance.update).toHaveBeenCalledWith({where:{id:9},data:{verificationState:'REWORK_REQUIRED'}});
 expect(tx.verificationAttempt.count).not.toHaveBeenCalled();expect(raiseIssue).not.toHaveBeenCalled();
});
it('a stale wrong-object photo is rejected without a review or current requirement changes',async()=>{
 const tx=transaction(false);await applyDecision(tx as any,'a','RECAPTURE_REQUIRED','WRONG_ITEM',{});
 expect(tx.verificationAttempt.update).toHaveBeenCalledWith({where:{id:'a'},data:{state:'RECAPTURE_REQUIRED',cleanlinessResult:{policyDecisionReason:'WRONG_ITEM'}}});
 expect(tx.taskEvidenceRequirement.update).not.toHaveBeenCalled();expect(tx.taskInstance.update).not.toHaveBeenCalled();expect(raiseIssue).not.toHaveBeenCalled();
});
it('other repeated capture failures still follow their existing escalation policy',async()=>{
 const tx=transaction();await applyDecision(tx as any,'a','RECAPTURE_REQUIRED','PHOTO_BLURRY',{});
 expect(raiseIssue).toHaveBeenCalledWith(tx,9,'PHOTO_BLURRY','r','a');
 expect(contextNeedsReview('RECAPTURE_REQUIRED',true,'WRONG_ITEM',10,2)).toBe(false);
 expect(contextNeedsReview('RECAPTURE_REQUIRED',true,'CONTEXT_UNCERTAIN',10,2)).toBe(true);
});

it('a late photo cannot reopen reviews or requirements after its schedule was removed',async()=>{
 const tx=transaction();const task=await tx.taskInstance.findUniqueOrThrow();task.isActive=false;task.status='CANCELLED';
 await applyDecision(tx as any,'a','REVIEW_REQUIRED','AUTO_PASS_NOT_VALIDATED',{});
 expect(tx.verificationAttempt.update).toHaveBeenCalled();
 expect(tx.taskEvidenceRequirement.findUniqueOrThrow).not.toHaveBeenCalled();expect(tx.taskEvidenceRequirement.update).not.toHaveBeenCalled();
 expect(raiseIssue).not.toHaveBeenCalled();expect(tx.taskInstance.update).not.toHaveBeenCalled();
});
