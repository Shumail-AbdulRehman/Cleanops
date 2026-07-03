import { inventorySelectionSchema } from "../validations/area.validation.js";
import { configureTemplateInventory, validateInventorySelection, createTodaysTaskForNewTemplate } from "../services/verification-v2/inventorySnapshot.service.js";
import { Request, Response } from "express";
import { createTaskMultipartSchema, editTaskSchema } from "../validations/taskTemplate.validation.js";
import { prisma } from "../prisma/prisma.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { ApiError } from "../utils/ApiError.js";
import { permanentlyDelete } from "../services/deletion.service.js";
import { assertFixedWorkerScheduleFits, assertTemplateFitsWorkDays, getTemplateWeekdays } from "../services/templateAssignment.service.js";
import { companyHasFeature } from "../services/subscription.service.js";
import {requireLocationAccess} from '../services/verification-v2/authorization.service.js';
import {writeAuditLog} from '../services/auditLog.service.js';
import { DEFAULT_TIME_ZONE, getZonedDayRange } from "../utils/dateTime.js";
import { fitsStaffShift, getClockRanges } from "../utils/scheduleFit.js";
import { assertLocationAccess } from "../utils/scope.js";
import { isAllSevenDays, readDayList, type WeekdayList } from "../utils/workDays.js";
import { Prisma } from "@prisma/client";
import type { ZodError } from "zod";
import type { VerificationTransaction } from "../services/verification-v2/transaction.js";

// Hosted database round trips and lock waits can exceed Prisma's 5s default.
// Keep the longer budget local to inventory schedule saves.
const INVENTORY_TRANSACTION_OPTIONS = { maxWait: 10_000, timeout: 30_000 };

function scheduleSaveError(error: unknown): never {
  // Only these transaction failures confirm that no save was committed.
  // Connection/commit uncertainty must retain the existing unknown-save handling.
  if (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2028" &&
    /(?:query|commit) cannot be executed on an expired transaction|Unable to start a transaction in the given time/i.test(error.message)
  ) {
    throw new ApiError(408, "The schedule was not saved because the database timed out. Please retry; your draft is preserved.", [{ code: "SCHEDULE_SAVE_TIMEOUT" }]);
  }
  throw error;
}

function assertValidRepeatDays(error: ZodError) {
  const issue = error.issues.find(issue => issue.code === "custom" && issue.params?.code === "INVALID_REPEAT_DAYS");
  if (issue) {
    throw new ApiError(400, issue.message, [{ code: "INVALID_REPEAT_DAYS", field: "repeatDays" }]);
  }
}

async function assertAutomaticAssignmentAvailable(companyId: number) {
  if (!(await companyHasFeature(companyId, "automaticAssignment"))) {
    throw new ApiError(422, "Your plan does not assign staff automatically. Choose a worker for this schedule.", [
      { code: "WORKER_REQUIRED", field: "staffId" },
    ]);
  }
}

const timeRangesOverlap = (firstStart: Date, firstEnd: Date, secondStart: Date, secondEnd: Date, timeZone: string) => {
  const firstRanges = getClockRanges(firstStart, firstEnd, timeZone);
  const secondRanges = getClockRanges(secondStart, secondEnd, timeZone);

  return firstRanges.some(([start, end]) =>
    secondRanges.some(([otherStart, otherEnd]) => start < otherEnd && otherStart < end)
  );
};

const getZonedDayMs = (date: Date, timeZone: string) =>
  getZonedDayRange(date, timeZone).start.getTime();

const recurrenceRange = (template: {
  recurringType?: string | null;
  effectiveDate: Date;
  recurringEndDate?: Date | null;
}, timeZone: string) => {
  const start = getZonedDayMs(template.effectiveDate, timeZone);

  if (template.recurringType === "ONCE") {
    return { start, end: start };
  }

  if (template.recurringType === "DAILY") {
    return {
      start,
      end: template.recurringEndDate ? getZonedDayMs(template.recurringEndDate, timeZone) : null,
    };
  }

  return null;
};

