import { assertAccountCompletion } from '../accountAccess.service.js';
import {prisma} from '../../prisma/prisma.js';
import {ApiError} from '../../utils/ApiError.js';
import {requireTaskAccess,type VerificationActor} from './authorization.service.js';
import {lockTask} from './captureSession.service.js';
import {authorizedWaiverReceipts,assertRequiredReceipts} from './launchPhotoPolicy.js';
import {checkedAttempt} from './sequentialPolicy.js';
import {finalizeTask} from './completion.service.js';
import {raiseIssue} from './exception.service.js';
import {writeAuditLog} from '../auditLog.service.js';
/** Staff submission is final for staff, while manager verification remains independently unresolved. */
export async function finishStaffSubmission(actor:VerificationActor,taskId:number){
 if(actor.role!=='STAFF')throw new ApiError(403,'Staff account required');
 return prisma.$transaction(async tx=>{
  await lockTask(tx,taskId);const task=await requireTaskAccess(actor,taskId,{},tx);
  if(task.staffSubmittedAt||task.status==='COMPLETED')return {id:taskId,status:'COMPLETED',staffSubmittedAt:task.staffSubmittedAt??task.completedAt};
  if(!['IN_PROGRESS','NOT_COMPLETED_INTIME'].includes(task.status))throw new ApiError(409,'Start this task before submitting it.');
  await assertAccountCompletion(actor,{kind:'task',id:taskId},tx);
  const requirements=await tx.taskEvidenceRequirement.findMany({where:{item:{taskInstanceId:taskId,mandatory:true},mandatory:true},include:{item:true}});
  if(!requirements.length)throw new ApiError(409,'Capture all required photos before finishing.',[{code:'MISSING_EVIDENCE'}]);
  const waived=await authorizedWaiverReceipts(tx,actor,taskId,requirements);
  const remaining=requirements.filter(r=>!waived.has(r.id));
  if(remaining.some(r=>!r.currentAttemptId))throw new ApiError(409,'Capture all required photos before finishing.',[{code:'MISSING_EVIDENCE'}]);
  const attempts=await tx.verificationAttempt.findMany({where:{id:{in:remaining.map(r=>r.currentAttemptId).filter((id):id is string=>!!id)}},include:{media:true,session:true}});
  const assignment=task.assignments.find(a=>a.isCurrent&&a.staffId===actor.id&&['ASSIGNED','STARTED'].includes(a.status));
  if(!assignment)throw new ApiError(409,'Current assignment required',[{code:'STALE_ASSIGNMENT'}]);
  assertRequiredReceipts(requirements,attempts,waived,{taskId,staffId:actor.id,assignmentEpoch:task.assignmentEpoch,assignmentId:assignment.id});
  const sessionIds=[...new Set(attempts.map(a=>a.sessionId))];
  const sessions=await tx.captureSession.findMany({where:{id:{in:sessionIds}}});
  // A required room-context photo must have been received and checked, including preserved QR renewals.
  for(const session of sessions.filter(s=>s.contextStatus==='PENDING')){const contextSlots=await tx.captureSlot.findMany({where:{sessionId:session.id,contextKey:{not:null}},include:{attempt:true}});if(!contextSlots.length||contextSlots.some(slot=>!slot.attempt?.receivedAt||!slot.attempt.mediaAssetId||!checkedAttempt(slot.attempt.state)))throw new ApiError(409,'Finish the room photo check before submitting.',[{code:'CONTEXT_NOT_CHECKED'}]);}
  await finalizeTask(tx,taskId);
  const fresh=await tx.taskInstance.findUniqueOrThrow({where:{id:taskId}});
  if(fresh.status!=='COMPLETED'){
   const review=attempts.filter(a=>a.state!=='PASSED');
   // The upload request already raises review issues for checked photos. Read them once
   // instead of repeating authorization, case and issue queries for every view.
   // Only a current manager-review issue covers this exact received attempt.
   const existingReview=await tx.verificationIssue.findMany({where:{exception:{taskInstanceId:taskId},state:'MANAGER_REVIEW'},select:{requirementId:true,latestAttemptId:true}});
   if(!review.length)await raiseIssue(tx,taskId,'IDENTITY_UNCERTAIN');
   for(const attempt of review){if(existingReview.some(issue=>issue.requirementId===attempt.requirementId&&issue.latestAttemptId===attempt.id))continue;const reason=(attempt.coverageResult as {originality?:{status?:string};result?:{reasonCode?:string}}|null)?.originality?.status==='SCREEN_RECAPTURE'?'PHOTO_OF_SCREEN':attempt.state==='SERVICE_FAILURE'?'SERVICE_FAILURE':attempt.state==='PRIVACY_HOLD'?'PRIVACY_HOLD':(attempt.cleanlinessResult as {policyDecisionReason?:string}|null)?.policyDecisionReason??'CANNOT_ASSESS';await raiseIssue(tx,taskId,reason,attempt.requirementId,attempt.id);}
  }
  const now=new Date();await tx.taskInstance.update({where:{id:taskId},data:{staffSubmittedAt:now,rowVersion:{increment:1}}});
  await tx.captureSession.updateMany({where:{taskInstanceId:taskId,state:{in:['ACTIVE','PAUSED']}},data:{state:'CLOSED',closedAt:now,rowVersion:{increment:1}}});
  await writeAuditLog({companyId:actor.companyId,actorType:'STAFF',actorId:actor.id,entityType:'TASK_INSTANCE',entityId:taskId,action:'STAFF_SUBMISSION_FINISHED',newValue:{submittedAt:now,managerReviewPending:fresh.status!=='COMPLETED'}},tx);
  return {id:taskId,status:'COMPLETED',staffSubmittedAt:now};
 },{maxWait:10000,timeout:30000});
}
