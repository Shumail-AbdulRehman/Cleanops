vi.mock('../services/accountAccess.service.js',()=>({assertAccountAction:vi.fn(async()=>({})),assertAccountCompletion:vi.fn(async()=>({})),recordWorkEntitlement:vi.fn(async()=>{})}));
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Request, Response } from 'express';
const mocks=vi.hoisted(()=>({access:vi.fn(),lock:vi.fn(),update:vi.fn(),start:vi.fn(),initial:vi.fn(),area:vi.fn(),areaLock:vi.fn(),audit:vi.fn(),requirements:vi.fn()}));
vi.mock('../prisma/prisma.js',()=>({prisma:{$transaction:async(fn:(tx:unknown)=>unknown)=>fn({taskInstance:{update:mocks.update,findFirst:mocks.initial},area:{findUnique:mocks.area},taskEvidenceRequirement:{findMany:mocks.requirements},$queryRaw:mocks.areaLock})}}));
vi.mock('../services/verification-v2/authorization.service.js',()=>({requireTaskAccess:mocks.access,requireLocationAccess:vi.fn()}));
vi.mock('../services/verification-v2/captureSession.service.js',()=>({lockTask:mocks.lock}));
vi.mock('../services/taskAssignment.service.js',()=>({markCurrentAssignmentStarted:mocks.start}));
vi.mock('../services/auditLog.service.js',()=>({writeAuditLog:mocks.audit}));
import {signTaskQr,signAreaQr,signFixtureQr} from '../services/verification-v2/qr.service.js';
process.env.VERIFICATION_QR_SECRET='test-start-qr-key-at-least-thirty-two-characters';
const area={id:10,locationId:2,qrVersion:1,qrNonce:'start-room'};
import {startTask,completeTask,retiredEvidenceEndpoint} from './taskInstance.controller.js';
const request=()=>({params:{taskId:'1'},query:{},body:{areaQr:signTaskQr({id:1,areaId:area.id},area)},user:{id:7,companyId:1,role:'STAFF'}} as unknown as Request);
const response=()=>({json:vi.fn()} as unknown as Response);
let task:Record<string,unknown>;
afterEach(()=>vi.useRealTimers());
beforeEach(()=>{vi.resetAllMocks();mocks.requirements.mockResolvedValue([]);mocks.initial.mockResolvedValue({areaId:area.id});mocks.area.mockResolvedValue(area);task={id:1,areaId:area.id,locationId:2,assignmentEpoch:4,assignments:[{id:3,isCurrent:true,staffId:7}],verificationVersion:2,status:'PENDING',shiftStart:new Date(Date.now()-60000),shiftEnd:new Date(Date.now()+3600000)};mocks.access.mockImplementation(async()=>task);mocks.update.mockImplementation(async({data})=>({...task,...data}));});
describe('guided-only task mutations',()=>{
 it('starts with the signed assigned area QR and records a separate start event',async()=>{
  await startTask(request(),response());
  expect(mocks.lock).toHaveBeenCalledWith(expect.anything(),1);
  expect(mocks.access).toHaveBeenCalledWith(expect.objectContaining({id:7}),1,{staffMutation:true},expect.anything());
  expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({data:expect.objectContaining({status:'IN_PROGRESS'})}));
  expect(mocks.start).toHaveBeenCalledTimes(1);
  expect(mocks.areaLock.mock.invocationCallOrder[0]).toBeLessThan(mocks.lock.mock.invocationCallOrder[0]!);
  expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({action:'TASK_STARTED_AREA_QR',newValue:expect.objectContaining({areaId:10,qrVersion:1,assignmentId:3,assignmentEpoch:4})}),expect.anything());
  expect(JSON.stringify(mocks.audit.mock.calls)).not.toContain(signAreaQr(area));
 });
 it('rejects a missing area QR, including an obsolete template token',async()=>{const req=request();req.body={};req.query.qrToken='old-template-qr';await expect(startTask(req,response())).rejects.toMatchObject({statusCode:400,errors:[{code:'AREA_QR_REQUIRED'}]});expect(mocks.update).not.toHaveBeenCalled();});
 it.each(['wrong-area','tampered','rotated','fixture'])('rejects %s QR without exposing another area or starting',async kind=>{const req=request();req.body.areaQr=kind==='wrong-area'?signAreaQr({...area,id:99}):kind==='rotated'?signAreaQr({...area,qrVersion:0}):kind==='fixture'?signFixtureQr(area,1):req.body.areaQr+'x';await expect(startTask(req,response())).rejects.toMatchObject({statusCode:422,errors:[{code:'AREA_QR_MISMATCH'}]});expect(mocks.update).not.toHaveBeenCalled();expect(mocks.start).not.toHaveBeenCalled();expect(mocks.audit).not.toHaveBeenCalled();});
 it('does not restart an already started task',async()=>{task.status='IN_PROGRESS';await startTask(request(),response());expect(mocks.update).not.toHaveBeenCalled();expect(mocks.start).not.toHaveBeenCalled();expect(mocks.audit).not.toHaveBeenCalled();});
 it('requires inventory setup for historical tasks and never starts the old QR flow',async()=>{task.verificationVersion=1;await expect(startTask(request(),response())).rejects.toMatchObject({statusCode:409,errors:[{code:'INVENTORY_SETUP_REQUIRED'}]});expect(mocks.update).not.toHaveBeenCalled();});
 it.each(['ended','early','cancelled'])('preserves the %s task window/status gate',async kind=>{if(kind==='ended')task.shiftEnd=new Date(0);else if(kind==='early')task.shiftStart=new Date(Date.now()+600000);else task.status='CANCELLED';await expect(startTask(request(),response())).rejects.toMatchObject({statusCode:409});expect(mocks.update).not.toHaveBeenCalled();});
 it('explains the full local date for a next-night task instead of blaming the QR',async()=>{
  vi.useFakeTimers();vi.setSystemTime(new Date('2026-10-08T19:45:00Z'));
  task.location={timezone:'Asia/Karachi'};task.shiftStart=new Date('2026-10-09T18:55:00Z');task.shiftEnd=new Date('2026-10-09T22:00:00Z');
  await expect(startTask(request(),response())).rejects.toMatchObject({statusCode:409,message:expect.stringContaining('Oct 9, 2026'),errors:[expect.objectContaining({code:'TASK_START_TOO_EARLY',opensAt:'2026-10-09T18:50:00.000Z',timeZone:'Asia/Karachi'})]});
  expect(mocks.update).not.toHaveBeenCalled();expect(mocks.start).not.toHaveBeenCalled();expect(mocks.audit).not.toHaveBeenCalled();
 });
 it('allows an overnight task after midnight in the same live window',async()=>{
  vi.useFakeTimers();const now=new Date('2026-10-08T19:45:00Z');vi.setSystemTime(now);
  task.location={timezone:'Asia/Karachi'};task.shiftStart=new Date('2026-10-08T18:55:00Z');task.shiftEnd=new Date('2026-10-08T22:00:00Z');
  await startTask(request(),response());expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({data:expect.objectContaining({startedAt:now,status:'IN_PROGRESS',isLate:true,lateMinutes:50})}));
 });
 it('allows exactly five minutes before start, but rejects one millisecond earlier',async()=>{
  vi.useFakeTimers();const starts=new Date('2026-10-09T18:55:00Z');task.shiftStart=starts;task.shiftEnd=new Date('2026-10-09T22:00:00Z');
  vi.setSystemTime(new Date(+starts-300001));await expect(startTask(request(),response())).rejects.toMatchObject({errors:[expect.objectContaining({code:'TASK_START_TOO_EARLY'})]});
  vi.setSystemTime(new Date(+starts-300000));await startTask(request(),response());expect(mocks.update).toHaveBeenCalledOnce();
 });
 it('explains expiry at the exact end instant without changing start state',async()=>{
  vi.useFakeTimers();const end=new Date('2026-10-08T22:00:00Z');vi.setSystemTime(end);
  task.location={timezone:'Asia/Karachi'};task.shiftStart=new Date('2026-10-08T18:55:00Z');task.shiftEnd=end;
  await expect(startTask(request(),response())).rejects.toMatchObject({message:expect.stringContaining('Oct 9, 2026'),errors:[expect.objectContaining({code:'TASK_START_WINDOW_ENDED'})]});expect(mocks.update).not.toHaveBeenCalled();
 });
 it('authorization failure prevents every task mutation',async()=>{mocks.access.mockRejectedValue(new Error('Current active assignment required'));await expect(startTask(request(),response())).rejects.toThrow('assignment');expect(mocks.update).not.toHaveBeenCalled();});
 it('rejects retired evidence endpoints before storage and returns guided instructions',async()=>{await expect(retiredEvidenceEndpoint(request(),response())).rejects.toMatchObject({statusCode:410,errors:[{code:'GUIDED_VERIFICATION_REQUIRED'}]});expect(mocks.update).not.toHaveBeenCalled();});
 it('cannot complete unresolved guided work through the old complete endpoint',async()=>{task.status='IN_PROGRESS';await expect(completeTask(request(),response())).rejects.toMatchObject({statusCode:409});expect(mocks.update).not.toHaveBeenCalled();});
 it('hides manager outcome for an already finalized staff submission',async()=>{task.status='COMPLETED';task.completionOutcome='COMPLETED_WITH_EXCEPTIONS';const res=response();await completeTask(request(),res);expect(res.json).toHaveBeenCalledWith(expect.objectContaining({data:expect.objectContaining({status:'COMPLETED'})}));expect(JSON.stringify(vi.mocked(res.json).mock.calls)).not.toContain('COMPLETED_WITH_EXCEPTIONS');expect(mocks.update).not.toHaveBeenCalled();});
});
