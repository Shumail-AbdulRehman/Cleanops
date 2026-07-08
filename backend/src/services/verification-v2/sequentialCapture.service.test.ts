import {afterEach,beforeEach,expect,it,vi} from 'vitest';
const m=vi.hoisted(()=>({authorized:vi.fn(),lock:vi.fn(),response:vi.fn(),slots:vi.fn(),update:vi.fn(),jobs:vi.fn()}));
vi.mock('../../prisma/prisma.js',()=>({prisma:{$transaction:async(fn:any)=>fn({captureSlot:{findMany:m.slots,update:m.update},verificationJob:{count:m.jobs}})}}));
vi.mock('./captureSession.service.js',()=>({lockAuthorizedSession:m.authorized,sessionResponse:m.response}));
import {activatePhotoSlot} from './sequentialCapture.service.js';
import {SEQUENTIAL_WORKFLOW} from './sequentialPolicy.js';
const actor={id:70,role:'STAFF',companyId:1} as const;
const first='11111111-1111-4111-8111-111111111111',second='22222222-2222-4222-8222-222222222222';
const now=new Date('2026-10-10T01:00:00Z');
beforeEach(()=>{vi.resetAllMocks();m.jobs.mockResolvedValue(0);vi.useFakeTimers();vi.setSystemTime(now);m.authorized.mockResolvedValue({taskInstanceId:9,state:'ACTIVE',captureExpiresAt:new Date(+now+600000),locationCheck:{captureWorkflow:SEQUENTIAL_WORKFLOW},task:{policySnapshot:{}}});m.response.mockResolvedValue({ok:true});m.slots.mockResolvedValue([{id:first,requirementId:'r',generation:0,sequence:0,attemptId:'a',activatedAt:new Date(+now-60000),attempt:{state:'REVIEW_REQUIRED',receivedAt:now,mediaAssetId:'p',claimedCapturedAt:new Date(+now-30000)},requirement:{taskVerificationItemId:'sink'}},{id:second,requirementId:'r2',generation:0,sequence:1,requirement:{taskVerificationItemId:'sink'}}]);});
afterEach(()=>vi.useRealTimers());
const activate=()=>activatePhotoSlot(actor,'session',{slotId:second,deviceId:'device'});
it('pauses the shared object budget while the server checks the previous view',async()=>{await activate();expect(m.update).toHaveBeenCalledWith({where:{id:second},data:{activatedAt:now,expiresAt:new Date(+now+60000)}});});
it.each(['PROCESSING','RECEIVED','QUALITY_CHECK','CLEANING_REQUIRED','RECAPTURE_REQUIRED'])('blocks the next step while earlier photo is %s',async state=>{const slots=await m.slots();slots[0].attempt.state=state;await expect(activate()).rejects.toMatchObject({statusCode:409,errors:[{code:'PREVIOUS_PHOTO_UNRESOLVED'}]});expect(m.update).not.toHaveBeenCalled();});
it('a storage failure without received media cannot unlock the next object',async()=>{const slots=await m.slots();slots[0].attempt={state:'SERVICE_FAILURE',receivedAt:null,mediaAssetId:null};await expect(activate()).rejects.toMatchObject({statusCode:409});});
it('reopening a step cannot reset its deadline; expiry requires QR renewal',async()=>{const slots=await m.slots();slots[1].activatedAt=new Date(+now-10000);slots[1].expiresAt=new Date(+now+80000);await activate();expect(m.update).not.toHaveBeenCalled();vi.setSystemTime(new Date(+now+80001));await expect(activate()).rejects.toMatchObject({statusCode:410,errors:[{code:'QR_RENEWAL_REQUIRED'}]});});

it('a terminal review photo advances without consulting the removed queue',async()=>{m.jobs.mockResolvedValue(1);await expect(activate()).resolves.toBeDefined();expect(m.jobs).not.toHaveBeenCalled();expect(m.update).toHaveBeenCalled();});
it('caps an item deadline at the overall authorized photo-session deadline',async()=>{
 const s=await m.authorized();s.captureExpiresAt=new Date(+now+15000);
 await activate();
 expect(m.update).toHaveBeenCalledWith({where:{id:second},data:{activatedAt:now,expiresAt:new Date(+now+15000)}});
});
it('retired entrance slots cannot block activation of timed item photos',async()=>{
 const s=await m.authorized();s.locationCheck.captureContextPolicy={version:2,requiredKeys:[]};
 const slots=await m.slots();slots.unshift({id:'old-context',contextKey:'ENTRANCE',generation:0,sequence:-1});
 await activate();expect(m.update).toHaveBeenCalled();
});
