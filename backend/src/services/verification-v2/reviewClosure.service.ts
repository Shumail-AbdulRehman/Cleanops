import {z} from 'zod';
import type {Prisma} from '@prisma/client';
import {prisma} from '../../prisma/prisma.js';
import {ApiError} from '../../utils/ApiError.js';
import {writeAuditLog} from '../auditLog.service.js';
import {caseAccess} from './exception.service.js';
import {requireOperationalRole,requireTaskAccess,type VerificationActor} from './authorization.service.js';
import {lockTask} from './captureSession.service.js';
import {sha256} from './quality.service.js';
export const reviewClosureActions=['RESOLVE_REVIEW','RECORD_PERFORMANCE_ISSUE'] as const;
export const performanceCategories=['CLEANING_QUALITY','MISSING_PHOTOS','WRONG_PHOTO','INCOMPLETE_WORK','OTHER'] as const;
export const closeReviewSchema=z.object({requestId:z.uuid(),expectedVersion:z.number().int().nonnegative(),action:z.enum(reviewClosureActions),note:z.string().trim().min(1).max(1000),staffId:z.number().int().positive().optional(),category:z.enum(performanceCategories).optional()}).strict().superRefine((input,ctx)=>{
 if(input.action==='RECORD_PERFORMANCE_ISSUE'&&(!input.staffId||!input.category))ctx.addIssue({code:'custom',message:'Choose the responsible staff member and a performance category'});
 if(input.action==='RESOLVE_REVIEW'&&(input.staffId||input.category))ctx.addIssue({code:'custom',message:'Staff and category are only used when recording a performance issue'});
});
export async function closeReview(actor:VerificationActor,id:number,raw:unknown){
 const input=closeReviewSchema.parse(raw);
 return prisma.$transaction(async tx=>{
  let review=await caseAccess(actor,id,tx);
  if(review.kind!=='TASK'||!review.taskInstanceId)throw new ApiError(409,'Configure the area template to resolve a setup review.');
  await lockTask(tx,review.taskInstanceId);
  await tx.$queryRaw`SELECT id FROM "VerificationException" WHERE id=${id} FOR UPDATE`;
  review=await caseAccess(actor,id,tx);
  const key={companyId:actor.companyId,actorRole:actor.role,actorId:actor.id,operation:`close-review:${id}`,requestId:input.requestId};
  const bodyHash=sha256(JSON.stringify(input));
  const prior=await tx.verificationRequest.findUnique({where:{companyId_actorRole_actorId_operation_requestId:key}});
  if(prior){if(prior.bodyHash!==bodyHash)throw new ApiError(409,'This request was already used for a different decision.');return tx.verificationDecision.findUniqueOrThrow({where:{id:Number(prior.resultEntityId)}});}
  if(review.rowVersion!==input.expectedVersion)throw new ApiError(409,'This review changed. Refresh before saving.');
  if(review.state==='RESOLVED')throw new ApiError(409,'This review has already been resolved.');
  const task=await requireTaskAccess(actor,review.taskInstanceId!,{},tx);
  let staff:{id:number;name:string}|null=null;
  if(input.action==='RECORD_PERFORMANCE_ISSUE'){
   staff=await tx.staff.findFirst({where:{id:input.staffId,companyId:actor.companyId,OR:[{taskInstances:{some:{id:task.id}}},{taskAssignments:{some:{taskInstanceId:task.id}}}]},select:{id:true,name:true}});
   if(!staff)throw new ApiError(422,'Choose a staff member assigned to this task.');
   if(await tx.exceptionEvent.findUnique({where:{dedupeKey:`performance-review:${id}`}}))throw new ApiError(409,'A performance issue is already recorded for this task review. Resolve the review instead.');
  }
  const manager=await tx.manager.findUniqueOrThrow({where:{id:actor.id},select:{name:true}});
  const issues=await tx.verificationIssue.findMany({where:{exceptionId:id,state:{not:'RESOLVED'}},select:{id:true,reasonCode:true}});
  const requirements=await tx.taskEvidenceRequirement.findMany({where:{item:{taskInstanceId:task.id,mandatory:true},mandatory:true,state:{notIn:['PASSED','MANAGER_ACCEPTED','WAIVED']}},select:{state:true}});
  const decision=await tx.verificationDecision.create({data:{exceptionId:id,action:input.action,reasonCode:input.category??'MANAGER_RESOLVED',note:input.note,actorManagerId:actor.id,expectedDecisionVersion:input.expectedVersion}});
  const now=new Date();
  await tx.verificationIssue.updateMany({where:{exceptionId:id,state:{not:'RESOLVED'}},data:{state:'RESOLVED',resolvedAt:now}});
  await tx.verificationException.update({where:{id},data:{state:'RESOLVED',resolvedAt:now,nextReminderAt:null,rowVersion:{increment:1}}});
  const snapshot={decisionId:decision.id,action:input.action,taskId:task.id,taskTitle:task.title,taskDate:task.date.toISOString(),managerId:actor.id,managerName:manager.name,note:input.note,reasonCodes:[...new Set(issues.map(issue=>issue.reasonCode))],unresolvedPhotoCount:requirements.length};
  await tx.exceptionEvent.create({data:{exceptionId:id,type:'REVIEW_CLOSED',dedupeKey:`review-closed:${decision.id}`,payload:snapshot}});
  if(staff)await tx.exceptionEvent.create({data:{exceptionId:id,type:'STAFF_PERFORMANCE_ISSUE',dedupeKey:`performance-review:${id}`,payload:{...snapshot,staffId:staff.id,staffName:staff.name,category:input.category!}}});
  await tx.verificationRequest.create({data:{...key,bodyHash,resultEntityId:String(decision.id)}});
  await writeAuditLog({companyId:actor.companyId,actorType:actor.role,actorId:actor.id,entityType:'TASK_INSTANCE',entityId:task.id,action:input.action,reason:input.note,newValue:{exceptionId:id,decisionId:decision.id,...(staff?{staffId:staff.id,category:input.category}:{}),resolvedIssueIds:issues.map(issue=>issue.id)} as Prisma.InputJsonObject},tx);
  return decision;
 });
}

/** Manager-confirmed reports are KPI facts, not automated cleanliness penalties. */
export async function staffPerformanceReports(actor:VerificationActor,staffId:number,dateFilter?:{gte?:Date;lt?:Date}){
 requireOperationalRole(actor);
 const locationIds=actor.role==='MANAGER'?(await prisma.managerLocation.findMany({where:{managerId:actor.id},select:{locationId:true}})).map(row=>row.locationId):undefined;
 const where:Prisma.ExceptionEventWhereInput={type:'STAFF_PERFORMANCE_ISSUE',exception:{companyId:actor.companyId,...(locationIds?{locationId:{in:locationIds}}:{})},payload:{path:['staffId'],equals:staffId},...(dateFilter?{createdAt:dateFilter}:{})};
 const [total,events]=await Promise.all([prisma.exceptionEvent.count({where}),prisma.exceptionEvent.findMany({where,orderBy:[{createdAt:'desc'},{id:'desc'}],take:20,select:{id:true,exceptionId:true,createdAt:true,payload:true}})]);
 return {total,reports:events.map(event=>{const payload=event.payload as Record<string,Prisma.JsonValue>;return{id:event.id,reviewId:event.exceptionId,recordedAt:event.createdAt,category:payload.category,note:payload.note,taskId:payload.taskId,taskTitle:payload.taskTitle,managerName:payload.managerName};})};
}
