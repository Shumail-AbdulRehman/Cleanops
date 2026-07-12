import assert from 'node:assert/strict';
import {randomUUID,randomBytes} from 'node:crypto';
import {readFile,readdir,mkdtemp,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import pg from 'pg';
// This suite creates a fresh database on an explicitly local PostgreSQL server.
// It never resets/drops the supplied database and never loads the customer URL.
const source=process.env.VERIFICATION_TEST_DATABASE_URL;
if(!source)throw new Error('Set VERIFICATION_TEST_DATABASE_URL to isolated local PostgreSQL');
const url=new URL(source);
if(!['127.0.0.1','localhost','[::1]'].includes(url.hostname)||!url.pathname.startsWith('/priv_verification_test'))throw new Error('Integration tests require local priv_verification_test database');
const database=`priv_verification_test_${Date.now()}_${Math.floor(Math.random()*10000)}`;
const admin=new pg.Client({connectionString:source});await admin.connect();
await admin.query(`CREATE DATABASE "${database}"`);await admin.end();
url.pathname=`/${database}`;process.env.DATABASE_URL=url.toString();process.env.NODE_ENV="test";
const client=new pg.Client({connectionString:url.toString()});await client.connect();
const migrations=fileURLToPath(new URL('../prisma/migrations/',import.meta.url));
const names=(await readdir(migrations)).filter(n=>/^\d/.test(n)).sort();
for(const name of names.filter(n=>n<'20261004'))await client.query(await readFile(`${migrations}/${name}/migration.sql`,'utf8'));
const company=(await client.query(`INSERT INTO "Company" (name,"updatedAt") VALUES ('Historical migration fixture',NOW()) RETURNING id`)).rows[0].id;
const location=(await client.query(`INSERT INTO "Location" (name,address,"companyId",latitude,longitude,"updatedAt") VALUES ('Historical room','test',$1,'0','0',NOW()) RETURNING id`,[company])).rows[0].id;
const oldTask=(await client.query(`INSERT INTO "TaskInstance" (title,date,"shiftStart","shiftEnd",status,"locationId","updatedAt") VALUES ('Historical completion',NOW(),NOW(),NOW(),'COMPLETED',$1,NOW()) RETURNING id`,[location])).rows[0].id;
for(const name of names.filter(n=>n>='20261004'))await client.query(await readFile(`${migrations}/${name}/migration.sql`,'utf8'));
assert.deepEqual((await client.query(`SELECT "verificationVersion","completionOutcome" FROM "TaskInstance" WHERE id=$1`,[oldTask])).rows[0],{verificationVersion:1,completionOutcome:'LEGACY_RECORDED'});
const {prisma}=await import('../src/prisma/prisma.js');
const {claimVerificationJob,publishJobResult,failVerificationJob,enqueueVerificationJob}=await import('../src/services/verification-v2/jobQueue.service.js');
const manager=await prisma.manager.create({data:{name:'Admin',email:`${randomUUID()}@test.invalid`,password:'test-only',role:'ADMIN',companyId:company}});
const actor={id:manager.id,role:'ADMIN' as const,companyId:company};
const staff=await prisma.staff.create({data:{name:'Worker',email:`${randomUUID()}@test.invalid`,password:'test-only',companyId:company,locationId:location}});
const area=await prisma.area.create({data:{locationId:location,name:'Test washroom',roomType:'WASHROOM',status:'ACTIVE'}});
const task=await prisma.taskInstance.create({data:{title:'Queue task',locationId:location,staffId:staff.id,date:new Date(),shiftStart:new Date(),shiftEnd:new Date(),areaId:area.id,verificationVersion:2,areaNameSnapshot:area.name,inventoryVersion:1,policySnapshot:{version:1},verificationDeadline:new Date(),uploadDeadline:new Date()}});
const assignment=await prisma.taskAssignment.create({data:{taskInstanceId:task.id,staffId:staff.id}});
const session=await prisma.captureSession.create({data:{taskInstanceId:task.id,areaId:area.id,staffId:staff.id,assignmentId:assignment.id,assignmentEpoch:0,deviceId:'test',qrVersion:1,policyVersion:1,captureExpiresAt:new Date(Date.now()+600000),uploadExpiresAt:new Date(Date.now()+900000),presenceStatus:'ACCEPTABLE',locationCheck:{},serverTimeAnchor:new Date(),clientBootId:'test'}});
async function attempt(hash='a'.repeat(64)){const slot=await prisma.captureSlot.create({data:{sessionId:session.id,contextKey:'entrance',sequence:1,nonceHash:'hash',expiresAt:session.captureExpiresAt}});return prisma.verificationAttempt.create({data:{contextKey:'entrance',sessionId:session.id,slotId:slot.id,staffId:staff.id,assignmentEpoch:0,clientCaptureId:randomUUID(),claimedCapturedAt:new Date(),anchoredElapsedMs:0n,timingEvidence:'UNCERTAIN',committedHash:hash}});}
const attempts=await Promise.all(Array.from({length:5},attempt));
await prisma.$transaction(async tx=>{for(const a of attempts)await enqueueVerificationJob(tx,{companyId:company,attemptId:a.id,stage:'COVERAGE',evaluatorVersion:'v1'});});
const claims=await Promise.all(Array.from({length:5},()=>claimVerificationJob()));
assert.equal(claims.filter(Boolean).length,2,'at most two jobs per company across concurrent claims');
const first=claims.find(Boolean)!;
assert.equal(await publishJobResult(first,{result:'ok'}),true);
assert.equal(await publishJobResult(first,{result:'changed'}),false,'result publication is exactly once');
const second=claims.filter(Boolean)[1]!;
await prisma.verificationJob.update({where:{id:second.id},data:{leaseUntil:new Date(Date.now()-1)}});
assert.equal(await publishJobResult(second,{result:'stale'}),false,'expired leases cannot publish');
const reclaimed=await claimVerificationJob();assert.ok(reclaimed);assert.equal(reclaimed.id,second.id);assert.notEqual(reclaimed.leaseToken,second.leaseToken);
assert.equal(await failVerificationJob(second),false,'previous lease owner cannot fail new owner work');
assert.equal(await failVerificationJob(reclaimed),true);
const retry=await prisma.verificationJob.findUniqueOrThrow({where:{id:reclaimed.id}});assert.equal(retry.state,'RETRY_WAIT');
assert.ok(+retry.availableAt>Date.now());
const foreignCompany=await prisma.company.create({data:{name:'Other tenant'}});
await assert.rejects(()=>prisma.verificationJob.create({data:{companyId:foreignCompany.id,attemptId:attempts[0]!.id,stage:'CROSS_TENANT',evaluatorVersion:'v1'}}));
await assert.rejects(()=>prisma.captureSession.create({data:{taskInstanceId:oldTask,areaId:area.id,staffId:staff.id,assignmentId:assignment.id,assignmentEpoch:0,deviceId:'x',qrVersion:1,policyVersion:1,captureExpiresAt:new Date(),uploadExpiresAt:new Date(),presenceStatus:'ACCEPTABLE',locationCheck:{},serverTimeAnchor:new Date(),clientBootId:'x'}}));
console.log('PASS: restored legacy migration/backfill, tenant/session bindings, concurrent queue caps, lease expiry, stale workers, retries and exactly-once publication');

const {createArea,bulkItems,updateItem,areaDetail}=await import('../src/services/area.service.js');
const {permanentlyDelete}=await import('../src/services/deletion.service.js');
const {archiveRetainedEntity}=await import('../src/services/verification-v2/retention.service.js');
const inventory=await createArea(actor,location,{name:'Inventory fixtures',roomType:'WASHROOM',counts:[{fixtureType:'TOILET',count:2}]});
const before=await areaDetail(actor,inventory.id);assert.equal(before.items.length,2);
await assert.rejects(()=>bulkItems(actor,inventory.id,99,[{fixtureType:'SINK',count:1}]));
assert.equal((await areaDetail(actor,inventory.id)).items.length,2,'stale edits roll back');
await updateItem(actor,inventory.id,before.items[0]!.id,{expectedInventoryVersion:1,status:'RETIRED'});
await bulkItems(actor,inventory.id,2,[{fixtureType:'TOILET',count:1}]);
const after=await areaDetail(actor,inventory.id);assert.equal(after.items[2]!.stableCode,'TOILET-03');
await assert.rejects(()=>updateItem(actor,inventory.id,before.items[0]!.id,{expectedInventoryVersion:3,status:'ACTIVE'}));
await assert.rejects(()=>updateItem(actor,inventory.id,999999,{expectedInventoryVersion:3,displayName:'Foreign fixture'}));
const outboxBefore=await prisma.deletedMedia.count();
await assert.rejects(()=>permanentlyDelete('location',location,actor));
assert.equal(await prisma.deletedMedia.count(),outboxBefore,'deletion protection executes before media enqueue');
const sharp=(await import('sharp')).default;
const photo=await sharp({create:{width:600,height:600,channels:3,background:'#888888'}}).jpeg().toBuffer();
const {sha256}=await import('../src/services/verification-v2/quality.service.js');
const {storeReservedEvidence,storeStandardEvidence,evidenceContent}=await import('../src/services/verification-v2/evidence.service.js');
const reserved=await attempt(sha256(photo));const stored=new Map<string,string>();let uploads=0;
let lostAcknowledgement=true;
const io={store:async(bytes:Buffer,id:string,hash:string)=>{if(stored.has(id)){assert.equal(stored.get(id),hash);}else{uploads++;stored.set(id,hash);}if(lostAcknowledgement&&id.endsWith('/review')){lostAcknowledgement=false;throw new Error('Simulated storage response lost');}return {asset_id:id};},read:async()=>photo};
const staffActor={id:staff.id,companyId:company,role:'STAFF' as const};
await assert.rejects(()=>storeReservedEvidence(staffActor,reserved.id,photo,io));
assert.equal((await prisma.verificationAttempt.findUniqueOrThrow({where:{id:reserved.id}})).mediaAssetId,null);
const receipt=await storeReservedEvidence(staffActor,reserved.id,photo,io);
assert.equal(receipt.state,'RECEIVED');assert.equal(uploads,2,'original and stripped review derivative stored privately');
const retryReceipt=await storeReservedEvidence(staffActor,reserved.id,photo,io);assert.equal(retryReceipt.assetId,receipt.assetId);assert.equal(uploads,2);
assert.equal(await prisma.verificationJob.count({where:{attemptId:reserved.id,stage:'QUALITY'}}),1);
await assert.rejects(()=>storeReservedEvidence(staffActor,reserved.id,Buffer.from('different bytes'),io));
await assert.rejects(()=>evidenceContent(actor,receipt.assetId,'review',io));
await prisma.evidenceAsset.update({where:{id:receipt.assetId},data:{privacyState:'SAFE'}});
assert.equal((await evidenceContent(staffActor,receipt.assetId,'review',io)).bytes.length,photo.length);
await assert.rejects(()=>evidenceContent(staffActor,receipt.assetId,'original',io));
assert.equal((await evidenceContent(actor,receipt.assetId,'original',io)).bytes.length,photo.length);
await assert.rejects(()=>prisma.evidenceAsset.delete({where:{id:receipt.assetId}}));
await archiveRetainedEntity('staff',staff.id,actor);
assert.equal((await prisma.staff.findUniqueOrThrow({where:{id:staff.id}})).isActive,false);
assert.equal((await prisma.captureSession.findUniqueOrThrow({where:{id:session.id}})).state,'REVOKED');
assert.equal(await prisma.verificationAttempt.count({where:{sessionId:session.id}}),6,'archive preserves attempts');
console.log('PASS: inventory version conflicts, stable replacement codes, cross-area edits, deletion outbox protection and archive preservation');

const {configureTemplateInventory,validateInventorySelection,createTaskInstanceWithSnapshot,repairUnstartedInventoryTask}=await import('../src/services/verification-v2/inventorySnapshot.service.js');
const {getZonedDayRange}=await import('../src/utils/dateTime.js');
const now=new Date();const base=getZonedDayRange(now,'Asia/Karachi').start;
const worker=await prisma.staff.create({data:{name:'Assigned worker',email:`${randomUUID()}@test.invalid`,password:'test-only',companyId:company,locationId:location,shiftStart:new Date(+base+8*3600000),shiftEnd:new Date(+base+18*3600000)}});
// Reproduce the hosted-database delay in this suite's fresh local database only.
const {createTaskTemplate}=await import('../src/controllers/taskTemplate.controller.js');
const scheduleRequest=(title:string)=>({user:actor,body:{title,locationId:location,areaId:inventory.id,inventorySelection:'ALL',selectedItems:[],expectedInventoryVersion:3,shiftStart:new Date(+base+16*3600000),shiftEnd:new Date(+base+17*3600000),effectiveDate:new Date(+base+7*86400000),recurringType:'ONCE'}});
await client.query(`CREATE FUNCTION test_slow_schedule() RETURNS trigger LANGUAGE plpgsql AS $$
 BEGIN IF NEW.title = 'Slow inventory schedule regression' THEN PERFORM pg_sleep(6); END IF; RETURN NEW; END $$;
 CREATE TRIGGER test_slow_schedule BEFORE INSERT ON "TaskTemplate" FOR EACH ROW EXECUTE FUNCTION test_slow_schedule();`);
let savedSchedule:{data:{id:number}}|undefined;
const scheduleResponse={status(code:number){assert.equal(code,201);return this;},json(body:typeof savedSchedule){savedSchedule=body;return this;}};
try {
 const started=Date.now();
 await createTaskTemplate(scheduleRequest('Slow inventory schedule regression') as any,scheduleResponse as any);
 assert.ok(Date.now()-started>=6000,'save must survive a delay beyond Prisma\'s default timeout');
 assert.ok(savedSchedule);
 const saved=await prisma.taskTemplate.findUniqueOrThrow({where:{id:savedSchedule.data.id},include:{area:true}});
 assert.equal(saved.verificationVersion,2);assert.equal(saved.setupStatus,'READY');assert.equal(saved.areaId,inventory.id);
 assert.equal(await prisma.auditLog.count({where:{entityId:saved.id,entityType:'TASK_TEMPLATE',action:'CONFIGURE_INVENTORY'}}),1);
 await prisma.taskTemplate.update({where:{id:saved.id},data:{isActive:false}});
} finally {
 await client.query('DROP TRIGGER test_slow_schedule ON "TaskTemplate"; DROP FUNCTION test_slow_schedule();');
}
await client.query(`CREATE FUNCTION test_reject_schedule_audit() RETURNS trigger LANGUAGE plpgsql AS $$
 BEGIN IF NEW.action = 'CONFIGURE_INVENTORY' AND EXISTS (SELECT 1 FROM "TaskTemplate" WHERE id = NEW."entityId" AND title = 'Rollback inventory schedule regression')
 THEN RAISE EXCEPTION 'Simulated audit failure'; END IF; RETURN NEW; END $$;
 CREATE TRIGGER test_reject_schedule_audit BEFORE INSERT ON "AuditLog" FOR EACH ROW EXECUTE FUNCTION test_reject_schedule_audit();`);
try {
 let responded=false;
 await assert.rejects(()=>createTaskTemplate(scheduleRequest('Rollback inventory schedule regression') as any,{status(){responded=true;return this;},json(){responded=true;return this;}} as any));
 assert.equal(responded,false,'failed transaction must not return success');
 assert.equal(await prisma.taskTemplate.count({where:{title:'Rollback inventory schedule regression'}}),0,'inventory and template must roll back if the audit fails');
} finally {
 await client.query('DROP TRIGGER test_reject_schedule_audit ON "AuditLog"; DROP FUNCTION test_reject_schedule_audit();');
}
console.log('PASS: real inventory schedule creation survives a six-second database delay and atomically rolls back on audit failure');
// Current schedules publish their first complete snapshot in the same commit.
for(const recurringType of ['ONCE','DAILY'] as const){
 let body:any;
 const request=scheduleRequest(`Atomic current ${recurringType}`);
 request.body={...request.body,staffId:worker.id,effectiveDate:base,recurringType} as typeof request.body;
 await createTaskTemplate(request as any,{status(code:number){assert.equal(code,201);return this;},json(value:any){body=value;return this;}} as any);
 const first=await prisma.taskInstance.findFirstOrThrow({where:{templateId:body.data.id},include:{verificationItems:{include:{requirements:true}},assignments:true}});
 assert.equal(first.verificationVersion,2);assert.equal(first.areaId,inventory.id);assert.equal(first.verificationItems.length,2);assert.equal(first.assignments.length,1);
 assert.ok(first.verificationItems.flatMap(i=>i.requirements).every(r=>r.instructionsSnapshot));
 // Simulate an old scheduler's insert after it sees the newly committed schedule.
 const obsolete=await client.query(`INSERT INTO "TaskInstance" ("templateId",title,"locationId",date,"shiftStart","shiftEnd","updatedAt") VALUES ($1,'Old writer',$2,$3,$4,$5,NOW()) ON CONFLICT ("templateId",date) DO NOTHING RETURNING id`,[body.data.id,location,first.date.toISOString(),first.shiftStart.toISOString(),first.shiftEnd.toISOString()]);
 assert.equal(obsolete.rowCount,0,'an old duplicate writer cannot insert the same current-day instance');
 assert.equal(await prisma.taskInstance.count({where:{templateId:body.data.id}}),1);
 await prisma.taskTemplate.update({where:{id:body.data.id},data:{isActive:false}});
}
await client.query(`CREATE FUNCTION reject_initial_snapshot_regression() RETURNS trigger LANGUAGE plpgsql AS $$
 BEGIN IF EXISTS(SELECT 1 FROM "TaskInstance" t JOIN "TaskTemplate" s ON s.id=t."templateId" WHERE t.id=NEW."taskInstanceId" AND s.title='Initial snapshot rollback') THEN RAISE EXCEPTION 'Snapshot failed'; END IF; RETURN NEW; END $$;
 CREATE TRIGGER reject_initial_snapshot_regression BEFORE INSERT ON "TaskVerificationItem" FOR EACH ROW EXECUTE FUNCTION reject_initial_snapshot_regression();`);
try {
 const req=scheduleRequest('Initial snapshot rollback');req.body={...req.body,effectiveDate:base};
 await assert.rejects(()=>createTaskTemplate(req as any,{status(){throw new Error('Unexpected success');}} as any));
 assert.equal(await prisma.taskTemplate.count({where:{title:'Initial snapshot rollback'}}),0);
 assert.equal(await prisma.taskInstance.count({where:{title:'Initial snapshot rollback'}}),0);
}finally{await client.query('DROP TRIGGER reject_initial_snapshot_regression ON "TaskVerificationItem"; DROP FUNCTION reject_initial_snapshot_regression();');}
console.log('PASS: current ONCE/DAILY schedule and inventory snapshot commit atomically, old duplicate insert is blocked, snapshot failure rolls back schedule');

async function template(title:string,recurringType:'DAILY'|'ONCE'|null,mode:'ALL'|'SUBSET'='ALL'){
 const row=await prisma.taskTemplate.create({data:{title,locationId:location,staffId:worker.id,shiftStart:new Date(+base+9*3600000),shiftEnd:new Date(+base+10*3600000),effectiveDate:base,recurringType}});
 await prisma.$transaction(tx=>configureTemplateInventory(tx,row.id,location,{areaId:inventory.id,inventorySelection:mode,expectedInventoryVersion:3,selectedItems:mode==='SUBSET'?[{areaItemId:after.items[1]!.id,mandatory:true}]:[]}));
 return row;
}
const all=await template('All inventory daily','DAILY');const subset=await template('Subset once','ONCE','SUBSET');
await assert.rejects(()=>prisma.$transaction(tx=>validateInventorySelection(tx,location,{areaId:inventory.id,inventorySelection:'SUBSET',expectedInventoryVersion:3,selectedItems:[{areaItemId:999999,mandatory:true}]})));
await assert.rejects(()=>prisma.$transaction(tx=>validateInventorySelection(tx,location,{areaId:inventory.id,inventorySelection:'SUBSET',expectedInventoryVersion:3,selectedItems:[]})));
const {runDailyTaskScheduler}=await import('../src/cron/dailyTaskScheduler.js');
const {runOnceTaskScheduler}=await import('../src/cron/onceTaskScheduler.js');
const {runStartupCron}=await import('../src/cron/startupCron.js');
await runDailyTaskScheduler(now);await runOnceTaskScheduler(now);
const dailyInstance=await prisma.taskInstance.findFirstOrThrow({where:{templateId:all.id},include:{verificationItems:{include:{requirements:true}},assignments:true}});
const onceInstance=await prisma.taskInstance.findFirstOrThrow({where:{templateId:subset.id},include:{verificationItems:true}});
assert.equal(dailyInstance.verificationItems.length,2);assert.equal(dailyInstance.verificationItems.flatMap(i=>i.requirements).length,4);assert.equal(dailyInstance.assignments.length,1);
assert.equal(onceInstance.verificationItems.length,1);assert.equal(onceInstance.verificationItems[0]!.sourceAreaItemId,after.items[1]!.id);
const startup=await template('Startup snapshot','DAILY');
const legacy=await prisma.taskTemplate.create({data:{title:'Unmapped historical schedule',locationId:location,staffId:worker.id,shiftStart:new Date(+base+11*3600000),shiftEnd:new Date(+base+12*3600000),effectiveDate:base,recurringType:'DAILY',referenceImageUrl:'https://legacy.test/reference.jpg',referenceImages:{create:[{name:'Legacy reference',imageUrl:'https://legacy.test/reference.jpg',sortOrder:0}]}}});
const legacyOnce=await prisma.taskTemplate.create({data:{title:'Unmapped historical once schedule',locationId:location,staffId:worker.id,shiftStart:new Date(+base+11*3600000),shiftEnd:new Date(+base+12*3600000),effectiveDate:base,recurringType:'ONCE'}});
await runDailyTaskScheduler(now);await runOnceTaskScheduler(now);
await runStartupCron(now);
assert.equal(await prisma.taskInstance.count({where:{templateId:all.id}}),1);assert.equal(await prisma.taskInstance.count({where:{templateId:subset.id}}),1);
const startupInstance=await prisma.taskInstance.findFirstOrThrow({where:{templateId:startup.id},include:{verificationItems:true}});assert.equal(startupInstance.verificationItems.length,2);
for(const unmapped of [legacy,legacyOnce]) {
 assert.equal(await prisma.taskInstance.count({where:{templateId:unmapped.id}}),0,'daily/once/startup must not create new legacy tasks');
 assert.equal((await prisma.taskTemplate.findUniqueOrThrow({where:{id:unmapped.id}})).setupStatus,'NEEDS_REVIEW');
 assert.equal(await prisma.verificationException.count({where:{dedupeKey:`setup:template:${unmapped.id}`}}),1,'unmapped schedules report one setup issue instead of silently using legacy');
}
assert.equal((await prisma.taskInstance.findUniqueOrThrow({where:{id:oldTask}})).completionOutcome,'LEGACY_RECORDED','historical completion remains unchanged');
for(const id of [dailyInstance.id,onceInstance.id,startupInstance.id]) {
 const newTask=await prisma.taskInstance.findUniqueOrThrow({where:{id},include:{verificationItems:{include:{requirements:true}}}});
 assert.equal(newTask.verificationVersion,2);assert.equal(newTask.areaId,inventory.id);assert.ok(newTask.policySnapshot);assert.ok(newTask.verificationDeadline);assert.ok(newTask.uploadDeadline);
 assert.ok(newTask.verificationItems.every(item=>item.requirements.length>0),'new tasks include guided evidence requirements');
}
const concurrent=await template('Concurrent generation',null);
const input={templateId:concurrent.id,title:'Stale scheduler title',locationId:location,date:base,baseDate:base,shiftStart:all.shiftStart,shiftEnd:all.shiftEnd};
const generated=await Promise.all(Array.from({length:5},()=>createTaskInstanceWithSnapshot(input)));
assert.equal(generated.filter(g=>g?.created).length,1);assert.equal(new Set(generated.map(g=>g?.id)).size,1);
assert.equal(await prisma.taskAssignment.count({where:{taskInstanceId:generated[0]!.id}}),1);
const originalName=dailyInstance.verificationItems[0]!.nameSnapshot;
const repairTemplate=await template('Explicit unstarted repair',null);
const pendingRepair=await prisma.taskInstance.create({data:{templateId:repairTemplate.id,title:'Pending old-contract task',locationId:location,staffId:worker.id,date:new Date(Date.now()+12345),shiftStart:new Date(),shiftEnd:new Date(Date.now()+3600000),referenceImageUrl:'https://legacy.test/keep.jpg',assignments:{create:{staffId:worker.id}}},include:{assignments:true}});
const repairInput={taskId:pendingRepair.id,templateId:repairTemplate.id,locationId:location,expectedInventoryVersion:3};
await assert.rejects(()=>repairUnstartedInventoryTask({...repairInput,locationId:location+99999}));
await assert.rejects(()=>repairUnstartedInventoryTask({...repairInput,expectedInventoryVersion:999}));
assert.equal((await prisma.taskInstance.findUniqueOrThrow({where:{id:pendingRepair.id}})).verificationVersion,1);
await prisma.taskInstance.update({where:{id:pendingRepair.id},data:{proofImageUrls:['https://legacy.test/evidence.jpg']}});
await assert.rejects(()=>repairUnstartedInventoryTask(repairInput));
await prisma.taskInstance.update({where:{id:pendingRepair.id},data:{proofImageUrls:[],status:'IN_PROGRESS',startedAt:new Date()}});
await assert.rejects(()=>repairUnstartedInventoryTask(repairInput));
await prisma.taskInstance.update({where:{id:pendingRepair.id},data:{status:'PENDING',startedAt:null,shiftEnd:new Date(Date.now()-1000)}});
await assert.rejects(()=>repairUnstartedInventoryTask(repairInput));
await prisma.taskInstance.update({where:{id:pendingRepair.id},data:{shiftEnd:pendingRepair.shiftEnd}});
const repairs=await Promise.allSettled([repairUnstartedInventoryTask(repairInput),repairUnstartedInventoryTask(repairInput)]);
assert.equal(repairs.filter(r=>r.status==='fulfilled').length,1,'single-task repair is serialized and cannot duplicate snapshots');
const repaired=await prisma.taskInstance.findUniqueOrThrow({where:{id:pendingRepair.id},include:{assignments:true,verificationItems:{include:{requirements:true}}}});
assert.equal(repaired.verificationVersion,2);assert.equal(repaired.areaId,inventory.id);
assert.equal(repaired.verificationItems.length,2);assert.equal(repaired.verificationItems.flatMap(i=>i.requirements).length,4);
assert.equal(repaired.assignments[0]!.id,pendingRepair.assignments[0]!.id);assert.equal(+repaired.shiftEnd,+pendingRepair.shiftEnd);
assert.equal(repaired.referenceImageUrl,pendingRepair.referenceImageUrl);assert.equal(repaired.status,'PENDING');assert.equal(repaired.completionOutcome,null);
assert.ok(repaired.verificationDeadline);assert.ok(repaired.uploadDeadline);
assert.equal(await prisma.auditLog.count({where:{entityId:repaired.id,action:'REPAIR_UNSTARTED_INVENTORY_TASK'}}),1);
assert.equal(await prisma.verificationAttempt.count({where:{session:{taskInstanceId:repaired.id}}}),0);
console.log('PASS: explicit pending-task repair preserves assignments/history, creates full inventory gates, rejects started/evidenced/expired/stale tasks and serializes concurrent repairs');
await updateItem(actor,inventory.id,after.items[1]!.id,{expectedInventoryVersion:3,displayName:'Renamed fixture'});
assert.equal((await prisma.taskVerificationItem.findUniqueOrThrow({where:{id:dailyInstance.verificationItems[0]!.id}})).nameSnapshot,originalName);
await assert.rejects(()=>prisma.taskVerificationItem.update({where:{id:dailyInstance.verificationItems[0]!.id},data:{nameSnapshot:'Rewrite history'}}));
await assert.rejects(()=>prisma.taskInstance.update({where:{id:dailyInstance.id},data:{policySnapshot:{version:99}}}));
await bulkItems(actor,inventory.id,4,[{fixtureType:'SINK',count:1}]);
const future=await createTaskInstanceWithSnapshot({...input,templateId:all.id,date:new Date(+base+86400000),baseDate:new Date(+base+86400000)});
assert.ok(future);assert.equal(await prisma.taskVerificationItem.count({where:{taskInstanceId:future.id}}),3);
assert.equal(await prisma.taskVerificationItem.count({where:{taskInstanceId:dailyInstance.id}}),2);
const {markCurrentAssignmentStarted,markCurrentAssignmentCompleted}=await import('../src/services/taskAssignment.service.js');
await markCurrentAssignmentStarted(dailyInstance.id,worker.id,now);assert.equal((await prisma.taskAssignment.findUniqueOrThrow({where:{id:dailyInstance.assignments[0]!.id}})).status,'STARTED');
await markCurrentAssignmentCompleted(dailyInstance.id,worker.id,now);assert.equal((await prisma.taskAssignment.findUniqueOrThrow({where:{id:dailyInstance.assignments[0]!.id}})).status,'STARTED','v2 assignment cannot complete independently of guarded task finalization');
await updateItem(actor,inventory.id,after.items[1]!.id,{expectedInventoryVersion:5,status:'RETIRED'});
assert.equal((await prisma.taskTemplate.findUniqueOrThrow({where:{id:all.id}})).setupStatus,'NEEDS_REVIEW');
const blocked=await createTaskInstanceWithSnapshot({...input,templateId:all.id,date:new Date(+base+2*86400000),baseDate:new Date(+base+2*86400000)});assert.equal(blocked,null);
assert.equal(await prisma.taskInstance.count({where:{templateId:all.id}}),2,'retirement never silently shrinks required inventory');
assert.equal(await prisma.verificationException.count({where:{dedupeKey:`setup:template:${all.id}`}}),1);
console.log('PASS: daily/once/startup create only guided tasks, unmapped schedules require setup, historical completion retained, atomic concurrent generation and assignments, subsets, immutable history, future ALL expansion and retirement review');
const captureStaff=await prisma.staff.create({data:{name:'Capture worker',email:`${randomUUID()}@test.invalid`,password:'test-only',companyId:company,locationId:location}});
const captureActor={id:captureStaff.id,companyId:company,role:'STAFF' as const};
// Steps 9–14: real transaction tests, external storage/provider calls are injected.
process.env.VERIFICATION_QR_SECRET='q'.repeat(64);process.env.VERIFICATION_SLOT_SECRET='s'.repeat(64);
const {createCaptureSession,createReworkCaptureSession,reserveAttempt,retakeSlots,resumeSession,staffAttemptResult}=await import('../src/services/verification-v2/captureSession.service.js');
const {signAreaQr,signTaskQr}=await import('../src/services/verification-v2/qr.service.js');
const {finalizeTask}=await import('../src/services/verification-v2/completion.service.js');
const {managerDecision,raiseIssue}=await import('../src/services/verification-v2/exception.service.js');
const {assessCleanliness}=await import('../src/services/verification-v2/cleanliness.service.js');
const {processVerificationJob}=await import('../src/services/verification-v2/pipeline.service.js');
const {defaultVerificationPolicy}=await import('../src/services/verification-v2/verificationPolicy.service.js');
await prisma.location.update({where:{id:location},data:{isActive:true}});
await prisma.staff.update({where:{id:captureStaff.id},data:{isActive:true}});
const captureArea=await createArea(actor,location,{name:'Capture room',roomType:'WASHROOM',counts:[{fixtureType:'TOILET',count:1}]});
const start=new Date(Date.now()-60000),end=new Date(Date.now()+3600000);
const captureTemplate=await prisma.taskTemplate.create({data:{title:'Capture test',locationId:location,staffId:captureStaff.id,shiftStart:start,shiftEnd:end,effectiveDate:new Date(),verificationVersion:2,areaId:captureArea.id,inventoryConfigVersion:1,inventorySelection:'ALL',setupStatus:'READY'}});
const capturedTask=await createTaskInstanceWithSnapshot({templateId:captureTemplate.id,title:'Capture test',locationId:location,date:new Date(),shiftStart:start,shiftEnd:end});assert.ok(capturedTask);
await prisma.taskInstance.update({where:{id:capturedTask.id},data:{status:'IN_PROGRESS',startedAt:start}});
await prisma.taskAssignment.updateMany({where:{taskInstanceId:capturedTask.id},data:{status:'STARTED',startedAt:start}});
const sessionBody={requestId:randomUUID(),areaQr:signTaskQr(capturedTask,captureArea),deviceId:'device-a',clientBootId:'boot-a',location:{latitude:0,longitude:0,accuracy:1,sampledAt:new Date().toISOString()},clientTime:new Date().toISOString()};
await client.query(`CREATE FUNCTION slow_capture_session_regression() RETURNS trigger LANGUAGE plpgsql AS $$
 BEGIN IF NEW."taskInstanceId" = ${capturedTask.id} THEN PERFORM pg_sleep(6); END IF; RETURN NEW; END $$;
 CREATE TRIGGER slow_capture_session_regression BEFORE INSERT ON "CaptureSession" FOR EACH ROW EXECUTE FUNCTION slow_capture_session_regression();`);
const sessionRequestAt=Date.now();
const sessions=await Promise.all(Array.from({length:3},()=>createCaptureSession(captureActor,capturedTask.id,sessionBody)));
assert.ok(Date.now()-sessionRequestAt>=6000,'capture session also survives remote database latency beyond five seconds');
await client.query('DROP TRIGGER slow_capture_session_regression ON "CaptureSession"; DROP FUNCTION slow_capture_session_regression();');
assert.equal(new Set(sessions.map(s=>s.id)).size,1,'concurrent identical session requests create one session');
console.log('PASS: slow-database capture-session creation remains atomic and idempotent beyond five seconds');
const activeSession=sessions[0]!;assert.equal(activeSession.slots.length,3);assert.equal(activeSession.presenceStatus,'ACCEPTABLE');
await assert.rejects(()=>createCaptureSession(captureActor,capturedTask.id,{...sessionBody,requestId:randomUUID()}));
await assert.rejects(()=>createCaptureSession(captureActor,capturedTask.id,{...sessionBody,deviceId:'different'}),'same request cannot change device');
await assert.rejects(()=>createCaptureSession({...captureActor,companyId:foreignCompany.id},capturedTask.id,sessionBody));
const rawNoise=Buffer.alloc(640*640*3);for(let i=0;i<rawNoise.length;i++)rawNoise[i]=(i*31+(i>>8)*17)%256;
const noise=await sharp(rawNoise,{raw:{width:640,height:640,channels:3}}).jpeg().toBuffer();
const privateStore=new Map<string,Buffer>();const captureIo={store:async(bytes:Buffer,id:string,_hash:string)=>{if(!privateStore.has(id))privateStore.set(id,bytes);return {asset_id:id};},read:async(id:string)=>{const bytes=privateStore.get(id);assert.ok(bytes);return bytes;}};
const slot=activeSession.slots.find(s=>s.requirementId)!;
const metadata={deviceId:'device-a',clientCaptureId:randomUUID(),slotId:slot.id,nonce:slot.nonce,sha256:sha256(noise),claimedCapturedAt:activeSession.issuedAt.toISOString(),elapsedMs:0,bootId:'boot-a'};
const reservations=await Promise.all(Array.from({length:3},()=>reserveAttempt(captureActor,activeSession.id,metadata,true)));
assert.equal(new Set(reservations.map(a=>a.id)).size,1,'manifest commitment consumes slot exactly once');
await assert.rejects(()=>reserveAttempt(captureActor,activeSession.id,{...metadata,sha256:'b'.repeat(64)},false));
await assert.rejects(()=>reserveAttempt(captureActor,activeSession.id,{...metadata,clientCaptureId:randomUUID()},false),'slot replay');
const receipts=await Promise.all(Array.from({length:3},()=>storeReservedEvidence(captureActor,reservations[0]!.id,noise,captureIo)));
assert.equal(new Set(receipts.map(r=>r.assetId)).size,1,'concurrent duplicate upload stores one evidence identity');
assert.equal(await prisma.verificationJob.count({where:{attemptId:reservations[0]!.id,stage:'QUALITY'}}),1);
const fakeProvider={assess:async(stage:string,prompt='')=>{
 const match=prompt.match(/Assess exactly these surfaces individually: (\[[^\]]*\])/);const surfaces=match?JSON.parse(match[1]!):['bowl','seat'];
 return {result:stage==='privacy'?{status:'SAFE',reasonCode:'CLEAN'}:stage==='coverage'?{verdict:'MATCH',observedFixture:'TOILET',observedView:'bowl_seat',observedLabel:null,identityConsistent:true,privacyFlag:false,reasonCode:'CLEAN'}:{verdict:'DIRTY',surfaces:surfaces.map((surface:string)=>({surface,verdict:'DIRTY'})),reasonCode:'CLEANING_REQUIRED'},metadata:{provider:'fake',model:'fixture',providerVersion:'1',promptVersion:stage+'-v1',latencyMs:1,usage:null,costUsd:0,requestId:'test'}};
}};
async function executeStage(attemptId:string,stage:string){const j=await prisma.verificationJob.findFirstOrThrow({where:{attemptId,stage,state:'PENDING'}});const running=await prisma.verificationJob.update({where:{id:j.id},data:{state:'RUNNING',attempts:1,leaseToken:randomUUID(),leaseUntil:new Date(Date.now()+90000)}});await processVerificationJob(running,fakeProvider as any,captureIo.read,{evaluate:(image,rubric,view)=>assessCleanliness(fakeProvider as any,image,rubric,view)});}
for(const stage of ['QUALITY','PRIVACY','COVERAGE','CLEANLINESS'])await executeStage(reservations[0]!.id,stage);
assert.equal((await prisma.taskEvidenceRequirement.findUniqueOrThrow({where:{id:slot.requirementId!}})).state,'CLEANING_REQUIRED');
assert.equal(await prisma.verificationException.count({where:{taskInstanceId:capturedTask.id}}),0,'first dirty failure stays with staff');
const failedRequirement=await prisma.taskEvidenceRequirement.findUniqueOrThrow({where:{id:slot.requirementId!}});
await assert.rejects(()=>retakeSlots(captureActor,activeSession.id,{deviceId:'device-a',requirements:[{requirementId:failedRequirement.id,expectedGeneration:failedRequirement.decisionVersion}]}),/scan the task QR again/,'DIRTY retake cannot reuse original finish authority');
const reworkBody={...sessionBody,requestId:randomUUID(),location:{...sessionBody.location,sampledAt:new Date().toISOString()},requirements:[{requirementId:failedRequirement.id,expectedGeneration:failedRequirement.decisionVersion}]};
await assert.rejects(()=>createReworkCaptureSession(captureActor,capturedTask.id,{...reworkBody,areaQr:undefined}),'rework independently requires QR');
await assert.rejects(()=>createReworkCaptureSession(captureActor,capturedTask.id,{...reworkBody,areaQr:signAreaQr(inventory)}),'wrong area QR rejected');
await assert.rejects(()=>createReworkCaptureSession({...captureActor,companyId:foreignCompany.id},capturedTask.id,reworkBody),'cross-tenant rework rejected');
const reworkSessions=await Promise.all(Array.from({length:3},()=>createReworkCaptureSession(captureActor,capturedTask.id,reworkBody)));
const dirtyRework=reworkSessions[0]!;assert.equal(new Set(reworkSessions.map(s=>s.id)).size,1,'fresh rework QR request is atomic/idempotent');
assert.notEqual(dirtyRework.id,activeSession.id);assert.deepEqual(dirtyRework.requiredContextKeys,['ENTRANCE']);
assert.deepEqual(dirtyRework.slots.filter(s=>s.requirementId).map(s=>s.requirementId),[failedRequirement.id],'only requested DIRTY requirement is allocated');
assert.equal((await prisma.captureSession.findUniqueOrThrow({where:{id:activeSession.id}})).state,'EXPIRED');
await prisma.captureSession.update({where:{id:dirtyRework.id},data:{state:'PAUSED'}});
assert.equal((await resumeSession(captureActor,dirtyRework.id,{deviceId:'device-a',clientBootId:'boot-a'})).state,'ACTIVE');
const beforeEpoch=(await prisma.taskInstance.findUniqueOrThrow({where:{id:capturedTask.id}})).assignmentEpoch;
const handoverWorker=await prisma.staff.create({data:{name:'Handover',email:`${randomUUID()}@test.invalid`,password:'test-only',companyId:company,locationId:location}});
await prisma.taskInstance.update({where:{id:capturedTask.id},data:{staffId:handoverWorker.id}});
assert.equal((await prisma.taskInstance.findUniqueOrThrow({where:{id:capturedTask.id}})).assignmentEpoch,beforeEpoch+1);
assert.equal((await prisma.captureSession.findUniqueOrThrow({where:{id:dirtyRework.id}})).state,'REVOKED');
await assert.rejects(()=>reserveAttempt(captureActor,activeSession.id,metadata,false),'old assignment cannot ingest');
assert.equal((await prisma.evidenceAsset.findUniqueOrThrow({where:{id:receipts[0]!.assetId}})).sha256,sha256(noise),'evidence survives handover');
// Restore a current assignment and prove waiver versus verified completion and exactly-once finalization.
await prisma.taskInstance.update({where:{id:capturedTask.id},data:{staffId:captureStaff.id}});
await prisma.taskAssignment.updateMany({where:{taskInstanceId:capturedTask.id},data:{isCurrent:true,status:'STARTED'}});
const caseRow=await prisma.$transaction(tx=>raiseIssue(tx,capturedTask.id,'DAMAGED',failedRequirement.id));
const requirements=await prisma.taskEvidenceRequirement.findMany({where:{item:{taskInstanceId:capturedTask.id}}});
for(const r of requirements){const c=await prisma.verificationException.findUniqueOrThrow({where:{id:caseRow.id}});await managerDecision(actor,c.id,{requestId:randomUUID(),expectedVersion:c.rowVersion,requirementId:r.id,action:'WAIVE_REQUIREMENT',reasonCode:'DAMAGED',note:'Explicit test waiver for damaged fixture'});}
assert.equal((await prisma.taskInstance.findUniqueOrThrow({where:{id:capturedTask.id}})).completionOutcome,'COMPLETED_WITH_EXCEPTIONS');
await Promise.all(Array.from({length:3},()=>prisma.$transaction(tx=>finalizeTask(tx,capturedTask.id))));
assert.equal(await prisma.auditLog.count({where:{entityType:'TASK_INSTANCE',entityId:capturedTask.id,action:'VERIFICATION_COMPLETED'}}),1);
assert.equal((await prisma.taskAssignment.findFirstOrThrow({where:{taskInstanceId:capturedTask.id}})).status,'COMPLETED');
console.log('PASS: concurrent sessions/manifests/uploads, replay and changed bytes, separate provider stages, no first-failure spam, targeted retake, handover revocation, preserved evidence, waiver outcome and exactly-once completion');

