BEGIN;
-- Expand only: strengthen newly introduced history bindings.
ALTER TABLE "TaskTemplate" ADD CONSTRAINT "template_legacy_source_fk" FOREIGN KEY ("sourceLegacyTemplateId") REFERENCES "TaskTemplate"(id) ON DELETE RESTRICT;
ALTER TABLE "CaptureSlot" ADD CONSTRAINT "slot_attempt_fk" FOREIGN KEY ("attemptId") REFERENCES "VerificationAttempt"(id) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE "VerificationDecision" ADD CONSTRAINT "decision_attempt_fk" FOREIGN KEY ("evidenceAttemptId") REFERENCES "VerificationAttempt"(id) ON DELETE RESTRICT;
ALTER TABLE "VerificationIssue" ADD CONSTRAINT "issue_first_attempt_fk" FOREIGN KEY ("firstAttemptId") REFERENCES "VerificationAttempt"(id) ON DELETE RESTRICT;
ALTER TABLE "VerificationIssue" ADD CONSTRAINT "issue_latest_attempt_fk" FOREIGN KEY ("latestAttemptId") REFERENCES "VerificationAttempt"(id) ON DELETE RESTRICT;
ALTER TABLE "VerificationAttempt" ADD CONSTRAINT "attempt_superseded_fk" FOREIGN KEY ("supersedesAttemptId") REFERENCES "VerificationAttempt"(id) ON DELETE RESTRICT;
CREATE FUNCTION enforce_additional_history_bindings() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE tid integer; cid integer; lid integer; aid integer;
BEGIN
 IF TG_TABLE_NAME='VerificationAttempt' THEN
  SELECT "taskInstanceId" INTO tid FROM "CaptureSession" WHERE id=NEW."sessionId";
  IF NEW."mediaAssetId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "EvidenceAsset" WHERE id=NEW."mediaAssetId" AND "taskInstanceId"=tid) THEN RAISE EXCEPTION 'Attempt media belongs to another task'; END IF;
  IF TG_OP='UPDATE' THEN
   IF ROW(NEW."sessionId",NEW."slotId",NEW."requirementId",NEW."contextKey",NEW."staffId",NEW."assignmentEpoch",NEW."clientCaptureId",NEW."claimedCapturedAt",NEW."anchoredElapsedMs") IS DISTINCT FROM
     ROW(OLD."sessionId",OLD."slotId",OLD."requirementId",OLD."contextKey",OLD."staffId",OLD."assignmentEpoch",OLD."clientCaptureId",OLD."claimedCapturedAt",OLD."anchoredElapsedMs") THEN RAISE EXCEPTION 'Attempt identity is immutable'; END IF;
   IF OLD."committedHash" IS NOT NULL AND NEW."committedHash" IS DISTINCT FROM OLD."committedHash" THEN RAISE EXCEPTION 'Committed evidence hash is immutable'; END IF;
   IF OLD."mediaAssetId" IS NOT NULL AND NEW."mediaAssetId" IS DISTINCT FROM OLD."mediaAssetId" THEN RAISE EXCEPTION 'Received media is immutable'; END IF;
   IF OLD."receivedAt" IS NOT NULL AND NEW."receivedAt" IS DISTINCT FROM OLD."receivedAt" THEN RAISE EXCEPTION 'Receipt time is immutable'; END IF;
   IF OLD."committedAt" IS NOT NULL AND NEW."committedAt" IS DISTINCT FROM OLD."committedAt" THEN RAISE EXCEPTION 'Commit time is immutable'; END IF;
   IF OLD."qualityResult" IS NOT NULL AND NEW."qualityResult" IS DISTINCT FROM OLD."qualityResult" OR
      OLD."coverageResult" IS NOT NULL AND NEW."coverageResult" IS DISTINCT FROM OLD."coverageResult" OR
      OLD."cleanlinessResult" IS NOT NULL AND NEW."cleanlinessResult" IS DISTINCT FROM OLD."cleanlinessResult" OR
      OLD."duplicateResult" IS NOT NULL AND NEW."duplicateResult" IS DISTINCT FROM OLD."duplicateResult" THEN RAISE EXCEPTION 'Attempt assessments are immutable'; END IF;
  END IF;
 ELSIF TG_TABLE_NAME='TaskEvidenceRequirement' THEN
  IF NEW."currentAttemptId" IS NOT NULL THEN
  IF NOT EXISTS (SELECT 1 FROM "VerificationAttempt" WHERE id=NEW."currentAttemptId" AND "requirementId"=NEW.id) THEN RAISE EXCEPTION 'Current attempt must match requirement'; END IF;
  END IF;
 ELSIF TG_TABLE_NAME='CaptureSlot' THEN
  SELECT "taskInstanceId" INTO tid FROM "CaptureSession" WHERE id=NEW."sessionId";
  IF NEW."requirementId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "TaskEvidenceRequirement" r JOIN "TaskVerificationItem" i ON i.id=r."taskVerificationItemId" WHERE r.id=NEW."requirementId" AND i."taskInstanceId"=tid) THEN RAISE EXCEPTION 'Slot must match task requirement'; END IF;
  IF TG_OP='UPDATE' AND OLD."attemptId" IS NOT NULL AND NEW."attemptId" IS DISTINCT FROM OLD."attemptId" THEN RAISE EXCEPTION 'Consumed slots cannot be reused'; END IF;
 ELSIF TG_TABLE_NAME='TaskTemplate' THEN
  IF NEW."sourceLegacyTemplateId" IS NOT NULL THEN
  SELECT l."companyId" INTO cid FROM "Location" l JOIN "TaskTemplate" t ON t."locationId"=l.id WHERE t.id=NEW."sourceLegacyTemplateId";
  IF NOT EXISTS (SELECT 1 FROM "Location" WHERE id=NEW."locationId" AND "companyId"=cid) THEN RAISE EXCEPTION 'Legacy source belongs to another company'; END IF;
  END IF;
 ELSIF TG_TABLE_NAME IN ('VerificationIssue','VerificationDecision') THEN
  SELECT "taskInstanceId","companyId" INTO tid,cid FROM "VerificationException" WHERE id=NEW."exceptionId";
  IF NEW."requirementId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "TaskEvidenceRequirement" r JOIN "TaskVerificationItem" i ON i.id=r."taskVerificationItemId" WHERE r.id=NEW."requirementId" AND i."taskInstanceId"=tid) THEN RAISE EXCEPTION 'Issue or decision requirement belongs to another case'; END IF;
  IF TG_TABLE_NAME='VerificationDecision' THEN
   IF NOT EXISTS (SELECT 1 FROM "Manager" WHERE id=NEW."actorManagerId" AND "companyId"=cid) THEN RAISE EXCEPTION 'Decision actor belongs to another company'; END IF;
   IF NEW."issueId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "VerificationIssue" WHERE id=NEW."issueId" AND "exceptionId"=NEW."exceptionId") THEN RAISE EXCEPTION 'Decision issue belongs to another case'; END IF;
   IF NEW."evidenceAttemptId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "VerificationAttempt" a JOIN "CaptureSession" s ON s.id=a."sessionId" WHERE a.id=NEW."evidenceAttemptId" AND s."taskInstanceId"=tid) THEN RAISE EXCEPTION 'Decision evidence belongs to another task'; END IF;
  END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER immutable_attempt_bindings BEFORE INSERT OR UPDATE ON "VerificationAttempt" FOR EACH ROW EXECUTE FUNCTION enforce_additional_history_bindings();
