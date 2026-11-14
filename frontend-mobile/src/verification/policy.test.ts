import { test } from 'node:test';
import assert from 'node:assert/strict';
import { captureAllowed,nextSlot,recoverQueueState,retryOutcome,reconciledState } from './policy';
import { qualityInstruction,reworkRequirements,manifestForAllocatedSlots } from './capturePolicy';
import type { LocalSession,QueueRow } from './types';
const local={paused:false,anchorBootId:'boot',anchorElapsedMs:100,session:{id:'session',state:'ACTIVE',serverTime:'2026-10-06T10:00:00Z',captureExpiresAt:'2026-10-06T10:20:00Z',slots:[{id:'passed',requirementId:'r1',sequence:0},{id:'missing',requirementId:'r2',sequence:1},{id:'third',requirementId:'r3',sequence:2}]},manifest:{items:[{id:'item',requirements:[{id:'r1',state:'PASSED'},{id:'r2',state:'MISSING'},{id:'r3',state:'MISSING'}]}]}} as LocalSession;
test('process restart recovers upload identity without creating a new capture',()=>{assert.equal(recoverQueueState('UPLOADING'),'SAVED');assert.equal(reconciledState({state:'SAVED'} as QueueRow,{id:'original-attempt',state:'RECEIVED'}).attemptId,'original-attempt');});
test('offline sequence retains passed views and advances only with durable queue row',()=>{assert.equal(nextSlot(local,[])?.id,'missing');assert.equal(nextSlot(local,[{sessionId:'session',slotId:'missing'} as QueueRow])?.id,'third');});
test('expiry, paused room, backwards monotonic time and reboot stop capture',()=>{assert.equal(captureAllowed(local,{bootId:'boot',elapsedMs:101}),true);assert.equal(captureAllowed(local,{bootId:'boot',elapsedMs:1200101}),false);assert.equal(captureAllowed(local,{bootId:'new-boot',elapsedMs:101}),false);assert.equal(captureAllowed(local,{bootId:'boot',elapsedMs:99}),false);assert.equal(captureAllowed({...local,paused:true},{bootId:'boot',elapsedMs:101}),false);});
test('network outages retry but revoked auth pauses; rejected authority needs reconciliation',()=>{assert.equal(retryOutcome(undefined,0,0).state,'RETRY_WAIT');assert.equal(retryOutcome(401,0,0).state,'AUTH_REQUIRED');assert.equal(retryOutcome(403,0,0).state,'AUTH_REQUIRED');assert.equal(retryOutcome(400,0,0).state,'BLOCKED');assert.equal(retryOutcome(404,0,0).state,'BLOCKED');assert.equal(retryOutcome(410,0,0).state,'BLOCKED');assert.equal(retryOutcome(429,0,0,60).state,'RETRY_WAIT');assert.ok(retryOutcome(429,0,0,60).nextRetryAt>=60000);});
test('quality guidance never reports a cleaning failure',()=>{assert.match(qualityInstruction({width:1800,height:1200,luminance:15,laplacianVariance:20,clipping:0})! ,/dark/);assert.match(qualityInstruction({width:1800,height:1200,luminance:150,laplacianVariance:2,clipping:0})!,/blurry/);});
test('targeted rework excludes passed, processing and manager-review requirements',()=>{const work={...local,manifest:{items:[{id:'item',requirements:[{id:'1',state:'PASSED'},{id:'2',state:'RECAPTURE_REQUIRED'},{id:'3',state:'CLEANING_REQUIRED'},{id:'4',state:'PROCESSING'},{id:'5',state:'REVIEW_REQUIRED'}]}]}} as LocalSession;assert.deepEqual(reworkRequirements(work).map(w=>w.requirement.id),['2','3']);});

test('exhausted provider failure is a final unresolved result, never infinite processing or passed',()=>{
 assert.equal(reconciledState({state:'PROCESSING'} as QueueRow,{id:'failed',state:'SERVICE_FAILURE'}).state,'FINAL');
 assert.equal(reconciledState({state:'PROCESSING'} as QueueRow,{id:'retry',state:'RETRY_WAIT'}).state,'PROCESSING');
 assert.equal(retryOutcome(413,0,0).state,'BLOCKED');
});

test('fresh targeted generations clear stale failed state without altering passed or other failed views',()=>{
 const manifest={items:[{requirements:[{id:'passed',state:'PASSED',decisionVersion:1},{id:'dirty',state:'CLEANING_REQUIRED',decisionVersion:2,currentAttempt:{id:'old'}},{id:'wrong',state:'RECAPTURE_REQUIRED',decisionVersion:4}]}]} as unknown as LocalSession['manifest'];
 const next=manifestForAllocatedSlots(manifest,[{requirementId:'dirty',generation:3}] as LocalSession['session']['slots']);
 assert.equal(next.items[0].requirements[0].state,'PASSED');
 assert.equal(next.items[0].requirements[1].state,'MISSING');assert.equal(next.items[0].requirements[1].decisionVersion,3);assert.equal(next.items[0].requirements[1].currentAttempt,null);
 assert.equal(next.items[0].requirements[2].state,'RECAPTURE_REQUIRED');
});
test('retired entrance slot cannot precede a manager-required item',()=>{
 const updated={...local,session:{...local.session,requiredContextKeys:[],slots:[{id:'entrance',contextKey:'ENTRANCE',sequence:-1},...local.session.slots]}} as LocalSession;
 assert.equal(nextSlot(updated,[])?.id,'missing');
});
