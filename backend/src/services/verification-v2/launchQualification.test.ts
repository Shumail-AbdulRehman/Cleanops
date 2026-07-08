import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as release from './cleanlinessRelease.js';
import { launchQualificationStatus, requireLaunchPhotoQualification } from './launchQualification.js';
import { autoPassAllowed } from './cleanliness.service.js';
let directory: string;
beforeEach(() => {
 directory = mkdtempSync(join(tmpdir(),'hygene-qualification-'));
 vi.stubEnv('CLEF_RELEASE_RECORD_PATH','');vi.stubEnv('CLEF_RELEASE_RECORD_SHA256','');
 vi.stubEnv('CLEF_MODEL','clef');vi.stubEnv('CLEF_TIMEOUT_MS','30000');vi.stubEnv('CLEF_SCREENING_CONFIDENCE_THRESHOLD','.9');
});
afterEach(() => { vi.restoreAllMocks();vi.unstubAllEnvs();rmSync(directory,{recursive:true,force:true}); });
it('missing real qualification never permits processing or automatic approval',()=>{
 expect(launchQualificationStatus('SINK')).toMatchObject({processingAllowed:false,automaticApproval:false,reason:'ACTIVE_PRIVACY_SCREENING_UNAVAILABLE',releaseReason:'RELEASE_NOT_CONFIGURED'});
 expect(()=>requireLaunchPhotoQualification('SINK')).toThrow(expect.objectContaining({statusCode:503,errors:[{code:'PHOTO_QUALIFICATION_UNAVAILABLE'}]}));
});
it.each(['CLEF_MODEL','CLEF_TIMEOUT_MS','CLEF_SCREENING_CONFIDENCE_THRESHOLD'])('invalid active %s is unavailable rather than dirty or approved',name=>{
 vi.stubEnv(name,'invalid');expect(launchQualificationStatus('SINK')).toMatchObject({processingAllowed:false,automaticApproval:false,reason:'ACTIVE_CONFIGURATION_INVALID',pipelineSha256:null});
});
it('binds the report to the complete active adapter and changes with model configuration',()=>{
 const first=launchQualificationStatus('SINK');expect(first.pipelineSha256).toBe(release.digest(JSON.stringify(release.verificationReleaseConfiguration())));
 vi.stubEnv('CLEF_MODEL','clef-flash');expect(launchQualificationStatus('SINK').pipelineSha256).not.toBe(first.pipelineSha256);
});
it.each(['{}','{"consentVerified":true,"representativeRoomsVerified":true}','{"automaticApproval":true}'])('a boolean or incomplete attestation cannot stand in for measured consented results: %s',bytes=>{
 const path=join(directory,'release.json');writeFileSync(path,bytes);
 vi.stubEnv('CLEF_RELEASE_RECORD_PATH',path);vi.stubEnv('CLEF_RELEASE_RECORD_SHA256',release.digest(bytes));
 expect(launchQualificationStatus('SINK')).toMatchObject({processingAllowed:false,automaticApproval:false,releaseReason:'RELEASE_INVALID'});
});
it('rejects a changed pinned dataset record',()=>{
 const path=join(directory,'release.json');writeFileSync(path,'{}');
 vi.stubEnv('CLEF_RELEASE_RECORD_PATH',path);vi.stubEnv('CLEF_RELEASE_RECORD_SHA256',release.digest('other dataset'));
 expect(launchQualificationStatus('SINK')).toMatchObject({processingAllowed:false,automaticApproval:false,releaseReason:'RELEASE_INVALID'});
});
it('a historical or fixture-only release cannot manufacture missing active privacy or identity checks',()=>{
 const spy=vi.spyOn(release,'cleanlinessReleaseStatus').mockReturnValue({allowed:true,reason:'VALIDATED_RELEASE'});
 expect(launchQualificationStatus('TOILET',3,new Date('2026-10-20'))).toMatchObject({processingAllowed:false,automaticApproval:false,reason:'ACTIVE_PRIVACY_SCREENING_UNAVAILABLE'});
 expect(spy).toHaveBeenCalledWith('TOILET',3,new Date('2026-10-20'));
});
it.each(['RELEASE_EXPIRED','CONFIGURATION_CHANGED','FIXTURE_NOT_VALIDATED','RELEASE_INVALID'])('retains the precise denied qualification reason %s',reason=>{
 vi.spyOn(release,'cleanlinessReleaseStatus').mockReturnValue({allowed:false,reason});
 expect(launchQualificationStatus('SINK')).toMatchObject({processingAllowed:false,automaticApproval:false,releaseReason:reason});
});
it.each(['AUTO_PASS_ENABLED','PHOTO_QUALIFIED','PRIVACY_SCREENING_ENABLED'])('a deployment boolean %s cannot bypass empirical qualification',name=>{
 vi.stubEnv(name,'true');expect(()=>requireLaunchPhotoQualification('SINK')).toThrow(expect.objectContaining({statusCode:503}));
});
it('the owner override opens processing and automatic approval only when set to exactly "true"',()=>{
 for(const value of ['','false','TRUE','1','yes']){vi.stubEnv('PHOTO_CHECKS_OWNER_OVERRIDE',value);expect(launchQualificationStatus('SINK')).toMatchObject({processingAllowed:false,automaticApproval:false});}
 vi.stubEnv('PHOTO_CHECKS_OWNER_OVERRIDE','true');
 expect(launchQualificationStatus('SINK')).toMatchObject({processingAllowed:true,automaticApproval:true,reason:'OWNER_OVERRIDE'});
 expect(()=>requireLaunchPhotoQualification('SINK')).not.toThrow();
 expect(autoPassAllowed('SINK')).toBe(true);
 vi.stubEnv('PHOTO_CHECKS_OWNER_OVERRIDE','');expect(autoPassAllowed('SINK')).toBe(false);
});
it('the owner override does not open an invalid AI configuration',()=>{
 vi.stubEnv('PHOTO_CHECKS_OWNER_OVERRIDE','true');vi.stubEnv('CLEF_MODEL','invalid');
 expect(launchQualificationStatus('SINK')).toMatchObject({processingAllowed:false,reason:'ACTIVE_CONFIGURATION_INVALID'});
});
