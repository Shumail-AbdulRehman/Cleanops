import test from 'node:test';
import assert from 'node:assert/strict';
import {reviewDiagnosis,requirementDiagnosis,reviewViewLabel} from '../src/pages/Exceptions/reviewDiagnosis.ts';
const requirement=(id,state='MISSING',extra={})=>({id,state,mandatory:true,viewKey:'squat_pan',instructionsSnapshot:'Show the whole pan.',decisionVersion:1,...extra});
const fixture=(id,name,state,extra={})=>({id,nameSnapshot:name,sourceAreaItemId:id,mandatory:true,requirements:[requirement(String(id),state,extra)]});
const detail=(items,extra={})=>({id:1,kind:'TASK',state:'MANAGER_REVIEW',issues:[],items,attempts:[],allowedActions:[],decisions:[],events:[],captureStatus:{available:false,canExtend:false,reason:'DEADLINE_PASSED',deadline:'2026-10-18T07:30:00Z'},...extra});
const dirty={id:'attempt',state:'CLEANING_REQUIRED',receivedAt:'2026-10-18T07:00:00Z',mediaAssetId:null,privacyState:'DISCARDED',reviewSummary:{reasonCode:'CLEANING_REQUIRED',cleanliness:'DIRTY',dirtySurfaces:['pan'],missingSurfaces:[]}};
test('explains the screenshot case without making a manager inspect each fixture',()=>{
 const result=reviewDiagnosis(detail([fixture(1,'Indian toilet 01','CLEANING_REQUIRED',{currentAttempt:dirty}),fixture(2,'Sink 01','MISSING'),fixture(3,'Mirror 01','MISSING'),fixture(4,'Floor zone 01','MISSING')]));
 assert.equal(result.cleaning,1);assert.equal(result.missing,3);assert.equal(result.total,4);
 assert.match(result.rows[0].description,/toilet pan.*needing cleaning/);
 assert.deepEqual(result.groups.find(group=>group.category==='missing').rows.map(row=>row.name),['Sink 01','Mirror 01','Floor zone 01']);
 assert.match(result.next,/Resolve this review/);assert.match(result.next,/staff performance issue/);assert.doesNotMatch(result.next,/access|manually/);
});
test('optional fixtures and optional views do not inflate missing-required-photo counts',()=>{
 const items=[fixture(1,'Required sink','MISSING'),{...fixture(2,'Optional mirror','MISSING'),mandatory:false},fixture(3,'Optional floor view','MISSING',{mandatory:false})];
 assert.equal(reviewDiagnosis(detail(items)).missing,1);assert.equal(reviewDiagnosis(detail(items)).rows.length,3);
});
test('a clean check awaiting manager approval does not become a dirty finding',()=>{
 const attempt={...dirty,state:'REVIEW_REQUIRED',reviewSummary:{...dirty.reviewSummary,reasonCode:'AUTO_PASS_NOT_VALIDATED',cleanliness:'CLEAN',dirtySurfaces:[]}};
 const result=reviewDiagnosis(detail([fixture(1,'Sink 01','REVIEW_REQUIRED',{currentAttempt:attempt})]));
 assert.equal(result.cleaning,0);assert.equal(result.rows[0].title,'Manager approval needed');assert.match(result.rows[0].description,/marked.*clean.*automatic approval is not enabled/);
});
test('service failures, ambiguous condition and wrong-object rejection have distinct explanations',()=>{
 const messages={SERVICE_FAILURE:/checking failure, not a finding/,CANNOT_ASSESS:/stains, wear, damage or visibility/,WRONG_ITEM:/different object/};
 for(const [reason,expected] of Object.entries(messages)){
  const row=requirementDiagnosis(detail([]),requirement('1',reason==='WRONG_ITEM'?'RECAPTURE_REQUIRED':'REVIEW_REQUIRED',{currentAttempt:{...dirty,reviewSummary:{...dirty.reviewSummary,reasonCode:reason,cleanliness:null,dirtySurfaces:[]}}}),'Sink');
  assert.match(row.description,expected);assert.notEqual(row.category,'cleaning');
 }
});
test('a previous rejected attempt is not mistaken for the current missing replacement photo',()=>{
 const result=reviewDiagnosis(detail([fixture(1,'Sink 01','MISSING',{currentAttemptId:null,currentAttempt:null})],{attempts:[{...dirty,requirementId:'1'}],issues:[{requirementId:'1',latestAttempt:dirty,state:'STAFF_ACTION_REQUIRED',reasonCode:'CLEANING_REQUIRED'}]}));
 assert.equal(result.rows[0].attempt,null);assert.equal(result.rows[0].title,'Replacement photo missing');assert.match(result.rows[0].description,/previous photo was received/);
});
test('server upload availability takes precedence over a browser clock or a future deadline',()=>{
 const base=detail([fixture(1,'Sink','MISSING')],{captureStatus:{available:false,canExtend:false,reason:'NOT_STARTED',deadline:'2099-01-01T00:00:00Z'}});
 assert.equal(reviewDiagnosis(base).capture.reason,'NOT_STARTED');
 assert.equal(reviewDiagnosis({...base,captureStatus:{...base.captureStatus,reason:'DEADLINE_PASSED',canExtend:true}}).capture.reason,'DEADLINE_PASSED');
 assert.match(reviewDiagnosis({...base,captureStatus:{...base.captureStatus,available:true,reason:'AVAILABLE'}}).next,/stays in exceptions/);
});
test('completed, cancelled and resolved reviews explain their actual next step',()=>{
 const base=detail([]);
 assert.match(reviewDiagnosis({...base,captureStatus:{...base.captureStatus,reason:'CANCELLED'}}).next,/Resolve this review/);
 assert.match(reviewDiagnosis({...base,requiresFollowUp:true}).next,/staff performance issue/);
 assert.match(reviewDiagnosis({...base,state:'RESOLVED'}).next,/has been handled/);
});
test('satisfied requirements do not inherit old dirty findings and unknown keys stay readable',()=>{
 const result=reviewDiagnosis(detail([fixture(1,'Toilet','PASSED',{currentAttempt:dirty})]));
 assert.equal(result.checked,1);assert.equal(result.groups.length,0);
 assert.equal(reviewViewLabel('squat_pan'),'Whole Indian toilet pan');assert.equal(reviewViewLabel('internal-custom-key'),'Required photo');
});

test('a new concern on completed work keeps its reason even when the original photo requirement passed',async()=>{
 const {issueDiagnosis}=await import('../src/pages/Exceptions/reviewDiagnosis.ts');
 const issue={id:3,requirementId:'1',reasonCode:'DUPLICATE_EVIDENCE',state:'MANAGER_REVIEW'};
 const review=detail([fixture(1,'Toilet','PASSED',{currentAttempt:{...dirty,state:'PASSED',reviewSummary:{...dirty.reviewSummary,reasonCode:'CLEAN',cleanliness:'CLEAN'}}})],{requiresFollowUp:true,issues:[issue]});
 assert.match(issueDiagnosis(review,issue).description,/may have been used before/);
 assert.equal(issueDiagnosis(review,issue).category,'review');
});
