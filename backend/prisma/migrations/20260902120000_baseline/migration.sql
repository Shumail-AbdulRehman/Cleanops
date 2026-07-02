-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "CompletionAttemptStatus" AS ENUM ('APPROVED', 'REJECTED_LOCATION', 'REJECTED_CLEANLINESS', 'ERROR');

-- CreateEnum
CREATE TYPE "AttendanceStatus" AS ENUM ('ABSENT', 'CHECKED_IN', 'CHECKED_OUT', 'LATE', 'MISSED_CHECKOUT');

-- CreateEnum
CREATE TYPE "AssignmentStatus" AS ENUM ('ASSIGNED', 'STARTED', 'COMPLETED', 'MISSED', 'FAILED', 'REASSIGNED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "RecurringType" AS ENUM ('DAILY', 'ONCE');

-- CreateEnum
CREATE TYPE "Role" AS ENUM ('ADMIN', 'MANAGER', 'STAFF');

-- CreateEnum
CREATE TYPE "TaskStatus" AS ENUM ('PENDING', 'IN_PROGRESS', 'COMPLETED', 'NOT_COMPLETED_INTIME', 'MISSED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "SubmissionStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED_TIMEOUT', 'BLOCKED', 'CV_ERROR');

-- CreateTable
CREATE TABLE "Company" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Company_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Manager" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'MANAGER',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "refreshToken" TEXT,
    "companyId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Manager_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Staff" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "password" TEXT NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'STAFF',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "refreshToken" TEXT,
    "companyId" INTEGER NOT NULL,
    "locationId" INTEGER,
    "shiftStart" TIMESTAMP(3),
    "shiftEnd" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Staff_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Location" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "companyId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "latitude" TEXT NOT NULL,
    "longitude" TEXT NOT NULL,
    "radiusMeters" INTEGER NOT NULL DEFAULT 500,
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Karachi',

    CONSTRAINT "Location_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaskTemplate" (
    "id" SERIAL NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "staffId" INTEGER,
    "locationId" INTEGER NOT NULL,
    "shiftStart" TIMESTAMP(3) NOT NULL,
    "shiftEnd" TIMESTAMP(3) NOT NULL,
    "recurringType" "RecurringType",
    "recurringEndDate" TIMESTAMP(3),
    "referenceImageUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "effectiveDate" TIMESTAMP(3) NOT NULL,
    "qrToken" TEXT NOT NULL,

    CONSTRAINT "TaskTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaskInstance" (
    "id" SERIAL NOT NULL,
    "templateId" INTEGER,
    "title" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "lateMinutes" INTEGER,
    "shiftStart" TIMESTAMP(3) NOT NULL,
    "shiftEnd" TIMESTAMP(3) NOT NULL,
    "status" "TaskStatus" NOT NULL DEFAULT 'PENDING',
    "isLate" BOOLEAN NOT NULL DEFAULT false,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "proofImageUrls" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "referenceImageUrl" TEXT,
    "staffId" INTEGER,
    "locationId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "TaskInstance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaskAssignment" (
    "id" SERIAL NOT NULL,
    "taskInstanceId" INTEGER NOT NULL,
    "staffId" INTEGER NOT NULL,
    "status" "AssignmentStatus" NOT NULL DEFAULT 'ASSIGNED',
    "reason" TEXT,
    "isCurrent" BOOLEAN NOT NULL DEFAULT true,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TaskAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaskCompletionAttempt" (
    "id" SERIAL NOT NULL,
    "taskInstanceId" INTEGER NOT NULL,
    "staffId" INTEGER NOT NULL,
    "imageUrl" TEXT NOT NULL,
    "locationMatchScore" INTEGER,
    "cleanlinessMatchScore" INTEGER,
    "locationMatchReason" TEXT,
    "cleanlinessReason" TEXT,
    "rawResponse" JSONB,
    "areaName" TEXT,
    "submissionId" TEXT,
    "status" "CompletionAttemptStatus" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TaskCompletionAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaskAreaSubmission" (
    "id" SERIAL NOT NULL,
    "taskInstanceId" INTEGER NOT NULL,
    "referenceImageId" INTEGER NOT NULL,
    "staffId" INTEGER NOT NULL,
    "photoUrl" TEXT NOT NULL,
    "scannedAt" TIMESTAMP(3) NOT NULL,
    "uploadedAt" TIMESTAMP(3),
    "status" "SubmissionStatus" NOT NULL DEFAULT 'PENDING',
    "similarityScore" DOUBLE PRECISION,
    "areaMatchStatus" TEXT,
    "areaMatchFlag" BOOLEAN NOT NULL DEFAULT false,
    "bestReferenceImageId" INTEGER,
    "colorScore" DOUBLE PRECISION,
    "ssimScore" DOUBLE PRECISION,
    "featureScore" DOUBLE PRECISION,
    "matchThresholdUsed" DOUBLE PRECISION,
    "blockThresholdUsed" DOUBLE PRECISION,
    "colorWeightUsed" DOUBLE PRECISION,
    "ssimWeightUsed" DOUBLE PRECISION,
    "featureWeightUsed" DOUBLE PRECISION,
    "attempts" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TaskAreaSubmission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaskTemplateReferenceImage" (
    "id" SERIAL NOT NULL,
    "templateId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "imageUrl" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TaskTemplateReferenceImage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaskInstanceReferenceImage" (
    "id" SERIAL NOT NULL,
    "taskInstanceId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "imageUrl" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "TaskInstanceReferenceImage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" SERIAL NOT NULL,
    "companyId" INTEGER,
    "actorType" TEXT NOT NULL,
    "actorId" INTEGER,
    "entityType" TEXT NOT NULL,
    "entityId" INTEGER NOT NULL,
    "action" TEXT NOT NULL,
    "reason" TEXT,
    "oldValue" JSONB,
    "newValue" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Attendance" (
    "id" SERIAL NOT NULL,
    "staffId" INTEGER NOT NULL,
    "locationId" INTEGER NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "checkInTime" TIMESTAMP(3),
    "checkOutTime" TIMESTAMP(3),
    "expectedStart" TIMESTAMP(3) NOT NULL,
    "expectedEnd" TIMESTAMP(3) NOT NULL,
    "status" "AttendanceStatus" NOT NULL DEFAULT 'ABSENT',
    "isLateCheckIn" BOOLEAN NOT NULL DEFAULT false,
    "lateMinutes" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "checkInImage" TEXT,
    "checkOutImage" TEXT,

    CONSTRAINT "Attendance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ManagerLocation" (
    "managerId" INTEGER NOT NULL,
    "locationId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ManagerLocation_pkey" PRIMARY KEY ("managerId","locationId")
);

-- CreateIndex
CREATE UNIQUE INDEX "Manager_email_key" ON "Manager"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Staff_email_key" ON "Staff"("email");

-- CreateIndex
CREATE INDEX "Staff_companyId_idx" ON "Staff"("companyId");

-- CreateIndex
CREATE INDEX "Staff_locationId_idx" ON "Staff"("locationId");

-- CreateIndex
CREATE INDEX "Staff_isActive_idx" ON "Staff"("isActive");

-- CreateIndex
CREATE INDEX "Location_companyId_idx" ON "Location"("companyId");

-- CreateIndex
CREATE INDEX "Location_isActive_idx" ON "Location"("isActive");

-- CreateIndex
CREATE UNIQUE INDEX "TaskTemplate_qrToken_key" ON "TaskTemplate"("qrToken");

-- CreateIndex
CREATE INDEX "TaskTemplate_locationId_idx" ON "TaskTemplate"("locationId");

-- CreateIndex
CREATE INDEX "TaskTemplate_isActive_idx" ON "TaskTemplate"("isActive");

-- CreateIndex
CREATE INDEX "TaskTemplate_staffId_isActive_idx" ON "TaskTemplate"("staffId", "isActive");

-- CreateIndex
CREATE INDEX "TaskInstance_locationId_isActive_date_idx" ON "TaskInstance"("locationId", "isActive", "date");

-- CreateIndex
CREATE INDEX "TaskInstance_locationId_status_idx" ON "TaskInstance"("locationId", "status");

-- CreateIndex
CREATE INDEX "TaskInstance_staffId_isActive_date_idx" ON "TaskInstance"("staffId", "isActive", "date");

-- CreateIndex
CREATE INDEX "TaskInstance_staffId_status_idx" ON "TaskInstance"("staffId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "TaskInstance_templateId_date_key" ON "TaskInstance"("templateId", "date");

-- CreateIndex
CREATE INDEX "TaskAssignment_taskInstanceId_idx" ON "TaskAssignment"("taskInstanceId");

-- CreateIndex
CREATE INDEX "TaskAssignment_taskInstanceId_isCurrent_idx" ON "TaskAssignment"("taskInstanceId", "isCurrent");

-- CreateIndex
CREATE INDEX "TaskAssignment_staffId_idx" ON "TaskAssignment"("staffId");

-- CreateIndex
CREATE INDEX "TaskAssignment_staffId_isCurrent_idx" ON "TaskAssignment"("staffId", "isCurrent");

-- CreateIndex
CREATE INDEX "TaskAssignment_status_idx" ON "TaskAssignment"("status");

-- CreateIndex
CREATE INDEX "TaskCompletionAttempt_taskInstanceId_idx" ON "TaskCompletionAttempt"("taskInstanceId");

-- CreateIndex
CREATE INDEX "TaskCompletionAttempt_staffId_idx" ON "TaskCompletionAttempt"("staffId");

-- CreateIndex
CREATE INDEX "TaskAreaSubmission_taskInstanceId_idx" ON "TaskAreaSubmission"("taskInstanceId");

-- CreateIndex
CREATE INDEX "TaskAreaSubmission_staffId_idx" ON "TaskAreaSubmission"("staffId");

-- CreateIndex
CREATE UNIQUE INDEX "TaskAreaSubmission_taskInstanceId_referenceImageId_key" ON "TaskAreaSubmission"("taskInstanceId", "referenceImageId");

-- CreateIndex
CREATE INDEX "TaskTemplateReferenceImage_templateId_idx" ON "TaskTemplateReferenceImage"("templateId");

-- CreateIndex
CREATE INDEX "TaskInstanceReferenceImage_taskInstanceId_idx" ON "TaskInstanceReferenceImage"("taskInstanceId");

-- CreateIndex
CREATE INDEX "AuditLog_companyId_idx" ON "AuditLog"("companyId");

-- CreateIndex
CREATE INDEX "AuditLog_entityType_entityId_idx" ON "AuditLog"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");

-- CreateIndex
CREATE INDEX "Attendance_locationId_date_idx" ON "Attendance"("locationId", "date");

-- CreateIndex
CREATE INDEX "Attendance_staffId_idx" ON "Attendance"("staffId");

-- CreateIndex
CREATE INDEX "Attendance_staffId_date_status_idx" ON "Attendance"("staffId", "date", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Attendance_staffId_date_key" ON "Attendance"("staffId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "ManagerLocation_locationId_key" ON "ManagerLocation"("locationId");

-- CreateIndex
CREATE INDEX "ManagerLocation_locationId_idx" ON "ManagerLocation"("locationId");

-- AddForeignKey
ALTER TABLE "Manager" ADD CONSTRAINT "Manager_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Staff" ADD CONSTRAINT "Staff_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Staff" ADD CONSTRAINT "Staff_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Location" ADD CONSTRAINT "Location_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskTemplate" ADD CONSTRAINT "TaskTemplate_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "Staff"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskTemplate" ADD CONSTRAINT "TaskTemplate_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskInstance" ADD CONSTRAINT "TaskInstance_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "TaskTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskInstance" ADD CONSTRAINT "TaskInstance_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "Staff"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskInstance" ADD CONSTRAINT "TaskInstance_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskAssignment" ADD CONSTRAINT "TaskAssignment_taskInstanceId_fkey" FOREIGN KEY ("taskInstanceId") REFERENCES "TaskInstance"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskAssignment" ADD CONSTRAINT "TaskAssignment_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "Staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskCompletionAttempt" ADD CONSTRAINT "TaskCompletionAttempt_taskInstanceId_fkey" FOREIGN KEY ("taskInstanceId") REFERENCES "TaskInstance"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskCompletionAttempt" ADD CONSTRAINT "TaskCompletionAttempt_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "Staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskAreaSubmission" ADD CONSTRAINT "TaskAreaSubmission_taskInstanceId_fkey" FOREIGN KEY ("taskInstanceId") REFERENCES "TaskInstance"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskAreaSubmission" ADD CONSTRAINT "TaskAreaSubmission_referenceImageId_fkey" FOREIGN KEY ("referenceImageId") REFERENCES "TaskInstanceReferenceImage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskAreaSubmission" ADD CONSTRAINT "TaskAreaSubmission_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "Staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskTemplateReferenceImage" ADD CONSTRAINT "TaskTemplateReferenceImage_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "TaskTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskInstanceReferenceImage" ADD CONSTRAINT "TaskInstanceReferenceImage_taskInstanceId_fkey" FOREIGN KEY ("taskInstanceId") REFERENCES "TaskInstance"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attendance" ADD CONSTRAINT "Attendance_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "Staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attendance" ADD CONSTRAINT "Attendance_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ManagerLocation" ADD CONSTRAINT "ManagerLocation_managerId_fkey" FOREIGN KEY ("managerId") REFERENCES "Manager"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ManagerLocation" ADD CONSTRAINT "ManagerLocation_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE CASCADE ON UPDATE CASCADE;
