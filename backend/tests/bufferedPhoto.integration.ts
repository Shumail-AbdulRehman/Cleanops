import assert from "node:assert/strict";
import { readFile, readdir, mkdtemp, rm } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import pg from "pg";
const source = process.env.VERIFICATION_TEST_DATABASE_URL;
if (!source) throw new Error("Isolated local test URL required");
const url = new URL(source);
if (
  url.hostname !== "127.0.0.1" ||
  !url.pathname.startsWith("/priv_verification_test")
)
  throw new Error("Only isolated local test database is permitted");
const database = `priv_verification_test_buffer_${Date.now()}`;
const admin = new pg.Client({ connectionString: source });
await admin.connect();
await admin.query(`CREATE DATABASE "${database}"`);
await admin.end();
url.pathname = "/" + database;
process.env.DATABASE_URL = url.toString();
process.env.NODE_ENV = "test";
const client = new pg.Client({ connectionString: url.toString() });
await client.connect();
const root = new URL("../prisma/migrations/", import.meta.url);
for (const name of (await readdir(root)).filter((n) => /^\d/.test(n)).sort())
  await client.query(
    await readFile(new URL(`${name}/migration.sql`, root), "utf8"),
  );
await client.end();
const { prisma } = await import('../src/prisma/prisma.js');
const { stageReservedEvidence } = await import('../src/services/verification-v2/bufferedEvidence.service.js');
const { processBufferedPhoto } = await import('../src/services/verification-v2/bufferedPipeline.service.js');
const { readBufferedPhoto, removeBufferedPhoto } = await import('../src/services/verification-v2/evidenceBuffer.js');
const { evidenceContent } = await import('../src/services/verification-v2/evidence.service.js');
const { failVerificationJob } = await import('../src/services/verification-v2/jobQueue.service.js');
const { staffAttemptResult } = await import('../src/services/verification-v2/captureSession.service.js');
const { default: sharp } = await import('sharp');
const directory = await mkdtemp('/tmp/hygene-buffer-integration-');
process.env.EVIDENCE_BUFFER_DIR = directory;
process.env.EVIDENCE_BUFFER_KEY = 'isolated-buffer-test';
const company = await prisma.company.create({data:{name:'Buffered flow test',subscriptionStatus:'ACTIVE'}});
const location = await prisma.location.create({data:{name:'Test',address:'Test',companyId:company.id,latitude:'0',longitude:'0',timezone:'Asia/Karachi'}});
const area = await prisma.area.create({data:{locationId:location.id,name:'Room',roomType:'WASHROOM',status:'ACTIVE'}});
const fixture = await prisma.areaItem.create({data:{areaId:area.id,stableCode:'sink-1',displayName:'Sink',fixtureType:'SINK',sequence:1,rubricKey:'sink',requiredViews:[]}});
const staff = await prisma.staff.create({data:{name:'Staff',email:randomUUID()+'@test.invalid',password:'test',companyId:company.id,locationId:location.id}});
const manager = await prisma.manager.create({data:{name:'Admin',email:randomUUID()+'@test.invalid',password:'test',companyId:company.id,role:'ADMIN'}});
const actor={id:staff.id,role:'STAFF' as const,companyId:company.id};
const pixels=Buffer.alloc(640*640*3);for(let i=0;i<pixels.length;i++)pixels[i]=(i*31+(i>>>4))%256;
const bytes=await sharp(pixels,{raw:{width:640,height:640,channels:3}}).png().toBuffer();
const hash=(await import('node:crypto')).createHash('sha256').update(bytes).digest('hex');
async function fresh() {
  const now=new Date(), end=new Date(+now+3600000);
  const task=await prisma.taskInstance.create({data:{title:'Buffered task',locationId:location.id,areaId:area.id,staffId:staff.id,verificationVersion:2,areaNameSnapshot:area.name,inventoryVersion:1,policySnapshot:{version:1},date:now,shiftStart:now,shiftEnd:end,startedAt:now,status:'IN_PROGRESS',verificationDeadline:end,uploadDeadline:new Date(+end+600000)}});
  const assignment=await prisma.taskAssignment.create({data:{taskInstanceId:task.id,staffId:staff.id,status:'STARTED',startedAt:now}});
  const item=await prisma.taskVerificationItem.create({data:{taskInstanceId:task.id,areaId:area.id,sourceAreaItemId:fixture.id,itemCodeSnapshot:'sink-1',nameSnapshot:'Sink',typeSnapshot:'SINK',orderSnapshot:1,identificationSnapshot:{},rubricSnapshot:{version:1,criteria:['No dirt'],views:[{key:'basin'}],surfacesByView:{basin:['basin']}},requirements:{create:{viewKey:'basin',instructionsSnapshot:'Show basin',state:'PROCESSING'}}},include:{requirements:true}});
  const requirement=item.requirements[0]!;
  const session=await prisma.captureSession.create({data:{taskInstanceId:task.id,areaId:area.id,staffId:staff.id,assignmentId:assignment.id,assignmentEpoch:task.assignmentEpoch,deviceId:'test',qrVersion:area.qrVersion,policyVersion:1,captureExpiresAt:end,uploadExpiresAt:new Date(+end+600000),presenceStatus:'ACCEPTABLE',contextStatus:'ACCEPTABLE',locationCheck:{captureWorkflow:'SEQUENTIAL_CLEF_V1'},serverTimeAnchor:now,clientBootId:'test'}});
  const slot=await prisma.captureSlot.create({data:{sessionId:session.id,requirementId:requirement.id,sequence:0,nonceHash:'test',expiresAt:end}});
  const attempt=await prisma.verificationAttempt.create({data:{sessionId:session.id,slotId:slot.id,requirementId:requirement.id,staffId:staff.id,assignmentEpoch:task.assignmentEpoch,clientCaptureId:randomUUID(),claimedCapturedAt:now,anchoredElapsedMs:0n,timingEvidence:'ON_TIME_SERVER_OBSERVED',committedHash:hash,committedAt:now}});
  await prisma.taskEvidenceRequirement.update({where:{id:requirement.id},data:{currentAttemptId:attempt.id}});
  return {task,attempt,requirement};
}
async function claim(attemptId:string) {
  const job=await prisma.verificationJob.findFirstOrThrow({where:{attemptId,stage:'PHOTO'}});
  return prisma.verificationJob.update({where:{id:job.id},data:{state:'RUNNING',attempts:{increment:1},leaseToken:randomUUID(),leaseUntil:new Date(Date.now()+90000)}});
}
function value(verdict:'CLEAN'|'DIRTY'|'CANNOT_ASSESS',origin:'DIRECT'|'SCREEN_RECAPTURE'='DIRECT') {
  return {objectMatch:'MATCH',viewMatch:'MATCH',originality:origin,cleanliness:{verdict,surfaces:[{surface:'basin',verdict}],confidence:.98,reasonCode:verdict==='DIRTY'?'CLEANING_REQUIRED':verdict==='CLEAN'?'CLEAN':'CANNOT_ASSESS'},metadata:{provider:'fake'}} as any;
}
let cloudCalls=0, providerCalls=0, failStore=false;
const io={read:readBufferedPhoto,remove:removeBufferedPhoto,store:async()=>{cloudCalls++;if(failStore){failStore=false;throw new Error('Storage unavailable');}return {asset_id:'test-cloud'} as any;}};
for (const scenario of ['dirty','screen','clean','review','storage-retry','service-failure']) {
  const sample=await fresh(), before=cloudCalls, started=performance.now();
  const receipt=await stageReservedEvidence(actor,sample.attempt.id,bytes);
  assert.equal(receipt.storage,'buffered');assert.equal(cloudCalls,before);
  assert.deepEqual(await readBufferedPhoto(company.id,sample.attempt.id),bytes);
  const replay=await stageReservedEvidence(actor,sample.attempt.id,bytes);assert.equal(replay.assetId,receipt.assetId);
  await assert.rejects(()=>evidenceContent({id:manager.id,companyId:company.id,role:'ADMIN'},receipt.assetId,'review',{read:async()=>bytes,store:io.store} as any),/awaiting/);
  let job=await claim(sample.attempt.id);
  const provider={evaluate:async()=>{providerCalls++;if(scenario==='service-failure')throw new Error('Provider unavailable');return value(scenario==='dirty'?'DIRTY':scenario==='review'?'CANNOT_ASSESS':'CLEAN',scenario==='screen'?'SCREEN_RECAPTURE':'DIRECT');}};
  if(scenario==='service-failure') {
    await assert.rejects(()=>processBufferedPhoto(job,provider,io),/unavailable/);
    await failVerificationJob(job,'PROVIDER_AUTH_FAILURE');
    const failed=await prisma.verificationAttempt.findUniqueOrThrow({where:{id:sample.attempt.id}});
    assert.equal(failed.state,'SERVICE_FAILURE');assert.equal(cloudCalls,before);assert.deepEqual(await readBufferedPhoto(company.id,sample.attempt.id),bytes);
    continue;
  }
  if(scenario==='storage-retry') {
    failStore=true;const previous=providerCalls;
    await assert.rejects(()=>processBufferedPhoto(job,provider,io),/Storage unavailable/);
    await failVerificationJob(job,'SERVICE_FAILURE');job=await claim(sample.attempt.id);
    await processBufferedPhoto(job,provider,io);assert.equal(providerCalls,previous+1);
  } else await processBufferedPhoto(job,provider,io);
  const result=await prisma.verificationAttempt.findUniqueOrThrow({where:{id:sample.attempt.id},include:{media:true}});
  const required=await prisma.taskEvidenceRequirement.findUniqueOrThrow({where:{id:sample.requirement.id}});
  const rejected=['dirty','screen'].includes(scenario);
  assert.equal(result.media?.privacyState,rejected?'DISCARDED':'NOT_REQUIRED');
  assert.equal(result.state,scenario==='dirty'?'CLEANING_REQUIRED':scenario==='screen'?'RECAPTURE_REQUIRED':'REVIEW_REQUIRED');
  assert.equal(required.state,result.state);
  if(rejected) {
    assert.equal(cloudCalls,before);
    const feedback=staffAttemptResult(result,false);
    assert.ok(feedback.instructions?.includes(scenario==='dirty'?'Clean the basin':'actual room'));
    if(scenario==='dirty')assert.equal(feedback.cleanlinessOutcome,'DIRTY');
  } else {
    assert.ok(cloudCalls>before);
    const content=await evidenceContent({id:manager.id,role:'ADMIN',companyId:company.id},receipt.assetId,'review',{store:io.store,read:async()=>bytes} as any);assert.deepEqual(content.bytes,bytes);
    await assert.rejects(()=>evidenceContent({id:manager.id,role:'ADMIN',companyId:company.id+999},receipt.assetId,'review'),/not found/);
    if(scenario==='clean') {
      const {managerDecision}=await import('../src/services/verification-v2/exception.service.js');
      const c=await prisma.verificationException.findUniqueOrThrow({where:{taskInstanceId:sample.task.id}});
      await managerDecision({id:manager.id,companyId:company.id,role:'ADMIN'},c.id,{requestId:randomUUID(),expectedVersion:c.rowVersion,action:'ACCEPT_EVIDENCE',requirementId:sample.requirement.id,evidenceAttemptId:sample.attempt.id,reasonCode:'AUTO_PASS_NOT_VALIDATED',note:'Checked the received photo and accepted the visible cleaning.'});
      const completed=await prisma.taskInstance.findUniqueOrThrow({where:{id:sample.task.id}});
      assert.equal(completed.status,'COMPLETED');assert.equal(completed.completionOutcome,'COMPLETED_WITH_EXCEPTIONS');
      assert.equal(await prisma.verificationDecision.count({where:{exceptionId:c.id}}),1);
    }

  }
  await assert.rejects(()=>readBufferedPhoto(company.id,sample.attempt.id));
  console.log(`PASS ${scenario}: ${Math.round(performance.now()-started)}ms (isolated DB, fake AI/storage)`);
}
await prisma.$disconnect();await rm(directory,{recursive:true,force:true});
console.log('PASS buffered workflow: deferred storage, rejection cleanup, review access, dirty guidance, retry reuse, service failure and tenant isolation');