CREATE TRIGGER requirement_attempt_binding BEFORE INSERT OR UPDATE ON "TaskEvidenceRequirement" FOR EACH ROW EXECUTE FUNCTION enforce_additional_history_bindings();
CREATE TRIGGER slot_requirement_binding BEFORE INSERT OR UPDATE ON "CaptureSlot" FOR EACH ROW EXECUTE FUNCTION enforce_additional_history_bindings();
CREATE TRIGGER template_source_binding BEFORE INSERT OR UPDATE ON "TaskTemplate" FOR EACH ROW EXECUTE FUNCTION enforce_additional_history_bindings();
CREATE TRIGGER issue_case_binding BEFORE INSERT OR UPDATE ON "VerificationIssue" FOR EACH ROW EXECUTE FUNCTION enforce_additional_history_bindings();
CREATE TRIGGER decision_case_binding BEFORE INSERT ON "VerificationDecision" FOR EACH ROW EXECUTE FUNCTION enforce_additional_history_bindings();
CREATE FUNCTION consume_capture_slot() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 UPDATE "CaptureSlot" SET "attemptId"=NEW.id WHERE id=NEW."slotId" AND "attemptId" IS NULL;
 IF NOT FOUND THEN RAISE EXCEPTION 'Capture slot already consumed'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER consume_slot AFTER INSERT ON "VerificationAttempt" FOR EACH ROW EXECUTE FUNCTION consume_capture_slot();

CREATE TRIGGER retain_attempt BEFORE DELETE ON "VerificationAttempt" FOR EACH ROW EXECUTE FUNCTION protect_verification_history();
CREATE TRIGGER retain_job BEFORE DELETE ON "VerificationJob" FOR EACH ROW EXECUTE FUNCTION protect_verification_history();
COMMIT;
