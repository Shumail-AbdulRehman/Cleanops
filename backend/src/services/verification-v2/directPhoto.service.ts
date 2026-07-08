import { requireLaunchPhotoQualification } from './launchQualification.js';
import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { prisma } from '../../prisma/prisma.js';
import { ApiError } from '../../utils/ApiError.js';
import { requireTaskAccess, type VerificationActor } from './authorization.service.js';
import { lockTask, staffAttemptResult } from './captureSession.service.js';
import { inspectImage, sha256 } from './quality.service.js';
import { storePrivateImage, discardPrivateImages } from './media.service.js';
import { originalPublicId } from './evidence.service.js';
import { BufferedClefProvider, bufferedEvaluatorVersion, type BufferedAssessment, type BufferedPhotoProvider } from './bufferedPhoto.provider.js';
import { bufferedDecision } from './photoResultPolicy.js';
import { autoPassAllowed } from './cleanliness.service.js';
import { applyLockedDecision } from './photoDecision.service.js';
import { finalizeTask } from './completion.service.js';
import { reviewableMedia, photoStorageState } from './evidenceBuffer.js';
import { verificationEvent } from './latency.js';
import { duplicateClassification } from './duplicate.service.js';

const WORKFLOW = 'DIRECT_PHOTO_V1';
// A request owns this attempt only while its bounded AI/storage calls run.
// Expired ownership is reclaimed by a manual upload, never a background retry.
import {DIRECT_REQUEST_TTL_MS,directRequestExpired} from './directProcessing.js';
type Processing = { directProcessingToken?:string|null;directProcessingStartedAt?:Date|null;directAssessment?:unknown };
const json = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonObject;

// A photo already kept as evidence is sent back for a retake before any AI or storage spend.
// Exact: same original or normalized bytes anywhere in the company (indexed, no age limit).
// Near: perceptual hash within 2 of 64 bits of a kept photo of the same area (so also the same task)
// in the last 48 hours, newest 200. Re-encoded, half-size, brighter or darker copies measured 0-2;
// a 2-degree turn or 2% shift of the same sink measured 6-14, and duplicate.service's 8 would block
// some of those real second shots, so it is not used here.
export const REUSED_PHOTO_NEAR_DISTANCE = 2;
export const REUSED_PHOTO_AREA_WINDOW_MS = 2 * 86_400_000;
export const REUSED_PHOTO_AREA_LIMIT = 200;
type PhotoHashes = { sha256: string; normalizedHash: string; perceptualHash: string; hashVariants: string[] };
export async function reusedPhoto(scope: { companyId: number; locationId: number; areaId: number; publicId: string }, photo: PhotoHashes) {
  const kept = { companyId: scope.companyId, privacyState: { not: 'DISCARDED' }, originalPublicId: { not: scope.publicId } };
  const [exact, recent] = await Promise.all([
    prisma.evidenceAsset.findFirst({ where: { ...kept, OR: [{ sha256: photo.sha256 }, { normalizedHash: photo.normalizedHash }] }, select: { id: true } }),
    prisma.evidenceAsset.findMany({ where: { ...kept, locationId: scope.locationId, createdAt: { gte: new Date(Date.now() - REUSED_PHOTO_AREA_WINDOW_MS) },
      perceptualHash: { not: null }, task: { areaId: scope.areaId } },
      select: { id: true, sha256: true, normalizedHash: true, perceptualHash: true }, orderBy: { createdAt: 'desc' }, take: REUSED_PHOTO_AREA_LIMIT }),
  ]);
  return !!exact || duplicateClassification({ id: '', ...photo }, recent, REUSED_PHOTO_NEAR_DISTANCE).near.length > 0;
}

export async function directPhotoStatus(actor: VerificationActor, id: string) {
  const a = await prisma.verificationAttempt.findUniqueOrThrow({where:{id},include:{session:true,media:true,requirement:{include:{item:true}}}});
  await requireTaskAccess(actor,a.session.taskInstanceId);
  return {attemptId:a.id,assetId:a.mediaAssetId,state:directRequestExpired(a)?'RESERVED':a.state,storage:photoStorageState(a.media),
    ...staffAttemptResult(a,reviewableMedia(a.media?.privacyState),a.requirement?.currentAttemptId===a.id?a.requirement.state:undefined,a.requirement?{fixtureType:a.requirement.item.typeSnapshot,viewKey:a.requirement.viewKey}:undefined)};
}

