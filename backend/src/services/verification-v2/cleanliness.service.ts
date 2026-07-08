import {z} from 'zod';
import {cleanlinessReleaseStatus} from './cleanlinessRelease.js';
import {photoChecksOwnerOverride} from './photoChecksOverride.js';
import {requiredRubricSurfaces} from './rubrics.js';
import type {ImageAssessmentProvider,Assessment} from './provider.service.js';
// Historical NEEDS_ATTENTION means localized visible dirt; new results use DIRTY.
const verdict=z.preprocess(v=>v==='NEEDS_ATTENTION'?'DIRTY':v,z.enum(['CLEAN','DIRTY','CANNOT_ASSESS']));
export const cleanlinessResultSchema=z.object({verdict,surfaces:z.array(z.object({surface:z.string().min(1).max(100),verdict}).strict()).min(1).max(20),confidence:z.number().finite().min(0).max(1).nullable().default(null),reasonCode:z.enum(['CLEAN','CLEANING_REQUIRED','CANNOT_ASSESS']),details:z.object({predictions:z.array(z.object({surface:z.string(),type:z.literal('choice'),choice:z.enum(['CLEAN','DIRTY','CANNOT_ASSESS']),confidence:z.number().min(0).max(1),probabilities:z.object({CLEAN:z.number(),DIRTY:z.number(),CANNOT_ASSESS:z.number()}).strict()}).strict()),threshold:z.number().min(0).max(1).nullable(),thresholdVersion:z.string(),assessmentStatus:z.enum(['INVALID_RESPONSE','THRESHOLD_UNCONFIGURED','ASSESSED'])}).strict().optional()}).strict();
export type CleanlinessResult=z.infer<typeof cleanlinessResultSchema>;
export interface CleanlinessProvider{evaluate(image:Buffer,rubric:unknown,view:string,fixtureType?:string):Promise<Assessment<CleanlinessResult>>;}
export function validateCleanlinessResult(raw:unknown,requiredSurfaces:string[]){
 const result=cleanlinessResultSchema.parse(raw);
 if(new Set(result.surfaces.map(s=>s.surface)).size!==result.surfaces.length||result.surfaces.length!==requiredSurfaces.length||requiredSurfaces.some(s=>!result.surfaces.some(v=>v.surface===s)))throw new Error('Missing, extra or repeated required surface');
 const values=result.surfaces.map(s=>s.verdict);
 const aggregate=values.includes('CANNOT_ASSESS')?'CANNOT_ASSESS':values.includes('DIRTY')?'DIRTY':'CLEAN';
 const reason=aggregate==='CLEAN'?'CLEAN':aggregate==='CANNOT_ASSESS'?'CANNOT_ASSESS':'CLEANING_REQUIRED';
 if(result.verdict!==aggregate||result.reasonCode!==reason)throw new Error('Contradictory aggregate verdict');
 return result;
}
export async function assessCleanliness(provider:ImageAssessmentProvider,image:Buffer,rubric:unknown,view:string){
 const surfaces=requiredRubricSurfaces(rubric,view);
 const assessment=await provider.assess('cleanliness',`Assess visible cleanliness only after controlled capture, privacy and coverage passed. Never use a reference image or similarity score. Hidden/unreadable required surface must be CANNOT_ASSESS, not DIRTY. Snapshot rubric: ${JSON.stringify(rubric)}. Required view: ${view}. Assess exactly these surfaces individually: ${JSON.stringify(surfaces)}. JSON: verdict CLEAN/DIRTY/CANNOT_ASSESS, surfaces [{surface,verdict}], reasonCode CLEAN/CLEANING_REQUIRED/CANNOT_ASSESS. Aggregate prioritizes CANNOT_ASSESS, then DIRTY, then CLEAN.`,[image],cleanlinessResultSchema);
 return {...assessment,result:validateCleanlinessResult(assessment.result,surfaces),rubricVersion:(rubric as {version:number}).version};
}
/** Exact evaluated configuration and fixture/rubric qualification are required. */
export function autoPassAllowed(fixtureType:string,rubricVersion=1){return photoChecksOwnerOverride()||cleanlinessReleaseStatus(fixtureType,rubricVersion).allowed;}
