CREATE TABLE "WhatsAppFallback" (
    "id" TEXT NOT NULL,
    "inboundMessageId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "customerContact" TEXT NOT NULL,
    "replyContent" TEXT NOT NULL DEFAULT '',
    "fallbackProvider" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "dueAt" TIMESTAMP(3) NOT NULL,
    "lockedAt" TIMESTAMP(3),
    "providerMessageId" TEXT NOT NULL DEFAULT '',
    "lastErrorCode" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "WhatsAppFallback_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "WhatsAppProviderEvent" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "externalEventId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'received',
    "conversationId" TEXT,
    "messageId" TEXT,
    "lastErrorCode" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "WhatsAppProviderEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "WhatsAppFallback_inboundMessageId_key" ON "WhatsAppFallback"("inboundMessageId");
CREATE INDEX "WhatsAppFallback_status_dueAt_idx" ON "WhatsAppFallback"("status", "dueAt");
CREATE INDEX "WhatsAppFallback_conversationId_createdAt_idx" ON "WhatsAppFallback"("conversationId", "createdAt");
CREATE UNIQUE INDEX "WhatsAppProviderEvent_provider_externalEventId_key" ON "WhatsAppProviderEvent"("provider", "externalEventId");
CREATE INDEX "WhatsAppProviderEvent_status_createdAt_idx" ON "WhatsAppProviderEvent"("status", "createdAt");
