-- Additive only. Apply in an isolated test DB here; production rollout is separate.
ALTER TABLE "VerificationAttempt" ADD COLUMN "spatialEvidence" JSONB,
  ADD COLUMN "spatialDecision" JSONB, ADD COLUMN "spatialVersion" INTEGER;
ALTER TABLE "VerificationAttempt" ADD CONSTRAINT "spatial_version" CHECK
  (("spatialEvidence" IS NULL AND "spatialVersion" IS NULL) OR
   ("spatialEvidence" IS NOT NULL AND "spatialVersion" IS NOT NULL AND "spatialVersion" = 1));
CREATE FUNCTION protect_spatial_observation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='UPDATE' AND (NEW."spatialEvidence" IS DISTINCT FROM OLD."spatialEvidence" OR NEW."spatialVersion" IS DISTINCT FROM OLD."spatialVersion") THEN
  RAISE EXCEPTION 'Spatial observation binding is immutable';
 END IF;
 IF TG_OP='UPDATE' AND OLD."spatialDecision" IS NOT NULL AND NEW."spatialDecision" IS DISTINCT FROM OLD."spatialDecision" THEN
  RAISE EXCEPTION 'Spatial assessment is immutable';
 END IF;
 IF NEW."spatialEvidence" IS NOT NULL AND (
   NEW."spatialEvidence"->>'sessionId' IS DISTINCT FROM NEW."sessionId" OR
   NEW."spatialEvidence"->>'requirementId' IS DISTINCT FROM NEW."requirementId" OR
   NEW."spatialEvidence"->>'contextKey' IS DISTINCT FROM NEW."contextKey" OR
   NEW."spatialEvidence"->>'version' IS DISTINCT FROM '1') THEN
  RAISE EXCEPTION 'Spatial observation must match attempt';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER spatial_observation_binding BEFORE INSERT OR UPDATE ON "VerificationAttempt"
 FOR EACH ROW EXECUTE FUNCTION protect_spatial_observation();
