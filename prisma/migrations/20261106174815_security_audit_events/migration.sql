-- CreateEnum
CREATE TYPE "SecurityAuditAction" AS ENUM ('LOGIN_SUCCEEDED', 'LOGIN_FAILED', 'USER_CREATED', 'USER_UPDATED', 'USER_DELETED', 'USER_PERMISSIONS_CHANGED', 'PASSWORD_CHANGED', 'SESSION_REVOKED', 'SERVICE_CREATED', 'SERVICE_UPDATED', 'SERVICE_DELETED', 'SETTINGS_IMPORTED');

-- CreateTable
CREATE TABLE "SecurityAuditEvent" (
    "id" TEXT NOT NULL,
    "actorUserId" TEXT,
    "actorUsername" TEXT,
    "action" "SecurityAuditAction" NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT,
    "targetLabel" TEXT,
    "fields" JSONB,
    "count" INTEGER NOT NULL DEFAULT 1,
    "ip" TEXT,
    "userAgent" TEXT,
    "requestId" TEXT,
    "coalesceKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SecurityAuditEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SecurityAuditEvent_coalesceKey_key" ON "SecurityAuditEvent"("coalesceKey");

-- CreateIndex
CREATE INDEX "SecurityAuditEvent_createdAt_idx" ON "SecurityAuditEvent"("createdAt");

-- CreateIndex
CREATE INDEX "SecurityAuditEvent_action_createdAt_idx" ON "SecurityAuditEvent"("action", "createdAt");
