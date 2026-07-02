BEGIN;
ALTER TABLE "VerificationDecision" ADD COLUMN "followUpTaskInstanceId" INTEGER;
ALTER TABLE "VerificationDecision" ADD CONSTRAINT "VerificationDecision_followUpTaskInstanceId_fkey"
 FOREIGN KEY ("followUpTaskInstanceId") REFERENCES "TaskInstance"(id) ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "VerificationDecision_followUpTaskInstanceId_idx" ON "VerificationDecision"("followUpTaskInstanceId");
ALTER TABLE "VerificationDecision" ADD CONSTRAINT "verification_followup_action"
 CHECK ("followUpTaskInstanceId" IS NULL OR action = 'RESOLVE_ISSUE');
-- Replace only the decision-specific binding trigger. All other immutable
-- attempt, snapshot, issue and receipt bindings retain their existing function.
DROP TRIGGER decision_case_binding ON "VerificationDecision";
CREATE FUNCTION enforce_verification_decision_binding() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE source_task integer; tenant integer; case_location integer; case_area integer;
        concern "VerificationIssue"%ROWTYPE; replacement "VerificationAttempt"%ROWTYPE;
        replacement_media "EvidenceAsset"%ROWTYPE; previous_media "EvidenceAsset"%ROWTYPE;
