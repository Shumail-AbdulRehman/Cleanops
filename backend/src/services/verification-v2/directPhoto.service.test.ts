import { requireLaunchPhotoQualification } from './launchQualification.js';
vi.mock('./launchQualification.js',()=>({requireLaunchPhotoQualification:vi.fn()}));
import {beforeEach,expect,it,vi} from 'vitest';
const m=vi.hoisted(()=>({attempt:null as any,store:vi.fn(),discard:vi.fn(),access:vi.fn(),decision:vi.fn(),finalize:vi.fn()}));
vi.mock('./media.service.js',()=>({storePrivateImage:vi.fn(),discardPrivateImages:m.discard}));
const copies=['verification/1/attempts/a/original','verification/1/attempts/a/review'];
vi.mock('../../prisma/prisma.js',()=>({prisma:{
 verificationAttempt:{updateMany:vi.fn(async({where,data}:any)=>{if(m.attempt.directProcessingToken!==where.directProcessingToken)return {count:0};Object.assign(m.attempt,data);return {count:1};}),findUniqueOrThrow:vi.fn(async()=>m.attempt),findUnique:vi.fn(async()=>m.attempt),update:vi.fn(async({data}:any)=>{Object.assign(m.attempt,data);return m.attempt;})},
 $transaction:vi.fn(async(fn:any)=>fn({verificationAttempt:{findUniqueOrThrow:async()=>m.attempt,update:async({data}:any)=>{Object.assign(m.attempt,data);return m.attempt;}},evidenceAsset:{upsert:async({create}:any)=>{m.attempt.media={id:'asset',...create};return m.attempt.media;}}}))
}}));
vi.mock('./authorization.service.js',()=>({requireTaskAccess:m.access}));
vi.mock('./captureSession.service.js',()=>({lockTask:vi.fn(),staffAttemptResult:()=>({})}));
vi.mock('./quality.service.js',()=>({sha256:()=> 'hash',inspectImage:async()=>({sha256:'hash',normalizedHash:'n',perceptualHash:'p',format:'jpeg',bytes:5,width:1800,height:1200,sanitized:Buffer.from('sanitized'),quality:{acceptable:true}})}));
vi.mock('./evidence.service.js',()=>({originalPublicId:()=> 'verification/1/attempts/a/original'}));
vi.mock('./photoDecision.service.js',()=>({applyLockedDecision:m.decision}));
vi.mock('./completion.service.js',()=>({finalizeTask:m.finalize}));
vi.mock('./cleanliness.service.js',()=>({autoPassAllowed:()=>false}));
vi.mock('./bufferedPhoto.provider.js',()=>({BufferedClefProvider:class{},bufferedEvaluatorVersion:()=>"test-v1"}));
import {processDirectPhoto,directPhotoStatus} from './directPhoto.service.js';
const actor={id:1,companyId:1,role:'STAFF' as const};
const clean={originality:'DIRECT' as const,objectMatch:'MATCH' as const,viewMatch:'MATCH' as const,cleanliness:{verdict:'CLEAN' as const,surfaces:[{surface:'basin',verdict:'CLEAN' as const}],confidence:.99,reasonCode:'CLEAN' as const},metadata:{} as any};
beforeEach(()=>{vi.clearAllMocks();vi.mocked(requireLaunchPhotoQualification).mockReset();m.attempt={id:'a',staffId:1,committedHash:'hash',state:'RESERVED',session:{taskInstanceId:7,task:{locationId:2}},requirement:{id:'r',viewKey:'basin',item:{typeSnapshot:'SINK',rubricSnapshot:{version:1}}},media:null,qualityResult:null};m.store.mockResolvedValue({asset_id:'cloud'});m.decision.mockImplementation(async(_tx,_id,state)=>{m.attempt.state=state;});});
it('waits on AI and protected cloud storage together before returning, with no job queue',async()=>{
 const provider={evaluate:vi.fn(async()=>clean)};
 const result=await processDirectPhoto(actor,'a',Buffer.from('photo'),provider,m.store);
 expect(provider.evaluate).toHaveBeenCalledOnce();expect(m.store).toHaveBeenCalledTimes(2);
 expect(m.store.mock.invocationCallOrder[1]).toBeLessThan(provider.evaluate.mock.invocationCallOrder[0]);
 expect(m.discard).not.toHaveBeenCalled();
 expect(result).toMatchObject({attemptId:'a',state:'REVIEW_REQUIRED',storage:'cloud'});
 expect(m.decision).toHaveBeenCalledWith(expect.anything(),expect.objectContaining({id:'a'}),'REVIEW_REQUIRED','AUTO_PASS_NOT_VALIDATED',expect.anything());
});
it('keeps the uploaded original and review copy when cleaning is required', async () => {
 const photo = Buffer.from('photo');
 const assessment = {
  ...clean,
  cleanliness: {
   ...clean.cleanliness,
   verdict: 'DIRTY' as const,
   surfaces: [{surface: 'basin', verdict: 'DIRTY' as const}],
   reasonCode: 'CLEANING_REQUIRED' as const,
  },
 };
 const result = await processDirectPhoto(actor, 'a', photo, {evaluate: async () => assessment}, m.store);

 expect(m.store).toHaveBeenCalledTimes(2);
 expect(m.store).toHaveBeenCalledWith(photo, copies[0], 'hash', {lookup: false});
 expect(m.store).toHaveBeenCalledWith(Buffer.from('sanitized'), copies[1], 'hash', {lookup: false});
 expect(m.attempt.media).toMatchObject({
  originalPublicId: copies[0],
  sanitizedPublicId: copies[1],
  cloudinaryAssetId: 'cloud',
  deliveryType: 'authenticated',
  privacyState: 'NOT_REQUIRED',
 });
 expect(m.discard).not.toHaveBeenCalled();
 expect(m.decision).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({id: 'a'}), 'CLEANING_REQUIRED', 'CLEANING_REQUIRED', expect.anything());
 expect(result).toMatchObject({state: 'CLEANING_REQUIRED', storage: 'cloud'});
});
it('rejects a screen photo and deletes the copies uploaded alongside the AI',async()=>{
 const assessment={...clean,originality:'SCREEN_RECAPTURE' as const};
 const result=await processDirectPhoto(actor,'a',Buffer.from('photo'),{evaluate:async()=>assessment},m.store);
 expect(result.storage).toBe('discarded');await vi.waitFor(()=>expect(m.discard).toHaveBeenCalledWith(copies));
 expect(result.state).toBe('RECAPTURE_REQUIRED');
});
it('requires explicit retry after AI failure and does not accept missing evidence',async()=>{
 const evaluate=vi.fn().mockRejectedValue(new Error('AI unavailable'));
 await expect(processDirectPhoto(actor,'a',Buffer.from('photo'),{evaluate},m.store)).rejects.toMatchObject({statusCode:503});
 expect(evaluate).toHaveBeenCalledOnce();expect(m.discard).toHaveBeenCalledWith(copies);expect(m.attempt).toMatchObject({state:'RESERVED',media:null});
});
it('manual retry reuses a completed assessment after cloud failure',async()=>{
 const evaluate=vi.fn(async()=>clean);m.store.mockRejectedValueOnce(new Error('network'));
 await expect(processDirectPhoto(actor,'a',Buffer.from('photo'),{evaluate},m.store)).rejects.toMatchObject({statusCode:503});
 m.store.mockResolvedValue({asset_id:'cloud'});
 await processDirectPhoto(actor,'a',Buffer.from('photo'),{evaluate},m.store);
 expect(evaluate).toHaveBeenCalledOnce();expect(m.attempt.state).toBe('REVIEW_REQUIRED');
});
it('duplicate requests return the recorded result instead of calling AI again',async()=>{
 const provider={evaluate:vi.fn(async()=>clean)};
 await processDirectPhoto(actor,'a',Buffer.from('photo'),provider,m.store);
 await processDirectPhoto(actor,'a',Buffer.from('photo'),provider,m.store);
 expect(provider.evaluate).toHaveBeenCalledOnce();expect(m.store).toHaveBeenCalledTimes(2);
});
it('a concurrent upload is rejected while the first request owns the attempt',async()=>{
 m.attempt.directProcessingToken='other';m.attempt.directProcessingStartedAt=new Date();
 const provider={evaluate:vi.fn(async()=>clean)};
 await expect(processDirectPhoto(actor,'a',Buffer.from('photo'),provider,m.store)).rejects.toMatchObject({statusCode:409});
 expect(provider.evaluate).not.toHaveBeenCalled();
});
it('interrupted requests expire and can be checked or manually uploaded again',async()=>{
 m.attempt.state='CLEANLINESS_CHECK';m.attempt.directProcessingToken='old';m.attempt.directProcessingStartedAt=new Date(Date.now()-200000);
 expect((await directPhotoStatus(actor,'a')).state).toBe('RESERVED');
 await processDirectPhoto(actor,'a',Buffer.from('photo'),{evaluate:async()=>clean},m.store);
 expect(m.attempt.state).toBe('REVIEW_REQUIRED');
});
it('rejects another staff member and checks live access before AI',async()=>{
 m.attempt.staffId=2;const provider={evaluate:vi.fn(async()=>clean)};
 await expect(processDirectPhoto(actor,'a',Buffer.from('photo'),provider,m.store)).rejects.toMatchObject({statusCode:404});
 expect(provider.evaluate).not.toHaveBeenCalled();
});

