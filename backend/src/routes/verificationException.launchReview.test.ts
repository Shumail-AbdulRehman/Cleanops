import express from 'express';
import type { AddressInfo } from 'node:net';
import { beforeEach, expect, it, vi } from 'vitest';
import { ApiError } from '../utils/ApiError.js';
const mocks = vi.hoisted(() => ({ access:vi.fn(), db:{
 exceptionEvent:{findMany:vi.fn(),findUnique:vi.fn()},verificationIssue:{findMany:vi.fn()},verificationDecision:{findMany:vi.fn(),count:vi.fn()},verificationAttempt:{findMany:vi.fn()},taskInstance:{findUnique:vi.fn()},area:{findUnique:vi.fn()},location:{findUnique:vi.fn()},manager:{findMany:vi.fn()},staff:{findMany:vi.fn()},taskVerificationItem:{findMany:vi.fn()},taskAssignment:{findMany:vi.fn(),findFirst:vi.fn()},areaStandardPhoto:{findMany:vi.fn()},
}}));
vi.mock('../prisma/prisma.js',()=>({prisma:mocks.db}));
vi.mock('../middlewares/auth.middleware.js',()=>({verifyJwt:(req:{user:unknown},_res:unknown,next:()=>void)=>{req.user={id:1,companyId:42,role:'MANAGER'};next();}}));
vi.mock('../services/verification-v2/exception.service.js',()=>({caseAccess:mocks.access,issueSatisfied:vi.fn().mockResolvedValue(false),resolveCompletedConcern:vi.fn(),managerDecision:vi.fn(),raiseIssue:vi.fn()}));
import router from './verificationException.route.js';
const now=new Date();
const session={id:'session',taskInstanceId:2,staffId:4,assignmentEpoch:3,assignmentId:5,captureExpiresAt:new Date(+now+3600000),uploadExpiresAt:new Date(+now+7200000),state:'ACTIVE',deviceId:'must-not-leak'};
const task={id:2,title:'Synthetic task',status:'IN_PROGRESS',isActive:true,verificationVersion:2,startedAt:now,staffId:4,staff:{id:4,name:'Synthetic staff'},staffSubmittedAt:null,assignmentEpoch:3,shiftStart:now,shiftEnd:new Date(+now+3600000),verificationDeadline:new Date(+now+3600000),policySnapshot:null};
const requirement={id:'view',state:'RECAPTURE_REQUIRED',mandatory:true,decisionVersion:2,currentAttemptId:'attempt',viewKey:'BASIN_TAP'};
const attempt={id:'attempt',requirementId:'view',state:'RECAPTURE_REQUIRED',receivedAt:now,createdAt:now,staffId:4,assignmentEpoch:3,slot:{generation:1},session,mediaAssetId:'asset',media:{privacyState:'SAFE'},cleanlinessResult:null};
beforeEach(()=>{
 vi.clearAllMocks();mocks.access.mockResolvedValue({id:3,kind:'TASK',state:'MANAGER_REVIEW',rowVersion:2,taskInstanceId:2,areaId:7,locationId:8,companyId:42});
 for(const model of Object.values(mocks.db))for(const method of Object.values(model))method.mockResolvedValue([]);
 mocks.db.taskInstance.findUnique.mockResolvedValue(task);mocks.db.area.findUnique.mockResolvedValue({id:7,name:'Synthetic washroom'});mocks.db.location.findUnique.mockResolvedValue({id:8,name:'Synthetic site',timezone:'Asia/Karachi'});mocks.db.verificationDecision.count.mockResolvedValue(0);mocks.db.exceptionEvent.findUnique.mockResolvedValue(null);
 mocks.db.taskVerificationItem.findMany.mockResolvedValue([{id:1,nameSnapshot:'Synthetic sink',mandatory:true,typeSnapshot:'SINK',requirements:[requirement]}]);mocks.db.taskAssignment.findFirst.mockResolvedValue({id:5});mocks.db.verificationAttempt.findMany.mockImplementation(async (query: {include?:unknown}) => { if(query.include)return [attempt];const {slot:_slot,session:_session,...selected}=attempt;return [selected]; });
});
async function request(){
 const app=express();app.use(router);app.use((error:ApiError,_req:unknown,res:express.Response,_next:unknown)=>res.status(error.statusCode??500).json({message:error.message}));
 const server=app.listen(0,'127.0.0.1');await new Promise<void>(resolve=>server.once('listening',resolve));
 try{return await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/verification-exceptions/3`).then(async response=>({status:response.status,body:await response.json()}));}
 finally{await new Promise<void>(resolve=>server.close(()=>resolve()));}
}
it('wires authorized detail to real read guard/qualification while withholding session/device and authority',async()=>{
 const response=await request();expect(response.status).toBe(200);
 const view=response.body.data.items[0].requirements[0];expect(view.replacement).toMatchObject({policyEligible:true,available:false,processingAllowed:false,automaticApproval:false,reason:'PHOTO_QUALIFICATION_UNAVAILABLE'});
 expect(view.currentAttempt.receivedAt).toBe(now.toISOString());expect(view.currentAttempt.mediaAssetId).toBe('asset');expect(JSON.stringify(response.body)).not.toContain('must-not-leak');expect(view.currentAttempt.session).toBeUndefined();
 expect(mocks.access).toHaveBeenCalledWith({id:1,companyId:42,role:'MANAGER'},3);
 expect(mocks.db.taskAssignment.findFirst).toHaveBeenCalledWith({where:{taskInstanceId:2,staffId:4,isCurrent:true},select:{id:true}});
});
it.each([403,404])('denies unauthorized or foreign case %i before reading task/evidence/assignment',async status=>{
 mocks.access.mockRejectedValue(new ApiError(status,'Access denied'));const response=await request();expect(response.status).toBe(status);expect(mocks.db.taskInstance.findUnique).not.toHaveBeenCalled();expect(mocks.db.verificationAttempt.findMany).not.toHaveBeenCalled();expect(mocks.db.taskAssignment.findFirst).not.toHaveBeenCalled();
});
it('denies replacement after submission without altering persisted received evidence',async()=>{
 mocks.db.taskInstance.findUnique.mockResolvedValue({...task,staffSubmittedAt:now});const response=await request();expect(response.body.data.items[0].requirements[0].replacement.policyEligible).toBe(false);expect(response.body.data.items[0].requirements[0].currentAttempt.receivedAt).toBe(now.toISOString());
});
it('does not advertise replacement for a prior assignment',async()=>{
 mocks.db.taskAssignment.findFirst.mockResolvedValue({id:99});const response=await request();expect(response.body.data.items[0].requirements[0].replacement.policyEligible).toBe(false);
});
