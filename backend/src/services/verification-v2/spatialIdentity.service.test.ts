import {describe,it,expect} from 'vitest';
import {spatialEvidenceSchema,spatialUploadSchema,validateSpatialBinding,spatialPolicySchema,type SpatialEvidence} from './spatial.contracts.js';
import {spatialIdentity,spatialIdentityAction} from './spatialIdentity.service.js';
import {requirementDecision,reduceRequirement} from './verificationPolicy.service.js';
import {autoPassAllowed} from './cleanliness.service.js';
const sessionId='11111111-1111-4111-8111-111111111111',worldId='22222222-2222-4222-8222-222222222222',requirementId='33333333-3333-4333-8333-333333333333';
function observation(overrides:Partial<SpatialEvidence>={}):SpatialEvidence{return {version:1,sessionId,worldId,requirementId,contextKey:null,sequence:2,capability:'LIMITED_SPATIAL',tracking:'GOOD',continuity:'CONTINUOUS',capturedElapsedMs:2000,worldStartedElapsedMs:0,nativeTimestampMs:12000,camera:{position:{x:1,y:0,z:1},orientation:{x:0,y:0,z:0,w:1}},worldPoint:{position:{x:1,y:0,z:0},method:'CENTER_DEPTH',quality:'GOOD',uncertaintyMeters:0.02},movementMeters:1,interruptionReasons:[],...overrides};}
const previous=()=>({attemptId:'prior',fixtureId:1,observation:observation({sequence:1,capturedElapsedMs:1000,nativeTimestampMs:11000})});
const binding={sessionId,requirementId,contextKey:null,elapsedMs:2000};
describe('bounded untrusted metadata',()=>{
 it('accepts versioned observation and multipart JSON',()=>{expect(spatialEvidenceSchema.parse(observation()).version).toBe(1);expect(spatialUploadSchema.parse(JSON.stringify(observation()))).toEqual(observation());});
 it.each([NaN,Infinity,-Infinity,101,-101])('rejects malformed or impossible coordinate %s',x=>{expect(spatialEvidenceSchema.safeParse(observation({camera:{position:{x,y:0,z:0},orientation:{x:0,y:0,z:0,w:1}}})).success).toBe(false);});
 it('rejects version, fake capability, non-unit orientation, extra raw maps and oversized metadata',()=>{
  for(const raw of [{...observation(),version:2},{...observation(),capability:'NO_SPATIAL'},{...observation(),camera:{position:{x:0,y:0,z:0},orientation:{x:0,y:0,z:0,w:0}}},{...observation(),map:'raw'},{...observation(),worldStartedElapsedMs:3000}])expect(spatialEvidenceSchema.safeParse(raw).success).toBe(false);
  expect(spatialUploadSchema.safeParse('x'.repeat(4097)).success).toBe(false);expect(spatialUploadSchema.safeParse('{bad').success).toBe(false);
 });
 it('rejects a world point behind unavailable tracking and implausible ray length',()=>{
  expect(spatialEvidenceSchema.safeParse(observation({tracking:'LOST'})).success).toBe(false);
  expect(spatialEvidenceSchema.safeParse(observation({worldPoint:{position:{x:50,y:0,z:0},method:'CENTER_PLANE',quality:'CANDIDATE',uncertaintyMeters:null}})).success).toBe(false);
 });
 it('rejects wrong session/requirement/time binding',()=>{
  expect(()=>validateSpatialBinding(observation(),{...binding,sessionId:worldId},[])).toThrow('SPATIAL_BINDING_MISMATCH');
  expect(()=>validateSpatialBinding(observation(),{...binding,requirementId:worldId},[])).toThrow('SPATIAL_BINDING_MISMATCH');
  expect(()=>validateSpatialBinding(observation(),{...binding,elapsedMs:10000},[])).toThrow('SPATIAL_TIME_MISMATCH');
 });
 it('orders by capture sequence, permits delayed earlier uploads, rejects reused sequence and reversed clocks',()=>{
  const first=previous().observation;validateSpatialBinding(observation(),binding,[first]);
  validateSpatialBinding(first,{...binding,elapsedMs:1000},[observation()]);
  expect(()=>validateSpatialBinding(observation(),binding,[observation()])).toThrow('SPATIAL_SEQUENCE_REUSED');
  expect(()=>validateSpatialBinding(observation({capturedElapsedMs:500}),{...binding,elapsedMs:500},[first])).toThrow('SPATIAL_ORDER_MISMATCH');
  expect(()=>validateSpatialBinding(observation({nativeTimestampMs:10000}),binding,[first])).toThrow('SPATIAL_NATIVE_TIME_MISMATCH');
 });
 it('rejects changed world anchor and silently restored continuity',()=>{
  expect(()=>validateSpatialBinding(observation({worldStartedElapsedMs:50}),binding,[previous().observation])).toThrow('SPATIAL_WORLD_ANCHOR_CHANGED');
  expect(()=>validateSpatialBinding(observation(),binding,[{...previous().observation,continuity:'BROKEN'}])).toThrow('SPATIAL_CONTINUITY_MISMATCH');
  expect(()=>validateSpatialBinding(observation({worldId:requirementId}),binding,[previous().observation])).toThrow('SPATIAL_WORLD_CHANGED');
  validateSpatialBinding(observation({worldId:requirementId,continuity:'BROKEN',interruptionReasons:['RESTART']}),binding,[previous().observation]);
 });
});
describe('spatial candidate decisions remain separate',()=>{
 it('suspects same physical point despite camera moving around fixture',()=>{
  const result=spatialIdentity(observation({camera:{position:{x:-1,y:0,z:0},orientation:{x:0,y:0,z:0,w:1}}}),2,[previous()]);
  expect(result.result).toBe('SAME_POSITION_SUSPECTED');expect(result.comparisons[0]?.cameraDisplacementMeters).toBeGreaterThan(1);expect(result.autoIdentityAcceptance).toBe(false);
 });
 it('records distinct candidate against every previous credited fixture without passing',()=>{
  const o=observation({worldPoint:{position:{x:3,y:0,z:0},method:'CENTER_DEPTH',quality:'GOOD',uncertaintyMeters:0.02}});
  expect(spatialIdentity(o,2,[previous()]).result).toBe('DISTINCT');
 });
 it('large uncertainty widens undecided band; null uncertainty is never precise',()=>{
  const point=observation().worldPoint!;
  for(const uncertaintyMeters of [null,0.8])expect(spatialIdentity(observation({worldPoint:{...point,uncertaintyMeters}}),2,[previous()]).result).toBe('UNCERTAIN');
 });
 it.each(['DEGRADED','LOST','UNAVAILABLE'] as const)('tracking %s remains uncertain',tracking=>{expect(spatialIdentity(observation({tracking,worldPoint:null}),2,[previous()]).result).toBe('UNCERTAIN');});
 it('unsupported device is unavailable; interrupted session is uncertain',()=>{
  expect(spatialIdentity(observation({capability:'NO_SPATIAL',tracking:'UNAVAILABLE',camera:null,worldPoint:null}),2,[previous()]).result).toBe('UNAVAILABLE');
  expect(spatialIdentity(observation({continuity:'BROKEN',interruptionReasons:['BACKGROUND']}),2,[previous()]).reasonCodes).toContain('SPATIAL_CONTINUITY_BROKEN');
 });
 it('never compares worlds, sessions, later captures or other views of the same fixture',()=>{
  for(const p of [{...previous(),fixtureId:2},{...previous(),observation:observation({worldId:requirementId})},{...previous(),observation:observation({sessionId:worldId})},{...previous(),observation:observation({sequence:3})}])expect(spatialIdentity(observation(),2,[p]).comparisons).toEqual([]);
 });
 it('camera movement alone never establishes distinction',()=>{expect(spatialIdentity(observation({worldPoint:null,camera:{position:{x:10,y:0,z:0},orientation:{x:0,y:0,z:0,w:1}}}),2,[previous()]).result).toBe('UNCERTAIN');});
 it('uncalibrated plane/depth candidates are uncertain except explicit evaluation mode',()=>{
  const o=observation({worldPoint:{...observation().worldPoint!,quality:'CANDIDATE',uncertaintyMeters:null}});
  expect(spatialIdentity(o,2,[previous()]).result).toBe('UNCERTAIN');
  expect(spatialIdentity(o,2,[previous()],spatialPolicySchema.parse({mode:'EVALUATE',evaluateCandidatePoints:true})).result).toBe('SAME_POSITION_SUSPECTED');
 });
 it('policy combines matched duplicate, reliable same position, coverage and context for targeted identity recapture only',()=>{
  const decision=spatialIdentity(observation(),2,[previous()],spatialPolicySchema.parse({mode:'ASSISTED_RECAPTURE'}));
  const input={decision,exactDuplicate:false,nearMatchedPosition:true,coverageMatch:true,identityConsistent:true,contextAcceptable:true};
  expect(spatialIdentityAction(input)).toBe('EXISTING_SIGNALS');expect(spatialIdentityAction(input,true)).toBe('TARGETED_IDENTITY_RECAPTURE');
  for(const key of ['nearMatchedPosition','coverageMatch','identityConsistent','contextAcceptable'] as const)expect(spatialIdentityAction({...input,[key]:false},true)).toBe('EXISTING_SIGNALS');
  expect(spatialIdentityAction({...input,exactDuplicate:true},true)).toBe('EXISTING_DUPLICATE_GATE');
 });
 it('spatial uncertainty does not become dirty or erase passed evidence and cannot enable Clef passing',()=>{
  const passed={state:'PASSED',decisionVersion:1,currentAttemptId:'old'};
  expect(reduceRequirement(passed,{type:'RESULT',attemptId:'old',expectedVersion:1,state:'REVIEW_REQUIRED'})).toEqual(passed);
  expect(requirementDecision({coverage:'MATCH',cleanliness:'CANNOT_ASSESS',surfaceVerdicts:['CANNOT_ASSESS']})).toBe('RECAPTURE_REQUIRED');
  expect(requirementDecision({coverage:'MATCH',cleanliness:'CLEAN',surfaceVerdicts:['CLEAN']})).toBe('PASSED');
  expect(autoPassAllowed('TOILET')).toBe(false);expect(spatialPolicySchema.safeParse({autoIdentityAcceptance:true}).success).toBe(false);
 });
});
