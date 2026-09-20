import assert from 'node:assert/strict';
import test from 'node:test';
import {issueActions} from '../src/pages/Exceptions/actionPresentation.ts';
const actions=['ACCEPT_EVIDENCE','ACCEPT_CONTEXT','REQUEST_RECAPTURE'];
test('viewing held photos does not authorize accepting them',()=>{
 const held={id:'held',contextKey:'ENTRANCE',mediaAssetId:'photo',privacyState:'HOLD'};
 assert.deepEqual(issueActions({allowedActions:actions,attempts:[held]},{latestAttempt:held}),['REQUEST_RECAPTURE']);
});
test('privacy-cleared photos retain evidence and context acceptance',()=>{
 const safe={id:'safe',contextKey:'ENTRANCE',mediaAssetId:'photo',privacyState:'SAFE'};
 assert.deepEqual(issueActions({allowedActions:actions,attempts:[safe]},{latestAttempt:safe}),actions);
});
