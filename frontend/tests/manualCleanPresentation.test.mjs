import assert from 'node:assert/strict';
import test from 'node:test';
import {plainReason,verificationLabel} from '../src/pages/Verification/presentation.ts';
test('manual clean approval is distinct from an automatic verification result',()=>{
 assert.equal(plainReason('MANAGER_ACCEPTED'),'Clean (manual approval)');
 assert.equal(plainReason('REVIEW_REQUIRED'),'This work needs your decision');
 assert.equal(verificationLabel({status:'COMPLETED',completionOutcome:'COMPLETED_WITH_EXCEPTIONS'}),'Completed with exceptions');
});
