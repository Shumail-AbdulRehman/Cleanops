import { assertFailedViewReplacement } from './launchPhotoPolicy.js';
import { launchQualificationStatus } from './launchQualification.js';
import { ApiError } from '../../utils/ApiError.js';

type ReplacementInput = Parameters<typeof assertFailedViewReplacement>[0];
/** Read-only explanation. The staff mutation must recheck QR/device/session and every guard. */
export function reviewReplacementContext(input: ReplacementInput | null, fixtureType: string, currentAssignmentId: number | null) {
  const qualification = launchQualificationStatus(fixtureType);
  let policyEligible = false;
  let reason = 'CURRENT_SESSION_REQUIRED';
  if (input && currentAssignmentId === input.session.assignmentId) {
    try {
      assertFailedViewReplacement(input);
      policyEligible = true;
      reason = input.cleaning ? 'FRESH_TASK_QR_REQUIRED' : 'STAFF_CAPTURE_FLOW_REQUIRED';
    } catch (error) {
      if (!(error instanceof ApiError)) throw error;
      reason = String((error.errors?.[0] as { code?: string } | undefined)?.code ?? 'REPLACEMENT_UNAVAILABLE');
    }
  }
  return {
    policyEligible,
    available: policyEligible && qualification.processingAllowed,
    reason: !qualification.processingAllowed ? 'PHOTO_QUALIFICATION_UNAVAILABLE' : reason,
    policyReason: reason,
    processingAllowed: qualification.processingAllowed,
    automaticApproval: qualification.automaticApproval,
  };
}
