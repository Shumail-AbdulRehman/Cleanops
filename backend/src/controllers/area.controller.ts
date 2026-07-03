import {randomUUID} from 'node:crypto';
import {Request,Response} from 'express';
import {z} from 'zod';
import {prisma} from '../prisma/prisma.js';
import {ApiResponse} from '../utils/ApiResponse.js';
import {ApiError} from '../utils/ApiError.js';
import {areaCreateSchema,areaEditSchema,itemEditSchema,inventoryCountsSchema} from '../validations/area.validation.js';
import {createArea,areaDetail,mutateArea,bulkItems,updateItem} from '../services/area.service.js';
import {requireAreaAccess,requireLocationAccess} from '../services/verification-v2/authorization.service.js';
import {signAreaQr,signFixtureQr} from '../services/verification-v2/qr.service.js';
import {storeStandardEvidence} from '../services/verification-v2/evidence.service.js';
import {screenStandardPrivacy} from '../services/verification-v2/standardPrivacy.service.js';
import {writeAuditLog} from '../services/auditLog.service.js';
const id=(value:unknown)=>{const n=Number(value);if(!Number.isSafeInteger(n)||n<1)throw new ApiError(400,'Invalid identifier');return n;};
const parse=<T>(schema:z.ZodType<T>,value:unknown):T=>{const r=schema.safeParse(value);if(!r.success)throw new ApiError(400,'Invalid request',r.error.issues);return r.data;};
const send=(res:Response,data:unknown,status=200)=>res.status(status).json(new ApiResponse(status,data,'Success'));
export async function listAreas(req:Request,res:Response){const locationId=id(req.params.locationId);await requireLocationAccess(req.user!,locationId);const areas=await prisma.area.findMany({where:{locationId},include:{templates:{where:{isActive:true},select:{id:true}},items:{orderBy:[{sequence:'asc'},{id:'asc'}]},_count:{select:{items:true,instances:true,exceptions:{where:{state:{not:'RESOLVED'}}}}}},orderBy:{name:'asc'}});send(res,areas.map(({templates,...area})=>({...area,activeScheduleCount:templates.length})));}
export async function addArea(req:Request,res:Response){send(res,await createArea(req.user!,id(req.params.locationId),parse(areaCreateSchema,req.body)),201);}
export async function getArea(req:Request,res:Response){send(res,await areaDetail(req.user!,id(req.params.areaId)));}
export async function patchArea(req:Request,res:Response){const areaId=id(req.params.areaId);const {expectedInventoryVersion,...data}=parse(areaEditSchema,req.body);send(res,await mutateArea(req.user!,areaId,expectedInventoryVersion,async tx=>{if(data.status==='ACTIVE'&&!await tx.areaItem.count({where:{areaId,status:'ACTIVE'}}))throw new ApiError(422,'Add active fixtures before activating');return tx.area.update({where:{id:areaId},data});},'UPDATE'));}
export async function addItems(req:Request,res:Response){const input=parse(z.object({expectedInventoryVersion:z.number().int().positive(),counts:inventoryCountsSchema}),req.body);send(res,await bulkItems(req.user!,id(req.params.areaId),input.expectedInventoryVersion,input.counts));}
export async function patchItem(req:Request,res:Response){send(res,await updateItem(req.user!,id(req.params.areaId),id(req.params.itemId),parse(itemEditSchema,req.body)));}
export async function archiveArea(req:Request,res:Response){const areaId=id(req.params.areaId);const input=parse(z.object({expectedInventoryVersion:z.number().int().positive()}),req.body);send(res,await mutateArea(req.user!,areaId,input.expectedInventoryVersion,async tx=>{await tx.taskTemplate.updateMany({where:{areaId},data:{setupStatus:'NEEDS_REVIEW'}});return tx.area.update({where:{id:areaId},data:{status:'ARCHIVED'}});},'ARCHIVE'));}
export async function areaQr(req:Request,res:Response){const area=await requireAreaAccess(req.user!,id(req.params.areaId));send(res,{payload:signAreaQr(area),version:area.qrVersion,activeSessionCount:await prisma.captureSession.count({where:{areaId:area.id,state:{in:['ACTIVE','PAUSED']}}})});}
export async function rotateQr(req:Request,res:Response){const input=parse(z.object({expectedInventoryVersion:z.number().int().positive(),expectedQrVersion:z.number().int().positive().optional()}),req.body);const area=await requireAreaAccess(req.user!,id(req.params.areaId));const updated=await prisma.$transaction(async tx=>{const changed=await tx.area.updateMany({where:{id:area.id,inventoryVersion:input.expectedInventoryVersion,qrVersion:input.expectedQrVersion??area.qrVersion,status:{not:'ARCHIVED'}},data:{qrVersion:{increment:1},qrNonce:randomUUID()}});if(!changed.count)throw new ApiError(409,'QR changed. Refresh before rotating.');const next=await tx.area.findUniqueOrThrow({where:{id:area.id}});await tx.captureSession.updateMany({where:{areaId:area.id,state:{in:['ACTIVE','PAUSED']}},data:{state:'REVOKED',closedAt:new Date(),rowVersion:{increment:1}}});await writeAuditLog({actorType:req.user!.role,actorId:req.user!.id,companyId:req.user!.companyId,entityType:'AREA',entityId:area.id,action:'ROTATE_QR'},tx);return next;});send(res,{payload:signAreaQr(updated),version:updated.qrVersion});}
export async function fixtureLabels(req:Request,res:Response){const area=await requireAreaAccess(req.user!,id(req.params.areaId));const items=await prisma.areaItem.findMany({where:{areaId:area.id,status:{not:'RETIRED'}},orderBy:{sequence:'asc'}});send(res,items.map(i=>({itemId:i.id,displayName:i.displayName,payload:signFixtureQr(area,i.id)})));}
export async function migrationTemplates(req:Request,res:Response){const locationId=req.query.locationId===undefined?undefined:id(req.query.locationId);if(locationId)await requireLocationAccess(req.user!,locationId);const locations=await prisma.location.findMany({where:{companyId:req.user!.companyId,...(locationId?{id:locationId}:{}),...(req.user!.role==='MANAGER'?{id:{in:req.user!.locationIds??[]}}:{})},select:{id:true}});send(res,await prisma.taskTemplate.findMany({where:{locationId:{in:locations.filter(l=>!locationId||l.id===locationId).map(l=>l.id)},isActive:true,OR:[{verificationVersion:1},{setupStatus:'NEEDS_REVIEW'}]},include:{inventoryItems:true,referenceImages:true,staff:{select:{name:true}},_count:{select:{instances:{where:{isActive:true,status:{in:['PENDING','IN_PROGRESS']}}}}},location:{select:{name:true,timezone:true}}},orderBy:{id:'asc'}}));}

