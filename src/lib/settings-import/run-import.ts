// Applies a validated settings import in one transaction. The route handles
// the request (size, complexity and authorization checks) and the runtime
// follow-ups once this returns.

import type { Prisma, ScheduledAlert, ServiceType } from '@prisma/client';
import { prisma } from '@/lib/db';
import { logger } from '@/lib/logger';
import { validateDiscoverLayout, reconcileDiscoverLayout } from '@/lib/discover-layout-config';
import type { ImportFollowUpPlan } from './follow-ups';
import type { ImportRequestBody } from './shared';
import { applyAppSettingsInTxn, type AppSettingsTxnResult } from './app-settings';
import { applyServiceConnectionInTxn } from './services';
import { applyNotificationDeviceInTxn } from './notifications';
import { applyCleanupInTxn } from './cleanup';
import { applyDashboardLayoutsInTxn } from './layouts';
import { applyPreparedScheduledAlerts, prepareScheduledAlerts } from './alerts';
import { applyPreparedWatchlist, prepareWatchlist } from './watchlist';
import { applyPreparedAnimeMappings, prepareAnimeMappings } from './anime-mappings';
import { applyUsersInTxn, prepareAccountContent } from './users';

// A near-limit import (the benchmark in settings-import.integration.test.ts)
// commits in a few seconds; the timeout leaves room for slower storage while
// still bounding how long one import can hold the database. maxWait bounds the
// wait for a connection from the pool.
export const IMPORT_TRANSACTION_TIMEOUT_MS = 60_000;
const IMPORT_TRANSACTION_MAX_WAIT_MS = 10_000;
const LOG = 'settings-import';

/** Entries per section, for the log: numbers only, never values. */
function sectionCounts(body: ImportRequestBody): Record<string, number> {
  const length = (value: unknown) => (Array.isArray(value) ? value.length : 0);
  const accounts = Array.isArray(body.users?.accounts) ? body.users.accounts : [];
  return {
    serviceConnections: length(body.serviceConnections),
    notificationRules: length(body.notificationDevice?.rules),
    cleanupRules: length(body.cleanup?.stallRules) + length(body.cleanup?.slowRules) + length(body.cleanup?.seedingRules),
    dashboardLayouts: length(body.dashboardLayouts?.layouts),
    watchlistItems: length(body.watchlist?.items) + accounts.reduce((n, a) => n + length(a?.watchlist?.items), 0),
    scheduledAlerts: length(body.scheduledAlerts?.alerts) + accounts.reduce((n, a) => n + length(a?.scheduledAlerts), 0),
    animeMappings: length(body.animeMappings?.mappings),
    users: accounts.length,
  };
}

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

  // Validate and normalize the large sections before the transaction opens,
  // so it spends its time, and holds its locks, only on writes.
  const alerts = body.scheduledAlerts && typeof body.scheduledAlerts === 'object'
    ? prepareScheduledAlerts(
        Array.isArray(body.scheduledAlerts.alerts) ? body.scheduledAlerts.alerts : [],
        skipped,
        'Scheduled alerts',
      )
    : null;
  const watchlist = body.watchlist && typeof body.watchlist === 'object'
    ? prepareWatchlist(body.watchlist, skipped)
    : null;
  const mappings = body.animeMappings && typeof body.animeMappings === 'object'
    ? prepareAnimeMappings(body.animeMappings, skipped)
    : null;
  const accountContent = body.users && typeof body.users === 'object'
    ? prepareAccountContent(body.users, skipped)
    : new Map();

  const counts = sectionCounts(body);
  const started = performance.now();
  let appSettingsTxnResult: AppSettingsTxnResult | null;
  try {
    appSettingsTxnResult = await prisma.$transaction(async (tx) => {
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

      if (alerts) {
        appliedScheduledAlerts = await applyPreparedScheduledAlerts(tx, alerts, importerId, createdReleaseRelative);
      }

      if (watchlist) {
        const r = await applyPreparedWatchlist(tx, watchlist, importerId);
        appliedWatchlistItems = r.items;
        appliedWatchlistTags = r.tags;
      }

      if (mappings) {
        appliedAnimeMappings = await applyPreparedAnimeMappings(tx, mappings, skipped);
      }

      if (body.users && typeof body.users === 'object') {
        appliedUsers = await applyUsersInTxn(tx, body.users, skipped, importerId, createdReleaseRelative, accountContent);
      }

      return innerAppSettings;
    }, { timeout: IMPORT_TRANSACTION_TIMEOUT_MS, maxWait: IMPORT_TRANSACTION_MAX_WAIT_MS });
  } catch (error) {
    logger.warn('Settings import rolled back', { durationMs: Math.round(performance.now() - started), ...counts }, { scope: LOG });
    throw error;
  }
  logger.info('Settings import committed', { durationMs: Math.round(performance.now() - started), ...counts }, { scope: LOG });

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
