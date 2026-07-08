import { ApiError } from '../../utils/ApiError.js';
import { checkedAttempt } from './sequentialPolicy.js';
import type { VerificationActor } from './authorization.service.js';
import type { VerificationTransaction } from './transaction.js';

type Requirement = { id: string; state: string; decisionVersion: number; currentAttemptId: string | null };
/** A legacy state label alone is not a receipt. Preserve the exact authorized decision generation. */
export async function authorizedWaiverReceipts(tx: VerificationTransaction, actor: VerificationActor, taskId: number, requirements: Requirement[]) {
    const waived = requirements.filter(row => row.state === 'WAIVED');
    if (!waived.length) return new Set<string>();
    const decisions = await tx.verificationDecision.findMany({ where: { action: 'WAIVE_REQUIREMENT', requirementId: { in: waived.map(row => row.id) },
        exception: { taskInstanceId: taskId } }, select: { requirementId: true, actorManagerId: true, expectedDecisionVersion: true } });
    const managers = await tx.manager.findMany({ where: { id: { in: decisions.map(row => row.actorManagerId) }, companyId: actor.companyId,
        role: { in: ['ADMIN', 'MANAGER'] } }, select: { id: true } });
    const allowed = new Set(managers.map(row => row.id));
    return new Set(waived.filter(row => row.decisionVersion > 0 && decisions.some(decision => decision.requirementId === row.id &&
        decision.expectedDecisionVersion === row.decisionVersion - 1 && allowed.has(decision.actorManagerId))).map(row => row.id));
}

type Binding = { taskId: number; staffId: number; assignmentEpoch: number; assignmentId: number };
type Receipt = { id: string; requirementId: string | null; state: string; receivedAt: Date | null; media: unknown;
    staffId: number; assignmentEpoch: number; session: { taskInstanceId: number; staffId: number; assignmentEpoch: number; assignmentId: number } };
const sameAssignment = (attempt: Pick<Receipt, 'staffId' | 'assignmentEpoch' | 'session'>, binding: Binding) =>
    attempt.staffId === binding.staffId && attempt.assignmentEpoch === binding.assignmentEpoch && attempt.session.taskInstanceId === binding.taskId &&
    attempt.session.staffId === binding.staffId && attempt.session.assignmentEpoch === binding.assignmentEpoch && attempt.session.assignmentId === binding.assignmentId;
export function assertRequiredReceipts(requirements: Requirement[], attempts: Receipt[], waived: Set<string>, binding: Binding) {
    if (!requirements.length) throw new ApiError(409, 'Capture all required photos before finishing.', [{ code: 'MISSING_EVIDENCE' }]);
    for (const required of requirements) {
        if (required.state === 'WAIVED') {
            if (waived.has(required.id)) continue;
            throw new ApiError(409, 'The recorded waiver could not be verified.', [{ code: 'WAIVER_UNPROVEN' }]);
        }
        const attempt = attempts.find(row => row.id === required.currentAttemptId && row.requirementId === required.id);
        if (!['PASSED', 'MANAGER_ACCEPTED', 'REVIEW_REQUIRED'].includes(required.state) || !attempt || !attempt.receivedAt || !attempt.media || !checkedAttempt(attempt.state) || !sameAssignment(attempt, binding))
            throw new ApiError(409, 'Wait for all required photos to upload and finish checking.', [{ code: 'PHOTOS_NOT_CHECKED' }]);
    }
}

type TaskAuthority = { id: number; status: string; isActive: boolean; staffId: number | null; assignmentEpoch: number; staffSubmittedAt?: Date | null };
type SessionAuthority = { id: string; taskInstanceId: number; staffId: number; assignmentId: number; assignmentEpoch: number; captureExpiresAt: Date; uploadExpiresAt: Date };
type FailedAttempt = Omit<Receipt, 'media'> & { slot: { generation: number }; session: Receipt['session'] & { state: string } };
function authority(task: TaskAuthority, session: SessionAuthority, staffId: number, now: Date) {
    if (!task.isActive || task.staffSubmittedAt || !['IN_PROGRESS', 'NOT_COMPLETED_INTIME'].includes(task.status) || task.staffId !== staffId ||
        task.id !== session.taskInstanceId || session.staffId !== staffId || task.assignmentEpoch !== session.assignmentEpoch ||
        session.captureExpiresAt <= now || session.uploadExpiresAt <= now)
        throw new ApiError(409, 'Photo replacement is unavailable for this task.', [{ code: 'REPLACEMENT_UNAVAILABLE' }]);
}
type ViewReplacement = { task: TaskAuthority; session: SessionAuthority; staffId: number; now: Date;
    requirement: Requirement & { mandatory: boolean; item: { mandatory: boolean } }; attempt: FailedAttempt | null; expectedGeneration: number; cleaning?: boolean };
