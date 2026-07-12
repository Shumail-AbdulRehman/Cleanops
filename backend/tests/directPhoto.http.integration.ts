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
process.env.ACCESS_TOKEN_SECRET='isolated-direct-photo-test-token';
process.env.VERIFICATION_QR_SECRET='isolated-direct-photo-qr-secret-32-characters';
process.env.VERIFICATION_SLOT_SECRET='isolated-direct-photo-slot-secret-32-characters';
const {prisma}=await import('../src/prisma/prisma.js');
const {default:express}=await import('express');
const {default:jwt}=await import('jsonwebtoken');
const {default:taskRouter}=await import('../src/routes/taskInstance.route.js');
const {default:verificationRouter}=await import('../src/routes/verification.route.js');
const {default:caseRouter}=await import('../src/routes/verificationException.route.js');
const {signTaskQr,signAreaQr}=await import('../src/services/verification-v2/qr.service.js');
const {createTaskInstanceWithSnapshot}=await import('../src/services/verification-v2/inventorySnapshot.service.js');
const {createArea}=await import('../src/services/area.service.js');
const {BufferedClefProvider}=await import('../src/services/verification-v2/bufferedPhoto.provider.js');
const {default:cloudinary}=await import('../src/utils/cloudinary.js');
const {default:sharp}=await import('sharp');
const {createHash}=await import('node:crypto');
const {Writable}=await import('node:stream');
const evaluateWithClef=BufferedClefProvider.prototype.evaluate;
let scenario='clean',aiCalls=0,cloudCalls=0,storageFail=false;
BufferedClefProvider.prototype.evaluate=async(_image,rubric,view,fixtureType)=>{
 aiCalls++;if(scenario==='failure')throw new Error('Controlled AI failure');
 await new Promise(r=>setTimeout(r,30));
 const verdict=scenario==='dirty'?'DIRTY':scenario==='cleanliness-uncertain'?'CANNOT_ASSESS':'CLEAN';
 const toiletStyle=scenario==='squat'||fixtureType==='INDIAN_TOILET'?'SQUAT' as const:scenario==='western'||fixtureType==='WESTERN_TOILET'?'WESTERN' as const:undefined;
 const checkedSurfaces=fixtureType==='INDIAN_TOILET'||fixtureType==='WESTERN_TOILET'?(rubric as any).surfacesByView[view!]:toiletStyle==='SQUAT'?(view==='exterior_base'?['pan_edges','surrounding_floor']:['pan','drain','footrests']):toiletStyle==='WESTERN'?(view==='exterior_base'?['exterior','base']:['bowl','seat']):['basin'];
 return {toiletStyle,viewMatch:scenario==='missing-view'?'MISSING_SURFACE':scenario==='view-uncertain'?'UNCERTAIN':'MATCH',missingSurfaces:scenario==='missing-view'?['tap']:[],objectMatch:scenario==='wrong-object'?'WRONG_ITEM':scenario==='object-uncertain'?'UNCERTAIN':'MATCH',originality:scenario==='screen'?'SCREEN_RECAPTURE':'DIRECT',cleanliness:{verdict,surfaces:checkedSurfaces.map(surface=>({surface,verdict})),confidence:.99,reasonCode:verdict==='DIRTY'?'CLEANING_REQUIRED':verdict==='CANNOT_ASSESS'?'CANNOT_ASSESS':'CLEAN'},metadata:{} as any};
};
const assets=new Map<string,any>();
cloudinary.api.resource=(async(id:string)=>{
 if(storageFail){storageFail=false;throw {http_code:503};}
 const value=assets.get(id);if(!value)throw {http_code:404};return value;
}) as any;
cloudinary.uploader.upload_stream=((options:any,callback:any)=>new Writable({write(_chunk,_encoding,done){done();},final(done){cloudCalls++;const value={asset_id:randomUUID(),context:{custom:options.context}};assets.set(options.public_id,value);callback(null,value);done();}})) as any;
const app=express();app.use(express.json());app.use((req,_res,next)=>{req.cookies={};next();});
app.use('/api/task-instance',taskRouter);app.use('/api',verificationRouter);app.use('/api',caseRouter);
app.use((e:any,_req:any,res:any,_next:any)=>res.status(e.statusCode??500).json({message:e.message,errors:e.errors}));
const server=app.listen(0,'127.0.0.1');await new Promise<void>(r=>server.once('listening',r));
const base=`http://127.0.0.1:${(server.address() as {port:number}).port}/api`;
const now=new Date(),end=new Date(+now+3600000);
const company=await prisma.company.create({data:{name:'Direct photo HTTP test',subscriptionStatus:'ACTIVE'}});
const location=await prisma.location.create({data:{companyId:company.id,name:'Synthetic photo test location',address:'Isolated test database',latitude:'24.8607',longitude:'67.0011',timezone:'Asia/Karachi'}});
const area=await prisma.area.create({data:{locationId:location.id,name:'Synthetic sink test',roomType:'WASHROOM',status:'ACTIVE'}});
await prisma.areaItem.create({data:{areaId:area.id,stableCode:'SINK-TEST',displayName:'Test sink',fixtureType:'SINK',sequence:1,rubricKey:'visible-v1',requiredViews:[{key:'basin_tap',instructions:'Show the basin, drain and tap.',mandatory:true}]}});
let staff=await prisma.staff.create({data:{companyId:company.id,locationId:location.id,name:'Photo test staff',email:randomUUID()+'@test.invalid',password:'isolated-test-password'}});
const other=await prisma.staff.create({data:{companyId:company.id,locationId:location.id,name:'Other test staff',email:randomUUID()+'@test.invalid',password:'isolated-test-password'}});
const manager=await prisma.manager.create({data:{companyId:company.id,name:'Photo test administrator',email:randomUUID()+'@test.invalid',password:'isolated-test-password',role:'ADMIN'}});
await prisma.attendance.create({data:{staffId:staff.id,locationId:location.id,date:now,expectedStart:now,expectedEnd:end,checkInTime:now,status:'CHECKED_IN'}});
const token=(id:number,role:string)=>jwt.sign({id,role},process.env.ACCESS_TOKEN_SECRET!,{expiresIn:'30m'});
let staffToken=token(staff.id,'STAFF');const managerToken=token(manager.id,'ADMIN');
const headers=(auth=staffToken)=>({Authorization:`Bearer ${auth}`,'X-Hygene-Workflow':'2','X-Hygene-App-Version':'2.0.0'});
async function request(path:string,body?:unknown,expected=200,auth=staffToken){
 const r=await fetch(base+path,{method:body===undefined?'GET':'POST',headers:{...headers(auth),...(body===undefined?{}:{'Content-Type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)})});
 const result=await r.json() as any;assert.equal(r.status,expected,`${path}: ${JSON.stringify(result)}`);return result.data;
}
async function newTask(label:string,targetArea=area){
 const template=await prisma.taskTemplate.create({data:{locationId:location.id,areaId:targetArea.id,staffId:staff.id,title:label,verificationVersion:2,inventorySelection:'ALL',setupStatus:'READY',shiftStart:new Date(+now-120000),shiftEnd:end,effectiveDate:now}});
 const task=await createTaskInstanceWithSnapshot({templateId:template.id,title:label,locationId:location.id,date:new Date(),shiftStart:new Date(+now-120000),shiftEnd:end});assert.ok(task);
 const taskQr=await request(`/task-instance/${task.id}/qr`,undefined,200,managerToken);
 assert.equal(taskQr.taskId,task.id);
 await request(`/task-instance/${task.id}/start`,{areaQr:taskQr.payload});
 await request(`/task-instance/${task.id}/complete`,{},409);
 const s=await request(`/task-instance/${task.id}/capture-sessions`,{requestId:randomUUID(),areaQr:taskQr.payload,deviceId:'http-test-device',clientBootId:'http-test-boot',clientTime:new Date().toISOString(),location:{latitude:24.8607,longitude:67.0011,accuracy:3,sampledAt:new Date().toISOString()}},201);
 return {task,s};
}
async function photo(s:any){
 const activated=await request(`/capture-session/${s.id}/activate-photo`,{slotId:s.slots[0].id,deviceId:'http-test-device'}),slot=activated.slots.find((candidate:any)=>candidate.id===s.slots[0].id);
 const pixels=Buffer.alloc(1000*1000*3);for(let i=0;i<pixels.length;i++)pixels[i]=120+(i*37)%100;
 const image=await sharp(pixels,{raw:{width:1000,height:1000,channels:3}}).jpeg({quality:90}).toBuffer();
 const captured=Date.now(),metadata={clientCaptureId:randomUUID(),slotId:slot.id,nonce:slot.nonce,sha256:createHash('sha256').update(image).digest('hex'),claimedCapturedAt:new Date(captured).toISOString(),elapsedMs:captured-Date.parse(s.serverTimeAnchor),bootId:'http-test-boot',deviceId:'http-test-device'};
 const form=(override:Record<string,string>={})=>{const f=new FormData();f.set('photo',new Blob([new Uint8Array(image)],{type:'image/jpeg'}),'test.jpg');for(const[k,v]of Object.entries({...metadata,...override}))f.set(k,String(v));return f;};
 const upload=async(expected=200,override:Record<string,string>={},auth=staffToken)=>{
  const r=await fetch(base+`/capture-session/${s.id}/attempts`,{method:'POST',headers:headers(auth),body:form(override)}),result=await r.json() as any;
  assert.equal(r.status,expected,JSON.stringify(result));return result.data;
 };
 return {upload,metadata};
}
try{
 // Two tasks generated from the same template must never share scan authority.
 {
  const {task:first}=await newTask('Task QR authority');
  const firstQr=await request(`/task-instance/${first.id}/qr`,undefined,200,managerToken);
  assert.equal((await request(`/task-instance/${first.id}/qr`,undefined,200,managerToken)).payload,firstQr.payload,'reading a task QR never rotates it');
  await request(`/task-instance/${first.id}/qr`,undefined,403);
  const second=await createTaskInstanceWithSnapshot({templateId:first.templateId!,title:'Same template, separate task',locationId:location.id,date:new Date(+now+60000),shiftStart:new Date(+now-120000),shiftEnd:end});assert.ok(second);
  const secondQr=await request(`/task-instance/${second.id}/qr`,undefined,200,managerToken);
  assert.notEqual(firstQr.payload,secondQr.payload,'same area and template still yield unique task QRs');
  await request(`/task-instance/${second.id}/start`,{areaQr:firstQr.payload},422);
  await request(`/task-instance/${second.id}/start`,{areaQr:signAreaQr(area)},422);
  await request(`/task-instance/${second.id}/start`,{areaQr:secondQr.payload});
  const body={requestId:randomUUID(),areaQr:firstQr.payload,deviceId:'http-test-device',clientBootId:'http-test-boot',clientTime:new Date().toISOString(),location:{latitude:24.8607,longitude:67.0011,accuracy:3,sampledAt:new Date().toISOString()}};
  await request(`/task-instance/${second.id}/capture-sessions`,body,422);
  await request(`/task-instance/${second.id}/capture-sessions`,{...body,requestId:randomUUID(),areaQr:secondQr.payload},201);
  const scoped=await prisma.manager.create({data:{companyId:company.id,name:'Scoped manager',role:'MANAGER',email:randomUUID()+'@test.invalid',password:'isolated-test-password'}});
  const scopedToken=token(scoped.id,'MANAGER');
  await request(`/task-instance/${first.id}/qr`,undefined,403,scopedToken);
  await prisma.managerLocation.create({data:{managerId:scoped.id,locationId:location.id}});
  assert.equal((await request(`/task-instance/${first.id}/qr`,undefined,200,scopedToken)).payload,firstQr.payload);
  const foreignCompany=await prisma.company.create({data:{name:'Foreign QR company',subscriptionStatus:'ACTIVE'}});
  const foreignManager=await prisma.manager.create({data:{companyId:foreignCompany.id,name:'Foreign owner',role:'ADMIN',email:randomUUID()+'@test.invalid',password:'isolated-test-password'}});
  await request(`/task-instance/${first.id}/qr`,undefined,404,token(foreignManager.id,'ADMIN'));
 }
 for(const kind of ['clean','dirty','screen','wrong-object','missing-view','object-uncertain','view-uncertain','cleanliness-uncertain','failure','storage-failure','interrupted','renew'] as const){
  // Independent actors keep rapid fixtures within the per-worker session limit.
  if(kind!=='clean'){
   staff=await prisma.staff.create({data:{companyId:company.id,locationId:location.id,name:'Photo test staff',email:randomUUID()+'@test.invalid',password:'isolated-test-password'}});
   staffToken=token(staff.id,'STAFF');
   await prisma.attendance.create({data:{staffId:staff.id,locationId:location.id,date:now,expectedStart:now,expectedEnd:end,checkInTime:now,status:'CHECKED_IN'}});
  }
  scenario=kind;const{task,s}=await newTask(kind),p=await photo(s),beforeAi=aiCalls,beforeCloud=cloudCalls;
  await p.upload(409,{sha256:'0'.repeat(64)});
  await p.upload(404,{},token(other.id,'STAFF'));
  if(kind==='failure'||kind==='renew'){
   scenario='failure';await p.upload(503);await request(`/task-instance/${task.id}/complete`,{},409);
   if(kind==='renew'){
    const renewed=await request(`/capture-session/${s.id}/renew`,{requestId:randomUUID(),areaQr:signTaskQr(task,area),deviceId:'http-test-device',clientBootId:'http-test-boot',clientTime:new Date().toISOString(),location:{latitude:24.8607,longitude:67.0011,accuracy:3,sampledAt:new Date().toISOString()}},201);
    assert.ok(renewed.slots.some((slot:any)=>slot.requirementId&&slot.id!==s.slots[0].id));continue;
   }
   scenario='clean';await p.upload();assert.equal(aiCalls,beforeAi+2);
  }else if(kind==='storage-failure'){
   storageFail=true;await p.upload(503);assert.equal(aiCalls,beforeAi+1);
   await request(`/task-instance/${task.id}/complete`,{},409);await p.upload();assert.equal(aiCalls,beforeAi+1,'manual storage retry reuses completed AI');
  }else{
   if(kind==='interrupted'){
    // A failed request leaves no bytes on the server; its stale ownership is safe to reclaim.
    scenario='failure';await p.upload(503);
    const a=await prisma.verificationAttempt.findUniqueOrThrow({where:{sessionId_clientCaptureId:{sessionId:s.id,clientCaptureId:p.metadata.clientCaptureId}}});
    await prisma.verificationAttempt.update({where:{id:a.id},data:{state:'CLEANLINESS_CHECK',directProcessingToken:randomUUID(),directProcessingStartedAt:new Date(Date.now()-200000)}});
    scenario='clean';
   }
   const result=await p.upload();
   if(['object-uncertain','view-uncertain','cleanliness-uncertain'].includes(kind)){
    assert.equal(result.state,'REVIEW_REQUIRED');assert.equal(result.storage,'cloud');
    assert.equal(result.reasonCode,kind==='object-uncertain'?'OBJECT_UNCERTAIN':kind==='view-uncertain'?'VIEW_UNCERTAIN':'CANNOT_ASSESS');
    assert.match(result.instructions,/Your manager will check/);assert.doesNotMatch(result.instructions,/take another photo/);
    const current=await request(`/task-instance/${task.id}/verification`);
    assert.equal(current.items[0].requirements[0].state,'REVIEW_REQUIRED');
    assert.equal(current.items[0].requirements[0].currentAttempt.instructions,result.instructions);
    const issue=await prisma.verificationIssue.findFirst({where:{exception:{taskInstanceId:task.id},reasonCode:result.reasonCode}});
    assert.ok(issue);assert.equal(issue.state,'MANAGER_REVIEW');
   }
   assert.equal(result.storage,['dirty','screen','wrong-object','missing-view'].includes(kind)?'discarded':'cloud');
   if(['dirty','screen','wrong-object','missing-view'].includes(kind)){
    let retakeSession=s;
    assert.equal(result.state,kind==='dirty'?'CLEANING_REQUIRED':'RECAPTURE_REQUIRED');
    if(kind==='wrong-object'){assert.equal(result.reasonCode,'WRONG_ITEM');assert.match(result.instructions,/This photo does not show the sink/);}
    if(kind==='missing-view'){assert.equal(result.reasonCode,'MISSING_SURFACE');assert.match(result.instructions,/does not show the tap/);assert.match(result.instructions,/whole sink basin, drain and tap/);}
    if(kind==='dirty')assert.match(result.instructions,/The sink is not clean/);
    assert.equal(cloudCalls,beforeCloud);
    await request(`/task-instance/${task.id}/complete`,{},409);
    const manifest=await request(`/task-instance/${task.id}/verification`),r=manifest.items[0].requirements[0];
    assert.equal(r.currentAttempt.instructions,result.instructions,'refresh preserves the specific correction');
    const polled=await request(`/verification-attempt/${result.attemptId}`);
    assert.equal(polled.instructions,result.instructions,'polling preserves the specific correction');
    if(kind==='wrong-object'){
     for(let repeat=0;repeat<3;repeat++){
      retakeSession=await request(`/capture-session/${retakeSession.id}/renew`,{requestId:randomUUID(),areaQr:signTaskQr(task,area),deviceId:'http-test-device',clientBootId:'http-test-boot',clientTime:new Date().toISOString(),location:{latitude:24.8607,longitude:67.0011,accuracy:3,sampledAt:new Date().toISOString()}},201);
      const rejected=await(await photo(retakeSession)).upload();
      assert.equal(rejected.state,'RECAPTURE_REQUIRED');assert.equal(rejected.reasonCode,'WRONG_ITEM');assert.equal(rejected.storage,'discarded');
      assert.match(rejected.instructions,/take another photo/);
     }
     assert.equal(await prisma.verificationException.count({where:{taskInstanceId:task.id}}),0,'repeated wrong objects must never create a manager case');
     assert.equal(await prisma.verificationIssue.count({where:{exception:{taskInstanceId:task.id}}}),0);
     assert.equal(cloudCalls,beforeCloud,'wrong objects must never be uploaded to cloud storage');
    }
    const path=kind==='dirty'?`/task-instance/${task.id}/capture-sessions/rework`:`/capture-session/${retakeSession.id}/renew`;
    const retrySession=await request(path,{requestId:randomUUID(),areaQr:signTaskQr(task,area),deviceId:'http-test-device',clientBootId:'http-test-boot',clientTime:new Date().toISOString(),location:{latitude:24.8607,longitude:67.0011,accuracy:3,sampledAt:new Date().toISOString()},...(kind==='dirty'?{requirements:[{requirementId:r.id,expectedGeneration:r.decisionVersion}]}:{})},201);
    scenario='clean';await(await photo(retrySession)).upload();await request(`/task-instance/${task.id}/complete`,{});
   }
   if(kind==='clean'){
    await p.upload();assert.equal(aiCalls,beforeAi+1,'duplicate upload returns existing result');
    const recovered=await request(`/capture-session/${s.id}/attempts/by-capture/${p.metadata.clientCaptureId}`);assert.equal(recovered.attemptId,result.attemptId);
    await request(`/task-instance/${task.id}/verification-issues`,{reasonCode:'OCCUPIED'},410);
   }
  }
  assert.equal(await prisma.verificationJob.count({where:{attempt:{session:{taskInstanceId:task.id}}}}),0,'direct uploads cannot create queue jobs');
  if(!['dirty','screen','wrong-object','missing-view'].includes(kind))await request(`/task-instance/${task.id}/complete`,{});
 }
 const toiletArea=await prisma.area.create({data:{locationId:location.id,name:'Both toilet designs',roomType:'WASHROOM',status:'ACTIVE'}});
 await prisma.areaItem.create({data:{areaId:toiletArea.id,stableCode:'TOILET-TEST',displayName:'Test toilet',fixtureType:'TOILET',sequence:1,rubricKey:'visible-v1',requiredViews:[{key:'bowl_seat',instructions:'Show the bowl interior and seat.',mandatory:true},{key:'exterior_base',instructions:'Show the exterior and base.',mandatory:true}]}});
 for(const style of ['squat','western']){
  scenario=style;const{task,s}=await newTask(style,toiletArea);
  const manifest=await request(`/task-instance/${task.id}/verification`);
  assert.match(manifest.items[0].requirements.find((r:any)=>r.viewKey==='bowl_seat').instructions,/Indian\/squat/,'existing Western-only snapshots display both toilet guides');
  assert.equal(s.slots.length,2,'both toilet photos remain mandatory');
  for(const slot of s.slots){
   const result=await(await photo({...s,slots:[slot]})).upload();
   assert.equal(result.state,'REVIEW_REQUIRED','matching toilets retain the existing uncalibrated-clean review policy');
   assert.equal(result.storage,'cloud');
  }
  await request(`/task-instance/${task.id}/complete`,{});
  const attempts=await prisma.verificationAttempt.findMany({where:{sessionId:s.id},select:{cleanlinessResult:true}});
  assert.equal(attempts.length,2);
  assert.ok(attempts.every(a=>(a.cleanlinessResult as any).photoContext.toiletStyle===(style==='squat'?'SQUAT':'WESTERN')));
 }
 for(const fixtureType of ['INDIAN_TOILET','WESTERN_TOILET'] as const){
  scenario='clean';
  const configured=await createArea({id:manager.id,companyId:company.id,role:'ADMIN'},location.id,{name:fixtureType,roomType:'WASHROOM',counts:[{fixtureType,count:1}]});
  const {task,s}=await newTask(fixtureType,configured);
  const manifest=await request(`/task-instance/${task.id}/verification`);
  assert.match(manifest.items[0].name,fixtureType==='INDIAN_TOILET'?/Indian toilet/:/Western toilet/);
  assert.equal(s.slots.length,fixtureType==='INDIAN_TOILET'?1:2);
  const snapshot=await prisma.taskVerificationItem.findFirstOrThrow({where:{taskInstanceId:task.id}});
  assert.equal(snapshot.typeSnapshot,fixtureType);
  if(fixtureType==='INDIAN_TOILET'){
   assert.deepEqual((snapshot.rubricSnapshot as any).surfacesByView,{squat_pan:['pan']});
   assert.equal(manifest.items[0].requirements[0].instructions,'Show the whole Indian toilet pan clearly.');
  }
  for(const slot of s.slots){
   const result=await(await photo({...s,slots:[slot]})).upload();
   assert.equal(result.state,'REVIEW_REQUIRED','valid photos keep the existing cleanliness review policy');
  }
  await request(`/task-instance/${task.id}/complete`,{});
 }
 // A review must explain a rejected photo independently of missing photos.
 {
  staff=await prisma.staff.create({data:{companyId:company.id,locationId:location.id,name:'Review explanation staff',email:randomUUID()+'@test.invalid',password:'isolated-test-password'}});
  staffToken=token(staff.id,'STAFF');
  await prisma.attendance.create({data:{staffId:staff.id,locationId:location.id,date:now,expectedStart:now,expectedEnd:end,checkInTime:now,status:'CHECKED_IN'}});
  const configured=await createArea({id:manager.id,companyId:company.id,role:'ADMIN'},location.id,{name:'Review explanation room',roomType:'WASHROOM',counts:[{fixtureType:'INDIAN_TOILET',count:1},{fixtureType:'SINK',count:1},{fixtureType:'MIRROR',count:1},{fixtureType:'FLOOR',count:1}]});
  scenario='dirty';const {task,s}=await newTask('Explain incomplete cleaning',configured);
  await(await photo(s)).upload();
  const {raiseIssue}=await import('../src/services/verification-v2/exception.service.js');
  await prisma.$transaction(tx=>raiseIssue(tx as any,task.id,'MISSING_EVIDENCE',null));
  const review=await prisma.verificationException.findFirstOrThrow({where:{taskInstanceId:task.id}});
  const live=await request(`/verification-exceptions/${review.id}`,undefined,200,managerToken);
  assert.equal(live.captureStatus.available,true);assert.equal(live.captureStatus.reason,'AVAILABLE');
  const pan=live.items.flatMap((item:any)=>item.requirements).find((r:any)=>r.state==='CLEANING_REQUIRED');
  assert.ok(pan);assert.equal(pan.currentAttempt.mediaAssetId,null);assert.equal(pan.currentAttempt.privacyState,'DISCARDED');
  assert.equal(pan.currentAttempt.reviewSummary.reasonCode,'CLEANING_REQUIRED');
  assert.deepEqual(pan.currentAttempt.reviewSummary.dirtySurfaces,['pan']);
  assert.equal(live.items.flatMap((item:any)=>item.requirements).filter((r:any)=>r.state==='MISSING').length,3);
  assert.ok(!JSON.stringify(pan.currentAttempt).includes('screeningAnswers'));
  assert.ok(!JSON.stringify(pan.currentAttempt).includes('confidence'));
  const {mock}=await import('node:test');
  mock.timers.enable({apis:['Date'],now:new Date(Date.now()+14400000)});
  try {
   const expired=await request(`/verification-exceptions/${review.id}`,undefined,200,token(manager.id,'ADMIN'));
   assert.deepEqual({available:expired.captureStatus.available,reason:expired.captureStatus.reason,canExtend:expired.captureStatus.canExtend},{available:false,reason:'DEADLINE_PASSED',canExtend:false});
  } finally {mock.timers.reset();}
 }
 // Replay the actual low-confidence WRONG_ITEM response through the real
 // Clef adapter, HTTP endpoint, persistence and submission guards.
 const httpFetch=globalThis.fetch;
 const priorEvaluate=BufferedClefProvider.prototype.evaluate;
 const originalEnvironment={account:process.env.CLOUDFLARE_ACCOUNT_ID,token:process.env.CLOUDFLARE_API_TOKEN,model:process.env.CLEF_MODEL,screening:process.env.CLEF_SCREENING_CONFIDENCE_THRESHOLD};
 Object.assign(process.env,{CLOUDFLARE_ACCOUNT_ID:'a'.repeat(32),CLOUDFLARE_API_TOKEN:'isolated-wrong-object-replay',CLEF_MODEL:'clef',CLEF_SCREENING_CONFIDENCE_THRESHOLD:'.9'});
 let wrongObject=true,confidence=.8758,replayedCalls=0;
 let cleanlinessCategory='CLEAN', objectCategory='MATCH';
 BufferedClefProvider.prototype.evaluate=evaluateWithClef;
 globalThis.fetch=(async(input:any,options:any)=>{
  if(!String(input).startsWith('https://api.cloudflare.com/'))return httpFetch(input,options);
  replayedCalls++;
  const body=JSON.parse(options.body);
  const answers=Object.fromEntries(Object.entries(body.questions).map(([key,value]:[string,any])=>{
   const choice=key==='object_match'?(wrongObject?'NOT_MATCH':objectCategory):key==='originality'?'DIRECT':key.startsWith('visible_')?(wrongObject?'MISSING':'VISIBLE'):(wrongObject?'NEEDS_ATTENTION':cleanlinessCategory);
   const keys=Object.keys(value.criteria);
   let answer:any={type:'choice',choice,confidence:wrongObject?.98:.1,probabilities:Object.fromEntries(keys.map(k=>[k,k===choice ? .98 : .02/(keys.length-1)]))};
   if(wrongObject&&key==='object_match')answer={type:'choice',choice:'NOT_MATCH',confidence,probabilities:{MATCH:.014,NOT_SURE:.0288,NOT_MATCH:.9572}};
   if(wrongObject&&key==='originality')answer={type:'choice',choice:'DIRECT',confidence:.6446,probabilities:{DIRECT:.8686,UNCERTAIN:.0635,SCREEN_RECAPTURE:.0679}};
   return[key,answer];
  }));
  return new Response(JSON.stringify({success:true,result:{model:'clef',answers}}));
 }) as typeof fetch;
 try{
  staff=await prisma.staff.create({data:{companyId:company.id,locationId:location.id,name:'Wrong-object replay staff',email:randomUUID()+'@test.invalid',password:'isolated-test-password'}});
  staffToken=token(staff.id,'STAFF');
  await prisma.attendance.create({data:{staffId:staff.id,locationId:location.id,date:now,expectedStart:now,expectedEnd:end,checkInTime:now,status:'CHECKED_IN'}});
  const configured=await createArea({id:manager.id,companyId:company.id,role:'ADMIN'},location.id,{name:'Recorded wrong-object regression',roomType:'WASHROOM',counts:[{fixtureType:'INDIAN_TOILET',count:1}]});
  const {task,s}=await newTask('Recorded wrong-object regression',configured);
  let current=s;const beforeCloud=cloudCalls;
  for(const value of [.8758,.4,.1,.8999]){
   confidence=value;const result=await(await photo(current)).upload();
   assert.equal(result.state,'RECAPTURE_REQUIRED');assert.equal(result.reasonCode,'WRONG_ITEM');assert.equal(result.storage,'discarded');
   assert.match(result.instructions,/does not show the Indian toilet/);assert.match(result.instructions,/take another photo/);
   assert.equal(await prisma.verificationException.count({where:{taskInstanceId:task.id}}),0);
   assert.equal(await prisma.verificationIssue.count({where:{exception:{taskInstanceId:task.id}}}),0);
   await request(`/task-instance/${task.id}/complete`,{},409);
   const manifest=await request(`/task-instance/${task.id}/verification`);
   assert.equal(manifest.items[0].requirements[0].state,'RECAPTURE_REQUIRED');
   current=await request(`/capture-session/${current.id}/renew`,{requestId:randomUUID(),areaQr:signTaskQr(task,configured),deviceId:'http-test-device',clientBootId:'http-test-boot',clientTime:new Date().toISOString(),location:{latitude:24.8607,longitude:67.0011,accuracy:3,sampledAt:new Date().toISOString()}},201);
  }
  assert.equal(cloudCalls,beforeCloud);assert.equal(replayedCalls,4);
  wrongObject=false;const corrected=await(await photo(current)).upload();
  assert.equal(corrected.state,'REVIEW_REQUIRED','valid objects retain the separate cleanliness release gate');
  assert.equal(corrected.reasonCode,'AUTO_PASS_NOT_VALIDATED');assert.equal(corrected.storage,'cloud');
  await request(`/task-instance/${task.id}/complete`,{});
  for (const [category, object, state, reason] of [
   ['DIRTY','MATCH','CLEANING_REQUIRED','CLEANING_REQUIRED'],
   ['NEEDS_ATTENTION','MATCH','REVIEW_REQUIRED','CANNOT_ASSESS'],
   ['CLEAN','NOT_SURE','REVIEW_REQUIRED','OBJECT_UNCERTAIN'],
  ]) {
   cleanlinessCategory=category!;objectCategory=object!;
   staff=await prisma.staff.create({data:{companyId:company.id,locationId:location.id,name:'Category replay staff',email:randomUUID()+'@test.invalid',password:'isolated-test-password'}});
   staffToken=token(staff.id,'STAFF');
   await prisma.attendance.create({data:{staffId:staff.id,locationId:location.id,date:now,expectedStart:now,expectedEnd:end,checkInTime:now,status:'CHECKED_IN'}});
   const {s:categorySession}=await newTask('Model category '+category+' '+object,configured);
   const callsBefore=replayedCalls;
   const result=await(await photo(categorySession)).upload();
   assert.equal(result.state,state);assert.equal(result.reasonCode,reason);
   assert.equal(replayedCalls,callsBefore+1,'all checks use one provider request');
   const attempt=await prisma.verificationAttempt.findFirstOrThrow({where:{sessionId:categorySession.id}});
   const metadata=(attempt.cleanlinessResult as any).metadata;
   assert.equal(metadata.decisionMode,'MODEL_CATEGORIES_V1');
   assert.equal(metadata.screeningAnswers.cleanliness.surface_0.choice,category);
   assert.equal(metadata.screeningAnswers.objectMatch.choice,object);
  }
 }finally{
  globalThis.fetch=httpFetch;BufferedClefProvider.prototype.evaluate=priorEvaluate;
  for(const[key,value]of Object.entries({CLOUDFLARE_ACCOUNT_ID:originalEnvironment.account,CLOUDFLARE_API_TOKEN:originalEnvironment.token,CLEF_MODEL:originalEnvironment.model,CLEF_SCREENING_CONFIDENCE_THRESHOLD:originalEnvironment.screening}))if(value===undefined)delete process.env[key];else process.env[key]=value;
 }
 assert.equal(await prisma.verificationWorkerHeartbeat.count(),0);
 console.log('PASS direct HTTP: per-task QR uniqueness, stability, start and finish isolation, shared-code rejection and scoped owner/manager access; model categories CLEAN/DIRTY/NEEDS_ATTENTION and NOT_SURE persist and route correctly at diagnostic confidence .1; recorded below-threshold WRONG_ITEM responses are rejected by the real adapter without cloud storage, manager review or submission; four consecutive wrong-object retakes produce no manager case, no issue and no cloud upload; separate Indian and Western inventory creates correct task snapshots and one/two photo steps; legacy toilet tasks preserved; object/view/cleanliness gates, upload/refresh/polling corrections, AI/storage retry, access control and task submission.');
}finally{
 await new Promise<void>((resolve,reject)=>server.close(e=>e?reject(e):resolve()));await prisma.$disconnect();
 const cleanup=new pg.Client({connectionString:source});await cleanup.connect();await cleanup.query(`DROP DATABASE "${database}" WITH (FORCE)`);await cleanup.end();
}
