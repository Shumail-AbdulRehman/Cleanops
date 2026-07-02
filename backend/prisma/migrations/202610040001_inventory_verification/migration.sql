BEGIN;
-- CreateEnum
CREATE TYPE "InventorySelection" AS ENUM ('ALL', 'SUBSET');

-- CreateEnum
CREATE TYPE "TemplateSetupStatus" AS ENUM ('READY', 'NEEDS_REVIEW');

-- CreateEnum
CREATE TYPE "AreaStatus" AS ENUM ('DRAFT', 'ACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "AreaItemStatus" AS ENUM ('ACTIVE', 'MAINTENANCE', 'RETIRED');

-- CreateEnum
CREATE TYPE "IdentificationMode" AS ENUM ('PRINTED_LABEL', 'EXISTING_NUMBER', 'ORDERED_CONTEXT');

-- CreateEnum
CREATE TYPE "TaskVerificationState" AS ENUM ('NOT_STARTED', 'CAPTURING', 'PROCESSING', 'REWORK_REQUIRED', 'NEEDS_REVIEW', 'VERIFIED', 'RESOLVED_WITH_EXCEPTIONS');

-- CreateEnum
CREATE TYPE "CompletionOutcome" AS ENUM ('VERIFIED_COMPLETE', 'COMPLETED_WITH_EXCEPTIONS', 'LEGACY_RECORDED');

-- CreateEnum
CREATE TYPE "RequirementState" AS ENUM ('MISSING', 'PROCESSING', 'PASSED', 'RECAPTURE_REQUIRED', 'CLEANING_REQUIRED', 'REVIEW_REQUIRED', 'MANAGER_ACCEPTED', 'WAIVED');

-- CreateEnum
CREATE TYPE "CaptureSessionState" AS ENUM ('ACTIVE', 'PAUSED', 'CLOSED', 'EXPIRED', 'REVOKED');

-- CreateEnum
CREATE TYPE "AttemptState" AS ENUM ('RESERVED', 'STORING', 'RECEIVED', 'QUALITY_CHECK', 'COVERAGE_CHECK', 'CLEANLINESS_CHECK', 'PASSED', 'RECAPTURE_REQUIRED', 'CLEANING_REQUIRED', 'REVIEW_REQUIRED', 'RETRY_WAIT', 'SERVICE_FAILURE', 'PRIVACY_HOLD');

-- CreateEnum
CREATE TYPE "VerificationJobState" AS ENUM ('PENDING', 'RUNNING', 'SUCCEEDED', 'RETRY_WAIT', 'FAILED');

-- CreateEnum
CREATE TYPE "VerificationExceptionKind" AS ENUM ('TASK', 'SETUP');

-- CreateEnum
CREATE TYPE "VerificationExceptionState" AS ENUM ('OPEN', 'STAFF_ACTION_REQUIRED', 'MANAGER_REVIEW', 'WAITING_SERVICE', 'RESOLVED');

-- AlterTable
ALTER TABLE "Company" ADD COLUMN     "verificationPolicy" JSONB;

-- AlterTable
ALTER TABLE "TaskTemplate" ADD COLUMN     "areaId" INTEGER,
ADD COLUMN     "inventoryConfigVersion" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "inventorySelection" "InventorySelection" NOT NULL DEFAULT 'ALL',
ADD COLUMN     "setupStatus" "TemplateSetupStatus" NOT NULL DEFAULT 'NEEDS_REVIEW',
ADD COLUMN     "sourceLegacyTemplateId" INTEGER,
ADD COLUMN     "verificationVersion" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "TaskInstance" ADD COLUMN     "areaId" INTEGER,
ADD COLUMN     "areaNameSnapshot" TEXT,
ADD COLUMN     "assignmentEpoch" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "completionLateMinutes" INTEGER,
ADD COLUMN     "completionOutcome" "CompletionOutcome",
ADD COLUMN     "completionTiming" TEXT,
ADD COLUMN     "evidenceReadyAt" TIMESTAMP(3),
ADD COLUMN     "hasManualOverride" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "inventoryVersion" INTEGER,
ADD COLUMN     "policySnapshot" JSONB,
ADD COLUMN     "rowVersion" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "uploadDeadline" TIMESTAMP(3),
ADD COLUMN     "verificationDeadline" TIMESTAMP(3),
ADD COLUMN     "verificationResolvedAt" TIMESTAMP(3),
ADD COLUMN     "verificationState" "TaskVerificationState" NOT NULL DEFAULT 'NOT_STARTED',
ADD COLUMN     "verificationVersion" INTEGER NOT NULL DEFAULT 1;

-- CreateTable
CREATE TABLE "Area" (
    "id" SERIAL NOT NULL,
    "locationId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "roomType" TEXT NOT NULL,
    "status" "AreaStatus" NOT NULL DEFAULT 'DRAFT',
    "inventoryVersion" INTEGER NOT NULL DEFAULT 1,
    "qrVersion" INTEGER NOT NULL DEFAULT 1,
    "qrNonce" TEXT NOT NULL,
    "layoutInstructions" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Area_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AreaItem" (
    "id" SERIAL NOT NULL,
    "areaId" INTEGER NOT NULL,
    "stableCode" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "fixtureType" TEXT NOT NULL,
    "positionHint" TEXT,
    "sequence" INTEGER NOT NULL,
    "identificationMode" "IdentificationMode" NOT NULL DEFAULT 'ORDERED_CONTEXT',
    "existingNumber" TEXT,
    "rubricKey" TEXT NOT NULL,
    "rubricVersion" INTEGER NOT NULL DEFAULT 1,
    "requiredViews" JSONB NOT NULL,
    "status" "AreaItemStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AreaItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AreaStandardPhoto" (
    "id" SERIAL NOT NULL,
    "areaId" INTEGER NOT NULL,
    "areaItemId" INTEGER,
    "mediaAssetId" TEXT NOT NULL,
    "caption" TEXT,
    "createdByManagerId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AreaStandardPhoto_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaskTemplateItem" (
    "templateId" INTEGER NOT NULL,
    "areaId" INTEGER NOT NULL,
    "areaItemId" INTEGER NOT NULL,
    "mandatory" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "TaskTemplateItem_pkey" PRIMARY KEY ("templateId","areaItemId")
);

-- CreateTable
CREATE TABLE "TaskVerificationItem" (
    "id" SERIAL NOT NULL,
    "taskInstanceId" INTEGER NOT NULL,
    "areaId" INTEGER NOT NULL,
    "sourceAreaItemId" INTEGER NOT NULL,
    "itemCodeSnapshot" TEXT NOT NULL,
    "nameSnapshot" TEXT NOT NULL,
    "typeSnapshot" TEXT NOT NULL,
    "orderSnapshot" INTEGER NOT NULL,
    "identificationSnapshot" JSONB NOT NULL,
    "rubricSnapshot" JSONB NOT NULL,
    "mandatory" BOOLEAN NOT NULL DEFAULT true,
    "state" "RequirementState" NOT NULL DEFAULT 'MISSING',
    "decisionVersion" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "TaskVerificationItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaskEvidenceRequirement" (
    "id" TEXT NOT NULL,
    "taskVerificationItemId" INTEGER NOT NULL,
    "viewKey" TEXT NOT NULL,
    "instructionsSnapshot" TEXT NOT NULL,
    "mandatory" BOOLEAN NOT NULL DEFAULT true,
    "currentAttemptId" TEXT,
    "state" "RequirementState" NOT NULL DEFAULT 'MISSING',
    "decisionVersion" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "TaskEvidenceRequirement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CaptureSession" (
    "id" TEXT NOT NULL,
    "taskInstanceId" INTEGER NOT NULL,
    "areaId" INTEGER NOT NULL,
    "staffId" INTEGER NOT NULL,
    "assignmentId" INTEGER NOT NULL,
    "assignmentEpoch" INTEGER NOT NULL,
    "deviceId" TEXT NOT NULL,
    "qrVersion" INTEGER NOT NULL,
    "policyVersion" INTEGER NOT NULL,
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "captureExpiresAt" TIMESTAMP(3) NOT NULL,
    "uploadExpiresAt" TIMESTAMP(3) NOT NULL,
    "closedAt" TIMESTAMP(3),
    "state" "CaptureSessionState" NOT NULL DEFAULT 'ACTIVE',
    "presenceStatus" TEXT NOT NULL,
    "locationCheck" JSONB NOT NULL,
    "serverTimeAnchor" TIMESTAMP(3) NOT NULL,
    "clientBootId" TEXT NOT NULL,
    "contextAttemptIds" JSONB NOT NULL DEFAULT '[]',
    "contextStatus" TEXT NOT NULL DEFAULT 'PENDING',
    "rowVersion" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "CaptureSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CaptureSlot" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "requirementId" TEXT,
    "contextKey" TEXT,
    "sequence" INTEGER NOT NULL,
    "generation" INTEGER NOT NULL DEFAULT 0,
    "nonceHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "attemptId" TEXT,

    CONSTRAINT "CaptureSlot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EvidenceAsset" (
    "id" TEXT NOT NULL,
    "companyId" INTEGER NOT NULL,
    "locationId" INTEGER NOT NULL,
    "taskInstanceId" INTEGER,
    "originalPublicId" TEXT NOT NULL,
    "sanitizedPublicId" TEXT,
    "cloudinaryAssetId" TEXT,
    "deliveryType" TEXT NOT NULL DEFAULT 'authenticated',
    "format" TEXT NOT NULL,
    "bytes" INTEGER NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "normalizedHash" TEXT,
    "perceptualHash" TEXT,
    "privacyState" TEXT NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EvidenceAsset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VerificationAttempt" (
    "id" TEXT NOT NULL,
    "requirementId" TEXT,
    "contextKey" TEXT,
    "sessionId" TEXT NOT NULL,
    "slotId" TEXT NOT NULL,
    "staffId" INTEGER NOT NULL,
    "assignmentEpoch" INTEGER NOT NULL,
    "mediaAssetId" TEXT,
    "clientCaptureId" TEXT NOT NULL,
    "committedHash" TEXT,
    "committedAt" TIMESTAMP(3),
    "claimedCapturedAt" TIMESTAMP(3) NOT NULL,
    "anchoredElapsedMs" BIGINT NOT NULL,
    "receivedAt" TIMESTAMP(3),
    "timingEvidence" TEXT NOT NULL,
    "qualityResult" JSONB,
    "coverageResult" JSONB,
    "cleanlinessResult" JSONB,
    "duplicateResult" JSONB,
    "state" "AttemptState" NOT NULL DEFAULT 'RESERVED',
    "supersedesAttemptId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VerificationAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VerificationJob" (
    "id" TEXT NOT NULL,
    "companyId" INTEGER NOT NULL,
    "attemptId" TEXT NOT NULL,
    "stage" TEXT NOT NULL,
    "evaluatorVersion" TEXT NOT NULL,
    "state" "VerificationJobState" NOT NULL DEFAULT 'PENDING',
    "priority" INTEGER NOT NULL DEFAULT 0,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leaseUntil" TIMESTAMP(3),
    "leaseToken" TEXT,
    "lastErrorCode" TEXT,
    "result" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "VerificationJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VerificationException" (
    "id" SERIAL NOT NULL,
    "companyId" INTEGER NOT NULL,
    "locationId" INTEGER NOT NULL,
    "taskInstanceId" INTEGER,
    "areaId" INTEGER,
    "kind" "VerificationExceptionKind" NOT NULL DEFAULT 'TASK',
    "dedupeKey" TEXT NOT NULL,
    "state" "VerificationExceptionState" NOT NULL DEFAULT 'OPEN',
    "priority" INTEGER NOT NULL DEFAULT 0,
    "assignedManagerId" INTEGER,
    "firstRaisedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "nextReminderAt" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),
    "rowVersion" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "VerificationException_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VerificationIssue" (
    "id" SERIAL NOT NULL,
    "exceptionId" INTEGER NOT NULL,
    "requirementId" TEXT,
    "dedupeKey" TEXT NOT NULL,
    "reasonCode" TEXT NOT NULL,
    "state" "VerificationExceptionState" NOT NULL DEFAULT 'OPEN',
    "firstAttemptId" TEXT,
    "latestAttemptId" TEXT,
    "occurrences" INTEGER NOT NULL DEFAULT 1,
    "recommendedAction" TEXT NOT NULL,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "VerificationIssue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VerificationDecision" (
    "id" SERIAL NOT NULL,
    "exceptionId" INTEGER NOT NULL,
    "issueId" INTEGER,
    "requirementId" TEXT,
    "action" TEXT NOT NULL,
    "reasonCode" TEXT NOT NULL,
    "note" TEXT,
    "actorManagerId" INTEGER NOT NULL,
    "evidenceAttemptId" TEXT,
    "expectedDecisionVersion" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VerificationDecision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExceptionEvent" (
    "id" SERIAL NOT NULL,
    "exceptionId" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "dedupeKey" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExceptionEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExceptionReadReceipt" (
    "exceptionId" INTEGER NOT NULL,
    "managerId" INTEGER NOT NULL,
    "lastReadEventId" INTEGER,
    "readAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExceptionReadReceipt_pkey" PRIMARY KEY ("exceptionId","managerId")
);

-- CreateTable
CREATE TABLE "VerificationRequest" (
    "id" TEXT NOT NULL,
    "companyId" INTEGER NOT NULL,
    "actorRole" TEXT NOT NULL,
    "actorId" INTEGER NOT NULL,
    "operation" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "bodyHash" TEXT NOT NULL,
    "resultEntityId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VerificationRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Area_locationId_status_idx" ON "Area"("locationId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Area_id_locationId_key" ON "Area"("id", "locationId");

-- CreateIndex
CREATE INDEX "AreaItem_areaId_status_sequence_idx" ON "AreaItem"("areaId", "status", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "AreaItem_id_areaId_key" ON "AreaItem"("id", "areaId");

-- CreateIndex
CREATE UNIQUE INDEX "AreaItem_areaId_stableCode_key" ON "AreaItem"("areaId", "stableCode");

-- CreateIndex
CREATE INDEX "TaskVerificationItem_taskInstanceId_state_idx" ON "TaskVerificationItem"("taskInstanceId", "state");

-- CreateIndex
CREATE UNIQUE INDEX "TaskVerificationItem_taskInstanceId_sourceAreaItemId_key" ON "TaskVerificationItem"("taskInstanceId", "sourceAreaItemId");

-- CreateIndex
CREATE INDEX "TaskEvidenceRequirement_taskVerificationItemId_state_idx" ON "TaskEvidenceRequirement"("taskVerificationItemId", "state");

-- CreateIndex
CREATE UNIQUE INDEX "TaskEvidenceRequirement_taskVerificationItemId_viewKey_key" ON "TaskEvidenceRequirement"("taskVerificationItemId", "viewKey");

-- CreateIndex
CREATE INDEX "CaptureSession_taskInstanceId_assignmentEpoch_idx" ON "CaptureSession"("taskInstanceId", "assignmentEpoch");

-- CreateIndex
CREATE UNIQUE INDEX "CaptureSlot_attemptId_key" ON "CaptureSlot"("attemptId");

-- CreateIndex
CREATE UNIQUE INDEX "CaptureSlot_id_sessionId_key" ON "CaptureSlot"("id", "sessionId");

-- CreateIndex
CREATE UNIQUE INDEX "EvidenceAsset_originalPublicId_key" ON "EvidenceAsset"("originalPublicId");

-- CreateIndex
CREATE INDEX "EvidenceAsset_companyId_sha256_idx" ON "EvidenceAsset"("companyId", "sha256");

-- CreateIndex
CREATE INDEX "EvidenceAsset_companyId_createdAt_idx" ON "EvidenceAsset"("companyId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "VerificationAttempt_slotId_key" ON "VerificationAttempt"("slotId");

-- CreateIndex
CREATE INDEX "VerificationAttempt_requirementId_createdAt_idx" ON "VerificationAttempt"("requirementId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "VerificationAttempt_slotId_sessionId_key" ON "VerificationAttempt"("slotId", "sessionId");

-- CreateIndex
CREATE UNIQUE INDEX "VerificationAttempt_sessionId_clientCaptureId_key" ON "VerificationAttempt"("sessionId", "clientCaptureId");

-- CreateIndex
CREATE INDEX "VerificationJob_state_availableAt_idx" ON "VerificationJob"("state", "availableAt");

-- CreateIndex
CREATE INDEX "VerificationJob_leaseUntil_idx" ON "VerificationJob"("leaseUntil");

-- CreateIndex
CREATE UNIQUE INDEX "VerificationJob_attemptId_stage_evaluatorVersion_key" ON "VerificationJob"("attemptId", "stage", "evaluatorVersion");

-- CreateIndex
CREATE UNIQUE INDEX "VerificationException_taskInstanceId_key" ON "VerificationException"("taskInstanceId");

-- CreateIndex
CREATE UNIQUE INDEX "VerificationException_dedupeKey_key" ON "VerificationException"("dedupeKey");

-- CreateIndex
CREATE INDEX "VerificationException_companyId_state_priority_updatedAt_idx" ON "VerificationException"("companyId", "state", "priority", "updatedAt");

-- CreateIndex
CREATE INDEX "VerificationException_locationId_state_idx" ON "VerificationException"("locationId", "state");

-- CreateIndex
CREATE UNIQUE INDEX "VerificationIssue_exceptionId_dedupeKey_key" ON "VerificationIssue"("exceptionId", "dedupeKey");

-- CreateIndex
CREATE UNIQUE INDEX "ExceptionEvent_dedupeKey_key" ON "ExceptionEvent"("dedupeKey");

-- CreateIndex
CREATE UNIQUE INDEX "VerificationRequest_companyId_actorRole_actorId_operation_r_key" ON "VerificationRequest"("companyId", "actorRole", "actorId", "operation", "requestId");

-- CreateIndex
CREATE UNIQUE INDEX "TaskTemplate_id_areaId_key" ON "TaskTemplate"("id", "areaId");

-- CreateIndex
CREATE UNIQUE INDEX "TaskInstance_id_areaId_key" ON "TaskInstance"("id", "areaId");

-- AddForeignKey
ALTER TABLE "TaskTemplate" ADD CONSTRAINT "TaskTemplate_areaId_locationId_fkey" FOREIGN KEY ("areaId", "locationId") REFERENCES "Area"("id", "locationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskInstance" ADD CONSTRAINT "TaskInstance_areaId_locationId_fkey" FOREIGN KEY ("areaId", "locationId") REFERENCES "Area"("id", "locationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Area" ADD CONSTRAINT "Area_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AreaItem" ADD CONSTRAINT "AreaItem_areaId_fkey" FOREIGN KEY ("areaId") REFERENCES "Area"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AreaStandardPhoto" ADD CONSTRAINT "AreaStandardPhoto_areaId_fkey" FOREIGN KEY ("areaId") REFERENCES "Area"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AreaStandardPhoto" ADD CONSTRAINT "AreaStandardPhoto_areaItemId_fkey" FOREIGN KEY ("areaItemId") REFERENCES "AreaItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AreaStandardPhoto" ADD CONSTRAINT "AreaStandardPhoto_mediaAssetId_fkey" FOREIGN KEY ("mediaAssetId") REFERENCES "EvidenceAsset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskTemplateItem" ADD CONSTRAINT "TaskTemplateItem_templateId_areaId_fkey" FOREIGN KEY ("templateId", "areaId") REFERENCES "TaskTemplate"("id", "areaId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskTemplateItem" ADD CONSTRAINT "TaskTemplateItem_areaItemId_areaId_fkey" FOREIGN KEY ("areaItemId", "areaId") REFERENCES "AreaItem"("id", "areaId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskVerificationItem" ADD CONSTRAINT "TaskVerificationItem_taskInstanceId_areaId_fkey" FOREIGN KEY ("taskInstanceId", "areaId") REFERENCES "TaskInstance"("id", "areaId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskVerificationItem" ADD CONSTRAINT "TaskVerificationItem_sourceAreaItemId_areaId_fkey" FOREIGN KEY ("sourceAreaItemId", "areaId") REFERENCES "AreaItem"("id", "areaId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskEvidenceRequirement" ADD CONSTRAINT "TaskEvidenceRequirement_taskVerificationItemId_fkey" FOREIGN KEY ("taskVerificationItemId") REFERENCES "TaskVerificationItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CaptureSession" ADD CONSTRAINT "CaptureSession_taskInstanceId_areaId_fkey" FOREIGN KEY ("taskInstanceId", "areaId") REFERENCES "TaskInstance"("id", "areaId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CaptureSlot" ADD CONSTRAINT "CaptureSlot_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "CaptureSession"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CaptureSlot" ADD CONSTRAINT "CaptureSlot_requirementId_fkey" FOREIGN KEY ("requirementId") REFERENCES "TaskEvidenceRequirement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvidenceAsset" ADD CONSTRAINT "EvidenceAsset_taskInstanceId_fkey" FOREIGN KEY ("taskInstanceId") REFERENCES "TaskInstance"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VerificationAttempt" ADD CONSTRAINT "VerificationAttempt_requirementId_fkey" FOREIGN KEY ("requirementId") REFERENCES "TaskEvidenceRequirement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VerificationAttempt" ADD CONSTRAINT "VerificationAttempt_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "CaptureSession"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VerificationAttempt" ADD CONSTRAINT "VerificationAttempt_slotId_sessionId_fkey" FOREIGN KEY ("slotId", "sessionId") REFERENCES "CaptureSlot"("id", "sessionId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VerificationAttempt" ADD CONSTRAINT "VerificationAttempt_mediaAssetId_fkey" FOREIGN KEY ("mediaAssetId") REFERENCES "EvidenceAsset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VerificationJob" ADD CONSTRAINT "VerificationJob_attemptId_fkey" FOREIGN KEY ("attemptId") REFERENCES "VerificationAttempt"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VerificationException" ADD CONSTRAINT "VerificationException_taskInstanceId_fkey" FOREIGN KEY ("taskInstanceId") REFERENCES "TaskInstance"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VerificationException" ADD CONSTRAINT "VerificationException_areaId_fkey" FOREIGN KEY ("areaId") REFERENCES "Area"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VerificationIssue" ADD CONSTRAINT "VerificationIssue_exceptionId_fkey" FOREIGN KEY ("exceptionId") REFERENCES "VerificationException"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VerificationIssue" ADD CONSTRAINT "VerificationIssue_requirementId_fkey" FOREIGN KEY ("requirementId") REFERENCES "TaskEvidenceRequirement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VerificationDecision" ADD CONSTRAINT "VerificationDecision_exceptionId_fkey" FOREIGN KEY ("exceptionId") REFERENCES "VerificationException"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VerificationDecision" ADD CONSTRAINT "VerificationDecision_issueId_fkey" FOREIGN KEY ("issueId") REFERENCES "VerificationIssue"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VerificationDecision" ADD CONSTRAINT "VerificationDecision_requirementId_fkey" FOREIGN KEY ("requirementId") REFERENCES "TaskEvidenceRequirement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExceptionEvent" ADD CONSTRAINT "ExceptionEvent_exceptionId_fkey" FOREIGN KEY ("exceptionId") REFERENCES "VerificationException"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExceptionReadReceipt" ADD CONSTRAINT "ExceptionReadReceipt_exceptionId_fkey" FOREIGN KEY ("exceptionId") REFERENCES "VerificationException"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Additive migration only. Preserve every historical task/evidence record.
UPDATE "TaskInstance" SET "completionOutcome" = 'LEGACY_RECORDED' WHERE status = 'COMPLETED';
ALTER TABLE "TaskTemplate" ADD CONSTRAINT "template_v2_area" CHECK ("verificationVersion" <> 2 OR "areaId" IS NOT NULL);
ALTER TABLE "TaskInstance" ADD CONSTRAINT "instance_v2_snapshot" CHECK ("verificationVersion" <> 2 OR ("areaId" IS NOT NULL AND "policySnapshot" IS NOT NULL AND "inventoryVersion" IS NOT NULL));
ALTER TABLE "CaptureSlot" ADD CONSTRAINT "slot_single_purpose" CHECK (("requirementId" IS NULL) <> ("contextKey" IS NULL));
ALTER TABLE "VerificationAttempt" ADD CONSTRAINT "attempt_single_purpose" CHECK (("requirementId" IS NULL) <> ("contextKey" IS NULL));
CREATE UNIQUE INDEX "one_live_session_per_epoch" ON "CaptureSession" ("taskInstanceId", "assignmentEpoch") WHERE state IN ('ACTIVE', 'PAUSED');
ALTER TABLE "EvidenceAsset" ADD CONSTRAINT "asset_company_fk" FOREIGN KEY ("companyId") REFERENCES "Company"(id) ON DELETE RESTRICT;
ALTER TABLE "EvidenceAsset" ADD CONSTRAINT "asset_location_fk" FOREIGN KEY ("locationId") REFERENCES "Location"(id) ON DELETE RESTRICT;
ALTER TABLE "CaptureSession" ADD CONSTRAINT "session_staff_fk" FOREIGN KEY ("staffId") REFERENCES "Staff"(id) ON DELETE RESTRICT;
ALTER TABLE "CaptureSession" ADD CONSTRAINT "session_assignment_fk" FOREIGN KEY ("assignmentId") REFERENCES "TaskAssignment"(id) ON DELETE RESTRICT;
ALTER TABLE "VerificationAttempt" ADD CONSTRAINT "attempt_staff_fk" FOREIGN KEY ("staffId") REFERENCES "Staff"(id) ON DELETE RESTRICT;
CREATE FUNCTION enforce_capture_binding() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE s "CaptureSlot"; cs "CaptureSession"; item_task integer;
BEGIN
 SELECT * INTO s FROM "CaptureSlot" WHERE id = NEW."slotId";
 SELECT * INTO cs FROM "CaptureSession" WHERE id = NEW."sessionId";
 IF s."sessionId" IS DISTINCT FROM NEW."sessionId" OR s."requirementId" IS DISTINCT FROM NEW."requirementId" OR s."contextKey" IS DISTINCT FROM NEW."contextKey" OR cs."staffId" IS DISTINCT FROM NEW."staffId" OR cs."assignmentEpoch" IS DISTINCT FROM NEW."assignmentEpoch" THEN
  RAISE EXCEPTION 'Invalid capture attempt binding';
 END IF;
 IF NEW."requirementId" IS NOT NULL THEN
  SELECT i."taskInstanceId" INTO item_task FROM "TaskEvidenceRequirement" r JOIN "TaskVerificationItem" i ON i.id = r."taskVerificationItemId" WHERE r.id=NEW."requirementId";
  IF item_task IS DISTINCT FROM cs."taskInstanceId" THEN RAISE EXCEPTION 'Requirement belongs to another task'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER attempt_binding BEFORE INSERT OR UPDATE ON "VerificationAttempt" FOR EACH ROW EXECUTE FUNCTION enforce_capture_binding();

COMMIT;
