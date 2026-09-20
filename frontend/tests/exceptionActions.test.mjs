import {test} from 'node:test';
import assert from 'node:assert/strict';
import {actionConsequence,issueActions} from '../src/pages/Exceptions/actionPresentation.ts';
import {verificationLabel} from '../src/pages/Verification/presentation.ts';
test('waivers and acceptance show manual completion consequence; maintenance and resolution keep evidence required',()=>{
 for(const action of ['ACCEPT_EVIDENCE','WAIVE_REQUIREMENT','ACCEPT_CONTEXT'])assert.match(actionConsequence(action),/Completed with exceptions/);
 assert.match(actionConsequence('MARK_MAINTENANCE'),/Required evidence remains unresolved/);
 assert.match(actionConsequence('RESOLVE_ISSUE'),/does not waive/);
});
test('unsafe or unavailable evidence cannot expose an accept action',()=>{
 const detail={allowedActions:['ACCEPT_EVIDENCE','WAIVE_REQUIREMENT','MARK_MAINTENANCE'],attempts:[]};
 assert.deepEqual(issueActions(detail,{id:1,latestAttempt:{id:'held',mediaAssetId:null}}),['WAIVE_REQUIREMENT','MARK_MAINTENANCE']);
 assert.ok(issueActions(detail,{id:1,latestAttempt:{id:'safe',mediaAssetId:'protected-id',privacyState:'SAFE'}}).includes('ACCEPT_EVIDENCE'));
});
test('completed case exposes only follow-up resolution allowed by server',()=>{
 assert.deepEqual(issueActions({allowedActions:['RESOLVE_ISSUE'],requiresFollowUp:true,attempts:[]},{id:1}),['RESOLVE_ISSUE']);
});
test('service, review, rework, verified and manual outcomes stay distinct',()=>{
 assert.equal(verificationLabel({verificationState:'PROCESSING'}),'Waiting for checks');assert.equal(verificationLabel({verificationState:'NEEDS_REVIEW'}),'Needs manager');assert.equal(verificationLabel({verificationState:'REWORK_REQUIRED'}),'Staff fixing');assert.notEqual(verificationLabel({completionOutcome:'VERIFIED_COMPLETE'}),verificationLabel({completionOutcome:'COMPLETED_WITH_EXCEPTIONS'}));
});

test('direct-photo evidence without a required privacy check can use server-authorized acceptance',()=>{
 const detail={allowedActions:['ACCEPT_EVIDENCE'],attempts:[]};
 assert.deepEqual(issueActions(detail,{latestAttempt:{id:'direct',mediaAssetId:'protected-id',privacyState:'NOT_REQUIRED'}}),['ACCEPT_EVIDENCE']);
 assert.deepEqual(issueActions({...detail,allowedActions:[]},{latestAttempt:{id:'direct',mediaAssetId:'protected-id',privacyState:'NOT_REQUIRED'}}),[]);
});
