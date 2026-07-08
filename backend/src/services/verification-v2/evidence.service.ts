import { reviewableMedia } from "./evidenceBuffer.js";
import {verificationEvent} from './latency.js';
import {raiseIssue} from './exception.service.js';
import type { EvidenceAsset, Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import {prisma} from '../../prisma/prisma.js';
import {ApiError} from '../../utils/ApiError.js';
import {requireTaskAccess,requireLocationAccess,requireOperationalRole,type VerificationActor} from './authorization.service.js';
import {inspectImage,sha256} from './quality.service.js';
import {storePrivateImage,privateImageBytes} from './media.service.js';
import {enqueueVerificationJob} from './jobQueue.service.js';
import {writeAuditLog} from '../auditLog.service.js';
export type EvidenceStorage={store:typeof storePrivateImage;read:typeof privateImageBytes};
const storage:EvidenceStorage={store:storePrivateImage,read:privateImageBytes};
export const originalPublicId=(companyId:number,attemptId:string)=>`verification/${companyId}/attempts/${attemptId}/original`;
/** Called only after session ingestion has durably reserved an attempt (step 10). */
export async function storeReservedEvidence(actor:VerificationActor,attemptId:string,bytes:Buffer,io=storage,clientDiagnostics?:Record<string,unknown>) {
 const began=Date.now();const timing:Record<string,unknown>={ingestionStartedAt:new Date().toISOString(),...(clientDiagnostics?{client:clientDiagnostics}:{})};
 if(actor.role!=='STAFF')throw new ApiError(403,'Staff account required');
 const attempt=await prisma.verificationAttempt.findUnique({where:{id:attemptId},include:{session:true,media:true}});
 if(!attempt)throw new ApiError(404,'Capture not found');
 await requireTaskAccess(actor,attempt.session.taskInstanceId,{staffMutation:true});
 if(attempt.staffId!==actor.id)throw new ApiError(403,'Capture belongs to another worker');
 const qualityStarted=Date.now();timing.authorizationMs=qualityStarted-began;
 const inspected=await inspectImage(bytes);timing.inspectMs=Date.now()-qualityStarted;
 if(attempt.committedHash!==inspected.sha256)throw new ApiError(409,'Different bytes require a new capture');
 if(attempt.media)return {attemptId,assetId:attempt.media.id,state:attempt.state};
 const publicId=originalPublicId(actor.companyId,attempt.id);
 const storageStarted=Date.now();
 const reviewPublicId=publicId.replace(/\/original$/,'/review');
 // Both authenticated objects are independent; acknowledgment still waits for both.
 const [uploaded]=await Promise.all([io.store(bytes,publicId,inspected.sha256),io.store(inspected.sanitized,reviewPublicId,sha256(inspected.sanitized))]);
 timing.storageMs=Date.now()-storageStarted;timing.storedAt=new Date().toISOString();
 // Storage happens outside the transaction; deterministic ID/hash permits lost-response recovery.
 const accepted=await prisma.$transaction(async tx=>{
  await tx.$queryRaw`SELECT id FROM "TaskInstance" WHERE id=${attempt.session.taskInstanceId} FOR UPDATE`;
  // Authorization was checked before storage. If ownership changes during the upload,
  // retain the already-authorized bytes and register them as review-only evidence.
  const fresh=await tx.verificationAttempt.findUniqueOrThrow({where:{id:attemptId},include:{media:true,slot:true,requirement:true,session:{include:{task:true}}}});
  if(fresh.committedHash!==inspected.sha256)throw new ApiError(409,'Capture content changed');
  if(fresh.media)return {attemptId,assetId:fresh.media.id,state:fresh.state};
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${actor.companyId+':'+inspected.sha256},0))::text`;
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${actor.companyId+':normalized:'+inspected.normalizedHash},0))::text`;
  const exactReuse=await tx.evidenceAsset.findFirst({where:{companyId:actor.companyId,OR:[{sha256:inspected.sha256},{normalizedHash:inspected.normalizedHash}],originalPublicId:{not:publicId}}});
  const asset=await tx.evidenceAsset.upsert({where:{originalPublicId:publicId},create:{companyId:actor.companyId,locationId:fresh.session.task.locationId,taskInstanceId:fresh.session.taskInstanceId,originalPublicId:publicId,sanitizedPublicId:reviewPublicId,cloudinaryAssetId:uploaded.asset_id,format:inspected.format,bytes:inspected.bytes,width:inspected.width,height:inspected.height,sha256:inspected.sha256,normalizedHash:inspected.normalizedHash,perceptualHash:inspected.perceptualHash},update:{}});
  const staffStillActive=await tx.staff.findFirst({where:{id:actor.id,companyId:actor.companyId,isActive:true,company:{isActive:true},locationId:fresh.session.task.locationId}});
  const assignmentStillCurrent=await tx.taskAssignment.findFirst({where:{id:fresh.session.assignmentId,staffId:actor.id,isCurrent:true,status:{in:['ASSIGNED','STARTED']}}});
  const latestContext=fresh.contextKey?await tx.captureSlot.findFirst({where:{sessionId:fresh.sessionId,contextKey:fresh.contextKey},orderBy:{generation:'desc'}}):null;
  const staleGeneration=fresh.requirement?fresh.requirement.currentAttemptId!==fresh.id||fresh.requirement.decisionVersion!==fresh.slot.generation||['PASSED','MANAGER_ACCEPTED','WAIVED'].includes(fresh.requirement.state):!!latestContext&&latestContext.generation!==fresh.slot.generation;
  const reviewOnly=fresh.state==='REVIEW_REQUIRED'||staleGeneration||!staffStillActive||!assignmentStillCurrent||!fresh.session.task.isActive||fresh.session.task.staffId!==actor.id||['CANCELLED','COMPLETED'].includes(fresh.session.task.status)||!!exactReuse||fresh.session.state==='REVOKED'||fresh.session.assignmentEpoch!==fresh.session.task.assignmentEpoch||new Date()>fresh.session.uploadExpiresAt;
  await tx.verificationAttempt.update({where:{id:attemptId},data:{mediaAssetId:asset.id,receivedAt:new Date(),state:reviewOnly?'REVIEW_REQUIRED':'RECEIVED'}});
  if(exactReuse)await raiseIssue(tx,fresh.session.taskInstanceId,'DUPLICATE_EVIDENCE',fresh.requirementId,fresh.id);
  await enqueueVerificationJob(tx,{companyId:actor.companyId,attemptId,stage:'QUALITY',evaluatorVersion:'quality-v1',result:JSON.parse(JSON.stringify({timing,qualityAtIngestion:{...inspected.quality,hashVariants:inspected.hashVariants}}))});
  return {attemptId,assetId:asset.id,state:reviewOnly?'REVIEW_REQUIRED':'RECEIVED'};
 });
 verificationEvent('UPLOAD_ACCEPTED',{taskId:attempt.session.taskInstanceId,sessionId:attempt.sessionId,attemptId:attempt.id},{...timing,ingestionTotalMs:Date.now()-began});
 return accepted;
}
export async function storeStandardEvidence(actor:VerificationActor,locationId:number,bytes:Buffer,io=storage):Promise<EvidenceAsset> {
 requireOperationalRole(actor);await requireLocationAccess(actor,locationId);
 const info=await inspectImage(bytes);const id=randomUUID();
 const publicId=`verification/${actor.companyId}/standards/${id}/original`;
 const uploaded=await io.store(bytes,publicId,info.sha256);
 const reviewPublicId=publicId.replace(/\/original$/,"/review");
 await io.store(info.sanitized,reviewPublicId,sha256(info.sanitized));
 return prisma.evidenceAsset.create({data:{id,companyId:actor.companyId,locationId,originalPublicId:publicId,sanitizedPublicId:reviewPublicId,cloudinaryAssetId:uploaded.asset_id,format:info.format,bytes:info.bytes,width:info.width,height:info.height,sha256:info.sha256,normalizedHash:info.normalizedHash,perceptualHash:info.perceptualHash}});
}
export async function evidenceContent(actor:VerificationActor,assetId:string,variant:'original'|'review',io=storage) {
 const asset=await prisma.evidenceAsset.findUnique({where:{id:assetId}});
 if(!asset||asset.companyId!==actor.companyId)throw new ApiError(404,'Evidence not found');
 if(asset.taskInstanceId)await requireTaskAccess(actor,asset.taskInstanceId);
 else {requireOperationalRole(actor);await requireLocationAccess(actor,asset.locationId);}
 const restrictedReview=asset.privacyState==='HOLD'&&variant==='review'&&!!asset.taskInstanceId&&['ADMIN','MANAGER'].includes(actor.role);
 if(asset.deliveryType!=='authenticated'||(!reviewableMedia(asset.privacyState)&&!restrictedReview))throw new ApiError(403,'Evidence is awaiting restricted privacy review');
 const publicId=variant==='original'?asset.originalPublicId:asset.sanitizedPublicId;
 if(!publicId)throw new ApiError(409,'Review image is not ready');
 if(variant==='original'&&actor.role!=='ADMIN')throw new ApiError(403,'Original evidence requires admin access');
 const bytes=await io.read(publicId,variant==='review'?'jpg':asset.format);
 if(restrictedReview)await writeAuditLog({companyId:actor.companyId,actorType:actor.role as 'ADMIN'|'MANAGER',actorId:actor.id,entityType:'TASK_INSTANCE',entityId:asset.taskInstanceId!,action:'RESTRICTED_EVIDENCE_VIEWED',newValue:{assetId:asset.id,variant,privacyState:asset.privacyState}});
 return {bytes,format:variant==='review'?'jpeg':asset.format};
}
