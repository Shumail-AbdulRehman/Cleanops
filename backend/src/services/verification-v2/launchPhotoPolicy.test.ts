import { describe, expect, it, vi } from 'vitest';
import { assertFailedViewReplacement, assertFailedContextReplacement, assertRequiredReceipts, authorizedWaiverReceipts } from './launchPhotoPolicy.js';
const now = new Date('2026-10-20T10:00:00Z');
const binding = { taskId: 9, staffId: 7, assignmentEpoch: 2, assignmentId: 3 };
const requirement = { id: 'required-view', state: 'RECAPTURE_REQUIRED', currentAttemptId: 'failed-attempt', decisionVersion: 1, mandatory: true, item: { mandatory: true } };
const task = { id: 9, status: 'IN_PROGRESS', isActive: true, staffId: 7, assignmentEpoch: 2, staffSubmittedAt: null };
const session = { id: 'current-session', taskInstanceId: 9, staffId: 7, assignmentId: 3, assignmentEpoch: 2, captureExpiresAt: new Date(+now + 60000), uploadExpiresAt: new Date(+now + 120000) };
const attempt = { id: 'failed-attempt', requirementId: requirement.id, state: 'RECAPTURE_REQUIRED', staffId: 7, assignmentEpoch: 2, receivedAt: now,
    slot: { generation: 0 }, session: { taskInstanceId: 9, staffId: 7, assignmentId: 3, assignmentEpoch: 2, state: 'ACTIVE' } };
const replacement = (patch: any = {}) => assertFailedViewReplacement({ task, session, staffId: 7, now, requirement, attempt, expectedGeneration: 1, ...patch });

