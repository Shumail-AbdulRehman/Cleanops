import type {ExceptionDetail, VerificationIssue} from './types';
import type {EvidenceRequirement, EvidenceAttempt} from '../Verification/types';
import {plainReason} from '../Verification/presentation.ts';
type Translate = (text:string, values?:Record<string,string|number>) => string;
const english:Translate = (text,values={}) => text.replace(/\{(\w+)\}/g,(token,key)=>String(values[key]??token));
export type DiagnosisRow = {id:string;name:string;view:string;state:string;mandatory:boolean;category:'missing'|'cleaning'|'retake'|'review'|'processing'|'checked';title:string;description:string;attempt:EvidenceAttempt|null|undefined};
const surfaceNames:Record<string,string> = {pan:'toilet pan',bowl:'bowl',seat:'seat',drain:'drain',footrests:'footrests',basin:'basin',tap:'tap',mirror:'mirror',surface:'surface',floor:'floor',floor_zone:'floor zone',zone:'floor zone',exterior:'exterior',base:'base',pan_edges:'pan edges',surrounding_floor:'surrounding floor',opening:'opening',interior:'interior',rim:'rim'};
export function reviewViewLabel(view:string,t:Translate=english) {
  const label=plainReason(view);
  return t(label==='This work needs your decision'?'Required photo':label);
}
function surfaces(keys:string[]|undefined,t:Translate) {return [...new Set((keys??[]).map(key=>surfaceNames[key]).filter(Boolean))].map(name=>t(name)).join(', ');}
export function requirementDiagnosis(detail:ExceptionDetail, requirement:EvidenceRequirement, name:string, mandatory=true,t:Translate=english,reasonOverride?:string):DiagnosisRow {
  const issue=detail.issues.find(issue=>issue.requirementId===requirement.id&&issue.state!=='RESOLVED');
  const attempt=requirement.currentAttempt??(requirement.currentAttemptId ? issue?.latestAttempt?.id===requirement.currentAttemptId?issue.latestAttempt:null : requirement.currentAttemptId===undefined&&requirement.state!=='MISSING'?issue?.latestAttempt:null);
  const reason=reasonOverride??attempt?.reviewSummary?.reasonCode??issue?.reasonCode??requirement.state;
  const result=attempt?.reviewSummary;
  const dirty=surfaces(result?.dirtySurfaces,t), missing=surfaces(result?.missingSurfaces,t);
  const row={id:requirement.id,name,view:reviewViewLabel(requirement.viewKey,t),state:requirement.state,mandatory:mandatory&&requirement.mandatory!==false,attempt};
  if (attempt?.state === 'PRIVACY_HOLD' || ['HOLD','HELD','PRIVACY_HOLD'].includes(attempt?.privacyState ?? '') || reason === 'PRIVACY_HOLD') return {...row,category:'review',title:t('Privacy review needed'),description:t('The photo is restricted for a privacy review. Check it carefully before deciding whether it is safe to use.')};
  if (reason === 'SERVICE_FAILURE' || attempt?.state === 'SERVICE_FAILURE') return {...row,category:'review',title:t('Photo check failed'),description:t('The automatic photo check could not finish. This is a checking failure, not a finding that the fixture is dirty.')};
  if(['PASSED','MANAGER_ACCEPTED','WAIVED'].includes(requirement.state))return {...row,category:'checked',title:t(requirement.state==='WAIVED'?'Accepted with an exception':'Photo requirement satisfied'),description:t(requirement.state==='WAIVED'?'A manager recorded an exception for this required view.':'This photo requirement has been satisfied.')};
  if(requirement.state==='MISSING') {
    const earlier=detail.attempts?.some(attempt=>attempt.requirementId===requirement.id&&!!attempt.receivedAt);
    return {...row,category:'missing',title:t(earlier?'Replacement photo missing':'Photo missing'),description:t(earlier?'A previous photo was received, but no current replacement photo has been received for this view.':'No photo has been received for this required view.')};
  }
  if(requirement.state==='CLEANING_REQUIRED')return {...row,category:'cleaning',title:t('More cleaning needed'),description:result?.cleanliness==='DIRTY'&&dirty?t('The photo check flagged the {surfaces} as needing cleaning.',{surfaces:dirty}):t('The recorded result says this view needs more cleaning.')};
  if(requirement.state==='PROCESSING')return {...row,category:'processing',title:t('Photo check in progress'),description:t('The photo was received. Its check has not finished, so no cleaning result is available yet.')};
  const descriptions:Record<string,string>={
    WRONG_ITEM:t('The photo check found a different object instead of the required fixture.'),
    OBJECT_UNCERTAIN:t('The photo check could not confirm that the required fixture is shown. This is not a finding that it is dirty.'),
    VIEW_UNCERTAIN:t('The photo check could not confirm that every required part is visible.'),
    MISSING_SURFACE:missing?t('The photo does not show the {surfaces}.',{surfaces:missing}):t('A required part of the fixture is cropped out or hidden.'),
    AUTO_PASS_NOT_VALIDATED:result?.cleanliness==='CLEAN'?t('The photo check marked the visible surface clean, but automatic approval is not enabled for this check. A manager must review the photo.'):t('This photo requires a manager’s approval before it can pass.'),
    CLEF_CALIBRATION_REQUIRED:t('Automatic approval is not enabled for this check. A manager must review the photo; this is not a dirty finding.'),
    CANNOT_ASSESS:t('The photo check could not decide whether the visible condition is clean or dirty. This may need a closer look at stains, wear, damage or visibility.'),
    SERVICE_FAILURE:t('The automatic photo check could not finish. This is a checking failure, not a finding that the fixture is dirty.'),
    PRIVACY_HOLD:t('The photo is restricted for a privacy review. Check it carefully before deciding whether it is safe to use.'),
    PHOTO_TOO_DARK:t('The photo is too dark to inspect the required surface.'),
    PHOTO_BLURRY:t('The photo is too blurred to inspect the required surface.'),
    PHOTO_TOO_SMALL:t('The photo is too small to inspect the required surface.'),
    PHOTO_OF_SCREEN:t('The photo check identified a picture displayed on a screen.'),
    PHOTO_ORIGIN_UNCERTAIN:t('The photo check could not confirm that this is a direct photo of a physical scene.'),
    DUPLICATE_EVIDENCE:t('This photo may have been used before. Review its capture history before accepting it.'),
    STALE_ASSIGNMENT:t('This upload did not match the task’s current capture or assignment authority and needs a manager’s review.'),
    GPS_UNCERTAIN:t('The capture location could not be confirmed. Review the available evidence before deciding.'),
  };
  const retake=requirement.state==='RECAPTURE_REQUIRED';
  return {...row,category:retake?'retake':'review',title:t(retake?'Photo did not pass':reason==='AUTO_PASS_NOT_VALIDATED'?'Manager approval needed':reason==='SERVICE_FAILURE'?'Photo check failed':reason==='PRIVACY_HOLD'?'Privacy review needed':'Photo needs review'),description:descriptions[reason]??t('This photo needs a manager’s decision before the requirement can pass.')};
}
export function reviewCaptureStatus(detail:ExceptionDetail) {
  if(detail.captureStatus)return detail.captureStatus;
  const task=detail.task,deadline=task?.verificationDeadline??task?.shiftEnd??null;
  const now=Date.parse(detail.serverTime??new Date().toISOString());
  const reason=!task?'UNAVAILABLE':task.status==='CANCELLED'?'CANCELLED':task.status==='COMPLETED'?'COMPLETED':task.staffSubmittedAt?'SUBMITTED':deadline&&Date.parse(deadline)<=now?'DEADLINE_PASSED':'UNAVAILABLE';
  const available=reason==='UNAVAILABLE'&&[...detail.allowedActions,...detail.issues.flatMap(issue=>issue.allowedActions??[])].some(action=>['REQUEST_RECAPTURE','REQUEST_CLEANING'].includes(action));
  return {available,reason:available?'AVAILABLE':reason,deadline,canExtend:detail.issues.some(issue=>issue.allowedActions?.includes('EXTEND_WINDOW'))};
}
export function reviewDiagnosis(detail:ExceptionDetail,t:Translate=english) {
  const rows=(detail.items??[]).flatMap(item=>item.requirements.map(requirement=>requirementDiagnosis(detail,requirement,item.nameSnapshot,item.mandatory!==false,t)));
  const required=rows.filter(row=>row.mandatory);
  const groups=(['cleaning','missing','retake','review','processing'] as const).map(category=>({category,rows:required.filter(row=>row.category===category)})).filter(group=>group.rows.length);
  const count=(category:DiagnosisRow['category'])=>required.filter(row=>row.category===category).length;
  const capture=reviewCaptureStatus(detail);
  const next=detail.kind==='SETUP'
    ? t('Configure the room and its schedule. Photos cannot be reviewed until the inventory is ready.')
    : detail.state==='RESOLVED'
    ? t('This review has been handled. Existing photos and task completion records stay as recorded.')
    : t('Resolve this review, or record a staff performance issue and close it. This task stays in exceptions until you save a decision.');
  return {rows,groups,capture,next,missing:count('missing'),cleaning:count('cleaning'),checked:count('checked'),total:required.length};
}
export function issueDiagnosis(detail:ExceptionDetail, issue:VerificationIssue, t:Translate=english) {
  if(issue.requirementId){const item=detail.items?.find(item=>item.requirements.some(requirement=>requirement.id===issue.requirementId));const requirement=item?.requirements.find(requirement=>requirement.id===issue.requirementId);if(item&&requirement)return requirementDiagnosis(detail,detail.requiresFollowUp&&issue.state!=='RESOLVED'?{...requirement,state:'REVIEW_REQUIRED'}:requirement,item.nameSnapshot,item.mandatory!==false,t,detail.requiresFollowUp&&issue.state!=='RESOLVED'?issue.reasonCode:undefined);}
  return null;
}
