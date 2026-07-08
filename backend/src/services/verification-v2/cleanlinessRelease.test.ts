import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {calibrateCleanliness,createCleanlinessRelease,cleanlinessReleaseStatus,digest} from './cleanlinessRelease.js';
import {clefEvaluatorVersion} from './clefConfiguration.js';
import {autoPassAllowed} from './cleanliness.service.js';

// Deliberately synthetic unit-test data. Never written to a configured release location.
const configuration={provider:'cloudflare' as const,model:'clef' as const,promptVersion:'clef-surfaces-v1' as const,providerVersion:'cloudflare-system-one-v1' as const};
const now=new Date('2026-10-08T12:00:00Z');
function row(i:number,split:'development'|'heldout',label:'CLEAN'|'DIRTY'|'CANNOT_ASSESS',identity:'CORRECT'|'WRONG'|'REPLAYED'='CORRECT'){
 const confidence=label==='DIRTY'?.7:.98;
 const predicted=label==='DIRTY'?'CANNOT_ASSESS':label;
 const choice=label==='DIRTY'?'CLEAN':label;
 return {id:`${split}-${i}`,roomId:`${split}-room`,fixtureId:`${split}-${i}`,fixtureType:'TOILET',split,consented:true as const,visibility:label==='CANNOT_ASSESS'?'UNASSESSABLE' as const:'ASSESSABLE' as const,identity,cleanliness:label,confidence,threshold:.98,thresholdVersion:'unit-candidate',...configuration,requestedModel:'@cf/cloudflare/clef',rubricVersion:1,latencyMs:10,costUsd:null,evaluatorVersion:clefEvaluatorVersion(),imageSha256:digest(`synthetic-image-${split}-${i}`),evaluationInputHash:digest(`synthetic-label-${split}-${i}`),predictedCleanliness:predicted,wouldAutoPass:predicted==='CLEAN'&&identity==='CORRECT',predictedCoverage:identity==='CORRECT'?'MATCH' as const:'WRONG_ITEM' as const,identityConsistent:identity==='CORRECT',qualityPassed:true,privacySafe:true,duplicateClear:true,assessment:{result:{verdict:predicted,confidence,reasonCode:predicted==='CLEAN'?'CLEAN':'CANNOT_ASSESS',surfaces:[{surface:'bowl',verdict:predicted}],details:{threshold:.98,thresholdVersion:'unit-candidate',assessmentStatus:'ASSESSED',predictions:[{surface:'bowl',type:'choice',choice,confidence,probabilities:{CLEAN:choice==='CLEAN'?.98:.01,DIRTY:.01,CANNOT_ASSESS:choice==='CANNOT_ASSESS'?.98:.01}}]}}}};
}
function rows(split:'development'|'heldout'){
 return [...Array.from({length:100},(_,i)=>row(i,split,'DIRTY')),...Array.from({length:20},(_,i)=>row(i+100,split,'CLEAN')),...Array.from({length:20},(_,i)=>row(i+120,split,'CANNOT_ASSESS')),...(split==='heldout'?Array.from({length:100},(_,i)=>row(i+140,split,'CLEAN',i%2?'WRONG':'REPLAYED')):[])];
}
function fixture(){
 const development=rows('development'),heldout=rows('heldout');
 const calibration=calibrateCleanliness(development,digest(JSON.stringify(development)),'unit-candidate',new Date(now.getTime()-1000));
 const review={labelledBy:'unit-human',evaluatedBy:'unit-evaluator',reviewedBy:'unit-independent-reviewer',reviewedAt:now.toISOString(),expiresAt:new Date(now.getTime()+86400000).toISOString(),labelsManifestSha256:digest('unit-only-labels'),independentHumanLabels:true as const,consentVerified:true as const,representativeRoomsVerified:true as const};
 return {development,heldout,calibration,review};
}
let dir:string;
beforeEach(()=>{dir=mkdtempSync(join(tmpdir(),'hygene-release-test-'));vi.stubEnv('CLEF_SCREENING_CONFIDENCE_THRESHOLD','.9');vi.stubEnv('CLEF_MODEL','clef');vi.stubEnv('CLEF_CONFIDENCE_THRESHOLD','.98');vi.stubEnv('CLEF_THRESHOLD_VERSION','unit-candidate');vi.stubEnv('CLEF_RELEASE_RECORD_PATH','');vi.stubEnv('CLEF_RELEASE_RECORD_SHA256','');});
afterEach(()=>{vi.unstubAllEnvs();rmSync(dir,{recursive:true,force:true});});
function configure(record:unknown){const path=join(dir,'release.json'),bytes=JSON.stringify(record);writeFileSync(path,bytes);vi.stubEnv('CLEF_RELEASE_RECORD_PATH',path);vi.stubEnv('CLEF_RELEASE_RECORD_SHA256',digest(bytes));return path;}
describe('reviewed Clef release gate',()=>{
 it('calibrates only development rooms and keeps deployment unchanged',()=>{const f=fixture();expect(f.calibration.threshold).toBe(.98);expect(f.calibration.metrics.TOILET?.falseClean).toBe(0);expect(autoPassAllowed('TOILET')).toBe(false);});
 it('rejects absent/sparse labels rather than inventing a threshold',()=>{expect(()=>calibrateCleanliness([],digest('[]'),'candidate')).toThrow();expect(()=>calibrateCleanliness(rows('development').slice(0,10),digest('sparse'),'candidate')).toThrow();});
 it('qualifies only the measured fixture and rubric under the exact frozen configuration',()=>{const f=fixture(),record=createCleanlinessRelease(f.heldout,f.calibration,f.review,digest(JSON.stringify(f.heldout)),now);configure(record);expect(cleanlinessReleaseStatus('TOILET',1,now).allowed).toBe(true);expect(cleanlinessReleaseStatus('SINK',1,now).allowed).toBe(false);vi.stubEnv('CLEF_SCREENING_CONFIDENCE_THRESHOLD','.95');expect(cleanlinessReleaseStatus('TOILET',1,now).allowed).toBe(false);vi.stubEnv('CLEF_SCREENING_CONFIDENCE_THRESHOLD','.9');expect(cleanlinessReleaseStatus('TOILET',2,now).allowed).toBe(false);vi.stubEnv('CLEF_MODEL','clef-flash');expect(cleanlinessReleaseStatus('TOILET',1,now).reason).toBe('CONFIGURATION_CHANGED');});
 it('rejects changed threshold/version and expired review',()=>{const f=fixture();configure(createCleanlinessRelease(f.heldout,f.calibration,f.review,digest('heldout'),now));vi.stubEnv('CLEF_CONFIDENCE_THRESHOLD','.99');expect(cleanlinessReleaseStatus('TOILET',1,now).allowed).toBe(false);vi.stubEnv('CLEF_CONFIDENCE_THRESHOLD','.98');vi.stubEnv('CLEF_THRESHOLD_VERSION','changed');expect(cleanlinessReleaseStatus('TOILET',1,now).allowed).toBe(false);expect(cleanlinessReleaseStatus('TOILET',1,new Date(now.getTime()+2*86400000)).allowed).toBe(false);});
 it('fails closed on checksum tampering, malformed record or forged eligibility',()=>{const f=fixture(),r=createCleanlinessRelease(f.heldout,f.calibration,f.review,digest('heldout'),now);const path=configure(r);expect(cleanlinessReleaseStatus('TOILET',1,now).allowed).toBe(true);writeFileSync(path,'{}');expect(cleanlinessReleaseStatus('TOILET',1,now).allowed).toBe(false);configure({...r,eligibleFixtureTypes:['SINK']});expect(cleanlinessReleaseStatus('SINK',1,now).allowed).toBe(false);vi.stubEnv('CLEF_SCREENING_CONFIDENCE_THRESHOLD','.95');expect(cleanlinessReleaseStatus('TOILET',1,now).allowed).toBe(false);vi.stubEnv('CLEF_SCREENING_CONFIDENCE_THRESHOLD','.9');});
 it.each(['image','room','fixture'])('rejects heldout/development %s leakage',kind=>{const f=fixture();if(kind==='image')f.heldout[0]!.imageSha256=f.development[0]!.imageSha256;else if(kind==='room')f.heldout[0]!.roomId=f.development[0]!.roomId;else f.heldout[0]!.fixtureId=f.development[0]!.fixtureId;expect(()=>createCleanlinessRelease(f.heldout,f.calibration,f.review,digest('heldout'),now)).toThrow();});
 it('does not qualify missing stages or false passes of wrong/replayed fixtures',()=>{const f=fixture();f.heldout[0]!.qualityPassed=undefined as any;expect(()=>createCleanlinessRelease(f.heldout,f.calibration,f.review,digest('heldout'),now)).toThrow();const g=fixture();for(const r of g.heldout.filter(r=>r.identity!=='CORRECT')){r.predictedCoverage='MATCH';r.identityConsistent=true;}expect(()=>createCleanlinessRelease(g.heldout,g.calibration,g.review,digest('heldout'),now)).toThrow();});
 it('cannot certify an always-review candidate with no useful clean results',()=>{const f=fixture();for(const r of f.heldout.filter(r=>r.cleanliness==='CLEAN'&&r.identity==='CORRECT'))r.qualityPassed=false;expect(()=>createCleanlinessRelease(f.heldout,f.calibration,f.review,digest('heldout'),now)).toThrow();});
 it('rejects forged aggregate predictions and repeated evaluation images',()=>{const f=fixture();f.heldout[0]!.predictedCleanliness='CLEAN';expect(()=>createCleanlinessRelease(f.heldout,f.calibration,f.review,digest('heldout'),now)).toThrow();const g=fixture();g.heldout[1]!.imageSha256=g.heldout[0]!.imageSha256;expect(()=>createCleanlinessRelease(g.heldout,g.calibration,g.review,digest('heldout'),now)).toThrow();});
});
