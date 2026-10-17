import assert from 'node:assert/strict';
import test from 'node:test';
import { attendanceResult, reconcileAttendance, reconcileSubmission, photoAuthority, passwordChangeRequired, photoResultAction } from './recoveryPolicy';
import { translate } from '../i18n/translations';
import type { AttendanceRecord } from '../types';
import type { Manifest } from '../verification/types';
const shift: AttendanceRecord = {id:1,date:'2026-10-21',status:'ABSENT',expectedStart:'2026-10-21T08:00:00Z',expectedEnd:'2026-10-21T16:00:00Z',checkInTime:null,checkOutTime:null,location:{id:7,name:'Site'}};
const checked = {...shift,checkInTime:'2026-10-21T08:00:00Z'};
const manifest = (staffSubmittedAt: string | null = null) => ({staffSubmittedAt,task:{id:4,status:'IN_PROGRESS'}} as Manifest);

test('lost attendance response reconciles the same shift without repeating upload', async () => {
  let writes=0,reads=0;
  const result=await reconcileAttendance(async()=>++reads===1?[shift]:[checked],async()=>{writes++;throw new Error('lost response');},shift,'check-in');
  assert.equal(result.checkInTime,checked.checkInTime);assert.equal(writes,1);assert.equal(reads,2);
});
test('already persisted check-in or checkout never uploads another selfie', async () => {
  let writes=0;const out={...checked,checkOutTime:'2026-10-21T16:00:00Z'};
  await reconcileAttendance(async()=>[checked],async()=>{writes++;},shift,'check-in');
  await reconcileAttendance(async()=>[out],async()=>{writes++;},checked,'check-out');
  assert.equal(writes,0);
});
test('offline read cannot authorize attendance upload', async () => {
  let writes=0;await assert.rejects(reconcileAttendance(async()=>{throw new Error('offline');},async()=>{writes++;},shift,'check-in'),/offline/);assert.equal(writes,0);
});
test('uncertain attendance stays uncertain and does not automatically retry', async () => {
  let writes=0;await assert.rejects(reconcileAttendance(async()=>[shift],async()=>{writes++;throw new Error('timeout');},shift,'check-in'),/timeout/);assert.equal(writes,1);
});
test('another shift or changed historical site cannot reconcile attendance', () => {
  for(const row of [{...checked,id:2},{...checked,location:{id:9,name:'Other'}},{...checked,expectedStart:'changed'}])assert.throws(()=>attendanceResult([row],shift,'check-in'),/shift changed/);
});
test('known successful attendance mutation must still obtain a persisted confirmation', async () => {
  await assert.rejects(reconcileAttendance(async()=>[shift],async()=>{},shift,'check-in'),/not confirmed/);
});
test('lost submission response reads immutable receipt, rather than posting again', async () => {
  let reads=0,writes=0;const receipt='2026-10-21T10:00:00Z';
  const result=await reconcileSubmission(async()=>manifest(++reads===1?null:receipt),async()=>{writes++;throw new Error('timeout');});assert.equal(result.staffSubmittedAt,receipt);assert.equal(writes,1);
});
test('reopened submitted task needs no repeat submission', async () => {
  let writes=0;await reconcileSubmission(async()=>manifest('2026-10-21T10:00:00Z'),async()=>{writes++;});assert.equal(writes,0);
});
test('failed submission never manufactures a receipt or automatically retries', async () => {
  let writes=0;await assert.rejects(reconcileSubmission(async()=>manifest(),async()=>{writes++;throw new Error('offline');}),/offline/);assert.equal(writes,1);
});
test('qualification and explicit server authority are both required for new capture', () => {
  const actions={createSession:true,resumeSession:true,renewSession:true,retakeSlots:true,upload:true,reportIssue:false};
  for(const value of [null,manifest(),{...manifest(),photoChecking:{available:false},allowedActions:actions}])assert.deepEqual(photoAuthority(value),{capture:false,upload:false,qualified:false});
  assert.deepEqual(photoAuthority({...manifest(),photoChecking:{available:true},allowedActions:{...actions,createSession:false,renewSession:false,retakeSlots:false,upload:false}}),{capture:false,upload:false,qualified:true});
  assert.deepEqual(photoAuthority({...manifest(),photoChecking:{available:true},allowedActions:actions}),{capture:true,upload:true,qualified:true});
});
test('expired authority is distinct from denied device permission and missing qualification', () => {
  assert.equal(photoAuthority({...manifest(),photoChecking:{available:true}}).qualified,true);
  assert.equal(photoAuthority({...manifest(),photoChecking:{available:true}}).capture,false);
});
test('same capture pending/final/failure results have distinct retry instructions', () => {
  assert.equal(photoResultAction('RECEIVED'),'checking');assert.equal(photoResultAction('PRIVACY_HOLD'),'received');assert.equal(photoResultAction('SERVICE_FAILURE'),'retry');assert.equal(photoResultAction(undefined),'retry');
});
test('only structured server password replacement denial enables replacement gate', () => {
  assert.equal(passwordChangeRequired({response:{status:403,data:{errors:[{code:'PASSWORD_CHANGE_REQUIRED'}]}}}),true);
  for(const value of [null,new Error('PASSWORD_CHANGE_REQUIRED'),{response:{status:401,data:{errors:[{code:'PASSWORD_CHANGE_REQUIRED'}]}}},{response:{status:403,data:{errors:[{code:'ACCOUNT_SUSPENDED'}]}}}])assert.equal(passwordChangeRequired(value),false);
});
test('recovery and authority copy translates into Urdu without changing task IDs', () => {
  for(const key of ['Submission receipt','Task photos are unavailable','Retry phone alerts','Open camera settings','Allow camera','Allow camera access in Settings to take task photos.','Camera or task access could not be checked. Refresh results and try again.'])assert.notEqual(translate(key,'ur'),key);
  assert.equal(translate('Task {id}','ur',{id:41}),'کام 41');
});
