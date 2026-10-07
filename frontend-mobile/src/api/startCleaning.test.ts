import assert from 'node:assert/strict';
import test from 'node:test';
import {QueryClient} from '@tanstack/react-query';
import {client,configureApiAuth} from './client';
import {startCleaning} from './startCleaning';
import type {TaskInstance} from '../types';
const key=['staff',63,'tasks','today'];
const pending={id:7,title:'Task',status:'PENDING',template:{location:{name:'Room'}}} as TaskInstance;

test('confirmed start appears immediately while the background feed is still pending',async()=>{
 const cache=new QueryClient();cache.setQueryData(key,[pending]);
 const adapter=client.defaults.adapter;
 configureApiAuth({getScope:()=>null,getTokens:async()=>({accessToken:null,refreshToken:null}),setTokens:async()=>{},clearSession:async()=>{}});
 let finishRefresh!:()=>void;let refreshing=false;
 cache.invalidateQueries=()=>{refreshing=true;return new Promise<void>(resolve=>{finishRefresh=resolve;});};
 client.defaults.adapter=async config=>{assert.equal(config.url,'/task-instance/7/start');assert.deepEqual(JSON.parse(config.data),{areaQr:'signed-area-qr'});return {data:{data:{id:7,status:'IN_PROGRESS',startedAt:'2026-10-07T12:30:00Z'}},status:200,statusText:'OK',headers:{},config};};
 try{
  const result=await startCleaning(cache,key,7,'signed-area-qr');
  assert.equal(result.status,'IN_PROGRESS');assert.equal(refreshing,true);
  assert.deepEqual(cache.getQueryData(key),[{...pending,status:'IN_PROGRESS',startedAt:'2026-10-07T12:30:00Z'}]);
 }finally{finishRefresh?.();client.defaults.adapter=adapter;cache.clear();}
});

test('a stale in-flight task feed cannot overwrite the confirmed start',async()=>{
 const cache=new QueryClient();cache.setQueryData(key,[pending]);
 const adapter=client.defaults.adapter;let finishOld!:()=>void;
 const stale=cache.fetchQuery({queryKey:key,staleTime:0,queryFn:()=>new Promise<TaskInstance[]>(resolve=>{finishOld=()=>resolve([pending]);})}).catch(()=>{});
 client.defaults.adapter=async config=>({data:{data:{id:7,status:'IN_PROGRESS'}},status:200,statusText:'OK',headers:{},config});
 try{
  await startCleaning(cache,key,7,'signed-area-qr');finishOld();await stale;
  assert.equal(cache.getQueryData<TaskInstance[]>(key)?.[0].status,'IN_PROGRESS');
 }finally{client.defaults.adapter=adapter;cache.clear();}
});

test('a rejected start preserves pending state and does not refresh the feed',async()=>{
 const cache=new QueryClient();cache.setQueryData(key,[pending]);
 const adapter=client.defaults.adapter;let refreshed=false;
 cache.invalidateQueries=async()=>{refreshed=true;};
 client.defaults.adapter=async()=>{throw new Error('Current active assignment required');};
 try{await assert.rejects(startCleaning(cache,key,7,'signed-area-qr'),/assignment/);assert.deepEqual(cache.getQueryData(key),[pending]);assert.equal(refreshed,false);}
 finally{client.defaults.adapter=adapter;cache.clear();}
});
