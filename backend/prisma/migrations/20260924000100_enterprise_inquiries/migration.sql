CREATE TABLE "EnterpriseInquiry" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "company" TEXT NOT NULL,
    "locations" INTEGER NOT NULL,
    "staff" INTEGER NOT NULL,
    "requirements" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "EnterpriseInquiry_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "EnterpriseInquiry_createdAt_idx" ON "EnterpriseInquiry"("createdAt");
