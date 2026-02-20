-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "ServiceType" AS ENUM ('SONARR', 'RADARR', 'QBITTORRENT', 'PROWLARR', 'JELLYFIN');

-- CreateTable
CREATE TABLE "ServiceConnection" (
    "id" TEXT NOT NULL,
    "type" "ServiceType" NOT NULL,
    "url" TEXT NOT NULL,
    "apiKey" TEXT NOT NULL,
    "username" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ServiceConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PushSubscription" (
    "id" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "p256dh" TEXT NOT NULL,
    "auth" TEXT NOT NULL,
    "deviceName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PushSubscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationPreference" (
    "id" TEXT NOT NULL,
    "subscriptionId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "tagFilter" TEXT,
    "qualityFilter" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NotificationPreference_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationHistory" (
    "id" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "metadata" JSONB,
    "read" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NotificationHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PollingState" (
    "id" TEXT NOT NULL,
    "serviceType" "ServiceType" NOT NULL,
    "lastQueueIds" JSONB NOT NULL DEFAULT '[]',
    "lastHistoryDate" TIMESTAMP(3),
    "lastHealthHash" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PollingState_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AppSettings" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "pollingIntervalSecs" INTEGER NOT NULL DEFAULT 30,
    "dashboardRefreshIntervalSecs" INTEGER NOT NULL DEFAULT 5,
    "activityRefreshIntervalSecs" INTEGER NOT NULL DEFAULT 5,
    "torrentsRefreshIntervalSecs" INTEGER NOT NULL DEFAULT 5,
    "theme" TEXT NOT NULL DEFAULT 'dark',
    "upcomingAlertHours" INTEGER NOT NULL DEFAULT 24,
    "upcomingNotifyMode" TEXT NOT NULL DEFAULT 'before_air',
    "upcomingNotifyBeforeMins" INTEGER NOT NULL DEFAULT 60,
    "upcomingDailyNotifyHour" INTEGER NOT NULL DEFAULT 9,

    CONSTRAINT "AppSettings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ServiceConnection_type_key" ON "ServiceConnection"("type");

-- CreateIndex
CREATE UNIQUE INDEX "PushSubscription_endpoint_key" ON "PushSubscription"("endpoint");

-- CreateIndex
CREATE UNIQUE INDEX "NotificationPreference_subscriptionId_eventType_key" ON "NotificationPreference"("subscriptionId", "eventType");

-- CreateIndex
CREATE UNIQUE INDEX "PollingState_serviceType_key" ON "PollingState"("serviceType");

-- AddForeignKey
ALTER TABLE "NotificationPreference" ADD CONSTRAINT "NotificationPreference_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "PushSubscription"("id") ON DELETE CASCADE ON UPDATE CASCADE;

