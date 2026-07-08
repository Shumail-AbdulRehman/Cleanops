import { formatInTimeZone } from 'date-fns-tz';
import { prisma } from '../prisma/prisma.js';
import { ApiError } from '../utils/ApiError.js';
import { getZonedDayRange } from '../utils/dateTime.js';
import { findOverlappingSchedule, fitsStaffShift, type ScheduleWindow } from '../utils/scheduleFit.js';
import { formatWeekdays, isDaySubset, readDayList, weekdayOfLocalDay, type WeekdayList } from '../utils/workDays.js';
import { writeAuditLog } from './auditLog.service.js';
import { requireLocationAccess, requireOperationalRole, type VerificationActor } from './verification-v2/authorization.service.js';
import type { VerificationTransaction } from './verification-v2/transaction.js';

type TemplateDays = {
  recurringType?: string | null;
  effectiveDate: Date;
  repeatDays?: WeekdayList;
};

export function getTemplateWeekdays(template: TemplateDays, timeZone: string) {
  if (template.recurringType === 'ONCE') {
    const { start } = getZonedDayRange(template.effectiveDate, timeZone);
    return [weekdayOfLocalDay(start, timeZone)];
  }
  return readDayList(template.recurringType === 'DAILY' ? template.repeatDays : undefined);
}

export function assertTemplateFitsWorkDays(
  template: TemplateDays,
  staff: { name: string; workDays?: WeekdayList },
  timeZone: string,
) {
  if (template.recurringType !== 'DAILY' && template.recurringType !== 'ONCE') return;
  if (!isDaySubset(getTemplateWeekdays(template, timeZone), staff.workDays)) {
    throw new ApiError(422, `${staff.name} works ${formatWeekdays(staff.workDays)}. Choose days within those, or use automatic assignment.`, [
      { code: 'SCHEDULE_OUTSIDE_WORK_DAYS', field: 'repeatDays' },
    ]);
  }
}

type TemplateSchedule = Omit<ScheduleWindow, 'recurringType'> & {
  recurringType?: ScheduleWindow['recurringType'] | null;
};

// Match scheduleOccursOnDay: only explicit ONCE schedules are limited to one day.
function withScheduleRecurrence<T extends TemplateSchedule>({ recurringType, ...schedule }: T) {
  return { ...schedule, recurringType: recurringType ?? 'DAILY' };
}

export async function assertFixedWorkerScheduleFits(
  tx: Pick<VerificationTransaction, 'taskTemplate'>,
  schedule: TemplateSchedule & { locationId: number },
  staff: { id: number; name: string; shiftStart: Date | null; shiftEnd: Date | null },
  timeZone: string,
  excludeTemplateId?: number,
) {
  if (!fitsStaffShift(schedule, staff, timeZone)) {
    const start = staff.shiftStart ? formatInTimeZone(staff.shiftStart, timeZone, 'HH:mm') : '—';
    const end = staff.shiftEnd ? formatInTimeZone(staff.shiftEnd, timeZone, 'HH:mm') : '—';
    throw new ApiError(422, `This time falls outside ${staff.name}'s shift (${start}–${end}). Choose a time inside the shift or update the shift.`, [
      { code: 'SHIFT_MISMATCH', field: 'shiftStart' },
    ]);
  }

  const others = await tx.taskTemplate.findMany({
    where: {
      id: excludeTemplateId === undefined ? undefined : { not: excludeTemplateId },
      staffId: staff.id,
      isActive: true,
      locationId: schedule.locationId,
    },
    select: { title: true, shiftStart: true, shiftEnd: true, recurringType: true, effectiveDate: true, recurringEndDate: true, repeatDays: true },
  });
  const conflict = findOverlappingSchedule(
    withScheduleRecurrence(schedule),
    others.map(withScheduleRecurrence),
    timeZone,
  );
  if (conflict) {
    throw new ApiError(409, `${staff.name} already has an overlapping schedule: ${conflict.title}. Choose a different time or worker.`, [
      { code: 'WORKER_OVERLAP', field: 'staffId' },
    ]);
  }
}

