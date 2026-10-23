CREATE TABLE "NotionIntegration" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "token" TEXT NOT NULL DEFAULT '',
    "databaseId" TEXT NOT NULL DEFAULT '',
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "syncOffset" INTEGER NOT NULL DEFAULT 0,
    "conversationSyncOffset" INTEGER NOT NULL DEFAULT 0,
    "lastSyncAt" TIMESTAMP(3),
    "lastSyncError" TEXT NOT NULL DEFAULT '',
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "NotionIntegration_pkey" PRIMARY KEY ("id")
);