// Independent final results serialize on the task lock and produce one completion.
async function freshCaptureTask(label:string,templateId=captureTemplate.id,evidenceActor=captureActor,areaId=captureArea.id){const t=await createTaskInstanceWithSnapshot({templateId,title:label,locationId:location,date:new Date(Date.now()+Math.floor(Math.random()*1000000)),shiftStart:start,shiftEnd:end});assert.ok(t);await prisma.taskInstance.update({where:{id:t.id},data:{status:'IN_PROGRESS',startedAt:start}});await prisma.taskAssignment.updateMany({where:{taskInstanceId:t.id},data:{status:'STARTED',startedAt:start}});const ar=await prisma.area.findUniqueOrThrow({where:{id:areaId}});const s=await createCaptureSession(evidenceActor,t.id,{...sessionBody,requestId:randomUUID(),areaQr:signTaskQr(t,ar),location:{...sessionBody.location,sampledAt:new Date().toISOString()}});return {task:t,session:s};}
async function photoFor(seed:number){const pixels=Buffer.alloc(640*640*3);for(let i=0;i<pixels.length;i++)pixels[i]=(i*(seed*2+13)+(i>>7)*(seed+29))%256;return sharp(pixels,{raw:{width:640,height:640,channels:3}}).jpeg().toBuffer();}
async function ingestFixture(s:typeof activeSession,slotId:string,seed:number,evidenceActor=captureActor,photo?:Buffer){const sl=s.slots.find(x=>x.id===slotId)!;const bytes=photo??await photoFor(seed);const m={...metadata,clientCaptureId:randomUUID(),slotId:sl.id,nonce:sl.nonce,sha256:sha256(bytes),claimedCapturedAt:s.issuedAt.toISOString(),elapsedMs:0};const a=await reserveAttempt(evidenceActor,s.id,m,true);await storeReservedEvidence(evidenceActor,a.id,bytes,captureIo);return a;}
const contextReworkStaff=await prisma.staff.create({data:{name:'Context rework worker',email:`${randomUUID()}@test.invalid`,password:'test-only',companyId:company,locationId:location}});
const contextReworkActor={id:contextReworkStaff.id,companyId:company,role:'STAFF' as const};
const contextReworkTemplate=await prisma.taskTemplate.create({data:{title:'Context rework test',locationId:location,staffId:contextReworkStaff.id,shiftStart:start,shiftEnd:end,effectiveDate:new Date(),verificationVersion:2,areaId:captureArea.id,inventoryConfigVersion:1,inventorySelection:'ALL',setupStatus:'READY'}});
const preserved=await freshCaptureTask('Passed evidence survives fresh rework',contextReworkTemplate.id,contextReworkActor);
const preservedSlots=preserved.session.slots.filter(s=>s.requirementId);
const passedAttempt=await ingestFixture(preserved.session,preservedSlots[0]!.id,901,contextReworkActor);
await prisma.taskEvidenceRequirement.update({where:{id:preservedSlots[0]!.requirementId!},data:{state:'PASSED'}});
await prisma.taskEvidenceRequirement.update({where:{id:preservedSlots[1]!.requirementId!},data:{state:'CLEANING_REQUIRED',decisionVersion:{increment:1}}});
const dirty=await prisma.taskEvidenceRequirement.findUniqueOrThrow({where:{id:preservedSlots[1]!.requirementId!}});
const beforePassed=await prisma.taskEvidenceRequirement.findUniqueOrThrow({where:{id:preservedSlots[0]!.requirementId!}});
const preserveBody={...sessionBody,requestId:randomUUID(),location:{...sessionBody.location,sampledAt:new Date().toISOString()},requirements:[{requirementId:dirty.id,expectedGeneration:dirty.decisionVersion}]};
const preservedRework=await createReworkCaptureSession(contextReworkActor,preserved.task.id,preserveBody);
assert.deepEqual(await prisma.taskEvidenceRequirement.findUniqueOrThrow({where:{id:beforePassed.id}}),beforePassed,'passed requirement and accepted attempt pointer survive fresh rework');
assert.equal(beforePassed.currentAttemptId,passedAttempt.id);
assert.deepEqual(preservedRework.slots.filter(s=>s.requirementId).map(s=>s.requirementId),[dirty.id]);
async function verifyEntranceOnly(s:typeof activeSession,evidenceActor:typeof captureActor,seed:number){
 const entrance=s.slots.find(slot=>slot.contextKey==='ENTRANCE')!;
 const a=await ingestFixture(s,entrance.id,seed,evidenceActor);
 const contextProvider={assess:async(stage:string,prompt:string)=>{const result=await fakeProvider.assess(stage,prompt);return stage==='coverage'?{...result,result:{verdict:'MATCH',observedFixture:'ROOM_CONTEXT',observedView:'ENTRANCE',observedLabel:null,identityConsistent:true,privacyFlag:false,reasonCode:'CLEAN'}}:result;}};
 for(const stage of ['QUALITY','PRIVACY','COVERAGE']){
  const j=await prisma.verificationJob.findFirstOrThrow({where:{attemptId:a.id,stage,state:'PENDING'}});
  const running=await prisma.verificationJob.update({where:{id:j.id},data:{state:'RUNNING',attempts:1,leaseToken:randomUUID(),leaseUntil:new Date(Date.now()+90000)}});
  await processVerificationJob(running,contextProvider as any,captureIo.read);
 }
 return a;
}
const reworkEntrance=await verifyEntranceOnly(preservedRework,contextReworkActor,903);
const acceptedContext=await prisma.captureSession.findUniqueOrThrow({where:{id:preservedRework.id}});
assert.equal(acceptedContext.contextStatus,'ACCEPTABLE','one valid entrance satisfies NEW session context without a hidden layout gate');
assert.deepEqual(acceptedContext.contextAttemptIds,[reworkEntrance.id]);

