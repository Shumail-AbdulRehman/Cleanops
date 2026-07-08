import { beforeEach, describe, expect, it, vi } from 'vitest';
const m=vi.hoisted(()=>({transaction:vi.fn(),access:vi.fn(),audit:vi.fn(),tx:{$queryRaw:vi.fn(),taskTemplate:{findFirst:vi.fn(),findUniqueOrThrow:vi.fn(),findMany:vi.fn(),update:vi.fn()},staff:{findFirst:vi.fn()},taskInstance:{findMany:vi.fn(),update:vi.fn()},taskAssignment:{updateMany:vi.fn(),create:vi.fn()}}}));
vi.mock('../prisma/prisma.js',()=>({prisma:{$transaction:m.transaction}}));
vi.mock('./auditLog.service.js',()=>({writeAuditLog:m.audit}));
vi.mock('./verification-v2/authorization.service.js',()=>({requireLocationAccess:m.access,requireOperationalRole:(actor:{role:string})=>{if(actor.role==='STAFF')throw new Error('Manager required');}}));
import { assignTemplateStaff } from './templateAssignment.service.js';
const actor={id:1,companyId:1,role:'ADMIN' as const};
const now=new Date('2026-10-08T06:00:00Z');
const template={id:178,locationId:28,areaId:6,isActive:true,staffId:null,shiftStart:now,shiftEnd:new Date('2026-10-08T07:00:00Z'),location:{companyId:1},recurringType:'DAILY',effectiveDate:now,repeatDays:['MON']};
const worker={id:65,name:'Ayesha',shiftStart:new Date('2026-10-08T04:00:00Z'),shiftEnd:new Date('2026-10-08T12:00:00Z')};
const otherSchedule={...template,id:179,title:'Other'};
const task=(overrides={})=>({id:2,staffId:61,assignments:[{id:3,staffId:61,status:'ASSIGNED',isCurrent:true}],_count:{captureSessions:0,evidenceAssets:0,completionAttempts:0,areaSubmissions:0},...overrides});
describe('template assignment synchronizes existing task authority',()=>{
 beforeEach(()=>{
  vi.resetAllMocks();m.transaction.mockImplementation(work=>work(m.tx));m.tx.$queryRaw.mockResolvedValue([{id:2}]);
  m.tx.taskTemplate.findFirst.mockResolvedValue({locationId:28,areaId:6});m.tx.taskTemplate.findUniqueOrThrow.mockResolvedValue(template);
  m.access.mockResolvedValue({id:28,isActive:true,timezone:'Asia/Karachi'});m.tx.staff.findFirst.mockResolvedValue(worker);
  m.tx.taskTemplate.findMany.mockResolvedValue([]);m.tx.taskTemplate.update.mockResolvedValue({...template,staffId:65});
  m.tx.taskInstance.findMany.mockResolvedValue([task()]);m.tx.taskAssignment.create.mockResolvedValue({id:4});
 });
 it('moves an unstarted automatic assignment and audits the change in the same transaction',async()=>{
  const result=await assignTemplateStaff(actor,178,65,now);
  expect(result.assignmentSync.updatedTaskIds).toEqual([2]);
  expect(m.tx.taskAssignment.updateMany).toHaveBeenCalledWith(expect.objectContaining({data:expect.objectContaining({isCurrent:false,status:'REASSIGNED'})}));
  expect(m.tx.taskInstance.update).toHaveBeenCalledWith({where:{id:2},data:{staffId:65}});
  expect(m.tx.taskAssignment.create).toHaveBeenCalledWith({data:expect.objectContaining({staffId:65,isCurrent:true,assignedAt:now})});
  expect(m.audit).toHaveBeenCalledWith(expect.objectContaining({action:'TEMPLATE_STAFF_ASSIGNMENT_SYNC'}),m.tx);
 });
 it.each(['captureSessions','evidenceAssets','completionAttempts','areaSubmissions'])('preserves tasks with %s',async key=>{
  m.tx.taskInstance.findMany.mockResolvedValue([task({_count:{[key]:1}})]);
  const result=await assignTemplateStaff(actor,178,65,now);
  expect(result.assignmentSync.preservedTaskIds).toEqual([2]);expect(m.tx.taskInstance.update).not.toHaveBeenCalled();expect(m.tx.taskAssignment.create).not.toHaveBeenCalled();
 });
 it('preserves started assignment authority even when the task row says pending',async()=>{
  m.tx.taskInstance.findMany.mockResolvedValue([task({assignments:[{id:3,staffId:61,status:'STARTED',startedAt:now}]})]);
  await assignTemplateStaff(actor,178,65,now);expect(m.tx.taskInstance.update).not.toHaveBeenCalled();
 });
 it('retries are idempotent when the selected worker already owns the current task',async()=>{
  m.tx.taskInstance.findMany.mockResolvedValue([task({staffId:65,assignments:[{id:4,staffId:65,status:'ASSIGNED'}]})]);
  expect((await assignTemplateStaff(actor,178,65,now)).assignmentSync.updatedTaskIds).toEqual([]);expect(m.tx.taskAssignment.create).not.toHaveBeenCalled();
 });
 it('rejects out-of-scope staff before any schedule or task changes',async()=>{
  m.tx.staff.findFirst.mockResolvedValue(null);await expect(assignTemplateStaff(actor,178,65,now)).rejects.toMatchObject({statusCode:404});
  expect(m.tx.taskTemplate.update).not.toHaveBeenCalled();expect(m.tx.taskInstance.update).not.toHaveBeenCalled();
 });
 it('rejects assigning a Monday-only worker to a Monday and Tuesday schedule', async () => {
  m.tx.taskTemplate.findUniqueOrThrow.mockResolvedValue({
   ...template, recurringType: 'DAILY', repeatDays: ['MON', 'TUE'],
  });
  m.tx.staff.findFirst.mockResolvedValue({ ...worker, workDays: ['MON'] });
  await expect(assignTemplateStaff(actor, 178, 65, now)).rejects.toMatchObject({
   statusCode: 422,
   message: 'Ayesha works Mon. Choose days within those, or use automatic assignment.',
   errors: [{ code: 'SCHEDULE_OUTSIDE_WORK_DAYS', field: 'repeatDays' }],
  });
  expect(m.tx.taskTemplate.update).not.toHaveBeenCalled();
  expect(m.tx.taskInstance.findMany).not.toHaveBeenCalled();
  expect(m.audit).not.toHaveBeenCalled();
 });
 it('rejects an overlap on shared repeat days without reassigning existing work', async () => {
  m.tx.taskTemplate.findMany.mockResolvedValue([otherSchedule]);
  await expect(assignTemplateStaff(actor, 178, 65, now)).rejects.toMatchObject({
   statusCode: 409,
   message: 'Ayesha already has an overlapping schedule: Other. Choose a different time or worker.',
   errors: [{ code: 'WORKER_OVERLAP', field: 'staffId' }],
  });
  expect(m.tx.taskTemplate.update).not.toHaveBeenCalled();
  expect(m.tx.taskInstance.update).not.toHaveBeenCalled();
 });
 it('checks a schedule with omitted recurrence after its effective date', async () => {
  m.tx.taskTemplate.findMany.mockResolvedValue([{
   ...otherSchedule, recurringType: null, effectiveDate: new Date('2026-09-01T00:00:00Z'), repeatDays: undefined,
  }]);
  await expect(assignTemplateStaff(actor, 178, 65, now)).rejects.toMatchObject({
   statusCode: 409,
   errors: [{ code: 'WORKER_OVERLAP', field: 'staffId' }],
  });
  expect(m.tx.taskTemplate.update).not.toHaveBeenCalled();
 });
 it.each([
  { repeatDays: ['TUE'] },
  { effectiveDate: new Date('2026-09-01T00:00:00Z'), recurringEndDate: new Date('2026-09-30T00:00:00Z') },
 ])('allows assignment at the same clock time when there is no shared schedule date (%j)', async change => {
  m.tx.taskTemplate.findMany.mockResolvedValue([{ ...otherSchedule, ...change }]);
  await assignTemplateStaff(actor, 178, 65, now);
  expect(m.tx.taskTemplate.update).toHaveBeenCalledWith({ where: { id: 178 }, data: { staffId: 65 } });
 });
 it('uses the shared shift mismatch code before reassigning work', async () => {
  m.tx.taskTemplate.findUniqueOrThrow.mockResolvedValue({
   ...template,
   shiftStart: new Date('2026-10-08T11:00:00Z'),
   shiftEnd: new Date('2026-10-09T05:00:00Z'),
  });
  await expect(assignTemplateStaff(actor, 178, 65, now)).rejects.toMatchObject({
   statusCode: 422,
   message: "This time falls outside Ayesha's shift (09:00–17:00). Choose a time inside the shift or update the shift.",
   errors: [{ code: 'SHIFT_MISMATCH', field: 'shiftStart' }],
  });
  expect(m.tx.taskTemplate.update).not.toHaveBeenCalled();
 });
});
