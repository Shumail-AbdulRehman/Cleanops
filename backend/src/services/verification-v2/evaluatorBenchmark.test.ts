import {describe,it,expect} from 'vitest';
import {benchmarkReport} from './evaluatorBenchmark.js';
const base={id:'a',roomId:'room',fixtureId:'fixture',fixtureType:'TOILET',split:'heldout',consented:true,visibility:'ASSESSABLE',identity:'WRONG',cleanliness:'DIRTY',predictedCleanliness:'CLEAN',wouldAutoPass:true,predictedCoverage:'MATCH',identityConsistent:true,qualityPassed:true,privacySafe:true,duplicateClear:true,provider:'test',model:'test',promptVersion:'v1',rubricVersion:1,latencyMs:5,costUsd:null};
describe('held-out reporting',()=>{
 it('reports unavailable data honestly',()=>{const r=benchmarkReport([]);expect(r.status).toBe('DATASET_UNAVAILABLE');expect(r.overall.targetMet).toBe(false);expect(r.overall.falseClean95).toBeNull();});
 it('counts independent errors',()=>{const r=benchmarkReport([base]);expect(r.overall.falseClean).toBe(1);expect(r.overall.wrongAutoPasses).toBe(1);});
 it('rejects split leakage',()=>expect(()=>benchmarkReport([base,{...base,id:'b',split:'development'}])).toThrow('leakage'));
 it('never enables credit even on target success',()=>{const r=benchmarkReport(Array.from({length:100},(_,i)=>({...base,id:String(i),predictedCleanliness:'DIRTY',wouldAutoPass:false})));expect(r.overall.targetMet).toBe(true);expect(r.autoPassEnabled).toBe(false);expect(r.overall.wrongAutoPass95?.[1]).toBeGreaterThan(0);});
});

describe('release evaluation diagnostics (synthetic reporting tests only)',()=>{
 it('reports cannot-assess, coverage failures and distinct wrong/replay passes',()=>{
  const r=benchmarkReport([base,{...base,id:'b',identity:'REPLAYED'}, {...base,id:'c',identity:'CORRECT',predictedCoverage:'MISSING_SURFACE',predictedCleanliness:'CANNOT_ASSESS',wouldAutoPass:false}]);
  expect(r.overall.wrongItemAutoPasses).toBe(1);expect(r.overall.replayedAutoPasses).toBe(1);
  expect(r.overall.cannotAssess).toBe(1);expect(r.overall.coverageFailures).toBe(1);
  expect(r.overall.coverageFailureRate).toBeCloseTo(1/3);expect(r.perFixture.TOILET).toEqual(r.overall);
 });
 it('retains old exports but cannot certify missing stage evidence',()=>{
  const {predictedCoverage,identityConsistent,qualityPassed,privacySafe,duplicateClear,...old}=base;
  const r=benchmarkReport(Array.from({length:100},(_,i)=>({...old,id:String(i),predictedCleanliness:'DIRTY',wouldAutoPass:false})));
  expect(r.overall.missingStageEvidence).toBe(100);expect(r.overall.targetMet).toBe(false);
  expect(r.overall.coverageFailureRate).toBeNull();
 });
 it('blocks inconsistent and unassessable candidate passes',()=>{
  const rows=Array.from({length:100},(_,i)=>({...base,id:String(i),predictedCleanliness:'DIRTY',wouldAutoPass:false}));
  const r=benchmarkReport([...rows,{...base,id:'bad',identity:'CORRECT',cleanliness:'CLEAN',visibility:'UNASSESSABLE',privacySafe:false}]);
  expect(r.overall.inconsistentAutoPasses).toBe(1);expect(r.overall.unassessableAutoPasses).toBe(1);expect(r.overall.targetMet).toBe(false);
 });
 it('does not let pooled data qualify a sparse fixture type',()=>{
  const rows=Array.from({length:100},(_,i)=>({...base,id:String(i),predictedCleanliness:'DIRTY',wouldAutoPass:false}));
  const r=benchmarkReport([...rows,{...rows[0],id:'sink',fixtureType:'SINK'}]);
  expect(r.overall.targetMet).toBe(true);expect(r.perFixture.SINK.targetMet).toBe(false);
 });
 it('excludes development data and rejects duplicate IDs and mixed configurations',()=>{
  expect(benchmarkReport([{...base,split:'development'}]).overall.examples).toBe(0);
  expect(()=>benchmarkReport([base,base])).toThrow('Duplicate');
  expect(()=>benchmarkReport([base,{...base,id:'b',model:'different'}])).toThrow('configuration');
 });
 it('requires consent and preserves unknown cost',()=>{
  expect(()=>benchmarkReport([{...base,consented:false}])).toThrow();
  expect(benchmarkReport([base]).measuredCostUsd).toBeNull();
 });
});

it('enforces the exact DIRTY threshold and zero wrong/replayed passes',()=>{
 const rows=Array.from({length:100},(_,i)=>({...base,id:String(i),predictedCleanliness:i<2?'CLEAN':'DIRTY',wouldAutoPass:false}));
 expect(benchmarkReport(rows).overall.targetMet).toBe(true);
 expect(benchmarkReport(rows.map((r,i)=>i===2?{...r,predictedCleanliness:'CLEAN'}:r)).overall.targetMet).toBe(false);
 expect(benchmarkReport(rows.map((r,i)=>i===0?{...r,wouldAutoPass:true}:r)).overall.targetMet).toBe(false);
 expect(benchmarkReport(rows.slice(0,99)).overall.targetMet).toBe(false);
});

it('reports Clef clean/dirty accuracy and confidence separately from wrong/replayed identity',()=>{
 const base={roomId:'r',fixtureId:'f',fixtureType:'INDIAN_TOILET',split:'heldout',consented:true,visibility:'ASSESSABLE',identity:'CORRECT',wouldAutoPass:false,provider:'cloudflare',model:'clef',promptVersion:'clef-surfaces-v1',rubricVersion:1,latencyMs:1,costUsd:null,confidence:.98};
 const report=benchmarkReport([
  {...base,id:'1',cleanliness:'CLEAN',predictedCleanliness:'CLEAN'},
  {...base,id:'2',cleanliness:'CLEAN',predictedCleanliness:'DIRTY'},
  {...base,id:'3',cleanliness:'DIRTY',predictedCleanliness:'CLEAN'},
  {...base,id:'4',cleanliness:'DIRTY',predictedCleanliness:'DIRTY'},
  {...base,id:'5',cleanliness:'DIRTY',predictedCleanliness:'CANNOT_ASSESS',confidence:.5},
  {...base,id:'6',cleanliness:'DIRTY',predictedCleanliness:'CLEAN',identity:'REPLAYED'}
 ]);
 expect(report.cleanliness).toMatchObject({totalClean:2,totalDirty:3,correctClean:1,correctDirty:1,falseCleanOnDirty:1,falseCleanRate:1/3,falseDirtyOnClean:1,cannotAssess:1,excludedWrongOrReplayed:1,confidenceDistribution:{count:5,min:.5,max:.98}});
 expect(report.integrity.examples).toBe(1);expect(report.autoPassEnabled).toBe(false);
 expect(report.cleanlinessPerFixture.INDIAN_TOILET?.totalDirty).toBe(3);
});
