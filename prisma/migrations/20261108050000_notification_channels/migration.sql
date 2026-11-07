-- Outbound notification channels (ntfy, Gotify, Apprise, JSON webhook, email), one
-- user each. Secrets are stored encrypted (enc:v1:) in "secrets".

-- CreateTable
CREATE TABLE "NotificationChannel" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "events" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "config" JSONB NOT NULL DEFAULT '{}',
    "secrets" TEXT,
    "consecutiveFailures" INTEGER NOT NULL DEFAULT 0,
    "lastFailedAt" TIMESTAMP(3),
    "lastSucceededAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NotificationChannel_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "NotificationChannel_userId_name_key" ON "NotificationChannel"("userId", "name");

-- AddForeignKey
ALTER TABLE "NotificationChannel" ADD CONSTRAINT "NotificationChannel_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
