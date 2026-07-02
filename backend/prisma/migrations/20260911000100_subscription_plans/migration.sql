-- CreateEnum
CREATE TYPE "SubscriptionPlan" AS ENUM ('FREE', 'BASIC', 'PROFESSIONAL');

-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('ACTIVE', 'PAST_DUE', 'CANCELLED');

-- AlterTable
ALTER TABLE "Company"
ADD COLUMN "plan" "SubscriptionPlan" NOT NULL DEFAULT 'FREE',
ADD COLUMN "subscriptionStatus" "SubscriptionStatus" NOT NULL DEFAULT 'ACTIVE',
ADD COLUMN "planUpdatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN "billingCustomerId" TEXT,
ADD COLUMN "billingSubscriptionId" TEXT;

-- Preserve all current capabilities for companies that existed before plans.
UPDATE "Company" SET "plan" = 'PROFESSIONAL';

-- CreateIndex
CREATE UNIQUE INDEX "Company_billingCustomerId_key" ON "Company"("billingCustomerId");

-- CreateIndex
CREATE UNIQUE INDEX "Company_billingSubscriptionId_key" ON "Company"("billingSubscriptionId");
