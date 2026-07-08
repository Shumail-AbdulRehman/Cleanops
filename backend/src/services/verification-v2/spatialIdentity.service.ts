import { spatialEvidenceSchema,defaultSpatialPolicy,type SpatialEvidence,type SpatialPolicy } from './spatial.contracts.js';
export type SpatialDecision={
 version:1;policy:SpatialPolicy;result:'DISTINCT'|'SAME_POSITION_SUSPECTED'|'UNCERTAIN'|'UNAVAILABLE';reasonCodes:string[];
 worldId:string|null;autoIdentityAcceptance:false;
 comparisons:Array<{attemptId:string;fixtureId:number;pointDistanceMeters:number|null;cameraDisplacementMeters:number|null;reliable:boolean}>;
};
type Previous={attemptId:string;fixtureId:number;observation:SpatialEvidence};
const distance=(a:{x:number;y:number;z:number},b:{x:number;y:number;z:number})=>Math.hypot(a.x-b.x,a.y-b.y,a.z-b.z);
export function spatialIdentity(raw:unknown,fixtureId:number,previous:Previous[],policy=defaultSpatialPolicy):SpatialDecision{
 const parsed=spatialEvidenceSchema.safeParse(raw);
 const result:SpatialDecision={version:1,policy,result:'UNAVAILABLE',reasonCodes:[],worldId:null,autoIdentityAcceptance:false,comparisons:[]};
 if(!parsed.success||parsed.data.capability==='NO_SPATIAL'){result.reasonCodes=['SPATIAL_UNAVAILABLE'];return result;}
 const o=parsed.data;result.worldId=o.worldId;result.result='UNCERTAIN';
 if(o.continuity!=='CONTINUOUS'){result.reasonCodes=['SPATIAL_CONTINUITY_BROKEN'];return result;}
 if(o.tracking!=='GOOD'){result.reasonCodes=[o.tracking==='LOST'?'TRACKING_LOST':'LOW_TRACKING_QUALITY'];return result;}
 const others=previous.filter(p=>p.fixtureId!==fixtureId&&p.observation.sessionId===o.sessionId&&p.observation.worldId===o.worldId&&p.observation.sequence<o.sequence);
 if(!others.length){result.reasonCodes=['SPATIAL_BASELINE_ONLY'];return result;}
 const reliable=(p:SpatialEvidence)=>p.tracking==='GOOD'&&p.continuity==='CONTINUOUS'&&p.worldPoint?.quality==='GOOD'&&p.worldPoint.uncertaintyMeters!==null&&p.worldPoint.uncertaintyMeters<=policy.maxPointUncertaintyMeters;
 for(const p of others){
  const valid=p.observation.tracking==='GOOD'&&p.observation.continuity==='CONTINUOUS';
  result.comparisons.push({attemptId:p.attemptId,fixtureId:p.fixtureId,reliable:reliable(o)&&reliable(p.observation),
   pointDistanceMeters:valid&&o.worldPoint&&p.observation.worldPoint?distance(o.worldPoint.position,p.observation.worldPoint.position):null,
   cameraDisplacementMeters:valid&&o.camera&&p.observation.camera?distance(o.camera.position,p.observation.camera.position):null});
 }
 const usable=result.comparisons.filter(c=>c.reliable||policy.mode==='EVALUATE'&&policy.evaluateCandidatePoints&&c.pointDistanceMeters!==null);
 // Measurement uncertainty widens the undecided band rather than inventing precision.
 const margin=(o.worldPoint?.uncertaintyMeters??0)+Math.max(0,...others.map(p=>p.observation.worldPoint?.uncertaintyMeters??0));
 if(usable.some(c=>c.pointDistanceMeters!==null&&c.pointDistanceMeters+margin<=policy.samePositionMeters)){result.result='SAME_POSITION_SUSPECTED';result.reasonCodes=['FIXTURE_POSITION_TOO_CLOSE_TO_PREVIOUS'];}
 else if(usable.length===others.length&&usable.every(c=>c.pointDistanceMeters!==null&&c.pointDistanceMeters-margin>=policy.distinctPositionMeters)){result.result='DISTINCT';result.reasonCodes=['POSITION_DISTINCT'];}
 else {result.reasonCodes=[o.worldPoint?'FIXTURE_POINT_UNCERTAIN':'WORLD_POINT_UNAVAILABLE'];if(result.comparisons.some(c=>c.cameraDisplacementMeters!==null&&c.cameraDisplacementMeters<policy.cameraMovementMeters))result.reasonCodes.push('INSUFFICIENT_MOVEMENT');}
 return result;
}
/** Independent signals: nothing here creates PASSED, CLEAN or DIRTY. */
export function spatialIdentityAction(input:{decision:SpatialDecision;exactDuplicate:boolean;nearMatchedPosition:boolean;coverageMatch:boolean;identityConsistent:boolean;contextAcceptable:boolean},recaptureEnabled=false):'EXISTING_DUPLICATE_GATE'|'TARGETED_IDENTITY_RECAPTURE'|'EXISTING_SIGNALS'{
 if(input.exactDuplicate)return 'EXISTING_DUPLICATE_GATE';
 if(recaptureEnabled&&input.decision.policy.mode==='ASSISTED_RECAPTURE'&&input.decision.result==='SAME_POSITION_SUSPECTED'&&input.decision.comparisons.some(c=>c.reliable)&&input.nearMatchedPosition&&input.coverageMatch&&input.identityConsistent&&input.contextAcceptable)return 'TARGETED_IDENTITY_RECAPTURE';
 return 'EXISTING_SIGNALS';
}
