import { bufferedEvaluatorVersion } from "./bufferedPhoto.provider.js";
import {photoEvaluatorVersion} from './clefPhoto.provider.js';
import {createHash} from 'node:crypto';
import {readFileSync,statSync} from 'node:fs';
import {z} from 'zod';
import {benchmarkRowsSchema,benchmarkReport} from './evaluatorBenchmark.js';
import {cleanlinessResultSchema} from './cleanliness.service.js';
import {clefConfiguration,clefEvaluatorVersion} from './clefConfiguration.js';
import {clefScreeningConfiguration,clefScreeningEvaluatorVersion} from './provider.service.js';

const sha=z.string().regex(/^[a-f0-9]{64}$/);
const version=z.string().regex(/^[a-zA-Z0-9._-]{1,60}$/);
export function verificationReleaseConfiguration(){
 const screening=clefScreeningConfiguration();
 return {version:'verification-v2-clef-release-5',processingMode:'DIRECT_REQUEST_V1',photoVersion:bufferedEvaluatorVersion(),privacyAssessment:false,fixtureIdentityAssessment:false,originalityVersion:'clef-photo-v1',qualityVersion:'quality-v1',privacyVersion:clefScreeningEvaluatorVersion('PRIVACY'),coverageVersion:clefScreeningEvaluatorVersion('COVERAGE'),duplicateVersion:'duplicate-v1',privacyCoverageProvider:'cloudflare',privacyCoverageModel:screening.model,screeningThreshold:screening.threshold,spatialAutomaticAcceptance:false};
}
const configurationSchema=z.object({provider:z.literal('cloudflare'),model:z.enum(['clef','clef-flash']),promptVersion:z.literal('clef-surfaces-v1'),providerVersion:z.literal('cloudflare-system-one-v1')}).strict();
export const calibrationSchema=z.object({schemaVersion:z.literal(1),createdAt:z.iso.datetime(),developmentSha256:sha,pipelineConfigurationSha256:sha,configuration:configurationSchema,threshold:z.number().finite().min(0).max(1),thresholdVersion:version,fixtureTypes:z.array(z.string().min(1)).min(1),developmentRooms:z.array(z.string()),developmentFixtures:z.array(z.string()),developmentImages:z.array(sha),metrics:z.record(z.string(),z.object({dirty:z.number().int(),clean:z.number().int(),uncertain:z.number().int(),falseClean:z.number().int(),correctClean:z.number().int()}).strict())}).strict();
export const reviewSchema=z.object({labelledBy:z.string().trim().min(1),evaluatedBy:z.string().trim().min(1),reviewedBy:z.string().trim().min(1),reviewedAt:z.iso.datetime(),expiresAt:z.iso.datetime(),labelsManifestSha256:sha,independentHumanLabels:z.literal(true),consentVerified:z.literal(true),representativeRoomsVerified:z.literal(true)}).strict();
const releaseSchema=z.object({schemaVersion:z.literal(1),calibration:calibrationSchema,review:reviewSchema,heldoutSha256:sha,rows:benchmarkRowsSchema,eligibleFixtureTypes:z.array(z.string())}).strict();
type Row=z.infer<typeof benchmarkRowsSchema>[number];
export const digest=(value:Buffer|string)=>createHash('sha256').update(value).digest('hex');
function configurationOf(r:Row){return {provider:r.provider,model:r.model.replace(/^@cf\/cloudflare\//,''),promptVersion:r.promptVersion,providerVersion:r.providerVersion};}
function same(a:unknown,b:unknown){return JSON.stringify(a)===JSON.stringify(b);}
function predictionAt(r:Row,threshold:number){
 if(r.predictedCleanliness==='SERVICE_FAILURE')return 'SERVICE_FAILURE';
 const assessment=r.assessment as {result?:unknown}|undefined;
 const result=cleanlinessResultSchema.parse(assessment?.result),details=result.details;
 if(!details||details.assessmentStatus==='INVALID_RESPONSE'||details.predictions.length!==result.surfaces.length||new Set(details.predictions.map(p=>p.surface)).size!==result.surfaces.length||details.predictions.some(p=>!result.surfaces.some(s=>s.surface===p.surface)))throw new Error('Missing or invalid measured Clef surface predictions');
 const verdicts=details.predictions.map(p=>{
  const values=Object.values(p.probabilities).sort((a,b)=>b-a);
  if(values.some(v=>!Number.isFinite(v)||v<0||v>1)||Math.abs(values.reduce((n,v)=>n+v,0)-1)>.0001||p.probabilities[p.choice]!==values[0])throw new Error('Contradictory Clef probabilities');
  return p.confidence<threshold||values[0]===values[1]?'CANNOT_ASSESS':p.choice;
 });
 return verdicts.includes('CANNOT_ASSESS')?'CANNOT_ASSESS':verdicts.includes('DIRTY')?'DIRTY':'CLEAN';
}
/** Chooses a candidate on development rooms only; never uses held-out labels. */
export function calibrateCleanliness(input:unknown,developmentSha256:string,thresholdVersion:string,now=new Date()){
 const rows=benchmarkRowsSchema.parse(input);
 benchmarkReport(rows); // IDs and split leakage must be checked before filtering.
 const development=rows.filter(r=>r.split==='development'&&r.identity==='CORRECT');
 if(!development.length)throw new Error('Real development labels and predictions are required');
 const configuration=configurationSchema.parse(configurationOf(development[0]!));
 if(development.some(r=>!same(configurationOf(r),configuration)||!r.imageSha256||!r.evaluationInputHash))throw new Error('Mixed configuration or missing image/label provenance');
 const types=[...new Set(development.map(r=>r.fixtureType))].sort();
 // Include every measured confidence boundary, without tuning on held-out examples.
 const candidates=[...new Set([0,1,...development.flatMap(r=>(r.assessment as {result?:{details?:{predictions?:{confidence:number}[]}}})?.result?.details?.predictions?.map(p=>p.confidence)??[])])].sort((a,b)=>a-b);
 let best:{threshold:number;metrics:Record<string,{dirty:number;clean:number;uncertain:number;falseClean:number;correctClean:number}>;correct:number}|undefined;
 for(const threshold of candidates){
  const metrics:NonNullable<typeof best>['metrics']={};let valid=true,correct=0;
  for(const type of types){
   const group=development.filter(r=>r.fixtureType===type),dirty=group.filter(r=>['DIRTY','NEEDS_ATTENTION'].includes(r.cleanliness)),clean=group.filter(r=>r.cleanliness==='CLEAN'&&r.visibility==='ASSESSABLE'),uncertain=group.filter(r=>r.cleanliness==='CANNOT_ASSESS'||r.visibility==='UNASSESSABLE');
   const falseClean=dirty.filter(r=>predictionAt(r,threshold)==='CLEAN').length,correctClean=clean.filter(r=>predictionAt(r,threshold)==='CLEAN').length;
   if(dirty.length<100||clean.length<20||uncertain.length<20||falseClean/dirty.length>.02||uncertain.some(r=>predictionAt(r,threshold)==='CLEAN')||correctClean<20)valid=false;
   metrics[type]={dirty:dirty.length,clean:clean.length,uncertain:uncertain.length,falseClean,correctClean};correct+=correctClean;
  }
  if(valid&&(!best||correct>best.correct))best={threshold,metrics,correct};
 }
 if(!best)throw new Error('Development data cannot establish a safe useful threshold; collect labels or keep review-only');
 return calibrationSchema.parse({schemaVersion:1,createdAt:now.toISOString(),developmentSha256,pipelineConfigurationSha256:digest(JSON.stringify(verificationReleaseConfiguration())),configuration,threshold:best.threshold,thresholdVersion,fixtureTypes:types,developmentRooms:[...new Set(rows.filter(r=>r.split==='development').map(r=>r.roomId))],developmentFixtures:[...new Set(rows.filter(r=>r.split==='development').map(r=>r.fixtureId))],developmentImages:[...new Set(rows.filter(r=>r.split==='development').map(r=>r.imageSha256).filter(Boolean))],metrics:best.metrics});
}
function validateRelease(raw:unknown,now:Date){
 const record=releaseSchema.parse(raw),{calibration:c,review,rows}=record;
 if(Date.parse(review.reviewedAt)<Date.parse(c.createdAt)||Date.parse(review.reviewedAt)>now.getTime()||Date.parse(review.expiresAt)<=now.getTime()||Date.parse(review.expiresAt)-Date.parse(review.reviewedAt)>90*86400000)throw new Error('Expired or invalid independent review');
 if(!rows.length||rows.some(r=>r.split!=='heldout'||c.developmentRooms.includes(r.roomId)||c.developmentFixtures.includes(r.fixtureId)||!r.imageSha256||c.developmentImages.includes(r.imageSha256)||!r.evaluationInputHash))throw new Error('Held-out provenance or split separation missing');
 if(new Set(rows.map(r=>r.imageSha256)).size!==rows.length)throw new Error('Repeated evaluation image');
 if(rows.some(r=>!same(configurationOf(r),c.configuration)||r.threshold!==c.threshold||r.thresholdVersion!==c.thresholdVersion))throw new Error('Held-out configuration differs from frozen calibration');
 const normalized=rows.map(r=>{
  const prediction=predictionAt(r,c.threshold);
  if(prediction!==r.predictedCleanliness)throw new Error('Prediction differs from measured Clef assessment');
  const wouldAutoPass=prediction==='CLEAN'&&r.predictedCoverage==='MATCH'&&r.identityConsistent===true&&r.qualityPassed===true&&r.privacySafe===true&&r.duplicateClear===true;
  if(wouldAutoPass!==r.wouldAutoPass)throw new Error('Candidate policy was not evaluated faithfully');
  return {...r,cleanliness:r.cleanliness==='NEEDS_ATTENTION'?'DIRTY' as const:r.cleanliness};
 });
 const report=benchmarkReport(normalized);
 const eligible=Object.keys(report.perFixture).filter(type=>{
  const group=normalized.filter(r=>r.fixtureType===type);
  return c.fixtureTypes.includes(type)&&report.perFixture[type]!.targetMet&&report.cleanlinessPerFixture[type]!.targetMet&&group.filter(r=>r.identity==='CORRECT'&&r.cleanliness==='CLEAN'&&r.wouldAutoPass).length>=20&&group.filter(r=>r.cleanliness==='CANNOT_ASSESS'||r.visibility==='UNASSESSABLE').length>=20;
 }).sort();
 if(!eligible.length||!same(eligible,[...record.eligibleFixtureTypes].sort()))throw new Error('No qualifying fixture types or forged eligibility');
 return {record,eligible,report};
}
/** Only a reviewed, complete, measured pipeline export can produce a release record. */
export function createCleanlinessRelease(input:unknown,calibration:unknown,review:unknown,heldoutSha256:string,now=new Date()){
 const c=calibrationSchema.parse(calibration),rows=benchmarkRowsSchema.parse(input).filter(r=>r.split==='heldout').map(r=>({...r,wouldAutoPass:r.predictedCleanliness==='CLEAN'&&r.predictedCoverage==='MATCH'&&r.identityConsistent===true&&r.qualityPassed===true&&r.privacySafe===true&&r.duplicateClear===true}));
 const normalized=rows.map(r=>({...r,cleanliness:r.cleanliness==='NEEDS_ATTENTION'?'DIRTY' as const:r.cleanliness}));
 const report=benchmarkReport(normalized);
 const eligibleFixtureTypes=Object.keys(report.perFixture).filter(type=>c.fixtureTypes.includes(type)&&report.perFixture[type]!.targetMet&&report.cleanlinessPerFixture[type]!.targetMet&&normalized.filter(r=>r.fixtureType===type&&r.identity==='CORRECT'&&r.cleanliness==='CLEAN'&&r.wouldAutoPass).length>=20&&normalized.filter(r=>r.fixtureType===type&&(r.cleanliness==='CANNOT_ASSESS'||r.visibility==='UNASSESSABLE')).length>=20).sort();
 const record={schemaVersion:1 as const,calibration:c,review:reviewSchema.parse(review),heldoutSha256,rows,eligibleFixtureTypes};
 validateRelease(record,now);return record;
}
let cached:{key:string;until:number;validated:ReturnType<typeof validateRelease>}|undefined;
/** Server-owned checksum pin, exact live evaluator/rubric match, fail closed. No boolean bypass. */
export function cleanlinessReleaseStatus(fixtureType:string,rubricVersion=1,now=new Date()){
 try{
  const path=process.env.CLEF_RELEASE_RECORD_PATH,pin=process.env.CLEF_RELEASE_RECORD_SHA256;
  if(!path||!pin)return {allowed:false,reason:'RELEASE_NOT_CONFIGURED'};
  sha.parse(pin);const file=statSync(path);
  if(file.size>16*1024*1024)throw new Error('Release file too large');
  const key=[path,pin,file.size,file.mtimeMs,file.ctimeMs].join(':');
  if(!cached||cached.key!==key||cached.until<=now.getTime()){
   const bytes=readFileSync(path);if(digest(bytes)!==pin)throw new Error('Release checksum mismatch');
   cached={key,until:now.getTime()+5000,validated:validateRelease(JSON.parse(bytes.toString('utf8')),now)};
  }
  const {record,eligible}=cached.validated,c=clefConfiguration();
  if(Date.parse(record.review.expiresAt)<=now.getTime())return {allowed:false,reason:'RELEASE_EXPIRED'};
  if(record.calibration.pipelineConfigurationSha256!==digest(JSON.stringify(verificationReleaseConfiguration()))||!same(record.calibration.configuration,{provider:'cloudflare',model:c.model,promptVersion:c.promptVersion,providerVersion:c.providerVersion})||record.calibration.threshold!==c.threshold||record.calibration.thresholdVersion!==c.thresholdVersion||record.rows.some(r=>r.evaluatorVersion!==clefEvaluatorVersion()||r.rubricVersion!==rubricVersion))return {allowed:false,reason:'CONFIGURATION_CHANGED'};
  return {allowed:eligible.includes(fixtureType),reason:eligible.includes(fixtureType)?'VALIDATED_RELEASE':'FIXTURE_NOT_VALIDATED'};
 }catch{return {allowed:false,reason:'RELEASE_INVALID'};}
}
