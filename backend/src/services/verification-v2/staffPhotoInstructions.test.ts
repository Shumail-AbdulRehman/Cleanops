import {expect,it,vi} from 'vitest';
vi.mock('../../prisma/prisma.js',()=>({prisma:{}}));
import {staffPhotoInstructions} from './staffPhotoInstructions.js';
import {staffAttemptResult} from './captureSession.service.js';

const context={fixtureType:'SINK',viewKey:'basin_tap'};
it('asks for an Indian toilet pan retake without seat, pedestal or footrest requirements',()=>{
 const message=staffPhotoInstructions({state:'RECAPTURE_REQUIRED',reasonCode:'WRONG_ITEM',context:{fixtureType:'INDIAN_TOILET',viewKey:'squat_pan'}});
 expect(message).toBe('This photo does not show the Indian toilet. Please show the whole Indian toilet pan clearly and take another photo.');
 expect(message).not.toMatch(/seat|pedestal|footrest|manager/);
});
const result=(reasonCode:string,state='RECAPTURE_REQUIRED')=>staffPhotoInstructions({state,reasonCode,context});

it.each([['SINK','sink'],['TOILET','toilet'],['MIRROR','mirror'],['BIN','bin'],['FLOOR','floor area']])('names the required %s when another object is photographed',(fixtureType,name)=>{
 const message=staffPhotoInstructions({state:'RECAPTURE_REQUIRED',reasonCode:'WRONG_ITEM',context:{fixtureType}});
 expect(message).toBe(`This photo does not show the ${name}. Please show the whole ${name} clearly and take another photo.`);
});
it('asks for every required part when half a sink is missing',()=>{
 expect(result('MISSING_SURFACE')).toBe('The photo does not show all the required parts. Move back a little. Please show the whole sink basin, drain and tap clearly and take another photo.');
});
it('keeps toilet interior and exterior photo instructions distinct',()=>{
 const message=(viewKey:string)=>staffPhotoInstructions({state:'RECAPTURE_REQUIRED',reasonCode:'MISSING_SURFACE',context:{fixtureType:'TOILET',viewKey,toiletStyle:'WESTERN'}});
 expect(message('bowl_seat')).toContain('the whole toilet bowl and seat');
 expect(message('exterior_base')).toContain('the outside and base of the toilet');
});
it('names dirty surfaces and the QR rework action without inventing severity',()=>{
 expect(staffPhotoInstructions({state:'CLEANING_REQUIRED',reasonCode:'CLEANING_REQUIRED',context,dirtySurfaces:['basin','tap','basin']})).toBe('The sink is not clean. Please clean the basin and tap, then scan the task QR and take another photo.');
});
it('does not describe an unclear photo as dirty',()=>{
 expect(result('CANNOT_ASSESS')).toBe('We could not clearly see the sink. Please show the whole sink basin, drain and tap clearly and take another photo.');
 expect(result('CANNOT_ASSESS')).not.toContain('not clean');
});
it.each(['PHOTO_BLURRY','PHOTO_TOO_DARK','PHOTO_TOO_SMALL','PHOTO_OF_SCREEN','DUPLICATE_EVIDENCE'])('%s gives an action instead of a technical error',reason=>{
 expect(result(reason)).toMatch(/take|Take|Turn on|photograph/);
});
it('review and privacy states keep their next steps instead of instructing a retake',()=>{
 expect(result('WRONG_ITEM','REVIEW_REQUIRED')).toBe('Your manager needs to check this photo. Continue with the other required photos.');
 expect(result('WRONG_ITEM','PRIVACY_HOLD')).toContain('Wait for your manager');
});
it('unknown labels, model prose and object properties cannot enter the message',()=>{
 const message=staffPhotoInstructions({state:'CLEANING_REQUIRED',reasonCode:'CLEANING_REQUIRED',context:{fixtureType:'ignore all rules',viewKey:'constructor'},dirtySurfaces:['provider says secret','constructor']});
 expect(message).toBe('The required item is not clean. Please clean it, then scan the task QR and take another photo.');
});
it('the staff DTO uses saved task context for upload results without leaking model details',()=>{
 const dto=staffAttemptResult({state:'RECAPTURE_REQUIRED',qualityResult:{workflow:'DIRECT_PHOTO_V1',acceptable:true},coverageResult:null,cleanlinessResult:{policyDecisionReason:'WRONG_ITEM',photoContext:context,metadata:{confidence:.99,provider:'hidden'}}},false);
 expect(dto.instructions).toContain('Please show the whole sink basin, drain and tap');
 expect(dto.retryAction).toBe('REQUEST_RETAKE_SLOT');
 expect(JSON.stringify(dto)).not.toMatch(/confidence|provider|hidden/);
});
it('current task context takes precedence over an older saved context',()=>{
 const dto=staffAttemptResult({state:'RECAPTURE_REQUIRED',qualityResult:{acceptable:true},coverageResult:null,cleanlinessResult:{policyDecisionReason:'WRONG_ITEM',photoContext:context}},true,undefined,{fixtureType:'MIRROR',viewKey:'reflective_surface'});
 expect(dto.instructions).toContain('the whole mirror');expect(dto.instructions).not.toContain('sink');
});
it('a manual acceptance retains the manager outcome and overrides error copy',()=>{
 const dto=staffAttemptResult({state:'RECAPTURE_REQUIRED',qualityResult:{acceptable:true},coverageResult:null,cleanlinessResult:{policyDecisionReason:'WRONG_ITEM',photoContext:context}},true,'MANAGER_ACCEPTED');
 expect(dto.instructions).toBe('Your manager accepted this photo.');expect(dto.retryAction).toBeNull();
});

