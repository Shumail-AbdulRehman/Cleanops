// Spec 69: storage waits alongside the AI, unkept copies are deleted, no lookup on a fresh attempt,
// one retry for a quick transient vendor failure and none for a definitive answer.
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
const m=vi.hoisted(()=>({attempt:null as any,decision:vi.fn(),lookup:vi.fn(),upload:vi.fn(),destroy:vi.fn()}));
vi.mock('./launchQualification.js',()=>({requireLaunchPhotoQualification:vi.fn()}));
vi.mock('../../utils/cloudinary.js',()=>({default:{api:{resource:m.lookup},uploader:{destroy:m.destroy},utils:{private_download_url:vi.fn()}},uploadBufferToCloudinary:m.upload}));
vi.mock('../../prisma/prisma.js',()=>({prisma:{
 verificationAttempt:{updateMany:vi.fn(async({where,data}:any)=>{if(m.attempt.directProcessingToken!==where.directProcessingToken)return {count:0};Object.assign(m.attempt,data);return {count:1};}),findUniqueOrThrow:vi.fn(async()=>m.attempt),findUnique:vi.fn(async()=>m.attempt),update:vi.fn(async({data}:any)=>{Object.assign(m.attempt,data);return m.attempt;})},
 $transaction:vi.fn(async(fn:any)=>fn({verificationAttempt:{findUniqueOrThrow:async()=>m.attempt,update:async({data}:any)=>{Object.assign(m.attempt,data);return m.attempt;}},evidenceAsset:{upsert:async({create}:any)=>{m.attempt.media={id:'asset',...create};return m.attempt.media;}}}))
}}));
vi.mock('./authorization.service.js',()=>({requireTaskAccess:vi.fn()}));
vi.mock('./captureSession.service.js',()=>({lockTask:vi.fn(),staffAttemptResult:()=>({})}));
vi.mock('./quality.service.js',()=>({IMAGE_LIMIT_BYTES:5*1024*1024,sha256:()=> 'hash',inspectImage:async()=>({sha256:'hash',normalizedHash:'n',perceptualHash:'p',format:'jpeg',bytes:5,width:1800,height:1200,sanitized:Buffer.from('sanitized'),quality:{acceptable:true}})}));
vi.mock('./evidence.service.js',()=>({originalPublicId:()=> 'verification/1/attempts/a/original'}));
vi.mock('./photoDecision.service.js',()=>({applyLockedDecision:m.decision}));
vi.mock('./completion.service.js',()=>({finalizeTask:vi.fn()}));
vi.mock('./cleanliness.service.js',async importOriginal=>({...await importOriginal<object>(),autoPassAllowed:()=>false}));
import {processDirectPhoto} from './directPhoto.service.js';
import {storePrivateImage,discardPrivateImages} from './media.service.js';
import {BufferedClefProvider} from './bufferedPhoto.provider.js';
const actor={id:1,companyId:1,role:'STAFF' as const};
const copies=['verification/1/attempts/a/original','verification/1/attempts/a/review'];
const clean={originality:'DIRECT' as const,objectMatch:'MATCH' as const,viewMatch:'MATCH' as const,cleanliness:{verdict:'CLEAN' as const,surfaces:[{surface:'basin',verdict:'CLEAN' as const}],confidence:.99,reasonCode:'CLEAN' as const},metadata:{} as any};
const dirty={...clean,cleanliness:{...clean.cleanliness,verdict:'DIRTY' as const,surfaces:[{surface:'basin',verdict:'DIRTY' as const}],reasonCode:'CLEANING_REQUIRED' as const}};
const screen={...clean,originality:'SCREEN_RECAPTURE' as const};
function deferred<T>(){let resolve!:(v:T)=>void,reject!:(e:unknown)=>void;const promise=new Promise<T>((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};}
beforeEach(()=>{vi.resetAllMocks();
 m.attempt={id:'a',staffId:1,committedHash:'hash',state:'RESERVED',session:{taskInstanceId:7,task:{locationId:2}},requirement:{id:'r',viewKey:'basin',item:{typeSnapshot:'SINK',rubricSnapshot:{version:1}}},media:null,qualityResult:null,receivedAt:null};
 m.decision.mockImplementation(async(_tx,_id,state)=>{m.attempt.state=state;});});
afterEach(()=>{vi.useRealTimers();vi.unstubAllGlobals();vi.unstubAllEnvs();});

describe('direct photo: storage alongside the AI',()=>{
 it('starts both copies and the AI before either finishes, then records the AI decision',async()=>{
  const ai=deferred<typeof clean>(),stored=deferred<{asset_id:string}>();
  const store=vi.fn(()=>stored.promise),evaluate=vi.fn(()=>ai.promise);
  const done=processDirectPhoto(actor,'a',Buffer.from('photo'),{evaluate},store,vi.fn());
  await vi.waitFor(()=>expect(evaluate).toHaveBeenCalledOnce());
  expect(store).toHaveBeenCalledTimes(2);
  expect(store.mock.calls.map(c=>(c as unknown[])[1])).toEqual(copies);
  ai.resolve(clean);await new Promise(r=>setTimeout(r,5));
  expect(m.decision).not.toHaveBeenCalled();
  stored.resolve({asset_id:'cloud'});
  expect(await done).toMatchObject({state:'REVIEW_REQUIRED',storage:'cloud'});
  expect(m.attempt.media).toMatchObject({cloudinaryAssetId:'cloud',sanitizedPublicId:copies[1]});
 });
 it('records a screen photo as discarded first, then deletes both copies once they finish uploading',async()=>{
  const stored=deferred<{asset_id:string}>(),discard=vi.fn(async()=>{});
  const result=await processDirectPhoto(actor,'a',Buffer.from('photo'),{evaluate:async()=>screen},vi.fn(()=>stored.promise),discard);
  expect(result).toMatchObject({state:'RECAPTURE_REQUIRED',storage:'discarded'});
  expect(m.attempt.media).toMatchObject({privacyState:'DISCARDED',sanitizedPublicId:null,cloudinaryAssetId:undefined});
  expect(discard).not.toHaveBeenCalled();
  stored.resolve({asset_id:'cloud'});
  await vi.waitFor(()=>expect(discard).toHaveBeenCalledWith(copies));
  expect(m.decision.mock.invocationCallOrder[0]).toBeLessThan(discard.mock.invocationCallOrder[0]!);
 });
 it('a failed storage upload does not fail a discard decision',async()=>{
  const discard=vi.fn(async()=>{});
  const result=await processDirectPhoto(actor,'a',Buffer.from('photo'),{evaluate:async()=>screen},vi.fn().mockRejectedValue(new Error('down')),discard);
  expect(result.state).toBe('RECAPTURE_REQUIRED');await vi.waitFor(()=>expect(discard).toHaveBeenCalledWith(copies));
 });
 it('deletes the copies before handing the attempt back when the AI fails',async()=>{
  const discard=vi.fn(async()=>{expect(m.attempt.state).toBe('CLEANLINESS_CHECK');});
  await expect(processDirectPhoto(actor,'a',Buffer.from('photo'),{evaluate:vi.fn().mockRejectedValue(new Error('AI down'))},vi.fn(async()=>({asset_id:'cloud'})),discard)).rejects.toMatchObject({statusCode:503});
  expect(discard).toHaveBeenCalledWith(copies);expect(m.attempt).toMatchObject({state:'RESERVED',media:null,directProcessingToken:null});
 });
 it('a request that lost ownership deletes nothing',async()=>{
  const discard=vi.fn();
  const evaluate=vi.fn(async()=>{m.attempt.directProcessingToken='replacement';return dirty;});
  await expect(processDirectPhoto(actor,'a',Buffer.from('photo'),{evaluate},vi.fn(async()=>({asset_id:'cloud'})),discard)).rejects.toMatchObject({statusCode:409});
  expect(discard).not.toHaveBeenCalled();
 });
 it('uploads each copy once with no lookup on a fresh attempt',async()=>{
  const store=vi.fn(async()=>({asset_id:'cloud'}));
  await processDirectPhoto(actor,'a',Buffer.from('photo'),{evaluate:async()=>clean},store,vi.fn());
  expect(store.mock.calls).toEqual([[expect.any(Buffer),copies[0],'hash',{lookup:false}],[expect.any(Buffer),copies[1],'hash',{lookup:false}]]);
 });
 it('looks up stored copies when an earlier request already claimed the attempt',async()=>{
  m.attempt.receivedAt=new Date();const store=vi.fn(async()=>({asset_id:'cloud'}));
  await processDirectPhoto(actor,'a',Buffer.from('photo'),{evaluate:async()=>clean},store,vi.fn());
  expect(store).toHaveBeenCalledTimes(2);expect(store.mock.calls.every(c=>(c as unknown[])[3] && ((c as unknown[])[3] as {lookup:boolean}).lookup)).toBe(true);
 });
 it('a cached AI answer that discards the photo uploads nothing',async()=>{
  const {bufferedEvaluatorVersion}=await import('./bufferedPhoto.provider.js');
  m.attempt.receivedAt=new Date();m.attempt.directAssessment={assessment:screen,evaluatorVersion:bufferedEvaluatorVersion()};
  const store=vi.fn(),discard=vi.fn(),evaluate=vi.fn();
  expect((await processDirectPhoto(actor,'a',Buffer.from('photo'),{evaluate},store,discard)).state).toBe('RECAPTURE_REQUIRED');
  expect(store).not.toHaveBeenCalled();expect(evaluate).not.toHaveBeenCalled();expect(discard).not.toHaveBeenCalled();
 });
});

describe('Cloudinary storage',()=>{
 const id='verification/1/attempts/a/original';
 it('fresh: one upload, no lookup, keep-alive agent',async()=>{
  m.upload.mockResolvedValue({asset_id:'x'});
  expect(await storePrivateImage(Buffer.from('b'),id,'hash',{lookup:false})).toMatchObject({asset_id:'x'});
  expect(m.lookup).not.toHaveBeenCalled();expect(m.upload).toHaveBeenCalledOnce();
  expect(m.upload.mock.calls[0]![1].agent.keepAlive).toBe(true);
 });
 it('fresh: an asset Cloudinary reports as already existing must match the bound hash',async()=>{
  m.upload.mockResolvedValue({asset_id:'x',existing:true});m.lookup.mockResolvedValue({context:{custom:{sha256:'other'}}});
  await expect(storePrivateImage(Buffer.from('b'),id,'hash',{lookup:false})).rejects.toMatchObject({statusCode:409});
 });
 it('retries one quick transient upload failure and never a definitive one',async()=>{
  vi.useFakeTimers();
  m.upload.mockRejectedValueOnce({http_code:503}).mockResolvedValueOnce({asset_id:'x'});
  const ok=storePrivateImage(Buffer.from('b'),id,'hash',{lookup:false});await vi.advanceTimersByTimeAsync(1000);
  expect(await ok).toMatchObject({asset_id:'x'});expect(m.upload).toHaveBeenCalledTimes(2);
  m.upload.mockReset();m.upload.mockRejectedValue(Object.assign(new Error('socket hang up'),{code:'ECONNRESET'}));
  const twice=storePrivateImage(Buffer.from('b'),id,'hash',{lookup:false}).catch(e=>e);await vi.advanceTimersByTimeAsync(1000);
  expect(await twice).toMatchObject({statusCode:503});expect(m.upload).toHaveBeenCalledTimes(2);
  m.upload.mockReset();m.upload.mockRejectedValue({http_code:400,message:'bad'});
  await expect(storePrivateImage(Buffer.from('b'),id,'hash',{lookup:false})).rejects.toMatchObject({statusCode:503});
  expect(m.upload).toHaveBeenCalledOnce();
 });
 it('does not retry a failure that took longer than the retry window',async()=>{
  vi.useFakeTimers();
  m.upload.mockImplementation(async()=>{vi.setSystemTime(Date.now()+30_000);throw {http_code:499,name:'TimeoutError'};});
  await expect(storePrivateImage(Buffer.from('b'),id,'hash',{lookup:false})).rejects.toMatchObject({statusCode:503});
  expect(m.upload).toHaveBeenCalledOnce();
 });
 it('deletes discarded copies, retrying once and logging a failure',async()=>{
  const warn=vi.spyOn(console,'warn').mockImplementation(()=>{});
  m.destroy.mockImplementation(async(publicId:string)=>{if(publicId.endsWith('review'))throw new Error('down');return {result:'ok'};});
  await discardPrivateImages(copies);
  expect(m.destroy.mock.calls.filter(c=>c[0]===copies[0])).toHaveLength(1);
  expect(m.destroy.mock.calls.filter(c=>c[0]===copies[1])).toHaveLength(2);
  expect(m.destroy.mock.calls[0]![1]).toMatchObject({type:'authenticated',resource_type:'image',invalidate:true});
  expect(warn).toHaveBeenCalledOnce();expect(String(warn.mock.calls[0]![0])).toContain(copies[1]);
  warn.mockRestore();
 });
});

describe('Cloudflare clef retry',()=>{
 const rubric={version:1,criteria:['No removable dirt'],views:[{key:'basin_tap'}],surfacesByView:{basin_tap:['basin','tap']}};
 const answer=(body:any)=>{const answers=Object.fromEntries(Object.entries(body.questions).map(([key,value]:[string,any])=>{const options=Object.keys(value.criteria),choice=key.startsWith('visible_')?'VISIBLE':key==='object_match'?'MATCH':key==='originality'?'DIRECT':'CLEAN';
  return [key,{type:'choice',choice,confidence:.98,probabilities:Object.fromEntries(options.map(o=>[o,o===choice?.98:.02/(options.length-1)]))}];}));
  return new Response(JSON.stringify({success:true,result:{model:'clef',answers}}));};
 beforeEach(()=>{vi.stubEnv('CLOUDFLARE_ACCOUNT_ID','a'.repeat(32));vi.stubEnv('CLOUDFLARE_API_TOKEN','test');vi.stubEnv('CLEF_MODEL','clef');vi.useFakeTimers();});
 const run=async()=>{const p=new BufferedClefProvider().evaluate(Buffer.from('img'),rubric,'basin_tap','SINK').catch(e=>e);await vi.advanceTimersByTimeAsync(1000);return p;};
 it.each([503,429,500])('retries %s once and returns the second answer',async status=>{
  const request=vi.fn().mockResolvedValueOnce(new Response('',{status})).mockImplementationOnce(async(_u:string,o:any)=>answer(JSON.parse(o.body)));vi.stubGlobal('fetch',request);
  expect((await run()).cleanliness?.verdict).toBe('CLEAN');expect(request).toHaveBeenCalledTimes(2);
 });
 it('retries a network error once',async()=>{
  const request=vi.fn().mockRejectedValueOnce(new TypeError('fetch failed')).mockImplementationOnce(async(_u:string,o:any)=>answer(JSON.parse(o.body)));vi.stubGlobal('fetch',request);
  expect((await run()).cleanliness?.verdict).toBe('CLEAN');expect(request).toHaveBeenCalledTimes(2);
 });
 it('gives up after the one retry',async()=>{
  const request=vi.fn(async()=>new Response('',{status:503}));vi.stubGlobal('fetch',request);
  expect(await run()).toMatchObject({code:'PROVIDER_UNAVAILABLE'});expect(request).toHaveBeenCalledTimes(2);
 });
 it.each([[400,'PROVIDER_CONFIGURATION_INVALID'],[401,'PROVIDER_AUTH_FAILURE']] as const)('never retries a definitive %s',async(status,code)=>{
  const request=vi.fn(async()=>new Response('',{status}));vi.stubGlobal('fetch',request);
  expect(await run()).toMatchObject({code});expect(request).toHaveBeenCalledOnce();
 });
 it('never retries a malformed answer',async()=>{
  const request=vi.fn(async()=>new Response(JSON.stringify({result:{model:'clef',answers:{}}})));vi.stubGlobal('fetch',request);
  expect(await run()).toMatchObject({code:'PROVIDER_MALFORMED'});expect(request).toHaveBeenCalledOnce();
 });
 it('does not retry a failure that took longer than the retry window',async()=>{
  const request=vi.fn(async()=>{vi.setSystemTime(Date.now()+30_000);return new Response('',{status:503});});vi.stubGlobal('fetch',request);
  expect(await run()).toMatchObject({code:'PROVIDER_UNAVAILABLE'});expect(request).toHaveBeenCalledOnce();
 });
});
