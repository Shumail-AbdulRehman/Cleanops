import {test} from 'node:test';
import assert from 'node:assert/strict';
import {verificationErrorMessage} from './errors';
test('network, server setup and native storage errors give distinct recovery instructions',()=>{
 assert.match(verificationErrorMessage({message:'Network Error'}),/Internet needed to continue/);
 assert.equal(verificationErrorMessage({response:{data:{message:'Database update pending'}}}), 'Database update pending');
 const storage=verificationErrorMessage({message:'Exception in HostFunction: java.lang.IllegalArgumentException: URI is not absolute at java.io.File'});
 assert.match(storage,/Keep the app data/);assert.doesNotMatch(storage,/HostFunction|java\.io/);
 assert.match(verificationErrorMessage(new Error('The encryption key for saved work is unavailable. Ask support before reinstalling or clearing data.')),/encryption key/);
});
