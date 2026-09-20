import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canRetryStandardPrivacy, runStandardPrivacyRetry } from '../src/pages/Area/standardPrivacy.ts';
import { standardPhotoMessage } from '../src/pages/Area/types.ts';

test('privacy retry is only offered for pending standards, never for held or safe photos', () => {
  assert.equal(canRetryStandardPrivacy('PENDING'),true);
  for (const state of ['SAFE','HOLD','HELD','PRIVACY_HOLD',undefined]) assert.equal(canRetryStandardPrivacy(state),false);
  assert.equal(standardPhotoMessage('SAFE'),null);
  assert.match(standardPhotoMessage('HOLD'),/restricted/);
});
test('retry refreshes standard and area queries after successful assessment', async () => {
  const calls=[];
  assert.deepEqual(await runStandardPrivacyRetry(async () => {calls.push('request');return {privacyState:'SAFE'};},async () => {calls.push('refresh');}),{ok:true});
  assert.deepEqual(calls,['request','refresh']);
});
test('service failure preserves pending presentation and still refreshes after uncertain response', async () => {
  const failure={response:{status:503,data:{message:'Privacy service unavailable'}}};
  const calls=[];
  const result=await runStandardPrivacyRetry(async () => {calls.push('request');throw failure;},async () => {calls.push('refresh');});
  assert.deepEqual(result,{ok:false,error:failure});
  assert.deepEqual(calls,['request','refresh']);
  assert.equal(standardPhotoMessage('PENDING'),'Photo saved. Privacy review pending.');
  assert.equal(canRetryStandardPrivacy('PENDING'),true);
});
test('a successful response that remains pending does not imply privacy clearance', async () => {
  const pending={privacyState:'PENDING'};
  assert.deepEqual(await runStandardPrivacyRetry(async () => pending, async () => {}),{ok:true});
  assert.match(standardPhotoMessage(pending.privacyState),/pending/);
});