/** Template and its eligible existing instances receive one atomic assignment. */
export async function assignTemplateStaff(actor: VerificationActor, templateId: number, staffId: number, now=new Date()) {
  requireOperationalRole(actor);
  if(!Number.isSafeInteger(templateId)||templateId<1||!Number.isSafeInteger(staffId)||staffId<1)throw new ApiError(400,'Invalid template or staff id');
  return prisma.$transaction(async tx=>{
    const initial=await tx.taskTemplate.findFirst({where:{id:templateId,location:{companyId:actor.companyId}},select:{locationId:true,areaId:true}});
    if(!initial)throw new ApiError(404,'Task template not found in your company');
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(872120, ${initial.locationId})::text`;
    if(initial.areaId)await tx.$queryRaw`SELECT id FROM "Area" WHERE id=${initial.areaId} FOR UPDATE`;
    await tx.$queryRaw`SELECT id FROM "TaskTemplate" WHERE id=${templateId} FOR UPDATE`;
    const template=await tx.taskTemplate.findUniqueOrThrow({where:{id:templateId},include:{location:true}});
    if(template.locationId!==initial.locationId||template.areaId!==initial.areaId)throw new ApiError(409,'Schedule changed. Refresh and assign again.');
    const location=await requireLocationAccess(actor,template.locationId,tx);
    if(!template.isActive||!location.isActive)throw new ApiError(400,'Task template or location is inactive');
    const staff=await tx.staff.findFirst({where:{id:staffId,companyId:actor.companyId,isActive:true,locationId:location.id}});
    if(!staff)throw new ApiError(404,'Choose active staff at this location in your company');
    assertTemplateFitsWorkDays(template, staff, location.timezone);
    await assertFixedWorkerScheduleFits(tx, template, staff, location.timezone, templateId);
    const dayStart=getZonedDayRange(now,location.timezone).start;
    const locked=await tx.$queryRaw<{id:number}[]>`SELECT id FROM "TaskInstance" WHERE "templateId"=${templateId} AND "locationId"=${location.id} AND "isActive"=true AND status='PENDING' AND "startedAt" IS NULL AND date>=${dayStart} AND "shiftEnd">${now} ORDER BY id FOR UPDATE`;
    const candidates=await tx.taskInstance.findMany({where:{id:{in:locked.map(t=>t.id)},status:'PENDING',startedAt:null,completedAt:null,hasManualOverride:false},include:{assignments:{where:{isCurrent:true}},_count:{select:{captureSessions:true,evidenceAssets:true,completionAttempts:true,areaSubmissions:true}}}});
    const eligible=candidates.filter(task=>!Object.values(task._count).some(Boolean)&&task.assignments.every(a=>a.status==='ASSIGNED'&&!a.startedAt));
    const changed:number[]=[];
    for(const task of eligible){
      if(task.staffId===staffId&&task.assignments.length===1&&task.assignments[0]!.staffId===staffId)continue;
      await tx.taskAssignment.updateMany({where:{taskInstanceId:task.id,isCurrent:true},data:{isCurrent:false,status:'REASSIGNED',reason:'TEMPLATE_STAFF_CHANGED',failedAt:now}});
      await tx.taskInstance.update({where:{id:task.id},data:{staffId}});
      const assignment=await tx.taskAssignment.create({data:{taskInstanceId:task.id,staffId,status:'ASSIGNED',isCurrent:true,assignedAt:now,reason:'MANAGER_TEMPLATE_ASSIGNMENT'}});
      await writeAuditLog({companyId:actor.companyId,actorType:actor.role,actorId:actor.id,entityType:'TASK_INSTANCE',entityId:task.id,action:'TEMPLATE_STAFF_ASSIGNMENT_SYNC',reason:'Manager selected staff for the schedule',oldValue:{staffId:task.staffId,assignmentIds:task.assignments.map(a=>a.id)},newValue:{staffId,assignmentId:assignment.id,templateId}},tx);
      changed.push(task.id);
    }
    const updated=await tx.taskTemplate.update({where:{id:templateId},data:{staffId}});
    await writeAuditLog({companyId:actor.companyId,actorType:actor.role,actorId:actor.id,entityType:'TASK_TEMPLATE',entityId:templateId,action:'ASSIGN_STAFF',oldValue:{staffId:template.staffId},newValue:{staffId,updatedTaskIds:changed,preservedTaskIds:candidates.filter(t=>!eligible.includes(t)).map(t=>t.id)}},tx);
    return {...updated,assignmentSync:{updatedTaskIds:changed,preservedTaskIds:candidates.filter(t=>!eligible.includes(t)).map(t=>t.id)}};
  },{maxWait:10000,timeout:30000});
}
