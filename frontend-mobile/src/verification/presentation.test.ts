import assert from 'node:assert/strict';
import test from 'node:test';
import { photoStatuses, statusLabel } from './presentation';
import type { Manifest, LocalSession, QueueRow } from './types';
test('server recapture and restricted review remain visible while other photos upload',()=>{
 const manifest={task:{},sessions:[{id:'s',slots:[{id:'entrance',contextKey:'ENTRANCE',generation:0,state:'RECAPTURE_REQUIRED',instructions:'Show the entrance marker.'},{id:'layout',contextKey:'LAYOUT',generation:0,state:'PRIVACY_HOLD'}]}],items:[{nameSnapshot:'Toilet 1',requirements:[{id:'r',state:'PASSED'}]}]} as unknown as Manifest;
 const local={manifest,session:{id:'s',slots:[{id:'entrance',contextKey:'ENTRANCE',generation:0}]}} as LocalSession;
 const rows=[{id:'p',slotId:'entrance',state:'PROCESSING',metadata:{slotId:'entrance'}}] as QueueRow[];
 const statuses=photoStatuses(manifest,local,rows);
 assert.equal(statuses[0]?.state,'RECAPTURE_REQUIRED');assert.equal(statuses[0]?.detail,'Show the entrance marker.');
 assert.equal(statusLabel(statuses[1]!.state),'Needs review');assert.equal(statuses[2]?.state,'PASSED');
});
test('a newly saved retake shows upload progress without counting an older rejected capture as passed',()=>{
 const manifest={task:{},sessions:[],items:[{nameSnapshot:'Sink',requirements:[{id:'r',state:'RECAPTURE_REQUIRED',instructionsSnapshot:'Show basin'}]}]} as unknown as Manifest;
 const local={manifest,session:{id:'s',slots:[{id:'new-slot',requirementId:'r',generation:1}]}} as LocalSession;
 const rows=[{id:'new-photo',slotId:'new-slot',state:'SAVED',metadata:{slotId:'new-slot'}}] as QueueRow[];
 assert.equal(photoStatuses(manifest,local,rows).find(p=>p.key==='r')?.state,'SAVED');
});
test('a retrying upload shows its saved state and the actual upload error',()=>{
 const manifest={task:{},sessions:[],items:[{nameSnapshot:'Toilet 1',requirements:[{id:'r',state:'MISSING',instructionsSnapshot:'Show bowl'}]}]} as unknown as Manifest;
 const local={manifest,session:{id:'s',slots:[{id:'slot',requirementId:'r',generation:0}]}} as LocalSession;
 const rows=[{id:'photo',slotId:'slot',state:'RETRY_WAIT',lastError:'Network request failed',metadata:{slotId:'slot'}}] as QueueRow[];
 const photo=photoStatuses(manifest,local,rows).find(item=>item.key==='r')!;
 assert.equal(statusLabel(photo.state,photo.cleanlinessOutcome),'Waiting to retry');
 assert.equal(photo.cleanlinessOutcome,null);
 assert.match(photo.detail,/Network request failed/);
});

test('new sessions require one room photo while legacy session layout remains visible',()=>{
 const manifest={task:{},sessions:[{id:'new',slots:[{id:'e',contextKey:'ENTRANCE',generation:0,state:'AVAILABLE'}]}],items:[]} as unknown as Manifest;
 const local={manifest,session:{id:'new',requiredContextKeys:['ENTRANCE'],slots:[{id:'e',contextKey:'ENTRANCE',generation:0}]}} as LocalSession;
 assert.deepEqual(photoStatuses(manifest,local,[]).map(p=>p.key),['ENTRANCE']);
 const legacy={...local,session:{...local.session,id:'old',requiredContextKeys:['ENTRANCE','LAYOUT'],slots:[{id:'old-e',contextKey:'ENTRANCE',generation:0},{id:'old-l',contextKey:'LAYOUT',generation:0}]}} as LocalSession;
 assert.deepEqual(photoStatuses(manifest,legacy,[]).map(p=>p.key),['ENTRANCE','LAYOUT']);
});

