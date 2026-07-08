import { z } from 'zod';
import {spatialPolicySchema} from './spatial.contracts.js';
export const verificationPolicySchema = z.object({
 spatial:spatialPolicySchema.default(()=>spatialPolicySchema.parse({})),
 version: z.literal(1).default(1), objectCaptureSeconds:z.number().int().min(15).max(600).default(90), captureMinutes: z.number().int().min(5).max(30).default(20),
 reworkMinutes: z.number().int().min(0).max(60).default(30), uploadMinutes: z.number().int().min(5).max(30).default(15),
 maxExtensionMinutes: z.number().int().min(0).max(120).default(120),
 cleaningFailuresBeforeEscalation: z.number().int().min(2).max(5).default(3),
 recaptureFailuresBeforeEscalation: z.number().int().min(2).max(5).default(3),
 maxGpsAgeSeconds: z.number().int().min(10).max(60).default(60), maxGpsAccuracyMeters: z.number().min(5).max(50).default(50),
 maxItems: z.number().int().min(1).max(200).default(200),
}).strict();
export type VerificationPolicy = z.infer<typeof verificationPolicySchema>;
export const defaultVerificationPolicy = verificationPolicySchema.parse({});
export const DEFAULT_VERIFICATION_POLICY = defaultVerificationPolicy;
export function resolvePolicy(value: unknown): VerificationPolicy { return verificationPolicySchema.parse(value ?? {}); }
export function taskDeadlines(shiftEnd: Date, policy = defaultVerificationPolicy) {
 return { verificationDeadline: new Date(+shiftEnd + policy.reworkMinutes * 60000), uploadDeadline: new Date(+shiftEnd + (policy.reworkMinutes + policy.uploadMinutes) * 60000) };
}
export const cleanlinessSchema = z.object({ verdict: z.enum(['CLEAN','NEEDS_ATTENTION','DIRTY','CANNOT_ASSESS']), surfaces: z.array(z.object({surface:z.string().max(100),verdict:z.enum(['CLEAN','NEEDS_ATTENTION','DIRTY','CANNOT_ASSESS'])})).min(1), reasonCode:z.string().max(80), instructions:z.string().max(300) });
export const coverageSchema = z.object({ verdict:z.enum(['MATCH','WRONG_ITEM','MISSING_SURFACE','UNCERTAIN']), observedFixture:z.string().max(100), observedView:z.string().max(100), observedLabel:z.string().max(100).nullable(), reasonCode:z.string().max(80), privacyFlag:z.boolean() });
export function requirementDecision(input:{serviceFailure?:boolean;privacyHold?:boolean;qualityPass?:boolean;coverage?:string;cleanliness?:string;surfaceVerdicts?:string[]}) {
 if(input.privacyHold) return 'PRIVACY_HOLD' as const;
 if(input.serviceFailure) return 'SERVICE_FAILURE' as const;
 if(input.qualityPass===false || (input.coverage && input.coverage!=='MATCH')) return 'RECAPTURE_REQUIRED' as const;
 if(input.cleanliness==='CANNOT_ASSESS'||input.surfaceVerdicts?.includes('CANNOT_ASSESS')) return 'RECAPTURE_REQUIRED' as const;
 if(input.cleanliness==='DIRTY'||input.cleanliness==='NEEDS_ATTENTION'||input.surfaceVerdicts?.some(v=>v==='DIRTY'||v==='NEEDS_ATTENTION')) return 'CLEANING_REQUIRED' as const;
 if(input.coverage==='MATCH'&&input.cleanliness==='CLEAN'&&input.surfaceVerdicts?.length&&input.surfaceVerdicts.every(v=>v==='CLEAN')) return 'PASSED' as const;
 return 'REVIEW_REQUIRED' as const;
}
export function completionEligibility(input:{requirements:{mandatory:boolean;state:string}[];presenceAcceptable:boolean;contextAcceptable:boolean;blockingIssues:boolean;hasManualOverride:boolean;assignmentCurrent:boolean}) {
 const mandatory=input.requirements.filter(r=>r.mandatory);
 if(!mandatory.length||input.blockingIssues||!input.assignmentCurrent) return null;
 if(mandatory.some(r=>!['PASSED','MANAGER_ACCEPTED','WAIVED'].includes(r.state))) return null;
 const manual=input.hasManualOverride||mandatory.some(r=>r.state!=='PASSED');
 if((!input.presenceAcceptable||!input.contextAcceptable)&&!input.hasManualOverride) return null;
 return manual?'COMPLETED_WITH_EXCEPTIONS':'VERIFIED_COMPLETE';
}
export function classifyTiming(capturedAt:Date, deadline:Date, committedAt:Date|null, receivedAt:Date, anchoredValid:boolean) {
 if(committedAt&&committedAt<=deadline) return 'ON_TIME_SERVER_OBSERVED';
 if(receivedAt<=deadline) return 'ON_TIME_SERVER_OBSERVED';
 if(!anchoredValid) return 'UNCERTAIN';
 return capturedAt<=deadline?'ON_TIME_DEVICE_REPORTED':'LATE';
}
export const reasonInstructions:Record<string,string>={CANNOT_ASSESS:'Show the whole required surface and retake.',WRONG_ITEM:'Photograph the item shown on this screen.',MISSING_SURFACE:'Include the whole required surface.',TOO_DARK:'Turn on the light or torch.',BLURRY:'Hold still and retake.',DUPLICATE_EVIDENCE:'Take a fresh photo showing this fixture and its surroundings.',SERVICE_FAILURE:'Your photo is saved. Checks will retry.',OCCUPIED:'Wait until the room is empty.',DAMAGED:'Ask your manager to review this fixture.'};

