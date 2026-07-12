import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import pg from "pg";
const source = process.env.VERIFICATION_TEST_DATABASE_URL;
if (!source) throw new Error("Set isolated VERIFICATION_TEST_DATABASE_URL");
const url = new URL(source);
if (
  !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) ||
  !url.pathname.startsWith("/priv_verification_test")
)
  throw new Error("Local priv_verification_test database required");
const database = `priv_verification_test_lifecycle_${Date.now()}`;
const admin = new pg.Client({ connectionString: source });
await admin.connect();
await admin.query(`CREATE DATABASE "${database}"`);
await admin.end();
url.pathname = `/${database}`;
process.env.DATABASE_URL = url.toString();
process.env.NODE_ENV = "test";
const client = new pg.Client({ connectionString: url.toString() });
await client.connect();
const root = new URL("../prisma/migrations/", import.meta.url);
for (const name of (await readdir(root)).filter((n) => /^\d/.test(n)).sort())
  await client.query(
    await readFile(new URL(`${name}/migration.sql`, root), "utf8"),
  );
await client.end();
const { prisma } = await import("../src/prisma/prisma.js");
const { finalizeTask } = await import(
  "../src/services/verification-v2/completion.service.js"
);
const { raiseIssue, managerDecision } = await import(
  "../src/services/verification-v2/exception.service.js"
);
const { expireVerificationTasks } = await import(
  "../src/services/verification-v2/deadline.service.js"
);
const company = await prisma.company.create({
  data: { name: "Lifecycle test" },
});
const location = await prisma.location.create({
  data: {
    companyId: company.id,
    name: "Test room",
    address: "test",
    latitude: "0",
    longitude: "0",
  },
});
const staff = await prisma.staff.create({
  data: {
    companyId: company.id,
    locationId: location.id,
    name: "Worker",
    email: `${randomUUID()}@test.invalid`,
    password: "test",
  },
});
const manager = await prisma.manager.create({
  data: {
    companyId: company.id,
    name: "Admin",
    email: `${randomUUID()}@test.invalid`,
    password: "test",
    role: "ADMIN",
  },
});
const actor = { id: manager.id, companyId: company.id, role: "ADMIN" as const };
const area = await prisma.area.create({
  data: {
    locationId: location.id,
    name: "Room",
    roomType: "WASHROOM",
    status: "ACTIVE",
  },
});
const fixture = await prisma.areaItem.create({
  data: {
    areaId: area.id,
    stableCode: "sink-1",
    displayName: "Sink",
    fixtureType: "SINK",
    sequence: 1,
    rubricKey: "sink",
    requiredViews: [],
  },
});
async function fresh(
  options: {
    presence?: string;
    end?: Date;
    state?: "MISSING" | "PROCESSING" | "PASSED";
    privacy?: string;
    hash?: string;
    normalizedHash?: string;
    after?: Date;
    viewKey?: string;
    scope?: {
      companyId: number;
      locationId: number;
      areaId: number;
      fixtureId: number;
      staffId: number;
    };
  } = {},
) {
  const scope = options.scope ?? {
    companyId: company.id,
    locationId: location.id,
    areaId: area.id,
    fixtureId: fixture.id,
    staffId: staff.id,
  };
  const now = new Date(),
    end = options.end ?? new Date(+now + 600000);
  const task = await prisma.taskInstance.create({
    data: {
      title: "Lifecycle",
      locationId: scope.locationId,
      areaId: scope.areaId,
      staffId: scope.staffId,
      verificationVersion: 2,
      areaNameSnapshot: area.name,
      inventoryVersion: 1,
      policySnapshot: { version: 1 },
      date: now,
      shiftStart: new Date(+end - 3600000),
      shiftEnd: end,
      startedAt: options.after ?? new Date(+end - 3000000),
      status: "IN_PROGRESS",
      verificationDeadline: new Date(+end + 1800000),
      uploadDeadline: new Date(+end + 2700000),
    },
  });
  const assignment = await prisma.taskAssignment.create({
    data: {
      taskInstanceId: task.id,
      staffId: scope.staffId,
      status: "STARTED",
      startedAt: task.startedAt,
    },
  });
  const item = await prisma.taskVerificationItem.create({
    data: {
      taskInstanceId: task.id,
      areaId: scope.areaId,
      sourceAreaItemId: scope.fixtureId,
      itemCodeSnapshot: fixture.stableCode,
      nameSnapshot: "Sink",
      typeSnapshot: "SINK",
      orderSnapshot: 1,
      identificationSnapshot: {},
      rubricSnapshot: {},
    },
  });
  const requirement = await prisma.taskEvidenceRequirement.create({
    data: {
      taskVerificationItemId: item.id,
      viewKey: options.viewKey ?? "basin",
      instructionsSnapshot: "Show basin",
      state: options.state ?? "PASSED",
    },
  });
  const session = await prisma.captureSession.create({
    data: {
      taskInstanceId: task.id,
      areaId: scope.areaId,
      staffId: scope.staffId,
      assignmentId: assignment.id,
      assignmentEpoch: task.assignmentEpoch,
      deviceId: "test",
      qrVersion: area.qrVersion,
      policyVersion: 1,
      captureExpiresAt: new Date(+end + 1800000),
      uploadExpiresAt: new Date(+end + 2700000),
      presenceStatus: options.presence ?? "ACCEPTABLE",
      contextStatus: "ACCEPTABLE",
      locationCheck: {},
      serverTimeAnchor: now,
      clientBootId: "test",
    },
  });
  async function evidence(
    context = false,
    privacy = options.privacy ?? "SAFE",
  ) {
    const slot = await prisma.captureSlot.create({
      data: {
        sessionId: session.id,
        ...(context
          ? { contextKey: "ENTRANCE" }
          : { requirementId: requirement.id }),
        sequence: context ? 0 : 1,
        nonceHash: "test",
        expiresAt: session.captureExpiresAt,
      },
    });
    const asset = await prisma.evidenceAsset.create({
      data: {
        companyId: scope.companyId,
        locationId: scope.locationId,
        taskInstanceId: task.id,
        originalPublicId: randomUUID(),
        format: "jpg",
        bytes: 1,
        width: 640,
        height: 640,
        sha256: options.hash ?? randomUUID(),
        normalizedHash: options.normalizedHash ?? null,
        privacyState: privacy,
      },
    });
    const attempt = await prisma.verificationAttempt.create({
      data: {
        sessionId: session.id,
        slotId: slot.id,
        ...(context
          ? { contextKey: "ENTRANCE" }
          : { requirementId: requirement.id }),
        staffId: scope.staffId,
        assignmentEpoch: task.assignmentEpoch,
        mediaAssetId: asset.id,
        clientCaptureId: randomUUID(),
        claimedCapturedAt: options.after ? now : new Date(+end - 1000),
        anchoredElapsedMs: 0n,
        timingEvidence: "ON_TIME_SERVER_OBSERVED",
        receivedAt: new Date(Math.min(+now, +end - 500)),
        state: "PASSED",
      },
    });
    if (!context)
      await prisma.taskEvidenceRequirement.update({
        where: { id: requirement.id },
        data: { currentAttemptId: attempt.id },
      });
    return attempt;
  }
  const attempt = await evidence();
  return { task, assignment, item, requirement, session, attempt, evidence };
}
async function decision(
  f: Awaited<ReturnType<typeof fresh>>,
  action: string,
  extra: Record<string, unknown> = {},
) {
  const c = await prisma.verificationException.findUniqueOrThrow({
    where: { taskInstanceId: f.task.id },
  });
  return managerDecision(actor, c.id, {
    requestId: randomUUID(),
    expectedVersion: c.rowVersion,
    action,
    reasonCode: "DAMAGED",
    note: "Lifecycle explicit decision",
    ...extra,
  });
}
try {
  const race = await fresh({ normalizedHash: "original-normalized" });
  await Promise.all(
    Array.from({ length: 3 }, () =>
      prisma.$transaction((tx) => finalizeTask(tx, race.task.id)),
    ),
  );
  assert.equal(
    (
      await prisma.taskInstance.findUniqueOrThrow({
        where: { id: race.task.id },
      })
    ).completionOutcome,
    "VERIFIED_COMPLETE",
  );
  assert.equal(
    await prisma.auditLog.count({
      where: { entityId: race.task.id, action: "VERIFICATION_COMPLETED" },
    }),
    1,
  );
  assert.equal(
    (
      await prisma.taskVerificationItem.findUniqueOrThrow({
        where: { id: race.item.id },
      })
    ).state,
    "PASSED",
  );
  const handover = await fresh();
  await prisma.taskInstance.update({
    where: { id: handover.task.id },
    data: { assignmentEpoch: { increment: 1 } },
  });
  assert.equal(
    await prisma.$transaction((tx) => finalizeTask(tx, handover.task.id)),
    "VERIFIED_COMPLETE",
  );
  const privacy = await fresh({ privacy: "HOLD" });
  await prisma.$transaction((tx) =>
    raiseIssue(
      tx,
      privacy.task.id,
      "PRIVACY_HOLD",
      privacy.requirement.id,
      privacy.attempt.id,
    ),
  );
  await assert.rejects(() =>
    decision(privacy, "ACCEPT_EVIDENCE", {
      requirementId: privacy.requirement.id,
      evidenceAttemptId: privacy.attempt.id,
    }),
  );
  await decision(privacy, "WAIVE_REQUIREMENT", {
    requirementId: privacy.requirement.id,
  });
  assert.equal(
    (
      await prisma.taskInstance.findUniqueOrThrow({
        where: { id: privacy.task.id },
      })
    ).status,
    "IN_PROGRESS",
  );
  const presence = await fresh({ presence: "UNCERTAIN" });
  await prisma.$transaction((tx) =>
    raiseIssue(tx, presence.task.id, "GPS_UNCERTAIN"),
  );
  await decision(presence, "ACCEPT_EVIDENCE", {
    requirementId: presence.requirement.id,
    evidenceAttemptId: presence.attempt.id,
  });
  assert.equal(
    (
      await prisma.taskInstance.findUniqueOrThrow({
        where: { id: presence.task.id },
      })
    ).status,
    "IN_PROGRESS",
  );
  const context = await presence.evidence(true);
  await decision(presence, "ACCEPT_CONTEXT", { evidenceAttemptId: context.id });
  assert.equal(
    (
      await prisma.taskInstance.findUniqueOrThrow({
        where: { id: presence.task.id },
      })
    ).completionOutcome,
    "COMPLETED_WITH_EXCEPTIONS",
  );
  const maintenance = await fresh({ state: "MISSING" });
  await prisma.$transaction((tx) =>
    raiseIssue(tx, maintenance.task.id, "DAMAGED", maintenance.requirement.id),
  );
  const templates = await Promise.all(
    ["ALL", "SUBSET"].map(async (selection) => {
      const t = await prisma.taskTemplate.create({
        data: {
          title: selection,
          locationId: location.id,
          areaId: area.id,
          verificationVersion: 2,
          inventoryConfigVersion: 1,
          inventorySelection: selection as "ALL" | "SUBSET",
          setupStatus: "READY",
          shiftStart: new Date(),
          shiftEnd: new Date(Date.now() + 3600000),
          effectiveDate: new Date(),
        },
      });
      if (selection === "SUBSET")
        await prisma.taskTemplateItem.create({
          data: { templateId: t.id, areaId: area.id, areaItemId: fixture.id },
        });
      return t;
    }),
  );
  const original = await prisma.area.findUniqueOrThrow({
    where: { id: area.id },
  });
  await decision(maintenance, "MARK_MAINTENANCE", {
    requirementId: maintenance.requirement.id,
  });
  assert.equal(
    (
      await prisma.taskEvidenceRequirement.findUniqueOrThrow({
        where: { id: maintenance.requirement.id },
      })
    ).state,
    "MISSING",
  );
  assert.equal(
    (await prisma.area.findUniqueOrThrow({ where: { id: area.id } }))
      .inventoryVersion,
    original.inventoryVersion + 1,
  );
  for (const t of templates)
    assert.equal(
      (await prisma.taskTemplate.findUniqueOrThrow({ where: { id: t.id } }))
        .setupStatus,
      "NEEDS_REVIEW",
    );
  await decision(maintenance, "WAIVE_REQUIREMENT", {
    requirementId: maintenance.requirement.id,
  });
  assert.equal(
    (
      await prisma.taskInstance.findUniqueOrThrow({
        where: { id: maintenance.task.id },
      })
    ).completionOutcome,
    "COMPLETED_WITH_EXCEPTIONS",
  );
  const extension = await fresh({
    state: "MISSING",
    end: new Date(Date.now() - 60000),
  });
  await prisma.$transaction((tx) =>
    raiseIssue(tx, extension.task.id, "MISSING_EVIDENCE"),
  );
  const c = await prisma.verificationException.findUniqueOrThrow({
    where: { taskInstanceId: extension.task.id },
  });
  const input = {
    requestId: randomUUID(),
    expectedVersion: c.rowVersion,
    action: "EXTEND_WINDOW",
    reasonCode: "MISSING_EVIDENCE",
    note: "Bounded extension",
    extensionMinutes: 60,
  };
  const d = await managerDecision(actor, c.id, input);
  assert.equal((await managerDecision(actor, c.id, input)).id, d.id);
  await assert.rejects(() => decision(extension, "EXTEND_WINDOW"));
  const extended = await prisma.taskInstance.findUniqueOrThrow({
    where: { id: extension.task.id },
  });
  assert.equal(+extended.shiftEnd, +extension.task.shiftEnd);
  assert.equal(+extended.verificationDeadline!, +extended.shiftEnd + 3600000);
  const cutoff = await fresh({
    state: "PROCESSING",
    end: new Date(Date.now() - 3600000),
  });
  await prisma.verificationAttempt.update({
    where: { id: cutoff.attempt.id },
    data: { state: "CLEANLINESS_CHECK" },
  });
  await prisma.verificationJob.create({
    data: {
      companyId: company.id,
      attemptId: cutoff.attempt.id,
      stage: "CLEANLINESS",
      evaluatorVersion: "test",
    },
  });
  await expireVerificationTasks();
  assert.equal(
    await prisma.verificationException.count({
      where: { taskInstanceId: cutoff.task.id },
    }),
    0,
  );
  assert.equal(
    (
      await prisma.taskAssignment.findUniqueOrThrow({
        where: { id: cutoff.assignment.id },
      })
    ).isCurrent,
    true,
  );
  assert.equal(
    (
      await prisma.taskInstance.findUniqueOrThrow({
        where: { id: cutoff.task.id },
      })
    ).verificationState,
    "PROCESSING",
  );
  await prisma.verificationJob.updateMany({
    where: { attemptId: cutoff.attempt.id },
    data: { state: "SUCCEEDED" },
  });
  await prisma.verificationAttempt.update({
    where: { id: cutoff.attempt.id },
    data: { state: "PASSED" },
  });
  await prisma.taskEvidenceRequirement.update({
    where: { id: cutoff.requirement.id },
    data: { state: "PASSED" },
  });
  assert.equal(
    await prisma.$transaction((tx) => finalizeTask(tx, cutoff.task.id)),
    "VERIFIED_COMPLETE",
  );
  const spam = await fresh({ state: "PROCESSING" });
  await prisma.verificationAttempt.update({
    where: { id: spam.attempt.id },
    data: { state: "CLEANING_REQUIRED" },
  });
  assert.equal(
    await prisma.$transaction((tx) =>
      raiseIssue(
        tx,
        spam.task.id,
        "CLEANING_REQUIRED",
        spam.requirement.id,
        spam.attempt.id,
      ),
    ),
    null,
  );
  assert.equal(
    await prisma.verificationException.count({
      where: { taskInstanceId: spam.task.id },
    }),
    0,
  );
  const serious = await prisma.$transaction((tx) =>
    raiseIssue(
      tx,
      spam.task.id,
      "DAMAGED",
      spam.requirement.id,
      spam.attempt.id,
    ),
  );
  assert.ok(serious);
  await prisma.$transaction((tx) =>
    raiseIssue(
      tx,
      spam.task.id,
      "DAMAGED",
      spam.requirement.id,
      spam.attempt.id,
    ),
  );
  assert.equal(
    await prisma.exceptionEvent.count({
      where: { exceptionId: serious.id, type: "ISSUE_RAISED" },
    }),
    1,
  );
  const optional = await fresh();
  const optionalRequirement = await prisma.taskEvidenceRequirement.create({
    data: {
      taskVerificationItemId: optional.item.id,
      viewKey: "optional",
      instructionsSnapshot: "Optional photo",
      mandatory: false,
      state: "PROCESSING",
    },
  });
  const optionalSlot = await prisma.captureSlot.create({
    data: {
      sessionId: optional.session.id,
      requirementId: optionalRequirement.id,
      sequence: 2,
      nonceHash: "test",
      expiresAt: optional.session.captureExpiresAt,
    },
  });
  const optionalAttempt = await prisma.verificationAttempt.create({
    data: {
      sessionId: optional.session.id,
      slotId: optionalSlot.id,
      requirementId: optionalRequirement.id,
      staffId: staff.id,
      assignmentEpoch: 0,
      clientCaptureId: randomUUID(),
      claimedCapturedAt: new Date(),
      anchoredElapsedMs: 0n,
      timingEvidence: "ON_TIME_SERVER_OBSERVED",
      state: "CLEANLINESS_CHECK",
      mediaAssetId: optional.attempt.mediaAssetId,
      receivedAt: new Date(),
    },
  });
  await prisma.taskEvidenceRequirement.update({
    where: { id: optionalRequirement.id },
    data: { currentAttemptId: optionalAttempt.id },
  });
  const optionalJob = await prisma.verificationJob.create({
    data: {
      companyId: company.id,
      attemptId: optionalAttempt.id,
      stage: "PRIVACY",
      evaluatorVersion: "test",
    },
  });
  assert.equal(
    await prisma.$transaction((tx) => finalizeTask(tx, optional.task.id)),
    "VERIFIED_COMPLETE",
    "retired queue jobs cannot block completion of safe media",
  );
  await prisma.verificationJob.update({
    where: { id: optionalJob.id },
    data: { stage: "CLEANLINESS" },
  });
  assert.equal(
    await prisma.$transaction((tx) => finalizeTask(tx, optional.task.id)),
    "VERIFIED_COMPLETE",
    "optional cleanliness pending does not block",
  );
  const heldOptional = await fresh();
  const heldRequirement = await prisma.taskEvidenceRequirement.create({
    data: {
      taskVerificationItemId: heldOptional.item.id,
      viewKey: "optional-hold",
      instructionsSnapshot: "Optional",
      mandatory: false,
      state: "WAIVED",
    },
  });
  const heldSlot = await prisma.captureSlot.create({
    data: {
      sessionId: heldOptional.session.id,
      requirementId: heldRequirement.id,
      sequence: 2,
      nonceHash: "test",
      expiresAt: heldOptional.session.captureExpiresAt,
    },
  });
  const heldAsset = await prisma.evidenceAsset.create({
    data: {
      companyId: company.id,
      locationId: location.id,
      taskInstanceId: heldOptional.task.id,
      originalPublicId: randomUUID(),
      format: "jpg",
      bytes: 1,
      width: 640,
      height: 640,
      sha256: randomUUID(),
      privacyState: "HOLD",
    },
  });
  const heldAttempt = await prisma.verificationAttempt.create({
    data: {
      sessionId: heldOptional.session.id,
      slotId: heldSlot.id,
      requirementId: heldRequirement.id,
      staffId: staff.id,
      assignmentEpoch: 0,
      clientCaptureId: randomUUID(),
      claimedCapturedAt: new Date(),
      anchoredElapsedMs: 0n,
      timingEvidence: "ON_TIME_SERVER_OBSERVED",
      state: "PRIVACY_HOLD",
      mediaAssetId: heldAsset.id,
      receivedAt: new Date(),
    },
  });
  await prisma.taskEvidenceRequirement.update({
    where: { id: heldRequirement.id },
    data: { currentAttemptId: heldAttempt.id },
  });
  assert.equal(
    await prisma.$transaction((tx) => finalizeTask(tx, heldOptional.task.id)),
    null,
    "optional waived privacy hold blocks even without a raised issue",
  );
  const missingContext = await fresh({
    state: "PROCESSING",
    end: new Date(Date.now() - 3600000),
  });
  await prisma.captureSession.update({
    where: { id: missingContext.session.id },
    data: { contextStatus: "PENDING" },
  });
  await expireVerificationTasks();
  assert.equal(
    await prisma.verificationException.count({
      where: { taskInstanceId: missingContext.task.id },
    }),
    1,
    "missing context raises one task case",
  );
  const contextProcessing = await fresh({
    state: "PROCESSING",
    end: new Date(Date.now() - 3600000),
  });
  await prisma.captureSession.update({
    where: { id: contextProcessing.session.id },
    data: { contextStatus: "PENDING" },
  });
  const entrance = await contextProcessing.evidence(true);
  const layoutSlot = await prisma.captureSlot.create({
    data: {
      sessionId: contextProcessing.session.id,
      contextKey: "LAYOUT",
      sequence: 3,
      nonceHash: "test",
      expiresAt: contextProcessing.session.captureExpiresAt,
    },
  });
  await prisma.verificationAttempt.create({
    data: {
      sessionId: contextProcessing.session.id,
      slotId: layoutSlot.id,
      contextKey: "LAYOUT",
      staffId: staff.id,
      assignmentEpoch: 0,
      clientCaptureId: randomUUID(),
      claimedCapturedAt: new Date(),
      anchoredElapsedMs: 0n,
      timingEvidence: "ON_TIME_SERVER_OBSERVED",
      state: "COVERAGE_CHECK",
      mediaAssetId: entrance.mediaAssetId,
      receivedAt: new Date(),
    },
  });
  await expireVerificationTasks();
  assert.equal(
    await prisma.verificationException.count({
      where: { taskInstanceId: contextProcessing.task.id },
    }),
    0,
    "received context awaiting assessment does not alert",
  );
  // A received historical context cannot satisfy a missing newly allocated generation.
  const retakeSlot = await prisma.captureSlot.create({
    data: {
      sessionId: contextProcessing.session.id,
      contextKey: "ENTRANCE",
      generation: 1,
      sequence: 4,
      nonceHash: "test",
      expiresAt: contextProcessing.session.captureExpiresAt,
    },
  });
  await expireVerificationTasks();
  const retakeCase = await prisma.verificationException.findUniqueOrThrow({
    where: { taskInstanceId: contextProcessing.task.id },
  });
  assert.equal(
    await prisma.verificationIssue.count({
      where: { exceptionId: retakeCase.id, reasonCode: "MISSING_EVIDENCE" },
    }),
    1,
  );
  await prisma.verificationAttempt.create({
    data: {
      sessionId: contextProcessing.session.id,
      slotId: retakeSlot.id,
      contextKey: "ENTRANCE",
      staffId: staff.id,
      assignmentEpoch: 0,
      clientCaptureId: randomUUID(),
      claimedCapturedAt: new Date(),
      anchoredElapsedMs: 0n,
      timingEvidence: "ON_TIME_SERVER_OBSERVED",
      state: "COVERAGE_CHECK",
      mediaAssetId: entrance.mediaAssetId,
      receivedAt: new Date(),
    },
  });
  await expireVerificationTasks();
  assert.equal(
    (
      await prisma.taskInstance.findUniqueOrThrow({
        where: { id: contextProcessing.task.id },
      })
    ).verificationState,
    "PROCESSING",
    "current received context can continue asynchronous checks",
  );
  const service = await fresh({ state: "PROCESSING" });
  await prisma.verificationAttempt.update({
    where: { id: service.attempt.id },
    data: { state: "REVIEW_REQUIRED" },
  });
  await prisma.$transaction((tx) =>
    raiseIssue(
      tx,
      service.task.id,
      "SERVICE_FAILURE",
      service.requirement.id,
      service.attempt.id,
    ),
  );
  await decision(service, "ACCEPT_EVIDENCE", {
    requirementId: service.requirement.id,
    evidenceAttemptId: service.attempt.id,
  });
  assert.equal(
    (
      await prisma.taskInstance.findUniqueOrThrow({
        where: { id: service.task.id },
      })
    ).status,
    "IN_PROGRESS",
  );
  let issue = await prisma.verificationIssue.findFirstOrThrow({
    where: {
      exception: { taskInstanceId: service.task.id },
      reasonCode: "SERVICE_FAILURE",
    },
  });
  await decision(service, "RESOLVE_ISSUE", {
    issueId: issue.id,
    requirementId: service.requirement.id,
  });
  assert.equal(
    (
      await prisma.taskInstance.findUniqueOrThrow({
        where: { id: service.task.id },
      })
    ).completionOutcome,
    "COMPLETED_WITH_EXCEPTIONS",
  );
  const duplicate = await fresh({ state: "PROCESSING" });
  await prisma.$transaction((tx) =>
    raiseIssue(
      tx,
      duplicate.task.id,
      "DUPLICATE_EVIDENCE",
      duplicate.requirement.id,
      duplicate.attempt.id,
    ),
  );
  await decision(duplicate, "WAIVE_REQUIREMENT", {
    requirementId: duplicate.requirement.id,
  });
  issue = await prisma.verificationIssue.findFirstOrThrow({
    where: { exception: { taskInstanceId: duplicate.task.id } },
  });
  await decision(duplicate, "RESOLVE_ISSUE", { issueId: issue.id });
  assert.equal(
    (
      await prisma.taskInstance.findUniqueOrThrow({
        where: { id: duplicate.task.id },
      })
    ).completionOutcome,
    "COMPLETED_WITH_EXCEPTIONS",
  );
  const stale = await fresh({ state: "PROCESSING" });
  const staleContext = await stale.evidence(true);
  await prisma.verificationAttempt.update({
    where: { id: stale.attempt.id },
    data: { state: "REVIEW_REQUIRED" },
  });
  await prisma.taskInstance.update({
    where: { id: stale.task.id },
    data: { assignmentEpoch: { increment: 1 } },
  });
  await prisma.captureSession.update({
    where: { id: stale.session.id },
    data: { state: "REVOKED", closedAt: new Date() },
  });
  await prisma.$transaction((tx) =>
    raiseIssue(
      tx,
      stale.task.id,
      "STALE_ASSIGNMENT",
      stale.requirement.id,
      stale.attempt.id,
    ),
  );
  await decision(stale, "ACCEPT_EVIDENCE", {
    requirementId: stale.requirement.id,
    evidenceAttemptId: stale.attempt.id,
  });
  issue = await prisma.verificationIssue.findFirstOrThrow({
    where: { exception: { taskInstanceId: stale.task.id } },
  });
  await assert.rejects(() =>
    decision(stale, "RESOLVE_ISSUE", { issueId: issue.id }),
  );
  await decision(stale, "ACCEPT_CONTEXT", {
    evidenceAttemptId: staleContext.id,
  });
  await decision(stale, "RESOLVE_ISSUE", { issueId: issue.id });
  assert.equal(
    (
      await prisma.taskInstance.findUniqueOrThrow({
        where: { id: stale.task.id },
      })
    ).completionOutcome,
    "COMPLETED_WITH_EXCEPTIONS",
  );
  issue = await prisma.verificationIssue.findFirstOrThrow({
    where: { exception: { taskInstanceId: privacy.task.id } },
  });
  await assert.rejects(() =>
    decision(privacy, "RESOLVE_ISSUE", { issueId: issue.id }),
  );
  const privateReplacement = await privacy.evidence(false, "SAFE");
  await prisma.verificationAttempt.update({
    where: { id: privateReplacement.id },
    data: { state: "REVIEW_REQUIRED" },
  });
  await decision(privacy, "ACCEPT_EVIDENCE", {
    requirementId: privacy.requirement.id,
    evidenceAttemptId: privateReplacement.id,
  });
  await decision(privacy, "RESOLVE_ISSUE", { issueId: issue.id });
  assert.equal(
    (
      await prisma.taskInstance.findUniqueOrThrow({
        where: { id: privacy.task.id },
      })
    ).completionOutcome,
    "COMPLETED_WITH_EXCEPTIONS",
  );
  assert.equal(
    (
      await prisma.evidenceAsset.findUniqueOrThrow({
        where: { id: privacy.attempt.mediaAssetId! },
      })
    ).privacyState,
    "HOLD",
    "held original stays quarantined",
  );
  const { default: router } = await import(
    "../src/routes/verificationException.route.js"
  );
  async function route(
    path: string,
    method: string,
    params: Record<string, string>,
    query: Record<string, string> = {},
    user = actor,
  ) {
    const layer = (router as any).stack.find(
      (l: any) => l.route?.path === path && l.route.methods[method],
    );
    assert.ok(layer);
    let payload: any;
    await layer.route.stack[0].handle(
      { user, params, query, body: {} },
      {
        json: (value: any) => {
          payload = value;
        },
      },
      (error: unknown) => {
        if (error) throw error;
      },
    );
    return payload.data;
  }
  const detail = await route("/verification-exceptions/:id", "get", {
    id: String(serious.id),
  });
  assert.ok(detail.allowedActions.includes("EXTEND_WINDOW"));
  assert.equal(detail.policyBounds.maxExtensionMinutes, 120);
  assert.ok(detail.issues[0].recommendedAction);
  assert.ok(detail.task.title);
  await assert.rejects(() =>
    route(
      "/verification-exceptions/:id",
      "get",
      { id: String(serious.id) },
      { attemptCursor: race.attempt.id },
    ),
  );
  const inboxBefore = await route(
    "/verification-exceptions",
    "get",
    {},
    { state: "MANAGER_REVIEW" },
  );
  assert.ok(inboxBefore.unreadCount > 0);
  await route("/verification-exceptions/:id/read", "post", {
    id: String(serious.id),
  });
  const inboxAfter = await route(
    "/verification-exceptions",
    "get",
    {},
    { state: "MANAGER_REVIEW" },
  );
  assert.equal(inboxAfter.unreadCount, inboxBefore.unreadCount - 1);
  const privacyCase = await prisma.verificationException.findUniqueOrThrow({
    where: { taskInstanceId: privacy.task.id },
  });
  const privacyDetail = await route("/verification-exceptions/:id", "get", {
    id: String(privacyCase.id),
  });
  // Authorized managers may inspect the audited HOLD review variant. This
  // descriptor does not grant acceptance or access to the original bytes.
  assert.equal(privacyDetail.attempts.find((a: any) => a.id === privacy.attempt.id).privacyState, 'HOLD');
  assert.equal(
    privacyDetail.attempts.find((a: any) => a.id === privacy.attempt.id).mediaAssetId,
    (await prisma.verificationAttempt.findUniqueOrThrow({where:{id:privacy.attempt.id}})).mediaAssetId,
  );
  const superseded = await fresh({ state: "PROCESSING" });
  await superseded.evidence();
  await prisma.taskEvidenceRequirement.update({
    where: { id: superseded.requirement.id },
    data: { state: "PASSED", decisionVersion: { increment: 1 } },
  });
  const staleJob = await prisma.verificationJob.create({
    data: {
      companyId: company.id,
      attemptId: superseded.attempt.id,
      stage: "CLEANLINESS",
      evaluatorVersion: "superseded-test",
      state: "RUNNING",
      attempts: 4,
      leaseToken: randomUUID(),
      leaseUntil: new Date(Date.now() + 90000),
    },
  });
  const { failVerificationJob } = await import(
    "../src/services/verification-v2/jobQueue.service.js"
  );
  assert.equal(await failVerificationJob(staleJob), true);
  assert.equal(
    (
      await prisma.verificationJob.findUniqueOrThrow({
        where: { id: staleJob.id },
      })
    ).state,
    "FAILED",
  );
  assert.equal(
    await prisma.verificationException.count({
      where: { taskInstanceId: superseded.task.id },
    }),
    0,
    "exhausted superseded job stays historical without blocking current passed generation",
  );
  // Completed concerns are resolved through durable, scoped follow-up evidence only.
  const originalSnapshot = await prisma.taskInstance.findUniqueOrThrow({
    where: { id: race.task.id },
  });
  const originalRequirements = await prisma.taskEvidenceRequirement.findMany({
    where: { item: { taskInstanceId: race.task.id } },
  });
  const originalAssignments = await prisma.taskAssignment.findMany({
    where: { taskInstanceId: race.task.id },
  });
  await prisma.evidenceAsset.update({
    where: { id: race.attempt.mediaAssetId! },
    data: { privacyState: "HOLD" },
  });
  const lateCase = await prisma.$transaction((tx) =>
    raiseIssue(
      tx,
      race.task.id,
      "PRIVACY_HOLD",
      race.requirement.id,
      race.attempt.id,
    ),
  );
  assert.ok(lateCase);
  const lateIssue = await prisma.verificationIssue.findFirstOrThrow({
    where: { exceptionId: lateCase.id },
  });
  await assert.rejects(() =>
    decision(race, "WAIVE_REQUIREMENT", { requirementId: race.requirement.id }),
  );
  await assert.rejects(() =>
    decision(race, "RESOLVE_ISSUE", { issueId: lateIssue.id }),
  );
  await assert.rejects(() =>
    decision(race, "RESOLVE_ISSUE", {
      issueId: lateIssue.id,
      followUpTaskInstanceId: race.task.id,
    }),
  );
  const olderFollowUp = await fresh();
  await prisma.$transaction((tx) => finalizeTask(tx, olderFollowUp.task.id));
  await assert.rejects(() =>
    decision(race, "RESOLVE_ISSUE", {
      issueId: lateIssue.id,
      followUpTaskInstanceId: olderFollowUp.task.id,
    }),
  );
  const pendingFollowUp = await fresh({ after: new Date() });
  await assert.rejects(() =>
    decision(race, "RESOLVE_ISSUE", {
      issueId: lateIssue.id,
      followUpTaskInstanceId: pendingFollowUp.task.id,
    }),
  );
  const safeFollowUp = await fresh({ after: new Date(), state: "PROCESSING" });
  await prisma.verificationAttempt.update({
    where: { id: safeFollowUp.attempt.id },
    data: { state: "REVIEW_REQUIRED" },
  });
  await prisma.$transaction((tx) =>
    raiseIssue(
      tx,
      safeFollowUp.task.id,
      "DAMAGED",
      safeFollowUp.requirement.id,
    ),
  );
  await decision(safeFollowUp, "ACCEPT_EVIDENCE", {
    requirementId: safeFollowUp.requirement.id,
    evidenceAttemptId: safeFollowUp.attempt.id,
  });
  assert.equal(
    (
      await prisma.taskInstance.findUniqueOrThrow({
        where: { id: safeFollowUp.task.id },
      })
    ).completionOutcome,
    "COMPLETED_WITH_EXCEPTIONS",
  );
  const unsafeFollowUp = await fresh({ after: new Date() });
  await prisma.$transaction((tx) => finalizeTask(tx, unsafeFollowUp.task.id));
  await prisma.evidenceAsset.update({
    where: { id: unsafeFollowUp.attempt.mediaAssetId! },
    data: { privacyState: "HOLD" },
  });
  await assert.rejects(() =>
    decision(race, "RESOLVE_ISSUE", {
      issueId: lateIssue.id,
      followUpTaskInstanceId: unsafeFollowUp.task.id,
    }),
  );
  const waivedFollowUp = await fresh({ after: new Date(), state: "MISSING" });
  await prisma.$transaction((tx) =>
    raiseIssue(
      tx,
      waivedFollowUp.task.id,
      "DAMAGED",
      waivedFollowUp.requirement.id,
    ),
  );
  await decision(waivedFollowUp, "WAIVE_REQUIREMENT", {
    requirementId: waivedFollowUp.requirement.id,
  });
  await assert.rejects(() =>
    decision(race, "RESOLVE_ISSUE", {
      issueId: lateIssue.id,
      followUpTaskInstanceId: waivedFollowUp.task.id,
    }),
  );
  const wrongView = await fresh({ after: new Date(), viewKey: "exterior" });
  await prisma.$transaction((tx) => finalizeTask(tx, wrongView.task.id));
  await assert.rejects(() =>
    decision(race, "RESOLVE_ISSUE", {
      issueId: lateIssue.id,
      followUpTaskInstanceId: wrongView.task.id,
    }),
  );
  const heldHash = (
    await prisma.evidenceAsset.findUniqueOrThrow({
      where: { id: race.attempt.mediaAssetId! },
    })
  ).sha256;
  const reusedBytes = await fresh({ after: new Date(), hash: heldHash });
  await prisma.$transaction((tx) => finalizeTask(tx, reusedBytes.task.id));
  await assert.rejects(() =>
    decision(race, "RESOLVE_ISSUE", {
      issueId: lateIssue.id,
      followUpTaskInstanceId: reusedBytes.task.id,
    }),
  );
  const normalizedReuse = await fresh({
    after: new Date(),
    normalizedHash: "original-normalized",
  });
  await prisma.$transaction((tx) => finalizeTask(tx, normalizedReuse.task.id));
  await assert.rejects(() =>
    decision(race, "RESOLVE_ISSUE", {
      issueId: lateIssue.id,
      followUpTaskInstanceId: normalizedReuse.task.id,
    }),
  );
  const otherArea = await prisma.area.create({
    data: {
      locationId: location.id,
      name: "Other room",
      roomType: "WASHROOM",
      status: "ACTIVE",
    },
  });
  const otherFixture = await prisma.areaItem.create({
    data: {
      areaId: otherArea.id,
      stableCode: "other",
      displayName: "Other sink",
      fixtureType: "SINK",
      sequence: 1,
      rubricKey: "sink",
      requiredViews: [],
    },
  });
  const otherFollowUp = await fresh({
    after: new Date(),
    scope: {
      companyId: company.id,
      locationId: location.id,
      areaId: otherArea.id,
      fixtureId: otherFixture.id,
      staffId: staff.id,
    },
  });
  await prisma.$transaction((tx) => finalizeTask(tx, otherFollowUp.task.id));
  await assert.rejects(() =>
    decision(race, "RESOLVE_ISSUE", {
      issueId: lateIssue.id,
      followUpTaskInstanceId: otherFollowUp.task.id,
    }),
  );
  const foreignCompany = await prisma.company.create({
    data: { name: "Foreign follow-up" },
  });
  const foreignLocation = await prisma.location.create({
    data: {
      companyId: foreignCompany.id,
      name: "Foreign",
      address: "test",
      latitude: "0",
      longitude: "0",
    },
  });
  const foreignStaff = await prisma.staff.create({
    data: {
      companyId: foreignCompany.id,
      locationId: foreignLocation.id,
      name: "Foreign",
      email: `${randomUUID()}@test.invalid`,
      password: "test",
    },
  });
  const foreignArea = await prisma.area.create({
    data: {
      locationId: foreignLocation.id,
      name: "Foreign",
      roomType: "WASHROOM",
      status: "ACTIVE",
    },
  });
  const foreignFixture = await prisma.areaItem.create({
    data: {
      areaId: foreignArea.id,
      stableCode: "foreign",
      displayName: "Foreign sink",
      fixtureType: "SINK",
      sequence: 1,
      rubricKey: "sink",
      requiredViews: [],
    },
  });
  const foreignFollowUp = await fresh({
    after: new Date(),
    scope: {
      companyId: foreignCompany.id,
      locationId: foreignLocation.id,
      areaId: foreignArea.id,
      fixtureId: foreignFixture.id,
      staffId: foreignStaff.id,
    },
  });
  await prisma.$transaction((tx) => finalizeTask(tx, foreignFollowUp.task.id));
  await assert.rejects(() =>
    decision(race, "RESOLVE_ISSUE", {
      issueId: lateIssue.id,
      followUpTaskInstanceId: foreignFollowUp.task.id,
    }),
  );
  const directFollowUp = (
    followUpTaskInstanceId: number,
    evidenceAttemptId: string,
  ) =>
    prisma.verificationDecision.create({
      data: {
        exceptionId: lateCase.id,
        issueId: lateIssue.id,
        requirementId: race.requirement.id,
        action: "RESOLVE_ISSUE",
        reasonCode: "PRIVACY_HOLD",
        note: "Direct binding negative fixture",
        actorManagerId: actor.id,
        followUpTaskInstanceId,
        evidenceAttemptId,
        expectedDecisionVersion: lateCase.rowVersion,
      },
    });
  await assert.rejects(
    () => directFollowUp(foreignFollowUp.task.id, foreignFollowUp.attempt.id),
    "database rejects cross-tenant follow-up",
  );
  await assert.rejects(
    () => directFollowUp(otherFollowUp.task.id, otherFollowUp.attempt.id),
    "database rejects other-area follow-up",
  );
  await assert.rejects(
    () => directFollowUp(waivedFollowUp.task.id, waivedFollowUp.attempt.id),
    "database rejects waived evidence credit",
  );
  await assert.rejects(
    () => directFollowUp(olderFollowUp.task.id, olderFollowUp.attempt.id),
    "database rejects older unrelated task",
  );
  await assert.rejects(
    () => directFollowUp(normalizedReuse.task.id, normalizedReuse.attempt.id),
    "database rejects normalized held bytes",
  );
  await assert.rejects(
    () =>
      prisma.verificationDecision.create({
        data: {
          exceptionId: lateCase.id,
          issueId: lateIssue.id,
          requirementId: race.requirement.id,
          action: "RESOLVE_ISSUE",
          reasonCode: "PRIVACY_HOLD",
          note: "Old binding preserved",
          actorManagerId: actor.id,
          evidenceAttemptId: foreignFollowUp.attempt.id,
          expectedDecisionVersion: lateCase.rowVersion,
        },
      }),
    "ordinary decisions still bind original task",
  );
  const completedDetail = await route("/verification-exceptions/:id", "get", {
    id: String(lateCase.id),
  });
  assert.deepEqual(completedDetail.allowedActions, ["RESOLVE_ISSUE"]);
  assert.equal(completedDetail.requiresFollowUp, true);
  const followInput = {
    requestId: randomUUID(),
    expectedVersion: (
      await prisma.verificationException.findUniqueOrThrow({
        where: { id: lateCase.id },
      })
    ).rowVersion,
    issueId: lateIssue.id,
    action: "RESOLVE_ISSUE",
    reasonCode: "PRIVACY_HOLD",
    note: "Safe separately completed follow-up",
    followUpTaskInstanceId: safeFollowUp.task.id,
    evidenceAttemptId: safeFollowUp.attempt.id,
  };
  const followDecision = await managerDecision(actor, lateCase.id, followInput);
  assert.equal(followDecision.followUpTaskInstanceId, safeFollowUp.task.id);
  assert.equal(
    (await managerDecision(actor, lateCase.id, followInput)).id,
    followDecision.id,
  );
  await assert.rejects(() =>
    managerDecision(actor, lateCase.id, {
      ...followInput,
      followUpTaskInstanceId: otherFollowUp.task.id,
    }),
  );
  assert.deepEqual(
    await prisma.taskInstance.findUniqueOrThrow({
      where: { id: race.task.id },
    }),
    originalSnapshot,
  );
  assert.deepEqual(
    await prisma.taskEvidenceRequirement.findMany({
      where: { item: { taskInstanceId: race.task.id } },
    }),
    originalRequirements,
  );
  assert.deepEqual(
    await prisma.taskAssignment.findMany({
      where: { taskInstanceId: race.task.id },
    }),
    originalAssignments,
  );
  assert.equal(
    (
      await prisma.evidenceAsset.findUniqueOrThrow({
        where: { id: race.attempt.mediaAssetId! },
      })
    ).privacyState,
    "HOLD",
  );
  assert.equal(
    await prisma.exceptionEvent.count({
      where: { exceptionId: lateCase.id, type: "FOLLOW_UP_RESOLVED" },
    }),
    1,
  );
  assert.equal(
    await prisma.auditLog.count({
      where: { entityId: race.task.id, action: "FOLLOW_UP_ISSUE_RESOLVED" },
    }),
    1,
  );
  // Task-level context must belong to a session contributing non-waived evidence to completion.
  const contextOriginal = await fresh({ after: new Date() });
  const heldContext = await contextOriginal.evidence(true);
  await prisma.$transaction((tx) => finalizeTask(tx, contextOriginal.task.id));
  await prisma.evidenceAsset.update({
    where: { id: heldContext.mediaAssetId! },
    data: { privacyState: "HOLD" },
  });
  const contextCase = await prisma.$transaction((tx) =>
    raiseIssue(
      tx,
      contextOriginal.task.id,
      "PRIVACY_HOLD",
      null,
      heldContext.id,
    ),
  );
  assert.ok(contextCase);
  const contextIssue = await prisma.verificationIssue.findFirstOrThrow({
    where: { exceptionId: contextCase.id },
  });
  await assert.rejects(() =>
    decision(contextOriginal, "RESOLVE_ISSUE", {
      issueId: contextIssue.id,
      followUpTaskInstanceId: waivedFollowUp.task.id,
    }),
  );
  const contextFollowUp = await fresh({ after: new Date() });
  const safeContext = await contextFollowUp.evidence(true);
  await prisma.$transaction((tx) => finalizeTask(tx, contextFollowUp.task.id));
  await decision(contextOriginal, "RESOLVE_ISSUE", {
    issueId: contextIssue.id,
    followUpTaskInstanceId: contextFollowUp.task.id,
    evidenceAttemptId: safeContext.id,
  });
  assert.equal(
    (
      await prisma.evidenceAsset.findUniqueOrThrow({
        where: { id: heldContext.mediaAssetId! },
      })
    ).privacyState,
    "HOLD",
  );
  const acceptedPending = await fresh({ state: "PROCESSING" });
  await prisma.verificationAttempt.update({
    where: { id: acceptedPending.attempt.id },
    data: { state: "CLEANLINESS_CHECK" },
  });
  const acceptedJob = await prisma.verificationJob.create({
    data: {
      companyId: company.id,
      attemptId: acceptedPending.attempt.id,
      stage: "CLEANLINESS",
      evaluatorVersion: "accepted-exhaustion-test",
      state: "RUNNING",
      attempts: 4,
      leaseToken: randomUUID(),
      leaseUntil: new Date(Date.now() + 90000),
    },
  });
  await prisma.$transaction((tx) =>
    raiseIssue(
      tx,
      acceptedPending.task.id,
      "DAMAGED",
      acceptedPending.requirement.id,
    ),
  );
  await decision(acceptedPending, "ACCEPT_EVIDENCE", {
    requirementId: acceptedPending.requirement.id,
    evidenceAttemptId: acceptedPending.attempt.id,
  });
  assert.equal(
    (
      await prisma.taskInstance.findUniqueOrThrow({
        where: { id: acceptedPending.task.id },
      })
    ).status,
    "COMPLETED",
    "audited acceptance completes without the retired queue",
  );
  assert.equal(await failVerificationJob(acceptedJob), true);
  assert.equal(
    (
      await prisma.taskInstance.findUniqueOrThrow({
        where: { id: acceptedPending.task.id },
      })
    ).completionOutcome,
    "COMPLETED_WITH_EXCEPTIONS",
  );
  assert.equal(await failVerificationJob(acceptedJob), false);
  await prisma.$transaction((tx) => finalizeTask(tx, acceptedPending.task.id));
  assert.equal(
    await prisma.auditLog.count({
      where: {
        entityId: acceptedPending.task.id,
        action: "VERIFICATION_COMPLETED",
      },
    }),
    1,
  );
  assert.equal(
    await prisma.verificationIssue.count({
      where: {
        exception: { taskInstanceId: acceptedPending.task.id },
        reasonCode: "SERVICE_FAILURE",
      },
    }),
    0,
    "exhaustion does not create a new issue against accepted requirement",
  );
  const suspended = await fresh();
  await prisma.company.update({
    where: { id: company.id },
    data: { isActive: false },
  });
  assert.equal(
    (
      await prisma.captureSession.findUniqueOrThrow({
        where: { id: suspended.session.id },
      })
    ).state,
    "REVOKED",
  );
  assert.equal(
    await prisma.$transaction((tx) => finalizeTask(tx, suspended.task.id)),
    null,
  );
  assert.equal(
    (
      await prisma.taskEvidenceRequirement.findUniqueOrThrow({
        where: { id: suspended.requirement.id },
      })
    ).state,
    "PASSED",
  );
  console.log(
    "PASS lifecycle: completion race, item aggregation, epochs, privacy/presence, maintenance, waiver, extension, deadline/pending jobs, no spam, company revocation",
  );
} finally {
  await prisma.$disconnect();
  console.log(`Retained isolated database: ${database}`);
}
