export type VerificationSummary = {
  status?: string | null;
  staffSubmittedAt?: string | null;
  verificationVersion?: number;
  verificationState?: string;
  completionOutcome?: string | null;
  completionTiming?: string | null;
};
export function verificationLabel(task: VerificationSummary): string {
  if (task.completionOutcome === "VERIFIED_COMPLETE")
    return "Verified complete";
  if (task.completionOutcome === "COMPLETED_WITH_EXCEPTIONS")
    return "Completed with exceptions";
  if (task.completionOutcome === "LEGACY_RECORDED")
    return "Previously completed";
  if (task.staffSubmittedAt)
    return task.verificationState === "NEEDS_REVIEW"
      ? "Completed · Needs manager review"
      : "Completed · Verification pending";
  const labels: Record<string, string> = {
    NOT_STARTED: "Not started",
    CAPTURING: "Taking photos",
    PROCESSING: "Waiting for checks",
    REWORK_REQUIRED: "Staff fixing",
    NEEDS_REVIEW: "Needs manager",
    VERIFIED: "Verified complete",
    RESOLVED_WITH_EXCEPTIONS: "Completed with exceptions",
  };
  return (
    labels[task.verificationState ?? ""] ??
    (task.status ?? "Pending").replaceAll("_", " ").toLowerCase()
  );
}
export function timingLabel(value?: string | null): string {
  return (
    (
      {
        ON_TIME_SERVER_OBSERVED: "Evidence received on time",
        ON_TIME_DEVICE_REPORTED: "Captured on time, reported by device",
        LATE: "Evidence captured late",
        UNCERTAIN: "Capture timing needs review",
      } as Record<string, string>
    )[value ?? ""] ?? ""
  );
}
export function exceptionStateLabel(state: string): string {
  return (
    (
      {
        OPEN: "Needs manager",
        MANAGER_REVIEW: "Needs manager",
        STAFF_ACTION_REQUIRED: "Staff fixing",
        WAITING_SERVICE: "Waiting for service",
        RESOLVED: "Resolved",
      } as Record<string, string>
    )[state] ?? state.replaceAll("_", " ").toLowerCase()
  );
}
export function plainReason(code: string): string {
  const labels: Record<string, string> = {
    MANAGER_ACCEPTED: "Clean (manual approval)",
    AUTO_PASS_NOT_VALIDATED: "Cleaning needs your check",
    CANNOT_ASSESS: "Cleanliness needs a closer look",
    SERVICE_FAILURE: "Automatic check could not finish",
    PHOTO_TOO_DARK: "Photo is too dark",
    PHOTO_BLURRY: "Photo is blurred",
    PHOTO_TOO_SMALL: "Photo is too small",
    MISSING_EVIDENCE: "Required photo is missing",
    PRIVACY_HOLD: "Photo needs a privacy check",
    WRONG_ITEM: "Photo may show another fixture",
    MISSING_SURFACE: "Part of the fixture is not visible",
    CLEANING_REQUIRED: "More cleaning is needed",
    SETUP_REQUIRED: "Room inventory needs setup",
    REVIEW_REQUIRED: "This work needs your decision",
    MISSING_CHECKIN: "Not checked in",
    OVERDUE: "Cleaning is overdue",
    UNASSIGNED: "No worker assigned",
    DUPLICATE_EVIDENCE: "This photo may have been used before",
    OBJECT_UNCERTAIN: "The automatic check could not confirm the required object",
    VIEW_UNCERTAIN: "The automatic check could not confirm all required parts",
    IDENTITY_UNCERTAIN: "The fixture needs checking",
    CONTEXT_UNCERTAIN: "The room needs checking",
    GPS_UNCERTAIN: "Location needs checking",
    DAMAGED: "Repair needed",
    INACCESSIBLE: "Area could not be reached",
    OCCUPIED: "Room was occupied",
    CLEAN: "Clean",
    PASSED: "Photo passed",
    PROCESSING: "Photo received and being checked",
    MISSING: "No photo received",
    WAIVED: "Accepted with an exception",
    RECAPTURE_REQUIRED: "Photo did not pass",
    SQUAT_PAN: "Whole Indian toilet pan",
    PAN: "Toilet pan",
    BOWL_SEAT: "Bowl and seat",
    EXTERIOR_BASE: "Exterior and base",
    BASIN_DRAIN_TAP: "Basin, drain and tap",
    BASIN_TAP: "Basin, drain and tap",
    OPENING_INTERIOR: "Opening and interior",
    EXTERIOR: "Exterior and surrounding floor",
    WIDE_ZONE: "Whole floor zone",
    MANAGER_DECISION: "Manager decision recorded",
    COMPLETED: "Work completed",
    FOLLOW_UP_RESOLVED: "Follow-up work checked",
    REFLECTIVE_SURFACE: "Reflective surface",
    ENTRANCE: "Room entrance",
    LAYOUT: "Room layout",
  };
  return (
    labels[code] ??
    labels[code.toUpperCase()] ??
    "This work needs your decision"
  );
}
