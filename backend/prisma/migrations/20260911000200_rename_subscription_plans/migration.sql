-- Rename plan values while preserving every company's equivalent tier.
ALTER TYPE "SubscriptionPlan" RENAME VALUE 'FREE' TO 'STARTER';
ALTER TYPE "SubscriptionPlan" RENAME VALUE 'BASIC' TO 'PRO';
ALTER TYPE "SubscriptionPlan" RENAME VALUE 'PROFESSIONAL' TO 'ADVANCED';