BEGIN
 SELECT "taskInstanceId","companyId","locationId","areaId" INTO source_task,tenant,case_location,case_area
  FROM "VerificationException" WHERE id=NEW."exceptionId";
 IF NOT EXISTS (SELECT 1 FROM "Manager" WHERE id=NEW."actorManagerId" AND "companyId"=tenant) THEN RAISE EXCEPTION 'Decision actor belongs to another company'; END IF;
 IF NEW."requirementId" IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM "TaskEvidenceRequirement" r JOIN "TaskVerificationItem" i ON i.id=r."taskVerificationItemId"
  WHERE r.id=NEW."requirementId" AND i."taskInstanceId"=source_task
 ) THEN RAISE EXCEPTION 'Decision requirement belongs to another case'; END IF;
 IF NEW."issueId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "VerificationIssue" WHERE id=NEW."issueId" AND "exceptionId"=NEW."exceptionId") THEN RAISE EXCEPTION 'Decision issue belongs to another case'; END IF;
 IF NEW."followUpTaskInstanceId" IS NULL THEN
  IF NEW."evidenceAttemptId" IS NOT NULL AND NOT EXISTS (
   SELECT 1 FROM "VerificationAttempt" a JOIN "CaptureSession" s ON s.id=a."sessionId"
   WHERE a.id=NEW."evidenceAttemptId" AND s."taskInstanceId"=source_task
  ) THEN RAISE EXCEPTION 'Decision evidence belongs to another task'; END IF;
  RETURN NEW;
 END IF;
 IF NEW.action<>'RESOLVE_ISSUE' OR NEW."issueId" IS NULL OR NEW."evidenceAttemptId" IS NULL OR NEW."followUpTaskInstanceId"=source_task THEN RAISE EXCEPTION 'Invalid follow-up resolution'; END IF;
 SELECT * INTO concern FROM "VerificationIssue" WHERE id=NEW."issueId";
 IF concern.state='RESOLVED' OR NEW."requirementId" IS DISTINCT FROM concern."requirementId" THEN RAISE EXCEPTION 'Follow-up issue binding is invalid'; END IF;
 IF NOT EXISTS (
  SELECT 1 FROM "TaskInstance" original JOIN "Location" ol ON ol.id=original."locationId"
   JOIN "TaskInstance" followup ON followup.id=NEW."followUpTaskInstanceId" JOIN "Location" fl ON fl.id=followup."locationId"
  WHERE original.id=source_task AND original.status='COMPLETED' AND original."verificationVersion"=2
   AND original."areaId" IS NOT NULL AND original."locationId"=case_location AND original."areaId"=case_area
   AND ol."companyId"=tenant AND fl."companyId"=tenant AND followup."locationId"=original."locationId"
   AND followup."areaId"=original."areaId" AND followup.status='COMPLETED' AND followup."verificationVersion"=2
   AND followup."completedAt" IS NOT NULL AND followup."startedAt">=concern."firstSeenAt"
 ) THEN RAISE EXCEPTION 'Follow-up task scope, completion or start time is invalid'; END IF;
 SELECT a.* INTO replacement FROM "VerificationAttempt" a JOIN "CaptureSession" s ON s.id=a."sessionId"
  WHERE a.id=NEW."evidenceAttemptId" AND s."taskInstanceId"=NEW."followUpTaskInstanceId";
 IF NOT FOUND OR replacement."receivedAt" IS NULL OR replacement."receivedAt"<concern."firstSeenAt" OR replacement."claimedCapturedAt"<concern."firstSeenAt" THEN RAISE EXCEPTION 'Follow-up replacement receipt or capture time is invalid'; END IF;
 IF EXISTS (SELECT 1 FROM "VerificationJob" WHERE "attemptId"=replacement.id AND stage IN ('QUALITY','PRIVACY','COVERAGE') AND state IN ('PENDING','RUNNING','RETRY_WAIT')) THEN RAISE EXCEPTION 'Follow-up replacement safety checks are pending'; END IF;
 SELECT * INTO replacement_media FROM "EvidenceAsset" WHERE id=replacement."mediaAssetId";
 IF NOT FOUND OR replacement_media."privacyState"<>'SAFE' THEN RAISE EXCEPTION 'Follow-up replacement must be privacy safe'; END IF;
 SELECT m.* INTO previous_media FROM "VerificationAttempt" a JOIN "EvidenceAsset" m ON m.id=a."mediaAssetId" WHERE a.id=concern."latestAttemptId";
 IF FOUND AND (replacement_media.id=previous_media.id OR replacement_media.sha256=previous_media.sha256 OR
   previous_media."normalizedHash" IS NOT NULL AND replacement_media."normalizedHash"=previous_media."normalizedHash") THEN RAISE EXCEPTION 'Held source bytes cannot be follow-up evidence'; END IF;
 IF concern."requirementId" IS NOT NULL THEN
  IF NOT EXISTS (
   SELECT 1 FROM "TaskEvidenceRequirement" original_r JOIN "TaskVerificationItem" original_i ON original_i.id=original_r."taskVerificationItemId"
    JOIN "TaskVerificationItem" follow_i ON follow_i."taskInstanceId"=NEW."followUpTaskInstanceId" AND follow_i."sourceAreaItemId"=original_i."sourceAreaItemId"
    JOIN "TaskEvidenceRequirement" follow_r ON follow_r."taskVerificationItemId"=follow_i.id AND follow_r."viewKey"=original_r."viewKey"
   WHERE original_r.id=concern."requirementId" AND follow_r.state IN ('PASSED','MANAGER_ACCEPTED')
    AND follow_r."currentAttemptId"=replacement.id AND replacement."requirementId"=follow_r.id
  ) THEN RAISE EXCEPTION 'Follow-up fixture/view must have accepted replacement evidence'; END IF;
 ELSE
  IF replacement."contextKey" IS NULL OR NOT EXISTS (
   SELECT 1 FROM "TaskEvidenceRequirement" r JOIN "TaskVerificationItem" i ON i.id=r."taskVerificationItemId"
    JOIN "VerificationAttempt" a ON a.id=r."currentAttemptId" JOIN "EvidenceAsset" m ON m.id=a."mediaAssetId"
   WHERE i."taskInstanceId"=NEW."followUpTaskInstanceId" AND i.mandatory AND r.mandatory AND r.state IN ('PASSED','MANAGER_ACCEPTED')
    AND a."sessionId"=replacement."sessionId" AND a."receivedAt" IS NOT NULL AND m."privacyState"='SAFE'
  ) OR NOT (replacement.state='PASSED' AND EXISTS (SELECT 1 FROM "CaptureSession" WHERE id=replacement."sessionId" AND "contextStatus"='ACCEPTABLE')
    OR EXISTS (SELECT 1 FROM "VerificationDecision" d JOIN "VerificationException" c ON c.id=d."exceptionId"
      WHERE c."taskInstanceId"=NEW."followUpTaskInstanceId" AND d.action='ACCEPT_CONTEXT' AND d."evidenceAttemptId"=replacement.id))
   THEN RAISE EXCEPTION 'Follow-up context must contribute to completed accepted evidence'; END IF;
  IF EXISTS (SELECT 1 FROM "VerificationAttempt" WHERE id=concern."latestAttemptId" AND "contextKey" IS NOT NULL AND "contextKey" IS DISTINCT FROM replacement."contextKey") THEN RAISE EXCEPTION 'Follow-up context purpose does not match concern'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER decision_case_binding BEFORE INSERT ON "VerificationDecision" FOR EACH ROW EXECUTE FUNCTION enforce_verification_decision_binding();
COMMIT;