await assert.rejects(()=>reserveAttempt(contextReworkActor,preserved.session.id,{...metadata,clientCaptureId:randomUUID(),slotId:preservedSlots[1]!.id,nonce:preservedSlots[1]!.nonce,claimedCapturedAt:preserved.session.issuedAt.toISOString(),elapsedMs:0},true),/Capture authority expired/);
const legacyContextFixture=await freshCaptureTask('Legacy context renewal',contextReworkTemplate.id,contextReworkActor);
await prisma.captureSession.update({where:{id:legacyContextFixture.session.id},data:{locationCheck:{},state:'EXPIRED'}});
const legacyRenew=await createCaptureSession(contextReworkActor,legacyContextFixture.task.id,{...sessionBody,requestId:randomUUID(),areaQr:signTaskQr(legacyContextFixture.task,await prisma.area.findUniqueOrThrow({where:{id:captureArea.id}})),location:{...sessionBody.location,sampledAt:new Date().toISOString()}},legacyContextFixture.session.id);
assert.deepEqual(legacyRenew.requiredContextKeys,['ENTRANCE','LAYOUT']);
assert.deepEqual(legacyRenew.slots.filter(s=>s.contextKey).map(s=>s.contextKey),['ENTRANCE','LAYOUT'],'old context obligations remain resumable');
await verifyEntranceOnly(legacyRenew,contextReworkActor,905);assert.equal((await prisma.captureSession.findUniqueOrThrow({where:{id:legacyRenew.id}})).contextStatus,'PENDING','legacy session retains its unmet layout obligation');
console.log('PASS: fresh targeted DIRTY rework QR, wrong area and tenant rejection, passed evidence survival, expired old authority and legacy context renewal');
// Mixed failures span sessions: a new DIRTY QR grants fresh authority, and ordinary
// non-cleaning recaptures can be allocated into that same currently authorized session.
const mixedArea=await createArea(actor,location,{name:'Mixed rework room',roomType:'WASHROOM',counts:[{fixtureType:'TOILET',count:2}]});
const mixedTemplate=await prisma.taskTemplate.create({data:{title:'Mixed rework test',locationId:location,staffId:contextReworkStaff.id,shiftStart:start,shiftEnd:end,effectiveDate:new Date(),verificationVersion:2,areaId:mixedArea.id,inventoryConfigVersion:1,inventorySelection:'ALL',setupStatus:'READY'}});
const mixed=await freshCaptureTask('Mixed cleaning and photo rework',mixedTemplate.id,contextReworkActor,mixedArea.id);
const mixedSlots=mixed.session.slots.filter(slot=>slot.requirementId);
const mixedPhoto=()=>sharp(randomBytes(640*640*3),{raw:{width:640,height:640,channels:3}}).jpeg().toBuffer();
const mixedPassed=await ingestFixture(mixed.session,mixedSlots[0]!.id,907,contextReworkActor,await mixedPhoto());
await prisma.taskEvidenceRequirement.update({where:{id:mixedPassed.requirementId!},data:{state:'PASSED'}});
const mixedPassedBefore=await prisma.taskEvidenceRequirement.findUniqueOrThrow({where:{id:mixedPassed.requirementId!}});
const mixedDirtyAttempt=await ingestFixture(mixed.session,mixedSlots[2]!.id,908,contextReworkActor,await mixedPhoto());
for(const stage of ['QUALITY','PRIVACY','COVERAGE','CLEANLINESS'])await executeStage(mixedDirtyAttempt.id,stage);
const darkPhoto=await sharp({create:{width:640,height:640,channels:3,background:'#000000'}}).jpeg().toBuffer();
const mixedRecaptureAttempt=await ingestFixture(mixed.session,mixedSlots[1]!.id,910,contextReworkActor,darkPhoto);
for(const stage of ['QUALITY','PRIVACY'])await executeStage(mixedRecaptureAttempt.id,stage);
const mixedDirty=await prisma.taskEvidenceRequirement.findUniqueOrThrow({where:{id:mixedDirtyAttempt.requirementId!}});
const mixedRecapture=await prisma.taskEvidenceRequirement.findUniqueOrThrow({where:{id:mixedRecaptureAttempt.requirementId!}});
assert.equal(mixedDirty.state,'CLEANING_REQUIRED');assert.equal(mixedRecapture.state,'RECAPTURE_REQUIRED');
const mixedRework=await createReworkCaptureSession(contextReworkActor,mixed.task.id,{...sessionBody,requestId:randomUUID(),areaQr:signTaskQr(mixed.task,mixedArea),location:{...sessionBody.location,sampledAt:new Date().toISOString()},requirements:[{requirementId:mixedDirty.id,expectedGeneration:mixedDirty.decisionVersion}]});
assert.deepEqual(mixedRework.slots.filter(slot=>slot.requirementId).map(slot=>slot.requirementId),[mixedDirty.id]);
assert.deepEqual(mixedRework.slots.filter(slot=>slot.contextKey).map(slot=>slot.contextKey),['ENTRANCE']);
const mixedRetakeBody={deviceId:'device-a',requirements:[{requirementId:mixedRecapture.id,expectedGeneration:mixedRecapture.decisionVersion}]};
await assert.rejects(()=>retakeSlots(contextReworkActor,mixed.session.id,mixedRetakeBody),/Renew capture session/,'old session cannot allocate mixed-failure recapture');
await assert.rejects(()=>retakeSlots(contextReworkActor,mixedRework.id,{...mixedRetakeBody,deviceId:'different-device'}),/another device/);
await assert.rejects(()=>retakeSlots(contextReworkActor,mixedRework.id,{deviceId:'device-a',requirements:[{requirementId:mixedRecapture.id,expectedGeneration:mixedRecapture.decisionVersion+99}]}),/not available for retake/);
const mixedRetakes=await retakeSlots(contextReworkActor,mixedRework.id,mixedRetakeBody);
assert.equal(mixedRetakes.length,1);assert.equal(mixedRetakes[0]!.sessionId,mixedRework.id);
assert.equal(mixedRetakes[0]!.requirementId,mixedRecapture.id);assert.equal(mixedRetakes[0]!.generation,mixedRecapture.decisionVersion+1);
assert.deepEqual((await retakeSlots(contextReworkActor,mixedRework.id,mixedRetakeBody)).map(slot=>slot.id),mixedRetakes.map(slot=>slot.id),'mixed recapture allocation retry is idempotent');
await assert.rejects(()=>reserveAttempt(contextReworkActor,mixedRework.id,{...metadata,clientCaptureId:randomUUID(),slotId:mixedSlots[1]!.id,nonce:mixedSlots[1]!.nonce,claimedCapturedAt:mixedRework.issuedAt.toISOString(),elapsedMs:0},true),/Capture slot not found/,'old slot/nonce cannot be transplanted to fresh rework session');
const mixedRetakeCapture=await ingestFixture({...mixedRework,slots:mixedRetakes},mixedRetakes[0]!.id,911,contextReworkActor,await mixedPhoto());
assert.equal(mixedRetakeCapture.sessionId,mixedRework.id);assert.equal(mixedRetakeCapture.supersedesAttemptId,null);
assert.deepEqual(await prisma.taskEvidenceRequirement.findUniqueOrThrow({where:{id:mixedPassedBefore.id}}),mixedPassedBefore,'passed state and accepted evidence remain unchanged through both mixed rework operations');
assert.equal(await prisma.auditLog.count({where:{entityId:mixed.task.id,action:'DIRTY_REWORK_QR_AUTHORIZED'}}),1,'non-cleaning recapture uses current fresh authority without another QR session');
console.log('PASS: mixed PASSED/DIRTY/RECAPTURE failures, fresh targeted DIRTY QR plus same-session ordinary recapture, generation/nonce/device checks and retained passed evidence');
const finalRace=await freshCaptureTask('Final race');const finalSlots=finalRace.session.slots.filter(s=>s.requirementId);const finalAttempts=[];for(let i=0;i<finalSlots.length;i++)finalAttempts.push(await ingestFixture(finalRace.session,finalSlots[i]!.id,101+i));
await prisma.captureSession.update({where:{id:finalRace.session.id},data:{contextStatus:'ACCEPTABLE'}});
await prisma.evidenceAsset.updateMany({where:{taskInstanceId:finalRace.task.id},data:{privacyState:'SAFE'}});
await prisma.verificationJob.updateMany({where:{attemptId:{in:finalAttempts.map(a=>a.id)}},data:{state:'SUCCEEDED',finishedAt:new Date()}});
await Promise.all(finalAttempts.map(a=>prisma.$transaction(async tx=>{await tx.$queryRaw`SELECT id FROM "TaskInstance" WHERE id=${finalRace.task.id} FOR UPDATE`;await tx.verificationAttempt.update({where:{id:a.id},data:{state:'PASSED'}});await tx.taskEvidenceRequirement.update({where:{id:a.requirementId!},data:{state:'PASSED'}});return finalizeTask(tx,finalRace.task.id);})));assert.equal((await prisma.taskInstance.findUniqueOrThrow({where:{id:finalRace.task.id}})).completionOutcome,'VERIFIED_COMPLETE');assert.equal(await prisma.auditLog.count({where:{entityId:finalRace.task.id,action:'VERIFICATION_COMPLETED'}}),1);
const spatialStaff=await prisma.staff.create({data:{name:'Spatial worker',email:`${randomUUID()}@test.invalid`,password:'test-only',companyId:company,locationId:location}});
const spatialActor={...captureActor,id:spatialStaff.id};
const spatialTemplate=await prisma.taskTemplate.create({data:{title:'Spatial binding validation',locationId:location,staffId:spatialStaff.id,shiftStart:start,shiftEnd:end,effectiveDate:new Date(),verificationVersion:2,areaId:captureArea.id,inventoryConfigVersion:1,inventorySelection:'ALL',setupStatus:'READY'}});
const spatialTask=await createTaskInstanceWithSnapshot({templateId:spatialTemplate.id,title:'Spatial binding validation',locationId:location,date:new Date(),shiftStart:start,shiftEnd:end});assert.ok(spatialTask);
await prisma.taskInstance.update({where:{id:spatialTask.id},data:{status:'IN_PROGRESS',startedAt:start}});await prisma.taskAssignment.updateMany({where:{taskInstanceId:spatialTask.id},data:{status:'STARTED',startedAt:start}});
const spatialArea=await prisma.area.findUniqueOrThrow({where:{id:captureArea.id}});
const spatialFixture={task:spatialTask,session:await createCaptureSession(spatialActor,spatialTask.id,{...sessionBody,requestId:randomUUID(),areaQr:signTaskQr(spatialTask,spatialArea),location:{...sessionBody.location,sampledAt:new Date().toISOString()}})};
const spatialSlots=spatialFixture.session.slots.filter(s=>s.requirementId).slice(0,2);
assert.equal(spatialSlots.length,2);
const spatialWorld=randomUUID();
function spatialMetadata(index:number,sequence:number){const sl=spatialSlots[index]!;return {...metadata,clientCaptureId:randomUUID(),slotId:sl.id,nonce:sl.nonce,claimedCapturedAt:new Date(+spatialFixture.session.issuedAt+sequence*10).toISOString(),elapsedMs:sequence*10,spatialEvidence:{version:1,sessionId:spatialFixture.session.id,worldId:spatialWorld,sequence,requirementId:sl.requirementId,contextKey:null,capability:'NO_SPATIAL',tracking:'UNAVAILABLE',continuity:'CONTINUOUS',capturedElapsedMs:sequence*10,worldStartedElapsedMs:0,nativeTimestampMs:null,camera:null,worldPoint:null,movementMeters:null,interruptionReasons:[]}};}
const spatialLater=spatialMetadata(1,2),spatialEarlier=spatialMetadata(0,1);
await assert.rejects(()=>reserveAttempt(spatialActor,spatialFixture.session.id,{...spatialLater,spatialEvidence:{...spatialLater.spatialEvidence,sessionId:randomUUID()}},true),'wrong spatial session');
const spatialReserved=await reserveAttempt(spatialActor,spatialFixture.session.id,spatialLater,true);
assert.equal(spatialReserved.spatialVersion,1);assert.deepEqual(spatialReserved.spatialEvidence,spatialLater.spatialEvidence);
assert.equal((await reserveAttempt(spatialActor,spatialFixture.session.id,{...spatialLater,spatialEvidence:JSON.stringify(spatialLater.spatialEvidence)},false)).id,spatialReserved.id);
await assert.rejects(()=>reserveAttempt(spatialActor,spatialFixture.session.id,{...spatialLater,spatialEvidence:{...spatialLater.spatialEvidence,worldId:randomUUID()}},false),'spatial idempotency binding');
await assert.rejects(()=>reserveAttempt(spatialActor,spatialFixture.session.id,{...spatialEarlier,spatialEvidence:{...spatialEarlier.spatialEvidence,sequence:2}},true),'spatial sequence reused');
const earlySpatial=await reserveAttempt(spatialActor,spatialFixture.session.id,spatialEarlier,true);
assert.equal(earlySpatial.spatialVersion,1,'offline earlier capture can arrive after later capture');
await assert.rejects(()=>prisma.verificationAttempt.update({where:{id:spatialReserved.id},data:{spatialEvidence:{...spatialLater.spatialEvidence,worldId:randomUUID()}}}),'immutable observation');
console.log('PASS: spatial metadata binding, multipart parsing, idempotency, sequence/order and immutable persistence');

