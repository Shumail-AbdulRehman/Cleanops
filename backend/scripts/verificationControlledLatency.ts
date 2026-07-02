/** Controlled benchmark only: real isolated PostgreSQL, simulated storage/providers.
 * VERIFICATION_TEST_DATABASE_URL=postgresql://.../priv_verification_test npx tsx scripts/verificationControlledLatency.ts
 * Never reads the configured customer DATABASE_URL or resets an existing database.
 */
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile,readdir,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {performance} from 'node:perf_hooks';
import pg from 'pg';
import sharp from 'sharp';

const source=process.env.VERIFICATION_TEST_DATABASE_URL;
if(!source)throw new Error('Explicit isolated local test database required');
const url=new URL(source);
if(!['127.0.0.1','localhost','[::1]'].includes(url.hostname)||!url.pathname.startsWith('/priv_verification_test'))throw new Error('Local priv_verification_test database required');
const database=`priv_verification_test_latency_${Date.now()}`;
const admin=new pg.Client({connectionString:source});await admin.connect();
await admin.query(`CREATE DATABASE "${database}"`);await admin.end();
url.pathname=`/${database}`;process.env.DATABASE_URL=url.toString();process.env.NODE_ENV='test';
process.env.VERIFICATION_QR_SECRET='controlled-test-only-'.repeat(4);
process.env.VERIFICATION_SLOT_SECRET='controlled-slot-only-'.repeat(4);
const sql=new pg.Client({connectionString:url.toString()});await sql.connect();
const migrations=fileURLToPath(new URL('../prisma/migrations/',import.meta.url));
for(const name of (await readdir(migrations)).filter(n=>/^\d/.test(n)).sort())await sql.query(await readFile(`${migrations}/${name}/migration.sql`,'utf8'));
await sql.end();

const {prisma}=await import('../src/prisma/prisma.js');
const {createArea}=await import('../src/services/area.service.js');
const {createTaskInstanceWithSnapshot}=await import('../src/services/verification-v2/inventorySnapshot.service.js');
const {createCaptureSession,reserveAttempt}=await import('../src/services/verification-v2/captureSession.service.js');
const {signTaskQr,signAreaQr}=await import('../src/services/verification-v2/qr.service.js');
const {storeReservedEvidence}=await import('../src/services/verification-v2/evidence.service.js');
const {sha256}=await import('../src/services/verification-v2/quality.service.js');
const {claimVerificationJob}=await import('../src/services/verification-v2/jobQueue.service.js');
const {processVerificationJob}=await import('../src/services/verification-v2/pipeline.service.js');
const {createEvidenceImageCache}=await import('../src/services/verification-v2/imageCache.js');
const {dispatchVerificationJobs}=await import('../src/services/verification-v2/dispatcher.js');
const {requiredRubricSurfaces}=await import('../src/services/verification-v2/rubrics.js');
const delay=(ms:number)=>new Promise<void>(resolve=>setTimeout(resolve,ms));
const round=(value:number)=>Math.round(value*100)/100;
const metadata={provider:'CONTROLLED_STUB',model:'CONTROLLED_STUB',providerVersion:'1',promptVersion:'controlled',latencyMs:35,usage:null,costUsd:0,requestId:'controlled'};

