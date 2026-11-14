import type { CaptureSlot, LocalSession, QueueRow, Manifest } from './types';
import { nextSlot } from './policy';
export function qualityInstruction(quality: {width:number;height:number;luminance:number;laplacianVariance:number;clipping:number}): string | null {
  if (Math.min(quality.width,quality.height)<600) return 'Photo is too small. Move closer and retake.';
  if (quality.luminance<30) return 'Too dark. Turn on the light or torch.';
  if (quality.luminance>235 || quality.clipping>.65) return 'Too much glare. Change your angle and retake.';
  if (quality.laplacianVariance<12) return 'Photo is blurry. Hold still and retake.';
  return null;
}
export function slotInstruction(local:LocalSession,slot:CaptureSlot) {
  if(slot.contextKey) {
    const contexts=local.session.requiredContextKeys??[...new Set(local.session.slots.map(s=>s.contextKey).filter(Boolean))];
    return {title:contexts.length===1?'Room photo':`Room photo ${contexts.indexOf(slot.contextKey)+1} of ${contexts.length}`,view:slot.contextKey==='ENTRANCE'?'Show the entrance and nearby room.':'Show the room and its items.',progress:'',hint:'Keep people out of the photo, including mirror reflections.'};
  }
  const item=local.manifest.items.find(i=>i.requirements.some(r=>r.id===slot.requirementId));
  const requirement=item?.requirements.find(r=>r.id===slot.requirementId);
  const fixtures=local.manifest.items.filter(i=>i.typeSnapshot===item?.typeSnapshot);
  return {title:`${item?.nameSnapshot ?? 'Item'} (${fixtures.findIndex(i=>i.id===item?.id)+1} of ${fixtures.length})`,view:requirement?.instructionsSnapshot ?? 'Show the whole item.',progress:`Photo ${(item?.requirements.findIndex(r=>r.id===slot.requirementId)??0)+1} of ${item?.requirements.length??1}`,hint:[item?.identificationSnapshot?.positionHint,item?.identificationSnapshot?.existingNumber&&`Include number ${item.identificationSnapshot.existingNumber}`].filter(Boolean).join('. ')};
}
export function captureProgress(local:LocalSession,queue:QueueRow[]) {
  const requirements=local.manifest.items.flatMap(i=>i.requirements);
  return {saved:queue.filter(r=>['SAVED','RETRY_WAIT','AUTH_REQUIRED','BLOCKED'].includes(r.state)).length,uploading:queue.filter(r=>r.state==='UPLOADING').length,checking:Math.max(requirements.filter(r=>r.state==='PROCESSING').length,queue.filter(r=>['SERVER_ACCEPTED','PROCESSING'].includes(r.state)).length),passed:requirements.filter(r=>r.state==='PASSED').length,next:nextSlot(local,queue)};
}
export const reworkRequirements=(local:LocalSession)=>local.manifest.items.flatMap(item=>item.requirements.filter(r=>['RECAPTURE_REQUIRED','CLEANING_REQUIRED'].includes(r.state)).map(requirement=>({item,requirement})));

/** Fresh, unused slots confirm server-authorized generations; unrelated task results stay intact. */
export function manifestForAllocatedSlots(manifest:Manifest,slots:CaptureSlot[]):Manifest {
  const generations=new Map(slots.filter(slot=>slot.requirementId&&!slot.attemptId).map(slot=>[slot.requirementId!,slot.generation]));
  return {...manifest,items:manifest.items.map(item=>({...item,requirements:item.requirements.map(requirement=>{
    const generation=generations.get(requirement.id);
    return generation===undefined||generation<requirement.decisionVersion||['PASSED','MANAGER_ACCEPTED','WAIVED'].includes(requirement.state)?requirement:{...requirement,state:'MISSING',decisionVersion:generation,currentAttempt:null};
  })}))};
}