export function sessionWindows(issuedAt:Date,shiftEnd:Date,policy=defaultVerificationPolicy,startedAt:Date|null=null,extensionMinutes=0) {
 if(!startedAt||startedAt>shiftEnd) throw new Error('Task must have started by its original deadline');
 if(!Number.isInteger(extensionMinutes)||extensionMinutes<0||extensionMinutes>policy.maxExtensionMinutes) throw new Error('Extension exceeds policy');
 const end=new Date(+shiftEnd+Math.max(policy.reworkMinutes,extensionMinutes)*60000);
 const captureExpiresAt=new Date(Math.min(+issuedAt+policy.captureMinutes*60000,+end));
 if(captureExpiresAt<=issuedAt) throw new Error('Capture window expired');
 return {captureExpiresAt,uploadExpiresAt:new Date(Math.min(+captureExpiresAt+policy.uploadMinutes*60000,+end+policy.uploadMinutes*60000))};
}
export function reduceSession(state:'ACTIVE'|'PAUSED'|'CLOSED'|'EXPIRED'|'REVOKED',event:'PAUSE'|'RESUME'|'CLOSE'|'EXPIRE'|'REVOKE') {
 if(!['ACTIVE','PAUSED'].includes(state))return state;
 if(event==='PAUSE')return 'PAUSED';if(event==='RESUME')return 'ACTIVE';
 return ({CLOSE:'CLOSED',EXPIRE:'EXPIRED',REVOKE:'REVOKED'} as const)[event];
}
export function reduceRequirement(input:{state:string;decisionVersion:number;currentAttemptId:string|null},event:{type:'RESULT'|'RETRY'|'ACCEPT'|'WAIVE';expectedVersion:number;attemptId:string;state?:string}) {
 if(event.expectedVersion!==input.decisionVersion)return input;
 if(event.type==='RESULT') {
  if(input.currentAttemptId!==event.attemptId||['PASSED','MANAGER_ACCEPTED','WAIVED'].includes(input.state))return input;
  if(!['PASSED','RECAPTURE_REQUIRED','CLEANING_REQUIRED','REVIEW_REQUIRED'].includes(event.state??'')) throw new Error('Invalid requirement result');
  return {...input,state:event.state!,decisionVersion:input.decisionVersion+1};
 }
 if(event.type==='RETRY') {
  if(['PASSED','MANAGER_ACCEPTED','WAIVED'].includes(input.state))return input;
  return {...input,state:'PROCESSING',currentAttemptId:event.attemptId,decisionVersion:input.decisionVersion+1};
 }
 return {...input,state:event.type==='ACCEPT'?'MANAGER_ACCEPTED':'WAIVED',decisionVersion:input.decisionVersion+1};
}
export function aggregateItems(items:{mandatory:boolean;requirements:{mandatory:boolean;state:string}[]}[]) {
 const required=items.filter(i=>i.mandatory);
 if(!required.length||required.some(i=>!i.requirements.some(r=>r.mandatory)))return {valid:false,requirements:[]};
 return {valid:true,requirements:required.flatMap(i=>i.requirements.filter(r=>r.mandatory))};
}
export function reduceTaskVerification(current:string,input:{capturing:boolean;processing:boolean;review:boolean;rework:boolean;outcome:string|null}) {
 if(['VERIFIED','RESOLVED_WITH_EXCEPTIONS'].includes(current))return current;
 if(input.outcome)return input.outcome==='VERIFIED_COMPLETE'?'VERIFIED':'RESOLVED_WITH_EXCEPTIONS';
 if(input.review)return 'NEEDS_REVIEW';if(input.rework)return 'REWORK_REQUIRED';if(input.processing)return 'PROCESSING';if(input.capturing)return 'CAPTURING';return 'NOT_STARTED';
}
export function escalationDecision(kind:'CLEANING'|'RECAPTURE'|'SERVICE'|'INTEGRITY'|'PRIVACY',failures:number,policy=defaultVerificationPolicy) {
 if(kind==='INTEGRITY'||kind==='PRIVACY')return 'IMMEDIATE_REVIEW';
 if(kind==='SERVICE')return 'RETRY_SERVICE';
 return failures>=(kind==='CLEANING'?policy.cleaningFailuresBeforeEscalation:policy.recaptureFailuresBeforeEscalation)?'MANAGER_REVIEW':'STAFF_ACTION_REQUIRED';
}
export function presenceDecision(input:{distance:number;accuracy:number;ageSeconds:number;radius:number},policy=defaultVerificationPolicy) {
 if(!Object.values(input).every(Number.isFinite)||input.accuracy<0||input.ageSeconds<0||input.radius<=0)return {status:'UNCERTAIN',reasonCode:'GPS_UNCERTAIN'};
 if(input.ageSeconds>policy.maxGpsAgeSeconds)return {status:'UNCERTAIN',reasonCode:'GPS_STALE'};
 if(input.accuracy>policy.maxGpsAccuracyMeters)return {status:'UNCERTAIN',reasonCode:'GPS_INACCURATE'};
 if(input.distance-input.accuracy>input.radius)return {status:'OUTSIDE',reasonCode:'GPS_OUTSIDE'};
 if(input.distance+input.accuracy<=input.radius)return {status:'ACCEPTABLE',reasonCode:null};
 return {status:'UNCERTAIN',reasonCode:'GPS_UNCERTAIN'};
}

