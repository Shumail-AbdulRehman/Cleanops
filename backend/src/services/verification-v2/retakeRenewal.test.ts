import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../utils/ApiError.js';
import { createCaptureSession, reserveAttempt } from './captureSession.service.js';
import { processDirectPhoto } from './directPhoto.service.js';
import { assertRequiredReceipts } from './launchPhotoPolicy.js';
import { sha256 } from './quality.service.js';
import { activatePhotoSlot } from './sequentialCapture.service.js';

const m = vi.hoisted(() => ({
    tx: {} as any,
    access: vi.fn(),
    verifyQr: vi.fn(),
    store: vi.fn(),
}));

vi.mock('../../prisma/prisma.js', () => ({
    prisma: {
        $transaction: (run: (tx: any) => unknown) => run(m.tx),
        get verificationAttempt() { return m.tx.verificationAttempt; },
    },
}));
vi.mock('./authorization.service.js', () => ({ requireTaskAccess: m.access }));
vi.mock('./qr.service.js', () => ({
    verifyTaskQr: m.verifyQr,
    slotNonce: (_sessionId: string, slotId: string) => slotId,
    hashNonce: (nonce: string) => nonce,
}));
vi.mock('./launchQualification.js', () => ({ requireLaunchPhotoQualification: vi.fn() }));
vi.mock('./media.service.js', () => ({ storePrivateImage: m.store, discardPrivateImages: vi.fn(), privateImageBytes: vi.fn() }));
vi.mock('./completion.service.js', () => ({ finalizeTask: vi.fn() }));
vi.mock('./exception.service.js', () => ({ raiseIssue: vi.fn() }));
vi.mock('./quality.service.js', async importOriginal => ({
    ...await importOriginal<typeof import('./quality.service.js')>(),
    inspectImage: vi.fn(async (bytes: Buffer) => ({
        sha256: sha256(bytes), normalizedHash: 'normalized', perceptualHash: 'perceptual',
        format: 'jpeg', bytes: bytes.length, width: 1800, height: 1200, quality: { acceptable: false, reasons: ['BLURRY'] },
    })),
}));

const now = new Date('2026-11-21T10:00:00+05:00');
const actor = { id: 7, companyId: 1, role: 'STAFF' as const };
const binding = { taskId: 9, staffId: 7, assignmentEpoch: 2, assignmentId: 3 };
const task = {
    id: binding.taskId, staffId: binding.staffId, assignmentEpoch: binding.assignmentEpoch, isActive: true,
    status: 'IN_PROGRESS', verificationVersion: 2, areaId: 4, locationId: 5,
    startedAt: new Date(+now - 60_000), shiftEnd: new Date(+now + 3_600_000),
    location: { latitude: 0, longitude: 0, timezone: 'Asia/Karachi', radiusMeters: 100, isActive: true, company: { isActive: true } },
    assignments: [{ id: binding.assignmentId, staffId: binding.staffId, isCurrent: true, status: 'STARTED' }],
};
const area = { id: task.areaId, qrVersion: 1 };
const item = { id: 5, mandatory: true, typeSnapshot: 'SINK', rubricSnapshot: { version: 1 } };
const viewId: string = randomUUID();
const failedAttemptId = randomUUID();
const initialSessionId = randomUUID();
const deviceId = 'phone';
const bootId = 'boot';
const bytes = Buffer.from('fixture photo');
const provider = { evaluate: vi.fn() };
const unproven = {
    statusCode: 409,
    message: 'A current server-confirmed failed view is required for replacement.',
    errors: [{ code: 'REPLACEMENT_UNPROVEN' }],
};

let requirement: { id: string; state: string; decisionVersion: number; currentAttemptId: string | null; mandatory: boolean; item: typeof item; taskVerificationItemId: number; viewKey: string };
let sessions: Map<string, ReturnType<typeof sessionFixture>>;
let slots: Map<string, ReturnType<typeof slotFixture>>;
let attempts: Map<string, any>;

