import "dotenv/config";
import assert from "node:assert/strict";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { performance } from "node:perf_hooks";
// Real HTTP + isolated PostgreSQL; AI/storage are controlled, never vendor calls.
// Inject round-trip latency to expose chatty SQL independently of AI latency.
const resumeAfterUpload = process.env.PHOTO_DEBUG_RESUME_AFTER_UPLOAD === "true";
const delayMs = Number(process.env.PHOTO_DEBUG_QUERY_DELAY_MS ?? 0);
assert.ok(Number.isFinite(delayMs) && delayMs >= 0 && delayMs <= 200);
type Trace = { path: string; queries: number; sqlMs: number; statements: Record<string, number>; events: unknown[] };
// Requests are strictly sequential. Prisma adapter callbacks may leave async
// context, so keep the active trace until the HTTP response finishes.
let activeTrace: Trace | undefined;
const traces: Array<Trace & { durationMs: number }> = [];
const originalQuery = pg.Client.prototype.query;
(pg.Client.prototype as any).query = function(...args: any[]) {
  const trace = activeTrace;
  if (!trace) return (originalQuery as any).apply(this, args);
  const sql = String(typeof args[0] === 'string' ? args[0] : args[0]?.text ?? '');
  const key = sql.replace(/\$\d+/g, '?').replace(/\s+/g, ' ').slice(0, 160);
  trace.queries++; trace.statements[key] = (trace.statements[key] ?? 0) + 1;
  const started = performance.now(), self = this;
  const last = args.length - 1;
  if (typeof args[last] === 'function') {
    const callback = args[last];
    args[last] = (...result: any[]) => { trace.sqlMs += performance.now() - started; callback(...result); };
    if (delayMs) { setTimeout(() => (originalQuery as any).apply(self, args), delayMs); return; }
    return (originalQuery as any).apply(self, args);
  }
  return new Promise(resolve => setTimeout(resolve, delayMs)).then(() => (originalQuery as any).apply(self, args))
    .finally(() => { trace.sqlMs += performance.now() - started; });
};
const originalInfo = console.info;
console.info = (...args: any[]) => {
  if (typeof args[0] === 'string' && args[0].startsWith('{')) {
    try { const event = JSON.parse(args[0]); if (event.type === 'VERIFICATION_TIMING') activeTrace?.events.push(event); } catch {}
  }
  originalInfo(...args);
};
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
const {BufferedClefProvider}=await import('../src/services/verification-v2/bufferedPhoto.provider.js');
const {default:cloudinary}=await import('../src/utils/cloudinary.js');
const {default:sharp}=await import('sharp');
const {createHash}=await import('node:crypto');
const {Writable}=await import('node:stream');
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
const app=express();
app.use((req,res,next)=>{
 const trace:Trace={path:req.method+' '+req.path,queries:0,sqlMs:0,statements:{},events:[]};
 const started=performance.now();
 activeTrace=trace;
 res.once('finish',()=>{traces.push({...trace,durationMs:Math.round(performance.now()-started)});activeTrace=undefined;});
 next();
});
app.use(express.json());app.use((req,_res,next)=>{req.cookies={};next();});
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
 await request(`/task-instance/${task.id}/start`,{areaQr:signTaskQr(task,targetArea)});
 await request(`/task-instance/${task.id}/complete`,{},409);
 const s=await request(`/task-instance/${task.id}/capture-sessions`,{requestId:randomUUID(),areaQr:signTaskQr(task,targetArea),deviceId:'http-test-device',clientBootId:'http-test-boot',clientTime:new Date().toISOString(),location:{latitude:24.8607,longitude:67.0011,accuracy:3,sampledAt:new Date().toISOString()}},201);
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

try {
 const report:unknown[]=[];
 for (const kind of ['clean','dirty'] as const) {
  scenario=kind;
  const {task,s}=await newTask('Latency '+kind), p=await photo(s);
  const start=traces.length;
  const result=await p.upload();
  assert.equal(result.state,kind==='clean'?'REVIEW_REQUIRED':'CLEANING_REQUIRED');
  // Match the current phone refresh; optionally include the old resume request.
  await request(`/task-instance/${task.id}/verification`);
  if(resumeAfterUpload)await request(`/capture-session/${s.id}/resume`,{deviceId:'http-test-device',clientBootId:'http-test-boot',pendingCaptureIds:[]});
  const measured=traces.slice(start);
  report.push({kind,requests:measured,totalMs:measured.reduce((n,t)=>n+t.durationMs,0),sqlQueries:measured.reduce((n,t)=>n+t.queries,0)});
  // Lost-response recovery must not incur another AI or storage operation.
  const beforeAi=aiCalls,beforeCloud=cloudCalls;
  await p.upload();
  assert.equal(aiCalls,beforeAi);assert.equal(cloudCalls,beforeCloud);
 }
 const output={mode:'real-http-isolated-postgresql-controlled-ai-storage',injectedQueryDelayMs:delayMs,resumeAfterUpload,aiDelayMs:30,report};
 const destination=process.env.PHOTO_DEBUG_REPORT_PATH;
 if(destination)await writeFile(destination,JSON.stringify(output,null,2));
 console.log(JSON.stringify({injectedQueryDelayMs:delayMs,summary:report.map((entry:any)=>({kind:entry.kind,totalMs:entry.totalMs,sqlQueries:entry.sqlQueries,requests:entry.requests.map((r:any)=>({path:r.path,durationMs:r.durationMs,queries:r.queries,sqlMs:Math.round(r.sqlMs)}))}))},null,2));
} finally {
 await new Promise<void>(resolve=>server.close(()=>resolve()));
 await prisma.$disconnect();
 const cleanup=new pg.Client({connectionString:source});await cleanup.connect();
 await cleanup.query(`DROP DATABASE "${database}" WITH (FORCE)`);await cleanup.end();
}