const attemptTransitions:Record<string,readonly string[]> = {
 RESERVED:['STORING'],STORING:['RECEIVED','RETRY_WAIT','SERVICE_FAILURE'],
 RECEIVED:['QUALITY_CHECK','REVIEW_REQUIRED'],QUALITY_CHECK:['COVERAGE_CHECK','RECAPTURE_REQUIRED','PRIVACY_HOLD','RETRY_WAIT','SERVICE_FAILURE','REVIEW_REQUIRED'],
 COVERAGE_CHECK:['CLEANLINESS_CHECK','RECAPTURE_REQUIRED','REVIEW_REQUIRED','PRIVACY_HOLD','RETRY_WAIT','SERVICE_FAILURE'],
 CLEANLINESS_CHECK:['PASSED','RECAPTURE_REQUIRED','CLEANING_REQUIRED','REVIEW_REQUIRED','PRIVACY_HOLD','RETRY_WAIT','SERVICE_FAILURE'],
 RETRY_WAIT:['STORING','QUALITY_CHECK','COVERAGE_CHECK','CLEANLINESS_CHECK','SERVICE_FAILURE'],
};
export function reduceAttempt(state:string,next:string) {
 if(state===next)return state;
 if(!attemptTransitions[state]?.includes(next))throw new Error(`Invalid attempt transition ${state} -> ${next}`);
 return next;
}
export function validateCaptureTiming(input:{issuedAt:Date;claimedCapturedAt:Date;elapsedMs:number;sessionBootId:string;captureBootId:string;receivedAt:Date}) {
 if(input.sessionBootId!==input.captureBootId||!Number.isSafeInteger(input.elapsedMs)||input.elapsedMs<0)return false;
 const anchored=+input.issuedAt+input.elapsedMs;
 return Math.abs(+input.claimedCapturedAt-anchored)<=60000&&anchored<=+input.receivedAt+60000&&+input.claimedCapturedAt>=+input.issuedAt-60000;
}
export function reduceIssue(state:string,event:'STAFF_ACTION'|'REVIEW'|'SATISFIED'|'REOPEN') {
 if(event==='REOPEN')return 'OPEN';if(event==='SATISFIED')return 'RESOLVED';
 if(state==='RESOLVED')return state;
 return event==='STAFF_ACTION'?'STAFF_ACTION_REQUIRED':'MANAGER_REVIEW';
}