function sessionFixture(id: string) {
    return {
        id, taskInstanceId: task.id, task, staffId: actor.id, assignmentId: binding.assignmentId,
        assignmentEpoch: binding.assignmentEpoch, areaId: area.id, qrVersion: area.qrVersion,
        deviceId, clientBootId: bootId, state: 'ACTIVE', presenceStatus: 'ACCEPTABLE',
        issuedAt: new Date(+now - 10_000), captureExpiresAt: new Date(+now + 60_000),
        uploadExpiresAt: new Date(+now + 120_000),
        locationCheck: { captureWorkflow: 'SEQUENTIAL_CLEF_V1', captureContextPolicy: { version: 2, requiredKeys: [] } },
    };
}

function slotFixture(sessionId: string, generation: number, attemptId: string | null = null) {
    return {
        id: randomUUID(), sessionId, requirementId: viewId, contextKey: null, sequence: 0,
        generation, attemptId, activatedAt: null as Date | null, expiresAt: new Date(+now + 60_000),
    };
}

function slotsFor(sessionId: string) {
    return [...slots.values()].filter(slot => slot.sessionId === sessionId);
}

function readAttempt(id: string) {
    const attempt = attempts.get(id);
    return { ...attempt, session: sessions.get(attempt.sessionId), slot: slots.get(attempt.slotId), requirement };
}

function renew(sessionId: string, requestId = randomUUID()) {
    return createCaptureSession(actor, task.id, {
        requestId, areaQr: 'task-qr', deviceId, clientBootId: bootId, clientTime: new Date().toISOString(),
        location: { latitude: 0, longitude: 0, accuracy: 5, sampledAt: new Date().toISOString() },
    }, sessionId);
}

function reserve(session: { id: string; issuedAt: Date }, slot: { id: string; nonce?: string }) {
    return reserveAttempt(actor, session.id, {
        deviceId, slotId: slot.id, nonce: slot.nonce, sha256: sha256(bytes), bootId,
        claimedCapturedAt: new Date().toISOString(), elapsedMs: Date.now() - +session.issuedAt, clientCaptureId: randomUUID(),
    }, true);
}

beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(now);
    requirement = {
        id: viewId, state: 'RECAPTURE_REQUIRED', decisionVersion: 1, currentAttemptId: failedAttemptId,
        mandatory: true, item, taskVerificationItemId: item.id, viewKey: 'basin',
    };
    const failedSlot = slotFixture(initialSessionId, 0, failedAttemptId);
    sessions = new Map([[initialSessionId, sessionFixture(initialSessionId)]]);
    slots = new Map([[failedSlot.id, failedSlot]]);
    attempts = new Map([[failedAttemptId, {
        id: failedAttemptId, sessionId: initialSessionId, slotId: failedSlot.id, requirementId: viewId,
        staffId: actor.id, assignmentEpoch: binding.assignmentEpoch, receivedAt: now, state: 'RECAPTURE_REQUIRED',
    }]]);
    const requests = new Map<string, unknown>();
    m.access.mockResolvedValue(task);
    m.tx = {
        $queryRaw: vi.fn(),
        area: { findUnique: vi.fn().mockResolvedValue(area), findUniqueOrThrow: vi.fn().mockResolvedValue(area) },
        captureSession: {
            findFirst: vi.fn(({ where }) => [...sessions.values()].reverse().find(session =>
                session.taskInstanceId === where.taskInstanceId && session.assignmentEpoch === where.assignmentEpoch &&
                (!where.state || where.state.in.includes(session.state))) ?? null),
            findMany: vi.fn().mockResolvedValue([]),
            findUnique: vi.fn(({ where }) => sessions.get(where.id) ?? null),
            findUniqueOrThrow: vi.fn(({ where }) => ({ ...sessions.get(where.id), slots: slotsFor(where.id), attempts: [] })),
            count: vi.fn().mockResolvedValue(0),
            create: vi.fn(({ data }) => {
                const session = { ...sessionFixture(randomUUID()), ...data };
                sessions.set(session.id, session);
                return session;
            }),
            update: vi.fn(({ where, data }) => Object.assign(sessions.get(where.id)!, data)),
        },
        captureSlot: {
            findFirst: vi.fn(({ where }) => [...slots.values()].find(slot => {
                const { session: sessionFilter, ...slotFilter } = where;
                if (!Object.entries(slotFilter).every(([key, value]) => Reflect.get(slot, key) === value)) return false;
                if (!sessionFilter) return true;
                const session = sessions.get(slot.sessionId)!;
                const { state, ...bindingFilter } = sessionFilter;
                return session.state !== state.not &&
                    Object.entries(bindingFilter).every(([key, value]) => Reflect.get(session, key) === value);
            }) ?? null),
            findMany: vi.fn(({ where }) => where.contextKey ? [] : slotsFor(where.sessionId).map(slot => ({
                ...slot, requirement, attempt: attempts.get(slot.attemptId ?? ''),
            }))),
            create: vi.fn(({ data }) => {
                const slot = { ...slotFixture(data.sessionId, data.generation), ...data };
                slots.set(slot.id, slot);
                return slot;
            }),
            update: vi.fn(({ where, data }) => Object.assign(slots.get(where.id)!, data)),
        },
        verificationAttempt: {
            findMany: vi.fn().mockResolvedValue([]),
            count: vi.fn().mockResolvedValue(0),
            findUnique: vi.fn(({ where }) => where.id ? readAttempt(where.id) : null),
            findUniqueOrThrow: vi.fn(({ where }) => readAttempt(where.id)),
            create: vi.fn(({ data }) => {
                const attempt = { id: randomUUID(), mediaAssetId: null, qualityResult: null, cleanlinessResult: null, ...data };
                attempts.set(attempt.id, attempt);
                return attempt;
            }),
            update: vi.fn(({ where, data }) => Object.assign(attempts.get(where.id), data)),
        },
        verificationRequest: {
            findUnique: vi.fn(({ where }) => requests.get(JSON.stringify(where.companyId_actorRole_actorId_operation_requestId)) ?? null),
            create: vi.fn(({ data: { bodyHash, resultEntityId, ...key } }) => requests.set(JSON.stringify(key), { bodyHash, resultEntityId })),
        },
        taskEvidenceRequirement: {
            findMany: vi.fn(({ where }) => (where.state === 'PROCESSING' || where.state.notIn.includes(requirement.state)) ? [] : [requirement]),
            findUniqueOrThrow: vi.fn(() => requirement),
            update: vi.fn(({ data }) => {
                const { decisionVersion, ...fields } = data;
                Object.assign(requirement, fields);
                if (typeof decisionVersion === 'number') requirement.decisionVersion = decisionVersion;
                if (decisionVersion?.increment) requirement.decisionVersion += decisionVersion.increment;
            }),
        },
        taskVerificationItem: { findFirst: vi.fn().mockResolvedValue(item) },
        taskInstance: { update: vi.fn(), findUniqueOrThrow: vi.fn().mockResolvedValue(task) },
        staff: { findFirst: vi.fn().mockResolvedValue({ id: actor.id }) },
        evidenceAsset: { upsert: vi.fn().mockResolvedValue({ id: 'discarded-asset' }) },
    };
});

afterEach(() => vi.useRealTimers());

