-- Additive only: existing tasks, sessions, media and queued evidence are preserved.
ALTER TABLE "TaskInstance" ADD COLUMN IF NOT EXISTS "staffSubmittedAt" TIMESTAMP(3);
ALTER TABLE "CaptureSlot" ADD COLUMN IF NOT EXISTS "activatedAt" TIMESTAMP(3);
CREATE INDEX IF NOT EXISTS "TaskInstance_staffSubmittedAt_idx" ON "TaskInstance"("staffSubmittedAt");