it.each(['WRONG_ITEM','MISSING_SURFACE'] as const)('rejects confirmed %s, discarding its copies, before manager-review fallback',async objectMatch=>{
 const evaluate=vi.fn(async()=>({...clean,objectMatch,originality:'UNCERTAIN' as const}));
 const result=await processDirectPhoto(actor,'a',Buffer.from('photo'),{evaluate},m.store);
 expect(evaluate).toHaveBeenCalledWith(expect.any(Buffer),{version:1},'basin','SINK');
 await vi.waitFor(()=>expect(m.discard).toHaveBeenCalledWith(copies));
 expect(result).toMatchObject({state:'RECAPTURE_REQUIRED',storage:'discarded'});
 expect(m.decision).toHaveBeenCalledWith(expect.anything(),expect.objectContaining({id:'a'}),'RECAPTURE_REQUIRED',objectMatch,expect.anything());
});

it.each(['OBJECT','VIEW'] as const)('keeps %s uncertainty for manager review instead of asking for another photo',async gate=>{
 const evaluate=vi.fn(async()=>({...clean,...(gate==='OBJECT'?{objectMatch:'UNCERTAIN' as const}:{viewMatch:'UNCERTAIN' as const})}));
 const result=await processDirectPhoto(actor,'a',Buffer.from('photo'),{evaluate},m.store);
 expect(result).toMatchObject({state:'REVIEW_REQUIRED',storage:'cloud'});
 expect(m.store).toHaveBeenCalledTimes(2);
 expect(m.decision).toHaveBeenCalledWith(expect.anything(),expect.objectContaining({id:'a'}),'REVIEW_REQUIRED',`${gate}_UNCERTAIN`,expect.anything());
});

