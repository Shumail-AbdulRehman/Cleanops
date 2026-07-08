import { ApiError } from '../../utils/ApiError.js';
import { cleanlinessReleaseStatus, digest, verificationReleaseConfiguration } from './cleanlinessRelease.js';
import { photoChecksOwnerOverride } from './photoChecksOverride.js';

/** This is the active adapter, not an assertion about a historical benchmark.
 * Its category assistance performs neither privacy nor exact fixture identity.
 * No deployment flag or historical release can manufacture those capabilities.
 */
export function launchQualificationStatus(fixtureType: string, rubricVersion = 1, now = new Date()) {
  try {
    const pipeline = verificationReleaseConfiguration();
    // The existing reader verifies a pinned measured release, independent review,
    // model/rubric, dataset separation and exact pipeline configuration digest.
    const release = cleanlinessReleaseStatus(fixtureType, rubricVersion, now);
    const pipelineSha256 = digest(JSON.stringify(pipeline));
    const privacyCapable = Boolean(pipeline.privacyAssessment);
    const identityCapable = Boolean(pipeline.fixtureIdentityAssessment);
    if (photoChecksOwnerOverride()) {
      return { processingAllowed: true, automaticApproval: true, reason: 'OWNER_OVERRIDE', releaseReason: release.reason, pipelineSha256 };
    }
    return {
      processingAllowed: privacyCapable && release.allowed,
      automaticApproval: privacyCapable && identityCapable && release.allowed,
      reason: !privacyCapable ? 'ACTIVE_PRIVACY_SCREENING_UNAVAILABLE' : release.reason,
      releaseReason: release.reason, pipelineSha256,
    };
  } catch {
    return { processingAllowed: false, automaticApproval: false, reason: 'ACTIVE_CONFIGURATION_INVALID', releaseReason: 'RELEASE_INVALID', pipelineSha256: null };
  }
}

/** No guessed privacy policy, SAFE label, redaction or category-only approval.
 * The current adapter remains unavailable until the real privacy path and its
 * reviewed empirical qualification are implemented and independently verified.
 */
export function requireLaunchPhotoQualification(fixtureType: string, rubricVersion = 1) {
  if (!launchQualificationStatus(fixtureType, rubricVersion).processingAllowed) {
    throw new ApiError(503, 'Photo checking is unavailable pending safety qualification. Keep this photo on your device and try again when the service is available.', [{ code: 'PHOTO_QUALIFICATION_UNAVAILABLE' }]);
  }
}
