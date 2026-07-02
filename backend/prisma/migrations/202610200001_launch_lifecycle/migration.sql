-- CreateEnum
CREATE TYPE "CredentialTokenPurpose" AS ENUM ('VERIFY_OWNER_EMAIL', 'RESET_OWNER_PASSWORD', 'STAFF_ACCESS_HANDOFF');

-- CreateEnum
CREATE TYPE "CompanyOperationalStatus" AS ENUM ('ACTIVE', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "AttendanceAnnotationKind" AS ENUM ('NOTE', 'ACKNOWLEDGEMENT');

-- AlterTable
ALTER TABLE "Company" ADD COLUMN     "accountVersion" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "operationalStatus" "CompanyOperationalStatus" NOT NULL DEFAULT 'ACTIVE',
ADD COLUMN     "suspendedAt" TIMESTAMP(3),
ADD COLUMN     "suspensionReason" TEXT;

-- AlterTable
ALTER TABLE "Manager" ADD COLUMN     "credentialVersion" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "emailVerifiedAt" TIMESTAMP(3),
ADD COLUMN     "mustChangePassword" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Staff" ADD COLUMN     "credentialVersion" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "mustChangePassword" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "CredentialToken" (
    "id" TEXT NOT NULL,
    "tokenHash" CHAR(64) NOT NULL,
    "purpose" "CredentialTokenPurpose" NOT NULL,
    "companyId" INTEGER NOT NULL,
    "managerId" INTEGER,
    "staffId" INTEGER,
    "targetEmail" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CredentialToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AttendanceAnnotation" (
    "id" TEXT NOT NULL,
    "companyId" INTEGER NOT NULL,
    "attendanceId" INTEGER NOT NULL,
    "actorRole" "Role" NOT NULL,
    "actorId" INTEGER NOT NULL,
    "kind" "AttendanceAnnotationKind" NOT NULL DEFAULT 'NOTE',
    "reason" VARCHAR(1000) NOT NULL,
    "requestId" UUID NOT NULL,
    "parentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AttendanceAnnotation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CredentialToken_tokenHash_key" ON "CredentialToken"("tokenHash");

-- CreateIndex
CREATE INDEX "CredentialToken_companyId_purpose_expiresAt_idx" ON "CredentialToken"("companyId", "purpose", "expiresAt");

-- CreateIndex
CREATE INDEX "CredentialToken_managerId_purpose_idx" ON "CredentialToken"("managerId", "purpose");

-- CreateIndex
CREATE INDEX "CredentialToken_staffId_purpose_idx" ON "CredentialToken"("staffId", "purpose");

-- CreateIndex
CREATE INDEX "AttendanceAnnotation_attendanceId_createdAt_idx" ON "AttendanceAnnotation"("attendanceId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "AttendanceAnnotation_companyId_actorRole_actorId_requestId_key" ON "AttendanceAnnotation"("companyId", "actorRole", "actorId", "requestId");

-- CreateIndex
CREATE UNIQUE INDEX "Manager_id_companyId_key" ON "Manager"("id", "companyId");

-- CreateIndex
CREATE UNIQUE INDEX "Staff_id_companyId_key" ON "Staff"("id", "companyId");

-- AddForeignKey
ALTER TABLE "CredentialToken" ADD CONSTRAINT "CredentialToken_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CredentialToken" ADD CONSTRAINT "CredentialToken_managerId_companyId_fkey" FOREIGN KEY ("managerId", "companyId") REFERENCES "Manager"("id", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CredentialToken" ADD CONSTRAINT "CredentialToken_staffId_companyId_fkey" FOREIGN KEY ("staffId", "companyId") REFERENCES "Staff"("id", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttendanceAnnotation" ADD CONSTRAINT "AttendanceAnnotation_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttendanceAnnotation" ADD CONSTRAINT "AttendanceAnnotation_attendanceId_fkey" FOREIGN KEY ("attendanceId") REFERENCES "Attendance"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttendanceAnnotation" ADD CONSTRAINT "AttendanceAnnotation_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "AttendanceAnnotation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Existing inactive companies remain restricted. Do not fabricate historical
-- suspension times or reasons; the legacy isActive gate stays authoritative.
UPDATE "Company" SET "operationalStatus" = 'SUSPENDED' WHERE NOT "isActive";

ALTER TABLE "Manager" ADD CONSTRAINT "Manager_credential_version_nonnegative" CHECK ("credentialVersion" >= 0);
ALTER TABLE "Staff" ADD CONSTRAINT "Staff_credential_version_nonnegative" CHECK ("credentialVersion" >= 0);
ALTER TABLE "Company" ADD CONSTRAINT "Company_account_version_nonnegative" CHECK ("accountVersion" >= 0);
ALTER TABLE "CredentialToken" ADD CONSTRAINT "CredentialToken_hash_format" CHECK ("tokenHash" ~ '^[a-f0-9]{64}$');
ALTER TABLE "CredentialToken" ADD CONSTRAINT "CredentialToken_lifetime" CHECK ("expiresAt" > "createdAt" AND ("consumedAt" IS NULL OR "consumedAt" >= "createdAt"));
ALTER TABLE "CredentialToken" ADD CONSTRAINT "CredentialToken_principal_purpose" CHECK (
  ("purpose" IN ('VERIFY_OWNER_EMAIL', 'RESET_OWNER_PASSWORD') AND "managerId" IS NOT NULL AND "staffId" IS NULL AND "targetEmail" IS NOT NULL AND length(btrim("targetEmail")) > 0)
  OR ("purpose" = 'STAFF_ACCESS_HANDOFF' AND "staffId" IS NOT NULL AND "managerId" IS NULL AND "targetEmail" IS NULL)
);
ALTER TABLE "AttendanceAnnotation" ADD CONSTRAINT "AttendanceAnnotation_reason_required" CHECK (length(btrim("reason")) > 0);
ALTER TABLE "AttendanceAnnotation" ADD CONSTRAINT "AttendanceAnnotation_parent_kind" CHECK (
  ("kind" = 'NOTE' AND "parentId" IS NULL) OR ("kind" = 'ACKNOWLEDGEMENT' AND "parentId" IS NOT NULL AND "actorRole" IN ('ADMIN', 'MANAGER'))
);

-- Notes are attributed append-only context, never edits to captured facts.
CREATE FUNCTION enforce_attendance_annotation() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE attendance_staff integer; attendance_site integer; staff_company integer; site_company integer;
BEGIN
  IF TG_OP <> 'INSERT' THEN RAISE EXCEPTION 'Attendance annotations are immutable' USING ERRCODE = '23514'; END IF;
  SELECT a."staffId",a."locationId",s."companyId",l."companyId"
    INTO attendance_staff,attendance_site,staff_company,site_company
    FROM "Attendance" a JOIN "Staff" s ON s.id=a."staffId" JOIN "Location" l ON l.id=a."locationId"
    WHERE a.id=NEW."attendanceId";
  IF staff_company IS DISTINCT FROM NEW."companyId" OR site_company IS DISTINCT FROM NEW."companyId" THEN
    RAISE EXCEPTION 'Annotation tenant binding invalid' USING ERRCODE = '23514';
  END IF;
  IF NEW."actorRole" = 'STAFF' THEN
    IF NEW."actorId" <> attendance_staff OR NOT EXISTS (SELECT 1 FROM "Staff" WHERE id=NEW."actorId" AND "companyId"=NEW."companyId" AND "isActive") THEN
      RAISE EXCEPTION 'Annotation staff binding invalid' USING ERRCODE = '23514';
    END IF;
  ELSE
    IF NOT EXISTS (SELECT 1 FROM "Manager" WHERE id=NEW."actorId" AND role=NEW."actorRole" AND "companyId"=NEW."companyId" AND "isActive") THEN
      RAISE EXCEPTION 'Annotation manager binding invalid' USING ERRCODE = '23514';
    END IF;
    IF NEW."actorRole" = 'MANAGER' AND NOT EXISTS (SELECT 1 FROM "ManagerLocation" WHERE "managerId"=NEW."actorId" AND "locationId"=attendance_site) THEN
      RAISE EXCEPTION 'Annotation site binding invalid' USING ERRCODE = '23514';
    END IF;
  END IF;
  IF NEW."parentId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "AttendanceAnnotation" WHERE id=NEW."parentId" AND "companyId"=NEW."companyId" AND "attendanceId"=NEW."attendanceId" AND kind='NOTE') THEN
    RAISE EXCEPTION 'Annotation parent binding invalid' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER attendance_annotation_integrity BEFORE INSERT OR UPDATE OR DELETE ON "AttendanceAnnotation" FOR EACH ROW EXECUTE FUNCTION enforce_attendance_annotation();