it('does not reuse an assessment cached before the object check was introduced',async()=>{
 m.attempt.directAssessment={assessment:clean,evaluatorVersion:'photo-buffer-v1-old'};
 const evaluate=vi.fn(async()=>({...clean,objectMatch:'WRONG_ITEM' as const}));
 await processDirectPhoto(actor,'a',Buffer.from('photo'),{evaluate},m.store);
 expect(evaluate).toHaveBeenCalledOnce();await vi.waitFor(()=>expect(m.discard).toHaveBeenCalledWith(copies));
});

it('cannot publish or overwrite a cached assessment after losing request ownership',async()=>{
 const provider={evaluate:vi.fn(async()=>{m.attempt.directProcessingToken='replacement-request';return clean;})};
 await expect(processDirectPhoto(actor,'a',Buffer.from('photo'),provider,m.store)).rejects.toMatchObject({statusCode:409});
 expect(m.attempt.directAssessment).toBeUndefined();expect(m.discard).not.toHaveBeenCalled();expect(m.decision).not.toHaveBeenCalled();
 expect(m.attempt.directProcessingToken).toBe('replacement-request');
});

it('fails unavailable before AI/storage when real active qualification is absent, and keeps same-capture retry',async()=>{
 const actual=await vi.importActual<typeof import('./launchQualification.js')>('./launchQualification.js');
 vi.mocked(requireLaunchPhotoQualification).mockImplementation(actual.requireLaunchPhotoQualification);
 const provider={evaluate:vi.fn(async()=>clean)};
 await expect(processDirectPhoto(actor,'a',Buffer.from('photo'),provider,m.store)).rejects.toMatchObject({statusCode:503,errors:[{code:'PHOTO_QUALIFICATION_UNAVAILABLE'}]});
 expect(provider.evaluate).not.toHaveBeenCalled();expect(m.store).not.toHaveBeenCalled();expect(m.decision).not.toHaveBeenCalled();expect(m.finalize).not.toHaveBeenCalled();
 expect(m.attempt).toMatchObject({state:'RESERVED',media:null,directProcessingToken:null});
});
it('completed immutable result reconciliation remains available even when new processing is unqualified',async()=>{
 m.attempt.state='REVIEW_REQUIRED';m.attempt.media={privacyState:'HOLD',deliveryType:'authenticated'};
 vi.mocked(requireLaunchPhotoQualification).mockImplementation(()=>{throw new Error('unqualified');});
 const provider={evaluate:vi.fn(async()=>clean)};
 expect((await processDirectPhoto(actor,'a',Buffer.from('photo'),provider,m.store)).state).toBe('REVIEW_REQUIRED');
 expect(requireLaunchPhotoQualification).not.toHaveBeenCalled();expect(provider.evaluate).not.toHaveBeenCalled();expect(m.store).not.toHaveBeenCalled();
});