describe('authorized legacy waiver receipts', () => {
    it('requires exact decision generation and same-company manager/owner provenance', async () => {
        const tx = { verificationDecision: { findMany: vi.fn(async () => [{ requirementId: 'waived', actorManagerId: 8, expectedDecisionVersion: 2 }]) },
            manager: { findMany: vi.fn(async () => [{ id: 8 }]) } };
        const rows = [{ id: 'waived', state: 'WAIVED', decisionVersion: 3, currentAttemptId: null }];
        expect(await authorizedWaiverReceipts(tx as any, { role: 'STAFF', id: 7, companyId: 1 }, 9, rows)).toEqual(new Set(['waived']));
        expect(tx.verificationDecision.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { action: 'WAIVE_REQUIREMENT', requirementId: { in: ['waived'] }, exception: { taskInstanceId: 9 } } }));
        expect(tx.manager.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: { in: [8] }, companyId: 1, role: { in: ['ADMIN', 'MANAGER'] } } }));
        rows[0]!.decisionVersion = 4;
        expect(await authorizedWaiverReceipts(tx as any, { role: 'STAFF', id: 7, companyId: 1 }, 9, rows)).toEqual(new Set());
    });
    it('does not accept a foreign actor or naked WAIVED label', async () => {
        const tx = { verificationDecision: { findMany: async () => [{ requirementId: 'waived', actorManagerId: 8, expectedDecisionVersion: 2 }] }, manager: { findMany: async () => [] } };
        expect(await authorizedWaiverReceipts(tx as any, { role: 'STAFF', id: 7, companyId: 1 }, 9, [{ id: 'waived', state: 'WAIVED', decisionVersion: 3, currentAttemptId: null }])).toEqual(new Set());
    });
});
describe('mandatory photo receipt reconciliation', () => {
    const required = { ...requirement, state: 'REVIEW_REQUIRED' };
    const received = { ...attempt, state: 'REVIEW_REQUIRED', media: { id: 'private-photo' } };
    it('permits mixed proven waived and received-review views without granting verification success', () => {
        const waiver = { ...requirement, id: 'waived', state: 'WAIVED', currentAttemptId: null };
        expect(() => assertRequiredReceipts([waiver, required], [received], new Set(['waived']), binding)).not.toThrow();
        expect(() => assertRequiredReceipts([waiver, { ...required, currentAttemptId: null }], [], new Set(['waived']), binding)).toThrow();
        expect(() => assertRequiredReceipts([waiver], [], new Set(), binding)).toThrow();
    });
    it.each([{ receivedAt: null }, { media: null }, { requirementId: 'different-view' }, { assignmentEpoch: 1 }, { staffId: 8 },
        { session: { ...attempt.session, taskInstanceId: 10 } }, { session: { ...attempt.session, assignmentId: 4 } }, { state: 'RECAPTURE_REQUIRED' }, { state: 'PROCESSING' }])('rejects missing/stale/foreign mandatory receipt %j', patch => {
        expect(() => assertRequiredReceipts([required], [{ ...received, ...patch }], new Set(), binding)).toThrow();
    });
    it('rejects empty required inventory rather than manufacturing completion', () => {
        expect(() => assertRequiredReceipts([], [], new Set(), binding)).toThrow();
    });
});
describe('server-confirmed immutable replacement authority', () => {
    it('allows only a current failed required view under existing authority', () => { expect(() => replacement()).not.toThrow(); });
    it('allows a held view replacement without accepting/revealing held evidence', () => {
        expect(() => replacement({ requirement: { ...requirement, state: 'REVIEW_REQUIRED' }, attempt: { ...attempt, state: 'PRIVACY_HOLD' } })).not.toThrow();
    });
    it('permits cleaning only under fresh QR rework authority, never generic retake', () => {
        const patch = { requirement: { ...requirement, state: 'CLEANING_REQUIRED' }, attempt: { ...attempt, state: 'CLEANING_REQUIRED' } };
        expect(() => replacement(patch)).toThrow(); expect(() => replacement({ ...patch, cleaning: true })).not.toThrow();
    });
    it.each([{ task: { ...task, staffSubmittedAt: now } }, { task: { ...task, status: 'COMPLETED' } }, { task: { ...task, isActive: false } },
        { task: { ...task, staffId: 8 } }, { task: { ...task, assignmentEpoch: 3 } }, { session: { ...session, captureExpiresAt: now } }, { session: { ...session, uploadExpiresAt: now } },
        { expectedGeneration: 0 }, { requirement: { ...requirement, state: 'PASSED' } }, { requirement: { ...requirement, state: 'MANAGER_ACCEPTED' } }, { requirement: { ...requirement, state: 'WAIVED' } },
        { requirement: { ...requirement, mandatory: false } }, { requirement: { ...requirement, item: { mandatory: false } } }, { requirement: { ...requirement, currentAttemptId: null } },
        { attempt: { ...attempt, state: 'PASSED' } }, { attempt: { ...attempt, receivedAt: null } }, { attempt: { ...attempt, assignmentEpoch: 1 } }, { attempt: { ...attempt, slot: { generation: 1 } } },
        { attempt: { ...attempt, session: { ...attempt.session, state: 'REVOKED' } } }, { attempt: { ...attempt, session: { ...attempt.session, taskInstanceId: 10 } } },
        { attempt: { ...attempt, session: { ...attempt.session, assignmentId: 4 } } }, { attempt: null }])('denies stale/submitted/success/cross-assignment or unproven replacement %j', patch => {
        expect(() => replacement(patch)).toThrow();
    });
    it('does not turn uncertain/service review into a failed-view proof', () => {
        for (const state of ['REVIEW_REQUIRED', 'SERVICE_FAILURE', 'RESERVED', 'CLEANLINESS_CHECK']) expect(() => replacement({ requirement: { ...requirement, state: 'REVIEW_REQUIRED' }, attempt: { ...attempt, state } })).toThrow();
    });
});

describe('legacy required context replacement',()=>{
 const context={...attempt,requirementId:null,contextKey:'ENTRANCE'};
 it('requires a real current failed context capture and generation',()=>{
  expect(()=>assertFailedContextReplacement({task,session,staffId:7,now,contextKey:'ENTRANCE',expectedGeneration:0,attempt:context})).not.toThrow();
  for(const change of [{contextKey:'LAYOUT'},{state:'REVIEW_REQUIRED'},{state:'PASSED'},{assignmentEpoch:1},{receivedAt:null}])
   expect(()=>assertFailedContextReplacement({task,session,staffId:7,now,contextKey:'ENTRANCE',expectedGeneration:0,attempt:{...context,...change} as any})).toThrow();
 });
});

it('a received attempt cannot cover a currently missing/failed/processing requirement',()=>{
 const receipt={...attempt,state:'REVIEW_REQUIRED',media:{id:'private-photo'}};
 for(const state of ['MISSING','PROCESSING','CLEANING_REQUIRED','RECAPTURE_REQUIRED']) expect(()=>assertRequiredReceipts([{...requirement,state}], [receipt],new Set(),binding)).toThrow();
});
