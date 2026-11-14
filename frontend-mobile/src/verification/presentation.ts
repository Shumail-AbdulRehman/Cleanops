import type { LocalSession, Manifest, QueueRow, Requirement, StaffCleanlinessOutcome } from './types';

export type PhotoStatus = { key: string; title: string; detail: string; state: string; cleanlinessOutcome:StaffCleanlinessOutcome|null;reviewReason:string|null;actionLabel:string|null };

export function cleanlinessOutcomeForState(state:string):StaffCleanlinessOutcome|null {
  if(state==='PASSED')return 'CLEAN';
  if(state==='CLEANING_REQUIRED')return 'DIRTY';
  if(['RECAPTURE_REQUIRED','REVIEW_REQUIRED','PRIVACY_HOLD','SERVICE_FAILURE'].includes(state))return 'NEEDS_REVIEW';
  return null;
}
export function assessmentDetail(requirement:Requirement):string {
  const attempt=requirement.currentAttempt;
  const reason=attempt?.reviewReason??requirement.reviewReason??attempt?.reasonCode;
  if(reason==='AUTO_PASS_NOT_VALIDATED')return 'Automatic cleanliness approval is still being validated. A manager must check this photo. Your photo is kept.';
  if(reason==='SERVICE_FAILURE'||attempt?.state==='SERVICE_FAILURE'||requirement.state==='SERVICE_FAILURE')return 'We could not finish checking this photo. Your photo is kept for review. You do not need to clean or take another photo.';
  if(reason==='CANNOT_ASSESS')return `We could not assess cleanliness from this photo. ${attempt?.instructions??(requirement.state==='RECAPTURE_REQUIRED'?'Show all required surfaces and retake this view.':'Your manager needs to review it.')}`;
  return attempt?.instructions??requirement.instructionsSnapshot;
}

export function photoStatuses(manifest: Manifest, local: LocalSession | null, rows: QueueRow[]): PhotoStatus[] {
  const sessions = manifest.sessions ?? [];
  const activeSession=sessions.find(s=>s.id===local?.session.id)??sessions[0];
  const keys=activeSession?.requiredContextKeys??local?.session.requiredContextKeys??[...new Set((activeSession?.slots??local?.session.slots??[]).map(s=>s.contextKey).filter((key):key is string=>!!key))];
  const contexts = keys.map(key => {
    // Most recent server session owns context; local data fills in unuploaded slots.
    const slot = (activeSession?.slots??[]).slice().sort((a,b) => b.generation-a.generation)
      .find(slot => slot.contextKey === key);
    return { key, title: key === 'ENTRANCE' ? 'Room entrance' : 'Room photo',
      detail: slot?.instructions ?? '', state: slot?.state ?? 'MISSING', slotId: slot?.id, fixture:false,declaredOutcome:undefined as StaffCleanlinessOutcome|null|undefined,manualOutcome:null as string|null,reviewReason:null as string|null };
  });
  const views = manifest.items.flatMap(item => item.requirements.map(requirement => ({
    key: requirement.id, title: item.nameSnapshot, detail: assessmentDetail(requirement),
    state: requirement.state, slotId: undefined as string | undefined, fixture:true,declaredOutcome:requirement.currentAttempt?.cleanlinessOutcome??requirement.cleanlinessOutcome,manualOutcome:requirement.currentAttempt?.manualOutcome??null,reviewReason:requirement.currentAttempt?.reviewReason??requirement.reviewReason??requirement.currentAttempt?.reasonCode??null,
  })));
  return [...contexts, ...views].map(view => {
    const candidates = rows.filter(row => view.key === row.metadata.slotId || (view.key === 'ENTRANCE' || view.key === 'LAYOUT'
      ? row.slotId === view.slotId || local?.session.slots.some(slot => slot.id === row.slotId && slot.contextKey === view.key)
      : local?.session.slots.some(slot => slot.id === row.slotId && slot.requirementId === view.key)));
    const row = candidates.at(-1);
    const freshRetake = !!row && local?.session.slots.some(slot => slot.id === row.slotId && !slot.attemptId && slot.generation > 0);
    const serverFinal = ['PASSED','MANAGER_ACCEPTED','WAIVED','RECAPTURE_REQUIRED','CLEANING_REQUIRED','REVIEW_REQUIRED','PRIVACY_HOLD','SERVICE_FAILURE'].includes(view.state);
    const state = row && row.state !== 'FINAL' && (!serverFinal || freshRetake && !['PASSED','MANAGER_ACCEPTED','WAIVED'].includes(view.state))
      ? row.state : view.state;
    const inferred=cleanlinessOutcomeForState(state);
    // Displayed state is authoritative: a pending upload or manual acceptance cannot become Clean.
    const cleanlinessOutcome=view.manualOutcome?null:inferred==='CLEAN'&&!view.fixture?null:view.declaredOutcome==='NEEDS_REVIEW'&&inferred? 'NEEDS_REVIEW':inferred;
    const actionLabel=state==='RECAPTURE_REQUIRED'?'Retake photo':state==='CLEANING_REQUIRED'?'Re-clean, then scan QR':state==='PRIVACY_HOLD'?'Wait until the room is empty':null;
    const detail=row?.state==='BLOCKED' ? row.lastError ?? 'Your photo is saved. Ask your manager for help.'
      : row?.state==='RETRY_WAIT' ? `Photo saved on this phone. ${row.lastError??'Upload did not finish.'} Check the connection and tap Retry saved uploads.`
      : view.detail;
    return { cleanlinessOutcome,reviewReason:view.reviewReason,actionLabel,key: view.key, title: view.title, detail, state };
  });
}

export function statusLabel(state: string,outcome:StaffCleanlinessOutcome|null=cleanlinessOutcomeForState(state)) {
  if(outcome)return {CLEAN:'Clean',DIRTY:'Dirty',NEEDS_REVIEW:'Needs review'}[outcome];
  return ({ SAVED: 'Saved', RETRY_WAIT: 'Waiting to retry', UPLOADING: 'Uploading',
    AUTH_REQUIRED: 'Sign-in needed', BLOCKED: 'Needs help', SERVER_ACCEPTED: 'Checking', PROCESSING: 'Checking',
    PASSED: 'Passed', MANAGER_ACCEPTED: 'Accepted', WAIVED: 'Waived', RECAPTURE_REQUIRED: 'Retake photo',
    CLEANING_REQUIRED: 'Needs cleaning', REVIEW_REQUIRED: 'Manager review', PRIVACY_HOLD: 'Manager review',
    MISSING: 'Photo needed', AVAILABLE: 'Photo needed', SERVICE_FAILURE: 'Checks need help', RETRYING: 'Checks delayed',
  } as Record<string,string>)[state] ?? 'Checking';
}
