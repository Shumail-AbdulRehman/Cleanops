import type { BufferedAssessment } from './bufferedPhoto.provider.js';
export type Decision = { state: 'PASSED' | 'REVIEW_REQUIRED' | 'RECAPTURE_REQUIRED' | 'CLEANING_REQUIRED'; reason: string; keep: boolean };
export function bufferedDecision(assessment: BufferedAssessment, automaticAcceptance: boolean, requiresObjectMatch = assessment.objectMatch !== null || assessment.cleanliness !== null): Decision {
  if (requiresObjectMatch && assessment.objectMatch === 'WRONG_ITEM') return {state:'RECAPTURE_REQUIRED',reason:'WRONG_ITEM',keep:false};
  if (assessment.originality === 'SCREEN_RECAPTURE') return { state: 'RECAPTURE_REQUIRED', reason: 'PHOTO_OF_SCREEN', keep: false };
  if (requiresObjectMatch && assessment.objectMatch === 'MISSING_SURFACE') return {
    state: 'RECAPTURE_REQUIRED',
    reason: 'MISSING_SURFACE',
    keep: false,
  };
  if (requiresObjectMatch && assessment.objectMatch !== 'MATCH') return {state:'REVIEW_REQUIRED',reason:'OBJECT_UNCERTAIN',keep:true};
  if (requiresObjectMatch && assessment.viewMatch === 'MISSING_SURFACE') return {state:'RECAPTURE_REQUIRED',reason:'MISSING_SURFACE',keep:false};
  if (requiresObjectMatch && assessment.viewMatch !== 'MATCH') return {state:'REVIEW_REQUIRED',reason:'VIEW_UNCERTAIN',keep:true};
  if (requiresObjectMatch && !assessment.cleanliness) return {state:'REVIEW_REQUIRED',reason:'CANNOT_ASSESS',keep:true};
  if (assessment.cleanliness?.surfaces.some(s => s.verdict === 'DIRTY')) return { state: 'CLEANING_REQUIRED', reason: 'CLEANING_REQUIRED', keep: true };
  if (assessment.originality === 'UNCERTAIN') return { state: 'REVIEW_REQUIRED', reason: 'PHOTO_ORIGIN_UNCERTAIN', keep: true };
  if (assessment.cleanliness?.details?.assessmentStatus === 'THRESHOLD_UNCONFIGURED') return { state: 'REVIEW_REQUIRED', reason: 'CLEF_CALIBRATION_REQUIRED', keep: true };
  if (assessment.cleanliness?.verdict === 'CANNOT_ASSESS') return { state: 'REVIEW_REQUIRED', reason: 'CANNOT_ASSESS', keep: true };
  if (assessment.cleanliness && !automaticAcceptance) return { state: 'REVIEW_REQUIRED', reason: 'AUTO_PASS_NOT_VALIDATED', keep: true };
  return { state: 'PASSED', reason: 'CLEAN', keep: true };
}
