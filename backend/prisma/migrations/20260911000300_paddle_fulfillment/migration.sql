-- Paddle customers are allowed to exist without an email temporarily because
-- Paddle webhook deliveries can arrive out of order.
CREATE TABLE "PaddleCustomer" (
    "id" TEXT NOT NULL,
    "email" TEXT,
    "name" TEXT,
    "locale" TEXT,
    "status" TEXT NOT NULL,
    "companyId" INTEGER,
    "paddleCreatedAt" TIMESTAMP(3),
    "paddleUpdatedAt" TIMESTAMP(3) NOT NULL,
    "lastEventAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaddleCustomer_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PaddleSubscription" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "companyId" INTEGER,
    "status" TEXT NOT NULL,
    "priceId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "scheduledChangeAction" TEXT,
    "scheduledChangeAt" TIMESTAMP(3),
    "currentBillingPeriodStart" TIMESTAMP(3),
    "currentBillingPeriodEnd" TIMESTAMP(3),
    "canceledAt" TIMESTAMP(3),
    "pausedAt" TIMESTAMP(3),
    "paddleCreatedAt" TIMESTAMP(3),
    "paddleUpdatedAt" TIMESTAMP(3) NOT NULL,
    "lastEventAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaddleSubscription_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PaddleTransaction" (
    "id" TEXT NOT NULL,
    "customerId" TEXT,
    "subscriptionId" TEXT,
    "companyId" INTEGER,
    "status" TEXT NOT NULL,
    "currencyCode" TEXT NOT NULL,
    "total" TEXT,
    "invoiceNumber" TEXT,
    "paddleCreatedAt" TIMESTAMP(3),
    "paddleUpdatedAt" TIMESTAMP(3) NOT NULL,
    "lastEventAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaddleTransaction_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PaddleWebhookEvent" (
    "id" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "processedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaddleWebhookEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PaddleCustomer_companyId_key" ON "PaddleCustomer"("companyId");
CREATE INDEX "PaddleCustomer_email_idx" ON "PaddleCustomer"("email");
CREATE INDEX "PaddleSubscription_customerId_idx" ON "PaddleSubscription"("customerId");
CREATE INDEX "PaddleSubscription_companyId_status_idx" ON "PaddleSubscription"("companyId", "status");
CREATE INDEX "PaddleTransaction_customerId_idx" ON "PaddleTransaction"("customerId");
CREATE INDEX "PaddleTransaction_subscriptionId_idx" ON "PaddleTransaction"("subscriptionId");
CREATE INDEX "PaddleTransaction_companyId_idx" ON "PaddleTransaction"("companyId");
CREATE INDEX "PaddleWebhookEvent_eventType_idx" ON "PaddleWebhookEvent"("eventType");
CREATE INDEX "PaddleWebhookEvent_occurredAt_idx" ON "PaddleWebhookEvent"("occurredAt");

ALTER TABLE "PaddleCustomer"
ADD CONSTRAINT "PaddleCustomer_companyId_fkey"
FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "PaddleSubscription"
ADD CONSTRAINT "PaddleSubscription_customerId_fkey"
FOREIGN KEY ("customerId") REFERENCES "PaddleCustomer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "PaddleSubscription"
ADD CONSTRAINT "PaddleSubscription_companyId_fkey"
FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "PaddleTransaction"
ADD CONSTRAINT "PaddleTransaction_customerId_fkey"
FOREIGN KEY ("customerId") REFERENCES "PaddleCustomer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "PaddleTransaction"
ADD CONSTRAINT "PaddleTransaction_subscriptionId_fkey"
FOREIGN KEY ("subscriptionId") REFERENCES "PaddleSubscription"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "PaddleTransaction"
ADD CONSTRAINT "PaddleTransaction_companyId_fkey"
FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;