Object.assign(reasonInstructions, {
 OBJECT_UNCERTAIN:'Check whether the photo shows the required object. The automatic check was uncertain.',VIEW_UNCERTAIN:'Check whether all required parts are visible. The automatic check was uncertain.',
 PHOTO_OF_SCREEN:'Review a suspected photograph of a picture displayed on another screen. This is not proof of intent.',PHOTO_ORIGIN_UNCERTAIN:'Review whether the photo directly shows the physical item.',CLEF_CALIBRATION_REQUIRED:'Cleanliness predictions need review because calibration is not configured.',
 PHOTO_TOO_DARK:'Turn on the light or torch.',PHOTO_BLURRY:'Hold still and retake.',PHOTO_TOO_SMALL:'Move closer and take a readable photo.',
 FIXTURE_POSITION_TOO_CLOSE_TO_PREVIOUS:'This looks like an item you already photographed. Move to the next item and take another photo.',
 TRACKING_LOST:'Move your phone slowly around the area so we can continue.',
 SPATIAL_CONTINUITY_BROKEN:'We could not confirm that this is a different item. Take a wider photo showing its surroundings.',
 IDENTITY_UNCERTAIN:'Show the fixture and its nearby surroundings.',PRIVACY_HOLD:'Pause photography and request a safe recapture.',
 INACCESSIBLE:'Ask your manager to review access to this fixture.',GPS_STALE:'Take a fresh location reading.',GPS_INACCURATE:'Retry location where the signal is clearer.',
 GPS_OUTSIDE:'Return to the task location before verification.',GPS_UNCERTAIN:'Retry location. A manager may need to review.',CONTEXT_UNCERTAIN:'Retake the requested empty-room context.',
 MISSING_EVIDENCE:'Photograph the remaining required views.',CLEANING_REQUIRED:'Clean the affected surface, then retake that view.',STALE_ASSIGNMENT:'Refresh your assigned task before continuing.',
 CLOCK_UNCERTAIN:'Reconnect to confirm capture timing.',SETUP_REQUIRED:'Ask your manager to review the room inventory.',CLEAN:'The required visible surfaces passed.',AUTO_PASS_NOT_VALIDATED:'Your photo is saved and waiting for manager review.',
});