const unprovenViewReplacement = () => new ApiError(409, 'A current server-confirmed failed view is required for replacement.', [{ code: 'REPLACEMENT_UNPROVEN' }]);

function assertViewReplacement(input: ViewReplacement, failureGeneration: number) {
    const { task, session, staffId, requirement: row, attempt, expectedGeneration, cleaning = false, now } = input;
    authority(task, session, staffId, now);
    const binding = { taskId: task.id, staffId, assignmentEpoch: session.assignmentEpoch, assignmentId: session.assignmentId };
    const failure = cleaning ? row.state === 'CLEANING_REQUIRED' && attempt?.state === 'CLEANING_REQUIRED'
        : row.state === 'RECAPTURE_REQUIRED' && attempt?.state === 'RECAPTURE_REQUIRED' || row.state === 'REVIEW_REQUIRED' && attempt?.state === 'PRIVACY_HOLD';
    if (!row.mandatory || !row.item.mandatory || row.decisionVersion !== expectedGeneration || !attempt || row.currentAttemptId !== attempt.id ||
        attempt.requirementId !== row.id || !attempt.receivedAt || attempt.session.state === 'REVOKED' || !sameAssignment(attempt, binding) ||
        attempt.slot.generation !== failureGeneration || !failure)
        throw unprovenViewReplacement();
}

export function assertFailedViewReplacement(input: ViewReplacement) {
    assertViewReplacement(input, input.requirement.decisionVersion - 1);
}

/** Use only after verifying the task QR under the task and area locks. */
export async function assertLegacyRetakeRenewal(tx: VerificationTransaction, input: Omit<ViewReplacement, 'cleaning' | 'session'> & {
    session: SessionAuthority & { areaId: number; qrVersion: number };
}) {
    const { requirement, session } = input;
    assertViewReplacement(input, requirement.decisionVersion - 2);
    if (requirement.state !== 'RECAPTURE_REQUIRED') throw unprovenViewReplacement();

    const unusedSlot = await tx.captureSlot.findFirst({
        where: {
            requirementId: requirement.id,
            contextKey: null,
            generation: requirement.decisionVersion,
            attemptId: null,
            session: {
                taskInstanceId: session.taskInstanceId,
                areaId: session.areaId,
                qrVersion: session.qrVersion,
                staffId: session.staffId,
                assignmentId: session.assignmentId,
                assignmentEpoch: session.assignmentEpoch,
                state: { not: 'REVOKED' },
            },
        },
        select: { id: true },
    });
    if (!unusedSlot) throw unprovenViewReplacement();
}

export function assertFailedContextReplacement(input: { task: TaskAuthority; session: SessionAuthority; staffId: number; now: Date;
    contextKey: string; expectedGeneration: number; attempt: FailedAttempt & { contextKey: string | null } }) {
    const { task, session, staffId, now, attempt, contextKey, expectedGeneration } = input;
    authority(task, session, staffId, now);
    if (attempt.contextKey !== contextKey || attempt.requirementId !== null || !attempt.receivedAt || attempt.slot.generation !== expectedGeneration ||
        !['RECAPTURE_REQUIRED', 'PRIVACY_HOLD'].includes(attempt.state) || attempt.session.state === 'REVOKED' ||
        !sameAssignment(attempt, { taskId: task.id, staffId, assignmentId: session.assignmentId, assignmentEpoch: session.assignmentEpoch }))
        throw new ApiError(409, 'A current server-confirmed failed context view is required.', [{ code: 'REPLACEMENT_UNPROVEN' }]);
}
