import { jobAccountAllowed } from '../launchJobs.service.js';
import {jobTiming,verificationEvent} from './latency.js';
import {raiseIssue} from './exception.service.js';
import {finalizeTask} from './completion.service.js';
import {randomUUID} from 'node:crypto';
import type {Prisma,VerificationJob} from '@prisma/client';
import {prisma} from '../../prisma/prisma.js';
export type VerificationTransaction=Omit<typeof prisma,'$connect'|'$disconnect'|'$on'|'$transaction'|'$use'|'$extends'>;
export const LEASE_MS=90_000;
export const RETRY_DELAYS_MS=[5000,30000,120000] as const;
export async function enqueueVerificationJob(tx:VerificationTransaction,input:{companyId:number;attemptId:string;stage:string;evaluatorVersion:string;priority?:number;result?:Prisma.InputJsonValue}) {
 if(!['PHOTO','QUALITY','PRIVACY','COVERAGE','DUPLICATE','CLEANLINESS'].includes(input.stage)||!/^[a-zA-Z0-9._-]{1,100}$/.test(input.evaluatorVersion))throw new Error('Unsupported verification stage/version');
 await tx.$queryRaw`SELECT id FROM "VerificationAttempt" WHERE id=${input.attemptId} FOR UPDATE`;
 const existing=await tx.verificationJob.findUnique({where:{attemptId_stage_evaluatorVersion:{attemptId:input.attemptId,stage:input.stage,evaluatorVersion:input.evaluatorVersion}}});
 if(existing)return existing;
 if(await tx.verificationJob.count({where:{attemptId:input.attemptId,stage:input.stage}})>=4)throw new Error('Evaluator version capacity exceeded for this attempt');
 return tx.verificationJob.create({data:input});
}
/** Global claim lock makes the four-worker/two-per-tenant caps hold across processes. */
export async function claimVerificationJob():Promise<VerificationJob|null> {
 return prisma.$transaction(async tx=>{
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(872119, 1)::text`;
  const jobs=await tx.$queryRaw<VerificationJob[]>`
   WITH candidate AS (
    SELECT j.id FROM "VerificationJob" j
    WHERE EXISTS (SELECT 1 FROM "Company" c WHERE c.id=j."companyId" AND c."isActive" AND c."operationalStatus"='ACTIVE')
     AND ((j.state IN ('PENDING','RETRY_WAIT') AND j."availableAt"<=NOW())
      OR (j.state='RUNNING' AND j."leaseUntil"<=NOW()))
     AND (SELECT count(*) FROM "VerificationJob" WHERE state='RUNNING' AND "leaseUntil">NOW())<4
     AND (SELECT count(*) FROM "VerificationJob" busy WHERE busy."companyId"=j."companyId" AND busy.state='RUNNING' AND busy."leaseUntil">NOW())<2
    ORDER BY (SELECT count(*) FROM "VerificationJob" busy WHERE busy."companyId"=j."companyId" AND busy.state='RUNNING' AND busy."leaseUntil">NOW()),
      (SELECT max(busy."createdAt") FROM "VerificationJob" busy WHERE busy."companyId"=j."companyId" AND busy.state='SUCCEEDED') NULLS FIRST,
      j.priority DESC,j."availableAt",j."createdAt",j.id
    FOR UPDATE OF j SKIP LOCKED LIMIT 1
   ) UPDATE "VerificationJob" j SET state='RUNNING',attempts=j.attempts+1,
     "leaseToken"=${randomUUID()},"leaseUntil"=NOW()+INTERVAL '90 seconds',
     result=COALESCE(j.result,'{}'::jsonb)||jsonb_build_object('timing',COALESCE(j.result->'timing','{}'::jsonb)||jsonb_build_object('claimedAt',NOW(),'queueWaitMs',EXTRACT(EPOCH FROM (NOW()-j."availableAt"))*1000))
    FROM candidate WHERE j.id=candidate.id RETURNING j.*`;
  return jobs[0]??null;
 });
}
export async function renewJobLease(id:string,token:string) {
 return (await prisma.verificationJob.updateMany({where:{id,state:'RUNNING',leaseToken:token,leaseUntil:{gt:new Date()}},data:{leaseUntil:new Date(Date.now()+LEASE_MS)}})).count===1;
}
export async function publishJobResult(job:VerificationJob,result:Prisma.InputJsonValue,apply?:(tx:VerificationTransaction)=>Promise<void>) {
 const structured=result&&typeof result==='object'&&!Array.isArray(result)?result:{};
 const finalResult={...structured,timing:{...jobTiming(job.result),...jobTiming(result),publishedAt:new Date().toISOString()}};
 return prisma.$transaction(async tx=>{
  if(!await jobAccountAllowed(job.companyId,'READ_OPERATIONAL',tx))return false;
  const updated=await tx.verificationJob.updateMany({where:{id:job.id,state:'RUNNING',leaseToken:job.leaseToken,leaseUntil:{gt:new Date()}},data:{state:'SUCCEEDED',result:finalResult,finishedAt:new Date(),leaseUntil:null,leaseToken:null}});
  if(!updated.count)return false;
  if(apply)await apply(tx);
  return true;
 });
}
export async function failVerificationJob(job:VerificationJob,code='SERVICE_FAILURE',random=Math.random,metadata?:Record<string,unknown>) {
 const permanent=['PROVIDER_NOT_CONFIGURED','PROVIDER_AUTH_FAILURE','PROVIDER_CONFIGURATION_INVALID','PROVIDER_CONFIGURATION_CHANGED','PROVIDER_UNSUPPORTED_IMAGE','PROVIDER_THRESHOLD_NOT_VERSIONED','PROVIDER_THRESHOLD_NOT_CONFIGURED','INVALID_MODEL'].includes(code);
 const exhausted=permanent||job.attempts>RETRY_DELAYS_MS.length;
 verificationEvent('JOB_FAILURE',{attemptId:job.attemptId,jobId:job.id,stage:job.stage},{code,claimCount:job.attempts,exhausted});
 const delay=RETRY_DELAYS_MS[Math.min(job.attempts-1,RETRY_DELAYS_MS.length-1)]!;
 return prisma.$transaction(async tx=>{
  if(!await jobAccountAllowed(job.companyId,'READ_OPERATIONAL',tx))return false;
  const preserved=job.stage==='PHOTO'?(await tx.verificationJob.findUnique({where:{id:job.id},select:{result:true}}))?.result:job.result;
  const changed=await tx.verificationJob.updateMany({where:{id:job.id,state:'RUNNING',leaseToken:job.leaseToken,leaseUntil:{gt:new Date()}},data:{state:exhausted?'FAILED':'RETRY_WAIT',lastErrorCode:code,result:JSON.parse(JSON.stringify({...(preserved as object ?? {}),...metadata,timing:jobTiming(job.result),retryCount:Math.max(0,job.attempts-1),lastErrorCode:code})) as Prisma.InputJsonValue,availableAt:new Date(Date.now()+delay*(.9+.2*random())),finishedAt:exhausted?new Date():null,leaseUntil:null,leaseToken:null}});
  if(changed.count&&exhausted){
   const initial=await tx.verificationAttempt.findUniqueOrThrow({where:{id:job.attemptId},select:{session:{select:{taskInstanceId:true}}}});
   await tx.$queryRaw`SELECT id FROM "TaskInstance" WHERE id=${initial.session.taskInstanceId} FOR UPDATE`;
   const attempt=await tx.verificationAttempt.findUniqueOrThrow({where:{id:job.attemptId},include:{session:{include:{task:true}},slot:true,requirement:true}});
   const latestContext=attempt.contextKey?await tx.captureSlot.findFirst({where:{sessionId:attempt.sessionId,contextKey:attempt.contextKey},orderBy:{generation:'desc'}}):null;
   const current=attempt.requirement?attempt.requirement.currentAttemptId===attempt.id&&attempt.requirement.decisionVersion===attempt.slot.generation&&attempt.requirement.state==='PROCESSING':latestContext?.id===attempt.slotId;
   // A superseded provider failure remains in job history, without blocking newer evidence.
   if(current&&attempt.session.task.status!=='COMPLETED'){
    await raiseIssue(tx,attempt.session.taskInstanceId,'SERVICE_FAILURE',attempt.requirementId,attempt.id);
    if(attempt.requirementId)await tx.taskEvidenceRequirement.updateMany({where:{id:attempt.requirementId,currentAttemptId:attempt.id,state:'PROCESSING'},data:{state:'REVIEW_REQUIRED',decisionVersion:{increment:1}}});
   }
  }
  if(changed.count&&exhausted)await tx.verificationAttempt.updateMany({where:{id:job.attemptId,state:{notIn:['PASSED','RECAPTURE_REQUIRED','CLEANING_REQUIRED','REVIEW_REQUIRED','PRIVACY_HOLD']}},data:{state:'SERVICE_FAILURE'}});
  if(changed.count&&!exhausted)await tx.verificationAttempt.updateMany({where:{id:job.attemptId,state:{notIn:['PASSED','RECAPTURE_REQUIRED','CLEANING_REQUIRED','REVIEW_REQUIRED','PRIVACY_HOLD','SERVICE_FAILURE']}},data:{state:'RETRY_WAIT'}});
  if(changed.count&&exhausted){
   const attempt=await tx.verificationAttempt.findUniqueOrThrow({where:{id:job.attemptId},select:{session:{select:{taskInstanceId:true}}}});
   // Explicit acceptance may already satisfy this view while its final job was pending.
   await finalizeTask(tx,attempt.session.taskInstanceId);
  }
  return changed.count===1;
 });
}
export async function workerHeartbeat(id:string,activeJobs:number) {
 await prisma.verificationWorkerHeartbeat.upsert({where:{id},create:{id,activeJobs},update:{lastSeenAt:new Date(),activeJobs}});
}
export async function verificationQueueHealth() {
 const now=new Date();
 const [workers,oldest,pending,running]=await Promise.all([
  prisma.verificationWorkerHeartbeat.count({where:{lastSeenAt:{gt:new Date(+now-45000)}}}),
  prisma.verificationJob.findFirst({where:{state:{in:['PENDING','RETRY_WAIT']},availableAt:{lte:now}},orderBy:{availableAt:'asc'},select:{availableAt:true}}),
  prisma.verificationJob.count({where:{state:{in:['PENDING','RETRY_WAIT']}}}),
  prisma.verificationJob.count({where:{state:'RUNNING',leaseUntil:{gt:now}}}),
 ]);
 return {ready:workers>0,workers,pending,running,saturated:running>=4,oldestEligibleAgeSeconds:oldest?Math.floor((+now-+oldest.availableAt)/1000):0};
}
