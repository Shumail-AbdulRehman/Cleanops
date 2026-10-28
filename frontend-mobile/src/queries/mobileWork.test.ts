import test from 'node:test';
import assert from 'node:assert/strict';
import { QueryClient, InfiniteQueryObserver, type InfiniteData } from '@tanstack/react-query';
import { client, configureApiAuth } from '../api/client';
import { mobileTaskOptions, flattenTaskPages, updateStartedTask, type MobileTaskPage } from './mobileWork';
import type { TaskInstance } from '../types';
const firstTask={id:7,title:'Task',status:'PENDING'} as TaskInstance;
const page:MobileTaskPage={tasks:[firstTask],counts:{total:80,submitted:0,pending:80,inProgress:0},nextCursor:'page-two'};
const emptyAuth=()=>configureApiAuth({getScope:()=>null,getTokens:async()=>({accessToken:null,refreshToken:null}),setTokens:async()=>{},clearSession:async()=>{}});
const tick=()=>new Promise(resolve=>setTimeout(resolve,10));
test('shared task observers fetch only one page, then fetch more only on demand',async()=>{
 emptyAuth();const cache=new QueryClient({defaultOptions:{queries:{retry:false}}}),adapter=client.defaults.adapter,calls:string[]=[];
 client.defaults.adapter=async config=>{calls.push(config.params?.cursor??'first');return {data:{data:config.params?.cursor?{...page,tasks:[{...firstTask,id:8}],nextCursor:null}:page},status:200,statusText:'OK',headers:{},config};};
 const key=['mobile-test',1],a=new InfiniteQueryObserver(cache,mobileTaskOptions(key)),b=new InfiniteQueryObserver(cache,mobileTaskOptions(key));
 const off=a.subscribe(()=>{}),offB=b.subscribe(()=>{});
 try{
  await a.refetch();assert.deepEqual(calls,['first']);assert.equal(a.getCurrentResult().hasNextPage,true);assert.equal(flattenTaskPages(a.getCurrentResult().data)?.length,1);
  await tick();assert.equal(calls.length,1,'remaining pages are not eagerly fetched');
  await a.fetchNextPage({cancelRefetch:false});assert.deepEqual(calls,['first','page-two']);assert.equal(a.getCurrentResult().hasNextPage,false);assert.equal(flattenTaskPages(a.getCurrentResult().data)?.length,2);
 }finally{off();offB();cache.clear();client.defaults.adapter=adapter;}
});
test('cancelling a stale mobile request reaches the HTTP AbortSignal',async()=>{
 emptyAuth();const cache=new QueryClient(),adapter=client.defaults.adapter;let aborted=false,started=false;
 client.defaults.adapter=async config=>new Promise((_resolve,reject)=>{started=true;config.signal?.addEventListener?.('abort',()=>{aborted=true;reject(new Error('aborted'));});});
 const key=['mobile-cancel',1];
 try{const request=cache.fetchInfiniteQuery(mobileTaskOptions(key)).catch(()=>{});while(!started)await tick();await cache.cancelQueries({queryKey:key});await request;assert.equal(aborted,true);assert.equal(cache.getQueryData(key),undefined);}
 finally{cache.clear();client.defaults.adapter=adapter;}
});
test('a confirmed start updates paginated cards and whole-feed counts without waiting for a refetch',()=>{
 const data:InfiniteData<MobileTaskPage>={pages:[page],pageParams:[null]};
 const next=updateStartedTask(data,{id:7,status:'IN_PROGRESS'} as TaskInstance) as InfiniteData<MobileTaskPage>;
 assert.equal(next.pages[0]!.tasks[0]!.status,'IN_PROGRESS');assert.deepEqual(next.pages[0]!.counts,{total:80,submitted:0,pending:79,inProgress:1});
 assert.deepEqual((updateStartedTask(next,{id:7,status:'IN_PROGRESS'} as TaskInstance) as InfiniteData<MobileTaskPage>).pages[0]!.counts,next.pages[0]!.counts);
 assert.equal(data.pages[0]!.tasks[0]!.status,'PENDING','previous cache is not mutated');
 assert.equal(flattenTaskPages({pages:[page,{...page,tasks:[{...firstTask,status:'IN_PROGRESS'}]}],pageParams:[null,'next']})?.length,1,'moving rows cannot create duplicate cards');
});
