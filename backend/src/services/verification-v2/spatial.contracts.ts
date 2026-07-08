import { z } from 'zod';
const finite = z.number().finite();
const vector = z.object({x:finite.min(-100).max(100),y:finite.min(-100).max(100),z:finite.min(-100).max(100)}).strict();
const quaternion = z.object({x:finite.min(-1).max(1),y:finite.min(-1).max(1),z:finite.min(-1).max(1),w:finite.min(-1).max(1)}).strict().refine(q=>Math.abs(Math.hypot(q.x,q.y,q.z,q.w)-1)<0.02,'Orientation must be normalized');
export const spatialEvidenceSchema = z.object({
 version:z.literal(1),sessionId:z.uuid(),worldId:z.uuid(),sequence:z.number().int().positive().max(10000),
 requirementId:z.uuid().nullable(),contextKey:z.enum(['ENTRANCE','LAYOUT']).nullable(),
 capability:z.enum(['FULL_SPATIAL','LIMITED_SPATIAL','NO_SPATIAL']),
 tracking:z.enum(['GOOD','DEGRADED','LOST','UNAVAILABLE']),continuity:z.enum(['CONTINUOUS','BROKEN']),
 capturedElapsedMs:finite.int().nonnegative().max(86400000),worldStartedElapsedMs:finite.int().nonnegative().max(86400000),
 nativeTimestampMs:finite.nonnegative().max(1e12).nullable(),
 camera:z.object({position:vector,orientation:quaternion}).strict().nullable(),
 worldPoint:z.object({position:vector,method:z.enum(['CENTER_PLANE','CENTER_DEPTH']),quality:z.enum(['CANDIDATE','GOOD']),uncertaintyMeters:finite.nonnegative().max(10).nullable()}).strict().nullable(),
 movementMeters:finite.nonnegative().max(200).nullable(),
 interruptionReasons:z.array(z.enum(['BACKGROUND','NAVIGATION','OCCUPIED','PERMISSION_CHANGED','RESTART','TRACKING_LOST','CAMERA_RESTART','SESSION_RENEWED','NATIVE_FAILURE'])).max(10),
}).strict().superRefine((o,ctx)=>{
 const reject=(message:string)=>ctx.addIssue({code:'custom',message});
 if((o.requirementId===null)===(o.contextKey===null))reject('Exactly one capture purpose required');
 if(o.worldStartedElapsedMs>o.capturedElapsedMs)reject('World starts after capture');
 if(o.capability==='NO_SPATIAL'&&(o.camera||o.worldPoint||o.tracking!=='UNAVAILABLE'))reject('Unsupported device cannot claim a pose');
 if(o.tracking==='GOOD'&&(!o.camera||o.nativeTimestampMs===null))reject('Good tracking requires a timestamp and pose');
 if(o.worldPoint&&(!o.camera||o.tracking!=='GOOD'))reject('World point requires good tracking');
 if(o.worldPoint&&o.camera&&Math.hypot(o.worldPoint.position.x-o.camera.position.x,o.worldPoint.position.y-o.camera.position.y,o.worldPoint.position.z-o.camera.position.z)>20)reject('Point exceeds supported ray range');
 if(o.continuity==='CONTINUOUS'&&o.interruptionReasons.length)reject('Interrupted world cannot claim continuity');
});
export type SpatialEvidence = z.infer<typeof spatialEvidenceSchema>;
export const spatialUploadSchema = z.preprocess(value=>{
 if(typeof value!=='string')return value;
 if(Buffer.byteLength(value)>4096)return null;
 try{return JSON.parse(value);}catch{return null;}
},spatialEvidenceSchema).optional();
export const spatialPolicySchema=z.object({
 version:z.literal(1).default(1),thresholdVersion:z.string().min(1).max(80).default('candidate-v1'),mode:z.enum(['OFF','EVALUATE','ASSISTED_RECAPTURE']).default('OFF'),
 // Deliberately closed in code. Metadata never independently authorizes credit.
 autoIdentityAcceptance:z.literal(false).default(false),
 samePositionMeters:z.number().min(0.02).max(1).default(0.25),
 distinctPositionMeters:z.number().min(0.1).max(5).default(0.6),
 cameraMovementMeters:z.number().min(0.01).max(3).default(0.15),
 maxPointUncertaintyMeters:z.number().min(0.01).max(1).default(0.2),
 evaluateCandidatePoints:z.boolean().default(false),
}).strict().refine(p=>p.distinctPositionMeters>p.samePositionMeters,'Distinct boundary must exceed same-position boundary');
export type SpatialPolicy=z.infer<typeof spatialPolicySchema>;
export const defaultSpatialPolicy=spatialPolicySchema.parse({});
/** Order is capture order, not network arrival order: offline uploads can arrive out of order. */
export function validateSpatialBinding(current:SpatialEvidence,binding:{sessionId:string;requirementId:string|null;contextKey:string|null;elapsedMs:number},history:SpatialEvidence[]){
 if(current.sessionId!==binding.sessionId||current.requirementId!==binding.requirementId||current.contextKey!==binding.contextKey)throw new Error('SPATIAL_BINDING_MISMATCH');
 if(Math.abs(current.capturedElapsedMs-binding.elapsedMs)>1000)throw new Error('SPATIAL_TIME_MISMATCH');
 const same=history.filter(p=>p.worldId===current.worldId);
 for(const p of same){
  if(p.sequence===current.sequence)throw new Error('SPATIAL_SEQUENCE_REUSED');
  if(p.worldStartedElapsedMs!==current.worldStartedElapsedMs)throw new Error('SPATIAL_WORLD_ANCHOR_CHANGED');
  const before=p.sequence<current.sequence;
  if(before?p.capturedElapsedMs>=current.capturedElapsedMs:p.capturedElapsedMs<=current.capturedElapsedMs)throw new Error('SPATIAL_ORDER_MISMATCH');
  if(p.nativeTimestampMs!==null&&current.nativeTimestampMs!==null){
   const delta=current.nativeTimestampMs-p.nativeTimestampMs;
   if((before?delta<=0:delta>=0)||Math.abs(delta-(current.capturedElapsedMs-p.capturedElapsedMs))>1000)throw new Error('SPATIAL_NATIVE_TIME_MISMATCH');
  }
  if(before&&p.continuity==='BROKEN'&&current.continuity==='CONTINUOUS'||!before&&current.continuity==='BROKEN'&&p.continuity==='CONTINUOUS')throw new Error('SPATIAL_CONTINUITY_MISMATCH');
 }
 if(history.some(p=>p.worldId!==current.worldId&&(p.capturedElapsedMs<current.capturedElapsedMs&&current.continuity==='CONTINUOUS'||p.capturedElapsedMs>current.capturedElapsedMs&&p.continuity==='CONTINUOUS')))throw new Error('SPATIAL_WORLD_CHANGED');
}