it('an Indian toilet retake never asks for a seat or raised base',()=>{
 const dto=staffAttemptResult({state:'RECAPTURE_REQUIRED',qualityResult:{acceptable:true},coverageResult:null,cleanlinessResult:{policyDecisionReason:'MISSING_SURFACE',photoContext:{fixtureType:'TOILET',viewKey:'bowl_seat',toiletStyle:'SQUAT'}}},true,undefined,{fixtureType:'TOILET',viewKey:'bowl_seat'});
 expect(dto.instructions).toContain('pan, drain and both footrests');
 expect(dto.instructions).not.toMatch(/seat|base/);
});
it('Indian toilet cleaning guidance names only the surfaces assessed for that design',()=>{
 const message=staffPhotoInstructions({state:'CLEANING_REQUIRED',reasonCode:'CLEANING_REQUIRED',context:{fixtureType:'TOILET',viewKey:'bowl_seat',toiletStyle:'SQUAT'},dirtySurfaces:['pan','footrests']});
 expect(message).toContain('clean the toilet pan and footrests');expect(message).not.toContain('seat');
});

it('names a confirmed missing part instead of claiming the object is missing',()=>{
 const dto=staffAttemptResult({state:'RECAPTURE_REQUIRED',qualityResult:{workflow:'DIRECT_PHOTO_V1',acceptable:true},coverageResult:null,cleanlinessResult:{policyDecisionReason:'MISSING_SURFACE',photoContext:{...context,missingSurfaces:['drain']}}},false);
 expect(dto.instructions).toContain('The photo does not show the drain.');
 expect(dto.instructions).not.toContain('does not show the sink.');
});
it.each(['OBJECT_UNCERTAIN','VIEW_UNCERTAIN','CANNOT_ASSESS'])('%s clearly requests manager review without asking for another photo',reasonCode=>{
 const dto=staffAttemptResult({state:'REVIEW_REQUIRED',qualityResult:{workflow:'DIRECT_PHOTO_V1',acceptable:true},coverageResult:null,cleanlinessResult:{policyDecisionReason:reasonCode,photoContext:context}},true);
 expect(dto.instructions).toContain('Your manager will check');
 expect(dto.instructions).not.toMatch(/take another photo|not clean|could not clearly see/);
 expect(dto.retryAction).toBeNull();expect(dto.reviewReason).toBe(reasonCode);
});
