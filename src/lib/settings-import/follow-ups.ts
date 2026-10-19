import { ServiceType, type AppSettings } from '@prisma/client';
import { prisma } from '@/lib/db';
import { pollingService } from '@/lib/polling-service';
import { setCachedAnilistTtlSettings, setCachedCacheImagesEnabled } from '@/lib/cache/state';
import { purgeOlderCacheGenerations } from '@/lib/cache/admin';
import { invalidateLayoutCache } from '@/lib/cache/dashboard-layout-cache';
import { setAppTimeZone } from '@/lib/timezone';
import { configureLogger } from '@/lib/logger';
import { configureApiLogging } from '@/lib/api-logger';
import { getOrCreateAppSettings } from '@/lib/app-settings';
import { ensureDefaultForType, clearConnectionMemo, isArrType } from '@/lib/arr-instances';
import { invalidateReferenceLabels } from '@/lib/cache/reference-labels';
import { restartDownloadCleaner, restartQueueCleaner } from '@/lib/cleanup/scheduler';
import { pruneStrikesForMissingRules } from '@/lib/cleanup/strikes';
import { createResolverContext, resolveAlertOccurrencesResult } from '@/lib/scheduled-alerts/resolver';
import { upsertOccurrencesForAlert } from '@/lib/scheduled-alerts/delivery';
import { invalidateRecommendations } from '@/lib/recommendations/engine';
import type { ImportFollowUp, ImportWarning } from './follow-up-tasks';

// ─────────────────────────────────────────────────────────────────────────────
// Runtime work that follows a committed settings import. The data is saved by
// then; these steps only bring this server in line with it, so a failure does
// not fail the import. It comes back as a warning, and every step reads what it
// needs from the database, so it can be re-run later on its own
// (POST /api/settings/import/follow-up) without importing the file again.
// ─────────────────────────────────────────────────────────────────────────────

export { IMPORT_FOLLOW_UPS, isImportFollowUp } from './follow-up-tasks';
export type { ImportFollowUp, ImportWarning } from './follow-up-tasks';

// Fixed text only: a warning never carries an upstream error, a credential or
// a header. The error itself goes to the server log.
const MESSAGES: Record<ImportFollowUp, string> = {
  appSettings: 'The imported app settings are saved, but this server has not loaded them yet.',
  imageCachePurge: 'Image caching is off, but images cached before the import were not removed.',
  pollingRestart: 'Polling did not restart with the imported interval, so notifications may be late or missing.',
  cleanupStrikePrune: 'Strikes for cleanup rules the import removed were not cleared.',
  cleanupSchedulers: 'The cleanup schedulers did not restart, so they still follow the cleanup settings from before the import.',
  alertOccurrences: 'Some imported release alerts have no upcoming notifications yet.',
  dashboardLayoutCache: 'Dashboards may keep showing the layouts from before the import for a while.',
  defaultInstances: 'A default instance could not be set for every service.',
};

export interface ImportFollowUpPlan {
  /** Load the saved app settings into this server's caches, logger and time zone. */
  appSettings?: boolean;
  /** Image caching is off: remove what was cached while it was on. */
  imageCachePurge?: boolean;
  /** Restart polling at the saved interval. */
  pollingRestart?: boolean;
  cleanupStrikePrune?: boolean;
  cleanupSchedulers?: boolean;
  /** Release-relative alerts whose occurrences to resolve. */
  alertIds?: string[];
  /** Restrict alertIds to this user's alerts (a member retrying their own). */
  alertOwnerId?: string;
  dashboardLayoutCache?: boolean;
  /** Service types that must end up with exactly one default instance. */
  serviceTypes?: ServiceType[];
  /** Users whose composed recommendation rails to drop. */
  recommendationUserIds?: string[];
}

export const ALL_SERVICE_TYPES = Object.values(ServiceType);

function applyAppSettingsToRuntime(settings: AppSettings): void {
  setCachedCacheImagesEnabled(settings.cacheImagesEnabled);
  setCachedAnilistTtlSettings({
    sectionsTtlMin: settings.anilistSectionsTtlMin,
    browseTtlMin: settings.anilistBrowseTtlMin,
    detailTtlMin: settings.anilistDetailTtlMin,
    airingTtlMin: settings.anilistAiringTtlMin,
  });
  setAppTimeZone(settings.timeZone);
  configureLogger({
    timeZone: settings.timeZone,
    level: settings.logLevel as 'debug' | 'info' | 'warn' | 'error',
    maxFileMb: settings.logMaxFileMb,
    retentionDays: settings.logRetentionDays,
    enabled: settings.logEnabled,
  });
  configureApiLogging({
    enabled: settings.logEnabled,
    failedRequestBodies: settings.logFailedRequestBodies,
    failedResponseBodies: settings.logFailedResponseBodies,
  });
}

