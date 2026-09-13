import type { VerificationSummary } from './presentation';
export type ReviewEvidenceSummary = { reasonCode: string | null; cleanliness: 'CLEAN'|'DIRTY'|'CANNOT_ASSESS'|null; dirtySurfaces: string[]; missingSurfaces: string[] };
export type EvidenceAttempt = { reviewSummary?: ReviewEvidenceSummary; id: string; state: string; manualOutcome?:'MANAGER_ACCEPTED'|'WAIVED'|null; mediaAssetId: string | null; createdAt: string; receivedAt?: string | null; staff?: { id: number; name: string }; requirementId?:string|null; contextKey?:string|null; requirement?:{viewKey:string;item:{nameSnapshot:string}}; instructions?: string; reasonCodes?: string[]; privacyState?: string };
export type EvidenceRequirement = { id: string; viewKey: string; instructionsSnapshot: string; mandatory: boolean; state: string; decisionVersion: number; currentAttemptId?: string | null; currentAttempt?: EvidenceAttempt | null; attempts?: EvidenceAttempt[] };
export type VerificationItem = { id: number; nameSnapshot: string; itemCodeSnapshot: string; typeSnapshot: string; mandatory: boolean; state: string; requirements: EvidenceRequirement[] };
export type VerificationManifest = {
  task: VerificationSummary & { id: number; title: string; shiftEnd: string; verificationDeadline?: string | null; uploadDeadline?: string | null; areaNameSnapshot?: string; areaId?: number; location?: {id: number; name: string; timezone: string} };
  area: {id: number; name: string}; items: VerificationItem[];
  progress: { passed: number; total: number; pending: number; failed: number };
  exceptions: Array<{id: number; state: string}>;
};
