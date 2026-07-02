-- AlterTable
ALTER TABLE "Staff" ALTER COLUMN "email" DROP NOT NULL;

-- CreateTable
CREATE TABLE "StaffLoginCode" (
    "id" SERIAL NOT NULL,
    "staffId" INTEGER NOT NULL,
    "companyId" INTEGER NOT NULL,
    "phone" TEXT NOT NULL,
    "codeHash" CHAR(64) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StaffLoginCode_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Staff_phone_key" ON "Staff"("phone");
CREATE INDEX "StaffLoginCode_phone_createdAt_idx" ON "StaffLoginCode"("phone", "createdAt");
CREATE INDEX "StaffLoginCode_createdAt_idx" ON "StaffLoginCode"("createdAt");
CREATE INDEX "StaffLoginCode_staffId_idx" ON "StaffLoginCode"("staffId");

-- AddForeignKey
ALTER TABLE "StaffLoginCode" ADD CONSTRAINT "StaffLoginCode_staffId_companyId_fkey" FOREIGN KEY ("staffId", "companyId") REFERENCES "Staff"("id", "companyId") ON DELETE CASCADE ON UPDATE CASCADE;
