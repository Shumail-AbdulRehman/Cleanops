import type { ExceptionAction, ExceptionDetail, VerificationIssue } from './types';
export const actionLabels:Record<ExceptionAction,string>={ACCEPT_EVIDENCE:'Accept evidence',REJECT_EVIDENCE:'Reject evidence',REQUEST_RECAPTURE:'Request another photo',REQUEST_CLEANING:'Request cleaning',MARK_MAINTENANCE:'Mark maintenance',WAIVE_REQUIREMENT:'Waive requirement',EXTEND_WINDOW:'Extend photo window',RESOLVE_ISSUE:'Resolve issue',ACCEPT_CONTEXT:'Accept room and presence context'};
export function actionConsequence(action:ExceptionAction):string {
 if(['ACCEPT_EVIDENCE','WAIVE_REQUIREMENT','ACCEPT_CONTEXT'].includes(action))return 'This decision is audited. When all remaining requirements and blocking issues are satisfied, the task becomes Completed with exceptions.';
 if(action==='MARK_MAINTENANCE')return 'Marks the fixture for maintenance. Required evidence remains unresolved; waive it separately if appropriate.';
 if(action==='RESOLVE_ISSUE')return 'Resolves a satisfied issue. It does not waive required evidence.';
 if(action==='EXTEND_WINDOW')return 'One audited extension, measured from the original task deadline. Existing photos are retained.';
 return 'The affected view stays unresolved until the worker submits acceptable replacement evidence.';
}
export function issueActions(detail:ExceptionDetail,issue:VerificationIssue):ExceptionAction[] {
 return (issue.allowedActions??detail.allowedActions).filter(action=>{
 if(action==='ACCEPT_EVIDENCE')return !!issue.latestAttempt?.mediaAssetId&&['SAFE','NOT_REQUIRED'].includes(issue.latestAttempt.privacyState??'');
 if(action==='ACCEPT_CONTEXT')return !!(issue.latestAttempt?.contextKey&&issue.latestAttempt.mediaAssetId&&['SAFE','NOT_REQUIRED'].includes(issue.latestAttempt.privacyState??''))||!!detail.attempts?.some(a=>a.contextKey&&a.mediaAssetId&&['SAFE','NOT_REQUIRED'].includes(a.privacyState??''));
 return true;
 });
}
