// Applies a validated settings import in one transaction. The route handles
// the request (size, complexity and authorization checks) and the runtime
// follow-ups once this returns.

import type { Prisma, ScheduledAlert, ServiceType } from '@prisma/client';
import { prisma } from '@/lib/db';
import { validateDiscoverLayout, reconcileDiscoverLayout } from '@/lib/discover-layout-config';
import type { ImportFollowUpPlan } from './follow-ups';
import type { ImportRequestBody } from './shared';
import { applyAppSettingsInTxn, type AppSettingsTxnResult } from './app-settings';
import { applyServiceConnectionInTxn } from './services';
import { applyNotificationDeviceInTxn } from './notifications';
import { applyCleanupInTxn } from './cleanup';
import { applyDashboardLayoutsInTxn } from './layouts';
import { applyScheduledAlertsInTxn } from './alerts';
import { applyWatchlistInTxn } from './watchlist';
import { applyAnimeMappingsInTxn } from './anime-mappings';
import { applyUsersInTxn } from './users';

export interface ImportApplied {
  appSettings: boolean;
  services: ServiceType[];
  notificationRules: number;
  cleanup: boolean;
  dashboardLayouts: number;
  watchlistItems: number;
  watchlistTags: number;
  scheduledAlerts: number;
  animeMappings: number;
  users: number;
}

export interface ImportOutcome {
  applied: ImportApplied;
  skipped: string[];
  discoverLayoutApplied: boolean;
  followUps: ImportFollowUpPlan;
}

/** Throws when the transaction fails; nothing is then saved. */
export async function applySettingsImport(body: ImportRequestBody, importerId: string): Promise<ImportOutcome> {
  const skipped: string[] = [];
  const appliedServices: ServiceType[] = [];
  let appliedAppSettings = false;
  let appliedNotificationRules = 0;
  let appliedCleanup = false;
  let discoverLayoutApplied = false;
  let appliedDashboardLayouts = 0;
  let appliedWatchlistItems = 0;
  let appliedWatchlistTags = 0;
  let appliedScheduledAlerts = 0;
  let appliedAnimeMappings = 0;
  let appliedUsers = 0;
  // release_relative alerts created during the import; occurrences are resolved
  // after commit (resolution hits Sonarr/Radarr/AniList — too slow for the txn).
  const createdReleaseRelative: ScheduledAlert[] = [];

  const appSettingsTxnResult = await prisma.$transaction(async (tx) => {
    let innerAppSettings: AppSettingsTxnResult | null = null;
    if (body.appSettings && typeof body.appSettings === 'object') {
      innerAppSettings = await applyAppSettingsInTxn(tx, body.appSettings);
      appliedAppSettings = true;
    }

    if (Array.isArray(body.serviceConnections)) {
      for (const conn of body.serviceConnections) {
        const applied = await applyServiceConnectionInTxn(tx, conn, skipped);
        if (applied) appliedServices.push(applied);
      }
    }

    if (body.notificationDevice && typeof body.notificationDevice === 'object') {
      appliedNotificationRules = await applyNotificationDeviceInTxn(
        tx,
        body.notificationDevice,
        body.currentDeviceEndpoint,
        skipped
      );
    }

    if (body.cleanup && typeof body.cleanup === 'object') {
      await applyCleanupInTxn(tx, body.cleanup, skipped);
      appliedCleanup = true;
    }

    // Import discover layout
    if (body.discoverLayout && typeof body.discoverLayout === 'object') {
      const validated = validateDiscoverLayout(body.discoverLayout);
      if (validated) {
        const reconciled = reconcileDiscoverLayout(validated);
        await tx.appSettings.upsert({
          where: { id: 'singleton' },
          update: { discoverLayout: reconciled as unknown as Prisma.InputJsonValue },
          create: { id: 'singleton', discoverLayout: reconciled as unknown as Prisma.InputJsonValue },
        });
        discoverLayoutApplied = true;
      } else {
        skipped.push('Discover layout: invalid format, skipped');
      }
    }

    if (body.dashboardLayouts && typeof body.dashboardLayouts === 'object') {
      appliedDashboardLayouts = await applyDashboardLayoutsInTxn(tx, body.dashboardLayouts, skipped);
    }

    if (body.scheduledAlerts && typeof body.scheduledAlerts === 'object') {
      const alerts = Array.isArray(body.scheduledAlerts.alerts) ? body.scheduledAlerts.alerts : [];
      appliedScheduledAlerts = await applyScheduledAlertsInTxn(
        tx,
        alerts,
        skipped,
        importerId,
        'Scheduled alerts',
        createdReleaseRelative
      );
    }

    if (body.watchlist && typeof body.watchlist === 'object') {
      const r = await applyWatchlistInTxn(tx, body.watchlist, skipped, importerId);
      appliedWatchlistItems = r.items;
      appliedWatchlistTags = r.tags;
    }

    if (body.animeMappings && typeof body.animeMappings === 'object') {
      appliedAnimeMappings = await applyAnimeMappingsInTxn(tx, body.animeMappings, skipped);
    }

    if (body.users && typeof body.users === 'object') {
      appliedUsers = await applyUsersInTxn(tx, body.users, skipped, importerId, createdReleaseRelative);
    }

    return innerAppSettings;
  });

  // What the running server must do to match the committed data
  // (src/lib/settings-import/follow-ups.ts).
  const followUps: ImportFollowUpPlan = {
    appSettings: appSettingsTxnResult !== null,
    imageCachePurge: Boolean(
      appSettingsTxnResult?.wasCachingEnabled && appSettingsTxnResult.settings.cacheImagesEnabled === false,
    ),
    pollingRestart: appSettingsTxnResult?.pollingIntervalSecsChanged != null,
    // Restart the cleaner schedulers so the new intervals/modes take effect,
    // and drop strikes whose rule no longer exists.
    cleanupStrikePrune: appliedCleanup,
    cleanupSchedulers: appliedCleanup,
    // Materialize occurrences for imported release_relative alerts, mirroring
    // POST /api/scheduled-alerts. Without this they'd stay inert until the
    // background refresh reaches them (it processes oldest-updated first, so
    // fresh imports would be last in line).
    alertIds: createdReleaseRelative.map((alert) => alert.id),
    dashboardLayoutCache: appliedDashboardLayouts > 0,
    // Exactly one default per imported type (export isDefault flags were
    // applied on create; this promotes the oldest if none/many ended up flagged).
    serviceTypes: appliedServices,
  };


  return {
    applied: {
      appSettings: appliedAppSettings,
      services: appliedServices,
      notificationRules: appliedNotificationRules,
      cleanup: appliedCleanup,
      dashboardLayouts: appliedDashboardLayouts,
      watchlistItems: appliedWatchlistItems,
      watchlistTags: appliedWatchlistTags,
      scheduledAlerts: appliedScheduledAlerts,
      animeMappings: appliedAnimeMappings,
      users: appliedUsers,
    },
    skipped,
    discoverLayoutApplied,
    followUps,
  };
}