const qrRace=await freshCaptureTask('QR race');const qrSlot=qrRace.session.slots.find(s=>s.requirementId)!;const qrAttempt=await ingestFixture(qrRace.session,qrSlot.id,231);
for(const stage of ['QUALITY','PRIVACY','COVERAGE'])await executeStage(qrAttempt.id,stage);
let releaseProvider!:()=>void;let enteredProvider!:()=>void;const entered=new Promise<void>(resolve=>enteredProvider=resolve),providerGate=new Promise<void>(resolve=>releaseProvider=resolve);
const slowProvider={assess:async(stage:string,prompt:string)=>{enteredProvider();await providerGate;return fakeProvider.assess(stage,prompt);}};
const qrJob=await prisma.verificationJob.findFirstOrThrow({where:{attemptId:qrAttempt.id,stage:'CLEANLINESS'}});const runningQr=await prisma.verificationJob.update({where:{id:qrJob.id},data:{state:'RUNNING',attempts:1,leaseToken:randomUUID(),leaseUntil:new Date(Date.now()+90000)}});
const processing=processVerificationJob(runningQr,slowProvider as any,captureIo.read,{evaluate:(image,rubric,view)=>assessCleanliness(slowProvider as any,image,rubric,view)});await entered;
const {rotateQr}=await import('../src/controllers/area.controller.js');const qrResponse:any={status(){return this;},json(){return this;}};
await rotateQr({params:{areaId:String(captureArea.id)},body:{expectedInventoryVersion:1},user:actor} as any,qrResponse);releaseProvider();await processing;
assert.equal((await prisma.verificationAttempt.findUniqueOrThrow({where:{id:qrAttempt.id}})).state,'REVIEW_REQUIRED','QR rotation blocks an in-flight cleanliness credit');assert.notEqual((await prisma.taskEvidenceRequirement.findUniqueOrThrow({where:{id:qrSlot.requirementId!}})).state,'PASSED');
const staleQrDecision=await prisma.verificationAttempt.findUniqueOrThrow({where:{id:qrAttempt.id}});assert.equal((staleQrDecision.cleanlinessResult as any).policyDecisionReason,'STALE_ASSIGNMENT');assert.equal(staffAttemptResult(staleQrDecision,true).reviewReason,'STALE_ASSIGNMENT');
await assert.rejects(()=>createCaptureSession(captureActor,qrRace.task.id,{...sessionBody,requestId:randomUUID()}),'old QR invalid after rotation');
assert.equal((await prisma.taskEvidenceRequirement.findFirstOrThrow({where:{item:{taskInstanceId:finalRace.task.id}}})).state,'PASSED','QR rotation preserves already-passed evidence');
const queuedQrSlot=qrRace.session.slots.find(s=>s.requirementId&&s.id!==qrSlot.id)!;
const queuedQrBytes=await photoFor(282);
const queuedQrAttempt=await reserveAttempt(captureActor,qrRace.session.id,{...metadata,clientCaptureId:randomUUID(),slotId:queuedQrSlot.id,nonce:queuedQrSlot.nonce,sha256:sha256(queuedQrBytes),claimedCapturedAt:qrRace.session.issuedAt.toISOString(),elapsedMs:0},false);
assert.equal(queuedQrAttempt.state,'REVIEW_REQUIRED');
assert.equal((await storeReservedEvidence(captureActor,queuedQrAttempt.id,queuedQrBytes,captureIo)).state,'REVIEW_REQUIRED','queued old-QR bytes are retained without automatic credit');
const inactiveRace=await freshCaptureTask('Inactive staff');await prisma.staff.update({where:{id:captureStaff.id},data:{isActive:false}});assert.equal((await prisma.captureSession.findUniqueOrThrow({where:{id:inactiveRace.session.id}})).state,'REVOKED');await assert.rejects(()=>resumeSession(captureActor,inactiveRace.session.id,{deviceId:'device-a',clientBootId:'boot-a'}));await prisma.staff.update({where:{id:captureStaff.id},data:{isActive:true}});
console.log('PASS: two final-result race, verified versus waived completion, QR rotation during AI, old-QR rejection, passed evidence preservation and inactive-staff revocation');

