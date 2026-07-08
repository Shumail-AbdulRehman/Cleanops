import {assertFailedViewReplacement,assertLegacyRetakeRenewal,assertFailedContextReplacement,authorizedWaiverReceipts} from './launchPhotoPolicy.js';
import {releaseInterruptedPhotos} from './directProcessing.js';
import {staffPhotoInstructions, type PhotoFeedbackContext} from './staffPhotoInstructions.js';
import { retireContextPhotos } from "./retireContextPhotos.js";
import { reviewableMedia } from "./evidenceBuffer.js";
import {SEQUENTIAL_WORKFLOW,sequentialCapture,checkedAttempt,currentPhotoSlots} from './sequentialPolicy.js';
import {Prisma} from '@prisma/client';
import {spatialEvidenceSchema,validateSpatialBinding} from './spatial.contracts.js';
import {isDeepStrictEqual} from 'node:util';
import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {prisma} from '../../prisma/prisma.js';
import {ApiError} from '../../utils/ApiError.js';
import {evaluatePresence} from './presence.service.js';
import {requireTaskAccess,type VerificationActor} from './authorization.service.js';
import {sessionRequestSchema,reworkSessionRequestSchema,captureMetadataSchema,reasonCodeSchema} from './contracts.js';
import {verifyTaskQr,slotNonce,hashNonce} from './qr.service.js';
import {sha256} from './quality.service.js';
import {reasonInstructions,resolvePolicy,sessionWindows,validateCaptureTiming,classifyTiming} from './verificationPolicy.service.js';
import type {VerificationTransaction} from './transaction.js';
import {CURRENT_CONTEXT_KEYS,captureContextPolicy,requiredContextKeys} from './contextPolicy.js';
const terminal=['PASSED','MANAGER_ACCEPTED','WAIVED'] as const;
const createSchema=sessionRequestSchema.extend({takeover:z.boolean().default(false)});
const deviceSchema=z.string().min(1).max(200);
const metadataSchema=captureMetadataSchema.extend({deviceId:deviceSchema});
const fail=(status:number,code:string,message:string)=>new ApiError(status,message,[{code}]);
export async function lockTask(tx:VerificationTransaction,id:number){await tx.$queryRaw`SELECT id FROM "TaskInstance" WHERE id=${id} FOR UPDATE`;}
export async function sessionResponse(tx:VerificationTransaction,id:string,forceRenewal=false){const s=await tx.captureSession.findUniqueOrThrow({where:{id},include:{slots:{orderBy:{sequence:'asc'}},attempts:{select:{id:true,clientCaptureId:true,slotId:true,state:true,mediaAssetId:true,media:{select:{privacyState:true}}}}}});return {...s,sequentialChecks:sequentialCapture(s.locationCheck),objectCaptureSeconds:sequentialCapture(s.locationCheck)?(s.locationCheck as {objectCaptureSeconds?:number}).objectCaptureSeconds:undefined,requiredContextKeys:requiredContextKeys(s.locationCheck),attempts:(s.attempts??[]).map(a=>({id:a.id,clientCaptureId:a.clientCaptureId,slotId:a.slotId,state:a.state,mediaAssetId:reviewableMedia(a.media?.privacyState)&&a.state!=='PRIVACY_HOLD'?a.mediaAssetId:null})),serverTime:new Date(),requiresRenewal:forceRenewal||!['ACTIVE','PAUSED'].includes(s.state)||s.captureExpiresAt<=new Date(),slots:s.slots.filter(slot=>!slot.contextKey||requiredContextKeys(s.locationCheck).includes(slot.contextKey as any)).map(slot=>({...slot,nonce:!forceRenewal&&s.state==='ACTIVE'&&s.captureExpiresAt>new Date()?slotNonce(s.id,slot.id,slot.generation):undefined,nonceHash:undefined}))};}
async function allocate(tx:VerificationTransaction,sessionId:string,purpose:{requirementId?:string;contextKey?:string},sequence:number,generation:number,expiresAt:Date){const id=randomUUID();return tx.captureSlot.create({data:{id,sessionId,...purpose,sequence,generation,expiresAt,nonceHash:hashNonce(slotNonce(sessionId,id,generation))}});}
export async function createCaptureSession(actor:VerificationActor,taskId:number,raw:unknown,renewId?:string,rework=false){const reworkInput=rework?reworkSessionRequestSchema.parse(raw):null;const input=reworkInput?{...reworkInput,takeover:false}:createSchema.parse(raw);return prisma.$transaction(async tx=>{
 const initial=await requireTaskAccess(actor,taskId,{staffMutation:true},tx);if(initial.verificationVersion!==2||!initial.areaId)throw new ApiError(409,'Inventory verification required');
 await tx.$queryRaw`SELECT id FROM "Area" WHERE id=${initial.areaId} FOR UPDATE`;await lockTask(tx,taskId);const task=await requireTaskAccess(actor,taskId,{staffMutation:true},tx);
 const operation=rework?'rework-session':renewId?`renew:${renewId}`:'create-session',bodyHash=sha256(JSON.stringify(input));const key={companyId:actor.companyId,actorRole:actor.role,actorId:actor.id,operation,requestId:input.requestId};const prior=await tx.verificationRequest.findUnique({where:{companyId_actorRole_actorId_operation_requestId:key}});
 if(prior){const result=await tx.captureSession.findUnique({where:{id:prior.resultEntityId}});if(!result||result.taskInstanceId!==taskId)throw fail(409,'IDEMPOTENCY_CONFLICT','Request ID belongs to another task');if(prior.bodyHash!==bodyHash)throw new ApiError(409,'Request ID was used for different data');const currentArea=await tx.area.findUnique({where:{id:task.areaId!}});return sessionResponse(tx,prior.resultEntityId,result.assignmentEpoch!==task.assignmentEpoch||result.staffId!==actor.id||result.deviceId!==input.deviceId||currentArea?.qrVersion!==result.qrVersion||task.status==='COMPLETED');}
 if(!['IN_PROGRESS','NOT_COMPLETED_INTIME'].includes(task.status))throw new ApiError(409,'Start cleaning before collecting evidence');
 if(renewId){const old=await authorizedSession(actor,renewId,tx);if(old.taskInstanceId!==taskId)throw fail(404,'SESSION_NOT_FOUND','Session not found');if(old.deviceId!==input.deviceId&&!input.takeover)throw fail(409,'TAKEOVER_REQUIRED','Explicit device takeover required');if(old.state==='REVOKED')throw fail(410,'SESSION_REVOKED','Session revoked');}
 const area=await tx.area.findUniqueOrThrow({where:{id:task.areaId!}});verifyTaskQr(input.areaQr,task,area);const now=new Date(),policy=resolvePolicy(task.policySnapshot),windows=safeWindows(now,task.shiftEnd,policy,task.startedAt,task.verificationDeadline?Math.max(0,Math.floor((+task.verificationDeadline-+task.shiftEnd)/60000)):0);
 if(task.verificationDeadline){windows.captureExpiresAt=new Date(Math.min(+windows.captureExpiresAt,+task.verificationDeadline));windows.uploadExpiresAt=new Date(Math.min(+windows.uploadExpiresAt,+(task.uploadDeadline??windows.uploadExpiresAt)));}if(windows.captureExpiresAt<=now)throw new ApiError(410,'Capture window expired');
 const {check,decision:presence}=evaluatePresence({latitude:Number(task.location.latitude),longitude:Number(task.location.longitude),radiusMeters:task.location.radiusMeters},input.location,policy,now);if(presence.status==='OUTSIDE')throw new ApiError(422,'Return to the task location',[{code:'GPS_OUTSIDE'}]);
 const active=await tx.captureSession.findFirst({where:{taskInstanceId:taskId,assignmentEpoch:task.assignmentEpoch,state:{in:['ACTIVE','PAUSED']}}});if(active&&active.deviceId!==input.deviceId&&!input.takeover)throw fail(409,'TAKEOVER_REQUIRED','Explicit device takeover required');if(renewId&&active&&active.id!==renewId)throw fail(409,'SESSION_EXISTS','Renew the current session');if(active&&active.captureExpiresAt>now&&!renewId&&!rework){if(active.deviceId===input.deviceId)throw new ApiError(409,'Resume the existing session',[{code:'SESSION_EXISTS',sessionId:active.id}]);if(!input.takeover)throw new ApiError(409,'Explicit device takeover required',[{code:'TAKEOVER_REQUIRED'}]);}
 const previousSession=active??await tx.captureSession.findFirst({where:{taskInstanceId:taskId,assignmentEpoch:task.assignmentEpoch},orderBy:{issuedAt:'desc'}});if(previousSession&&previousSession.deviceId!==input.deviceId&&!input.takeover)throw fail(409,'TAKEOVER_REQUIRED','Explicit device takeover required');
 await releaseInterruptedPhotos(tx,taskId);
 if(previousSession&&sequentialCapture(previousSession.locationCheck)&&await tx.verificationAttempt.count({where:{session:{taskInstanceId:taskId},receivedAt:{not:null},state:{in:['RECEIVED','QUALITY_CHECK','COVERAGE_CHECK','CLEANLINESS_CHECK','RETRY_WAIT']}}}))throw fail(409,'PREVIOUS_PHOTO_UNRESOLVED','Wait for the current photo to finish checking before scanning again.');
 const reworkTargets=reworkInput?.requirements??[];
 for(const requested of reworkTargets){
  const r=await tx.taskEvidenceRequirement.findFirst({where:{id:requested.requirementId,item:{taskInstanceId:taskId}},include:{item:true}});
  if(!r)throw fail(404,'REQUIREMENT_NOT_FOUND','Requirement not found');
  if(r.state!=='CLEANING_REQUIRED'||r.decisionVersion!==requested.expectedGeneration)throw fail(409,'STALE_GENERATION','Select the items that need cleaning');
  const failed=r.currentAttemptId?await tx.verificationAttempt.findUnique({where:{id:r.currentAttemptId},include:{session:true,slot:true}}):null;
  const current=task.assignments.find(a=>a.isCurrent&&a.staffId===actor.id&&['ASSIGNED','STARTED'].includes(a.status));
  if(!current)throw fail(409,'STALE_ASSIGNMENT','Assignment changed');
  assertFailedViewReplacement({task,session:{id:'fresh-qr',taskInstanceId:task.id,staffId:actor.id,assignmentId:current.id,assignmentEpoch:task.assignmentEpoch,...windows},staffId:actor.id,now,requirement:r,attempt:failed,expectedGeneration:requested.expectedGeneration,cleaning:true});
 }
 await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${'session-rate:'+actor.companyId},0))::text`;if(await tx.captureSession.count({where:{task:{location:{companyId:actor.companyId}},issuedAt:{gt:new Date(+now-60000)}}})>=100)throw fail(429,'RATE_LIMITED','Too many company session requests');if(await tx.captureSession.count({where:{staffId:actor.id,issuedAt:{gt:new Date(+now-60000)}}})>=10)throw fail(429,'RATE_LIMITED','Too many worker session requests');if(await tx.captureSession.count({where:{staffId:actor.id,taskInstanceId:taskId,issuedAt:{gt:new Date(+now-60000)}}})>=5)throw new ApiError(429,'Too many session requests');
 if(active)await tx.captureSession.update({where:{id:active.id},data:{state:active.deviceId!==input.deviceId?'REVOKED':'EXPIRED',closedAt:now,rowVersion:{increment:1}}});
 if(previousSession&&previousSession.deviceId!==input.deviceId)await tx.auditLog.create({data:{companyId:actor.companyId,actorType:actor.role,actorId:actor.id,entityType:'TaskInstance',entityId:taskId,action:'CAPTURE_DEVICE_TAKEOVER',oldValue:{sessionId:previousSession.id},newValue:{assignmentEpoch:task.assignmentEpoch}}});
 if(input.takeover)await tx.captureSession.updateMany({where:{taskInstanceId:taskId,assignmentEpoch:task.assignmentEpoch,deviceId:{not:input.deviceId},state:{not:'REVOKED'}},data:{state:'REVOKED',closedAt:now,rowVersion:{increment:1}}});
 const assignment=task.assignments.find(a=>a.isCurrent&&a.staffId===actor.id&&['ASSIGNED','STARTED'].includes(a.status));if(!assignment)throw new ApiError(409,'Assignment changed');
 const contextKeys=CURRENT_CONTEXT_KEYS;
 await retireContextPhotos(tx,actor,taskId);
 const s=await tx.captureSession.create({data:{taskInstanceId:taskId,areaId:task.areaId!,staffId:actor.id,assignmentId:assignment.id,assignmentEpoch:task.assignmentEpoch,deviceId:input.deviceId,qrVersion:area.qrVersion,policyVersion:policy.version,contextStatus:contextKeys.length?'PENDING':'ACCEPTABLE',...windows,issuedAt:now,serverTimeAnchor:now,clientBootId:input.clientBootId,presenceStatus:presence.status,locationCheck:{...check,...presence,captureWorkflow:SEQUENTIAL_WORKFLOW,objectCaptureSeconds:policy.objectCaptureSeconds,captureContextPolicy:captureContextPolicy(contextKeys),...(rework?{capturePurpose:'DIRTY_REWORK',reworkRequirementIds:reworkTargets.map(r=>r.requirementId)}:{})}}});let sequence=0;
 const priorContextSlots=previousSession&&sequentialCapture(previousSession.locationCheck)?await tx.captureSlot.findMany({where:{sessionId:previousSession.id,contextKey:{not:null}},include:{attempt:true},orderBy:{generation:'desc'}}):[];
 const preservedContext=contextKeys.length>0&&contextKeys.every(key=>priorContextSlots.some(slot=>slot.contextKey===key&&slot.attempt&&slot.attempt.receivedAt&&slot.attempt.mediaAssetId&&checkedAttempt(slot.attempt.state)));
 if(preservedContext)await tx.captureSession.update({where:{id:s.id},data:{contextStatus:previousSession!.contextStatus==='PENDING'?'UNCERTAIN':previousSession!.contextStatus,contextAttemptIds:contextKeys.map(key=>priorContextSlots.find(slot=>slot.contextKey===key&&slot.attempt&&slot.attempt.receivedAt&&slot.attempt.mediaAssetId&&checkedAttempt(slot.attempt.state))!.attemptId!)}});
 for(const contextKey of preservedContext?[]:contextKeys)await allocate(tx,s.id,{contextKey},sequence++,0,s.captureExpiresAt);
 // A reservation whose bytes never arrived must not strand an unresolved view after renewal.
 const processing=await tx.taskEvidenceRequirement.findMany({where:{item:{taskInstanceId:taskId},state:'PROCESSING',currentAttemptId:{not:null}}});
 const abandoned=await tx.verificationAttempt.findMany({where:{id:{in:processing.map(r=>r.currentAttemptId!)},state:{in:['RESERVED','STORING']},mediaAssetId:null,OR:[{session:{OR:[{uploadExpiresAt:{lt:now}},{state:'REVOKED'}]}},{qualityResult:{path:['workflow'],equals:'DIRECT_PHOTO_V1'}}]},select:{id:true}});
 const abandonedIds=new Set(abandoned.map(a=>a.id));
 for(const r of processing)if(abandonedIds.has(r.currentAttemptId!))await tx.taskEvidenceRequirement.update({where:{id:r.id},data:{state:'MISSING',currentAttemptId:null,decisionVersion:{increment:1}}});
 const requirements=await tx.taskEvidenceRequirement.findMany({where:{item:{taskInstanceId:taskId},...(rework?previousSession&&sequentialCapture(previousSession.locationCheck)?{OR:[{id:{in:reworkTargets.map(r=>r.requirementId)},state:'CLEANING_REQUIRED' as const},{state:'MISSING' as const}],state:undefined}:{id:{in:reworkTargets.map(r=>r.requirementId)},state:'CLEANING_REQUIRED' as const}:{state:{notIn:[...terminal,'PROCESSING','CLEANING_REQUIRED','REVIEW_REQUIRED']}})},include:{item:true},orderBy:[{item:{orderSnapshot:'asc'}},{viewKey:'asc'}]});
 for(const r of requirements){
  const recapture=r.state==='RECAPTURE_REQUIRED';
  if(recapture){
   const failed=r.currentAttemptId?await tx.verificationAttempt.findUnique({where:{id:r.currentAttemptId},include:{session:true,slot:true}}):null;
   const proof={task,session:s,staffId:actor.id,now,requirement:r,attempt:failed,expectedGeneration:r.decisionVersion};
   if(failed?.slot.generation===r.decisionVersion-2)await assertLegacyRetakeRenewal(tx,proof);
   else assertFailedViewReplacement(proof);
  }
  const advanceGeneration=!!previousSession||rework||recapture;
  const generation=r.decisionVersion+(advanceGeneration?1:0);
  if(advanceGeneration){
   const replacement=recapture||reworkTargets.some(target=>target.requirementId===r.id);
   // Retain the failed attempt pointer for supersedesAttemptId when the new slot is reserved.
   await tx.taskEvidenceRequirement.update({where:{id:r.id},data:{decisionVersion:generation,...(replacement?{state:'MISSING' as const}:{})}});
  }
  await allocate(tx,s.id,{requirementId:r.id},sequence++,generation,s.captureExpiresAt);
 }
 if(rework)await tx.auditLog.create({data:{companyId:actor.companyId,actorType:actor.role,actorId:actor.id,entityType:'TaskInstance',entityId:taskId,action:'DIRTY_REWORK_QR_AUTHORIZED',newValue:{sessionId:s.id,requirementIds:reworkTargets.map(r=>r.requirementId),assignmentEpoch:task.assignmentEpoch}}});
 await tx.taskInstance.update({where:{id:taskId},data:{verificationState:'CAPTURING',rowVersion:{increment:1}}});await tx.verificationRequest.create({data:{...key,bodyHash,resultEntityId:s.id}});return sessionResponse(tx,s.id);
 });}
export async function createReworkCaptureSession(actor:VerificationActor,taskId:number,raw:unknown){return createCaptureSession(actor,taskId,raw,undefined,true);}
export async function authorizedSession(actor:VerificationActor,id:string,tx:VerificationTransaction,deviceId?:string,allowReviewUpload=false){const s=await tx.captureSession.findUnique({where:{id}});if(!s||s.staffId!==actor.id)throw new ApiError(404,'Session not found');const task=await requireTaskAccess(actor,s.taskInstanceId,{staffMutation:true},tx);if(deviceId!==undefined&&deviceId!==s.deviceId)throw new ApiError(409,'Session belongs to another device');const area=await tx.area.findUnique({where:{id:s.areaId}});if(!area||(!allowReviewUpload&&area.qrVersion!==s.qrVersion))throw fail(410,'QR_REVOKED','Area QR authority revoked');if(task.assignmentEpoch!==s.assignmentEpoch||!task.assignments.some(a=>a.id===s.assignmentId&&a.isCurrent))throw new ApiError(410,'Assignment authority revoked');return {...s,task,area};}

/** Locate only the owned task before locking; all authority is checked after the lock. */
export async function lockAuthorizedSession(actor:VerificationActor,id:string,tx:VerificationTransaction,deviceId?:string,allowReviewUpload=false){
 if(actor.role!=='STAFF')throw new ApiError(403,'Staff account required');
 const initial=await tx.captureSession.findUnique({where:{id},select:{staffId:true,taskInstanceId:true}});
 if(!initial||initial.staffId!==actor.id)throw new ApiError(404,'Session not found');
 await lockTask(tx,initial.taskInstanceId);
 const session=await authorizedSession(actor,id,tx,deviceId,allowReviewUpload);
 if(session.taskInstanceId!==initial.taskInstanceId)throw new ApiError(409,'Session task changed');
 return session;
}
export async function resumeSession(actor:VerificationActor,id:string,raw:unknown){const input=z.object({deviceId:deviceSchema,clientBootId:deviceSchema,pendingCaptureIds:z.array(z.uuid()).max(50).default([])}).strict().parse(raw);return prisma.$transaction(async tx=>{const s=await lockAuthorizedSession(actor,id,tx,input.deviceId);if(s.state==='REVOKED')throw new ApiError(410,'Session revoked');await retireContextPhotos(tx,actor,s.taskInstanceId);if(s.state==='PAUSED'&&s.captureExpiresAt>new Date()&&input.clientBootId===s.clientBootId)await tx.captureSession.update({where:{id},data:{state:'ACTIVE'}});return {...await sessionResponse(tx,id,input.clientBootId!==s.clientBootId),requiresRenewal:!['ACTIVE','PAUSED'].includes(s.state)||s.captureExpiresAt<=new Date()||input.clientBootId!==s.clientBootId,pendingCaptureIds:input.pendingCaptureIds};});}
export async function reserveAttempt(actor:VerificationActor,id:string,raw:unknown,manifest:boolean){const input=metadataSchema.parse(raw);return prisma.$transaction(async tx=>{
 const s=await lockAuthorizedSession(actor,id,tx,input.deviceId,!manifest);
 const now=new Date(),area=s.area,qrRevoked=area.qrVersion!==s.qrVersion,reviewOnly=!manifest&&(qrRevoked||now>s.uploadExpiresAt);if(s.state==='REVOKED'&&!qrRevoked)throw fail(410,'SESSION_REVOKED','Session revoked');if(manifest&&now>s.uploadExpiresAt)throw fail(410,'UPLOAD_EXPIRED','Upload window expired');if(manifest&&(s.state!=='ACTIVE'||now>s.captureExpiresAt))throw fail(410,'CAPTURE_EXPIRED','Capture authority expired');
 const previous=await tx.verificationAttempt.findUnique({where:{sessionId_clientCaptureId:{sessionId:id,clientCaptureId:input.clientCaptureId}}});if(previous){if(input.bootId!==s.clientBootId||previous.committedHash!==input.sha256||previous.slotId!==input.slotId||+previous.claimedCapturedAt!==Date.parse(input.claimedCapturedAt)||previous.anchoredElapsedMs!==BigInt(input.elapsedMs)||!isDeepStrictEqual(previous.spatialEvidence??null,input.spatialEvidence??null))throw new ApiError(409,'Capture ID was used for different evidence');const boundSlot=await tx.captureSlot.findFirst({where:{id:input.slotId,sessionId:id}});if(!boundSlot||boundSlot.nonceHash!==hashNonce(input.nonce))throw fail(422,'INVALID_NONCE','Invalid capture nonce');return previous;}
 const slot=await tx.captureSlot.findFirst({where:{id:input.slotId,sessionId:id}});if(!slot||slot.contextKey&&!requiredContextKeys(s.locationCheck).includes(slot.contextKey as any))throw new ApiError(404,'Capture slot not found');if(slot.nonceHash!==hashNonce(input.nonce))throw new ApiError(422,'Invalid capture nonce');let staleContext=false;if(slot.contextKey){const latest=await tx.captureSlot.findFirst({where:{sessionId:id,contextKey:slot.contextKey},orderBy:{generation:'desc'}});staleContext=!!latest&&latest.generation!==slot.generation;if(manifest&&staleContext)throw fail(409,'STALE_GENERATION','Context generation changed');}if(slot.attemptId)throw new ApiError(409,'Capture slot already consumed');
 if(sequentialCapture(s.locationCheck)){
  if(!slot.activatedAt)throw fail(409,'PHOTO_STEP_NOT_ACTIVE','Open the current photo step before capturing.');
  const earlier=await tx.captureSlot.findMany({where:{sessionId:id},include:{attempt:true,requirement:true}});
  const waived=await authorizedWaiverReceipts(tx,actor,s.taskInstanceId,earlier.flatMap(slot=>slot.requirement?[slot.requirement]:[]));
  if(currentPhotoSlots(earlier.filter(slot=>!slot.contextKey||requiredContextKeys(s.locationCheck).includes(slot.contextKey as any))).some(prior=>prior.sequence<slot.sequence&&!(prior.requirementId&&waived.has(prior.requirementId))&&(!prior.attempt||!prior.attempt.receivedAt||!prior.attempt.mediaAssetId||!checkedAttempt(prior.attempt.state))))throw fail(409,'PREVIOUS_PHOTO_UNRESOLVED','Wait for the current photo check before taking the next.');
  if(Date.parse(input.claimedCapturedAt)<+slot.activatedAt||Date.parse(input.claimedCapturedAt)>+slot.expiresAt)throw fail(410,'QR_RENEWAL_REQUIRED','Time expired. Scan the room QR again to continue this item.');
 }
 const capturedAt=new Date(input.claimedCapturedAt),validTiming=validateCaptureTiming({issuedAt:s.issuedAt,claimedCapturedAt:capturedAt,elapsedMs:input.elapsedMs,sessionBootId:s.clientBootId,captureBootId:input.bootId,receivedAt:now});if(manifest&&(s.state!=='ACTIVE'||now>s.captureExpiresAt))throw new ApiError(410,'Capture authority expired');if(capturedAt>slot.expiresAt||+s.issuedAt+input.elapsedMs>+slot.expiresAt)throw new ApiError(410,'Photo is outside the capture window');
 if(input.bootId!==s.clientBootId)throw fail(422,'CLOCK_UNCERTAIN','Capture clock or boot does not match session');
 await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${'capture-rate:'+actor.companyId},0))::text`;
 if(await tx.verificationAttempt.count({where:{session:{taskInstanceId:s.taskInstanceId},createdAt:{gt:new Date(+now-60000)}}})>=100||await tx.verificationAttempt.count({where:{session:{task:{location:{companyId:actor.companyId}}},createdAt:{gt:new Date(+now-60000)}}})>=500)throw fail(429,'RATE_LIMITED','Too many capture requests');
 if(await tx.verificationAttempt.count({where:{staffId:actor.id,createdAt:{gt:new Date(+now-60000)}}})>=50)throw fail(429,'RATE_LIMITED','Too many capture requests');
 const requirement=slot.requirementId?await tx.taskEvidenceRequirement.findUniqueOrThrow({where:{id:slot.requirementId}}):null;if(requirement&&!(await tx.taskVerificationItem.findFirst({where:{id:requirement.taskVerificationItemId,taskInstanceId:s.taskInstanceId}})))throw fail(404,'REQUIREMENT_NOT_FOUND','Requirement not found');if(requirement?.state==='CLEANING_REQUIRED')throw fail(409,'REWORK_QR_REQUIRED','Clean this item, then scan the task QR again');const staleRequirement=!!requirement&&((requirement.state==='PROCESSING'&&!!requirement.currentAttemptId)||terminal.includes(requirement.state as typeof terminal[number])||requirement.decisionVersion!==slot.generation);if(manifest&&staleRequirement)throw new ApiError(409,'Capture generation changed');
 if(input.spatialEvidence){
  const history=await tx.verificationAttempt.findMany({where:{sessionId:id,spatialEvidence:{not:Prisma.DbNull}},select:{spatialEvidence:true}});
  const observations=history.flatMap(a=>{const parsed=spatialEvidenceSchema.safeParse(a.spatialEvidence);return parsed.success?[parsed.data]:[];});
  try{validateSpatialBinding(input.spatialEvidence,{sessionId:id,requirementId:slot.requirementId,contextKey:slot.contextKey,elapsedMs:input.elapsedMs},observations);}
  catch(error){throw fail(422,error instanceof Error?error.message:'SPATIAL_INVALID','Spatial metadata does not match this capture. Saved evidence is kept.');}
 }
 const attempt=await tx.verificationAttempt.create({data:{...(input.spatialEvidence?{spatialEvidence:input.spatialEvidence,spatialVersion:1}:{}),sessionId:id,slotId:slot.id,requirementId:slot.requirementId,contextKey:slot.contextKey,staffId:actor.id,assignmentEpoch:s.assignmentEpoch,state:reviewOnly||staleRequirement||staleContext?'REVIEW_REQUIRED':'RESERVED',clientCaptureId:input.clientCaptureId,committedHash:input.sha256,committedAt:manifest?now:null,claimedCapturedAt:capturedAt,anchoredElapsedMs:BigInt(input.elapsedMs),timingEvidence:validTiming?classifyTiming(capturedAt,s.task.shiftEnd,manifest?now:null,now,true):'UNCERTAIN',supersedesAttemptId:staleRequirement?undefined:requirement?.currentAttemptId}});await tx.captureSlot.update({where:{id:slot.id},data:{attemptId:attempt.id}});if(requirement&&!staleRequirement)await tx.taskEvidenceRequirement.update({where:{id:requirement.id},data:{currentAttemptId:attempt.id,state:reviewOnly?'REVIEW_REQUIRED':'PROCESSING'}});return attempt;
 });}
