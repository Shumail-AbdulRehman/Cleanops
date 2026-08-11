export type ReviewClosureAction = 'RESOLVE_REVIEW' | 'RECORD_PERFORMANCE_ISSUE';
export type PerformanceCategory = 'CLEANING_QUALITY'|'MISSING_PHOTOS'|'WRONG_PHOTO'|'INCOMPLETE_WORK'|'OTHER';
import type {
  EvidenceAttempt,
  EvidenceRequirement,
} from "../Verification/types";
export type ExceptionAction =
  | "ACCEPT_EVIDENCE"
  | "REJECT_EVIDENCE"
  | "REQUEST_RECAPTURE"
  | "REQUEST_CLEANING"
  | "MARK_MAINTENANCE"
  | "WAIVE_REQUIREMENT"
  | "EXTEND_WINDOW"
  | "RESOLVE_ISSUE"
  | "ACCEPT_CONTEXT";
export type VerificationIssue = {
  id: number;
  reasonCode: string;
  state: string;
  occurrences: number;
  recommendedAction: string;
  requirementId?: string | null;
  requirement?: EvidenceRequirement & {
    item?: { nameSnapshot: string };
    taskVerificationItem?: { nameSnapshot: string };
  };
  latestAttempt?: EvidenceAttempt | null;
  latestAttemptId?: string | null;
  firstSeenAt: string;
  lastSeenAt: string;
  blockedReason?: string | null;
  allowedActions?: ExceptionAction[];
  requiresFollowUp?: boolean;
};
export type VerificationException = {
  id: number;
  kind: "TASK" | "SETUP";
  state: string;
  priority: number;
  rowVersion: number;
  locationId: number;
  areaId?: number | null;
  taskInstanceId?: number | null;
  displayReasonCode?: string;
  openIssueCount?: number;
  firstRaisedAt: string;
  updatedAt: string;
  unread?: boolean;
  issues: VerificationIssue[];
  location?: { id: number; name: string; timezone: string };
  area?: { id: number; name: string };
  task?: {
    status?: string;
    verificationState?: string;
    completionOutcome?: string | null;
    id: number;
    title: string;
    shiftStart?: string;
    staffSubmittedAt?: string | null;
    verificationDeadline?: string | null;
    areaNameSnapshot?: string;
    shiftEnd: string;
    staff?: { id: number; name: string };
    assignments?: Array<{ staff?: { id: number; name: string } }>;
  };
  taskInstance?: VerificationException["task"];
};
export type ReviewReplacement = { policyEligible: boolean; available: boolean; processingAllowed: boolean; automaticApproval: boolean; reason: string; policyReason: string };
export type ExceptionDetail = VerificationException & {
  serverTime?: string;
  closureActions?: ReviewClosureAction[];
  performanceStaffOptions?: Array<{id:number;name:string}>;
  performanceIssueRecorded?: boolean;
  captureStatus?: {available:boolean;canExtend:boolean;deadline:string|null;reason:'AVAILABLE'|'DEADLINE_PASSED'|'COMPLETED'|'CANCELLED'|'INACTIVE'|'SUBMITTED'|'NOT_STARTED'|'UNAVAILABLE'};
  items?: Array<{
    id: number;
    nameSnapshot: string;
    sourceAreaItemId: number;
    mandatory?: boolean;
    requirements: Array<
      EvidenceRequirement & { allowedActions?: ExceptionAction[]; replacement?: ReviewReplacement }
    >;
  }>;
  standards?: Array<{
    id: number;
    caption: string | null;
    areaItemId: number | null;
    mediaAssetId: string;
  }>;
  allowedActions: ExceptionAction[];
  requiresFollowUp?: boolean;
  policyBounds?: { maxExtensionMinutes: number; extensionUsed: boolean };
  nextAttemptCursor?: string | null;
  nextDecisionCursor?: string | null;
  nextEventCursor?: string | null;
  decisions: Array<{
    id: number;
    action: string;
    reasonCode: string;
    note?: string | null;
    createdAt: string;
    actorManager?: { name: string };
  }>;
  events: Array<{ id: number; type: string; createdAt: string }>;
  attempts?: EvidenceAttempt[];
  nextCursor?: string | null;
  eventsNextCursor?: string | null;
};
