import { prisma } from '@/lib/db';
import { logger } from '@/lib/logger';
import type { QBittorrentTorrent, QueueItem } from '@/types';
import type { SonarrClient } from '@/lib/sonarr-client';
import type { RadarrClient } from '@/lib/radarr-client';
import {
  getQBittorrentClient,
  getSonarrClient,
  getRadarrClient,
} from '@/lib/service-helpers';
import { notifyEvent } from '@/lib/notification-service';
import {
  batchFetchTrackerDomains,
  buildCorrelationIndex,
  buildSeedingReason,
  confirmImportedViaHistory,
  formatError,
  isImportedQueueState,
  matchesIgnoredPatterns,
  matchesPrivacy,
  seedingHours,
  shortHash,
  torrentTags,
} from './helpers';
import {
  AutoRunMode,
  AUTO_RUN_MODES,
  DownloadCleanerConfigShape,
  DownloadDecision,
  DownloadEvaluationResult,
  PrivacyType,
  SeedingRuleShape,
  TriggeredBy,
} from './types';

const VALID_PRIVACY_TYPES: PrivacyType[] = ['public', 'private', 'both'];
import { processWithLimit } from './concurrency';

const LOG = 'download-cleaner';
const SYSTEM_RULE_NAME = 'Auto-remove imported (system)';

// Max parallel removals per cycle. Mirrors queue-cleaner's setting.
const CLEANUP_CONCURRENCY = 4;

export async function loadDownloadCleanerConfig(): Promise<DownloadCleanerConfigShape> {
  let row = await prisma.downloadCleanerConfig.findUnique({ where: { id: 'singleton' } });
  if (!row) {
    row = await prisma.downloadCleanerConfig.create({ data: { id: 'singleton' } });
  }
  return {
    enabled: row.enabled,
    intervalMinutes: row.intervalMinutes,
    ignoredDownloads: Array.isArray(row.ignoredDownloads) ? (row.ignoredDownloads as string[]) : [],
    autoRemoveImportedEnabled: row.autoRemoveImportedEnabled,
    autoRemoveImportedCategories: Array.isArray(row.autoRemoveImportedCategories)
      ? (row.autoRemoveImportedCategories as string[])
      : ['sonarr', 'radarr', 'tv-sonarr'],
    autoRemoveImportedDeleteFiles: row.autoRemoveImportedDeleteFiles,
    autoRemoveImportedPrivacyType: (VALID_PRIVACY_TYPES as string[]).includes(row.autoRemoveImportedPrivacyType)
      ? (row.autoRemoveImportedPrivacyType as PrivacyType)
      : 'public',
    autoRunMode: (AUTO_RUN_MODES as string[]).includes(row.autoRunMode)
      ? (row.autoRunMode as AutoRunMode)
      : 'disabled',
  };
}

export async function saveDownloadCleanerConfig(input: DownloadCleanerConfigShape): Promise<void> {
  await prisma.downloadCleanerConfig.upsert({
    where: { id: 'singleton' },
    create: {
      id: 'singleton',
      enabled: input.enabled,
      intervalMinutes: input.intervalMinutes,
      ignoredDownloads: input.ignoredDownloads,
      autoRemoveImportedEnabled: input.autoRemoveImportedEnabled,
      autoRemoveImportedCategories: input.autoRemoveImportedCategories,
      autoRemoveImportedDeleteFiles: input.autoRemoveImportedDeleteFiles,
      autoRemoveImportedPrivacyType: input.autoRemoveImportedPrivacyType,
      autoRunMode: input.autoRunMode,
    },
    update: {
      enabled: input.enabled,
      intervalMinutes: input.intervalMinutes,
      ignoredDownloads: input.ignoredDownloads,
      autoRemoveImportedEnabled: input.autoRemoveImportedEnabled,
      autoRemoveImportedCategories: input.autoRemoveImportedCategories,
      autoRemoveImportedDeleteFiles: input.autoRemoveImportedDeleteFiles,
      autoRemoveImportedPrivacyType: input.autoRemoveImportedPrivacyType,
      autoRunMode: input.autoRunMode,
    },
  });

  await syncSystemSeedingRule(input);
}

