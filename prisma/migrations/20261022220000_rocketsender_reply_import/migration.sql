-- CreateTable
CREATE TABLE "RocketIntegration" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "mode" TEXT NOT NULL DEFAULT 'disabled',
    "accountId" TEXT NOT NULL DEFAULT '',
    "trialPhone" TEXT NOT NULL DEFAULT '',
    "compatibilityVerified" BOOLEAN NOT NULL DEFAULT false,
    "aiSuggestions" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RocketIntegration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RocketOutbound" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "sourceMessageId" TEXT NOT NULL,
    "content" TEXT NOT NULL DEFAULT '',
    "sentAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RocketOutbound_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RocketContact" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,

    CONSTRAINT "RocketContact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RocketThread" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,

    CONSTRAINT "RocketThread_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RocketImportEvent" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "externalEventId" TEXT NOT NULL,
    "externalMessageId" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lockedAt" TIMESTAMP(3),
    "lastErrorCode" TEXT NOT NULL DEFAULT '',
    "customerId" TEXT,
    "conversationId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RocketImportEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RocketMessage" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'whatsapp-web',
    "externalMessageId" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,

    CONSTRAINT "RocketMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RocketOutbound_organizationId_accountId_phone_sentAt_idx" ON "RocketOutbound"("organizationId", "accountId", "phone", "sentAt");

-- CreateIndex
CREATE UNIQUE INDEX "RocketOutbound_organizationId_accountId_sourceMessageId_key" ON "RocketOutbound"("organizationId", "accountId", "sourceMessageId");

-- CreateIndex
CREATE UNIQUE INDEX "RocketContact_organizationId_phone_key" ON "RocketContact"("organizationId", "phone");

-- CreateIndex
CREATE UNIQUE INDEX "RocketThread_organizationId_accountId_phone_externalId_key" ON "RocketThread"("organizationId", "accountId", "phone", "externalId");

-- CreateIndex
CREATE INDEX "RocketImportEvent_status_nextAttemptAt_idx" ON "RocketImportEvent"("status", "nextAttemptAt");

-- CreateIndex
CREATE UNIQUE INDEX "RocketImportEvent_organizationId_accountId_externalEventId_key" ON "RocketImportEvent"("organizationId", "accountId", "externalEventId");

-- CreateIndex
CREATE UNIQUE INDEX "RocketMessage_organizationId_accountId_source_externalMessa_key" ON "RocketMessage"("organizationId", "accountId", "source", "externalMessageId");

-- AddForeignKey
ALTER TABLE "RocketContact" ADD CONSTRAINT "RocketContact_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RocketThread" ADD CONSTRAINT "RocketThread_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