const recurrenceRangesOverlap = (
  first: {
    recurringType?: string | null;
    effectiveDate: Date;
    recurringEndDate?: Date | null;
  },
  second: {
    recurringType?: string | null;
    effectiveDate: Date;
    recurringEndDate?: Date | null;
  },
  timeZone: string
) => {
  const firstRange = recurrenceRange(first, timeZone);
  const secondRange = recurrenceRange(second, timeZone);

  if (!firstRange || !secondRange) return false;

  const firstEnd = firstRange.end ?? Number.POSITIVE_INFINITY;
  const secondEnd = secondRange.end ?? Number.POSITIVE_INFINITY;

  return firstRange.start <= secondEnd && secondRange.start <= firstEnd;
};

const assertLocationHasCapacityForTaskTemplate = async ({
  locationId,
  shiftStart,
  shiftEnd,
  recurringType,
  effectiveDate,
  recurringEndDate,
  repeatDays,
  excludeTemplateId,
}: {
  locationId: number;
  shiftStart: Date;
  shiftEnd: Date;
  recurringType?: string | null;
  effectiveDate: Date;
  recurringEndDate?: Date | null;
  repeatDays?: WeekdayList;
  excludeTemplateId?: number;
}, db: Pick<VerificationTransaction, "location" | "staff" | "taskTemplate"> = prisma) => {
  const [location, staffMembers, existingTemplates] = await Promise.all([
    db.location.findUnique({
      where: { id: locationId },
      select: { timezone: true },
    }),
    db.staff.findMany({
      where: {
        locationId,
        isActive: true,
        shiftStart: { not: null },
        shiftEnd: { not: null },
      },
      select: {
        id: true,
        shiftStart: true,
        shiftEnd: true,
        workDays: true,
      },
    }),
    db.taskTemplate.findMany({
      where: {
        locationId,
        isActive: true,
        id: excludeTemplateId ? { not: excludeTemplateId } : undefined,
      },
      select: {
        id: true,
        title: true,
        shiftStart: true,
        shiftEnd: true,
        recurringType: true,
        effectiveDate: true,
        recurringEndDate: true,
        repeatDays: true,
      },
    }),
  ]);

  const timeZone = location?.timezone ?? DEFAULT_TIME_ZONE;

  const coveringStaffDays = staffMembers.filter((staff) =>
    fitsStaffShift({ shiftStart, shiftEnd }, staff, timeZone)
  ).map(staff => readDayList(staff.workDays));

  const schedule = { recurringType, effectiveDate, recurringEndDate, repeatDays };
  const overlappingTemplates = existingTemplates.filter((template) =>
    recurrenceRangesOverlap(schedule, template, timeZone) &&
    timeRangesOverlap(shiftStart, shiftEnd, template.shiftStart, template.shiftEnd, timeZone)
  );

  const assertCapacity = (overlappingTemplateCount: number, availableStaffCount: number) => {
    const requiredStaffCount = overlappingTemplateCount + 1;
    if (requiredStaffCount > availableStaffCount) {
      throw new ApiError(
        400,
        `Cannot create this task schedule. ${requiredStaffCount} task(s) would overlap at this location, but only ${availableStaffCount} active staff member(s) have shifts covering this time. Add staff, adjust shifts, or choose a different task time.`
      );
    }
  };

  // Preserve the legacy overlap count for unrestricted data, including one-off schedules.
  if (isAllSevenDays(readDayList(repeatDays)) && coveringStaffDays.every(isAllSevenDays) &&
      overlappingTemplates.every(template => isAllSevenDays(readDayList(template.repeatDays)))) {
    assertCapacity(overlappingTemplates.length, coveringStaffDays.length);
    return;
  }

  const overlappingTemplateDays = overlappingTemplates.map(template => getTemplateWeekdays(template, timeZone));
  for (const day of getTemplateWeekdays(schedule, timeZone)) {
    const availableStaffCount = coveringStaffDays.filter(days => days.includes(day)).length;
    const overlappingTemplateCount = overlappingTemplateDays.filter(days => days.includes(day)).length;
    assertCapacity(overlappingTemplateCount, availableStaffCount);
  }
};