// A late old result cannot replace a manager-requested new capture generation.
const retakeRace=await freshCaptureTask('Stale result after retake');const retakeSlot=retakeRace.session.slots.find(s=>s.requirementId)!;const retakeAttempt=await ingestFixture(retakeRace.session,retakeSlot.id,315);
for(const stage of ['QUALITY','PRIVACY','COVERAGE'])await executeStage(retakeAttempt.id,stage);
let enterRetake!:()=>void,releaseRetake!:()=>void;const retakeEntered=new Promise<void>(resolve=>enterRetake=resolve),retakeGate=new Promise<void>(resolve=>releaseRetake=resolve);
const delayedRetakeProvider={assess:async(stage:string,prompt:string)=>{enterRetake();await retakeGate;return fakeProvider.assess(stage,prompt);}};
const retakeJob=await prisma.verificationJob.findFirstOrThrow({where:{attemptId:retakeAttempt.id,stage:'CLEANLINESS'}});const runningRetake=await prisma.verificationJob.update({where:{id:retakeJob.id},data:{state:'RUNNING',attempts:1,leaseToken:randomUUID(),leaseUntil:new Date(Date.now()+90000)}});
const pendingRetake=processVerificationJob(runningRetake,delayedRetakeProvider as any,captureIo.read,{evaluate:(image,rubric,view)=>assessCleanliness(delayedRetakeProvider as any,image,rubric,view)});await retakeEntered;
const retakeCase=await prisma.$transaction(tx=>raiseIssue(tx,retakeRace.task.id,'DAMAGED',retakeSlot.requirementId));assert.ok(retakeCase);
await managerDecision(actor,retakeCase.id,{requestId:randomUUID(),expectedVersion:retakeCase.rowVersion,requirementId:retakeSlot.requirementId,action:'REQUEST_RECAPTURE',reasonCode:'CANNOT_ASSESS',note:'Explicit recapture while old result is in flight'});
const afterRequest=await prisma.taskEvidenceRequirement.findUniqueOrThrow({where:{id:retakeSlot.requirementId!}});const retakeAllocated=await retakeSlots(captureActor,retakeRace.session.id,{deviceId:'device-a',requirements:[{requirementId:afterRequest.id,expectedGeneration:afterRequest.decisionVersion}]});assert.equal(retakeAllocated.length,1);
releaseRetake();await pendingRetake;const preservedGeneration=await prisma.taskEvidenceRequirement.findUniqueOrThrow({where:{id:retakeSlot.requirementId!}});assert.equal(preservedGeneration.currentAttemptId,null);assert.equal(preservedGeneration.state,'MISSING');assert.equal(preservedGeneration.decisionVersion,afterRequest.decisionVersion+1);
const supersededJob=await prisma.$transaction(tx=>enqueueVerificationJob(tx,{companyId:company,attemptId:retakeAttempt.id,stage:'COVERAGE',evaluatorVersion:'coverage-failure-test-v2'}));
const supersededRunning=await prisma.verificationJob.update({where:{id:supersededJob.id},data:{state:'RUNNING',attempts:4,leaseToken:randomUUID(),leaseUntil:new Date(Date.now()+90000)}});
await failVerificationJob(supersededRunning,'PROVIDER_UNAVAILABLE');
assert.equal(await prisma.verificationIssue.count({where:{exception:{taskInstanceId:retakeRace.task.id},reasonCode:'SERVICE_FAILURE'}}),0,'superseded service failure cannot block the replacement generation');
// Storage success followed by reassignment must still register the already-authorized bytes.
const uploadRace=await freshCaptureTask('Upload during handover');const uploadSlot=uploadRace.session.slots.find(s=>s.requirementId)!;const uploadBytes=await photoFor(493);const uploadMetadata={...metadata,clientCaptureId:randomUUID(),slotId:uploadSlot.id,nonce:uploadSlot.nonce,sha256:sha256(uploadBytes),claimedCapturedAt:uploadRace.session.issuedAt.toISOString(),elapsedMs:0};const uploadAttempt=await reserveAttempt(captureActor,uploadRace.session.id,uploadMetadata,true);
let changedOwner=false;const raceIo={...captureIo,store:async(bytes:Buffer,id:string,hash:string)=>{const stored=await captureIo.store(bytes,id,hash);if(!changedOwner){changedOwner=true;await prisma.taskInstance.update({where:{id:uploadRace.task.id},data:{staffId:handoverWorker.id}});}return stored;}};
const reviewReceipt=await storeReservedEvidence(captureActor,uploadAttempt.id,uploadBytes,raceIo);assert.equal(reviewReceipt.state,'REVIEW_REQUIRED');assert.ok((await prisma.verificationAttempt.findUniqueOrThrow({where:{id:uploadAttempt.id}})).mediaAssetId,'authorized bytes are retained even when ownership changes during remote storage');
// Exhausted service jobs produce one deduplicated task case and never consume cleaning retries.
const failureRace=await freshCaptureTask('Provider outage');const failureSlot=failureRace.session.slots.find(s=>s.requirementId)!;const failureAttempt=await ingestFixture(failureRace.session,failureSlot.id,559);const failedJob=await prisma.verificationJob.findFirstOrThrow({where:{attemptId:failureAttempt.id,stage:'QUALITY'}});
for(let n=1;n<=4;n++){const running=await prisma.verificationJob.update({where:{id:failedJob.id},data:{state:'RUNNING',attempts:n,leaseToken:randomUUID(),leaseUntil:new Date(Date.now()+90000)}});assert.equal(await failVerificationJob(running,'PROVIDER_UNAVAILABLE'),true);if(n<4)assert.equal(await prisma.verificationException.count({where:{taskInstanceId:failureRace.task.id}}),0);}
assert.equal((await prisma.verificationAttempt.findUniqueOrThrow({where:{id:failureAttempt.id}})).state,'SERVICE_FAILURE');assert.equal(await prisma.verificationException.count({where:{taskInstanceId:failureRace.task.id}}),1);assert.equal(await prisma.verificationAttempt.count({where:{requirementId:failureSlot.requirementId,state:'CLEANING_REQUIRED'}}),0);
console.log('PASS: stale result after retake, upload/storage racing reassignment with retained bytes, bounded provider retries and no fabricated dirt');

