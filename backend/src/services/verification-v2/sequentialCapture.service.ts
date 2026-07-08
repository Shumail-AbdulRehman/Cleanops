import { authorizedWaiverReceipts } from './launchPhotoPolicy.js';
import { requiredContextKeys } from "./contextPolicy.js";
import {prisma} from '../../prisma/prisma.js';
import {ApiError} from '../../utils/ApiError.js';
import {lockAuthorizedSession,sessionResponse} from './captureSession.service.js';
import type {VerificationActor} from './authorization.service.js';
import {checkedAttempt,objectCaptureDeadline,sequentialCapture,currentPhotoSlots} from './sequentialPolicy.js';
import {resolvePolicy} from './verificationPolicy.service.js';
import {z} from 'zod';
const fail=(status:number,code:string,message:string)=>new ApiError(status,message,[{code}]);
export async function activatePhotoSlot(actor:VerificationActor,id:string,raw:unknown){
 const input=z.object({slotId:z.uuid(),deviceId:z.string().min(1).max(200)}).strict().parse(raw);
 return prisma.$transaction(async tx=>{
  const s=await lockAuthorizedSession(actor,id,tx,input.deviceId);const now=new Date();
  if(!sequentialCapture(s.locationCheck))return sessionResponse(tx,id);
  if(s.state!=='ACTIVE'||s.captureExpiresAt<=now)throw fail(410,'QR_RENEWAL_REQUIRED','Scan the room QR again to continue.');
  const slots=await tx.captureSlot.findMany({where:{sessionId:id},include:{attempt:true,requirement:true},orderBy:{sequence:'asc'}});
  const slot=slots.find(slot=>slot.id===input.slotId);if(!slot||slot.contextKey&&!requiredContextKeys(s.locationCheck).includes(slot.contextKey as any))throw fail(404,'SLOT_NOT_FOUND','Photo step not found.');
  if(slot.attemptId)throw fail(409,'PHOTO_ALREADY_SUBMITTED','This photo step is already submitted.');
  const waived=await authorizedWaiverReceipts(tx,actor,s.taskInstanceId,slots.flatMap(slot=>slot.requirement?[slot.requirement]:[]));
  if(currentPhotoSlots(slots.filter(prior=>!prior.contextKey||requiredContextKeys(s.locationCheck).includes(prior.contextKey as any))).some(prior=>prior.sequence<slot.sequence&&!(prior.requirementId&&waived.has(prior.requirementId))&&(!prior.attempt||!prior.attempt.receivedAt||!prior.attempt.mediaAssetId||!checkedAttempt(prior.attempt.state))))throw fail(409,'PREVIOUS_PHOTO_UNRESOLVED','Wait for the current photo to finish checking before continuing.');
  if(slot.activatedAt){if(slot.expiresAt<=now)throw fail(410,'QR_RENEWAL_REQUIRED','Time expired. Scan the room QR again to continue this item.');return sessionResponse(tx,id);}
  const itemId=slot.requirement?.taskVerificationItemId;
  const used=slots.filter(prior=>prior.sequence<slot.sequence&&itemId&&prior.requirement?.taskVerificationItemId===itemId&&prior.activatedAt&&prior.attempt).reduce((sum,prior)=>sum+Math.max(0,+prior.attempt!.claimedCapturedAt-+prior.activatedAt!),0);
  const seconds=resolvePolicy(s.task.policySnapshot).objectCaptureSeconds;
  const deadline=objectCaptureDeadline(now,s.captureExpiresAt,seconds,used);
  if(deadline<=now)throw fail(410,'QR_RENEWAL_REQUIRED','Time expired. Scan the room QR again to continue this item.');
  await tx.captureSlot.update({where:{id:slot.id},data:{activatedAt:now,expiresAt:deadline}});
  return sessionResponse(tx,id);
 });
}
