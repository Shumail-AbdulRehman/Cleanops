-- Request ownership and an assessment cached for explicit storage retries.
-- No queue, scheduled execution, photo bytes, or changes to immutable evidence.
ALTER TABLE "VerificationAttempt"
  ADD COLUMN "directProcessingToken" TEXT,
  ADD COLUMN "directProcessingStartedAt" TIMESTAMP(3),
  ADD COLUMN "directAssessment" JSONB;