export async function retakeSlots(actor:VerificationActor,id:string,raw:unknown){
 const input=z.object({deviceId:deviceSchema,requirements:z.array(z.object({requirementId:z.uuid(),expectedGeneration:z.number().int().nonnegative()}).strict()).max(200).default([]),contexts:z.array(z.object({contextKey:z.enum(['ENTRANCE','LAYOUT']),expectedGeneration:z.number().int().nonnegative()}).strict()).max(2).default([])}).strict().parse(raw);
 if(!input.requirements.length&&!input.contexts.length)throw fail(400,'EMPTY_RETAKE','Select a failed view');
 if(new Set(input.requirements.map(r=>r.requirementId)).size!==input.requirements.length||new Set(input.contexts.map(r=>r.contextKey)).size!==input.contexts.length)throw fail(400,'DUPLICATE_RETAKE','Repeated requirement');
 return prisma.$transaction(async tx=>{
 const s=await lockAuthorizedSession(actor,id,tx,input.deviceId);
 if(s.state!=='ACTIVE'||s.captureExpiresAt<=new Date())throw fail(410,'CAPTURE_EXPIRED','Renew capture session');
 const count=await tx.captureSlot.count({where:{sessionId:id}});if(count+input.requirements.length+input.contexts.length>2402)throw fail(429,'SLOT_LIMIT','Capture slot limit reached');
 const result=[];
 for(const requested of input.requirements){
 const r=await tx.taskEvidenceRequirement.findFirst({where:{id:requested.requirementId,item:{taskInstanceId:s.taskInstanceId}},include:{item:true}});if(!r)throw fail(404,'REQUIREMENT_NOT_FOUND','Requirement not found');
 if(r.state==='CLEANING_REQUIRED')throw fail(409,'REWORK_QR_REQUIRED','Clean this item, then scan the task QR again');
 // Repeating a successful allocation with its original generation returns the same slot.
 const prior=await tx.captureSlot.findFirst({where:{sessionId:id,requirementId:r.id,generation:requested.expectedGeneration+1},orderBy:{sequence:'desc'}});
 if(prior&&r.decisionVersion===requested.expectedGeneration+1&&!['PASSED','MANAGER_ACCEPTED','WAIVED'].includes(r.state)){result.push(prior);continue;}
 if(r.decisionVersion!==requested.expectedGeneration||!['RECAPTURE_REQUIRED','CLEANING_REQUIRED','REVIEW_REQUIRED'].includes(r.state))throw fail(409,'STALE_GENERATION','Requirement is not available for retake');
 const failed=r.currentAttemptId?await tx.verificationAttempt.findUnique({where:{id:r.currentAttemptId},include:{session:true,slot:true}}):null;
 assertFailedViewReplacement({task:s.task,session:s,staffId:actor.id,now:new Date(),requirement:r,attempt:failed,expectedGeneration:requested.expectedGeneration});
 await tx.taskEvidenceRequirement.update({where:{id:r.id},data:{decisionVersion:{increment:1},currentAttemptId:null,state:'MISSING'}});
 const original=sequentialCapture(s.locationCheck)?await tx.captureSlot.findFirst({where:{sessionId:id,requirementId:r.id},orderBy:{generation:'desc'}}):null;
 result.push(await allocate(tx,id,{requirementId:r.id},original?.sequence??count+result.length,r.decisionVersion+1,s.captureExpiresAt));
 }
 for(const requested of input.contexts){
 if(!requiredContextKeys(s.locationCheck).includes(requested.contextKey))throw fail(404,'CONTEXT_NOT_FOUND','This photo is no longer required');
 const latest=await tx.captureSlot.findFirst({where:{sessionId:id,contextKey:requested.contextKey},orderBy:{generation:'desc'}});
 if(!latest)throw fail(404,'CONTEXT_NOT_FOUND','Context slot not found');
 if(latest.generation===requested.expectedGeneration+1){const saved=latest.attemptId?await tx.verificationAttempt.findUnique({where:{id:latest.attemptId}}):null;if(saved&&['PASSED','MANAGER_ACCEPTED','WAIVED'].includes(saved.state))throw fail(409,'REPLACEMENT_UNAVAILABLE','Successful context evidence cannot be replaced');result.push(latest);continue;}
 const attempt=latest.attemptId?await tx.verificationAttempt.findUnique({where:{id:latest.attemptId},include:{session:true,slot:true}}):null;
 if(latest.generation!==requested.expectedGeneration||!attempt||!['RECAPTURE_REQUIRED','PRIVACY_HOLD'].includes(attempt.state))throw fail(409,'STALE_GENERATION','Context is not available for retake');
 assertFailedContextReplacement({task:s.task,session:s,staffId:actor.id,now:new Date(),contextKey:requested.contextKey,expectedGeneration:requested.expectedGeneration,attempt});
 result.push(await allocate(tx,id,{contextKey:requested.contextKey},sequentialCapture(s.locationCheck)?latest.sequence:count+result.length,latest.generation+1,s.captureExpiresAt));
 await tx.captureSession.update({where:{id},data:{contextStatus:'PENDING',rowVersion:{increment:1}}});
 }
 await tx.auditLog.create({data:{companyId:actor.companyId,actorType:actor.role,actorId:actor.id,entityType:'TaskInstance',entityId:s.taskInstanceId,action:'CAPTURE_RETAKE_ALLOCATION',newValue:{sessionId:id,slotIds:result.map(slot=>slot.id)}}});
 return result.map(slot=>({...slot,nonce:slotNonce(id,slot.id,slot.generation),nonceHash:undefined}));
 });
}

