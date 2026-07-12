import "dotenv/config";
import assert from "node:assert/strict";
import { readFile, readdir, mkdir, mkdtemp, writeFile } from "node:fs/promises";
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
const database = `priv_verification_test_photo_http_${Date.now()}`;
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
const live=process.env.PHOTO_FLOW_LIVE==='1';
const output=new URL('../../docs/verification/evidence/photo-flow/',import.meta.url);
await mkdir(output,{recursive:true});
process.env.ACCESS_TOKEN_SECRET='isolated-photo-http-test-token-secret';
process.env.VERIFICATION_QR_SECRET='isolated-photo-http-qr-secret-32-characters';
process.env.VERIFICATION_SLOT_SECRET='isolated-photo-http-slot-secret-32-characters';
process.env.EVIDENCE_BUFFER_DIR=await mkdtemp('/tmp/hygene-photo-http-');
process.env.EVIDENCE_BUFFER_KEY='isolated-photo-http-buffer-key';
process.env.VERIFICATION_WORKER_HEALTH_FILE=process.env.EVIDENCE_BUFFER_DIR+'/worker-health.json';
const {prisma}=await import('../src/prisma/prisma.js');
const {default:express}=await import('express');
const {default:jwt}=await import('jsonwebtoken');
const {default:taskRouter}=await import('../src/routes/taskInstance.route.js');
const {default:verificationRouter}=await import('../src/routes/verification.route.js');
const {default:caseRouter}=await import('../src/routes/verificationException.route.js');
const {signTaskQr}=await import('../src/services/verification-v2/qr.service.js');
const {createTaskInstanceWithSnapshot}=await import('../src/services/verification-v2/inventorySnapshot.service.js');
const {readBufferedPhoto,removeBufferedPhoto}=await import('../src/services/verification-v2/evidenceBuffer.js');
const {finalizeTask}=await import('../src/services/verification-v2/completion.service.js');
const {claimVerificationJob}=await import('../src/services/verification-v2/jobQueue.service.js');
const {processBufferedPhoto}=await import('../src/services/verification-v2/bufferedPipeline.service.js');
const {spawn}=await import('node:child_process');
const {createHash}=await import('node:crypto');
const {default:cloudinary}=await import('../src/utils/cloudinary.js');
const app=express();app.use(express.json());app.use((req,_res,next)=>{req.cookies={};next();});
app.use('/api/task-instance',taskRouter);app.use('/api',verificationRouter);app.use('/api',caseRouter);
app.use((e:any,_req:any,res:any,_next:any)=>res.status(e.statusCode??500).json({message:e.message,errors:e.errors}));
const server=app.listen(0,'127.0.0.1');await new Promise<void>(r=>server.once('listening',r));
const base=`http://127.0.0.1:${(server.address() as {port:number}).port}/api`;
const now=new Date(),end=new Date(+now+3600000);
const company=await prisma.company.create({data:{name:`Photo HTTP E2E ${live?'LIVE':'CONTROLLED'}`,subscriptionStatus:'ACTIVE'}});
const location=await prisma.location.create({data:{companyId:company.id,name:'Synthetic photo test location',address:'Isolated test database',latitude:'24.8607',longitude:'67.0011',timezone:'Asia/Karachi'}});
const area=await prisma.area.create({data:{locationId:location.id,name:'Synthetic sink test',roomType:'WASHROOM',status:'ACTIVE'}});
await prisma.areaItem.create({data:{areaId:area.id,stableCode:'SINK-TEST',displayName:'Test sink',fixtureType:'SINK',sequence:1,rubricKey:'visible-v1',requiredViews:[{key:'basin_tap',instructions:'Show the basin, drain and tap.',mandatory:true}]}});
const staff=await prisma.staff.create({data:{companyId:company.id,locationId:location.id,name:'Photo test staff',email:randomUUID()+'@test.invalid',password:'isolated-test-password'}});
const other=await prisma.staff.create({data:{companyId:company.id,locationId:location.id,name:'Other test staff',email:randomUUID()+'@test.invalid',password:'isolated-test-password'}});
const manager=await prisma.manager.create({data:{companyId:company.id,name:'Photo test administrator',email:randomUUID()+'@test.invalid',password:'isolated-test-password',role:'ADMIN'}});
await prisma.attendance.create({data:{staffId:staff.id,locationId:location.id,date:now,expectedStart:now,expectedEnd:end,checkInTime:now,status:'CHECKED_IN'}});
const token=(id:number,role:string)=>jwt.sign({id,role},process.env.ACCESS_TOKEN_SECRET!,{expiresIn:'30m'});
const staffToken=token(staff.id,'STAFF'),managerToken=token(manager.id,'ADMIN');
const headers=(auth=staffToken)=>({Authorization:`Bearer ${auth}`,'X-Hygene-Workflow':'2','X-Hygene-App-Version':'2.0.0'});
const events:any[]=[],rows:any[]=[],uploadedAttemptIds=new Set<string>();
async function request(path:string,body?:unknown,auth=staffToken,expected=200){
 const started=performance.now();const r=await fetch(base+path,{method:body===undefined?'GET':'POST',headers:{...headers(auth),...(body===undefined?{}:{'Content-Type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)})});const json=await r.json() as any;
 events.push({path,status:r.status,ms:Math.round(performance.now()-started)});assert.equal(r.status,expected,`${path}: ${JSON.stringify(json)}`);return json.data;
}
let child:ReturnType<typeof spawn>|undefined,logFile:import('node:fs').WriteStream|undefined;
if(live){
 const {createWriteStream}=await import('node:fs');logFile=createWriteStream(new URL('live-worker.log',output));
 child=spawn(process.execPath,['dist/workers/verificationWorker.js'],{cwd:process.cwd(),env:process.env,stdio:['ignore','pipe','pipe']});child.stdout?.pipe(logFile);child.stderr?.pipe(logFile);
}
const clean=await readFile(new URL('clean-synthetic.jpg',output)),dirty=await readFile(new URL('dirty-synthetic.jpg',output));
const controlledStore=async(_bytes:Buffer,_id:string,_hash:string)=>({asset_id:'controlled-cloud-asset'} as any);
let activeScenario='clean';
const fakeProvider={evaluate:async(_image:Buffer,_rubric?:unknown,view?:string)=>({objectMatch:view?'MATCH':null,viewMatch:view?'MATCH':null,originality:activeScenario.startsWith('origin')?'UNCERTAIN':activeScenario==='screen'&&view?'SCREEN_RECAPTURE':'DIRECT',cleanliness:view?{verdict:activeScenario.includes('dirty')?'DIRTY':'CLEAN',surfaces:['basin','drain','tap'].map(surface=>({surface,verdict:activeScenario.includes('dirty')?'DIRTY':'CLEAN'})),confidence:.99,reasonCode:activeScenario.includes('dirty')?'CLEANING_REQUIRED':'CLEAN'}:null,metadata:{provider:'controlled-test'}} as any)};
async function waitResult(id:string){
 const deadline=Date.now()+180000;
 for(;;){
  if(!live){const job=await claimVerificationJob();if(job)await processBufferedPhoto(job,fakeProvider,{read:readBufferedPhoto,remove:removeBufferedPhoto,store:controlledStore});}
  const result=await request(`/verification-attempt/${id}`);
  if(['PASSED','CLEANING_REQUIRED','RECAPTURE_REQUIRED','REVIEW_REQUIRED','SERVICE_FAILURE','PRIVACY_HOLD'].includes(result.state))return result;
  if(Date.now()>deadline)throw new Error(`Timed out waiting for ${id}: ${result.state}`);
  if(live&&child?.exitCode!==null)throw new Error('Live worker exited');
  await new Promise(r=>setTimeout(r,250));
 }
}
async function capture(session:any,slot:any,image:Buffer,label:string){
 const activation=await request(`/capture-session/${session.id}/activate-photo`,{slotId:slot.id,deviceId:'http-test-device'});
 const current=activation.slots.find((s:any)=>s.id===slot.id);
 const captured=Date.now(),metadata={clientCaptureId:randomUUID(),slotId:slot.id,nonce:current.nonce,sha256:createHash('sha256').update(image).digest('hex'),claimedCapturedAt:new Date(captured).toISOString(),elapsedMs:captured-Date.parse(session.serverTimeAnchor),bootId:'http-test-boot',deviceId:'http-test-device'};
 function form(overrides:Record<string,string>={}){const f=new FormData();f.set('photo',new Blob([new Uint8Array(image)],{type:'image/jpeg'}),'synthetic-test.jpg');for(const [k,v]of Object.entries({...metadata,...overrides}))f.set(k,String(v));return f;}
 if(slot.requirementId){
  const invalid=await fetch(base+`/capture-session/${session.id}/attempts`,{method:'POST',headers:headers(),body:form({sha256:'0'.repeat(64)})});assert.equal(invalid.status,409);
  const unauthorized=await fetch(base+`/capture-session/${session.id}/attempts`,{method:'POST',headers:headers(token(other.id,'STAFF')),body:form()});assert.equal(unauthorized.status,404);
  const future=await fetch(base+`/capture-session/${session.id}/attempts`,{method:'POST',headers:headers(),body:form({claimedCapturedAt:new Date(captured+600000).toISOString(),elapsedMs:metadata.elapsedMs+600000+''})});assert.equal(future.status,410);
 }
 const started=performance.now();const upload=await fetch(base+`/capture-session/${session.id}/attempts`,{method:'POST',headers:headers(),body:form()});const receipt=(await upload.json() as any).data;
 assert.equal(upload.status,202);assert.equal(receipt.storage,'buffered');uploadedAttemptIds.add(receipt.attemptId);
 const receiptMs=Math.round(performance.now()-started);
 const repeat=await fetch(base+`/capture-session/${session.id}/attempts`,{method:'POST',headers:headers(),body:form()});assert.equal(repeat.status,202);assert.equal((await repeat.json() as any).data.attemptId,receipt.attemptId);
 const result=await waitResult(receipt.attemptId),durationMs=Math.round(performance.now()-started);
 const media=await prisma.evidenceAsset.findFirstOrThrow({where:{attempts:{some:{id:receipt.attemptId}}}});
 const jobs=await prisma.verificationJob.findMany({where:{attemptId:receipt.attemptId},select:{stage:true,state:true,result:true}});assert.ok(jobs.every(j=>j.stage==='PHOTO'));
 const rejected=['CLEANING_REQUIRED','RECAPTURE_REQUIRED'].includes(result.state);
 if(rejected){assert.equal(result.storage,'discarded');assert.equal(media.privacyState,'DISCARDED');assert.equal(media.sanitizedPublicId,null);}
 else if(result.state!=='SERVICE_FAILURE'){assert.equal(result.storage,'cloud');assert.equal(media.privacyState,'NOT_REQUIRED');}
 if(live&&rejected){
  let absent=false;try{await cloudinary.api.resource(media.originalPublicId,{type:'authenticated',resource_type:'image'});}catch(e:any){absent=(e.error?.http_code??e.http_code)===404;}assert.ok(absent,'Rejected photo must not exist in Cloudinary');
 }
 if(result.state!=='SERVICE_FAILURE')await assert.rejects(()=>readBufferedPhoto(company.id,receipt.attemptId));
 rows.push({label,taskId:session.taskInstanceId,attemptId:receipt.attemptId,receiptMs,durationMs,state:result.state,storage:result.storage,reason:result.reasonCode,instructions:result.instructions,assessment:(jobs[0]?.result as any)?.assessment,decision:(jobs[0]?.result as any)?.decision});
 console.log(`${live?'LIVE':'CONTROLLED'} ${label}: ${durationMs}ms, ${result.state}, ${result.storage}, ${result.reasonCode??''}`);
 return result;
}
async function session(taskId:number,rework?:unknown){return request(`/task-instance/${taskId}/capture-sessions${rework?'/rework':''}`,{requestId:randomUUID(),areaQr:signTaskQr({id:taskId,areaId:area.id},area),deviceId:'http-test-device',clientBootId:'http-test-boot',clientTime:new Date().toISOString(),location:{latitude:24.8607,longitude:67.0011,accuracy:3,sampledAt:new Date().toISOString()},...(rework?{requirements:rework}: {})},staffToken,201);}
try{
 for(const scenario of live?['clean','dirty']:['clean','dirty','screen','origin','origin-dirty']){
  activeScenario=scenario;
  const template=await prisma.taskTemplate.create({data:{locationId:location.id,areaId:area.id,staffId:staff.id,title:`PHOTO TEST ${scenario}`,verificationVersion:2,inventorySelection:'ALL',setupStatus:'READY',shiftStart:new Date(+now-120000),shiftEnd:end,effectiveDate:now}});
  const task=await createTaskInstanceWithSnapshot({templateId:template.id,title:template.title,locationId:location.id,date:new Date(),shiftStart:new Date(+now-120000),shiftEnd:end});assert.ok(task?.id);
  await request(`/task-instance/${task.id}/start`,{areaQr:'wrong-qr'},staffToken,422);
  await request(`/task-instance/${task.id}/start`,{areaQr:signTaskQr(task,area)});
  await request(`/task-instance/${task.id}/complete`,{},staffToken,409);
  let s=await session(task.id);
  assert.deepEqual(s.requiredContextKeys,[], 'New sessions need only manager-configured item photos');
  assert.ok(s.slots.every((slot:any)=>!!slot.requirementId&&!slot.contextKey));
  if(!live&&scenario==='clean'){
    // Reproduce an existing pre-change session without changing any fixture result.
    const previous=await prisma.captureSession.findUniqueOrThrow({where:{id:s.id}});
    await prisma.captureSession.update({where:{id:s.id},data:{contextStatus:'PENDING',locationCheck:{...(previous.locationCheck as any),captureContextPolicy:{version:1,requiredKeys:['ENTRANCE']}}}});
    await prisma.captureSlot.create({data:{id:randomUUID(),sessionId:s.id,contextKey:'ENTRANCE',sequence:-1,generation:0,expiresAt:new Date(s.captureExpiresAt),nonceHash:'retired-test-entrance'}});
    s=await request(`/capture-session/${s.id}/resume`,{deviceId:'http-test-device',clientBootId:'http-test-boot',pendingCaptureIds:[]});
    assert.deepEqual(s.requiredContextKeys,[]);assert.equal(s.contextStatus,'ACCEPTABLE');
    assert.ok(s.slots.every((slot:any)=>!slot.contextKey));
    assert.equal(await prisma.auditLog.count({where:{entityId:task.id,action:'CONTEXT_PHOTO_REQUIREMENTS_RETIRED'}}),1);
    assert.equal(await prisma.captureSlot.count({where:{sessionId:s.id,contextKey:'ENTRANCE'}}),1,'Historical slot is retained');
  }

  // ENTRANCE is still a required context step; this synthetic image only tests transport/state, not context accuracy.
  for(const slot of s.slots.filter((slot:any)=>slot.contextKey))await capture(s,slot,clean,`${scenario}-context`);
  const fixtureSlot=s.slots.find((slot:any)=>slot.requirementId);
  let result=await capture(s,fixtureSlot,scenario.includes('dirty')?dirty:clean,`${scenario}-fixture`);
  if(!live&&scenario.includes('dirty'))assert.equal(result.state,'CLEANING_REQUIRED');
  if(!live&&scenario==='screen')assert.equal(result.state,'RECAPTURE_REQUIRED');
  if(result.state==='CLEANING_REQUIRED'){
   await request(`/task-instance/${task.id}/complete`,{},staffToken,409);
   const manifest=await request(`/task-instance/${task.id}/verification`);const r=manifest.items[0].requirements[0];
   activeScenario='clean';s=await session(task.id,[{requirementId:r.id,expectedGeneration:r.decisionVersion}]);
   result=await capture(s,s.slots.find((slot:any)=>slot.requirementId),clean,`${scenario}-after-cleaning`);
  }else if(result.state==='RECAPTURE_REQUIRED'){
   const manifest=await request(`/task-instance/${task.id}/verification`);const r=manifest.items[0].requirements[0];
   const retakes=await request(`/capture-session/${s.id}/retake-slots`,{deviceId:'http-test-device',requirements:[{requirementId:r.id,expectedGeneration:r.decisionVersion}]});
   activeScenario='clean';result=await capture(s,retakes[0],clean,`${scenario}-retake`);
  }
  if(result.state==='SERVICE_FAILURE')continue;
  await request(`/task-instance/${task.id}/complete`,{});
  const refreshed=await request(`/task-instance/${task.id}`);assert.ok(refreshed.staffSubmittedAt);
  const c=await prisma.verificationException.findUnique({where:{taskInstanceId:task.id}});
  if(c){
    if(scenario==='origin-dirty')await prisma.captureSession.update({where:{id:s.id},data:{presenceStatus:'UNCERTAIN'}});
    let detail=await request(`/verification-exceptions/${c.id}`,undefined,managerToken);
    for(const requirement of detail.items.flatMap((i:any)=>i.requirements).filter((r:any)=>r.state==='REVIEW_REQUIRED')){
      detail=await request(`/verification-exceptions/${c.id}`,undefined,managerToken);
      const r=detail.items.flatMap((i:any)=>i.requirements).find((r:any)=>r.id===requirement.id);
      await request(`/verification-exceptions/${c.id}/actions`,{requestId:randomUUID(),expectedVersion:detail.rowVersion,action:'ACCEPT_EVIDENCE',requirementId:r.id,evidenceAttemptId:r.currentAttempt.id,reasonCode:r.currentAttempt.reasonCode??'CANNOT_ASSESS',note:'Synthetic end-to-end test. Administrator inspected the test evidence.'},managerToken);
    }
    detail=await request(`/verification-exceptions/${c.id}`,undefined,managerToken);
    for(const context of detail.attempts?.filter((a:any)=>a.contextKey&&a.state==='REVIEW_REQUIRED')??[])await request(`/verification-exceptions/${c.id}/actions`,{requestId:randomUUID(),expectedVersion:detail.rowVersion,action:'ACCEPT_CONTEXT',evidenceAttemptId:context.id,reasonCode:'CONTEXT_UNCERTAIN',note:'Synthetic end-to-end context test.'},managerToken);
    if(scenario==='origin-dirty'){
      assert.equal(await prisma.$transaction(tx=>finalizeTask(tx,task.id)),null,'Preserved context acceptance must not override new-session presence');
      await prisma.captureSession.update({where:{id:s.id},data:{presenceStatus:'ACCEPTABLE'}});
      assert.equal(await prisma.$transaction(tx=>finalizeTask(tx,task.id)),'COMPLETED_WITH_EXCEPTIONS');
    }
    const final=await request(`/task-instance/${task.id}`,undefined,managerToken);assert.equal(final.completionOutcome,'COMPLETED_WITH_EXCEPTIONS');
    const list=await request('/verification-exceptions?queue=needs-me&page=1',undefined,managerToken);assert.ok(!list.cases.some((item:any)=>item.id===c.id));
  }
 }
 await writeFile(new URL(`${live?'live':'controlled'}-report.json`,output),JSON.stringify({mode:live?'live-cloudflare-cloudinary':'controlled-providers',database,apiBase:base,images:'synthetic test fixtures, not real camera photos',rows,requests:events},null,2));
 console.log(`PASS ${live?'LIVE':'CONTROLLED'} HTTP flow: QR start, early-submit guard, timed slots, multipart upload, hash/time/account denial, retry identity, queue, processing, cleanup, rework/retake, staff submission, audited manager completion and review removal`);
}catch(error){
 await writeFile(new URL(`${live?'live':'controlled'}-failure.json`,output),JSON.stringify({mode:live?'live':'controlled',database,rows,requests:events,error:error instanceof Error?error.message:String(error)},null,2));throw error;
}finally{
 if(child){child.kill('SIGTERM');await new Promise<void>(r=>{const timer=setTimeout(()=>{child!.kill('SIGKILL');r();},15000);child!.once('exit',()=>{clearTimeout(timer);r();});});logFile?.end();}
 if(live){for(const id of uploadedAttemptIds){const prefix=`verification/${company.id}/attempts/${id}`;for(const variant of ['original','review'])await cloudinary.uploader.destroy(`${prefix}/${variant}`,{type:'authenticated',resource_type:'image'}).catch(()=>{});}}
 await new Promise<void>(r=>server.close(()=>r()));await prisma.$disconnect();
}