describe('QR retake renewal', () => {
    it('renews twice before upload, keeps the history, and only lets the newest slot upload', async () => {
        const requestId = randomUUID();
        const first = await renew(initialSessionId, requestId);
        expect(requirement).toMatchObject({ state: 'MISSING', decisionVersion: 2, currentAttemptId: failedAttemptId });
        expect(first.slots).toMatchObject([{ requirementId: viewId, generation: 2 }]);
        expect(() => assertRequiredReceipts([requirement], [{ ...readAttempt(failedAttemptId), media: { id: 'old' } }], new Set(), binding)).toThrow();

        const replay = await renew(initialSessionId, requestId);
        expect(replay.id).toBe(first.id);
        expect(replay.slots).toEqual(first.slots);
        const second = await renew(first.id);
        expect(second.slots).toMatchObject([{ requirementId: viewId, generation: 3 }]);
        await expect(reserve(first, first.slots[0]!)).rejects.toMatchObject({ statusCode: 410 });
        expect(slots.get(first.slots[0]!.id)?.attemptId).toBeNull();

        const [slot] = second.slots;
        await activatePhotoSlot(actor, second.id, { deviceId, slotId: slot!.id });
        const attempt = await reserve(second, slot!);
        expect(attempt).toMatchObject({ state: 'RESERVED', supersedesAttemptId: failedAttemptId });
        await expect(processDirectPhoto(actor, attempt.id, bytes, provider)).resolves.toMatchObject({
            attemptId: attempt.id, state: 'RECAPTURE_REQUIRED',
        });
        expect(requirement.currentAttemptId).toBe(attempt.id);
        expect(attempts.get(failedAttemptId)).toMatchObject({ state: 'RECAPTURE_REQUIRED' });
        expect(m.store).not.toHaveBeenCalled();
    });

    it('uses ordinary failed-view proof again after a replacement publishes a new failure', async () => {
        const first = await renew(initialSessionId);
        const [slot] = first.slots;
        await activatePhotoSlot(actor, first.id, { deviceId, slotId: slot!.id });
        const replacement = await reserve(first, slot!);
        await processDirectPhoto(actor, replacement.id, bytes, provider);
        expect(requirement).toMatchObject({ state: 'RECAPTURE_REQUIRED', decisionVersion: 3, currentAttemptId: replacement.id });

        const second = await renew(first.id);
        expect(second.slots).toMatchObject([{ requirementId: viewId, generation: 4 }]);
        expect(requirement).toMatchObject({ state: 'MISSING', decisionVersion: 4, currentAttemptId: replacement.id });
    });

    it('recovers a legacy row using its persisted unused replacement slot', async () => {
        requirement.decisionVersion = 2;
        const renewed = sessionFixture(randomUUID());
        const unused = slotFixture(renewed.id, 2);
        sessions.set(renewed.id, renewed);
        sessions.get(initialSessionId)!.state = 'EXPIRED';
        slots.set(unused.id, unused);

        const response = await renew(renewed.id);
        expect(response.slots).toMatchObject([{ requirementId: viewId, generation: 3 }]);
        expect(requirement).toMatchObject({ state: 'MISSING', decisionVersion: 3, currentAttemptId: failedAttemptId });
    });

    it.each([
        ['no slot', 2, null, {}],
        ['consumed slot', 2, { attemptId: 'used' }, {}],
        ['another view', 2, { requirementId: 'other-view' }, {}],
        ['another generation', 2, { generation: 1 }, {}],
        ['a larger generation gap', 3, { generation: 3 }, {}],
        ['revoked session', 2, {}, { state: 'REVOKED' }],
        ['another task', 2, {}, { taskInstanceId: 10 }],
        ['another worker', 2, {}, { staffId: 8 }],
        ['another assignment', 2, {}, { assignmentId: 4 }],
        ['another assignment epoch', 2, {}, { assignmentEpoch: 3 }],
        ['rotated QR authority', 2, {}, { qrVersion: 0 }],
    ] as const)('rejects legacy recovery with %s', async (_name, generation, slotPatch, sessionPatch) => {
        requirement.decisionVersion = generation;
        const proof = { ...sessionFixture(randomUUID()), state: 'EXPIRED', ...sessionPatch };
        sessions.set(proof.id, proof);
        if (slotPatch) {
            const slot = { ...slotFixture(proof.id, 2), ...slotPatch };
            slots.set(slot.id, slot);
        }

        await expect(renew(initialSessionId)).rejects.toMatchObject(unproven);
        expect(m.tx.taskEvidenceRequirement.update).not.toHaveBeenCalled();
        expect(m.tx.captureSlot.create).not.toHaveBeenCalled();
    });

    it('requires the original received failure even with an unused slot', async () => {
        requirement.decisionVersion = 2;
        attempts.get(failedAttemptId).receivedAt = null;
        const unused = slotFixture(initialSessionId, 2);
        slots.set(unused.id, unused);

        await expect(renew(initialSessionId)).rejects.toMatchObject(unproven);
        expect(m.tx.captureSlot.findFirst).not.toHaveBeenCalled();
    });

    it('requires a valid task QR before using legacy proof', async () => {
        requirement.decisionVersion = 2;
        const unused = slotFixture(initialSessionId, 2);
        slots.set(unused.id, unused);
        m.verifyQr.mockImplementationOnce(() => { throw new ApiError(422, 'Scan the QR code generated for this task'); });

        await expect(renew(initialSessionId)).rejects.toMatchObject({ statusCode: 422 });
        expect(m.tx.taskEvidenceRequirement.update).not.toHaveBeenCalled();
    });
});