// Exercise real route contracts with authenticated local fixtures; no app startup crons.
process.env.ACCESS_TOKEN_SECRET='isolated-verification-test-secret';
const express=(await import('express')).default,jwt=(await import('jsonwebtoken')).default;
const verificationRouter=(await import('../src/routes/verification.route.js')).default,exceptionRouter=(await import('../src/routes/verificationException.route.js')).default;
const http=express();http.use(express.json());http.use('/api',verificationRouter);http.use('/api',exceptionRouter);
http.use('/api/task-instance',(await import('../src/routes/taskInstance.route.js')).default);
http.use('/api/assignment',(await import('../src/routes/assignment.route.js')).default);
http.use((error:any,_req:any,res:any,_next:any)=>res.status(error.statusCode??500).json({success:false,message:error.message,code:error.errors?.[0]?.code??'TEST_ERROR'}));
const server=await new Promise<import('node:http').Server>(resolve=>{const s=http.listen(0,'127.0.0.1',()=>resolve(s));});const port=(server.address() as import('node:net').AddressInfo).port;
const workerJwt=jwt.sign({id:captureStaff.id,role:'STAFF'},process.env.ACCESS_TOKEN_SECRET),adminJwt=jwt.sign({id:actor.id,role:'ADMIN'},process.env.ACCESS_TOKEN_SECRET);
async function call(path:string,token:string,method='GET',body?:unknown){return fetch(`http://127.0.0.1:${port}/api${path}`,{method,headers:{Authorization:`Bearer ${token}`,"X-Hygene-Workflow":"2","X-Hygene-App-Version":"2.0.0",...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});}
try{
 for(const [path,method] of [
  ['/verification-capabilities','GET'],
  [`/capture-session/${randomUUID()}/resume`,'POST'],
  [`/verification-attempt/${randomUUID()}`,'GET'],
  [`/task-instance/${finalRace.task.id}/verification/history`,'GET'],
  [`/verification-exceptions/${caseRow.id}/actions`,'POST'],
  [`/task-instance/${finalRace.task.id}/verification-issues`,'POST'],
 ]){
  const unauthorized=await fetch(`http://127.0.0.1:${port}/api${path}`,{method,headers:{'X-Hygene-Workflow':'2','X-Hygene-App-Version':'2.0.0'}});
  assert.equal(unauthorized.status,401,`scoped authentication must protect ${path}`);
 }
 // A dedicated worker keeps these start/finish cases independent of later session-rate tests.
 const startWorker=await prisma.staff.create({data:{name:'Start QR worker',email:`${randomUUID()}@test.invalid`,password:'test-only',companyId:company,locationId:location}});
 const startTemplate=await prisma.taskTemplate.create({data:{title:'Area QR start',locationId:location,staffId:startWorker.id,shiftStart:start,shiftEnd:end,effectiveDate:new Date(),verificationVersion:2,areaId:captureArea.id,inventoryConfigVersion:1,inventorySelection:'ALL',setupStatus:'READY'}});
 const startJwt=jwt.sign({id:startWorker.id,role:'STAFF'},process.env.ACCESS_TOKEN_SECRET);
 const pendingStart=await createTaskInstanceWithSnapshot({templateId:startTemplate.id,title:'Slow area QR start regression',locationId:location,date:new Date(Date.now()+777777),shiftStart:start,shiftEnd:end});assert.ok(pendingStart);
 await client.query(`CREATE FUNCTION slow_task_start_regression() RETURNS trigger LANGUAGE plpgsql AS $$
 BEGIN IF NEW.id = ${pendingStart.id} AND NEW.status = 'IN_PROGRESS' AND NEW."startedAt" IS DISTINCT FROM OLD."startedAt" THEN PERFORM pg_sleep(6); END IF; RETURN NEW; END $$;
 CREATE TRIGGER slow_task_start_regression BEFORE UPDATE ON "TaskInstance" FOR EACH ROW EXECUTE FUNCTION slow_task_start_regression();`);
 const startRequestAt=Date.now();
 const startArea=await prisma.area.findUniqueOrThrow({where:{id:captureArea.id}});
 const startBody={areaQr:signTaskQr(pendingStart,startArea)};
 assert.equal((await call(`/task-instance/${pendingStart.id}/start`,startJwt,'POST')).status,400,'start requires a fresh submitted area QR');
 for(const areaQr of [signAreaQr(inventory),signAreaQr({...startArea,qrVersion:startArea.qrVersion-1}),startBody.areaQr+'tamper']){
  const rejected=await call(`/task-instance/${pendingStart.id}/start`,startJwt,'POST',{areaQr});
  assert.equal(rejected.status,422);assert.equal((await rejected.json() as any).code,'AREA_QR_MISMATCH');
 }
 assert.equal((await prisma.taskInstance.findUniqueOrThrow({where:{id:pendingStart.id}})).status,'PENDING');
 const starts=await Promise.all([call(`/task-instance/${pendingStart.id}/start`,startJwt,'POST',startBody),call(`/task-instance/${pendingStart.id}/start`,startJwt,'POST',startBody)]);
 assert.ok(starts.every(r=>r.status===200),'valid area QR starts the task and concurrent retries are idempotent');
 assert.ok(Date.now()-startRequestAt>=6000,'start survives a real database delay longer than the former five-second timeout');
 const afterStart=await prisma.taskInstance.findUniqueOrThrow({where:{id:pendingStart.id},include:{assignments:true}});
 assert.equal(afterStart.status,'IN_PROGRESS');assert.equal(afterStart.assignments[0]!.status,'STARTED');
 assert.equal(afterStart.rowVersion,pendingStart.rowVersion+1,'concurrent retries record the start once');
 assert.equal(await prisma.captureSession.count({where:{taskInstanceId:pendingStart.id}}),0,'start QR must not issue finish capture authority');
 const startEvents=await prisma.auditLog.findMany({where:{entityId:pendingStart.id,action:'TASK_STARTED_AREA_QR'}});
 assert.equal(startEvents.length,1,'concurrent start records one marker event');
 assert.equal((startEvents[0]!.newValue as any).qrVersion,startArea.qrVersion);
 assert.ok(!JSON.stringify(startEvents).includes(startBody.areaQr),'audit must not retain QR credentials');
 const freshFinishBody={...sessionBody,requestId:randomUUID(),areaQr:startBody.areaQr,location:{...sessionBody.location,sampledAt:new Date().toISOString()}};
 assert.equal((await call(`/task-instance/${pendingStart.id}/capture-sessions`,startJwt,'POST',{...freshFinishBody,areaQr:''})).status>=400,true,'start QR does not authorize finish without its own scan');
 const finish=await call(`/task-instance/${pendingStart.id}/capture-sessions`,startJwt,'POST',freshFinishBody);
 assert.equal(finish.status,201,'same persistent marker can be freshly scanned to issue a distinct finish session');
 assert.equal(await prisma.captureSession.count({where:{taskInstanceId:pendingStart.id}}),1);

 await client.query('DROP TRIGGER slow_task_start_regression ON "TaskInstance"; DROP FUNCTION slow_task_start_regression();');
 const rollbackStart=await createTaskInstanceWithSnapshot({templateId:startTemplate.id,title:'Start assignment rollback regression',locationId:location,date:new Date(Date.now()+888888),shiftStart:start,shiftEnd:end});assert.ok(rollbackStart);
 await client.query(`CREATE FUNCTION fail_assignment_start_regression() RETURNS trigger LANGUAGE plpgsql AS $$
 BEGIN IF NEW.status = 'STARTED' AND NEW."taskInstanceId" = ${rollbackStart.id} THEN RAISE EXCEPTION 'Simulated assignment start failure'; END IF; RETURN NEW; END $$;
 CREATE TRIGGER fail_assignment_start_regression BEFORE UPDATE ON "TaskAssignment" FOR EACH ROW EXECUTE FUNCTION fail_assignment_start_regression();`);
 try{
  assert.equal((await call(`/task-instance/${rollbackStart.id}/start`,startJwt,'POST',startBody)).status,500);
  const rolledBack=await prisma.taskInstance.findUniqueOrThrow({where:{id:rollbackStart.id},include:{assignments:true}});
  assert.equal(rolledBack.status,'PENDING');assert.equal(rolledBack.startedAt,null);assert.equal(rolledBack.rowVersion,rollbackStart.rowVersion);
  assert.equal(rolledBack.assignments[0]!.status,'ASSIGNED');assert.equal(rolledBack.assignments[0]!.startedAt,null);
  assert.equal(await prisma.auditLog.count({where:{entityId:rollbackStart.id,action:'TASK_STARTED_AREA_QR'}}),0);
 }finally{await client.query('DROP TRIGGER fail_assignment_start_regression ON "TaskAssignment"; DROP FUNCTION fail_assignment_start_regression();');}
 console.log('PASS: slow-database concurrent task start exceeds five seconds safely, retries record once, and assignment failure rolls back the entire start');
 // Reproduce two-step creation: today's task was auto-assigned before the manager selected staff.
 const selectedWorker=await prisma.staff.create({data:{name:'Selected worker',email:`${randomUUID()}@test.invalid`,password:'test-only',companyId:company,locationId:location}});
 const assignmentTemplate=await prisma.taskTemplate.create({data:{title:'Assignment sync regression',locationId:location,shiftStart:start,shiftEnd:end,effectiveDate:new Date(),verificationVersion:2,areaId:captureArea.id,inventoryConfigVersion:1,inventorySelection:'ALL',setupStatus:'READY'}});
 const existingTask=await createTaskInstanceWithSnapshot({templateId:assignmentTemplate.id,title:assignmentTemplate.title,locationId:location,date:new Date(),shiftStart:start,shiftEnd:end});assert.ok(existingTask);
 await prisma.taskInstance.update({where:{id:existingTask.id},data:{staffId:captureStaff.id}});
 await prisma.taskAssignment.create({data:{taskInstanceId:existingTask.id,staffId:captureStaff.id}});
 const protectedTask=await createTaskInstanceWithSnapshot({templateId:assignmentTemplate.id,title:assignmentTemplate.title,locationId:location,date:new Date(Date.now()+86400000),shiftStart:new Date(+start+86400000),shiftEnd:new Date(+end+86400000)});assert.ok(protectedTask);
 await prisma.taskInstance.update({where:{id:protectedTask.id},data:{staffId:captureStaff.id,status:'IN_PROGRESS',startedAt:new Date()}});
 await prisma.taskAssignment.create({data:{taskInstanceId:protectedTask.id,staffId:captureStaff.id,status:'STARTED',startedAt:new Date()}});
 const patchPath=`/assignment/task-template/${assignmentTemplate.id}/staff/${selectedWorker.id}`;
 assert.equal((await call(patchPath,workerJwt,'PATCH')).status,403);
 const syncResponses=await Promise.all([call(patchPath,adminJwt,'PATCH'),call(patchPath,adminJwt,'PATCH')]);
 assert.ok(syncResponses.every(r=>r.status===200));
 const synced=await prisma.taskInstance.findUniqueOrThrow({where:{id:existingTask.id},include:{assignments:true}});
 assert.equal(synced.staffId,selectedWorker.id);assert.equal(synced.assignments.filter(a=>a.isCurrent).length,1);assert.equal(synced.assignments.find(a=>a.isCurrent)?.staffId,selectedWorker.id);
 assert.equal(synced.assignments.find(a=>a.staffId===captureStaff.id)?.status,'REASSIGNED');
 assert.equal(await prisma.auditLog.count({where:{entityId:existingTask.id,action:'TEMPLATE_STAFF_ASSIGNMENT_SYNC'}}),1);
 assert.equal((await prisma.taskInstance.findUniqueOrThrow({where:{id:protectedTask.id}})).staffId,captureStaff.id,'Started work remains with its worker');
 const selectedJwt=jwt.sign({id:selectedWorker.id,role:'STAFF'},process.env.ACCESS_TOKEN_SECRET);
 const selectedFeed=await call(`/task-instance/staff/${selectedWorker.id}/today`,selectedJwt);
 assert.equal(selectedFeed.status,200);assert.ok((await selectedFeed.json() as any).data.some((t:any)=>t.id===existingTask.id),'Selected staff sees the already-generated task immediately');
 assert.equal((await call(`/task-instance/${existingTask.id}`,workerJwt)).status,403,'Previous worker loses task access');
 const graceCutoff=new Date(Date.now()-10*60000);
 assert.equal(await prisma.taskAssignment.count({where:{taskInstanceId:existingTask.id,isCurrent:true,status:'ASSIGNED',assignedAt:{lt:graceCutoff}}}),0,'New assignment receives a full start grace period');
 console.log('PASS: existing-task assignment sync, concurrent idempotency, started-task preservation, selected-worker feed, previous-worker isolation and fresh start grace');
 const assignmentRollbackWorker=await prisma.staff.create({data:{name:'Rollback worker',email:`${randomUUID()}@test.invalid`,password:'test-only',companyId:company,locationId:location}});
 const assignmentRollbackTask=await createTaskInstanceWithSnapshot({templateId:assignmentTemplate.id,title:assignmentTemplate.title,locationId:location,date:new Date(Date.now()+2000),shiftStart:start,shiftEnd:end});assert.ok(assignmentRollbackTask);
 await client.query(`CREATE FUNCTION fail_template_assignment_regression() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."taskInstanceId"=${assignmentRollbackTask.id} AND NEW."staffId"=${assignmentRollbackWorker.id} THEN RAISE EXCEPTION 'Simulated template assignment failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER fail_template_assignment_regression BEFORE INSERT ON "TaskAssignment" FOR EACH ROW EXECUTE FUNCTION fail_template_assignment_regression();`);
 try{
  const rejectedAssignment=await call(`/assignment/task-template/${assignmentTemplate.id}/staff/${assignmentRollbackWorker.id}`,adminJwt,'PATCH');assert.equal(rejectedAssignment.status,500);
  assert.equal((await prisma.taskTemplate.findUniqueOrThrow({where:{id:assignmentTemplate.id}})).staffId,selectedWorker.id);
  for(const id of [existingTask.id,assignmentRollbackTask.id]){
   const preserved=await prisma.taskInstance.findUniqueOrThrow({where:{id},include:{assignments:{where:{isCurrent:true}}}});
   assert.equal(preserved.staffId,selectedWorker.id);assert.equal(preserved.assignments.length,1);assert.equal(preserved.assignments[0]!.staffId,selectedWorker.id);
  }
 }finally{await client.query('DROP TRIGGER fail_template_assignment_regression ON "TaskAssignment"; DROP FUNCTION fail_template_assignment_regression();');}
 console.log('PASS: assignment failure rolls back template, all task owners and current assignments together');

 const historicalPending=await prisma.taskInstance.create({data:{title:'Historical pending fixture',locationId:location,staffId:captureStaff.id,date:new Date(),shiftStart:start,shiftEnd:end,assignments:{create:{staffId:captureStaff.id}}}});
 const historicalStart=await call(`/task-instance/${historicalPending.id}/start?qrToken=room-qr`,workerJwt,'POST');
 assert.equal(historicalStart.status,409);assert.equal((await historicalStart.json() as any).code,'INVENTORY_SETUP_REQUIRED');
 assert.equal((await prisma.taskInstance.findUniqueOrThrow({where:{id:historicalPending.id}})).status,'PENDING','retiring legacy start cannot convert or start historical work');
 assert.equal((await call(`/task-instance/${pendingStart.id}/complete`,startJwt,'POST')).status,409,'old endpoint cannot complete unresolved requirements');
 assert.equal((await call(`/task-instance/${pendingStart.id}/area/1/scan`,startJwt,'POST')).status,410);
 const oldPhoto=new FormData();oldPhoto.append('photo',new Blob(['not an image']),'old.jpg');
 const retiredUpload=await fetch(`http://127.0.0.1:${port}/api/task-instance/${pendingStart.id}/area/1/upload`,{method:'POST',headers:{Authorization:`Bearer ${startJwt}`},body:oldPhoto});
 assert.equal(retiredUpload.status,410,'retired photo endpoints reject before multipart decode/storage');
 assert.equal((await call(`/task-instance/${pendingStart.id}`,adminJwt)).status,200,'admin can read scoped guided task detail');
 assert.equal((await call(`/task-instance/staff/${staff.id}/today`,workerJwt)).status,403,'staff cannot load another worker feed');
 assert.equal((await call(`/task-instance/${finalRace.task.id}/complete`,workerJwt,'POST')).status,200,'already-finalized completion is only read back');
 console.log('PASS: area QR required at start and finish, distinct finish sessions, legacy writer retirement, no completion bypass and scoped task reads');
 const manifest=await call(`/task-instance/${finalRace.task.id}/verification`,workerJwt);assert.equal(manifest.status,200);const dto:any=await manifest.json();assert.equal(dto.data.outcome,'VERIFIED_COMPLETE');assert.equal(typeof dto.data.items[0].name,'string');assert.equal(typeof dto.data.items[0].requirements[0].instructions,'string');assert.equal(dto.data.allowedActions.createSession,false);
 for(const session of dto.data.sessions)for(const slot of session.slots)if(slot.attemptId){
  assert.ok(Object.hasOwn(slot,'instructions'),'Context photo results include safe staff instructions');
  assert.equal(slot.qualityResult,undefined);assert.equal(slot.coverageResult,undefined);assert.equal(slot.cleanlinessResult,undefined);
 }
 const work=await call('/task-instance/staff/me/verification-work',workerJwt);assert.equal(work.status,200);assert.ok(Array.isArray((await work.json() as any).data.tasks));
 const casesResponse=await call('/verification-exceptions?state=MANAGER_REVIEW',adminJwt);assert.equal(casesResponse.status,200);const casesDto:any=await casesResponse.json();assert.ok(Array.isArray(casesDto.data.cases));
 const forbiddenInbox=await call('/verification-exceptions',workerJwt);assert.equal(forbiddenInbox.status,403);
 const detail=await call(`/verification-exceptions/${caseRow.id}`,adminJwt);const detailDto:any=await detail.json();assert.equal(detail.status,200,JSON.stringify(detailDto));assert.ok(Array.isArray(detailDto.data.events));
 const read=await call(`/verification-exceptions/${caseRow.id}/read`,adminJwt,'POST',{});assert.equal(read.status,200);assert.equal((await read.json() as any).data.managerId,actor.id);
 const obsolete=await fetch(`http://127.0.0.1:${port}/api/task-instance/${retakeRace.task.id}/capture-sessions`,{method:'POST',headers:{Authorization:`Bearer ${workerJwt}`,'Content-Type':'application/json'},body:JSON.stringify(sessionBody)});assert.equal(obsolete.status,426);assert.equal((await obsolete.json() as any).code,'NATIVE_APP_UPGRADE_REQUIRED');
 const capabilities=await call('/verification-capabilities',workerJwt);assert.equal((await capabilities.json() as any).data.automaticCleanlinessPassing,false);
 const waivedManifest=await call(`/task-instance/${capturedTask.id}/verification`,workerJwt);assert.equal(waivedManifest.status,200);const waivedDto:any=await waivedManifest.json();assert.ok(waivedDto.data.items.flatMap((item:any)=>item.requirements).every((requirement:any)=>requirement.manualOutcome==='WAIVED'));
 for(const requirement of waivedDto.data.items.flatMap((item:any)=>item.requirements))if(requirement.currentAttempt){assert.equal(requirement.currentAttempt.manualOutcome,'WAIVED');assert.equal(requirement.currentAttempt.cleanlinessOutcome,null);assert.equal(requirement.currentAttempt.retryAction,null);}
 const failedAttemptDto=await call(`/verification-attempt/${failureAttempt.id}`,workerJwt);assert.equal(failedAttemptDto.status,200);const failureDto:any=await failedAttemptDto.json();assert.equal(failureDto.data.cleanlinessOutcome,'NEEDS_REVIEW');assert.equal(failureDto.data.reviewReason,'SERVICE_FAILURE');
 const history=await call(`/task-instance/${finalRace.task.id}/verification/history`,adminJwt);assert.equal(history.status,200);const historyDto:any=await history.json();assert.ok(historyDto.data.attempts.length);assert.equal(typeof historyDto.data.attempts[0].staff.name,'string');assert.equal(historyDto.data.attempts[0].cleanlinessResult,undefined);
 const spatialExport=await call(`/task-instance/${spatialFixture.task.id}/verification/spatial-evaluation`,adminJwt);assert.equal(spatialExport.status,200);const spatialExportDto:any=await spatialExport.json();assert.equal(spatialExportDto.data.attempts.length,2);assert.equal(spatialExportDto.data.autoIdentityAcceptance,false);assert.equal(spatialExportDto.data.attempts[0].humanGroundTruth,'UNKNOWN');assert.equal(spatialExportDto.data.attempts[0].committedHash,undefined);
 assert.equal((await call(`/task-instance/${spatialFixture.task.id}/verification/spatial-evaluation`,workerJwt)).status,403,'spatial evaluation export is not staff navigation/API');
 const durableReportTask=failureRace;const report={requestId:randomUUID(),reasonCode:'DAMAGED',requestHelp:true,note:'Fixture is damaged'};
 const auditBefore=await prisma.auditLog.count({where:{entityId:durableReportTask.task.id,action:'VERIFICATION_ISSUE_REPORTED'}});
 assert.equal((await call(`/task-instance/${durableReportTask.task.id}/verification-issues`,workerJwt,'POST',report)).status,200);
 assert.equal((await call(`/task-instance/${durableReportTask.task.id}/verification-issues`,workerJwt,'POST',report)).status,200);
 assert.equal(await prisma.auditLog.count({where:{entityId:durableReportTask.task.id,action:'VERIFICATION_ISSUE_REPORTED'}}),auditBefore+1,'Response loss retries do not duplicate issue audit/events');
 assert.equal((await call(`/task-instance/${durableReportTask.task.id}/verification-issues`,workerJwt,'POST',{...report,reasonCode:'INACCESSIBLE'})).status,409);
 const invalidCapture=await call('/task-instance/not-an-id/capture-sessions',workerJwt,'POST',sessionBody);assert.equal(invalidCapture.status,400);
 const managerCapture=await call(`/task-instance/${retakeRace.task.id}/capture-sessions`,adminJwt,'POST',sessionBody);assert.equal(managerCapture.status,403);
 console.log('PASS: real HTTP verification DTO, resumable work, scoped exception API, read receipts, invalid IDs and role boundaries');
}finally{await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));}