test('staff cleanliness outcomes preserve automated clean, dirty and unresolved reasons without relabeling manual resolution',()=>{
 const manifest={task:{},sessions:[],items:[{nameSnapshot:'Washroom',requirements:[
  {id:'clean',state:'PASSED',instructionsSnapshot:'Show basin',currentAttempt:{cleanlinessOutcome:'CLEAN'}},
  {id:'dirty',state:'CLEANING_REQUIRED',instructionsSnapshot:'Show toilet',currentAttempt:{cleanlinessOutcome:'DIRTY',instructions:'Clean around the base.'}},
  {id:'uncertain',state:'RECAPTURE_REQUIRED',instructionsSnapshot:'Show tap',currentAttempt:{cleanlinessOutcome:'NEEDS_REVIEW',reviewReason:'CANNOT_ASSESS',instructions:'Show the whole tap.'}},
  {id:'gate',state:'REVIEW_REQUIRED',instructionsSnapshot:'Show mirror',currentAttempt:{cleanlinessOutcome:'NEEDS_REVIEW',reviewReason:'AUTO_PASS_NOT_VALIDATED',results:{cleanliness:{verdict:'CLEAN'}}}},
  {id:'manual',state:'MANAGER_ACCEPTED',instructionsSnapshot:'Show bin',currentAttempt:{manualOutcome:'MANAGER_ACCEPTED'}},
  {id:'waived',state:'WAIVED',instructionsSnapshot:'Show floor'},
 ]}]} as unknown as Manifest;
 const photos=photoStatuses(manifest,null,[]);const find=(key:string)=>photos.find(photo=>photo.key===key)!;
 assert.equal(statusLabel(find('clean').state,find('clean').cleanlinessOutcome),'Clean');
 assert.equal(statusLabel(find('dirty').state,find('dirty').cleanlinessOutcome),'Dirty');assert.equal(find('dirty').actionLabel,'Re-clean, then scan QR');
 assert.equal(statusLabel(find('uncertain').state,find('uncertain').cleanlinessOutcome),'Needs review');assert.equal(find('uncertain').actionLabel,'Retake photo');assert.match(find('uncertain').detail,/whole tap/);
 assert.equal(statusLabel(find('gate').state,find('gate').cleanlinessOutcome),'Needs review');assert.equal(find('gate').actionLabel,null);assert.match(find('gate').detail,/still being validated/);
 assert.equal(find('manual').cleanlinessOutcome,null);assert.equal(statusLabel(find('manual').state,find('manual').cleanlinessOutcome),'Accepted');
 assert.equal(find('waived').cleanlinessOutcome,null);assert.equal(statusLabel(find('waived').state,find('waived').cleanlinessOutcome),'Waived');
});
test('operational failures and pending uploads never become Dirty or Clean, and entrance approval is not a cleanliness result',()=>{
 const manifest={task:{},sessions:[{id:'s',slots:[{id:'e',contextKey:'ENTRANCE',generation:0,state:'PASSED'}]}],items:[{nameSnapshot:'Sink',requirements:[
  {id:'failure',state:'REVIEW_REQUIRED',instructionsSnapshot:'Show basin',currentAttempt:{state:'SERVICE_FAILURE',reviewReason:'SERVICE_FAILURE',cleanlinessOutcome:'NEEDS_REVIEW'}},
  {id:'pending',state:'PROCESSING',instructionsSnapshot:'Show tap',currentAttempt:{cleanlinessOutcome:'CLEAN'}},
 ]}]} as unknown as Manifest;
 const photos=photoStatuses(manifest,null,[]);assert.equal(photos[0].cleanlinessOutcome,null);assert.equal(statusLabel(photos[0].state,photos[0].cleanlinessOutcome),'Passed');
 const failure=photos.find(photo=>photo.key==='failure')!;assert.equal(failure.cleanlinessOutcome,'NEEDS_REVIEW');assert.equal(failure.actionLabel,null);assert.match(failure.detail,/do not need to clean or take another photo/);
 const pending=photos.find(photo=>photo.key==='pending')!;assert.equal(pending.cleanlinessOutcome,null);assert.equal(statusLabel(pending.state,pending.cleanlinessOutcome),'Checking');
});
test('legacy states map safely without requiring new DTO fields',()=>{
 assert.equal(statusLabel('PASSED'),'Clean');assert.equal(statusLabel('CLEANING_REQUIRED'),'Dirty');assert.equal(statusLabel('RECAPTURE_REQUIRED'),'Needs review');assert.equal(statusLabel('SERVICE_FAILURE'),'Needs review');
 assert.equal(statusLabel('SAVED'),'Saved');assert.equal(statusLabel('UPLOADING'),'Uploading');assert.equal(statusLabel('MANAGER_ACCEPTED'),'Accepted');
});
test('server retirement removes the entrance row even when the phone has the old policy',()=>{
 const manifest={task:{},sessions:[{id:'s',requiredContextKeys:[],slots:[{id:'e',contextKey:'ENTRANCE',generation:0,state:'AVAILABLE'}]}],items:[{nameSnapshot:'Sink',requirements:[{id:'r',state:'MISSING'}]}]} as unknown as Manifest;
 const local={manifest,session:{id:'s',requiredContextKeys:['ENTRANCE'],slots:[{id:'e',contextKey:'ENTRANCE',generation:0}]}} as LocalSession;
 assert.deepEqual(photoStatuses(manifest,local,[]).map(row=>row.key),['r']);
});
