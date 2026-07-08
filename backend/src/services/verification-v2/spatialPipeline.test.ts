vi.mock('../launchJobs.service.js',()=>({jobAccountAllowed:vi.fn(async()=>true)}));
import {afterEach,it,expect,vi} from 'vitest';
vi.mock('../../prisma/prisma.js',()=>({prisma:{verificationJob:{findFirst:vi.fn(),findMany:vi.fn()},verificationAttempt:{findUniqueOrThrow:vi.fn(),findMany:vi.fn(),updateMany:vi.fn()},captureSlot:{findMany:vi.fn()}}}));
vi.mock('./captureSession.service.js',()=>({lockTask:vi.fn()}));
vi.mock('./completion.service.js',()=>({finalizeTask:vi.fn()}));
vi.mock('./exception.service.js',()=>({raiseIssue:vi.fn()}));
vi.mock('./duplicate.service.js',()=>({duplicateCandidates:vi.fn()}));
vi.mock('./coverage.service.js',()=>({assessPrivacy:vi.fn(),assessCoverage:vi.fn()}));
vi.mock('./jobQueue.service.js',()=>({publishJobResult:vi.fn(),enqueueVerificationJob:vi.fn()}));
import {prisma} from '../../prisma/prisma.js';
import {duplicateCandidates} from './duplicate.service.js';
import {assessCoverage} from './coverage.service.js';
import {publishJobResult,enqueueVerificationJob} from './jobQueue.service.js';
import {processVerificationJob} from './pipeline.service.js';
const sessionId='11111111-1111-4111-8111-111111111111',worldId='22222222-2222-4222-8222-222222222222',requirementId='33333333-3333-4333-8333-333333333333';
const observation={version:1,sessionId,worldId,requirementId,contextKey:null,sequence:2,capability:'LIMITED_SPATIAL',tracking:'GOOD',continuity:'CONTINUOUS',capturedElapsedMs:2000,worldStartedElapsedMs:0,nativeTimestampMs:12000,camera:{position:{x:1,y:0,z:1},orientation:{x:0,y:0,z:0,w:1}},worldPoint:{position:{x:1,y:0,z:0},method:'CENTER_DEPTH',quality:'GOOD',uncertaintyMeters:.02},movementMeters:1,interruptionReasons:[]};
afterEach(()=>{vi.resetAllMocks();vi.unstubAllEnvs();});
function setup(mode='ASSISTED_RECAPTURE',passed=false){
 const task={id:9,isActive:true,assignmentEpoch:1,staffId:5,status:'IN_PROGRESS',locationId:8,location:{isActive:true,company:{isActive:true}},policySnapshot:{spatial:{mode}}};
 const session={id:sessionId,taskInstanceId:9,task,areaId:1,qrVersion:1,state:'ACTIVE',presenceStatus:'ACCEPTABLE',contextStatus:'ACCEPTABLE',uploadExpiresAt:new Date(Date.now()+60000)};
 const a={id:'current',sessionId,session,requirementId,staffId:5,assignmentEpoch:1,slot:{generation:0},receivedAt:new Date(),timingEvidence:'ON_TIME_SERVER_OBSERVED',media:{id:'media',companyId:1,deliveryType:'authenticated',privacyState:'SAFE',sanitizedPublicId:'private'},qualityResult:{acceptable:true},spatialEvidence:observation,requirement:{taskVerificationItemId:2,viewKey:'bowl_seat',item:{typeSnapshot:'TOILET',rubricSnapshot:{version:1}}}};
 const prior={id:'prior',mediaAssetId:'prior-media',spatialEvidence:{...observation,sequence:1,capturedElapsedMs:1000,nativeTimestampMs:11000},requirement:{currentAttemptId:'prior',state:'PASSED',taskVerificationItemId:1}};
 const tx={verificationAttempt:{findMany:vi.fn().mockResolvedValue([prior]),findUniqueOrThrow:vi.fn().mockResolvedValue(a),updateMany:vi.fn(),update:vi.fn(),count:vi.fn().mockResolvedValue(1)},verificationJob:{findFirst:vi.fn().mockResolvedValue(null)},taskInstance:{findUniqueOrThrow:vi.fn().mockResolvedValue(task),update:vi.fn()},taskEvidenceRequirement:{findUniqueOrThrow:vi.fn().mockResolvedValue({id:requirementId,state:passed?'PASSED':'PROCESSING',currentAttemptId:'current',decisionVersion:0}),update:vi.fn()},staff:{findFirst:vi.fn().mockResolvedValue({id:5})},area:{findUniqueOrThrow:vi.fn().mockResolvedValue({qrVersion:1})}};
 vi.mocked(prisma.verificationJob.findFirst).mockResolvedValue({id:'job'} as any);vi.mocked(prisma.verificationJob.findMany).mockResolvedValue([]);
 vi.mocked(prisma.verificationAttempt.findUniqueOrThrow).mockResolvedValue(a as any);vi.mocked(prisma.captureSlot.findMany).mockResolvedValue([]);vi.mocked(prisma.verificationAttempt.findMany).mockResolvedValue([]);
 vi.mocked(duplicateCandidates).mockResolvedValue({exact:[],near:['prior-media'],candidates:[{id:'prior-media',privacyState:'SAFE',sanitizedPublicId:'prior'}]} as any);
 vi.mocked(assessCoverage).mockResolvedValue({result:{verdict:'MATCH',identityConsistent:true,privacyFlag:false,reasonCode:'CLEAN'}} as any);
 vi.mocked(publishJobResult).mockImplementation(async(_job,_result,callback)=>{await callback!(tx as any);return true;});
 return {tx,a};
}
const job={id:'job',attemptId:'current',companyId:1,leaseToken:'lease',evaluatorVersion:'coverage-v1',stage:'COVERAGE',attempts:1};
it('corroborated same-position suspicion requests only the current identity view; Clef is untouched',async()=>{
 const {tx}=setup();vi.stubEnv('VERIFICATION_SPATIAL_RECAPTURE_ENABLED','true');const clef={evaluate:vi.fn()};
 await processVerificationJob(job as any,{assess:vi.fn()} as any,vi.fn().mockResolvedValue(Buffer.from('still')),clef);
 expect(tx.taskEvidenceRequirement.update).toHaveBeenCalledWith({where:{id:requirementId},data:{state:'RECAPTURE_REQUIRED',decisionVersion:{increment:1}}});
 expect(tx.verificationAttempt.updateMany).toHaveBeenCalledWith(expect.objectContaining({data:expect.objectContaining({spatialDecision:expect.objectContaining({result:'SAME_POSITION_SUSPECTED',autoIdentityAcceptance:false})})}));
 expect(enqueueVerificationJob).not.toHaveBeenCalled();expect(clef.evaluate).not.toHaveBeenCalled();
});
it('evaluation mode records the signal while preserving normal coverage-to-cleanliness behavior',async()=>{
 setup('EVALUATE');vi.stubEnv('VERIFICATION_SPATIAL_RECAPTURE_ENABLED','true');
 await processVerificationJob(job as any,{assess:vi.fn()} as any,vi.fn().mockResolvedValue(Buffer.from('still')),{evaluate:vi.fn()});
 expect(enqueueVerificationJob).toHaveBeenCalledWith(expect.anything(),expect.objectContaining({stage:'CLEANLINESS'}));
});
it('a spatial result cannot overwrite an already passed view or its cleanliness assessment',async()=>{
 const {tx}=setup('ASSISTED_RECAPTURE',true);vi.stubEnv('VERIFICATION_SPATIAL_RECAPTURE_ENABLED','true');
 await processVerificationJob(job as any,{assess:vi.fn()} as any,vi.fn().mockResolvedValue(Buffer.from('still')),{evaluate:vi.fn()});
 expect(tx.taskEvidenceRequirement.update).not.toHaveBeenCalled();
 for(const call of tx.verificationAttempt.update.mock.calls)expect(call[0].data).not.toHaveProperty('cleanlinessResult');
});
