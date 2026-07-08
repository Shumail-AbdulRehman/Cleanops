import {z} from 'zod';

export const benchmarkRowsSchema=z.array(z.object({
 id:z.string().min(1),roomId:z.string().min(1),fixtureId:z.string().min(1),fixtureType:z.string().min(1),
 split:z.enum(['development','heldout']),consented:z.literal(true),
 visibility:z.enum(['ASSESSABLE','UNASSESSABLE']),identity:z.enum(['CORRECT','WRONG','REPLAYED']),
 cleanliness:z.enum(['CLEAN','NEEDS_ATTENTION','DIRTY','CANNOT_ASSESS']),
 confidence:z.number().min(0).max(1).nullable().optional(),
 threshold:z.number().min(0).max(1).nullable().optional(),thresholdVersion:z.string().optional(),providerVersion:z.string().optional(),evaluatorVersion:z.string().optional(),imageSha256:z.string().optional(),evaluationInputHash:z.string().optional(),assessment:z.unknown().optional(),
 predictedCleanliness:z.enum(['CLEAN','NEEDS_ATTENTION','DIRTY','CANNOT_ASSESS','SERVICE_FAILURE']),
 // Optional for old exports. Missing stage evidence cannot establish the release target.
 predictedCoverage:z.enum(['MATCH','WRONG_ITEM','MISSING_SURFACE','UNCERTAIN','SERVICE_FAILURE']).optional(),
 identityConsistent:z.boolean().optional(),qualityPassed:z.boolean().optional(),
 privacySafe:z.boolean().optional(),duplicateClear:z.boolean().optional(),
 wouldAutoPass:z.boolean(),provider:z.string().min(1),model:z.string().min(1),
 requestedModel:z.string().min(1).optional(),promptVersion:z.string().min(1),rubricVersion:z.number().int().positive(),
 latencyMs:z.number().nonnegative(),costUsd:z.number().nonnegative().nullable()
}).strict());
type Row=z.infer<typeof benchmarkRowsSchema>[number];
function interval(errors:number,n:number){if(!n)return null;const z=1.96,p=errors/n,d=1+z*z/n,c=(p+z*z/(2*n))/d,h=z*Math.sqrt(p*(1-p)/n+z*z/(4*n*n))/d;return [Math.max(0,c-h),Math.min(1,c+h)];}
function rate(numerator:number,denominator:number){return denominator?numerator/denominator:null;}
function stageEvidencePresent(r:Row){return [r.predictedCoverage,r.identityConsistent,r.qualityPassed,r.privacySafe,r.duplicateClear].every(v=>v!==undefined);}
function unsafePass(r:Row){return r.wouldAutoPass&&(r.predictedCleanliness!=='CLEAN'||r.predictedCoverage!=='MATCH'||r.identityConsistent!==true||r.qualityPassed!==true||r.privacySafe!==true||r.duplicateClear!==true);}
function metrics(rows:Row[]){
 const dirty=rows.filter(r=>r.cleanliness==='DIRTY'),wrong=rows.filter(r=>r.identity!=='CORRECT');
 const falseClean=dirty.filter(r=>r.predictedCleanliness==='CLEAN').length,wrongPass=wrong.filter(r=>r.wouldAutoPass).length;
 const cannotAssess=rows.filter(r=>r.predictedCleanliness==='CANNOT_ASSESS').length;
 const coverageRows=rows.filter(r=>r.predictedCoverage!==undefined),coverageFailures=coverageRows.filter(r=>r.predictedCoverage!=='MATCH'||r.identityConsistent===false).length;
 const missingStageEvidence=rows.filter(r=>!stageEvidencePresent(r)).length,inconsistentAutoPasses=rows.filter(unsafePass).length;
 return {
  examples:rows.length,dirty:dirty.length,wrongOrReplayed:wrong.length,falseClean,
  falseCleanRate:rate(falseClean,dirty.length),dirtyAutoPasses:dirty.filter(r=>r.wouldAutoPass).length,
  wrongAutoPasses:wrongPass,wrongAutoPassRate:rate(wrongPass,wrong.length),
  wrongItemAutoPasses:rows.filter(r=>r.identity==='WRONG'&&r.wouldAutoPass).length,
  replayedAutoPasses:rows.filter(r=>r.identity==='REPLAYED'&&r.wouldAutoPass).length,
  falseClean95:interval(falseClean,dirty.length),wrongAutoPass95:interval(wrongPass,wrong.length),
  cannotAssess,cannotAssessRate:rate(cannotAssess,rows.length),
  humanCannotAssess:rows.filter(r=>r.cleanliness==='CANNOT_ASSESS').length,
  unassessableAutoPasses:rows.filter(r=>(r.visibility==='UNASSESSABLE'||r.cleanliness==='CANNOT_ASSESS')&&r.wouldAutoPass).length,
  coverageEvaluated:coverageRows.length,coverageFailures,coverageFailureRate:rate(coverageFailures,coverageRows.length),
  coverageVerdicts:Object.fromEntries(['MATCH','WRONG_ITEM','MISSING_SURFACE','UNCERTAIN','SERVICE_FAILURE'].map(v=>[v,coverageRows.filter(r=>r.predictedCoverage===v).length])),
  wrongOrReplayedCoverageMatches:wrong.filter(r=>r.predictedCoverage==='MATCH'&&r.identityConsistent===true).length,
  serviceFailures:rows.filter(r=>r.predictedCleanliness==='SERVICE_FAILURE').length,
  meanLatencyMs:rows.length?rows.reduce((n,r)=>n+r.latencyMs,0)/rows.length:null,
  measuredCostUsd:rows.length&&rows.every(r=>r.costUsd!==null)?rows.reduce((n,r)=>n+r.costUsd!,0):null,
  missingStageEvidence,inconsistentAutoPasses,
  targetMet:dirty.length>=100&&wrong.length>=100&&falseClean/dirty.length<=.02&&wrongPass===0&&missingStageEvidence===0&&inconsistentAutoPasses===0&&rows.every(r=>!r.wouldAutoPass||(r.visibility==='ASSESSABLE'&&r.cleanliness!=='CANNOT_ASSESS'))
 };
}
/** Offline evidence report; never changes deployment eligibility. */
export function benchmarkReport(input:unknown){
 const rows=benchmarkRowsSchema.parse(input),ids=new Set<string>(),rooms=new Map<string,string>(),fixtures=new Map<string,string>();
 for(const r of rows){if(ids.has(r.id))throw new Error('Duplicate example ID');ids.add(r.id);for(const [map,key] of [[rooms,r.roomId],[fixtures,r.fixtureId]] as const){if(map.has(key)&&map.get(key)!==r.split)throw new Error('Room/fixture split leakage');map.set(key,r.split);}}
 const heldout=rows.filter(r=>r.split==='heldout'),configurations=new Set(heldout.map(r=>JSON.stringify([r.provider,r.model,r.requestedModel??null,r.promptVersion,r.rubricVersion,r.providerVersion??null,r.threshold??null,r.thresholdVersion??null,r.evaluatorVersion??null])));
 if(configurations.size>1)throw new Error('Evaluate one configuration per report');
 const types=[...new Set(heldout.map(r=>r.fixtureType))].sort();
 return {status:heldout.length?'MEASURED':'DATASET_UNAVAILABLE',autoPassEnabled:false,configuration:configurations.size?[...configurations][0]:null,cleanliness:cleanlinessMetrics(heldout),cleanlinessPerFixture:Object.fromEntries(types.map(t=>[t,cleanlinessMetrics(heldout.filter(r=>r.fixtureType===t))])),integrity:{examples:heldout.filter(r=>r.identity!=='CORRECT').length,wrongOrReplayedAutoPasses:heldout.filter(r=>r.identity!=='CORRECT'&&r.wouldAutoPass).length},overall:metrics(heldout),perFixture:Object.fromEntries(types.map(t=>[t,metrics(heldout.filter(r=>r.fixtureType===t))])),meanLatencyMs:heldout.length?heldout.reduce((n,r)=>n+r.latencyMs,0)/heldout.length:null,measuredCostUsd:heldout.length&&heldout.every(r=>r.costUsd!==null)?heldout.reduce((n,r)=>n+r.costUsd!,0):null,limitations:['Independent human labels and consent are required; predictions are supplied, not generated by this reporter.','95% Wilson intervals express sampling uncertainty.','Missing stage evidence or inconsistent candidate passes block targets.','Meeting targets does not enable auto-pass; sparse types remain review-required.']};
}

