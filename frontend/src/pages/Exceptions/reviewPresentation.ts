import type { ExceptionAction, VerificationIssue } from "./types";

export const reviewActionLabels: Record<ExceptionAction, string> = {
  ACCEPT_EVIDENCE: "Accept this photo",
  ACCEPT_CONTEXT: "Accept this room photo",
  REQUEST_RECAPTURE: "Ask for another photo",
  REQUEST_CLEANING: "Ask for more cleaning",
  EXTEND_WINDOW: "Give more time for photos",
  REJECT_EVIDENCE: "Reject this photo",
  MARK_MAINTENANCE: "Report a repair needed",
  WAIVE_REQUIREMENT: "Make an exception for this photo",
  RESOLVE_ISSUE: "Close this issue",
};
export const everydayActions: ExceptionAction[] = [
  "REQUEST_RECAPTURE",
  "REQUEST_CLEANING",
  "ACCEPT_EVIDENCE",
  "EXTEND_WINDOW",
  "RESOLVE_ISSUE",
];
export function reviewHeading(issue: VerificationIssue): string {
  if (issue.reasonCode === "MISSING_EVIDENCE")
    return "Required photos are missing";
  if (issue.reasonCode === "SERVICE_FAILURE")
    return "Photo checking is unavailable";
  if (issue.reasonCode === "PRIVACY_HOLD")
    return "This photo needs a privacy review";
  if (issue.reasonCode === "CLEANING_REQUIRED")
    return "More cleaning is needed";
  return "A photo needs your review";
}
export function reviewGuidance(issue: VerificationIssue): string {
  if (issue.reasonCode === "MISSING_EVIDENCE")
    return "The required photos listed in the summary have not been received. Resolve the review with a note, or record a staff performance issue.";
  if (issue.reasonCode === "SERVICE_FAILURE")
    return "A checking service could not complete its review. This does not mean the area is dirty.";
  if (issue.reasonCode === "PRIVACY_HOLD")
    return "This photo is restricted for privacy review. Check the circumstances before resolving the task review.";
  return "Review the recorded finding, then resolve the review or record a staff performance issue.";
}
