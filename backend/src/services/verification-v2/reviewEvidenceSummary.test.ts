import {expect,it} from 'vitest';
import {reviewEvidenceSummary} from './reviewEvidenceSummary.js';
it('exposes stored surface findings without model scores or raw provider metadata',()=>{
 const result=reviewEvidenceSummary({policyDecisionReason:'CLEANING_REQUIRED',result:{verdict:'DIRTY',surfaces:[{surface:'pan',verdict:'DIRTY'},{surface:'floor',verdict:'CLEAN'},{surface:'pan',verdict:'DIRTY'}],confidence:.5},metadata:{secret:'internal',screeningAnswers:{raw:'payload'}}});
 expect(result).toEqual({reasonCode:'CLEANING_REQUIRED',cleanliness:'DIRTY',dirtySurfaces:['pan'],missingSurfaces:[]});
 expect(JSON.stringify(result)).not.toMatch(/confidence|metadata|secret|screeningAnswers/);
});
it('keeps a clean model finding separate from the approval gate and identifies missing parts',()=>{
 expect(reviewEvidenceSummary({policyDecisionReason:'AUTO_PASS_NOT_VALIDATED',result:{verdict:'CLEAN'},photoContext:{missingSurfaces:['tap']}})).toMatchObject({reasonCode:'AUTO_PASS_NOT_VALIDATED',cleanliness:'CLEAN',missingSurfaces:['tap']});
});
it('handles historical localized-dirt verdicts and malformed records without inventing findings',()=>{
 expect(reviewEvidenceSummary({verdict:'NEEDS_ATTENTION',surfaces:[{surface:'seat',verdict:'NEEDS_ATTENTION'}]})).toMatchObject({cleanliness:'DIRTY',dirtySurfaces:['seat']});
 for(const raw of [null,[],{result:{verdict:'OTHER',surfaces:'invalid'},policyDecisionReason:'unknown-internal-value'}])
  expect(reviewEvidenceSummary(raw)).toEqual({reasonCode:null,cleanliness:null,dirtySurfaces:[],missingSurfaces:[]});
});
