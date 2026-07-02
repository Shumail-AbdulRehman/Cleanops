-- New workspaces must complete Paddle checkout before paid access is granted.
-- Existing company statuses are intentionally preserved.
ALTER TABLE "Company"
ALTER COLUMN "subscriptionStatus" SET DEFAULT 'CANCELLED';