export const createTaskTemplate = async (req: Request, res: Response) => {
  const result=createTaskMultipartSchema.safeParse(req.body);
  if (!result.success) assertValidRepeatDays(result.error);
  if (req.body.areaId === undefined) throw new ApiError(422,"New schedules require an active room and its inventory. Select a room to use guided verification.",[{code:'INVENTORY_VERIFICATION_REQUIRED',field:'areaId'}]);
  const selection=inventorySelectionSchema.safeParse(req.body);
  if(!result.success||!selection.success)throw new ApiError(400,"A single area and valid inventory selection are required",[...(!result.success?result.error.issues:[]),...(!selection.success?selection.error.issues:[])]);
  if(result.data.recurringEndDate&&result.data.recurringEndDate<result.data.effectiveDate)throw new ApiError(400,'Recurrence end must follow the effective date');
  const actor = req.user!;
  const staffId = req.body.staffId === "" || req.body.staffId === null ? undefined : result.data.staffId;
  const schedule = {
    ...result.data,
    staffId,
    repeatDays: readDayList(result.data.recurringType === "ONCE" ? undefined : result.data.repeatDays),
  };
  const location=await requireLocationAccess(actor,result.data.locationId);
  if(!location.isActive)throw new ApiError(404,'Location is inactive');
  let sourceLegacyTemplateId:number|undefined;
  if(req.body.sourceLegacyTemplateId!==undefined){sourceLegacyTemplateId=Number(req.body.sourceLegacyTemplateId);if(!Number.isSafeInteger(sourceLegacyTemplateId)||!await prisma.taskTemplate.findFirst({where:{id:sourceLegacyTemplateId,locationId:location.id,verificationVersion:1,location:{companyId:req.user!.companyId}}}))throw new ApiError(422,'Legacy source must belong to this location');}
  const template=await prisma.$transaction(async tx=>{
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(872120, ${location.id})::text`;
    if (staffId === undefined) {
      await assertAutomaticAssignmentAvailable(actor.companyId);
    } else {
      const staff = await tx.staff.findFirst({
        where: { id: staffId, companyId: actor.companyId, locationId: location.id, isActive: true },
      });
      if (!staff) throw new ApiError(422, "Choose active staff at this location");
      assertTemplateFitsWorkDays(schedule, staff, location.timezone);
      await assertFixedWorkerScheduleFits(tx, schedule, staff, location.timezone);
    }
    await validateInventorySelection(tx,location.id,selection.data);
    await assertLocationHasCapacityForTaskTemplate(schedule,tx);
    const created=await tx.taskTemplate.create({data:{...schedule,sourceLegacyTemplateId,areaId:selection.data.areaId,verificationVersion:2}});
    await configureTemplateInventory(tx,created.id,location.id,selection.data);
    await writeAuditLog({companyId:req.user!.companyId,actorType:req.user!.role,actorId:req.user!.id,entityType:'TASK_TEMPLATE',entityId:created.id,action:'CONFIGURE_INVENTORY',newValue:selection.data},tx);
    await createTodaysTaskForNewTemplate(tx,{...created,location});
    return tx.taskTemplate.findUniqueOrThrow({where:{id:created.id},include:{inventoryItems:true,area:true}});
  },INVENTORY_TRANSACTION_OPTIONS).catch(scheduleSaveError);
  res.status(201).json(new ApiResponse(201,template,'Task template created'));
};

export const mapTemplateInventory = async (req: Request, res: Response) => {
  const id=Number(req.params.id); const input=inventorySelectionSchema.safeParse(req.body);
  if(!input.success)throw new ApiError(400,"Invalid inventory mapping",input.error.issues);
  const template=await prisma.taskTemplate.findUnique({where:{id},include:{location:true}});
  if(!template||template.location.companyId!==req.user!.companyId)throw new ApiError(404,"Template not found");
  assertLocationAccess(req.user!,template.locationId);
  const updated=await prisma.$transaction(async tx=>{
    await configureTemplateInventory(tx,id,template.locationId,input.data);
    await tx.verificationException.updateMany({where:{dedupeKey:`setup:template:${id}`},data:{state:'RESOLVED',resolvedAt:new Date()}});
    return tx.taskTemplate.findUniqueOrThrow({where:{id}});
  },INVENTORY_TRANSACTION_OPTIONS).catch(scheduleSaveError);
  res.json(new ApiResponse(200,updated,"Future tasks use this area inventory. Existing tasks are unchanged."));
};

export const editTaskTemplate = async (req: Request, res: Response) => {
  const taskTemplateId = Number(req.params.id);
  if (isNaN(taskTemplateId)) throw new ApiError(400, "Invalid task template id");

  const result = editTaskSchema.safeParse(req.body);

  if (!result.success) {
    assertValidRepeatDays(result.error);
    const errors = result.error.issues.map(e => ({
      field: e.path.join("."),
      message: e.message
    }));
    throw new ApiError(400, "Validation failed", errors);
  }
  const template = await prisma.taskTemplate.findUnique({
    where: { id: taskTemplateId },
    include: { location: true },
  });

  if (!template || template.location.companyId !== req.user!.companyId) {
    throw new ApiError(404, "Task template not found in your company");
  }

  assertLocationAccess(req.user!, template.locationId);

  if (!template.isActive) {
    throw new ApiError(400, "Task template is inactive");
  }

  let nextLocationTimeZone: string | null = null;

  if (result.data.locationId) {
    const location = await prisma.location.findUnique({
      where: { id: result.data.locationId }
    });

    if (!location || location.companyId !== req.user!.companyId || !location.isActive) {
      throw new ApiError(404, "New location not found in your company");
    }

    assertLocationAccess(req.user!, location.id);
    nextLocationTimeZone = location.timezone;
  }

  const nextLocationId = result.data.locationId ?? template.locationId;
  const updated = await prisma.$transaction(async tx=>{
    const locationIds = [...new Set([template.locationId, nextLocationId])].sort((a, b) => a - b);
    for (const locationId of locationIds) {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(872120, ${locationId})::text`;
    }

    const current = await tx.taskTemplate.findUnique({
      where: { id: taskTemplateId },
      include: { location: true, staff: true },
    });
    if (!current || current.locationId !== template.locationId) {
      throw new ApiError(409, "Schedule changed. Refresh and edit again.");
    }
    if (!current.isActive) throw new ApiError(400, "Task template is inactive");

    const { repeatDays, ...edit } = result.data;
    const recurringType = edit.recurringType ?? current.recurringType;
    const schedule = {
      locationId: nextLocationId,
      shiftStart: edit.shiftStart ?? current.shiftStart,
      shiftEnd: edit.shiftEnd ?? current.shiftEnd,
      recurringType,
      effectiveDate: edit.effectiveDate ?? current.effectiveDate,
      recurringEndDate: edit.recurringEndDate ?? current.recurringEndDate,
      repeatDays: readDayList(recurringType === "ONCE" ? undefined : repeatDays ?? current.repeatDays),
      excludeTemplateId: taskTemplateId,
    };
    const timeZone = nextLocationTimeZone ?? current.location.timezone;
    const assignedStaff = current.staff;

    if (assignedStaff) {
      if (assignedStaff.companyId !== req.user!.companyId || !assignedStaff.isActive) {
        throw new ApiError(400, "Assigned staff is no longer active for this company");
      }
      if (assignedStaff.locationId !== nextLocationId) {
        throw new ApiError(400, "Assigned staff must belong to the same location");
      }
      assertTemplateFitsWorkDays(schedule, assignedStaff, timeZone);
      if (
        schedule.locationId !== current.locationId ||
        edit.shiftStart !== undefined || edit.shiftEnd !== undefined ||
        edit.effectiveDate !== undefined || edit.recurringEndDate !== undefined ||
        edit.recurringType !== undefined || repeatDays !== undefined
      ) {
        await assertFixedWorkerScheduleFits(tx, schedule, assignedStaff, timeZone, taskTemplateId);
      }
    } else {
      await assertAutomaticAssignmentAvailable(req.user!.companyId);
    }

    await assertLocationHasCapacityForTaskTemplate(schedule, tx);
    const data = {
      ...edit,
      ...(recurringType === "ONCE" || repeatDays !== undefined ? { repeatDays: schedule.repeatDays } : {}),
    };
    if(req.body.areaId!==undefined) {
      const selection=inventorySelectionSchema.safeParse(req.body);
      if(!selection.success)throw new ApiError(400,"Invalid inventory selection",selection.error.issues);
      await validateInventorySelection(tx,nextLocationId,selection.data);
      await tx.$queryRaw`SELECT id FROM "TaskTemplate" WHERE id=${taskTemplateId} FOR UPDATE`;
      // Move the area and location together; old instances keep their immutable area.
      await tx.taskTemplateItem.deleteMany({where:{templateId:taskTemplateId}});
      await tx.taskTemplate.update({where:{id:taskTemplateId},data:{...data,areaId:selection.data.areaId}});
      await configureTemplateInventory(tx,taskTemplateId,nextLocationId,selection.data);
    } else {
      if(['inventorySelection','selectedItems','expectedInventoryVersion'].some(key=>req.body[key]!==undefined))throw new ApiError(400,'Inventory edits require areaId and the full versioned selection');
      if(current.verificationVersion===2 && nextLocationId!==current.locationId) throw new ApiError(422,"Choose an area at the new location");
      await tx.taskTemplate.update({where:{id:taskTemplateId},data});
    }
    return tx.taskTemplate.findUniqueOrThrow({where:{id:taskTemplateId},include:{inventoryItems:true,area:true}});
  },INVENTORY_TRANSACTION_OPTIONS).catch(scheduleSaveError);

  res.status(200).json(new ApiResponse(200, updated, "Task template updated successfully"));
};