export async function listStandards(req:Request,res:Response) {
 const areaId=id(req.params.areaId);await requireAreaAccess(req.user!,areaId);
 const standards=await prisma.areaStandardPhoto.findMany({where:{areaId},select:{id:true,areaItemId:true,mediaAssetId:true,caption:true,createdAt:true,media:{select:{privacyState:true}}},orderBy:{id:'asc'}});
 send(res,standards.map(({media,...standard})=>({...standard,privacyState:media.privacyState})));
}
export async function addStandard(req:Request,res:Response) {
 const areaId=id(req.params.areaId);const area=await requireAreaAccess(req.user!,areaId);
 if(req.body.standardId!==undefined){
  const standardId=id(req.body.standardId);
  if(req.file)throw new ApiError(400,'Retry uses the saved standard photo');
  if(!await prisma.areaStandardPhoto.findFirst({where:{id:standardId,areaId}}))throw new ApiError(404,'Standard not found');
  return send(res,await screenStandardPrivacy(req.user!,standardId));
 }
 const input=parse(z.object({areaItemId:z.coerce.number().int().positive().optional(),caption:z.string().trim().max(300).optional()}),req.body);
 if(input.areaItemId&&!await prisma.areaItem.findFirst({where:{id:input.areaItemId,areaId,status:{not:'RETIRED'}}}))throw new ApiError(422,'Choose a fixture in this area');
 if(!req.file)throw new ApiError(400,'A photo is required');
 const media=await storeStandardEvidence(req.user!,area.locationId,req.file.buffer);
 const standard=await prisma.$transaction(async tx=>{
  const row=await tx.areaStandardPhoto.create({data:{areaId,areaItemId:input.areaItemId,mediaAssetId:media.id,caption:input.caption,createdByManagerId:req.user!.id}});
  await writeAuditLog({companyId:req.user!.companyId,actorType:req.user!.role,actorId:req.user!.id,entityType:'AREA',entityId:areaId,action:'ADD_STANDARD',newValue:{standardId:row.id}},tx);return row;
 });const privacy=await screenStandardPrivacy(req.user!,standard.id);send(res,{...standard,...privacy},201);
}
