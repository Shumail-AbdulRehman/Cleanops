import { test } from 'node:test';
import assert from 'node:assert/strict';
import { taskCardStatus } from '../utils/taskStatus';
test('overdue task status cannot fall through to in progress or processing',()=>{
 for(const verificationState of ['NEEDS_REVIEW','PROCESSING','REWORK_REQUIRED'])assert.equal(taskCardStatus({status:'NOT_COMPLETED_INTIME',verificationState}),'Overdue');
 assert.equal(taskCardStatus({status:'IN_PROGRESS'}),'In progress');
 assert.equal(taskCardStatus({status:'MISSED'}),'Missed');
 assert.equal(taskCardStatus({status:'COMPLETED',verificationState:'NEEDS_REVIEW'}),'Work submitted');
});