async function syncSystemSeedingRule(cfg: DownloadCleanerConfigShape): Promise<void> {
  const existing = await prisma.seedingRule.findFirst({ where: { isSystem: true } });
  if (cfg.autoRemoveImportedEnabled) {
    const data = {
      name: SYSTEM_RULE_NAME,
      enabled: true,
      priority: -1000,
      categories: cfg.autoRemoveImportedCategories,
      trackerPatterns: [] as string[],
      tagsAny: [] as string[],
      tagsAll: [] as string[],
      privacyType: cfg.autoRemoveImportedPrivacyType,
      maxRatio: 0,
      minSeedTimeHours: 0,
      maxSeedTimeHours: -1,
      deleteSourceFiles: cfg.autoRemoveImportedDeleteFiles,
      isSystem: true,
    };
    if (existing) {
      await prisma.seedingRule.update({ where: { id: existing.id }, data });
    } else {
      await prisma.seedingRule.create({ data });
    }
  } else if (existing) {
    await prisma.seedingRule.delete({ where: { id: existing.id } });
  }
}

export async function loadSeedingRules(): Promise<SeedingRuleShape[]> {
  const rows = await prisma.seedingRule.findMany({ orderBy: [{ priority: 'asc' }, { createdAt: 'asc' }] });
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    enabled: r.enabled,
    priority: r.priority,
    categories: Array.isArray(r.categories) ? (r.categories as string[]) : [],
    trackerPatterns: Array.isArray(r.trackerPatterns) ? (r.trackerPatterns as string[]) : [],
    tagsAny: Array.isArray(r.tagsAny) ? (r.tagsAny as string[]) : [],
    tagsAll: Array.isArray(r.tagsAll) ? (r.tagsAll as string[]) : [],
    privacyType: r.privacyType as 'public' | 'private' | 'both',
    maxRatio: r.maxRatio,
    minSeedTimeHours: r.minSeedTimeHours,
    maxSeedTimeHours: r.maxSeedTimeHours,
    deleteSourceFiles: r.deleteSourceFiles,
    isSystem: r.isSystem,
  }));
}

async function loadArrClients(): Promise<{ sonarr: SonarrClient | null; radarr: RadarrClient | null }> {
  let sonarr: SonarrClient | null = null;
  let radarr: RadarrClient | null = null;
  try {
    sonarr = await getSonarrClient();
  } catch {
    // not configured — fine
  }
  try {
    radarr = await getRadarrClient();
  } catch {
    // not configured — fine
  }
  return { sonarr, radarr };
}

async function loadArrQueues(arrs: {
  sonarr: SonarrClient | null;
  radarr: RadarrClient | null;
}): Promise<{ sonarrQueue: QueueItem[] | null; radarrQueue: QueueItem[] | null }> {
  let sonarrQueue: QueueItem[] | null = null;
  let radarrQueue: QueueItem[] | null = null;
  if (arrs.sonarr) {
    try {
      const r = await arrs.sonarr.getQueue(1, 1000);
      sonarrQueue = (r.records || []).map((i) => ({ ...i, source: 'sonarr' as const }));
    } catch (err) {
      logger.warn('Sonarr queue fetch failed (auto-remove imported)', { err: String(err) }, { scope: LOG });
    }
  }
  if (arrs.radarr) {
    try {
      const r = await arrs.radarr.getQueue(1, 1000);
      radarrQueue = (r.records || []).map((i) => ({ ...i, source: 'radarr' as const }));
    } catch (err) {
      logger.warn('Radarr queue fetch failed (auto-remove imported)', { err: String(err) }, { scope: LOG });
    }
  }
  return { sonarrQueue, radarrQueue };
}

/**
 * Decide whether a torrent matching the "Auto-remove imported" system rule
 * is safe to delete from qBittorrent. Returns a decision when arr confirms
 * the import is complete, or null when the torrent is still being processed,
 * has failed, or arr has no record of it.
 *
 * Resolution order:
 *  1. If the torrent is in any arr queue: only remove when trackedDownloadState
 *     is `imported`. Any other state (importing, importPending, importBlocked,
 *     importFailed, downloadFailed, …) means arr still owns the workflow and
 *     deleting the source files now would either lose data or cause a re-grab.
 *  2. If not in any arr queue: query each configured arr's history filtered by
 *     downloadId. A successful-import event (downloadFolderImported /
 *     episodeFileImported / movieFileImported) is the confirmation.
 *  3. Otherwise: skip. We never confirmed an import, so we cannot safely delete.
 */
async function evaluateAutoRemoveImported(
  t: QBittorrentTorrent,
  rule: SeedingRuleShape,
  queueIndex: ReturnType<typeof buildCorrelationIndex>,
  arrs: { sonarr: SonarrClient | null; radarr: RadarrClient | null },
): Promise<DownloadDecision | null> {
  const hashLc = t.hash.toLowerCase();
  const linked = queueIndex.byHash.get(hashLc);
  const seedH = seedingHours(t);

  if (linked) {
    const state = linked.queueItem.trackedDownloadState;
    if (isImportedQueueState(state)) {
      return {
        torrent: t,
        rule,
        reason: `Imported — ${linked.source} queue state '${state}'`,
        seedingHours: seedH,
      };
    }
    // arr is still working on it (importing, blocked, failed, …) — skip.
    return null;
  }

  // Not in arr queue → look for an imported event in history.
  const confirmation = await confirmImportedViaHistory(t.hash, arrs);
  if (confirmation) {
    return {
      torrent: t,
      rule,
      reason: `Imported — ${confirmation.source} history (${confirmation.eventType})`,
      seedingHours: seedH,
    };
  }
  return null;
}