/** Run the planned steps in order; each failure becomes one warning and the rest still run. */
export async function runImportFollowUps(plan: ImportFollowUpPlan): Promise<ImportWarning[]> {
  const warnings: ImportWarning[] = [];
  const step = async (task: ImportFollowUp, run: () => Promise<void>) => {
    try {
      await run();
    } catch (error) {
      console.warn(`Settings import follow-up failed: ${task}`, error);
      warnings.push({ task, message: MESSAGES[task] });
    }
  };

  // Each app-settings step reads the saved row right before it acts, so a
  // retry never applies a value someone has changed since.
  if (plan.appSettings) {
    await step('appSettings', async () => applyAppSettingsToRuntime(await getOrCreateAppSettings()));
  }
  if (plan.imageCachePurge) {
    await step('imageCachePurge', async () => {
      // Caching may have been switched back on since; then the cache is live again.
      if ((await getOrCreateAppSettings()).cacheImagesEnabled === false) await purgeOlderCacheGenerations();
    });
  }
  if (plan.pollingRestart) {
    await step('pollingRestart', async () => {
      pollingService.restart((await getOrCreateAppSettings()).pollingIntervalSecs * 1000);
    });
  }

  if (plan.cleanupStrikePrune) await step('cleanupStrikePrune', pruneStrikesForMissingRules);
  if (plan.cleanupSchedulers) {
    await step('cleanupSchedulers', async () => {
      await Promise.all([restartQueueCleaner(), restartDownloadCleaner()]);
    });
  }

  if (plan.alertIds?.length) {
    const unresolved: string[] = [];
    try {
      const alerts = await prisma.scheduledAlert.findMany({
        where: {
          id: { in: plan.alertIds },
          scheduleMode: 'release_relative',
          status: 'active',
          ...(plan.alertOwnerId ? { userId: plan.alertOwnerId } : {}),
        },
      });
      if (alerts.length > 0) {
        const ctx = createResolverContext({
          maxOffsetMinutes: Math.max(...alerts.map((alert) => alert.offsetMinutes)),
        });
        for (const alert of alerts) {
          try {
            const { candidates, resolved } = await resolveAlertOccurrencesResult(alert, ctx);
            await upsertOccurrencesForAlert(alert, candidates, { resolved });
            // Unresolved: a source it needs did not answer and nothing was found.
            if (!resolved) unresolved.push(alert.id);
          } catch (error) {
            console.warn('Settings import follow-up failed: alertOccurrences', alert.id, error);
            unresolved.push(alert.id);
          }
        }
      }
    } catch (error) {
      console.warn('Settings import follow-up failed: alertOccurrences', error);
      unresolved.splice(0, unresolved.length, ...plan.alertIds);
    }
    if (unresolved.length > 0) {
      warnings.push({ task: 'alertOccurrences', message: MESSAGES.alertOccurrences, alertIds: unresolved });
    }
  }

  if (plan.dashboardLayoutCache) {
    await step('dashboardLayoutCache', async () => {
      if (!(await invalidateLayoutCache())) throw new Error('dashboard layout cache was not cleared');
    });
  }

  if (plan.serviceTypes?.length) {
    await step('defaultInstances', async () => {
      const failures: unknown[] = [];
      for (const type of new Set(plan.serviceTypes)) {
        try {
          await ensureDefaultForType(type);
        } catch (error) {
          failures.push(error);
        }
      }
      clearConnectionMemo();
      // Imported instances change the libraries and their profile and tag names.
      for (const type of new Set(plan.serviceTypes)) {
        if (!isArrType(type)) continue;
        const connections = await prisma.serviceConnection.findMany({ where: { type }, select: { id: true } });
        for (const { id } of connections) await invalidateReferenceLabels(type.toLowerCase(), id);
      }
      if (failures.length > 0) throw failures[0];
    });
  }

  // No warning: invalidateRecommendations never throws (without Redis the
  // rails are recomposed when their 15-minute snapshot expires).
  const users = plan.recommendationUserIds ?? [];
  for (let i = 0; i < users.length; i += 100) {
    await Promise.all(users.slice(i, i + 100).map((id) => invalidateRecommendations(id)));
  }

  return warnings;
}
