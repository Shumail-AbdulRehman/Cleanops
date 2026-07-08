import type { VerificationTransaction } from './transaction.js';
export const DIRECT_REQUEST_TTL_MS=180_000;
export function directRequestExpired(value:unknown,now=Date.now()) {
  const q=value as {directProcessingToken?:string|null;directProcessingStartedAt?:Date|null}|null;
  return !!q?.directProcessingToken&&now-+(q.directProcessingStartedAt??new Date(0))>=DIRECT_REQUEST_TTL_MS;
}
/** No scheduler: a new room scan releases interrupted upload reservations. */
export async function releaseInterruptedPhotos(tx:VerificationTransaction,taskId:number) {
  const attempts=await tx.verificationAttempt.findMany({where:{session:{taskInstanceId:taskId},mediaAssetId:null,
    state:'CLEANLINESS_CHECK',qualityResult:{path:['workflow'],equals:'DIRECT_PHOTO_V1'}},select:{id:true,directProcessingToken:true,directProcessingStartedAt:true}});
  for(const a of attempts)if(directRequestExpired(a))await tx.verificationAttempt.update({where:{id:a.id},data:{
    state:'RESERVED',directProcessingToken:null,directProcessingStartedAt:null}});
}
