import {prisma} from '../../prisma/prisma.js';
import {hammingDistance} from './quality.service.js';
type HashAsset={id:string;sha256:string;normalizedHash:string|null;perceptualHash:string|null;hashVariants?:string[]};
export function duplicateClassification(current:HashAsset,candidates:HashAsset[],nearDistance=8){
 const unique=[...new Map(candidates.filter(c=>c.id!==current.id).map(c=>[c.id,c])).values()];
 const hashes=(a:HashAsset)=>[a.perceptualHash,...(a.hashVariants??[])].filter((v):v is string=>!!v&&/^[a-f\d]{16}$/i.test(v));
 const exact=unique.filter(c=>c.sha256===current.sha256||!!current.normalizedHash&&c.normalizedHash===current.normalizedHash).map(c=>c.id);
 return {algorithmVersion:'dct64-v1',exact,near:unique.filter(c=>!exact.includes(c.id)&&hashes(current).some(a=>hashes(c).some(b=>hammingDistance(a,b)<=nearDistance))).map(c=>c.id),nearIsFraud:false};
}
export async function duplicateCandidates(assetId:string,companyId:number,taskId:number,fixtureType?:string){
 const current=await prisma.evidenceAsset.findFirstOrThrow({where:{id:assetId,companyId}});
 // Exact indexed matches have no age/count cutoff. All task images precede the bounded historical shortlist.
 const exact=await prisma.evidenceAsset.findMany({where:{companyId,id:{not:assetId},OR:[{sha256:current.sha256},...(current.normalizedHash?[{normalizedHash:current.normalizedHash}]:[])]}});
 const task=await prisma.evidenceAsset.findMany({where:{companyId,taskInstanceId:taskId,id:{not:assetId}},orderBy:[{createdAt:'desc'},{id:'asc'}]});
 const recent=fixtureType?await prisma.evidenceAsset.findMany({where:{companyId,id:{not:assetId},createdAt:{gte:new Date(Date.now()-30*86400000)},attempts:{some:{requirement:{item:{typeSnapshot:fixtureType}}}}},orderBy:[{createdAt:'desc'},{id:'asc'}],take:200}):[];
 const candidates=[...new Map([...exact,...task,...recent].map(c=>[c.id,c])).values()];
 const attempts=await prisma.verificationAttempt.findMany({where:{mediaAssetId:{in:[assetId,...candidates.map(c=>c.id)]},session:{task:{location:{companyId}}}},select:{mediaAssetId:true,qualityResult:true}});
 const variants=new Map<string,string[]>();
 for(const a of attempts){const q=a.qualityResult as {hashVariants?:unknown}|null;if(a.mediaAssetId&&Array.isArray(q?.hashVariants))variants.set(a.mediaAssetId,q.hashVariants.filter((h):h is string=>typeof h==='string'));}
 return {current,candidates,...duplicateClassification({...current,hashVariants:variants.get(current.id)},candidates.map(c=>({...c,hashVariants:variants.get(c.id)})))};
}
