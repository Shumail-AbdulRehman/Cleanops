import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
const source=process.env.VERIFICATION_TEST_DATABASE_URL;
if(!source)throw new Error('Isolated local test URL required');
const url=new URL(source);
if(url.hostname!=='127.0.0.1'||!url.pathname.startsWith('/priv_verification_test'))throw new Error('Only isolated local test DB allowed');
const database=`priv_verification_test_mobile_${Date.now()}`;
const admin=new pg.Client({connectionString:source});await admin.connect();await admin.query(`CREATE DATABASE "${database}"`);await admin.end();
url.pathname='/'+database;process.env.DATABASE_URL=url.toString();process.env.DIRECT_URL=url.toString();process.env.NODE_ENV='test';
Object.assign(process.env,{ACCESS_TOKEN_SECRET:'isolated-mobile-access',REFRESH_TOKEN_SECRET:'isolated-mobile-refresh'});
const db=new pg.Client({connectionString:url.toString()});await db.connect();
const root=new URL('../prisma/migrations/',import.meta.url);
for(const name of (await readdir(root)).filter(n=>/^\d/.test(n)).sort())await db.query(await readFile(new URL(`${name}/migration.sql`,root),'utf8'));
await db.end();
const {prisma}=await import('../src/prisma/prisma.js');
const {getZonedDayRange}=await import('../src/utils/dateTime.js');
const {staffMobileTasks}=await import('../src/services/mobile/staffMobile.service.js');
const {generateAccessToken}=await import('../src/utils/auth.js');
const company=await prisma.company.create({data:{name:'Mobile performance'}});
const foreign=await prisma.company.create({data:{name:'Foreign'}});
const siteData={name:'Site',address:'Test',latitude:'0',longitude:'0',timezone:'Asia/Karachi'};
const site=await prisma.location.create({data:{...siteData,companyId:company.id}});
const other=await prisma.location.create({data:{...siteData,companyId:foreign.id}});
async function makeStaff(companyId:number,locationId:number){return prisma.staff.create({data:{name:'Staff',email:randomUUID()+'@test.invalid',password:'IsolatedOnly123!',companyId,locationId}});}
const worker=await makeStaff(company.id,site.id),second=await makeStaff(company.id,site.id),foreignWorker=await makeStaff(foreign.id,other.id);
const area=await prisma.area.create({data:{name:'Room',roomType:'WASHROOM',status:'ACTIVE',locationId:site.id}});
const foreignArea=await prisma.area.create({data:{name:'Foreign room',roomType:'WASHROOM',status:'ACTIVE',locationId:other.id}});
const now=new Date(),{start,end}=getZonedDayRange(now,site.timezone),yesterday=new Date(+start-86400000);
const base={staffId:worker.id,locationId:site.id,date:start,shiftStart:new Date(+start+3600000),shiftEnd:end,verificationVersion:2,areaId:area.id,inventoryVersion:1,policySnapshot:{version:1},areaNameSnapshot:"Room",verificationDeadline:end,uploadDeadline:new Date(+end+3600000)};
const metadata='x'.repeat(5000);
const today=await prisma.taskInstance.createManyAndReturn({data:Array.from({length:70},(_,i)=>({...base,title:'Today '+i,staffSubmittedAt:i<40?now:null,status:i<40?'IN_PROGRESS':'PENDING',proofImageUrls:['https://example.invalid/evidence/'+metadata],policySnapshot:{privateMetadata:metadata}}))});
const history=await prisma.taskInstance.createManyAndReturn({data:Array.from({length:120},(_,i)=>({...base,title:'Unfinished '+i,date:yesterday,shiftStart:new Date(+yesterday+3600000),status:i===0?'IN_PROGRESS':'PENDING'}))});
await prisma.taskAssignment.createMany({data:[...today.filter(t=>!t.staffSubmittedAt),...history].map(t=>({taskInstanceId:t.id,staffId:worker.id,status:t.status==='IN_PROGRESS'?'STARTED':'ASSIGNED'}))});
await prisma.taskInstance.createMany({data:[
 {...base,title:'Other staff',staffId:second.id},
 {...base,title:'Foreign tenant',staffId:foreignWorker.id,locationId:other.id,areaId:foreignArea.id},
 {...base,title:'Foreign location',locationId:other.id,areaId:foreignArea.id},
 {...base,title:'Inactive',isActive:false},
 {...base,title:'Old no assignment',date:yesterday},
 {...base,title:'Old submitted',date:yesterday,staffSubmittedAt:now},
 {...base,title:'Old cancelled',date:yesterday,status:'CANCELLED'},
]});
await prisma.attendance.createMany({data:Array.from({length:35},(_,i)=>({staffId:worker.id,locationId:site.id,date:new Date(+start-i*86400000),expectedStart:new Date(+start-i*86400000),expectedEnd:new Date(+end-i*86400000),checkInImage:'https://example.invalid/'+metadata,status:i===0?'CHECKED_IN':'CHECKED_OUT',checkInTime:new Date(+start-i*86400000),checkOutTime:i===0?null:new Date(+end-i*86400000)}))});
const {default:express}=await import('express');
const {default:mobile}=await import('../src/routes/staffMobile.route.js');
const {default:tasks}=await import('../src/routes/taskInstance.route.js');
const {default:verification}=await import('../src/routes/verification.route.js');
const {default:attendance}=await import('../src/routes/attendance.route.js');
const {default:notifications}=await import('../src/routes/staffNotification.route.js');
const app=express();app.use(express.json());app.use((req,_res,next)=>{req.cookies={};next();});
app.use('/api/staff/mobile',mobile);app.use('/api',verification);app.use('/api/task-instance',tasks);app.use('/api/attendance',attendance);app.use('/api/staff-notifications',notifications);
app.use((error:any,_req:any,res:any,_next:any)=>res.status(error.statusCode??500).json({message:error.message}));
const server=app.listen(0,'127.0.0.1');await new Promise<void>(resolve=>server.once('listening',resolve));const baseUrl=`http://127.0.0.1:${(server.address() as {port:number}).port}/api`;
const token=(s:typeof worker)=>generateAccessToken(s,'STAFF');
async function call(path:string,access=token(worker)){const r=await fetch(baseUrl+path,{headers:{Authorization:`Bearer ${access}`}});return {status:r.status,text:await r.text()};}
const json=(r:{text:string})=>JSON.parse(r.text).data;
try{
 const first=await call('/staff/mobile/tasks');assert.equal(first.status,200);const firstPage=json(first);
 assert.equal(firstPage.tasks.length,50);assert.ok(firstPage.nextCursor);assert.deepEqual(firstPage.counts,{total:190,submitted:40,pending:149,inProgress:1});assert.equal(firstPage.tasks[0].id,history[0]!.id);
 assert.ok(firstPage.tasks.every((t:any)=>!('policySnapshot' in t)&&!('assignments' in t)&&!('referenceImages' in t)&&!('completionAttempts' in t)&&t.proofImageUrls.length===0));
 const all=[...firstPage.tasks];let cursor=firstPage.nextCursor;
 while(cursor){const r=await call('/staff/mobile/tasks?cursor='+encodeURIComponent(cursor));assert.equal(r.status,200);const page=json(r);assert.deepEqual(page.counts,firstPage.counts);all.push(...page.tasks);cursor=page.nextCursor;}
 assert.equal(all.length,190);assert.equal(new Set(all.map(t=>t.id)).size,190);
 assert.deepEqual(new Set(all.map(t=>t.id)),new Set([...today,...history].map(t=>t.id)));
 assert.ok(all.slice(-40).every(t=>t.status==='COMPLETED'&&t.completionOutcome===null));
 for(const path of ['/staff/mobile/tasks?cursor=not-json','/staff/mobile/tasks?limit=51','/staff/mobile/tasks?limit=-1'])assert.equal((await call(path)).status,400);
 await assert.rejects(()=>staffMobileTasks({id:worker.id,companyId:company.id,role:'STAFF'},{cursor:firstPage.nextCursor},new Date(+now+86400000)),/day changed/);
 const secondPage=json(await call('/staff/mobile/tasks',token(second)));assert.equal(secondPage.counts.total,1);assert.ok(secondPage.tasks.every((t:any)=>t.title==='Other staff'));
 const foreignPage=json(await call('/staff/mobile/tasks',token(foreignWorker)));assert.equal(foreignPage.counts.total,1);
 const manager=await prisma.manager.create({data:{name:'Manager',email:randomUUID()+'@test.invalid',password:'IsolatedOnly123!',companyId:company.id}});
 assert.equal((await call('/staff/mobile/tasks',generateAccessToken(manager,'MANAGER'))).status,403);
 assert.equal((await call('/staff/mobile/tasks','invalid')).status,401);
 const cards=json(await call('/staff/mobile/attendance'));assert.equal(cards.length,30);assert.ok(cards.every((r:any)=>!('checkInImage' in r)&&!('checkOutImage' in r)));assert.equal(cards[0].status,'CHECKED_IN');
 const oldAttendance=await call('/attendance/my');assert.ok(Buffer.byteLength(JSON.stringify(cards))<Buffer.byteLength(oldAttendance.text)/5);
 const detail=json(await call(`/task-instance/${history[0]!.id}?view=mobile`));assert.equal(detail.id,history[0]!.id);assert.ok(!('assignments' in detail)&&!('policySnapshot' in detail));
 const count=json(await call('/staff-notifications/unread-count'));assert.equal(count.unreadCount,await prisma.staffNotification.count({where:{staffId:worker.id,companyId:company.id,readAt:null}}));assert.deepEqual(Object.keys(count),['unreadCount']);
 await prisma.staff.update({where:{id:second.id},data:{isActive:false}});assert.equal((await call('/staff/mobile/tasks',token(second))).status,403);
 async function oldLoad(){let bytes=0,calls=0;const started=performance.now();await Promise.all([
  (async()=>{const r=await call(`/task-instance/staff/${worker.id}/today`);assert.equal(r.status,200);bytes+=Buffer.byteLength(r.text);calls++;})(),
  (async()=>{let next:number|null=null;do{const r=await call('/task-instance/staff/me/verification-work'+(next?'?cursor='+next:''));assert.equal(r.status,200);bytes+=Buffer.byteLength(r.text);calls++;next=json(r).nextCursor;}while(next);})(),
 ]);return {bytes,requests:calls,ms:performance.now()-started};}
 const before=[],after=[];
 for(let i=0;i<6;i++){const b=await oldLoad();const started=performance.now(),r=await call('/staff/mobile/tasks');assert.equal(r.status,200);const a={bytes:Buffer.byteLength(r.text),requests:1,ms:performance.now()-started};if(i){before.push(b);after.push(a);}}
 const median=(rows:any[],key:string)=>rows.map(r=>r[key]).sort((a,b)=>a-b)[Math.floor(rows.length/2)];
 const baseline={requests:before[0]!.requests,bytes:before[0]!.bytes,medianMs:Math.round(median(before,'ms')*100)/100};
 const optimized={requests:1,bytes:after[0]!.bytes,medianMs:Math.round(median(after,'ms')*100)/100};
 assert.equal(baseline.requests,4);assert.ok(optimized.bytes<baseline.bytes/5);
 console.log(JSON.stringify({fixture:'70 current-day + 120 unfinished tasks; 5 measured runs after warmup; local HTTP/PostgreSQL',baseline,optimized,payloadReductionPercent:Math.round((1-optimized.bytes/baseline.bytes)*100)},null,2));
 console.log('PASS: paginated task union, deterministic tied-date cursors, whole-feed counts, summary-only payloads, timezone rollover, scoped attendance/count, task detail and tenant/role/inactive-account authorization. No real push sent.');
}finally{await new Promise<void>((resolve,reject)=>server.close(e=>e?reject(e):resolve()));await prisma.$disconnect();}
