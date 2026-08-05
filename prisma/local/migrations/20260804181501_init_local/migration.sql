-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "SessionStatus" AS ENUM ('active', 'expired', 'revoked');

-- CreateTable
CREATE TABLE "LocalSession" (
    "id" TEXT NOT NULL,
    "appKey" TEXT NOT NULL,
    "sessionTokenHash" TEXT NOT NULL,
    "externalUserId" TEXT NOT NULL,
    "centralSessionId" TEXT NOT NULL,
    "status" "SessionStatus" NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "lastActivityAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "revokeReason" TEXT,

    CONSTRAINT "LocalSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProfileCache" (
    "id" TEXT NOT NULL,
    "appKey" TEXT NOT NULL,
    "externalUserId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "groups" JSONB,
    "syncedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProfileCache_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProcessedEvent" (
    "eventId" TEXT NOT NULL,
    "appKey" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "processedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "result" TEXT NOT NULL,

    CONSTRAINT "ProcessedEvent_pkey" PRIMARY KEY ("eventId")
);

-- CreateTable
CREATE TABLE "ActivityLog" (
    "id" TEXT NOT NULL,
    "appKey" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "requestId" TEXT,
    "correlationId" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ActivityLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "LocalSession_sessionTokenHash_key" ON "LocalSession"("sessionTokenHash");

-- CreateIndex
CREATE INDEX "LocalSession_appKey_externalUserId_idx" ON "LocalSession"("appKey", "externalUserId");

-- CreateIndex
CREATE INDEX "LocalSession_appKey_centralSessionId_idx" ON "LocalSession"("appKey", "centralSessionId");

-- CreateIndex
CREATE UNIQUE INDEX "ProfileCache_appKey_externalUserId_key" ON "ProfileCache"("appKey", "externalUserId");

-- CreateIndex
CREATE INDEX "ProcessedEvent_appKey_eventType_idx" ON "ProcessedEvent"("appKey", "eventType");

-- CreateIndex
CREATE INDEX "ActivityLog_appKey_createdAt_idx" ON "ActivityLog"("appKey", "createdAt");
