CREATE TABLE "DeletedMedia" (
  "id" SERIAL NOT NULL,
  "url" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "retryAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DeletedMedia_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "DeletedMedia_url_key" ON "DeletedMedia"("url");
CREATE INDEX "DeletedMedia_retryAt_idx" ON "DeletedMedia"("retryAt");