const escalation=await freshCaptureTask('Three cleaning failures',contextReworkTemplate.id,contextReworkActor);let escalationSlot=escalation.session.slots.find(s=>s.requirementId)!;
for(let failure=1;failure<=3;failure++){
 const currentSession=await prisma.captureSession.findUniqueOrThrow({where:{id:escalation.session.id},include:{slots:true}});const sl=currentSession.slots.find(s=>s.id===escalationSlot.id)!;
 const fullSession={...escalation.session,slots:[{...sl,nonce:(await import('../src/services/verification-v2/qr.service.js')).slotNonce(currentSession.id,sl.id,sl.generation)}]};
 const a=await ingestFixture(fullSession,sl.id,650+failure,contextReworkActor);for(const stage of ['QUALITY','PRIVACY','COVERAGE','CLEANLINESS'])await executeStage(a.id,stage);
 assert.equal(await prisma.verificationException.count({where:{taskInstanceId:escalation.task.id}}),failure===3?1:0,'only third cleaning failure escalates');
 if(failure<3){const r=await prisma.taskEvidenceRequirement.findUniqueOrThrow({where:{id:sl.requirementId!}});const ar=await prisma.area.findUniqueOrThrow({where:{id:captureArea.id}});escalation.session=await createReworkCaptureSession(contextReworkActor,escalation.task.id,{...sessionBody,requestId:randomUUID(),areaQr:signTaskQr(escalation.task,ar),location:{...sessionBody.location,sampledAt:new Date().toISOString()},requirements:[{requirementId:r.id,expectedGeneration:r.decisionVersion}]});escalationSlot=escalation.session.slots.find(s=>s.requirementId===r.id)!;}
}
assert.equal(await prisma.verificationIssue.count({where:{exception:{taskInstanceId:escalation.task.id}}}),1);
const cannotAssess=await freshCaptureTask('Cannot assess');const cannotSlot=cannotAssess.session.slots.find(s=>s.requirementId)!;const cannotAttempt=await ingestFixture(cannotAssess.session,cannotSlot.id,762);for(const stage of ['QUALITY','PRIVACY','COVERAGE'])await executeStage(cannotAttempt.id,stage);
const cannotJob=await prisma.verificationJob.findFirstOrThrow({where:{attemptId:cannotAttempt.id,stage:'CLEANLINESS'}});const cannotRunning=await prisma.verificationJob.update({where:{id:cannotJob.id},data:{state:'RUNNING',attempts:1,leaseToken:randomUUID(),leaseUntil:new Date(Date.now()+90000)}});
const cannotProvider={assess:async(stage:string,prompt:string)=>{const assessment=await fakeProvider.assess(stage,prompt);if(stage==='cleanliness'){assessment.result={verdict:'CANNOT_ASSESS',surfaces:(assessment.result as any).surfaces.map((s:any)=>({...s,verdict:'CANNOT_ASSESS'})),reasonCode:'CANNOT_ASSESS'} as any;}return assessment;}};
await processVerificationJob(cannotRunning,cannotProvider as any,captureIo.read,{evaluate:(image,rubric,view)=>assessCleanliness(cannotProvider as any,image,rubric,view)});assert.equal((await prisma.taskEvidenceRequirement.findUniqueOrThrow({where:{id:cannotSlot.requirementId!}})).state,'RECAPTURE_REQUIRED');assert.equal(await prisma.verificationException.count({where:{taskInstanceId:cannotAssess.task.id}}),0);
// Exercise the actual Clef adapter through durable stage publication; HTTP is mocked.
process.env.CLOUDFLARE_ACCOUNT_ID='a'.repeat(32);process.env.CLOUDFLARE_API_TOKEN='test-only';
process.env.CLEF_MODEL='clef';process.env.CLEF_CONFIDENCE_THRESHOLD='0.9';process.env.CLEF_THRESHOLD_VERSION='synthetic-candidate-v1';
delete process.env.CLEF_RELEASE_RECORD_PATH;delete process.env.CLEF_RELEASE_RECORD_SHA256;
const clefStaff=await prisma.staff.create({data:{name:'Clef test worker',email:`${randomUUID()}@test.invalid`,password:'test-only',companyId:company,locationId:location}});
const clefActor={id:clefStaff.id,companyId:company,role:'STAFF' as const};
const clefTemplate=await prisma.taskTemplate.create({data:{title:'Clef test',locationId:location,staffId:clefStaff.id,shiftStart:start,shiftEnd:end,effectiveDate:new Date(),verificationVersion:2,areaId:captureArea.id,inventoryConfigVersion:1,inventorySelection:'ALL',setupStatus:'READY'}});
async function clefCaptureTask(label:string){
 const t=await createTaskInstanceWithSnapshot({templateId:clefTemplate.id,title:label,locationId:location,date:new Date(Date.now()+Math.floor(Math.random()*1000000)),shiftStart:start,shiftEnd:end});assert.ok(t);
 await prisma.taskInstance.update({where:{id:t.id},data:{status:'IN_PROGRESS',startedAt:start}});await prisma.taskAssignment.updateMany({where:{taskInstanceId:t.id},data:{status:'STARTED',startedAt:start}});
 const ar=await prisma.area.findUniqueOrThrow({where:{id:captureArea.id}});return {task:t,session:await createCaptureSession(clefActor,t.id,{...sessionBody,requestId:randomUUID(),areaQr:signTaskQr(t,ar),location:{...sessionBody.location,sampledAt:new Date().toISOString()}})};
}
// Synthetic records below exercise the release validator only. They are never
// development evidence, reviewed washroom measurements, or deployment approvals.
const {calibrateCleanliness,createCleanlinessRelease,cleanlinessReleaseStatus,digest}=await import('../src/services/verification-v2/cleanlinessRelease.js');
const {clefEvaluatorVersion}=await import('../src/services/verification-v2/clefConfiguration.js');
const releaseTestDirectory=await mkdtemp('/tmp/hygene-isolated-release-');
function syntheticReleaseRow(i:number,split:'development'|'heldout',label:'CLEAN'|'DIRTY'|'CANNOT_ASSESS',identity:'CORRECT'|'WRONG'|'REPLAYED'='CORRECT'){
 const confidence=label==='DIRTY'?.7:.98,predicted=label==='DIRTY'?'CANNOT_ASSESS':label,choice=label==='DIRTY'?'CLEAN':label;
 return {id:`${split}-${i}`,roomId:`${split}-synthetic-room`,fixtureId:`${split}-${i}`,fixtureType:'TOILET',split,consented:true as const,visibility:label==='CANNOT_ASSESS'?'UNASSESSABLE' as const:'ASSESSABLE' as const,identity,cleanliness:label,confidence,threshold:.98,thresholdVersion:'integration-only-candidate',provider:'cloudflare',model:'clef',promptVersion:'clef-surfaces-v1',providerVersion:'cloudflare-system-one-v1',requestedModel:'@cf/cloudflare/clef',rubricVersion:1,latencyMs:10,costUsd:null,evaluatorVersion:clefEvaluatorVersion(),imageSha256:digest(`synthetic-only-image-${split}-${i}`),evaluationInputHash:digest(`synthetic-only-label-${split}-${i}`),predictedCleanliness:predicted,wouldAutoPass:predicted==='CLEAN'&&identity==='CORRECT',predictedCoverage:identity==='CORRECT'?'MATCH' as const:'WRONG_ITEM' as const,identityConsistent:identity==='CORRECT',qualityPassed:true,privacySafe:true,duplicateClear:true,assessment:{result:{verdict:predicted,confidence,reasonCode:predicted==='CLEAN'?'CLEAN':'CANNOT_ASSESS',surfaces:[{surface:'bowl',verdict:predicted}],details:{threshold:.98,thresholdVersion:'integration-only-candidate',assessmentStatus:'ASSESSED',predictions:[{surface:'bowl',type:'choice',choice,confidence,probabilities:{CLEAN:choice==='CLEAN'?.98:.01,DIRTY:.01,CANNOT_ASSESS:choice==='CANNOT_ASSESS'?.98:.01}}]}}}};
}
function syntheticReleaseRows(split:'development'|'heldout'){
 return [...Array.from({length:100},(_,i)=>syntheticReleaseRow(i,split,'DIRTY')),...Array.from({length:20},(_,i)=>syntheticReleaseRow(i+100,split,'CLEAN')),...Array.from({length:20},(_,i)=>syntheticReleaseRow(i+120,split,'CANNOT_ASSESS')),...(split==='heldout'?Array.from({length:100},(_,i)=>syntheticReleaseRow(i+140,split,'CLEAN',i%2?'WRONG':'REPLAYED')):[])];
}
async function configureSyntheticRelease(mode:string){
 process.env.CLEF_CONFIDENCE_THRESHOLD='.98';process.env.CLEF_THRESHOLD_VERSION='integration-only-candidate';
 const now=new Date(),development=syntheticReleaseRows('development'),heldout=syntheticReleaseRows('heldout');
 const calibration=calibrateCleanliness(development,digest(JSON.stringify(development)),'integration-only-candidate',new Date(+now-1000));
 const review={labelledBy:'SYNTHETIC_TEST_ONLY',evaluatedBy:'SYNTHETIC_TEST_ONLY',reviewedBy:'SYNTHETIC_TEST_ONLY',reviewedAt:now.toISOString(),expiresAt:new Date(+now+86400000).toISOString(),labelsManifestSha256:digest('synthetic-test-only'),independentHumanLabels:true,consentVerified:true,representativeRoomsVerified:true};
 const record=createCleanlinessRelease(heldout,calibration,review,digest(JSON.stringify(heldout)),now),bytes=JSON.stringify(record),path=`${releaseTestDirectory}/${mode}.json`;
 await writeFile(path,mode==='TAMPERED_TEST_RELEASE'?'{}':bytes);process.env.CLEF_RELEASE_RECORD_PATH=path;process.env.CLEF_RELEASE_RECORD_SHA256=digest(bytes);
 if(mode==='CONFIG_CHANGED_TEST_RELEASE')process.env.CLEF_THRESHOLD_VERSION='changed-integration-only-candidate';
 assert.equal(cleanlinessReleaseStatus('TOILET',1).allowed,mode==='VALIDATED_TEST_RELEASE');
 assert.equal(cleanlinessReleaseStatus('SINK',1).allowed,false);assert.equal(cleanlinessReleaseStatus('TOILET',2).allowed,false);
}
const originalFetch=globalThis.fetch;let clefCalls=0;
let clefMode='CLEAN';
globalThis.fetch=async (url,options)=>{
 assert.ok(String(url).includes('/ai/run/@cf/cloudflare/clef'),'mock must not make vendor requests');clefCalls++;
 if(clefMode==='TIMEOUT')throw new DOMException('synthetic timeout','TimeoutError');
 if(clefMode==='RATE_LIMIT')return new Response('{}',{status:429});
 if(clefMode==='MALFORMED')return new Response(JSON.stringify({success:true,result:{model:'clef',answers:{}}}));
 const request=JSON.parse(String(options!.body));
 const choice=['LOW_CONFIDENCE','THRESHOLD_MISSING','VALIDATED_TEST_RELEASE','TAMPERED_TEST_RELEASE','CONFIG_CHANGED_TEST_RELEASE'].includes(clefMode)?'CLEAN':clefMode;
 const answer={type:'choice',choice,confidence:clefMode==='LOW_CONFIDENCE'?.5:.98,probabilities:{CLEAN:choice==='CLEAN'?.98:.01,DIRTY:choice==='DIRTY'?.98:.01,CANNOT_ASSESS:choice==='CANNOT_ASSESS'?.98:.01}};
 return new Response(JSON.stringify({success:true,result:{model:'clef',answers:Object.fromEntries(Object.keys(request.questions).map(key=>[key,answer])),usage:{input_tokens:22,output_tokens:0}}}));
};
try{
 for(const mode of ['CLEAN','DIRTY','LOW_CONFIDENCE','TIMEOUT','RATE_LIMIT','THRESHOLD_MISSING','MALFORMED','VALIDATED_TEST_RELEASE','TAMPERED_TEST_RELEASE','CONFIG_CHANGED_TEST_RELEASE']){
  if(mode==='THRESHOLD_MISSING'){delete process.env.CLEF_CONFIDENCE_THRESHOLD;delete process.env.CLEF_THRESHOLD_VERSION;}
  else {process.env.CLEF_CONFIDENCE_THRESHOLD='0.9';process.env.CLEF_THRESHOLD_VERSION='synthetic-candidate-v1';}
  delete process.env.CLEF_RELEASE_RECORD_PATH;delete process.env.CLEF_RELEASE_RECORD_SHA256;
  if(mode.endsWith('_TEST_RELEASE'))await configureSyntheticRelease(mode);
  clefMode=mode;const fixture=await clefCaptureTask('Clef '+mode),sl=fixture.session.slots.find(s=>s.requirementId)!;
  const uniquePhoto=await sharp(randomBytes(640*640*3),{raw:{width:640,height:640,channels:3}}).jpeg().toBuffer();
  const a=await ingestFixture(fixture.session,sl.id,1000+clefCalls,clefActor,uniquePhoto);
  for(const stage of ['QUALITY','PRIVACY','COVERAGE'])await executeStage(a.id,stage);
  let j=await prisma.verificationJob.findFirstOrThrow({where:{attemptId:a.id,stage:'CLEANLINESS'}});
  const run=async()=>{j=await prisma.verificationJob.update({where:{id:j.id},data:{state:'RUNNING',attempts:{increment:1},leaseToken:randomUUID(),leaseUntil:new Date(Date.now()+90000)}});return processVerificationJob(j,fakeProvider as any,captureIo.read);};
  const beforeProviderAttempt=await prisma.verificationAttempt.findUniqueOrThrow({where:{id:a.id}});
  if(mode==='THRESHOLD_MISSING'){
   await assert.rejects(run,/PROVIDER_THRESHOLD_NOT_CONFIGURED/);
   await failVerificationJob(j,'PROVIDER_THRESHOLD_NOT_CONFIGURED',()=>.5,{provider:'cloudflare',assessmentStatus:'THRESHOLD_UNCONFIGURED'});
   const failed=await prisma.verificationJob.findUniqueOrThrow({where:{id:j.id}}),savedAttempt=await prisma.verificationAttempt.findUniqueOrThrow({where:{id:a.id}}),savedRequirement=await prisma.taskEvidenceRequirement.findUniqueOrThrow({where:{id:sl.requirementId!}});
   assert.equal(failed.state,'FAILED');assert.equal(failed.attempts,1);assert.equal(failed.lastErrorCode,'PROVIDER_THRESHOLD_NOT_CONFIGURED');
   assert.equal(savedAttempt.state,'SERVICE_FAILURE');assert.equal(savedAttempt.cleanlinessResult,null);
   assert.equal(savedAttempt.mediaAssetId,beforeProviderAttempt.mediaAssetId);assert.equal(savedAttempt.committedHash,beforeProviderAttempt.committedHash);
   assert.equal(savedRequirement.state,'REVIEW_REQUIRED');assert.equal(savedRequirement.currentAttemptId,a.id);
   assert.deepEqual({outcome:staffAttemptResult(savedAttempt,true).cleanlinessOutcome,reason:staffAttemptResult(savedAttempt,true).reviewReason},{outcome:'NEEDS_REVIEW',reason:'SERVICE_FAILURE'});
   assert.equal(await prisma.verificationAttempt.count({where:{requirementId:sl.requirementId}}),1,'missing threshold retains original photo without asking for another capture');
   assert.equal(await prisma.verificationAttempt.count({where:{requirementId:sl.requirementId,state:{in:['CLEANING_REQUIRED','RECAPTURE_REQUIRED']}}}),0,'configuration uncertainty is never dirt or a photo fault');
   assert.equal(await prisma.captureSlot.count({where:{sessionId:fixture.session.id}}),fixture.session.slots.length);
   assert.equal((await prisma.verificationIssue.findFirstOrThrow({where:{exception:{taskInstanceId:fixture.task.id}}})).reasonCode,'SERVICE_FAILURE');
   continue;
  }
  if(mode==='MALFORMED'){
   await assert.rejects(run,/PROVIDER_MALFORMED/);const originalJobId=j.id;
   await failVerificationJob(j,'PROVIDER_MALFORMED',()=>.5,{provider:'cloudflare',assessmentStatus:'INVALID_RESPONSE'});
   const waiting=await prisma.verificationJob.findUniqueOrThrow({where:{id:j.id}}),retained=await prisma.verificationAttempt.findUniqueOrThrow({where:{id:a.id}});
   assert.equal(waiting.state,'RETRY_WAIT');assert.equal(waiting.lastErrorCode,'PROVIDER_MALFORMED');
   assert.equal(retained.state,'RETRY_WAIT');assert.equal(staffAttemptResult(retained,true).cleanlinessOutcome,null);assert.equal(staffAttemptResult(retained,true).reviewReason,null);assert.equal(retained.cleanlinessResult,null);assert.equal(retained.mediaAssetId,beforeProviderAttempt.mediaAssetId);
   const processing=await prisma.taskEvidenceRequirement.findUniqueOrThrow({where:{id:sl.requirementId!}});assert.equal(processing.state,'PROCESSING');assert.equal(processing.currentAttemptId,a.id);
   clefMode='CLEAN';await run();assert.equal(j.id,originalJobId,'malformed provider response retries the same durable job');
   assert.equal(await prisma.verificationAttempt.count({where:{requirementId:sl.requirementId}}),1);assert.equal(await prisma.verificationJob.count({where:{attemptId:a.id,stage:'CLEANLINESS'}}),1);
   assert.equal((await prisma.verificationAttempt.findUniqueOrThrow({where:{id:a.id}})).mediaAssetId,beforeProviderAttempt.mediaAssetId,'provider retry reuses original protected evidence');
   assert.equal(await prisma.captureSlot.count({where:{sessionId:fixture.session.id}}),fixture.session.slots.length);
  }else if(mode==='TIMEOUT'){
   await assert.rejects(run,/PROVIDER_TIMEOUT/);await failVerificationJob(j,'PROVIDER_TIMEOUT',()=>.5,{provider:'cloudflare',status:'SERVICE_FAILURE'});
   assert.equal((await prisma.verificationJob.findUniqueOrThrow({where:{id:j.id}})).state,'RETRY_WAIT');
   clefMode='CLEAN';await run();
  }else if(mode==='RATE_LIMIT'){
   for(let retry=0;retry<4;retry++){await assert.rejects(run,/PROVIDER_RATE_LIMIT/);await failVerificationJob(j,'PROVIDER_RATE_LIMIT');}
   assert.equal((await prisma.verificationJob.findUniqueOrThrow({where:{id:j.id}})).state,'FAILED');
   assert.equal((await prisma.verificationAttempt.findUniqueOrThrow({where:{id:a.id}})).state,'SERVICE_FAILURE');
   assert.equal((await prisma.taskEvidenceRequirement.findUniqueOrThrow({where:{id:sl.requirementId!}})).state,'REVIEW_REQUIRED');
   assert.equal(await prisma.verificationAttempt.count({where:{requirementId:sl.requirementId,state:'CLEANING_REQUIRED'}}),0);
   continue;
  }else await run();
  const persisted=await prisma.verificationAttempt.findUniqueOrThrow({where:{id:a.id}});
  const saved=persisted.cleanlinessResult as any;
  assert.equal(saved.result.verdict,mode==='LOW_CONFIDENCE'?'CANNOT_ASSESS':mode==='DIRTY'?'DIRTY':'CLEAN');
  assert.equal(saved.metadata.provider,'cloudflare');assert.equal(saved.result.confidence,mode==='LOW_CONFIDENCE'?.5:.98);
  assert.equal(saved.retryCount,['TIMEOUT','MALFORMED'].includes(mode)?1:0);
  assert.equal(persisted.state,mode==='DIRTY'?'CLEANING_REQUIRED':mode==='LOW_CONFIDENCE'?'RECAPTURE_REQUIRED':mode==='VALIDATED_TEST_RELEASE'?'PASSED':'REVIEW_REQUIRED');
  const staffOutcome=staffAttemptResult(persisted,true);assert.equal(staffOutcome.cleanlinessOutcome,mode==='DIRTY'?'DIRTY':mode==='VALIDATED_TEST_RELEASE'?'CLEAN':'NEEDS_REVIEW');assert.equal(staffOutcome.reviewReason,['DIRTY','VALIDATED_TEST_RELEASE'].includes(mode)?null:mode==='LOW_CONFIDENCE'?'CANNOT_ASSESS':'AUTO_PASS_NOT_VALIDATED');
  if(mode==='LOW_CONFIDENCE')assert.equal(staffOutcome.retryAction,'REQUEST_RETAKE_SLOT');if(mode==='DIRTY')assert.equal(staffOutcome.retryAction,'SCAN_QR_FOR_REWORK');
  assert.equal(saved.policyDecisionReason,mode==='DIRTY'?'CLEANING_REQUIRED':mode==='LOW_CONFIDENCE'?'CANNOT_ASSESS':mode==='VALIDATED_TEST_RELEASE'?'CLEAN':'AUTO_PASS_NOT_VALIDATED','assessment and policy reason publish atomically');
  if(mode==='CLEAN'){
   await assert.rejects(()=>prisma.verificationAttempt.update({where:{id:a.id},data:{cleanlinessResult:{...saved,policyDecisionReason:'CLEANING_REQUIRED'}}}),/Attempt assessments are immutable/,'decision reason cannot rewrite a published assessment');
   assert.deepEqual((await prisma.verificationAttempt.findUniqueOrThrow({where:{id:a.id}})).cleanlinessResult,saved);
  }
  const before=clefCalls;assert.equal(await processVerificationJob(j,fakeProvider as any,captureIo.read),false);assert.equal(clefCalls,before,'successful stage cannot be re-inferred');
  assert.notEqual((await prisma.taskInstance.findUniqueOrThrow({where:{id:fixture.task.id}})).completionOutcome,'VERIFIED_COMPLETE');
  if(mode==='LOW_CONFIDENCE'){
   for(let retry=2;retry<=3;retry++){
    const r=await prisma.taskEvidenceRequirement.findUniqueOrThrow({where:{id:sl.requirementId!}});
    const slots=await retakeSlots(clefActor,fixture.session.id,{deviceId:'device-a',requirements:[{requirementId:r.id,expectedGeneration:r.decisionVersion}]});
    const fullSession={...fixture.session,slots};const bytes=await sharp(randomBytes(640*640*3),{raw:{width:640,height:640,channels:3}}).jpeg().toBuffer();
    const retryAttempt=await ingestFixture(fullSession,slots[0]!.id,1100+retry,clefActor,bytes);
    for(const stage of ['QUALITY','PRIVACY','COVERAGE'])await executeStage(retryAttempt.id,stage);
    const queued=await prisma.verificationJob.findFirstOrThrow({where:{attemptId:retryAttempt.id,stage:'CLEANLINESS'}});
    const running=await prisma.verificationJob.update({where:{id:queued.id},data:{state:'RUNNING',attempts:1,leaseToken:randomUUID(),leaseUntil:new Date(Date.now()+90000)}});
    await processVerificationJob(running,fakeProvider as any,captureIo.read);
    assert.equal(await prisma.verificationException.count({where:{taskInstanceId:fixture.task.id}}),retry===3?1:0,'Clef uncertainty escalates only at existing recapture limit');
    assert.equal(await prisma.verificationAttempt.count({where:{requirementId:r.id,state:'CLEANING_REQUIRED'}}),0);
   }
  }
 }
}finally{globalThis.fetch=originalFetch;delete process.env.CLEF_RELEASE_RECORD_PATH;delete process.env.CLEF_RELEASE_RECORD_SHA256;}
console.log('PASS: actual Clef adapter contract, prediction persistence, CLEAN gate, DIRTY rework, uncertainty, timeout retry, rate-limit exhaustion, threshold configuration failure, malformed same-photo recovery, explicit CLEAN/DIRTY/NEEDS_REVIEW, pinned synthetic gate acceptance/tamper/config refusal and no rebilling');

