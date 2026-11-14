import type { SpatialCheckpoint,SpatialEvidence,SpatialSample } from './spatialTypes';
export function beginSpatialWorld(worldId:string,elapsedMs:number,previous?:SpatialCheckpoint,reason='RESTART'):SpatialCheckpoint{
 return {worldId,sequence:0,worldStartedElapsedMs:Math.round(elapsedMs),continuity:previous?'BROKEN':'CONTINUOUS',interruptionReasons:previous?[reason]:[]};
}
export function breakSpatialContinuity(checkpoint:SpatialCheckpoint,reason:string):SpatialCheckpoint{
 return {...checkpoint,continuity:'BROKEN',interruptionReasons:[...new Set([...checkpoint.interruptionReasons,reason])].slice(0,10)};
}
export function observationForCapture(checkpoint:SpatialCheckpoint,sample:SpatialSample,binding:{sessionId:string;requirementId:string|null;contextKey:string|null;elapsedMs:number;capability:SpatialEvidence['capability']},previous?:SpatialEvidence):{evidence:SpatialEvidence;checkpoint:SpatialCheckpoint}{
 sample=boundedSpatialSample(sample);
 const next=binding.capability==='NO_SPATIAL'?{...checkpoint,continuity:'BROKEN' as const}:sample.continuity==='BROKEN'?breakSpatialContinuity(checkpoint,'TRACKING_LOST'):checkpoint;
 const movement=next.continuity==='CONTINUOUS'&&previous?.continuity==='CONTINUOUS'&&previous.worldId===next.worldId&&previous.tracking==='GOOD'&&sample.tracking==='GOOD'&&previous.camera&&sample.camera?Math.hypot(previous.camera.position.x-sample.camera.position.x,previous.camera.position.y-sample.camera.position.y,previous.camera.position.z-sample.camera.position.z):null;
 const evidence:SpatialEvidence={...sample,sessionId:binding.sessionId,requirementId:binding.requirementId,contextKey:binding.contextKey,capability:binding.capability,version:1,worldId:next.worldId,sequence:next.sequence+1,worldStartedElapsedMs:next.worldStartedElapsedMs,capturedElapsedMs:Math.round(binding.elapsedMs),movementMeters:movement,continuity:next.continuity,interruptionReasons:next.interruptionReasons};
 return {evidence,checkpoint:{...next,sequence:evidence.sequence}};
}
export function spatialCaptureHint(sample:SpatialSample|null){
 if(!sample||sample.tracking==='UNAVAILABLE')return '';
 if(sample.continuity==='BROKEN')return "We couldn't confirm that this is a different item. Take a wider photo showing the surrounding area.";
 if(sample.tracking!=='GOOD')return 'Move your phone slowly around the area so we can continue.';
 return '';
}
/** Native numerical failures must not strand a valid still in the upload queue. */
export function boundedSpatialSample(sample:SpatialSample):SpatialSample{
 if(sample.tracking==='GOOD'&&(!sample.camera||sample.nativeTimestampMs===null)||sample.nativeTimestampMs!==null&&(!Number.isFinite(sample.nativeTimestampMs)||sample.nativeTimestampMs<0||sample.nativeTimestampMs>1e12))return {...sample,tracking:'UNAVAILABLE',continuity:'BROKEN',camera:null,worldPoint:null,nativeTimestampMs:null};
 const vectorValid=(v:{x:number;y:number;z:number})=>Object.values(v).every(n=>Number.isFinite(n)&&Math.abs(n)<=100);
 if(sample.camera){
  const q=sample.camera.orientation;
  if(!vectorValid(sample.camera.position)||!Object.values(q).every(n=>Number.isFinite(n)&&Math.abs(n)<=1)||Math.abs(Math.hypot(q.x,q.y,q.z,q.w)-1)>=.02)return {...sample,tracking:'UNAVAILABLE',continuity:'BROKEN',camera:null,worldPoint:null,nativeTimestampMs:null};
 }
 if(sample.worldPoint){
  const p=sample.worldPoint.position,c=sample.camera?.position;
  if(!c||sample.tracking!=='GOOD'||!vectorValid(p)||Math.hypot(p.x-c.x,p.y-c.y,p.z-c.z)>20)return {...sample,worldPoint:null};
 }
 return sample;
}