/** AI and conditional cloud storage finish in the upload request. No queue or disk buffer. */
export async function processDirectPhoto(actor: VerificationActor, attemptId: string, bytes: Buffer,
  provider: BufferedPhotoProvider = new BufferedClefProvider(), store = storePrivateImage, discard = discardPrivateImages) {
  const timed=async<T>(stage:string,work:()=>Promise<T>)=>{
    const start=Date.now();
    try{return await work();}
    finally{verificationEvent('DIRECT_PHOTO_STAGE',{attemptId},{stage,durationMs:Date.now()-start});}
  };
  if(actor.role!=='STAFF')throw new ApiError(403,'Staff account required');
  const initial=await timed('access',async()=>{
    const a=await prisma.verificationAttempt.findUniqueOrThrow({where:{id:attemptId},include:{session:true}});
    if(a.staffId!==actor.id)throw new ApiError(404,'Capture not found');
    await requireTaskAccess(actor,a.session.taskInstanceId,{staffMutation:true});
    return a;
  });
  if(sha256(bytes)!==initial.committedHash)throw new ApiError(409,'This photo changed before it finished uploading. Please take a new photo.');
  const info=await timed('image',()=>inspectImage(bytes)), token=randomUUID(), started=Date.now();
  const claim=await timed('claim',()=>prisma.$transaction(async tx=>{
    await lockTask(tx,initial.session.taskInstanceId);
    const a=await tx.verificationAttempt.findUniqueOrThrow({where:{id:attemptId},include:{media:true,session:{include:{task:{select:{locationId:true}}}},requirement:{include:{item:true}}}});
    if(a.media&&['PASSED','REVIEW_REQUIRED','PRIVACY_HOLD','RECAPTURE_REQUIRED','CLEANING_REQUIRED'].includes(a.state))return {finished:true as const,attempt:a};
    const prior=a as Processing;
    if(prior.directProcessingToken&&started-+(prior.directProcessingStartedAt??new Date(0))<DIRECT_REQUEST_TTL_MS)
      throw new ApiError(409,'This photo is still being checked. Tap Check result before uploading again.',[{code:'PHOTO_PROCESSING'}]);
    const quality={...info.quality,workflow:WORKFLOW};
    // Only an attempt an earlier request claimed can already have stored copies; a fresh random id cannot.
    const lookup=!!(a.receivedAt||a.directAssessment||a.mediaAssetId);
    await tx.verificationAttempt.update({where:{id:attemptId},data:{state:'CLEANLINESS_CHECK',receivedAt:a.receivedAt??new Date(started),directProcessingToken:token,directProcessingStartedAt:new Date(started),...(a.qualityResult===null?{qualityResult:json(quality)}:{})}});
    return {finished:false as const,attempt:a,quality,lookup};
  }));
  if(claim.finished)return directPhotoStatus(actor,attemptId);
  const publicId=originalPublicId(actor.companyId,attemptId),reviewId=publicId.replace(/\/original$/,'/review');
  const {lookup}=claim;
  const storeCopies=()=>timed('storage',()=>Promise.all([store(bytes,publicId,info.sha256,{lookup}),store(info.sanitized,reviewId,sha256(info.sanitized),{lookup})]));
  // Copies uploaded alongside the AI are deleted only once their upload has settled.
  const discardCopies=(copies:Promise<unknown>)=>copies.catch(()=>undefined).then(()=>discard([publicId,reviewId]));
  let storing:ReturnType<typeof storeCopies>|undefined;
  let decision:ReturnType<typeof bufferedDecision>|undefined;
  try {
    requireLaunchPhotoQualification(claim.attempt.requirement?.item.typeSnapshot ?? 'ROOM_CONTEXT',
      (claim.attempt.requirement?.item.rubricSnapshot as {version?:number}|undefined)?.version ?? 1);
    const cached=claim.attempt.directAssessment as {assessment?:BufferedAssessment;evaluatorVersion?:string}|null;
    const evaluatorVersion=bufferedEvaluatorVersion();
    let assessment=cached?.evaluatorVersion===evaluatorVersion?cached.assessment:undefined;
    if(!info.quality.acceptable)decision={state:'RECAPTURE_REQUIRED',reason:info.quality.reasons?.[0]??'CANNOT_ASSESS',keep:false};
    // The reuse check must never block the flow: if it cannot run, the photo is checked as before.
    else if(await timed('reuse',()=>reusedPhoto({companyId:actor.companyId,locationId:claim.attempt.session.task.locationId,areaId:claim.attempt.session.areaId,publicId},info))
      .catch(error=>{verificationEvent('DIRECT_PHOTO_REUSE_CHECK_SKIPPED',{attemptId},{error:error instanceof Error?error.name:'unknown'});return false;}))
      decision={state:'RECAPTURE_REQUIRED',reason:'DUPLICATE_EVIDENCE',keep:false};
    else {
      if(!assessment){
        // Wait on storage and the AI together. The AI answer alone decides what is kept.
        storing=storeCopies();storing.catch(()=>undefined);
      }
      assessment??=await timed('ai',()=>provider.evaluate(info.sanitized,claim.attempt.requirement?.item.rubricSnapshot,claim.attempt.requirement?.viewKey,claim.attempt.requirement?.item.typeSnapshot));
      decision=bufferedDecision(assessment,!claim.attempt.requirement||autoPassAllowed(claim.attempt.requirement.item.typeSnapshot,
        (claim.attempt.requirement.item.rubricSnapshot as {version:number}).version),!!claim.attempt.requirement);
      // The token is an atomic ownership check. This cache write does not mutate
      // task state and needs no second task lock, read, or interactive transaction.
      const saved=await timed('assessment_save',()=>prisma.verificationAttempt.updateMany({where:{id:attemptId,directProcessingToken:token},
        data:{directAssessment:json({assessment,evaluatorVersion})}}));
      if(!saved.count)throw new ApiError(409,'Photo processing changed. Refresh its result.',[{code:'PHOTO_PROCESSING'}]);
    }
    const outcome=decision;
    let cloudId:string|undefined;
    if(outcome.keep){
      const uploaded=await (storing??storeCopies());
      cloudId=uploaded[0]!.asset_id;
    }
    await timed('publish',()=>prisma.$transaction(async tx=>{
      await lockTask(tx,initial.session.taskInstanceId);
      const fresh=await tx.verificationAttempt.findUniqueOrThrow({where:{id:attemptId},include:{session:{include:{task:true}},slot:true}});
      if(fresh.directProcessingToken!==token)throw new ApiError(409,'Photo processing changed. Refresh its result.',[{code:'PHOTO_PROCESSING'}]);
      const media=await tx.evidenceAsset.upsert({where:{originalPublicId:publicId},create:{
        companyId:actor.companyId,locationId:fresh.session.task.locationId,taskInstanceId:fresh.session.taskInstanceId,
        originalPublicId:publicId,sanitizedPublicId:outcome.keep?reviewId:null,cloudinaryAssetId:cloudId,
        deliveryType:'authenticated',privacyState:outcome.keep?'NOT_REQUIRED':'DISCARDED',
        format:info.format,bytes:info.bytes,width:info.width,height:info.height,sha256:info.sha256,normalizedHash:info.normalizedHash,perceptualHash:info.perceptualHash,
      },update:{}});
      await tx.verificationAttempt.update({where:{id:attemptId},data:{mediaAssetId:media.id,
        directProcessingToken:null,directProcessingStartedAt:null}});
      await applyLockedDecision(tx,fresh,outcome.state,outcome.reason,json({workflow:WORKFLOW,
        ...(claim.attempt.requirement?{photoContext:{fixtureType:claim.attempt.requirement.item.typeSnapshot,viewKey:claim.attempt.requirement.viewKey,...(assessment?.toiletStyle?{toiletStyle:assessment.toiletStyle}:{}),...(assessment?.missingSurfaces?.length?{missingSurfaces:assessment.missingSurfaces}:{})}}:{}),
        ...(assessment?.cleanliness?{result:assessment.cleanliness,metadata:assessment.metadata}:{})}));
      await finalizeTask(tx,initial.session.taskInstanceId);
    }));
    // Recorded as discarded and finished, so no later request can store under these ids again.
    if(storing&&!outcome.keep)void discardCopies(storing).catch(()=>undefined);
    verificationEvent('DIRECT_PHOTO_FINISHED',{attemptId,taskId:initial.session.taskInstanceId},{durationMs:Date.now()-started,state:outcome.state});
    return timed('response',()=>directPhotoStatus(actor,attemptId));
  } catch(error) {
    // Unkept copies go before the attempt is handed back, so a new upload cannot race the delete.
    // A request that lost ownership leaves them to the request that owns the attempt now.
    if(storing&&!decision?.keep){
      const owner=await prisma.verificationAttempt.findUnique({where:{id:attemptId},select:{directProcessingToken:true}}).catch(()=>null);
      if(owner?.directProcessingToken===token)await discardCopies(storing);
    }
    // Leave no accepted evidence on failure. Staff must explicitly upload again.
    await prisma.$transaction(async tx=>{
      await lockTask(tx,initial.session.taskInstanceId);
      const a=await tx.verificationAttempt.findUniqueOrThrow({where:{id:attemptId}});
      if(a.directProcessingToken===token)await tx.verificationAttempt.update({where:{id:attemptId},data:{
        state:'RESERVED',directProcessingToken:null,directProcessingStartedAt:null}});
    });
    if(error instanceof ApiError)throw error;
    throw new ApiError(503,'We could not finish uploading or checking your photo. Check your internet and tap Upload again.',[{code:'PHOTO_UPLOAD_AGAIN',attemptId}]);
  }
}
