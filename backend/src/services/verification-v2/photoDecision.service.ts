import {Prisma} from '@prisma/client';
import type {VerificationTransaction} from './transaction.js';
import {lockTask} from './captureSession.service.js';
import {raiseIssue} from './exception.service.js';
import {requiredContextKeys} from './contextPolicy.js';
import {resolvePolicy} from './verificationPolicy.service.js';
export async function applyDecision(tx:VerificationTransaction,id:string,state:'PASSED'|'RECAPTURE_REQUIRED'|'CLEANING_REQUIRED'|'REVIEW_REQUIRED'|'PRIVACY_HOLD',reasonCode:string,cleanlinessAssessment?:Prisma.InputJsonObject){
 const initial=await tx.verificationAttempt.findUniqueOrThrow({where:{id},select:{session:{select:{taskInstanceId:true}}}});await lockTask(tx,initial.session.taskInstanceId);
 const a=await tx.verificationAttempt.findUniqueOrThrow({where:{id},include:{session:true,slot:true}});
 return applyLockedDecision(tx,a,state,reasonCode,cleanlinessAssessment);
}
/** Internal publication path: caller must hold the task lock and read this attempt in the same transaction. */
export async function applyLockedDecision(tx:VerificationTransaction,a:Prisma.VerificationAttemptGetPayload<{include:{session:true,slot:true}}>,state:'PASSED'|'RECAPTURE_REQUIRED'|'CLEANING_REQUIRED'|'REVIEW_REQUIRED'|'PRIVACY_HOLD',reasonCode:string,cleanlinessAssessment?:Prisma.InputJsonObject){
 const id=a.id,wrongObject=reasonCode==='WRONG_ITEM'&&state!=='PRIVACY_HOLD';
 if(wrongObject)state='RECAPTURE_REQUIRED';
 const task=await tx.taskInstance.findUniqueOrThrow({where:{id:a.session.taskInstanceId},include:{location:{include:{company:true}}}});const completed=task.status==='COMPLETED';
 if(completed||!task.isActive||task.status==='CANCELLED'){
  await tx.verificationAttempt.update({where:{id},data:{state,...(cleanlinessAssessment&&a.cleanlinessResult===null?{cleanlinessResult:{...cleanlinessAssessment,policyDecisionReason:reasonCode}}:{})}});
  // A late upload cannot reopen ordinary reviews or requirements on removed work.
  // Privacy publication already restricts media and links its serious issue.
  if(reasonCode==='DUPLICATE_EVIDENCE')await raiseIssue(tx,task.id,reasonCode,null,id);
  return;
 }
 const current=task.isActive&&task.assignmentEpoch===a.assignmentEpoch&&task.staffId===a.staffId&&a.session.state!=='REVOKED'&&['IN_PROGRESS','NOT_COMPLETED_INTIME'].includes(task.status);
 const staff=await tx.staff.findFirst({where:{id:a.staffId,isActive:true,locationId:task.locationId}}),area=await tx.area.findUniqueOrThrow({where:{id:a.session.areaId}});const allowed=current&&a.session.presenceStatus==='ACCEPTABLE'&&a.timingEvidence!=='UNCERTAIN'&&!!a.receivedAt&&a.receivedAt<=a.session.uploadExpiresAt&&!!staff&&task.location.isActive&&task.location.company.isActive&&area.qrVersion===a.session.qrVersion;
 const effective=state==='PRIVACY_HOLD'?state:allowed||wrongObject?state:'REVIEW_REQUIRED';
 const policyDecisionReason=effective==='PRIVACY_HOLD'?'PRIVACY_HOLD':!allowed&&!wrongObject?'STALE_ASSIGNMENT':reasonCode;
 await tx.verificationAttempt.update({where:{id},data:{state:effective,...(cleanlinessAssessment&&a.cleanlinessResult===null?{cleanlinessResult:{...cleanlinessAssessment,policyDecisionReason}}:{})}});
 // A discarded wrong-object photo grants no evidence credit and never opens a review.
 // Stale captures must not change the current requirement or assignment.
 if(wrongObject&&!allowed)return;
 if(a.requirementId){const r=await tx.taskEvidenceRequirement.findUniqueOrThrow({where:{id:a.requirementId}});if(r.currentAttemptId!==id||r.decisionVersion!==a.slot.generation||['PASSED','MANAGER_ACCEPTED','WAIVED'].includes(r.state))return;
  await tx.taskEvidenceRequirement.update({where:{id:r.id},data:{state:effective==='PRIVACY_HOLD'?'REVIEW_REQUIRED':effective,decisionVersion:{increment:1}}});
  const cleaning=effective==='CLEANING_REQUIRED',recapture=effective==='RECAPTURE_REQUIRED',policy=resolvePolicy(task.policySnapshot);
  const failures=cleaning||recapture&&!wrongObject?await tx.verificationAttempt.count({where:{requirementId:r.id,state:effective}}):0;
  if(!wrongObject&&(!allowed||effective==='PRIVACY_HOLD'||effective==='REVIEW_REQUIRED'||cleaning&&failures>=policy.cleaningFailuresBeforeEscalation||recapture&&failures>=policy.recaptureFailuresBeforeEscalation))await raiseIssue(tx,task.id,!allowed?'STALE_ASSIGNMENT':reasonCode,r.id,id);
  else await tx.taskInstance.update({where:{id:task.id},data:{verificationState:effective==='PASSED'?'PROCESSING':'REWORK_REQUIRED'}});
  if(effective==='PASSED')await tx.verificationIssue.updateMany({where:{requirementId:r.id,reasonCode:{not:'PRIVACY_HOLD'}},data:{state:'RESOLVED',resolvedAt:new Date()}});
 }else{
  if(requiredContextKeys(a.session.locationCheck).length===0){
   if(effective==='PRIVACY_HOLD'||!allowed||reasonCode==='DUPLICATE_EVIDENCE'||reasonCode==='SERVICE_FAILURE')await raiseIssue(tx,task.id,effective==='PRIVACY_HOLD'?'PRIVACY_HOLD':!allowed?'STALE_ASSIGNMENT':reasonCode,null,id);
   return;
  }
  const latestSlot=await tx.captureSlot.findFirst({where:{sessionId:a.sessionId,contextKey:a.contextKey},orderBy:{generation:'desc'}});
  if(!latestSlot||latestSlot.generation!==a.slot.generation)return;
  const contexts=await tx.verificationAttempt.findMany({where:{sessionId:a.sessionId,contextKey:{not:null}},orderBy:{createdAt:'desc'}});const contextSlots=await tx.captureSlot.findMany({where:{sessionId:a.sessionId,contextKey:{not:null}},orderBy:{generation:'desc'}});
  const latestContexts=new Map<string,string|null>();for(const slot of contextSlots)if(slot.contextKey&&!latestContexts.has(slot.contextKey))latestContexts.set(slot.contextKey,slot.attemptId);
  const contextKeys=requiredContextKeys(a.session.locationCheck);
  const passed=contextKeys.every(key=>contexts.some(c=>c.id===latestContexts.get(key)&&c.state==='PASSED'));
  if(passed)await tx.captureSession.update({where:{id:a.sessionId},data:{contextAttemptIds:contextKeys.map(key=>latestContexts.get(key)!)} });
  await tx.captureSession.update({where:{id:a.sessionId},data:{contextStatus:passed?'ACCEPTABLE':effective==='PASSED'?'PENDING':'UNCERTAIN'}});
  const policy=resolvePolicy(task.policySnapshot);
  if(contextNeedsReview(effective,allowed,reasonCode,contexts.filter(c=>c.contextKey===a.contextKey&&c.state==='RECAPTURE_REQUIRED').length,policy.recaptureFailuresBeforeEscalation))await raiseIssue(tx,task.id,effective==='PRIVACY_HOLD'?'PRIVACY_HOLD':!allowed?'STALE_ASSIGNMENT':reasonCode,null,id);
 }
 // The publication transaction finalizes once after its stage and decision are recorded.
}
export function contextNeedsReview(state:string,authorityValid:boolean,reason:string,failures:number,threshold:number){
 if(state==='RECAPTURE_REQUIRED'&&reason==='WRONG_ITEM')return false;
 return !authorityValid||state==='PRIVACY_HOLD'||state==='REVIEW_REQUIRED'||['DUPLICATE_EVIDENCE','STALE_ASSIGNMENT','PRIVACY_HOLD'].includes(reason)||state!=='PASSED'&&failures>=threshold;
}