export const deleteTaskTemplate = async (req: Request, res: Response) => {
  const result = await permanentlyDelete("taskTemplate", Number(req.params.id), req.user!);
  res.status(200).json(new ApiResponse(200, result, "Schedule and current/future tasks removed. Past task history is preserved."));
};

export const getTaskTemplate=async (req:Request, res: Response)=>
{
  const templateId=Number(req.params.id);

  if(isNaN(templateId)) throw new ApiError(400, "Invalid task template id");

  const taskTemplate=await prisma.taskTemplate.findFirst({
    where:{
      id:templateId,
      isActive:true
    },
    include:{
      location:true,
      area:{include:{items:true}},
      inventoryItems:true
    }
  });

  if(!taskTemplate) throw new ApiError(404,"task template not found");

  if(taskTemplate.location.companyId !== req.user?.companyId) throw new ApiError(404,"task tenplate not found in your company");

  assertLocationAccess(req.user!, taskTemplate.locationId);

  res.status(200).json(
    new ApiResponse(200,taskTemplate,"task template fetched successfully")
  );

};

export const getTaskTemplatesByLocation=async (req:Request, res: Response)=>
{
  const locationId=Number(req.params.locationId);

  if(isNaN(locationId)) throw new ApiError(400, "Invalid location id");

  assertLocationAccess(req.user!, locationId);

  const location=await prisma.location.findUnique({
    where:{id:locationId}
  });

  if(!location) throw new ApiError(404,"Location not found");

  if(location.companyId !== req.user?.companyId) throw new ApiError(404,"Location not found in your company");

  const taskTemplates=await prisma.taskTemplate.findMany({
    where:{
      locationId,
      isActive:true
    }, include:{area:true,inventoryItems:true}
  });

  res.status(200).json(
    new ApiResponse(200,taskTemplates,"Task templates fetched successfully")
  );  
};
