-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "ServiceType" AS ENUM ('SONARR', 'RADARR', 'QBITTORRENT', 'PROWLARR', 'JELLYFIN', 'TMDB', 'ANILIST', 'SEERR', 'LIDARR');

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('admin', 'member');

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('active', 'pending', 'disabled');

-- CreateEnum
CREATE TYPE "CleanupAction" AS ENUM ('strikeAdded', 'removedFromClient', 'removedFromQueue', 'categoryChanged', 'skipped', 'dryRunPreview', 'failed');

-- CreateEnum
CREATE TYPE "FileOperation" AS ENUM ('EDIT', 'DELETE', 'IMPORT');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "passwordHash" TEXT,
    "role" "UserRole" NOT NULL DEFAULT 'member',
    "status" "UserStatus" NOT NULL DEFAULT 'active',
    "template" TEXT NOT NULL DEFAULT 'member',
    "permissions" JSONB NOT NULL DEFAULT '{}',
    "jellyfinUserId" TEXT,
    "seerrUserId" TEXT,
    "jellyfinToken" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ServiceConnection" (
    "id" TEXT NOT NULL,
    "type" "ServiceType" NOT NULL,
    "label" TEXT NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "url" TEXT NOT NULL,
    "apiKey" TEXT NOT NULL,
    "username" TEXT,
    "externalUrl" TEXT,
    "accessToken" TEXT,
    "refreshToken" TEXT,
    "tokenExpiresAt" TIMESTAMP(3),
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ServiceConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userAgent" TEXT,
    "ip" TEXT,
    "label" TEXT,
    "revokedAt" TIMESTAMP(3),
    "userId" TEXT,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WatchlistItem" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "source" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "mediaType" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "year" INTEGER,
    "posterUrl" TEXT,
    "overview" TEXT,
    "rating" DOUBLE PRECISION,
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reminderAt" TIMESTAMP(3),
    "reminderNotifiedAt" TIMESTAMP(3),
    "reminderAttempts" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "WatchlistItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WatchlistTag" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT,

    CONSTRAINT "WatchlistTag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScheduledAlert" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "mediaType" TEXT NOT NULL,
    "instanceId" TEXT,
    "title" TEXT NOT NULL,
    "subtitle" TEXT,
    "posterUrl" TEXT,
    "href" TEXT,
    "scheduleMode" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "releaseTypes" JSONB NOT NULL DEFAULT '[]',
    "offsetMinutes" INTEGER NOT NULL DEFAULT 0,
    "timeZone" TEXT NOT NULL DEFAULT 'UTC',
    "status" TEXT NOT NULL DEFAULT 'active',
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "cancelledAt" TIMESTAMP(3),

    CONSTRAINT "ScheduledAlert_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScheduledAlertOccurrence" (
    "id" TEXT NOT NULL,
    "alertId" TEXT NOT NULL,
    "releaseAt" TIMESTAMP(3),
    "notifyAt" TIMESTAMP(3) NOT NULL,
    "releaseKind" TEXT NOT NULL,
    "targetKey" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT,
    "metadata" JSONB,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastAttemptAt" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ScheduledAlertOccurrence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PushSubscription" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "endpoint" TEXT NOT NULL,
    "p256dh" TEXT NOT NULL,
    "auth" TEXT NOT NULL,
    "deviceName" TEXT,
    "consecutiveFailures" INTEGER NOT NULL DEFAULT 0,
    "lastFailedAt" TIMESTAMP(3),
    "lastSucceededAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
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
    "mutedUserFilter" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NotificationPreference_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationHistory" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "eventType" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "metadata" JSONB,
    "read" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dedupeKey" TEXT,

    CONSTRAINT "NotificationHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PollingState" (
    "id" TEXT NOT NULL,
    "serviceConnectionId" TEXT NOT NULL,
    "lastQueueIds" JSONB NOT NULL DEFAULT '[]',
    "lastHistoryDate" TIMESTAMP(3),
    "lastHistoryId" INTEGER,
    "lastHistorySeenIds" JSONB NOT NULL DEFAULT '[]',
    "lastHealthHash" TEXT,
    "lastReachable" BOOLEAN,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PollingState_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DiskUsageSnapshot" (
    "id" TEXT NOT NULL,
    "diskId" TEXT NOT NULL,
    "label" TEXT,
    "path" TEXT NOT NULL,
    "totalSpace" BIGINT NOT NULL,
    "freeSpace" BIGINT NOT NULL,
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "capturedDate" DATE NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DiskUsageSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AppSettings" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "pollingIntervalSecs" INTEGER NOT NULL DEFAULT 30,
    "activityRefreshIntervalSecs" INTEGER NOT NULL DEFAULT 5,
    "torrentsRefreshIntervalSecs" INTEGER NOT NULL DEFAULT 5,
    "cacheImagesEnabled" BOOLEAN NOT NULL DEFAULT true,
    "timeZone" TEXT NOT NULL DEFAULT 'UTC',
    "logEnabled" BOOLEAN NOT NULL DEFAULT true,
    "logLevel" TEXT NOT NULL DEFAULT 'debug',
    "logMaxFileMb" INTEGER NOT NULL DEFAULT 50,
    "logRetentionDays" INTEGER NOT NULL DEFAULT 30,
    "notificationHistoryRetentionDays" INTEGER NOT NULL DEFAULT 90,
    "logClientConsoleEnabled" BOOLEAN NOT NULL DEFAULT true,
    "logFailedRequestBodies" BOOLEAN NOT NULL DEFAULT false,
    "logFailedResponseBodies" BOOLEAN NOT NULL DEFAULT false,
    "upcomingNotifyMode" TEXT NOT NULL DEFAULT 'before_air',
    "upcomingNotifyBeforeMins" INTEGER NOT NULL DEFAULT 60,
    "upcomingDailyNotifyHour" INTEGER NOT NULL DEFAULT 9,
    "watchProviderRegion" TEXT NOT NULL DEFAULT 'US',
    "activityDigestMode" TEXT NOT NULL DEFAULT 'off',
    "activityDigestHour" INTEGER NOT NULL DEFAULT 8,
    "activityDigestDayOfWeek" INTEGER NOT NULL DEFAULT 1,
    "notificationGroupingEnabled" BOOLEAN NOT NULL DEFAULT true,
    "animeAutoMapEnabled" BOOLEAN NOT NULL DEFAULT true,
    "animeAutoMapHour" INTEGER NOT NULL DEFAULT 0,
    "animeAutoMapLastRunAt" TIMESTAMP(3),
    "anilistSectionsTtlMin" INTEGER NOT NULL DEFAULT 5,
    "anilistBrowseTtlMin" INTEGER NOT NULL DEFAULT 10,
    "anilistDetailTtlMin" INTEGER NOT NULL DEFAULT 1440,
    "anilistAiringTtlMin" INTEGER NOT NULL DEFAULT 10,
    "qbtBandwidthSchedule" JSONB,
    "diskThresholds" JSONB,
    "diskAlertState" JSONB,
    "discoverLayout" JSONB,
    "defaultDesktopLayoutId" TEXT,
    "defaultMobileLayoutId" TEXT,

    CONSTRAINT "AppSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DashboardLayout" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "name" TEXT NOT NULL,
    "widgets" JSONB NOT NULL,
    "isBuiltIn" BOOLEAN NOT NULL DEFAULT false,
    "slug" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DashboardLayout_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserAniListLink" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "accessToken" TEXT,
    "refreshToken" TEXT,
    "tokenExpiresAt" TIMESTAMP(3),
    "anilistUserId" INTEGER,
    "username" TEXT,
    "avatar" TEXT,
    "siteUrl" TEXT,
    "scoreFormat" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserAniListLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserSettings" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "timeZone" TEXT,
    "upcomingNotifyMode" TEXT,
    "activityDigestMode" TEXT,
    "defaultDesktopLayoutId" TEXT,
    "defaultMobileLayoutId" TEXT,
    "quietHoursEnabled" BOOLEAN NOT NULL DEFAULT false,
    "quietHoursStart" INTEGER,
    "quietHoursEnd" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PendingRequest" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "mediaType" TEXT NOT NULL,
    "tmdbId" INTEGER NOT NULL,
    "title" TEXT,
    "posterUrl" TEXT,
    "is4k" BOOLEAN NOT NULL DEFAULT false,
    "seasons" JSONB,
    "serverId" INTEGER,
    "profileId" INTEGER,
    "rootFolder" TEXT,
    "languageProfileId" INTEGER,
    "tags" JSONB,
    "seerrUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PendingRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AniListSeriesMapping" (
    "id" TEXT NOT NULL,
    "sonarrInstanceId" TEXT NOT NULL,
    "sonarrSeriesId" INTEGER NOT NULL,
    "state" TEXT NOT NULL,
    "matchMethod" TEXT,
    "confidence" INTEGER,
    "seriesTitleSnapshot" TEXT NOT NULL,
    "seriesYearSnapshot" INTEGER,
    "seriesTvdbIdSnapshot" INTEGER,
    "seriesTmdbIdSnapshot" INTEGER,
    "resolvedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AniListSeriesMapping_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AniListSeriesMappingEntry" (
    "id" TEXT NOT NULL,
    "mappingId" TEXT NOT NULL,
    "anilistMediaId" INTEGER NOT NULL,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "order" INTEGER NOT NULL DEFAULT 0,
    "source" TEXT NOT NULL DEFAULT 'manual',
    "titleSnapshot" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AniListSeriesMappingEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QueueCleanerConfig" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "intervalMinutes" INTEGER NOT NULL DEFAULT 5,
    "ignoredDownloads" JSONB NOT NULL DEFAULT '[]',
    "processNoContentId" BOOLEAN NOT NULL DEFAULT false,
    "downloadingMetadataMaxStrikes" INTEGER NOT NULL DEFAULT 0,
    "failedImport" JSONB NOT NULL DEFAULT '{}',
    "reSearchAfterRemoval" BOOLEAN NOT NULL DEFAULT true,
    "autoRunMode" TEXT NOT NULL DEFAULT 'disabled',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QueueCleanerConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StallRule" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "maxStrikes" INTEGER NOT NULL DEFAULT 3,
    "privacyType" TEXT NOT NULL DEFAULT 'public',
    "minCompletionPercentage" INTEGER NOT NULL DEFAULT 0,
    "maxCompletionPercentage" INTEGER NOT NULL DEFAULT 100,
    "resetStrikesOnProgress" BOOLEAN NOT NULL DEFAULT true,
    "minimumProgressBytes" BIGINT,
    "changeCategory" BOOLEAN NOT NULL DEFAULT false,
    "deletePrivate" BOOLEAN NOT NULL DEFAULT false,
    "reSearchOverride" BOOLEAN,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StallRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SlowRule" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "maxStrikes" INTEGER NOT NULL DEFAULT 3,
    "privacyType" TEXT NOT NULL DEFAULT 'public',
    "minCompletionPercentage" INTEGER NOT NULL DEFAULT 0,
    "maxCompletionPercentage" INTEGER NOT NULL DEFAULT 100,
    "minSpeedKbps" INTEGER,
    "maxTimeHours" DOUBLE PRECISION,
    "ignoreAboveSizeBytes" BIGINT,
    "resetStrikesOnProgress" BOOLEAN NOT NULL DEFAULT true,
    "changeCategory" BOOLEAN NOT NULL DEFAULT false,
    "deletePrivate" BOOLEAN NOT NULL DEFAULT false,
    "reSearchOverride" BOOLEAN,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SlowRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DownloadCleanerConfig" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "intervalMinutes" INTEGER NOT NULL DEFAULT 60,
    "ignoredDownloads" JSONB NOT NULL DEFAULT '[]',
    "autoRemoveImportedEnabled" BOOLEAN NOT NULL DEFAULT false,
    "autoRemoveImportedCategories" JSONB NOT NULL DEFAULT '["sonarr","radarr","tv-sonarr"]',
    "autoRemoveImportedDeleteFiles" BOOLEAN NOT NULL DEFAULT true,
    "autoRemoveImportedPrivacyType" TEXT NOT NULL DEFAULT 'public',
    "autoRunMode" TEXT NOT NULL DEFAULT 'disabled',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DownloadCleanerConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SeedingRule" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "categories" JSONB NOT NULL DEFAULT '[]',
    "trackerPatterns" JSONB NOT NULL DEFAULT '[]',
    "tagsAny" JSONB NOT NULL DEFAULT '[]',
    "tagsAll" JSONB NOT NULL DEFAULT '[]',
    "privacyType" TEXT NOT NULL DEFAULT 'both',
    "maxRatio" DOUBLE PRECISION NOT NULL DEFAULT -1,
    "minSeedTimeHours" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "maxSeedTimeHours" DOUBLE PRECISION NOT NULL DEFAULT -1,
    "deleteSourceFiles" BOOLEAN NOT NULL DEFAULT true,
    "requireImportedConfirmation" BOOLEAN NOT NULL DEFAULT false,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SeedingRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CleanupStrike" (
    "id" TEXT NOT NULL,
    "hash" TEXT NOT NULL,
    "torrentName" TEXT NOT NULL,
    "ruleId" TEXT,
    "strikeType" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "lastDownloadedBytes" BIGINT,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CleanupStrike_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CleanupHistory" (
    "id" TEXT NOT NULL,
    "cleaner" TEXT NOT NULL,
    "strikeType" TEXT,
    "ruleId" TEXT,
    "ruleName" TEXT,
    "hash" TEXT NOT NULL,
    "shortHash" TEXT NOT NULL,
    "torrentName" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "action" "CleanupAction" NOT NULL,
    "filesDeleted" BOOLEAN NOT NULL,
    "reSearched" BOOLEAN NOT NULL,
    "linkedArrSource" TEXT,
    "linkedArrTitle" TEXT,
    "linkedArrItemId" INTEGER,
    "torrentSize" BIGINT,
    "torrentProgress" DOUBLE PRECISION,
    "torrentRatio" DOUBLE PRECISION,
    "triggeredBy" TEXT NOT NULL,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CleanupHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FileOperationAudit" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "username" TEXT NOT NULL,
    "service" "ServiceType" NOT NULL,
    "instanceId" TEXT,
    "operation" "FileOperation" NOT NULL,
    "mediaType" TEXT NOT NULL,
    "mediaId" INTEGER NOT NULL,
    "mediaTitle" TEXT NOT NULL,
    "fileCount" INTEGER NOT NULL,
    "details" JSONB,
    "success" BOOLEAN NOT NULL,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FileOperationAudit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "_WatchlistItemTags" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_WatchlistItemTags_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");

-- CreateIndex
CREATE UNIQUE INDEX "User_jellyfinUserId_key" ON "User"("jellyfinUserId");

-- CreateIndex
CREATE UNIQUE INDEX "User_seerrUserId_key" ON "User"("seerrUserId");

-- CreateIndex
CREATE INDEX "User_jellyfinUserId_idx" ON "User"("jellyfinUserId");

-- CreateIndex
CREATE INDEX "User_status_idx" ON "User"("status");

-- CreateIndex
CREATE INDEX "ServiceConnection_type_idx" ON "ServiceConnection"("type");

-- CreateIndex
CREATE UNIQUE INDEX "ServiceConnection_type_label_key" ON "ServiceConnection"("type", "label");

-- CreateIndex
CREATE INDEX "Session_revokedAt_idx" ON "Session"("revokedAt");

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "Session"("userId");

-- CreateIndex
CREATE INDEX "WatchlistItem_userId_addedAt_idx" ON "WatchlistItem"("userId", "addedAt");

-- CreateIndex
CREATE INDEX "WatchlistItem_reminderAt_reminderNotifiedAt_idx" ON "WatchlistItem"("reminderAt", "reminderNotifiedAt");

-- CreateIndex
CREATE UNIQUE INDEX "WatchlistItem_userId_source_externalId_mediaType_key" ON "WatchlistItem"("userId", "source", "externalId", "mediaType");

-- CreateIndex
CREATE INDEX "WatchlistTag_userId_idx" ON "WatchlistTag"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "WatchlistTag_userId_name_key" ON "WatchlistTag"("userId", "name");

-- CreateIndex
CREATE INDEX "ScheduledAlert_userId_status_createdAt_idx" ON "ScheduledAlert"("userId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "ScheduledAlert_userId_source_externalId_mediaType_idx" ON "ScheduledAlert"("userId", "source", "externalId", "mediaType");

-- CreateIndex
CREATE INDEX "ScheduledAlertOccurrence_status_notifyAt_idx" ON "ScheduledAlertOccurrence"("status", "notifyAt");

-- CreateIndex
CREATE INDEX "ScheduledAlertOccurrence_alertId_status_notifyAt_idx" ON "ScheduledAlertOccurrence"("alertId", "status", "notifyAt");

-- CreateIndex
CREATE UNIQUE INDEX "ScheduledAlertOccurrence_alertId_targetKey_notifyAt_key" ON "ScheduledAlertOccurrence"("alertId", "targetKey", "notifyAt");

-- CreateIndex
CREATE UNIQUE INDEX "PushSubscription_endpoint_key" ON "PushSubscription"("endpoint");

-- CreateIndex
CREATE INDEX "PushSubscription_userId_idx" ON "PushSubscription"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "NotificationPreference_subscriptionId_eventType_key" ON "NotificationPreference"("subscriptionId", "eventType");

-- CreateIndex
CREATE INDEX "NotificationHistory_eventType_dedupeKey_idx" ON "NotificationHistory"("eventType", "dedupeKey");

-- CreateIndex
CREATE INDEX "NotificationHistory_eventType_createdAt_idx" ON "NotificationHistory"("eventType", "createdAt");

-- CreateIndex
CREATE INDEX "NotificationHistory_userId_createdAt_idx" ON "NotificationHistory"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "NotificationHistory_createdAt_idx" ON "NotificationHistory"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "PollingState_serviceConnectionId_key" ON "PollingState"("serviceConnectionId");

-- CreateIndex
CREATE INDEX "DiskUsageSnapshot_diskId_capturedAt_idx" ON "DiskUsageSnapshot"("diskId", "capturedAt");

-- CreateIndex
CREATE INDEX "DiskUsageSnapshot_capturedAt_idx" ON "DiskUsageSnapshot"("capturedAt");

-- CreateIndex
CREATE UNIQUE INDEX "DiskUsageSnapshot_diskId_capturedDate_key" ON "DiskUsageSnapshot"("diskId", "capturedDate");

-- CreateIndex
CREATE UNIQUE INDEX "DashboardLayout_slug_key" ON "DashboardLayout"("slug");

-- CreateIndex
CREATE INDEX "DashboardLayout_userId_createdAt_idx" ON "DashboardLayout"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "DashboardLayout_createdAt_idx" ON "DashboardLayout"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "DashboardLayout_userId_name_key" ON "DashboardLayout"("userId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "UserAniListLink_userId_key" ON "UserAniListLink"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "UserSettings_userId_key" ON "UserSettings"("userId");

-- CreateIndex
CREATE INDEX "PendingRequest_userId_createdAt_idx" ON "PendingRequest"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "PendingRequest_createdAt_idx" ON "PendingRequest"("createdAt");

-- CreateIndex
CREATE INDEX "AniListSeriesMapping_sonarrInstanceId_idx" ON "AniListSeriesMapping"("sonarrInstanceId");

-- CreateIndex
CREATE UNIQUE INDEX "AniListSeriesMapping_sonarrInstanceId_sonarrSeriesId_key" ON "AniListSeriesMapping"("sonarrInstanceId", "sonarrSeriesId");

-- CreateIndex
CREATE INDEX "AniListSeriesMappingEntry_anilistMediaId_idx" ON "AniListSeriesMappingEntry"("anilistMediaId");

-- CreateIndex
CREATE UNIQUE INDEX "AniListSeriesMappingEntry_mappingId_anilistMediaId_key" ON "AniListSeriesMappingEntry"("mappingId", "anilistMediaId");

-- CreateIndex
CREATE INDEX "CleanupStrike_hash_idx" ON "CleanupStrike"("hash");

-- CreateIndex
CREATE UNIQUE INDEX "CleanupStrike_hash_strikeType_ruleId_key" ON "CleanupStrike"("hash", "strikeType", "ruleId");

-- CreateIndex
CREATE INDEX "CleanupHistory_createdAt_idx" ON "CleanupHistory"("createdAt");

-- CreateIndex
CREATE INDEX "CleanupHistory_hash_idx" ON "CleanupHistory"("hash");

-- CreateIndex
CREATE INDEX "CleanupHistory_action_idx" ON "CleanupHistory"("action");

-- CreateIndex
CREATE INDEX "FileOperationAudit_createdAt_idx" ON "FileOperationAudit"("createdAt");

-- CreateIndex
CREATE INDEX "FileOperationAudit_service_mediaId_idx" ON "FileOperationAudit"("service", "mediaId");

-- CreateIndex
CREATE INDEX "FileOperationAudit_userId_createdAt_idx" ON "FileOperationAudit"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "_WatchlistItemTags_B_index" ON "_WatchlistItemTags"("B");

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WatchlistItem" ADD CONSTRAINT "WatchlistItem_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WatchlistTag" ADD CONSTRAINT "WatchlistTag_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScheduledAlert" ADD CONSTRAINT "ScheduledAlert_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScheduledAlertOccurrence" ADD CONSTRAINT "ScheduledAlertOccurrence_alertId_fkey" FOREIGN KEY ("alertId") REFERENCES "ScheduledAlert"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PushSubscription" ADD CONSTRAINT "PushSubscription_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationPreference" ADD CONSTRAINT "NotificationPreference_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "PushSubscription"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationHistory" ADD CONSTRAINT "NotificationHistory_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PollingState" ADD CONSTRAINT "PollingState_serviceConnectionId_fkey" FOREIGN KEY ("serviceConnectionId") REFERENCES "ServiceConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AppSettings" ADD CONSTRAINT "AppSettings_defaultDesktopLayoutId_fkey" FOREIGN KEY ("defaultDesktopLayoutId") REFERENCES "DashboardLayout"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AppSettings" ADD CONSTRAINT "AppSettings_defaultMobileLayoutId_fkey" FOREIGN KEY ("defaultMobileLayoutId") REFERENCES "DashboardLayout"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DashboardLayout" ADD CONSTRAINT "DashboardLayout_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserAniListLink" ADD CONSTRAINT "UserAniListLink_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserSettings" ADD CONSTRAINT "UserSettings_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PendingRequest" ADD CONSTRAINT "PendingRequest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AniListSeriesMappingEntry" ADD CONSTRAINT "AniListSeriesMappingEntry_mappingId_fkey" FOREIGN KEY ("mappingId") REFERENCES "AniListSeriesMapping"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_WatchlistItemTags" ADD CONSTRAINT "_WatchlistItemTags_A_fkey" FOREIGN KEY ("A") REFERENCES "WatchlistItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_WatchlistItemTags" ADD CONSTRAINT "_WatchlistItemTags_B_fkey" FOREIGN KEY ("B") REFERENCES "WatchlistTag"("id") ON DELETE CASCADE ON UPDATE CASCADE;

