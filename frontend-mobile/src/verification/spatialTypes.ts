/** Metres in one ephemeral local world. Never compare across world IDs. */
export type Vector3 = { x:number; y:number; z:number };
export type SpatialSample = {
  tracking:'GOOD'|'DEGRADED'|'LOST'|'UNAVAILABLE';
  continuity:'CONTINUOUS'|'BROKEN';
  nativeTimestampMs:number|null;
  camera:{position:Vector3;orientation:{x:number;y:number;z:number;w:number}}|null;
  worldPoint:{position:Vector3;method:'CENTER_PLANE'|'CENTER_DEPTH';quality:'CANDIDATE'|'GOOD';uncertaintyMeters:number|null}|null;
};
export type SpatialEvidence = SpatialSample & {
  version:1; sessionId:string; worldId:string; sequence:number; requirementId:string|null; contextKey:string|null;
  capability:'FULL_SPATIAL'|'LIMITED_SPATIAL'|'NO_SPATIAL';
  capturedElapsedMs:number; worldStartedElapsedMs:number; movementMeters:number|null;
  interruptionReasons:string[];
};
export type SpatialCheckpoint = {worldId:string;sequence:number;worldStartedElapsedMs:number;continuity:'CONTINUOUS'|'BROKEN';interruptionReasons:string[]};