export interface RunOptions {
  dryRun: boolean;
  triggeredBy: TriggeredBy;
}

export async function runDownloadCleanerCycle(opts: RunOptions): Promise<DownloadEvaluationResult> {
  const t0 = Date.now();
  const cfg = await loadDownloadCleanerConfig();
  if (!cfg.enabled && opts.triggeredBy === 'auto') {
    return { triggeredBy: opts.triggeredBy, dryRun: opts.dryRun, decisions: [], durationMs: 0, succeeded: 0, failed: 0 };
  }

  await syncSystemSeedingRule(cfg);

  let qbit;
  try {
    qbit = await getQBittorrentClient();
  } catch (err) {
    logger.warn('qBittorrent unavailable', { err: String(err) }, { scope: LOG });
    return { triggeredBy: opts.triggeredBy, dryRun: opts.dryRun, decisions: [], durationMs: 0, succeeded: 0, failed: 0 };
  }

  let torrents: QBittorrentTorrent[];
  try {
    torrents = await qbit.getTorrents();
  } catch (err) {
    logger.warn('qBittorrent listing failed', { err: String(err) }, { scope: LOG });
    return { triggeredBy: opts.triggeredBy, dryRun: opts.dryRun, decisions: [], durationMs: 0, succeeded: 0, failed: 0 };
  }

  const trackerDomains = await batchFetchTrackerDomains(qbit, torrents);
  const rules = (await loadSeedingRules()).filter((r) => r.enabled);

  const decisions: DownloadDecision[] = [];
  // System-rule candidates are evaluated asynchronously below (queue + history
  // confirmation), so collect them separately first.
  const systemPending: { torrent: QBittorrentTorrent; rule: SeedingRuleShape }[] = [];

  for (const t of torrents) {
    try {
      const hashLc = t.hash.toLowerCase();
      const domains = trackerDomains.get(hashLc) ?? [];
      if (matchesIgnoredPatterns(t, domains, cfg.ignoredDownloads)) continue;
      if (!isSeedingState(t)) continue;

      const tagsArr = torrentTags(t).map((s) => s.toLowerCase());
      const cat = (t.category || '').toLowerCase();
      const matched = rules.find((rule) => {
        // Empty categories list = apply to any category (cleanuparr-style).
        if (rule.categories.length > 0) {
          if (!rule.categories.map((c) => c.toLowerCase()).includes(cat)) return false;
        }
        if (rule.trackerPatterns.length > 0) {
          const matches = rule.trackerPatterns.some((p) =>
            domains.some((d) => d === p.toLowerCase() || d.endsWith(p.toLowerCase()))
          );
          if (!matches) return false;
        }
        if (rule.tagsAny.length > 0) {
          const ok = rule.tagsAny.some((tag) => tagsArr.includes(tag.toLowerCase()));
          if (!ok) return false;
        }
        if (rule.tagsAll.length > 0) {
          const ok = rule.tagsAll.every((tag) => tagsArr.includes(tag.toLowerCase()));
          if (!ok) return false;
        }
        if (!matchesPrivacy(t, rule.privacyType)) return false;
        return true;
      });

      if (!matched) continue;

      // The system "Auto-remove imported" rule does NOT use ratio/seedtime.
      // It defers to Sonarr/Radarr queue state + history. Defer to async pass.
      if (matched.isSystem) {
        systemPending.push({ torrent: t, rule: matched });
        continue;
      }

      const seedH = seedingHours(t);
      const ratioMet = matched.maxRatio >= 0 && t.ratio >= matched.maxRatio;
      const minTimeMet = matched.minSeedTimeHours <= 0 || seedH >= matched.minSeedTimeHours;
      const maxTimeMet = matched.maxSeedTimeHours >= 0 && seedH >= matched.maxSeedTimeHours;

      if ((ratioMet && minTimeMet) || maxTimeMet) {
        decisions.push({
          torrent: t,
          rule: matched,
          reason: buildSeedingReason(matched, t, seedH),
          seedingHours: seedH,
        });
      }
    } catch (err) {
      logger.warn('Download cleaner torrent eval failed', { hash: t.hash, err: String(err) }, { scope: LOG });
    }
  }

  // Async pass: confirm import for system-rule candidates against arr queue +
  // history. Skip torrents that arr is still working on (importing,
  // importPending, importBlocked, failed states) — only confirmed-imported
  // torrents survive into `decisions`.
  if (systemPending.length > 0) {
    const arrs = await loadArrClients();
    if (!arrs.sonarr && !arrs.radarr) {
      logger.warn(
        'Auto-remove imported enabled but no Sonarr/Radarr configured — cannot confirm imports, skipping system rule',
        { candidates: systemPending.length },
        { scope: LOG },
      );
    } else {
      const arrQueues = await loadArrQueues(arrs);
      const queueIndex = buildCorrelationIndex(arrQueues.sonarrQueue, arrQueues.radarrQueue);

      await processWithLimit(systemPending, CLEANUP_CONCURRENCY, async ({ torrent: t, rule }) => {
        try {
          const decision = await evaluateAutoRemoveImported(t, rule, queueIndex, arrs);
          if (decision) decisions.push(decision);
        } catch (err) {
          logger.warn(
            'Auto-remove imported confirmation failed',
            { hash: t.hash, err: String(err) },
            { scope: LOG },
          );
        }
      });
    }
  }

  let succeededCount = 0;
  let failedCount = 0;
  const successDecisions: { decision: DownloadDecision; outcome: Extract<DownloadRemovalOutcome, { kind: 'success' }> }[] = [];
  const failureDecisions: { decision: DownloadDecision; errorMessage: string }[] = [];

  if (opts.dryRun) {
    // Auto-scheduler dry-run: persist a preview row per decision so the user
    // can review what would have been removed via the History tab.
    if (opts.triggeredBy === 'auto' && decisions.length > 0) {
      for (const d of decisions) {
        const hashLc = d.torrent.hash.toLowerCase();
        await prisma.cleanupHistory.create({
          data: {
            cleaner: 'download',
            strikeType: null,
            ruleId: d.rule.id,
            ruleName: d.rule.name,
            hash: hashLc,
            shortHash: shortHash(hashLc),
            torrentName: d.torrent.name,
            reason: d.reason,
            action: 'dryRunPreview',
            filesDeleted: false,
            reSearched: false,
            linkedArrSource: null,
            linkedArrTitle: null,
            linkedArrItemId: null,
            torrentSize: BigInt(Math.max(0, Math.floor(d.torrent.size))),
            torrentProgress: d.torrent.progress,
            torrentRatio: d.torrent.ratio,
            triggeredBy: 'auto',
          },
        });
      }
    }
  } else {
    await processWithLimit(decisions, CLEANUP_CONCURRENCY, async (d) => {
      try {
        const outcome = await executeDownloadCleanerRemoval(d, opts.triggeredBy);
        if (outcome.kind === 'success') {
          succeededCount++;
          successDecisions.push({ decision: d, outcome });
        } else {
          failedCount++;
          failureDecisions.push({ decision: d, errorMessage: outcome.errorMessage });
        }
      } catch (err) {
        const errorMessage = formatError(err);
        logger.error('Download cleaner removal threw unexpectedly', { hash: d.torrent.hash, err: errorMessage }, { scope: LOG });
        failedCount++;
        failureDecisions.push({ decision: d, errorMessage });
      }
    });
  }

  // Batched notifications on real runs only.
  if (!opts.dryRun) {
    if (succeededCount === 1) {
      const { decision: d } = successDecisions[0];
      try {
        await notifyEvent({
          eventType: 'cleanupRemoved',
          title: 'Cleanup: seeding torrent removed',
          body: `${d.torrent.name} — ${d.reason}`,
          metadata: {
            hash: d.torrent.hash.toLowerCase(),
            cleaner: 'download',
            cleanupRuleName: d.rule.name,
            cleanupReason: d.reason,
            cleanupAction: 'removedFromClient',
          },
          url: '/cleanup',
        });
      } catch (err) {
        logger.warn('cleanupRemoved (download) notify failed', { err: String(err) }, { scope: LOG });
      }
    } else if (succeededCount > 1) {
      try {
        await notifyEvent({
          eventType: 'cleanupRemoved',
          title: 'Cleanup cycle: seeding torrents removed',
          body: `${succeededCount} torrent${succeededCount === 1 ? '' : 's'} removed by Download Cleaner${failedCount > 0 ? ` (${failedCount} failed)` : ''}.`,
          metadata: { cleaner: 'download', succeeded: succeededCount, failed: failedCount },
          url: '/cleanup',
        });
      } catch (err) {
        logger.warn('cleanupRemoved summary (download) notify failed', { err: String(err) }, { scope: LOG });
      }
    }

    if (failedCount > 0) {
      try {
        const firstError = failureDecisions[0]?.errorMessage ?? 'unknown error';
        await notifyEvent({
          eventType: 'cleanupFailed',
          title: 'Cleanup: action failed',
          body: failedCount === 1
            ? `${failureDecisions[0].decision.torrent.name} — ${firstError}`
            : `${failedCount} cleanup actions failed. See History → Failed.`,
          metadata: { cleaner: 'download', failed: failedCount, firstError },
          url: '/cleanup',
        });
      } catch (err) {
        logger.warn('cleanupFailed (download) notify failed', { err: String(err) }, { scope: LOG });
      }
    }
  }

  const durationMs = Date.now() - t0;
  logger.info('Download cleaner cycle done', {
    triggeredBy: opts.triggeredBy,
    dryRun: opts.dryRun,
    durationMs,
    decisions: decisions.length,
    succeeded: succeededCount,
    failed: failedCount,
  }, { scope: LOG });

  return {
    triggeredBy: opts.triggeredBy,
    dryRun: opts.dryRun,
    decisions,
    durationMs,
    succeeded: succeededCount,
    failed: failedCount,
  };
}

