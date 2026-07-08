import {z} from 'zod';
const rowSchema=z.object({device:z.string().min(1).max(150),os:z.string().min(1).max(150),scenario:z.string().min(1).max(150),groundTruth:z.enum(['SAME','DIFFERENT','UNKNOWN']),spatialResult:z.enum(['DISTINCT','SAME_POSITION_SUSPECTED','UNCERTAIN','UNAVAILABLE']),tracking:z.enum(['GOOD','DEGRADED','LOST','UNAVAILABLE']),coverage:z.enum(['MATCH','WRONG_ITEM','MISSING_SURFACE','UNCERTAIN']).nullable(),duplicate:z.enum(['EXACT','NEAR','NONE']).nullable()}).strict();
export const spatialEvaluationRows=z.array(rowSchema).max(100000);
export function spatialEvaluation(raw:unknown){
 const rows=spatialEvaluationRows.parse(raw);
 function metrics(group:typeof rows){
  const same=group.filter(r=>r.groundTruth==='SAME'),different=group.filter(r=>r.groundTruth==='DIFFERENT');
  const ratio=(n:number,d:number)=>d?n/d:null;
  return {count:group.length,sameCount:same.length,differentCount:different.length,
   sameFixtureDetectionRate:ratio(same.filter(r=>r.spatialResult==='SAME_POSITION_SUSPECTED').length,same.length),
   falseSameFixtureRate:ratio(different.filter(r=>r.spatialResult==='SAME_POSITION_SUSPECTED').length,different.length),
   trackingFailureRate:ratio(group.filter(r=>['LOST','UNAVAILABLE'].includes(r.tracking)).length,group.length),
   spatialUncertaintyRate:ratio(group.filter(r=>['UNCERTAIN','UNAVAILABLE'].includes(r.spatialResult)).length,group.length)};
 }
 return {version:1,status:rows.length?'RECORDED_EVALUATION':'DATASET_UNAVAILABLE',autoIdentityAcceptance:false,overall:metrics(rows),byDeviceOS:Object.fromEntries([...new Set(rows.map(r=>`${r.device} / ${r.os}`))].map(key=>[key,metrics(rows.filter(r=>`${r.device} / ${r.os}`===key))]))};
}
