import { test } from 'node:test';
import assert from 'node:assert/strict';
import axios from 'axios';
import { configureApiAuth,refreshApiTokens,uploadFormData,client,accountRequest } from '../api/client';
let scope='1_1',tokens:{accessToken:string|null;refreshToken:string|null}={accessToken:'old',refreshToken:'refresh'},cleared=0;
configureApiAuth({getScope:()=>scope,getTokens:async()=>tokens,setTokens:async(next)=>{tokens=next;},clearSession:async()=>{cleared++;}});
test('concurrent refresh is serialized and multipart is rebuilt after expiry',async()=>{
 let calls=0;const post=axios.post;const fetch=globalThis.fetch;
 axios.post=(async()=>{calls++;await new Promise(resolve=>setTimeout(resolve,10));return {data:{data:{accessToken:'new',refreshToken:'next'}}};}) as typeof axios.post;
 try{await Promise.all([refreshApiTokens(),refreshApiTokens(),refreshApiTokens()]);assert.equal(calls,1);
 let requests=0,builds=0;globalThis.fetch=async()=>new Response(JSON.stringify({success:true}),{status:++requests===1?401:200});
 await uploadFormData('/upload',()=>{builds++;return new FormData();});assert.equal(builds,2);assert.equal(calls,2);
 }finally{axios.post=post;globalThis.fetch=fetch;}
});
test('network failure during refresh retains sign-in; explicit revocation clears it',async()=>{
 const post=axios.post;try{axios.post=(async()=>{throw new Error('offline');}) as typeof axios.post;await assert.rejects(refreshApiTokens());assert.equal(cleared,0);
 axios.post=(async()=>{throw new axios.AxiosError('revoked','ERR_BAD_REQUEST',undefined,undefined,{status:401} as never);}) as typeof axios.post;await assert.rejects(refreshApiTokens());assert.equal(cleared,1);
 }finally{axios.post=post;}
});
test('account switch during refresh cannot save another worker tokens or retry multipart',async()=>{
 const post=axios.post;const fetch=globalThis.fetch;try{const before={...tokens};axios.post=(async()=>{scope='1_2';return {data:{data:{accessToken:'foreign',refreshToken:'foreign'}}};}) as typeof axios.post;
 await assert.rejects(refreshApiTokens(),/Account changed/);assert.deepEqual(tokens,before);
 let requests=0;scope='1_1';globalThis.fetch=async()=>{requests++;return new Response('{}',{status:401});};await assert.rejects(uploadFormData('/upload',()=>new FormData()),/Account changed/);assert.equal(requests,1);
 }finally{axios.post=post;globalThis.fetch=fetch;}
});

test('Axios stops an old account request even when token retrieval overlaps switching accounts',async()=>{
 scope='1_1';let dispatched=0;const adapter=client.defaults.adapter;
 configureApiAuth({getScope:()=>scope,getTokens:async()=>{scope='1_2';return tokens;},setTokens:async()=>{},clearSession:async()=>{}});
 client.defaults.adapter=async config=>{dispatched++;return {data:{},status:200,statusText:'OK',headers:{},config};};
 try{await assert.rejects(client.post('/report',{taskId:7},accountRequest('1_1')),/Account changed/);assert.equal(dispatched,0);}finally{client.defaults.adapter=adapter;}
});
