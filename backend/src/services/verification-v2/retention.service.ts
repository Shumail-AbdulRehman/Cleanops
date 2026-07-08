import { deactivateWorkforce } from '../workforceLifecycle.service.js';
import {prisma} from '../../prisma/prisma.js';
import {ApiError} from '../../utils/ApiError.js';
import {writeAuditLog} from '../auditLog.service.js';
import {requireOperationalRole,requireLocationAccess,requireActiveActor,type VerificationActor} from './authorization.service.js';
import type {VerificationTransaction} from './transaction.js';
import {deleteCleaningSchedule} from '../scheduleDeletion.service.js';
export type RetainedEntity='location'|'staff'|'manager'|'taskTemplate';
export async function assertDeletionAllowed(tx:VerificationTransaction,entity:RetainedEntity,id:number) {
 let retained=false;
 if(entity==='location')retained=await tx.area.count({where:{locationId:id}})>0||await tx.evidenceAsset.count({where:{locationId:id}})>0||await tx.verificationException.count({where:{locationId:id}})>0;
 if(entity==='taskTemplate')retained=await tx.taskTemplateItem.count({where:{templateId:id}})>0||await tx.taskInstance.count({where:{templateId:id,verificationVersion:2}})>0;
 if(entity==='staff')retained=await tx.captureSession.count({where:{staffId:id}})>0||await tx.verificationAttempt.count({where:{staffId:id}})>0||await tx.taskAssignment.count({where:{staffId:id,taskInstance:{verificationVersion:2}}})>0;
 if(entity==='manager')retained=await tx.verificationDecision.count({where:{actorManagerId:id}})>0||await tx.areaStandardPhoto.count({where:{createdByManagerId:id}})>0||await tx.exceptionReadReceipt.count({where:{managerId:id}})>0;
 if(retained)throw new ApiError(409,'Verification history is retained. Archive or deactivate this record instead.',[{code:'EVIDENCE_RETAINED',archivePath:`/${entity==='taskTemplate'?'task-template':entity}/${id}/archive`}]);
}
export async function archiveRetainedEntity(entity:RetainedEntity,id:number,actor:VerificationActor, raw?:unknown) {
 if(entity==='staff'||entity==='manager')return deactivateWorkforce(actor,entity,id,raw);
 requireOperationalRole(actor);await requireActiveActor(actor);
 if(entity==='taskTemplate')return deleteCleaningSchedule(id,actor);
 if(entity==='location'&&actor.role!=='ADMIN')throw new ApiError(403,'Admin account required');
 return prisma.$transaction(async tx=>{
  let locationId:number|null=null;
  if(entity==='location'){const row=await tx.location.findFirst({where:{id,companyId:actor.companyId}});if(!row)throw new ApiError(404,'Location not found');locationId=row.id;}
  if(locationId!==null)await requireLocationAccess(actor,locationId);
  if(entity==='location')await tx.location.update({where:{id},data:{isActive:false}});
  if(entity==='location')await tx.captureSession.updateMany({where:{state:{in:['ACTIVE','PAUSED']},task:{locationId:id}},data:{state:'REVOKED',closedAt:new Date(),rowVersion:{increment:1}}});
  await writeAuditLog({companyId:actor.companyId,actorType:actor.role,actorId:actor.id,entityType:entity,entityId:id,action:'ARCHIVE',reason:'Preserve inventory verification history'},tx);
  return {id,isActive:false,evidenceRetained:true};
 });
}
