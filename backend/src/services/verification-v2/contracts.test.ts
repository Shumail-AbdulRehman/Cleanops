import {describe,it,expect} from 'vitest';
import {captureMetadataSchema,clientDiagnosticsSchema,requiredViewsSchema,sessionRequestSchema} from './contracts.js';
import {resolvePolicy} from './verificationPolicy.service.js';
describe('v2 contracts',()=>{
 it('accepts the millisecond diagnostics sent by native APK 2.1.2 and normalizes them for traces',()=>{
  const capturedAt=Date.parse('2026-10-09T05:00:00.000Z');
  const localCategory={outcome:'UNCERTAIN',expectedCategory:'TOILET',predictedCategory:null,score:null,margin:null,durationMs:25,modelVersion:'test-model',reason:'LOCAL_CHECK_UNAVAILABLE'};
  expect(clientDiagnosticsSchema.parse(JSON.stringify({capturedAt,durableSavedAt:capturedAt+100,uploadStartedAt:capturedAt+200,localCategory}))).toEqual({
   capturedAt:'2026-10-09T05:00:00.000Z',durableSavedAt:'2026-10-09T05:00:00.100Z',uploadStartedAt:'2026-10-09T05:00:00.200Z',localCategory,
  });
 });
 it('preserves ISO diagnostics and rejects invalid diagnostic timestamps or authority fields',()=>{
  expect(clientDiagnosticsSchema.parse({capturedAt:'2026-10-09T05:00:00.000Z'})).toEqual({capturedAt:'2026-10-09T05:00:00.000Z'});
  for(const capturedAt of [-1,1.5,NaN,Infinity,253402300800000,'1791522000000','invalid'])expect(clientDiagnosticsSchema.safeParse({capturedAt}).success).toBe(false);
  expect(clientDiagnosticsSchema.safeParse({capturedAt:1791522000000,authorityValid:true}).success).toBe(false);
  expect(clientDiagnosticsSchema.parse(undefined)).toBeUndefined();
 });
 it('requires bound capture identities and rejects arbitrary fields',()=>{expect(captureMetadataSchema.safeParse({}).success).toBe(false);expect(sessionRequestSchema.safeParse({workflowVersion:1}).success).toBe(false);});
 it('rejects ambiguous and empty required views',()=>{expect(requiredViewsSchema.safeParse([]).success).toBe(false);expect(requiredViewsSchema.safeParse([{key:'x',instructions:'Show'},{key:'x',instructions:'Show'}]).success).toBe(false);});
 it('bounds server policy independently of subscriptions',()=>{expect(resolvePolicy(null).captureMinutes).toBe(20);expect(()=>resolvePolicy({maxItems:201})).toThrow();expect(()=>resolvePolicy({maxExtensionMinutes:121})).toThrow();});
});
