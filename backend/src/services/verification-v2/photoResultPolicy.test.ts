import {expect,it} from 'vitest';
import {bufferedDecision} from './photoResultPolicy.js';
import type {BufferedAssessment} from './bufferedPhoto.provider.js';

const base:BufferedAssessment={originality:'DIRECT',objectMatch:'MATCH',viewMatch:'MATCH',cleanliness:{verdict:'CLEAN',surfaces:[{surface:'bowl',verdict:'CLEAN'}],confidence:.99,reasonCode:'CLEAN'},metadata:{} as any};
it('keeps wrong-object correction even when the unrelated photo is also a screen picture',()=>{
 expect(bufferedDecision({...base,objectMatch:'WRONG_ITEM',originality:'SCREEN_RECAPTURE'},false)).toEqual({state:'RECAPTURE_REQUIRED',reason:'WRONG_ITEM',keep:false});
});

it('requests a retake and discards a photo of a screen', () => {
 expect(bufferedDecision({...base, originality:'SCREEN_RECAPTURE'}, false)).toEqual({state:'RECAPTURE_REQUIRED', reason:'PHOTO_OF_SCREEN', keep:false});
});

it.each(['WRONG_ITEM','MISSING_SURFACE'] as const)('a confirmed %s cannot be passed or sent to review even with clean surfaces',objectMatch=>{
 expect(bufferedDecision({...base,objectMatch,originality:'UNCERTAIN'},false)).toEqual({state:'RECAPTURE_REQUIRED',reason:objectMatch,keep:false});
});
it('a missing object result cannot bypass the gate for required fixture photos',()=>{
 expect(bufferedDecision({...base,objectMatch:null,cleanliness:null},false,true)).toMatchObject({state:'REVIEW_REQUIRED',reason:'OBJECT_UNCERTAIN',keep:true});
});
it('an unrelated object cannot be classified as a cleaning failure',()=>{
 expect(bufferedDecision({...base,objectMatch:'WRONG_ITEM',cleanliness:{...base.cleanliness!,verdict:'DIRTY',surfaces:[{surface:'bowl',verdict:'DIRTY'}],reasonCode:'CLEANING_REQUIRED'}},true)).toMatchObject({state:'RECAPTURE_REQUIRED',reason:'WRONG_ITEM'});
});
it('matched objects retain the existing cleanliness and review policies',()=>{
 expect(bufferedDecision(base,true).state).toBe('PASSED');
 expect(bufferedDecision(base,false).state).toBe('REVIEW_REQUIRED');
});
it('room context photos do not acquire a fixture-object requirement',()=>{
 expect(bufferedDecision({...base,objectMatch:null,cleanliness:null},true,false).state).toBe('PASSED');
});

it.each([
 [{objectMatch:'UNCERTAIN'},'OBJECT_UNCERTAIN'],
 [{viewMatch:'UNCERTAIN'},'VIEW_UNCERTAIN'],
 [{viewMatch:null},'VIEW_UNCERTAIN'],
] as const)('uncertainty %j goes to review without passing or demanding a retake',(change,reason)=>{
 expect(bufferedDecision({...base,...change},true,true)).toEqual({state:'REVIEW_REQUIRED',reason,keep:true});
});
it('confirmed missing parts request a retake before any cleanliness verdict',()=>{
 expect(bufferedDecision({...base,viewMatch:'MISSING_SURFACE',cleanliness:{...base.cleanliness!,verdict:'DIRTY',surfaces:[{surface:'bowl',verdict:'DIRTY'}],reasonCode:'CLEANING_REQUIRED'}},true,true)).toEqual({state:'RECAPTURE_REQUIRED',reason:'MISSING_SURFACE',keep:false});
});
it('uncertain cleanliness is reviewed, while confirmed dirt keeps the photo and requires cleaning',()=>{
 expect(bufferedDecision({...base,cleanliness:{...base.cleanliness!,verdict:'CANNOT_ASSESS',surfaces:[{surface:'bowl',verdict:'CANNOT_ASSESS'}],reasonCode:'CANNOT_ASSESS'}},true,true)).toMatchObject({state:'REVIEW_REQUIRED',reason:'CANNOT_ASSESS'});
 expect(bufferedDecision({...base,cleanliness:{...base.cleanliness!,verdict:'DIRTY',surfaces:[{surface:'bowl',verdict:'DIRTY'}],reasonCode:'CLEANING_REQUIRED'}},true,true)).toEqual({state:'CLEANING_REQUIRED',reason:'CLEANING_REQUIRED',keep:true});
});
