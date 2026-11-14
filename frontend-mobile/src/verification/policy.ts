import type { CaptureSlot, LocalSession, Manifest, QueueRow, QueueState } from './types';
export const MAX_QUEUE_BYTES = 100 * 1024 * 1024;
export const MAX_QUEUE_PHOTOS = 50;
export const terminalRequirement = (state: string) => ['PASSED', 'MANAGER_ACCEPTED', 'WAIVED'].includes(state);
export function captureAllowed(local: LocalSession, clock: { bootId: string; elapsedMs: number }) {
  if (local.paused || !['ACTIVE'].includes(local.session.state)) return false;
  if (clock.bootId !== local.anchorBootId || clock.elapsedMs < local.anchorElapsedMs) return false;
  const supportedNow = Date.parse(local.session.serverTime) + clock.elapsedMs - local.anchorElapsedMs;
  return supportedNow <= Date.parse(local.session.captureExpiresAt);
}
export const checkedPhotoState=(state:string)=>['PASSED','REVIEW_REQUIRED','PRIVACY_HOLD','MANAGER_ACCEPTED','WAIVED','SERVICE_FAILURE'].includes(state);
export function nextSlot(local:LocalSession,queue:QueueRow[]):CaptureSlot|undefined {
 const ordered=local.session.slots.filter(slot=>!slot.contextKey||!local.session.requiredContextKeys||local.session.requiredContextKeys.includes(slot.contextKey)).sort((a,b)=>a.sequence-b.sequence);
 const requirements=new Map(local.manifest.items.flatMap(i=>i.requirements).map(r=>[r.id,r]));
 const sequential=local.session.sequentialChecks===true;
 if(sequential&&(local.manifest.pendingJobs??0)>0)return undefined;
 for(const slot of ordered){
  const row=queue.find(row=>row.sessionId===local.session.id&&row.slotId===slot.id);
  const requirement=slot.requirementId?requirements.get(slot.requirementId):undefined;
  const context=local.manifest.sessions?.find(s=>s.id===local.session.id)?.slots.find(s=>s.id===slot.id);
  const state=requirement?.state??context?.state??'MISSING';
  if(terminalRequirement(state)||sequential&&checkedPhotoState(state))continue;
  if(slot.attemptId||row){if(sequential)return undefined;continue;}
  return slot;
 }
 return undefined;
}
export function pendingPhotoCheck(local:LocalSession,queue:QueueRow[]):boolean {
 if(!local.session.sequentialChecks)return false;
 if((local.manifest.pendingJobs??0)>0)return true;
 return local.session.slots.some(slot=>{
  const row=queue.find(row=>row.sessionId===local.session.id&&row.slotId===slot.id);
  if(!row&&!slot.attemptId)return false;
  const requirement=local.manifest.items.flatMap(i=>i.requirements).find(r=>r.id===slot.requirementId);
  const context=local.manifest.sessions?.find(s=>s.id===local.session.id)?.slots.find(s=>s.id===slot.id);
  const state=requirement?.state??context?.state??'MISSING';
  return !checkedPhotoState(state)&&!['RECAPTURE_REQUIRED','CLEANING_REQUIRED'].includes(state);
 });
}
export function objectSecondsRemaining(local:LocalSession,slot:CaptureSlot|undefined,clock:{bootId:string;elapsedMs:number}){
 if(!slot?.activatedAt)return null;
 if(clock.bootId!==local.anchorBootId||clock.elapsedMs<local.anchorElapsedMs)return 0;
 const now=Date.parse(local.session.serverTime)+clock.elapsedMs-local.anchorElapsedMs;
 return Math.max(0,Math.ceil((Date.parse(slot.expiresAt)-now)/1000));
}

export function retryOutcome(status: number | undefined, retry: number, now: number, retryAfterSeconds?: number): { state: QueueState; nextRetryAt: number } {
  if (status === 401 || status === 403) return { state: 'AUTH_REQUIRED', nextRetryAt: 0 };
  // Rejected authority remains durable; reconnect/manager help can reconcile it.
  // A rejected upload cannot become valid by repeating the same bytes and metadata.
  if (status && status >= 400 && status < 500 && ![408,425,429].includes(status)) return { state: 'BLOCKED', nextRetryAt: 0 };
  const delay = retryAfterSeconds ? retryAfterSeconds * 1000 : Math.min(120_000, 2000 * 2 ** Math.min(retry, 6));
  return { state: 'RETRY_WAIT', nextRetryAt: now + delay + Math.floor(Math.random()*1000) };
}
export function recoverQueueState(state: QueueState): QueueState { return state === 'UPLOADING' ? 'SAVED' : state; }
export function reconciledState(local: QueueRow, accepted: { id: string; state: string } | undefined): { state: QueueState; attemptId?: string } {
  if (!accepted) return { state: recoverQueueState(local.state), attemptId: local.attemptId ?? undefined };
  return { state: ['PASSED','RECAPTURE_REQUIRED','CLEANING_REQUIRED','REVIEW_REQUIRED','PRIVACY_HOLD','SERVICE_FAILURE','MANAGER_ACCEPTED','WAIVED'].includes(accepted.state) ? 'FINAL' : 'PROCESSING', attemptId: accepted.id };
}
export function mergeManifest(local: LocalSession, manifest: Manifest): LocalSession {
  const serverSession=manifest.sessions?.find(s=>s.id===local.session.id);
  return {...local,manifest,session:{...local.session,...(serverSession?{state:serverSession.state,...(serverSession.requiredContextKeys?{requiredContextKeys:serverSession.requiredContextKeys,slots:local.session.slots.filter(slot=>!slot.contextKey||serverSession.requiredContextKeys!.includes(slot.contextKey))}:{})}:{}),...(manifest.task.status==='COMPLETED'?{state:'CLOSED'}:{})}};
}
