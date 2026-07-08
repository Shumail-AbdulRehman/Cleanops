import {describe,it,expect,vi} from 'vitest';
import {duplicateClassification} from './duplicate.service.js';
import {validateCleanlinessResult,assessCleanliness,autoPassAllowed} from './cleanliness.service.js';
import {coverageResultSchema} from './coverage.service.js';
import {ConfiguredImageProvider,ProviderServiceFailure} from './provider.service.js';
import {requirementDecision,escalationDecision,reduceRequirement} from './verificationPolicy.service.js';
describe('separate evaluator semantics',()=>{
 it('similar identical-looking toilets are candidates, not fraud',()=>{const base={id:'a',sha256:'a',normalizedHash:'a',perceptualHash:'0000000000000000'};const result=duplicateClassification(base,[{...base,id:'b',sha256:'b',normalizedHash:'b'}]);expect(result.exact).toEqual([]);expect(result.near).toEqual(['b']);expect(result.nearIsFraud).toBe(false);});
 it('exact bytes or normalized reuse cannot gain another fixture credit',()=>{const base={id:'a',sha256:'a',normalizedHash:'n',perceptualHash:null};expect(duplicateClassification(base,[{...base,id:'b'}]).exact).toEqual(['b']);expect(duplicateClassification(base,[base]).exact).toEqual([]);});
 it('rejects missing, duplicate and contradictory required surface assessments',()=>{expect(()=>validateCleanlinessResult({verdict:'CLEAN',reasonCode:'CLEAN',surfaces:[{surface:'bowl',verdict:'CLEAN'}]},['base'])).toThrow();expect(()=>validateCleanlinessResult({verdict:'CLEAN',reasonCode:'CLEAN',surfaces:[{surface:'bowl',verdict:'DIRTY'}]},['bowl'])).toThrow();});
 it('cannot assess stays recapture; service and wrong fixture never become dirty',()=>{expect(requirementDecision({cleanliness:'CANNOT_ASSESS'})).toBe('RECAPTURE_REQUIRED');expect(requirementDecision({serviceFailure:true})).toBe('SERVICE_FAILURE');expect(requirementDecision({coverage:'WRONG_ITEM',cleanliness:'DIRTY'})).toBe('RECAPTURE_REQUIRED');});
 it('keeps ordinary failures with staff until third failure',()=>{expect(escalationDecision('CLEANING',1)).toBe('STAFF_ACTION_REQUIRED');expect(escalationDecision('RECAPTURE',2)).toBe('STAFF_ACTION_REQUIRED');expect(escalationDecision('CLEANING',3)).toBe('MANAGER_REVIEW');});
 it('passed and newer retake requirements survive stale results',()=>{const r={state:'PASSED',decisionVersion:2,currentAttemptId:'new'};expect(reduceRequirement(r,{type:'RESULT',expectedVersion:1,attemptId:'old',state:'CLEANING_REQUIRED'})).toEqual(r);expect(reduceRequirement(r,{type:'RETRY',expectedVersion:2,attemptId:'retry'})).toEqual(r);});
 it('ambiguous identity is an independent structured coverage result',()=>{expect(coverageResultSchema.parse({verdict:'UNCERTAIN',observedFixture:'TOILET',observedView:'bowl',observedLabel:null,identityConsistent:false,privacyFlag:false,reasonCode:'IDENTITY_UNCERTAIN'}).verdict).toBe('UNCERTAIN');});
 it('does not enable auto pass without held-out evidence',()=>expect(autoPassAllowed('TOILET')).toBe(false));
 it('provider outage cannot fabricate an assessment',async()=>{vi.stubEnv('AI_PROVIDER','unsupported');await expect(new ConfiguredImageProvider().assess('cleanliness','',[],coverageResultSchema)).rejects.toBeInstanceOf(ProviderServiceFailure);vi.unstubAllEnvs();});
 it('validates injected provider responses before returning cleanliness',async()=>{const provider={assess:async()=>({result:{verdict:'CLEAN',surfaces:[{surface:'other',verdict:'CLEAN'}],reasonCode:'CLEAN'},metadata:{}})};await expect(assessCleanliness(provider as any,Buffer.from('image'),{version:1},'bowl')).rejects.toThrow();});
});

describe('strict stages and compound surfaces',()=>{
 it('compares mirrored/cropped variants and deduplicates candidates',()=>{const a={id:'a',sha256:'a',normalizedHash:null,perceptualHash:'0000000000000000',hashVariants:['ffffffffffffffff']};const b={id:'b',sha256:'b',normalizedHash:null,perceptualHash:'ffffffffffffffff'};expect(duplicateClassification(a,[b,b]).near).toEqual(['b']);});
 it('unassessable surface dominates dirty and cannot be aggregated clean',()=>{expect(()=>validateCleanlinessResult({verdict:'DIRTY',reasonCode:'CLEANING_REQUIRED',surfaces:[{surface:'bowl',verdict:'DIRTY'},{surface:'seat',verdict:'CANNOT_ASSESS'}]},['bowl','seat'])).toThrow();});
 it('validates every compound surface returned by an injected provider',async()=>{const provider={assess:async()=>({result:{verdict:'CLEAN',reasonCode:'CLEAN',surfaces:[{surface:'bowl',verdict:'CLEAN'}]},metadata:{}})};await expect(assessCleanliness(provider as any,Buffer.from('image'),{version:1,criteria:['visible'],views:[{key:'bowl_seat'}],surfacesByView:{bowl_seat:['bowl','seat']}},'bowl_seat')).rejects.toThrow();});
});

it('rejects legacy rubric snapshots without immutable surface mapping',async()=>{await expect(assessCleanliness({assess:async()=>{throw new Error('must not call');}} as any,Buffer.from('a'),{version:1,criteria:['visible'],views:[{key:'bowl_seat'}]},'bowl_seat')).rejects.toThrow('RUBRIC_REVIEW_REQUIRED');});