const maintenance=await freshCaptureTask('Maintenance is not completion');const maintenanceRequirement=await prisma.taskEvidenceRequirement.findFirstOrThrow({where:{item:{taskInstanceId:maintenance.task.id}}});const maintenanceCase=await prisma.$transaction(tx=>raiseIssue(tx,maintenance.task.id,'DAMAGED',maintenanceRequirement.id));assert.ok(maintenanceCase);
await managerDecision(actor,maintenanceCase.id,{requestId:randomUUID(),expectedVersion:maintenanceCase.rowVersion,requirementId:maintenanceRequirement.id,action:'MARK_MAINTENANCE',reasonCode:'DAMAGED',note:'Fixture requires maintenance; this does not waive cleaning evidence'});
assert.equal((await prisma.taskEvidenceRequirement.findUniqueOrThrow({where:{id:maintenanceRequirement.id}})).state,'MISSING');assert.notEqual((await prisma.taskInstance.findUniqueOrThrow({where:{id:maintenance.task.id}})).status,'COMPLETED');assert.equal((await prisma.taskTemplate.findUniqueOrThrow({where:{id:captureTemplate.id}})).setupStatus,'NEEDS_REVIEW');
console.log('PASS: third-failure escalation, CANNOT_ASSESS targeted recapture and maintenance never satisfying mandatory evidence');

const {screenStandardPrivacy}=await import('../src/services/verification-v2/standardPrivacy.service.js');
async function standardFixture(seed:number){const bytes=await photoFor(seed);const asset=await storeStandardEvidence(actor,location,bytes,captureIo);const row=await prisma.areaStandardPhoto.create({data:{areaId:captureArea.id,mediaAssetId:asset.id,createdByManagerId:actor.id}});return {row,asset};}
const safeStandard=await standardFixture(901);let enterStandard!:()=>void,releaseStandard!:()=>void;
const standardEntered=new Promise<void>(resolve=>enterStandard=resolve),standardGate=new Promise<void>(resolve=>releaseStandard=resolve);
const standardProvider={assess:async(stage:string,prompt:string)=>{enterStandard();await standardGate;return fakeProvider.assess(stage,prompt);}};
const standardCheck=screenStandardPrivacy(actor,safeStandard.row.id,standardProvider as any,captureIo.read);await standardEntered;
await assert.rejects(()=>screenStandardPrivacy(actor,safeStandard.row.id,fakeProvider as any,captureIo.read,{evaluate:(image,rubric,view)=>assessCleanliness(fakeProvider as any,image,rubric,view)}),'concurrent optional-standard calls share bounded authority');releaseStandard();
assert.equal((await standardCheck).privacyState,'SAFE');assert.ok((await evidenceContent(actor,safeStandard.asset.id,'review',captureIo)).bytes.length);
await screenStandardPrivacy(actor,safeStandard.row.id,fakeProvider as any,captureIo.read,{evaluate:(image,rubric,view)=>assessCleanliness(fakeProvider as any,image,rubric,view)});
assert.equal(await prisma.auditLog.count({where:{entityType:'AREA_STANDARD_PHOTO',entityId:safeStandard.row.id,action:'STANDARD_PRIVACY_STARTED'}}),1,'successful standard screening is reused');
const pendingStandard=await standardFixture(902);const outage={assess:async()=>{throw new Error('Provider unavailable');}};
for(let retry=0;retry<4;retry++)assert.equal((await screenStandardPrivacy(actor,pendingStandard.row.id,outage as any,captureIo.read)).privacyState,'PENDING');
await assert.rejects(()=>screenStandardPrivacy(actor,pendingStandard.row.id,outage as any,captureIo.read));await assert.rejects(()=>evidenceContent(actor,pendingStandard.asset.id,'review',captureIo));
const heldStandard=await standardFixture(903);const holdProvider={assess:async()=>({result:{status:'UNCERTAIN',reasonCode:'PRIVACY_HOLD'},metadata:{provider:'fake',model:'test',providerVersion:'v1',promptVersion:'privacy-v1',requestId:null,latencyMs:1,usage:null,costUsd:null}})};
assert.equal((await screenStandardPrivacy(actor,heldStandard.row.id,holdProvider as any,captureIo.read)).privacyState,'HOLD');
assert.equal((await screenStandardPrivacy(actor,heldStandard.row.id,fakeProvider as any,captureIo.read)).privacyState,'HOLD','ordinary retry cannot release a privacy hold');
await assert.rejects(()=>screenStandardPrivacy({...actor,companyId:foreignCompany.id},heldStandard.row.id,fakeProvider as any,captureIo.read));
console.log('PASS: optional standards screened before delivery, concurrent/bounded privacy retries, safe-result reuse, outage restriction and immutable holds');

await prisma.$disconnect();await client.end();
console.log(`Isolated database retained for inspection: ${database}`);
