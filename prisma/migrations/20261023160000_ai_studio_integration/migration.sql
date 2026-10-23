CREATE TABLE "AiStudioIntegration" (
  "id" TEXT NOT NULL DEFAULT 'default',
  "secretHash" TEXT NOT NULL DEFAULT '',
  "secretHint" TEXT NOT NULL DEFAULT '',
  "enabled" BOOLEAN NOT NULL DEFAULT false,
  "lastUsedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AiStudioIntegration_pkey" PRIMARY KEY ("id")
);