/** Identity failures have their own population; never count them as cleanliness accuracy. */
function cleanlinessMetrics(input:Row[]){
 const rows=input.filter(r=>r.identity==='CORRECT'),clean=rows.filter(r=>r.cleanliness==='CLEAN'),dirty=rows.filter(r=>r.cleanliness==='DIRTY');
 const confidences=rows.flatMap(r=>r.confidence==null?[]:[r.confidence]).sort((a,b)=>a-b);
 const falseClean=dirty.filter(r=>r.predictedCleanliness==='CLEAN').length;
 return {examples:rows.length,excludedWrongOrReplayed:input.length-rows.length,totalClean:clean.length,totalDirty:dirty.length,
 correctClean:clean.filter(r=>r.predictedCleanliness==='CLEAN').length,correctDirty:dirty.filter(r=>r.predictedCleanliness==='DIRTY').length,
 falseCleanOnDirty:falseClean,falseCleanRate:rate(falseClean,dirty.length),falseClean95:interval(falseClean,dirty.length),
 falseDirtyOnClean:clean.filter(r=>r.predictedCleanliness==='DIRTY').length,
 cannotAssess:rows.filter(r=>r.predictedCleanliness==='CANNOT_ASSESS').length,serviceFailures:rows.filter(r=>r.predictedCleanliness==='SERVICE_FAILURE').length,
 humanUncertain:rows.filter(r=>r.cleanliness==='CANNOT_ASSESS'||r.visibility==='UNASSESSABLE').length,
 confidenceDistribution:{count:confidences.length,missing:rows.length-confidences.length,min:confidences[0]??null,max:confidences.at(-1)??null,mean:confidences.length?confidences.reduce((a,b)=>a+b,0)/confidences.length:null,values:confidences},
 targetMet:dirty.length>=100&&falseClean/dirty.length<=.02};
}