try{
 const company=await prisma.company.create({data:{name:'Controlled latency fixture'}});
 const location=await prisma.location.create({data:{companyId:company.id,name:'Controlled room',address:'Isolated test',latitude:'0',longitude:'0'}});
 const manager=await prisma.manager.create({data:{companyId:company.id,name:'Controlled manager',email:`${randomUUID()}@test.invalid`,password:'test-only',role:'ADMIN'}});
 const staff=await prisma.staff.create({data:{companyId:company.id,locationId:location.id,name:'Controlled worker',email:`${randomUUID()}@test.invalid`,password:'test-only'}});
 const actor={id:staff.id,companyId:company.id,role:'STAFF' as const};
 const area=await createArea({id:manager.id,companyId:company.id,role:'ADMIN'},location.id,{name:'Controlled washroom',roomType:'WASHROOM',counts:[{fixtureType:'TOILET',count:1}]});
 const start=new Date(Date.now()-60000),end=new Date(Date.now()+3600000);
 const template=await prisma.taskTemplate.create({data:{title:'Controlled benchmark',locationId:location.id,staffId:staff.id,shiftStart:start,shiftEnd:end,effectiveDate:new Date(),verificationVersion:2,areaId:area.id,inventoryConfigVersion:1,inventorySelection:'ALL',setupStatus:'READY'}});
 const images=new Map<string,Buffer>();
 let reads=0,stores=0;
 const storage={store:async(bytes:Buffer,id:string)=>{stores++;await delay(15);images.set(id,bytes);return {asset_id:id};},read:async(id:string)=>{reads++;await delay(25);const bytes=images.get(id);assert.ok(bytes);return bytes;}};
 const provider={assess:async(stage:string)=>{await delay(35);return {metadata,result:stage==='privacy'?{status:'SAFE',reasonCode:'CLEAN'}:{verdict:'MATCH',observedFixture:'TOILET',observedView:'bowl_seat',observedLabel:null,identityConsistent:true,privacyFlag:false,reasonCode:'CLEAN'}};}};
 const cleanliness={evaluate:async(_image:Buffer,rubric:unknown,view:string)=>{await delay(40);return {metadata:{...metadata,latencyMs:40},result:{verdict:'CLEAN' as const,reasonCode:'CLEAN' as const,confidence:1,surfaces:requiredRubricSurfaces(rubric,view).map(surface=>({surface,verdict:'CLEAN' as const}))}};}};
 const samples:any[]=[];
 for(const mode of ['CONTROLLED_OLD_READ_BEHAVIOR','CURRENT_INGESTION_AND_CACHE'] as const){
  for(let iteration=0;iteration<2;iteration++){
   const task=await createTaskInstanceWithSnapshot({templateId:template.id,title:template.title,locationId:location.id,date:new Date(Date.now()+samples.length*1000),shiftStart:start,shiftEnd:end});assert.ok(task);
   await prisma.taskInstance.update({where:{id:task.id},data:{status:'IN_PROGRESS',startedAt:start}});
   await prisma.taskAssignment.updateMany({where:{taskInstanceId:task.id},data:{status:'STARTED',startedAt:start}});
   const session=await createCaptureSession(actor,task.id,{requestId:randomUUID(),areaQr:signTaskQr(task,area),deviceId:'controlled',clientBootId:'controlled',location:{latitude:0,longitude:0,accuracy:1,sampledAt:new Date().toISOString()},clientTime:new Date().toISOString()});
   const slot=session.slots.find(s=>s.requirementId)!;
   const pixels=Buffer.alloc(640*640*3);let seed=samples.length+71;
   for(let i=0;i<pixels.length;i++){seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;pixels[i]=seed&255;}
   const bytes=await sharp(pixels,{raw:{width:640,height:640,channels:3}}).jpeg().toBuffer();
   const attempt=await reserveAttempt(actor,session.id,{deviceId:'controlled',clientCaptureId:randomUUID(),slotId:slot.id,nonce:slot.nonce,sha256:sha256(bytes),claimedCapturedAt:session.issuedAt.toISOString(),elapsedMs:0,bootId:'controlled'},true);
   const readBefore=reads,storeBefore=stores,ingestionStarted=performance.now();
   await storeReservedEvidence(actor,attempt.id,bytes,storage);
   const ingestionMs=round(performance.now()-ingestionStarted);
   if(mode==='CONTROLLED_OLD_READ_BEHAVIOR')await prisma.verificationJob.updateMany({where:{attemptId:attempt.id,stage:'QUALITY'},data:{result:{}}});
   const read=mode==='CURRENT_INGESTION_AND_CACHE'?createEvidenceImageCache(storage.read):storage.read;
   const stages=[];
   for(const stage of ['QUALITY','PRIVACY','COVERAGE','CLEANLINESS']){
    const claimStarted=performance.now();const job=await claimVerificationJob();assert.ok(job);assert.equal(job.attemptId,attempt.id);assert.equal(job.stage,stage);
    const claimed=performance.now(),stageReadBefore=reads;
    assert.equal(await processVerificationJob(job,provider as any,read,cleanliness),true);
    const committed=performance.now();const saved=await prisma.verificationJob.findUniqueOrThrow({where:{id:job.id}});
    stages.push({stage,jobId:job.id,claimCallMs:round(claimed-claimStarted),claimToPolicyCommitMs:round(committed-claimed),imageReads:reads-stageReadBefore,timing:(saved.result as any)?.timing});
   }
   const saved=await prisma.verificationAttempt.findUniqueOrThrow({where:{id:attempt.id}});
   assert.equal(saved.state,'REVIEW_REQUIRED','Held-out auto-pass safety remains enabled');
   samples.push({mode,iteration,taskId:task.id,sessionId:session.id,attemptId:attempt.id,ingestionMs,storageWrites:stores-storeBefore,imageReads:reads-readBefore,finalState:saved.state,stages});
  }
 }
 async function dispatcherSample(mode:'OLD_BATCH'|'CURRENT_REFILL'){
  const jobs=[{id:1,ms:300},{id:2,ms:30},{id:3,ms:30},{id:4,ms:30}];
  const began=performance.now();const events:any[]=[];let completed=0;
  const process=async(job:typeof jobs[number])=>{const startedMs=round(performance.now()-began);await delay(job.ms);events.push({id:job.id,startedMs,finishedMs:round(performance.now()-began)});completed++;};
  if(mode==='OLD_BATCH')while(jobs.length)await Promise.all(jobs.splice(0,2).map(process));
  else await dispatchVerificationJobs({concurrency:2,idleMs:5,claim:async()=>jobs.shift()??null,process,stopping:()=>completed===4,onError:error=>{throw error;}});
  return {mode,concurrency:2,jobs:events.sort((a,b)=>a.id-b.id),makespanMs:round(performance.now()-began)};
 }
 const dispatcher=[await dispatcherSample('OLD_BATCH'),await dispatcherSample('CURRENT_REFILL')];
 const summary=['CONTROLLED_OLD_READ_BEHAVIOR','CURRENT_INGESTION_AND_CACHE'].map(mode=>{
  const selected=samples.filter(s=>s.mode===mode);
  return {mode,meanIngestionMs:round(selected.reduce((n,s)=>n+s.ingestionMs,0)/selected.length),meanClaimToPolicyCommitMs:round(selected.reduce((n,s)=>n+s.stages.reduce((sum:number,stage:any)=>sum+stage.claimToPolicyCommitMs,0),0)/selected.length),meanImageReads:selected.reduce((n,s)=>n+s.imageReads,0)/selected.length,meanStages:Object.fromEntries(['QUALITY','PRIVACY','COVERAGE','CLEANLINESS'].map(stage=>[stage,round(selected.reduce((n,s)=>n+s.stages.find((item:any)=>item.stage===stage).claimToPolicyCommitMs,0)/selected.length)]))};
 });
 const report={kind:'CONTROLLED_ISOLATED_DATABASE_BENCHMARK',createdAt:new Date().toISOString(),database,conditions:{iterationsPerMode:2,storageWriteStubMs:15,imageReadStubMs:25,privacyCoverageProviderStubMs:35,cleanlinessProviderStubMs:40,dispatcherDurationsMs:[300,30,30,30]},limitations:['Not live provider, Cloudinary, phone, GPS, or mobile polling measurements.','Old read behavior reconstructs absent ingestion-quality reuse and absent RAM cache using current pipeline; it is not a deployment rollback.','Dispatcher comparison reconstructs old Promise.all batch behavior; elapsed values are observations, not pass/fail thresholds.','Small controlled sample, no production accuracy or performance claim.'],summary,dispatcher,samples};
 await writeFile('/tmp/hygene-controlled-latency.json',JSON.stringify(report,null,2));
 console.log(JSON.stringify({summary,dispatcher,report:'/tmp/hygene-controlled-latency.json',database},null,2));
}finally{await prisma.$disconnect();}
