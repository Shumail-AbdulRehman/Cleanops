import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { assertIsolatedMediaDatabase } from '../src/services/attendanceMediaTransition.service.js';
const url=process.env.LAUNCH_COMPOSITION_TEST_DATABASE_URL;
assertIsolatedMediaDatabase(url,process.env.NODE_ENV);process.env.DATABASE_URL=url;
process.env.PADDLE_ENVIRONMENT='sandbox';
process.env.PADDLE_PRICE_CATALOG_JSON=JSON.stringify([{plan:'STARTER',interval:'month',priceId:'pri_00000000000000000000000001'}]);
process.env.VERIFICATION_QR_SECRET='synthetic-composition-qr-signing-fixture-only';
const {prisma}=await import('../src/prisma/prisma.js');
const {startTask}=await import('../src/controllers/taskInstance.controller.js');
const {updateManager}=await import('../src/controllers/manager.controller.js');
const {createStaff}=await import('../src/controllers/staff.controller.js');
const {recordAttendance}=await import('../src/services/attendanceWrites.service.js');
const {signTaskQr}=await import('../src/services/verification-v2/qr.service.js');
const {requireTaskAccess}=await import('../src/services/verification-v2/authorization.service.js');
const {assertAccountCompletion}=await import('../src/services/accountAccess.service.js');
const {jobAccountAllowed}=await import('../src/services/launchJobs.service.js');
const {syncTodaysOpenAttendanceWindow}=await import('../src/utils/syncAttendanceWindow.js');
const {changeOwnPassword}=await import('../src/services/credentialHandoff.service.js');
const suffix=randomUUID(),now=new Date(),from=new Date(+now-3600000),until=new Date(+now+3600000);
function response(){const value={status:(_code:number)=>value,json:(_body:unknown)=>value};return value;}
try {
 const company=await prisma.company.create({data:{name:'Synthetic composition '+suffix}});
 const owner=await prisma.manager.create({data:{name:'Synthetic owner',role:'ADMIN',email:suffix+'-owner@example.invalid',password:'synthetic-owner-password',companyId:company.id}});
 const location=await prisma.location.create({data:{name:'Synthetic composition site',companyId:company.id,address:'Fixture',latitude:'31',longitude:'74',timezone:'UTC'}});
 const area=await prisma.area.create({data:{name:'Synthetic room',locationId:location.id,roomType:'WASHROOM',status:'ACTIVE'}});
 const worker=await prisma.staff.create({data:{name:'Synthetic worker',email:suffix+'-staff@example.invalid',password:'synthetic-staff-password',locationId:location.id,companyId:company.id}});
 const actor={id:worker.id,companyId:company.id,role:'STAFF' as const},admin={id:owner.id,companyId:company.id,role:'ADMIN' as const};
 const customerId='ctm_synthetic_'+suffix,subscriptionId='sub_synthetic_'+suffix;
 await prisma.paddleCustomer.create({data:{id:customerId,companyId:company.id,status:'active',paddleUpdatedAt:now,lastEventAt:now}});
 await prisma.paddleSubscription.create({data:{id:subscriptionId,customerId,companyId:company.id,status:'active',priceId:'pri_00000000000000000000000001',productId:'pro_synthetic',currentBillingPeriodStart:from,currentBillingPeriodEnd:until,paddleUpdatedAt:now,lastEventAt:now}});
 await prisma.company.update({where:{id:company.id},data:{billingCustomerId:customerId,billingSubscriptionId:subscriptionId}});
 async function task(){
  const row=await prisma.taskInstance.create({data:{title:'Synthetic composition task',locationId:location.id,areaId:area.id,staffId:worker.id,areaNameSnapshot:area.name,inventoryVersion:1,verificationVersion:2,policySnapshot:{version:1},verificationDeadline:until,uploadDeadline:until,date:now,shiftStart:new Date(+now-60000),shiftEnd:until,status:'PENDING'}});
  await prisma.taskAssignment.create({data:{taskInstanceId:row.id,staffId:worker.id}});return row;
 }
 const work=await task();
 const start=()=>startTask({params:{taskId:String(work.id)},user:actor,body:{areaQr:signTaskQr(work,area)}} as any,response() as any);
 const results=await Promise.allSettled([start(),start()]);assert.equal(results.filter(result=>result.status==='fulfilled').length,2);
 const saved=await prisma.taskInstance.findUniqueOrThrow({where:{id:work.id}});assert.equal(saved.status,'IN_PROGRESS');assert.ok(saved.startedAt);
 assert.equal(await prisma.auditLog.count({where:{companyId:company.id,action:'WORK_ENTITLEMENT_GRANTED',entityType:'TASK_INSTANCE',entityId:work.id}}),1,'only winning actual start grants entitlement');
 const day=new Date(now);day.setUTCHours(0,0,0,0);
 const shift=await prisma.attendance.create({data:{staffId:worker.id,locationId:location.id,date:day,expectedStart:from,expectedEnd:until,status:'ABSENT'}});
 const reference=`attendance:v1:${company.id}:${worker.id}:${randomUUID()}`;
 const storage=async()=>reference;
 const checkIn=()=>recordAttendance(actor,'check-in',{latitude:31,longitude:74},Buffer.from('synthetic-private-photo-boundary'),now,prisma,storage);
 const checked=await Promise.all([checkIn(),checkIn()]);assert.equal(checked.filter(result=>!result.replayed).length,1);
 assert.equal(await prisma.auditLog.count({where:{companyId:company.id,action:'WORK_ENTITLEMENT_GRANTED',entityType:'ATTENDANCE',entityId:shift.id}}),1,'only winning actual check-in grants entitlement');
 // Actual controller creates through the capacity transaction rather than a preflight count.
 const create=(name:string)=>createStaff({user:admin,body:{name,email:suffix+'-'+name+'@example.invalid',phone:'03001234567',password:'synthetic-new-staff-password',locationId:location.id}} as any,response() as any);
 await create('second');
 const capacity=await Promise.allSettled([create('third'),create('fourth')]);assert.equal(capacity.filter(result=>result.status==='fulfilled').length,1);assert.equal(await prisma.staff.count({where:{companyId:company.id,isActive:true}}),3);
 await assert.rejects(updateManager({user:admin,params:{id:String(owner.id)},body:{password:'synthetic-other-account-reset'}} as any,response() as any),(error:any)=>error.statusCode===400);
 const rollbackWorker=await prisma.staff.findUniqueOrThrow({where:{email:suffix+'-second@example.invalid'}});
 const rollbackActor={id:rollbackWorker.id,companyId:company.id,role:'STAFF' as const};
 const rollbackShift=await prisma.attendance.create({data:{staffId:rollbackWorker.id,locationId:location.id,date:day,expectedStart:from,expectedEnd:until,status:'ABSENT'}});
 const failingDb=new Proxy(prisma,{get(client,key){
  if(key==='$transaction')return async(run:(tx:any)=>Promise<any>)=>client.$transaction(async tx=>run(new Proxy(tx,{get(inner,name){
   if(name==='auditLog')return new Proxy(inner.auditLog,{get(model,method){if(method==='create')return async()=>{throw new Error('Synthetic audit failure');};return Reflect.get(model,method);}});
   return Reflect.get(inner,name);
  }})));
  return Reflect.get(client,key);
 }});
 await assert.rejects(recordAttendance(rollbackActor,'check-in',{latitude:31,longitude:74},Buffer.from('synthetic-photo'),now,failingDb,storage),/Synthetic audit failure/);
 assert.equal((await prisma.attendance.findUniqueOrThrow({where:{id:rollbackShift.id}})).checkInTime,null,'audit failure rolls back actual attendance CAS');
 assert.equal(await prisma.auditLog.count({where:{companyId:company.id,action:'WORK_ENTITLEMENT_GRANTED',entityType:'ATTENDANCE',entityId:rollbackShift.id}}),0);
 await prisma.paddleSubscription.update({where:{id:subscriptionId},data:{currentBillingPeriodEnd:new Date(+now-1)}});
 let deniedStorageCalls=0;
 await assert.rejects(recordAttendance(rollbackActor,'check-in',{latitude:31,longitude:74},Buffer.from('synthetic-photo'),now,prisma,async()=>{deniedStorageCalls++;return reference;}),(error:any)=>error.statusCode===403);
 assert.equal(deniedStorageCalls,0,'unentitled check-in is denied before provider storage');
 await prisma.staff.update({where:{id:rollbackWorker.id},data:{shiftStart:from,shiftEnd:until}});
 assert.equal(await syncTodaysOpenAttendanceWindow({staffId:rollbackWorker.id,locationId:location.id,shiftStart:from,shiftEnd:until}),'ACCOUNT_RESTRICTED');
 assert.equal((await prisma.attendance.findUniqueOrThrow({where:{id:rollbackShift.id}})).checkInTime,null);
 await requireTaskAccess(actor,work.id,{staffMutation:true});
 assert.equal(await jobAccountAllowed(company.id,'READ_OPERATIONAL'),true);assert.equal(await jobAccountAllowed(company.id,'MANAGE_WORK'),false);
 const unproven=await task();await prisma.taskInstance.update({where:{id:unproven.id},data:{status:'IN_PROGRESS',startedAt:now}});
 await assert.rejects(requireTaskAccess(actor,unproven.id,{staffMutation:true}),(error:any)=>error.statusCode===403);
 const pending=await task();await assert.rejects(startTask({params:{taskId:String(pending.id)},user:actor,body:{areaQr:signTaskQr(pending,area)}} as any,response() as any),(error:any)=>error.statusCode===403);
 assert.equal((await prisma.taskInstance.findUniqueOrThrow({where:{id:pending.id}})).startedAt,null);
 assert.equal(await prisma.auditLog.count({where:{companyId:company.id,action:'WORK_ENTITLEMENT_GRANTED',entityId:pending.id,entityType:'TASK_INSTANCE'}}),0);
 // Submitted completion can be finalized by a retained job only with the same saved start grant.
 await prisma.taskInstance.update({where:{id:work.id},data:{staffSubmittedAt:now}});
 await assertAccountCompletion(actor,{kind:'task',id:work.id},prisma,new Date(),true);
 await assert.rejects(assertAccountCompletion(actor,{kind:'task',id:work.id}));
 const checkedOut=await recordAttendance(actor,'check-out',{latitude:31,longitude:74,attendanceId:shift.id},Buffer.from('synthetic-photo'),new Date(+now+31*60000),prisma,storage);assert.ok(checkedOut.record.checkOutTime);
 await prisma.company.update({where:{id:company.id},data:{operationalStatus:'SUSPENDED',isActive:false}});
 await assert.rejects(requireTaskAccess(actor,unproven.id,{staffMutation:true}));assert.equal(await jobAccountAllowed(company.id,'READ_OPERATIONAL'),false);
 const changed=await changeOwnPassword(admin,{currentPassword:'synthetic-owner-password',newPassword:'synthetic-replaced-owner-password'});assert.equal(changed.signInRequired,true);
 const ownerAfter=await prisma.manager.findUniqueOrThrow({where:{id:owner.id}});assert.equal(ownerAfter.credentialVersion,owner.credentialVersion+1);
 console.log('PASS isolated composition: actual task-start and attendance CAS races each persist one exact start grant; actual staff controller capacity has one final-slot winner; failed audit rolls back check-in; expired check-in denies storage and cron preparation; expired entitlement allows proven completion/checkout and denies legacy/new starts; submitted job completion uses retained exact grant; suspension denies operations/jobs while own password rotates epoch. No real provider, photos or production mutations.');
} finally {await prisma.$disconnect();}
