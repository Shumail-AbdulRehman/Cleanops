BEGIN;
-- Additive foundation constraints. No legacy identity or evidence is deleted.
CREATE TABLE "VerificationWorkerHeartbeat" (
 "id" TEXT PRIMARY KEY, "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "activeJobs" INTEGER NOT NULL DEFAULT 0, "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
ALTER TABLE "AreaStandardPhoto" DROP CONSTRAINT "AreaStandardPhoto_areaItemId_fkey";
ALTER TABLE "AreaStandardPhoto" ADD CONSTRAINT "AreaStandardPhoto_areaItemId_areaId_fkey"
 FOREIGN KEY ("areaItemId", "areaId") REFERENCES "AreaItem"(id,"areaId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TaskTemplate" ADD CONSTRAINT "template_supported_version" CHECK ("verificationVersion" IN (1,2));
ALTER TABLE "TaskInstance" ADD CONSTRAINT "instance_supported_version" CHECK ("verificationVersion" IN (1,2));
ALTER TABLE "TaskInstance" ADD CONSTRAINT "instance_v2_contract" CHECK ("verificationVersion" <> 2 OR
 ("areaNameSnapshot" IS NOT NULL AND "verificationDeadline" IS NOT NULL AND "uploadDeadline" IS NOT NULL));
ALTER TABLE "EvidenceAsset" ADD CONSTRAINT "asset_protected_delivery" CHECK ("deliveryType"='authenticated');
ALTER TABLE "VerificationJob" ADD CONSTRAINT "job_company_fk" FOREIGN KEY ("companyId") REFERENCES "Company"(id) ON DELETE RESTRICT;
ALTER TABLE "VerificationException" ADD CONSTRAINT "exception_company_fk" FOREIGN KEY ("companyId") REFERENCES "Company"(id) ON DELETE RESTRICT;
ALTER TABLE "VerificationException" ADD CONSTRAINT "exception_location_fk" FOREIGN KEY ("locationId") REFERENCES "Location"(id) ON DELETE RESTRICT;
ALTER TABLE "VerificationRequest" ADD CONSTRAINT "request_company_fk" FOREIGN KEY ("companyId") REFERENCES "Company"(id) ON DELETE RESTRICT;
ALTER TABLE "VerificationDecision" ADD CONSTRAINT "decision_manager_fk" FOREIGN KEY ("actorManagerId") REFERENCES "Manager"(id) ON DELETE RESTRICT;
ALTER TABLE "AreaStandardPhoto" ADD CONSTRAINT "standard_manager_fk" FOREIGN KEY ("createdByManagerId") REFERENCES "Manager"(id) ON DELETE RESTRICT;
ALTER TABLE "ExceptionReadReceipt" ADD CONSTRAINT "receipt_manager_fk" FOREIGN KEY ("managerId") REFERENCES "Manager"(id) ON DELETE RESTRICT;
CREATE INDEX "VerificationJob_companyId_state_availableAt_idx" ON "VerificationJob"("companyId",state,"availableAt");
CREATE INDEX "EvidenceAsset_companyId_normalizedHash_idx" ON "EvidenceAsset"("companyId","normalizedHash");
CREATE INDEX "EvidenceAsset_locationId_createdAt_idx" ON "EvidenceAsset"("locationId","createdAt");

CREATE FUNCTION enforce_verification_scope() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE cid integer; lid integer; tid integer; sid integer;
BEGIN
 IF TG_TABLE_NAME IN ('EvidenceAsset','VerificationException') THEN
  SELECT "companyId" INTO cid FROM "Location" WHERE id=NEW."locationId";
  IF cid IS DISTINCT FROM NEW."companyId" THEN RAISE EXCEPTION 'Invalid verification tenant'; END IF;
  IF NEW."taskInstanceId" IS NOT NULL THEN
   SELECT "locationId" INTO lid FROM "TaskInstance" WHERE id=NEW."taskInstanceId";
   IF lid IS DISTINCT FROM NEW."locationId" THEN RAISE EXCEPTION 'Invalid verification location'; END IF;
  END IF;
  IF TG_TABLE_NAME='VerificationException' THEN
   IF NEW."areaId" IS NOT NULL THEN
   SELECT "locationId" INTO lid FROM "Area" WHERE id=NEW."areaId";
   IF lid IS DISTINCT FROM NEW."locationId" THEN RAISE EXCEPTION 'Invalid exception area'; END IF;
  END IF;
  END IF;
 ELSIF TG_TABLE_NAME='VerificationJob' THEN
  SELECT l."companyId" INTO cid FROM "VerificationAttempt" a JOIN "CaptureSession" s ON s.id=a."sessionId"
   JOIN "TaskInstance" t ON t.id=s."taskInstanceId" JOIN "Location" l ON l.id=t."locationId" WHERE a.id=NEW."attemptId";
  IF cid IS DISTINCT FROM NEW."companyId" THEN RAISE EXCEPTION 'Invalid job tenant'; END IF;
 ELSIF TG_TABLE_NAME='CaptureSession' THEN
  SELECT "taskInstanceId","staffId" INTO tid,sid FROM "TaskAssignment" WHERE id=NEW."assignmentId";
  IF tid IS DISTINCT FROM NEW."taskInstanceId" OR sid IS DISTINCT FROM NEW."staffId" THEN RAISE EXCEPTION 'Invalid assignment binding'; END IF;
  IF NOT EXISTS (SELECT 1 FROM "Staff" s JOIN "TaskInstance" t ON t.id=NEW."taskInstanceId" JOIN "Location" l ON l.id=t."locationId" WHERE s.id=NEW."staffId" AND s."companyId"=l."companyId") THEN RAISE EXCEPTION 'Session worker belongs to another company'; END IF;
 ELSIF TG_TABLE_NAME='AreaStandardPhoto' THEN
  SELECT a."locationId",l."companyId" INTO lid,cid FROM "Area" a JOIN "Location" l ON l.id=a."locationId" WHERE a.id=NEW."areaId";
  IF NOT EXISTS (SELECT 1 FROM "Manager" WHERE id=NEW."createdByManagerId" AND "companyId"=cid) THEN RAISE EXCEPTION 'Standard actor belongs to another company'; END IF;
  IF NOT EXISTS (SELECT 1 FROM "EvidenceAsset" WHERE id=NEW."mediaAssetId" AND "locationId"=lid AND "companyId"=cid) THEN RAISE EXCEPTION 'Invalid standard media scope'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER asset_scope BEFORE INSERT OR UPDATE ON "EvidenceAsset" FOR EACH ROW EXECUTE FUNCTION enforce_verification_scope();
CREATE TRIGGER exception_scope BEFORE INSERT OR UPDATE ON "VerificationException" FOR EACH ROW EXECUTE FUNCTION enforce_verification_scope();
CREATE TRIGGER job_scope BEFORE INSERT OR UPDATE ON "VerificationJob" FOR EACH ROW EXECUTE FUNCTION enforce_verification_scope();
CREATE TRIGGER session_scope BEFORE INSERT OR UPDATE ON "CaptureSession" FOR EACH ROW EXECUTE FUNCTION enforce_verification_scope();
CREATE TRIGGER standard_scope BEFORE INSERT OR UPDATE ON "AreaStandardPhoto" FOR EACH ROW EXECUTE FUNCTION enforce_verification_scope();

CREATE FUNCTION protect_verification_history() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Verification history must be retained'; END IF;
 IF TG_TABLE_NAME IN ('VerificationDecision','EvidenceAsset') THEN
  IF TG_TABLE_NAME='VerificationDecision' THEN RAISE EXCEPTION 'Verification decisions are immutable'; END IF;
  IF (to_jsonb(NEW)-'privacyState'-'sanitizedPublicId') IS DISTINCT FROM (to_jsonb(OLD)-'privacyState'-'sanitizedPublicId') THEN RAISE EXCEPTION 'Evidence identity is immutable'; END IF;
 ELSIF TG_TABLE_NAME='TaskVerificationItem' THEN
  IF (to_jsonb(NEW)-'state'-'decisionVersion') IS DISTINCT FROM (to_jsonb(OLD)-'state'-'decisionVersion') THEN RAISE EXCEPTION 'Inventory snapshot is immutable'; END IF;
 ELSIF TG_TABLE_NAME='TaskEvidenceRequirement' THEN
  IF (to_jsonb(NEW)-'state'-'decisionVersion'-'currentAttemptId') IS DISTINCT FROM (to_jsonb(OLD)-'state'-'decisionVersion'-'currentAttemptId') THEN RAISE EXCEPTION 'Requirement snapshot is immutable'; END IF;
 ELSIF TG_TABLE_NAME='TaskInstance' THEN
  IF OLD."verificationVersion"=2 AND ROW(NEW."areaId",NEW."verificationVersion",NEW."areaNameSnapshot",NEW."inventoryVersion",NEW."policySnapshot",NEW."shiftEnd")
    IS DISTINCT FROM ROW(OLD."areaId",OLD."verificationVersion",OLD."areaNameSnapshot",OLD."inventoryVersion",OLD."policySnapshot",OLD."shiftEnd") THEN RAISE EXCEPTION 'Task snapshot is immutable'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER immutable_decision BEFORE UPDATE OR DELETE ON "VerificationDecision" FOR EACH ROW EXECUTE FUNCTION protect_verification_history();
CREATE TRIGGER immutable_asset BEFORE UPDATE OR DELETE ON "EvidenceAsset" FOR EACH ROW EXECUTE FUNCTION protect_verification_history();
CREATE TRIGGER immutable_task_item BEFORE UPDATE OR DELETE ON "TaskVerificationItem" FOR EACH ROW EXECUTE FUNCTION protect_verification_history();
CREATE TRIGGER immutable_requirement BEFORE UPDATE OR DELETE ON "TaskEvidenceRequirement" FOR EACH ROW EXECUTE FUNCTION protect_verification_history();
CREATE TRIGGER immutable_task_snapshot BEFORE UPDATE ON "TaskInstance" FOR EACH ROW EXECUTE FUNCTION protect_verification_history();

COMMIT;