function isSeedingState(t: QBittorrentTorrent): boolean {
  if (t.progress < 1) return false;
  // qBittorrent 5.x renamed pausedUP → stoppedUP; both can appear depending on
  // the user's qBit version. progress<1 above already excludes mid-download
  // stops.
  return (
    t.state === 'uploading' ||
    t.state === 'stalledUP' ||
    t.state === 'queuedUP' ||
    t.state === 'forcedUP' ||
    t.state === 'pausedUP' ||
    t.state === 'stoppedUP' ||
    t.state === 'checkingUP'
  );
}

export type DownloadRemovalOutcome =
  | { kind: 'success'; filesDeleted: boolean }
  | { kind: 'failure'; errorMessage: string };

async function executeDownloadCleanerRemoval(d: DownloadDecision, triggeredBy: TriggeredBy): Promise<DownloadRemovalOutcome> {
  const hashLc = d.torrent.hash.toLowerCase();
  const intendedFilesDeleted = d.rule.deleteSourceFiles;

  // Phase 1: attempt qBit delete. If it fails, audit the failure and keep strikes.
  try {
    const qbit = await getQBittorrentClient();
    await qbit.deleteTorrent(d.torrent.hash, intendedFilesDeleted);
  } catch (err) {
    const errorMessage = formatError(err);
    logger.error('qBit delete (download cleaner) failed — keeping strikes for retry', { err: errorMessage, hash: hashLc }, { scope: LOG });

    await prisma.cleanupHistory.create({
      data: {
        cleaner: 'download',
        strikeType: null,
        ruleId: d.rule.id,
        ruleName: d.rule.name,
        hash: hashLc,
        shortHash: shortHash(hashLc),
        torrentName: d.torrent.name,
        reason: d.reason,
        action: 'failed',
        filesDeleted: false,
        reSearched: false,
        linkedArrSource: null,
        linkedArrTitle: null,
        linkedArrItemId: null,
        torrentSize: BigInt(Math.max(0, Math.floor(d.torrent.size))),
        torrentProgress: d.torrent.progress,
        torrentRatio: d.torrent.ratio,
        triggeredBy: triggeredBy === 'dryRun' ? 'manual' : triggeredBy,
        errorMessage,
      },
    });
    return { kind: 'failure', errorMessage };
  }

  // Phase 2: delete succeeded — clear strikes, then audit.
  await prisma.cleanupStrike.deleteMany({ where: { hash: hashLc } });

  await prisma.cleanupHistory.create({
    data: {
      cleaner: 'download',
      strikeType: null,
      ruleId: d.rule.id,
      ruleName: d.rule.name,
      hash: hashLc,
      shortHash: shortHash(hashLc),
      torrentName: d.torrent.name,
      reason: d.reason,
      action: 'removedFromClient',
      filesDeleted: intendedFilesDeleted,
      reSearched: false,
      linkedArrSource: null,
      linkedArrTitle: null,
      linkedArrItemId: null,
      torrentSize: BigInt(Math.max(0, Math.floor(d.torrent.size))),
      torrentProgress: d.torrent.progress,
      torrentRatio: d.torrent.ratio,
      triggeredBy: triggeredBy === 'dryRun' ? 'manual' : triggeredBy,
    },
  });

  return { kind: 'success', filesDeleted: intendedFilesDeleted };
}
