import {prisma} from '../prisma/prisma.js';
import {ApiError} from '../utils/ApiError.js';
import {writeAuditLog} from './auditLog.service.js';
import {requireOperationalRole,requireAreaAccess,requireLocationAccess,type VerificationActor} from './verification-v2/authorization.service.js';
import {expandCounts} from './verification-v2/inventoryPresets.js';
import type {VerificationTransaction} from './verification-v2/transaction.js';
import {areaCreateSchema,itemEditSchema,inventoryCountsSchema} from '../validations/area.validation.js';
import type {z} from 'zod';
export async function createArea(actor:VerificationActor,locationId:number,input:z.input<typeof areaCreateSchema>) {
 requireOperationalRole(actor);const data=areaCreateSchema.parse(input);
 const location=await requireLocationAccess(actor,locationId);
 if(!location.isActive)throw new ApiError(409,'Location is inactive');
 return prisma.$transaction(async tx=>{
  const area=await tx.area.create({data:{locationId,name:data.name,roomType:data.roomType,layoutInstructions:data.layoutInstructions,status:data.counts.some(c=>c.count>0)?'ACTIVE':'DRAFT',items:{create:expandCounts(data.counts)}}});
  await writeAuditLog({companyId:actor.companyId,actorType:actor.role,actorId:actor.id,entityType:'AREA',entityId:area.id,action:'CREATE'},tx);return area;
 });
}
export async function areaDetail(actor:VerificationActor,id:number) {
 requireOperationalRole(actor);await requireAreaAccess(actor,id);
 const area=await prisma.area.findUniqueOrThrow({where:{id},include:{items:{orderBy:[{sequence:'asc'},{id:'asc'}]},templates:{where:{isActive:true},include:{inventoryItems:true}},standards:{include:{media:{select:{privacyState:true}}}}}});
 return {...area,taskTemplates:area.templates,affectedTemplates:area.templates,standards:area.standards.map(({media,...standard})=>({...standard,privacyState:media.privacyState}))};
}
export async function mutateArea<T>(actor:VerificationActor,id:number,expected:number,operation:(tx:VerificationTransaction)=>Promise<T>,action:string) {
 requireOperationalRole(actor);await requireAreaAccess(actor,id);
 if(!Number.isSafeInteger(expected)||expected<1)throw new ApiError(400,'Inventory version is required');
 return prisma.$transaction(async tx=>{
  const locked=await tx.area.updateMany({where:{id,inventoryVersion:expected,status:{not:'ARCHIVED'}},data:{inventoryVersion:{increment:1}}});
  if(!locked.count)throw new ApiError(409,'Inventory changed or area archived. Refresh before saving.');
  const result=await operation(tx);
  await writeAuditLog({companyId:actor.companyId,actorType:actor.role,actorId:actor.id,entityType:'AREA',entityId:id,action,oldValue:{inventoryVersion:expected},newValue:{inventoryVersion:expected+1}},tx);
  return result;
 });
}
export async function bulkItems(actor:VerificationActor,id:number,expected:number,counts:z.input<typeof inventoryCountsSchema>) {
 const input=inventoryCountsSchema.parse(counts);
 return mutateArea(actor,id,expected,async tx=>{
  // Include retired rows in numbering: replacement fixtures always get fresh codes.
  const existing=await tx.areaItem.findMany({where:{areaId:id}});const added=expandCounts(input,existing);
  if(existing.filter(i=>i.status!=='RETIRED').length+added.length>200)throw new ApiError(422,'An area supports at most 200 active fixtures');
  if(added.length)await tx.areaItem.createMany({data:added.map(i=>({...i,areaId:id}))});
  return {added:added.length,inventoryVersion:expected+1,affectedTemplates:await tx.taskTemplate.findMany({where:{areaId:id,isActive:true,inventorySelection:'ALL'},select:{id:true,title:true}})};
 },'ADD_INVENTORY');
}
export async function updateItem(actor:VerificationActor,id:number,itemId:number,input:z.input<typeof itemEditSchema>) {
 const {expectedInventoryVersion,...data}=itemEditSchema.parse(input);
 return mutateArea(actor,id,expectedInventoryVersion,async tx=>{
  const item=await tx.areaItem.findFirst({where:{id:itemId,areaId:id}});if(!item)throw new ApiError(404,'Fixture not found');
  if(item.status==='RETIRED')throw new ApiError(409,'Retired fixture identities cannot be reused');
  const next={...item,...data};
  if(next.identificationMode==='EXISTING_NUMBER'&&!next.existingNumber)throw new ApiError(422,'Enter the existing fixture number');
  const updated=await tx.areaItem.update({where:{id:itemId},data});
  const impacted=await tx.taskTemplate.findMany({where:{areaId:id,isActive:true,OR:[{inventorySelection:'ALL'},{inventoryItems:{some:{areaItemId:itemId}}}]},select:{id:true,title:true}});
  if(data.status&&data.status!==item.status&&data.status!=='ACTIVE')await tx.taskTemplate.updateMany({where:{id:{in:impacted.map(t=>t.id)}},data:{setupStatus:'NEEDS_REVIEW'}});
  return {item:updated,inventoryVersion:expectedInventoryVersion+1,affectedTemplates:impacted};
 },'UPDATE_INVENTORY');
}