function safeWindows(...args:Parameters<typeof sessionWindows>){try{return sessionWindows(...args);}catch{throw fail(410,'CAPTURE_EXPIRED','Capture window unavailable');}}

/** Staff DTOs expose enumerated decisions and catalog copy, never provider prose or confidence. */
export function staffAttemptResult(attempt:{state:string;qualityResult:unknown;coverageResult:unknown;cleanlinessResult:unknown;spatialDecision?:unknown;duplicateResult?:unknown;contextKey?:string|null},evidenceVisible:boolean,requirementState?:string,photoContext?:PhotoFeedbackContext){
 const privacySafe=evidenceVisible||(attempt.qualityResult as {workflow?:string}|null)?.workflow==='BUFFERED_PHOTO_V1'||(attempt.qualityResult as {workflow?:string}|null)?.workflow==='DIRECT_PHOTO_V1';
 const quality=z.object({acceptable:z.boolean(),reasons:z.array(z.string()).optional()}).safeParse(attempt.qualityResult);
 const coverage=z.object({result:z.object({verdict:z.enum(['MATCH','WRONG_ITEM','MISSING_SURFACE','UNCERTAIN']),reasonCode:z.string().optional()})}).safeParse(attempt.coverageResult);
 const cleanliness=z.object({result:z.object({verdict:z.enum(['CLEAN','NEEDS_ATTENTION','DIRTY','CANNOT_ASSESS']),reasonCode:z.string().optional(),surfaces:z.array(z.object({surface:z.string(),verdict:z.string()})).optional()}),policyDecisionReason:reasonCodeSchema.optional()}).safeParse(attempt.cleanlinessResult);
 const duplicate=z.object({exact:z.array(z.string())}).safeParse(attempt.duplicateResult);
 const spatial=z.object({result:z.string(),reasonCodes:z.array(z.string())}).safeParse(attempt.spatialDecision);
 const spatialRecapture=attempt.state==='RECAPTURE_REQUIRED'&&spatial.success&&spatial.data.result==='SAME_POSITION_SUSPECTED';
 const decisionReason=reasonCodeSchema.safeParse((attempt.cleanlinessResult as {policyDecisionReason?:string}|null)?.policyDecisionReason);
 const raw=spatialRecapture?'FIXTURE_POSITION_TOO_CLOSE_TO_PREVIOUS':attempt.state==='PRIVACY_HOLD'?'PRIVACY_HOLD':attempt.state==='SERVICE_FAILURE'||attempt.state==='RETRY_WAIT'?'SERVICE_FAILURE':attempt.state==='CLEANING_REQUIRED'?'CLEANING_REQUIRED':decisionReason.success?decisionReason.data:cleanliness.success&&cleanliness.data.policyDecisionReason?cleanliness.data.policyDecisionReason:quality.success&&quality.data.acceptable===false?quality.data.reasons?.[0]:attempt.state==='REVIEW_REQUIRED'&&duplicate.success&&duplicate.data.exact.length?'DUPLICATE_EVIDENCE':coverage.success&&coverage.data.result.verdict!=='MATCH'?coverage.data.result.reasonCode:cleanliness.success?cleanliness.data.result.reasonCode:undefined;
 const aliases:Record<string,string>={TOO_DARK:'PHOTO_TOO_DARK',BLURRY:'PHOTO_BLURRY',TOO_SMALL:'PHOTO_TOO_SMALL'};
 const parsed=reasonCodeSchema.safeParse(raw?aliases[raw]??raw:undefined),reasonCode=parsed.success?parsed.data:null;
 let instructions=attempt.state==='REVIEW_REQUIRED'&&reasonCode==='CLEAN'?'Your photo is waiting for manager review.':reasonCode?(reasonInstructions[reasonCode]??({PHOTO_TOO_DARK:'Turn on the light or torch.',PHOTO_BLURRY:'Hold still and retake.',PHOTO_TOO_SMALL:'Move closer and include the required surface.',CLEANING_REQUIRED:'Clean the required surface, then take a new photo.',PRIVACY_HOLD:'Your photo needs restricted review. Wait for your manager.'} as Record<string,string>)[reasonCode]??'Check the photo result and complete the required views.'):attempt.state==='RECAPTURE_REQUIRED'?'Show the whole required surface and retake.':attempt.state==='REVIEW_REQUIRED'?'Wait for your manager to review this capture.':null;
 const storedContext=z.object({fixtureType:z.string().max(100).optional(),viewKey:z.string().max(100).optional(),toiletStyle:z.enum(['WESTERN','SQUAT','UNCERTAIN']).optional(),missingSurfaces:z.array(z.string().max(100)).max(20).optional()}).safeParse((attempt.cleanlinessResult as {photoContext?:unknown}|null)?.photoContext);
 const clarified=staffPhotoInstructions({state:attempt.state,reasonCode,context:{...(storedContext.success?storedContext.data:{}),...photoContext},dirtySurfaces:privacySafe&&cleanliness.success?cleanliness.data.result.surfaces?.filter(s=>['DIRTY','NEEDS_ATTENTION'].includes(s.verdict)).map(s=>s.surface):undefined});
 // Preserve specialized spatial guidance, and never expose object/cleanliness hints during a hold.
 if(clarified&&(!spatialRecapture||attempt.state==='PRIVACY_HOLD'))instructions=clarified;
 const manualOutcome=requirementState==='MANAGER_ACCEPTED'||requirementState==='WAIVED'?requirementState:null;
 if(manualOutcome)instructions=manualOutcome==='MANAGER_ACCEPTED'?'Your manager accepted this photo.':'Your manager approved an exception for this item.';
 let cleanlinessOutcome:'CLEAN'|'DIRTY'|'NEEDS_REVIEW'|null=null;
 let reviewReason:string|null=null;
 const pending=['RESERVED','STORING','RECEIVED','QUALITY_CHECK','COVERAGE_CHECK','CLEANLINESS_CHECK','RETRY_WAIT'].includes(attempt.state);
 if(!manualOutcome&&!pending){
  if(attempt.state==='PASSED'&&privacySafe&&cleanliness.success&&cleanliness.data.result.verdict==='CLEAN'&&!attempt.contextKey)cleanlinessOutcome='CLEAN';
  else if(attempt.state==='CLEANING_REQUIRED'&&privacySafe)cleanlinessOutcome='DIRTY';
  else if(['RECAPTURE_REQUIRED','REVIEW_REQUIRED','PRIVACY_HOLD','SERVICE_FAILURE'].includes(attempt.state)||attempt.state==='PASSED'&&!attempt.contextKey){
   cleanlinessOutcome='NEEDS_REVIEW';
   reviewReason=attempt.state==='SERVICE_FAILURE'?'SERVICE_FAILURE':!privacySafe?'PRIVACY_HOLD':attempt.state==='REVIEW_REQUIRED'&&cleanliness.success&&cleanliness.data.result.verdict==='CLEAN'&&reasonCode==='CLEAN'?'AUTO_PASS_NOT_VALIDATED':reasonCode??'CANNOT_ASSESS';
  }
 }
 return {cleanlinessOutcome,reviewReason,manualOutcome,reasonCode,instructions,results:{spatial:privacySafe&&spatial.success?{result:spatial.data.result}:null,quality:quality.success?{acceptable:quality.data.acceptable}:null,coverage:privacySafe&&coverage.success?{verdict:coverage.data.result.verdict}:null,cleanliness:privacySafe&&cleanliness.success?{verdict:cleanliness.data.result.verdict==='NEEDS_ATTENTION'?'DIRTY':cleanliness.data.result.verdict}:null},retryAction:manualOutcome?null:attempt.state==='CLEANING_REQUIRED'?'SCAN_QR_FOR_REWORK':['RETRY_WAIT','SERVICE_FAILURE'].includes(attempt.state)?'WAIT_FOR_SERVICE':attempt.state==='RECAPTURE_REQUIRED'?'REQUEST_RETAKE_SLOT':attempt.state==='RESERVED'||attempt.state==='STORING'?'RETRY_UPLOAD':null};
}
