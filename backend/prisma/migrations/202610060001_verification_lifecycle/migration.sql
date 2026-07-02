BEGIN;
-- Additive lifecycle guards. Passed requirement snapshots are deliberately untouched.
CREATE FUNCTION revoke_task_capture_authority() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD."verificationVersion" = 2 AND
   (NEW."staffId" IS DISTINCT FROM OLD."staffId" OR NEW."locationId" IS DISTINCT FROM OLD."locationId"
    OR (OLD."isActive" AND NOT NEW."isActive") OR (NEW.status='CANCELLED' AND OLD.status<>'CANCELLED')) THEN
   NEW."assignmentEpoch" := OLD."assignmentEpoch" + 1;
   NEW."rowVersion" := OLD."rowVersion" + 1;
   UPDATE "CaptureSession" SET state='REVOKED',"closedAt"=NOW(),"rowVersion"="rowVersion"+1
    WHERE "taskInstanceId"=OLD.id AND state IN ('ACTIVE','PAUSED');
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER task_capture_revocation BEFORE UPDATE ON "TaskInstance" FOR EACH ROW EXECUTE FUNCTION revoke_task_capture_authority();
CREATE FUNCTION revoke_staff_capture_authority() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW."locationId" IS DISTINCT FROM OLD."locationId" OR NEW."companyId" IS DISTINCT FROM OLD."companyId" OR NEW.role IS DISTINCT FROM OLD.role OR (OLD."isActive" AND NOT NEW."isActive") THEN
   PERFORM id FROM "TaskInstance" WHERE "staffId"=OLD.id AND "verificationVersion"=2 ORDER BY id FOR UPDATE;
   UPDATE "TaskInstance" SET "assignmentEpoch"="assignmentEpoch"+1,"rowVersion"="rowVersion"+1
    WHERE "staffId"=OLD.id AND "verificationVersion"=2 AND status<>'COMPLETED';
   UPDATE "CaptureSession" SET state='REVOKED',"closedAt"=NOW(),"rowVersion"="rowVersion"+1
    WHERE "staffId"=OLD.id AND state IN ('ACTIVE','PAUSED');
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER staff_capture_revocation BEFORE UPDATE ON "Staff" FOR EACH ROW EXECUTE FUNCTION revoke_staff_capture_authority();
CREATE FUNCTION revoke_location_capture_authority() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF (OLD."isActive" AND NOT NEW."isActive") OR ROW(NEW.latitude,NEW.longitude,NEW."radiusMeters") IS DISTINCT FROM ROW(OLD.latitude,OLD.longitude,OLD."radiusMeters") THEN
   PERFORM id FROM "TaskInstance" WHERE "locationId"=OLD.id AND "verificationVersion"=2 ORDER BY id FOR UPDATE;
   UPDATE "TaskInstance" SET "assignmentEpoch"="assignmentEpoch"+1,"rowVersion"="rowVersion"+1 WHERE "locationId"=OLD.id AND "verificationVersion"=2 AND status<>'COMPLETED';
   UPDATE "CaptureSession" s SET state='REVOKED',"closedAt"=NOW(),"rowVersion"=s."rowVersion"+1 FROM "TaskInstance" t WHERE s."taskInstanceId"=t.id AND t."locationId"=OLD.id AND s.state IN ('ACTIVE','PAUSED');
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER location_capture_revocation BEFORE UPDATE ON "Location" FOR EACH ROW EXECUTE FUNCTION revoke_location_capture_authority();
CREATE FUNCTION revoke_assignment_capture_authority() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD."isCurrent" AND (NEW."staffId" IS DISTINCT FROM OLD."staffId" OR NEW."taskInstanceId" IS DISTINCT FROM OLD."taskInstanceId" OR (NOT NEW."isCurrent" AND NEW.status<>'COMPLETED')) THEN
  UPDATE "TaskInstance" SET "assignmentEpoch"="assignmentEpoch"+1,"rowVersion"="rowVersion"+1 WHERE id=OLD."taskInstanceId" AND "verificationVersion"=2 AND status<>'COMPLETED';
  UPDATE "CaptureSession" SET state='REVOKED',"closedAt"=NOW(),"rowVersion"="rowVersion"+1 WHERE "assignmentId"=OLD.id AND state IN ('ACTIVE','PAUSED');
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER assignment_capture_revocation BEFORE UPDATE ON "TaskAssignment" FOR EACH ROW EXECUTE FUNCTION revoke_assignment_capture_authority();
-- Company suspension invalidates capture authority but never deletes accepted evidence.
CREATE FUNCTION revoke_company_capture_authority() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD."isActive" AND NOT NEW."isActive" THEN
  PERFORM t.id FROM "TaskInstance" t JOIN "Location" l ON l.id=t."locationId"
   WHERE l."companyId"=OLD.id AND t."verificationVersion"=2 ORDER BY t.id FOR UPDATE OF t;
  UPDATE "TaskInstance" t SET "assignmentEpoch"=t."assignmentEpoch"+1,"rowVersion"=t."rowVersion"+1
   FROM "Location" l WHERE l.id=t."locationId" AND l."companyId"=OLD.id AND t."verificationVersion"=2 AND t.status<>'COMPLETED';
  UPDATE "CaptureSession" s SET state='REVOKED',"closedAt"=NOW(),"rowVersion"=s."rowVersion"+1
   FROM "TaskInstance" t JOIN "Location" l ON l.id=t."locationId"
   WHERE s."taskInstanceId"=t.id AND l."companyId"=OLD.id AND s.state IN ('ACTIVE','PAUSED');
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER company_capture_revocation BEFORE UPDATE ON "Company" FOR EACH ROW EXECUTE FUNCTION revoke_company_capture_authority();
-- Record every authority epoch transition atomically with its originating mutation.
CREATE FUNCTION audit_verification_authority_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW."verificationVersion"=2 AND NEW."assignmentEpoch" IS DISTINCT FROM OLD."assignmentEpoch" THEN
  INSERT INTO "AuditLog" ("companyId","actorType","entityType","entityId",action,reason,"oldValue","newValue")
   SELECT l."companyId",'SYSTEM','TASK_INSTANCE',NEW.id,'VERIFICATION_AUTHORITY_REVOKED','AUTHORITY_CHANGED',
    jsonb_build_object('assignmentEpoch',OLD."assignmentEpoch",'staffId',OLD."staffId"),
    jsonb_build_object('assignmentEpoch',NEW."assignmentEpoch",'staffId',NEW."staffId")
   FROM "Location" l WHERE l.id=NEW."locationId";
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER verification_authority_audit AFTER UPDATE ON "TaskInstance" FOR EACH ROW EXECUTE FUNCTION audit_verification_authority_change();

COMMIT;
