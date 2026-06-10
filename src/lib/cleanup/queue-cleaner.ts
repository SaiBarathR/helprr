import { prisma } from '@/lib/db';
import { logger } from '@/lib/logger';
import type { QBittorrentTorrent, QueueItem } from '@/types';
import { getQBittorrentClient, getSonarrClient, getRadarrClient, getSonarrClients, getRadarrClients } from '@/lib/service-helpers';
import { notifyEvent } from '@/lib/notification-service';
import { classifyQueueIssue } from '@/lib/queue-state';
import {
  activeHours,
  batchFetchTrackerDomains,
  buildCorrelationIndex,
  buildFailedImportReason,
  buildMetadataReason,
  buildSlowReason,
  buildStallReason,
  collectStatusMessages,
  formatError,
  inCompletionRange,
  matchesIgnoredPatterns,
  matchesPatterns,
  matchesPrivacy,
  progressedEnough,
  shortHash,
} from './helpers';
import {
  loadActiveStrikes,
  pruneOrphanStrikes,
  pruneStrikesForMissingRules,
  strikeKey,
  StrikeJournal,
} from './strikes';
import { processWithLimit } from './concurrency';
import {
  AutoRunMode,
  AUTO_RUN_MODES,
  DEFAULT_FAILED_IMPORT,
  FailedImportConfig,
  LinkedArr,
  QueueCleanerConfigShape,
  QueueDecision,
  QueueEvaluationResult,
  SlowRuleShape,
  StallRuleShape,
  TriggeredBy,
  PendingStrike,
} from './types';

const LOG = 'queue-cleaner';

// Max parallel removals per cycle. Each removal makes 1–3 arr/qBit calls;
// keeping this low avoids surprise backpressure on self-hosted services.
const CLEANUP_CONCURRENCY = 4;

export async function loadQueueCleanerConfig(): Promise<QueueCleanerConfigShape> {
  let row = await prisma.queueCleanerConfig.findUnique({ where: { id: 'singleton' } });
  if (!row) {
    row = await prisma.queueCleanerConfig.create({
      data: {
        id: 'singleton',
        failedImport: DEFAULT_FAILED_IMPORT as unknown as object,
      },
    });
  }
  const failedImportRaw = (row.failedImport as Record<string, unknown> | null) ?? {};
  const failedImport: FailedImportConfig = {
    ...DEFAULT_FAILED_IMPORT,
    ...failedImportRaw,
  } as FailedImportConfig;
  return {
    enabled: row.enabled,
    intervalMinutes: row.intervalMinutes,
    ignoredDownloads: Array.isArray(row.ignoredDownloads) ? (row.ignoredDownloads as string[]) : [],
    processNoContentId: row.processNoContentId,
    downloadingMetadataMaxStrikes: row.downloadingMetadataMaxStrikes,
    failedImport,
    reSearchAfterRemoval: row.reSearchAfterRemoval,
    autoRunMode: (AUTO_RUN_MODES as string[]).includes(row.autoRunMode)
      ? (row.autoRunMode as AutoRunMode)
      : 'disabled',
  };
}

export async function saveQueueCleanerConfig(input: QueueCleanerConfigShape): Promise<void> {
  await prisma.queueCleanerConfig.upsert({
    where: { id: 'singleton' },
    create: {
      id: 'singleton',
      enabled: input.enabled,
      intervalMinutes: input.intervalMinutes,
      ignoredDownloads: input.ignoredDownloads,
      processNoContentId: input.processNoContentId,
      downloadingMetadataMaxStrikes: input.downloadingMetadataMaxStrikes,
      failedImport: input.failedImport as unknown as object,
      reSearchAfterRemoval: input.reSearchAfterRemoval,
      autoRunMode: input.autoRunMode,
    },
    update: {
      enabled: input.enabled,
      intervalMinutes: input.intervalMinutes,
      ignoredDownloads: input.ignoredDownloads,
      processNoContentId: input.processNoContentId,
      downloadingMetadataMaxStrikes: input.downloadingMetadataMaxStrikes,
      failedImport: input.failedImport as unknown as object,
      reSearchAfterRemoval: input.reSearchAfterRemoval,
      autoRunMode: input.autoRunMode,
    },
  });
}

export async function loadStallRules(): Promise<StallRuleShape[]> {
  const rows = await prisma.stallRule.findMany({ orderBy: [{ priority: 'asc' }, { createdAt: 'asc' }] });
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    enabled: r.enabled,
    priority: r.priority,
    maxStrikes: r.maxStrikes,
    privacyType: r.privacyType as 'public' | 'private' | 'both',
    minCompletionPercentage: r.minCompletionPercentage,
    maxCompletionPercentage: r.maxCompletionPercentage,
    resetStrikesOnProgress: r.resetStrikesOnProgress,
    minimumProgressBytes: r.minimumProgressBytes != null ? Number(r.minimumProgressBytes) : null,
    changeCategory: r.changeCategory,
    deletePrivate: r.deletePrivate,
    reSearchOverride: r.reSearchOverride,
  }));
}

export async function loadSlowRules(): Promise<SlowRuleShape[]> {
  const rows = await prisma.slowRule.findMany({ orderBy: [{ priority: 'asc' }, { createdAt: 'asc' }] });
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    enabled: r.enabled,
    priority: r.priority,
    maxStrikes: r.maxStrikes,
    privacyType: r.privacyType as 'public' | 'private' | 'both',
    minCompletionPercentage: r.minCompletionPercentage,
    maxCompletionPercentage: r.maxCompletionPercentage,
    minSpeedKbps: r.minSpeedKbps,
    maxTimeHours: r.maxTimeHours,
    ignoreAboveSizeBytes: r.ignoreAboveSizeBytes != null ? Number(r.ignoreAboveSizeBytes) : null,
    resetStrikesOnProgress: r.resetStrikesOnProgress,
    changeCategory: r.changeCategory,
    deletePrivate: r.deletePrivate,
    reSearchOverride: r.reSearchOverride,
  }));
}

async function loadArrQueues(): Promise<{
  sonarr: Array<{ instanceId: string; instanceLabel: string; queue: QueueItem[] }>;
  radarr: Array<{ instanceId: string; instanceLabel: string; queue: QueueItem[] }>;
}> {
  const sonarr: Array<{ instanceId: string; instanceLabel: string; queue: QueueItem[] }> = [];
  const radarr: Array<{ instanceId: string; instanceLabel: string; queue: QueueItem[] }> = [];
  // Hard cap: queues larger than 1000 will be truncated. Pagination not currently wired.
  for (const { connection, client } of await getSonarrClients()) {
    try {
      const r = await client.getQueue(1, 1000);
      sonarr.push({
        instanceId: connection.id,
        instanceLabel: connection.label,
        queue: (r.records || []).map((i) => ({ ...i, source: 'sonarr' as const })),
      });
    } catch (err) {
      if (!isMissingConfigError(err)) logger.warn('Sonarr queue fetch failed', { instanceId: connection.id, err: String(err) }, { scope: LOG });
    }
  }
  for (const { connection, client } of await getRadarrClients()) {
    try {
      const r = await client.getQueue(1, 1000);
      radarr.push({
        instanceId: connection.id,
        instanceLabel: connection.label,
        queue: (r.records || []).map((i) => ({ ...i, source: 'radarr' as const })),
      });
    } catch (err) {
      if (!isMissingConfigError(err)) logger.warn('Radarr queue fetch failed', { instanceId: connection.id, err: String(err) }, { scope: LOG });
    }
  }
  return { sonarr, radarr };
}

function isMissingConfigError(err: unknown): boolean {
  return err instanceof Error && err.message.includes('is not configured');
}

export interface RunOptions {
  dryRun: boolean;
  triggeredBy: TriggeredBy;
}

export async function runQueueCleanerCycle(opts: RunOptions): Promise<QueueEvaluationResult> {
  const t0 = Date.now();
  const cfg = await loadQueueCleanerConfig();
  if (!cfg.enabled && opts.triggeredBy === 'auto') {
    return emptyResult(opts);
  }

  let qbit;
  try {
    qbit = await getQBittorrentClient();
  } catch (err) {
    logger.warn('qBittorrent unavailable', { err: String(err) }, { scope: LOG });
    return emptyResult(opts);
  }

  let torrents: QBittorrentTorrent[];
  try {
    torrents = await qbit.getTorrents();
  } catch (err) {
    logger.warn('qBittorrent listing failed', { err: String(err) }, { scope: LOG });
    return emptyResult(opts);
  }

  const [{ sonarr: sonarrInstances, radarr: radarrInstances }, stallRules, slowRules, prevStrikes] = await Promise.all([
    loadArrQueues(),
    loadStallRules(),
    loadSlowRules(),
    loadActiveStrikes(),
  ]);

  const trackerDomains = await batchFetchTrackerDomains(qbit, torrents);
  const correlation = buildCorrelationIndex(sonarrInstances, radarrInstances);
  const inClientHashes = new Set(torrents.map((t) => t.hash.toLowerCase()));

  const journal = new StrikeJournal();
  const decisions: QueueDecision[] = [];
  const pendingStrikes: PendingStrike[] = [];
  let skippedFailedImport = 0;

  for (const t of torrents) {
    try {
      const hashLc = t.hash.toLowerCase();
      const domains = trackerDomains.get(hashLc) ?? [];

      if (matchesIgnoredPatterns(t, domains, cfg.ignoredDownloads)) continue;

      const linked = (correlation.byHash.get(hashLc) ?? [])[0] ?? null;

      // 1) Downloading Metadata (qBit-only, global)
      if (cfg.downloadingMetadataMaxStrikes >= 3 && t.state === 'metaDL') {
        const key = strikeKey(t.hash, 'downloadingMetadata', null);
        const prev = prevStrikes.get(key);
        const newCount = (prev?.count ?? 0) + 1;
        journal.upsert({
          hash: hashLc,
          torrentName: t.name,
          strikeType: 'downloadingMetadata',
          ruleId: null,
          newCount,
          lastDownloadedBytes: BigInt(Math.max(0, Math.floor(t.downloaded))),
        });
        pendingStrikes.push(toPending(t, 'downloadingMetadata', null, null, newCount, cfg.downloadingMetadataMaxStrikes));
        if (newCount >= cfg.downloadingMetadataMaxStrikes) {
          decisions.push({
            torrent: t,
            strikeType: 'downloadingMetadata',
            ruleId: null,
            ruleName: null,
            reason: buildMetadataReason(newCount, cfg.downloadingMetadataMaxStrikes),
            linked,
            options: {
              changeCategory: false,
              deletePrivate: false,
              reSearch: cfg.reSearchAfterRemoval,
            },
          });
        }
      } else if (t.state !== 'metaDL') {
        if (prevStrikes.has(strikeKey(t.hash, 'downloadingMetadata', null))) {
          journal.clear({ hash: hashLc, torrentName: t.name, strikeType: 'downloadingMetadata', ruleId: null });
        }
      }

      // 2) Failed Import (opt-in via maxStrikes >= 3)
      if (cfg.failedImport.maxStrikes >= 3 && linked?.queueItem) {
        const skip = shouldSkipFailedImport(cfg, linked, t, inClientHashes);
        if (skip === 'contentId') {
          // ignored — never strikes when content ID missing & processNoContentId off
        } else if (skip === 'private') {
          skippedFailedImport++;
        } else if (skip === 'notInClient') {
          skippedFailedImport++;
        } else {
          // Original check was `tds === 'importFailed' || tds === 'downloadFailed'`
          // — neither string is a valid Sonarr/Radarr v3 trackedDownloadState,
          // so this rule has been a no-op. classifyQueueIssue returns
          // 'import' for importBlocked / importPending+warning and 'download'
          // for failed / failedPending, which matches the original intent
          // (both kinds of terminal failure) plus the TBA-stuck importPending
          // case the user explicitly opted into when they raised maxStrikes.
          const issue = classifyQueueIssue(
            linked.queueItem.trackedDownloadState,
            linked.queueItem.trackedDownloadStatus,
          );
          const isFailed = issue !== null;
          if (isFailed) {
            const messages = collectStatusMessages(linked.queueItem);
            const matchesPats = matchesPatterns(messages, cfg.failedImport.patterns, cfg.failedImport.patternMode);
            if (matchesPats) {
              const key = strikeKey(t.hash, 'failedImport', null);
              const prev = prevStrikes.get(key);
              const newCount = (prev?.count ?? 0) + 1;
              journal.upsert({
                hash: hashLc,
                torrentName: t.name,
                strikeType: 'failedImport',
                ruleId: null,
                newCount,
                lastDownloadedBytes: null,
              });
              pendingStrikes.push(toPending(t, 'failedImport', null, null, newCount, cfg.failedImport.maxStrikes));
              if (newCount >= cfg.failedImport.maxStrikes) {
                decisions.push({
                  torrent: t,
                  strikeType: 'failedImport',
                  ruleId: null,
                  ruleName: null,
                  reason: buildFailedImportReason(newCount, cfg.failedImport.maxStrikes),
                  linked,
                  options: {
                    changeCategory: cfg.failedImport.changeCategory,
                    deletePrivate: cfg.failedImport.deletePrivate,
                    reSearch: cfg.reSearchAfterRemoval,
                  },
                });
              }
            } else {
              if (prevStrikes.has(strikeKey(t.hash, 'failedImport', null))) {
                journal.clear({ hash: hashLc, torrentName: t.name, strikeType: 'failedImport', ruleId: null });
              }
            }
          } else {
            if (prevStrikes.has(strikeKey(t.hash, 'failedImport', null))) {
              journal.clear({ hash: hashLc, torrentName: t.name, strikeType: 'failedImport', ruleId: null });
            }
          }
        }
      }

      // 3) Stall Rules
      const stallDecided = evaluateRules<StallRuleShape>(
        t,
        stallRules,
        'stall',
        prevStrikes,
        journal,
        pendingStrikes,
        (rule) => {
          if (!matchesPrivacy(t, rule.privacyType)) return null;
          if (!inCompletionRange(t.progress * 100, rule)) return null;
          if (t.state !== 'stalledDL') return 'clear';
          const prev = prevStrikes.get(strikeKey(t.hash, 'stall', rule.id));
          if (
            rule.resetStrikesOnProgress &&
            prev &&
            progressedEnough(Math.floor(t.downloaded), prev.lastDownloadedBytes != null ? Number(prev.lastDownloadedBytes) : null, rule.minimumProgressBytes)
          ) {
            return 'clear';
          }
          return 'strike';
        },
        (rule, count) => ({
          torrent: t,
          strikeType: 'stall',
          ruleId: rule.id,
          ruleName: rule.name,
          reason: buildStallReason(rule, count),
          linked,
          options: {
            changeCategory: rule.changeCategory,
            deletePrivate: rule.deletePrivate,
            reSearch: rule.reSearchOverride ?? cfg.reSearchAfterRemoval,
          },
        }),
      );
      if (stallDecided) decisions.push(stallDecided);

      // 4) Slow Rules
      const slowDecided = evaluateRules<SlowRuleShape>(
        t,
        slowRules,
        'slow',
        prevStrikes,
        journal,
        pendingStrikes,
        (rule) => {
          if (!matchesPrivacy(t, rule.privacyType)) return null;
          if (!inCompletionRange(t.progress * 100, rule)) return null;
          if (rule.ignoreAboveSizeBytes != null && rule.ignoreAboveSizeBytes > 0 && t.size >= rule.ignoreAboveSizeBytes) return null;

          const speedThresh = rule.minSpeedKbps != null ? rule.minSpeedKbps * 1024 : null;
          const isSlow =
            speedThresh != null &&
            t.dlspeed < speedThresh &&
            (t.state === 'downloading' || t.state === 'stalledDL' || t.state === 'forcedDL');
          const tooLong = rule.maxTimeHours != null && rule.maxTimeHours > 0 && activeHours(t) > rule.maxTimeHours;
          if (!isSlow && !tooLong) return 'clear';

          const prev = prevStrikes.get(strikeKey(t.hash, 'slow', rule.id));
          if (rule.resetStrikesOnProgress && prev && speedThresh != null && t.dlspeed >= speedThresh) {
            return 'clear';
          }
          return 'strike';
        },
        (rule, count) => ({
          torrent: t,
          strikeType: 'slow',
          ruleId: rule.id,
          ruleName: rule.name,
          reason: buildSlowReason(rule, t, count),
          linked,
          options: {
            changeCategory: rule.changeCategory,
            deletePrivate: rule.deletePrivate,
            reSearch: rule.reSearchOverride ?? cfg.reSearchAfterRemoval,
          },
        }),
      );
      if (slowDecided) decisions.push(slowDecided);
    } catch (err) {
      logger.warn('Cycle: torrent eval failed', { hash: t.hash, err: String(err) }, { scope: LOG });
    }
  }

  // Attach every instance whose queue holds each torrent's hash so removal can act
  // on all of them (cross-seed / HD+4K). `linked` stays the representative for display.
  for (const d of decisions) {
    d.linkedAll = correlation.byHash.get(d.torrent.hash.toLowerCase()) ?? (d.linked ? [d.linked] : []);
  }

  // Track outcomes for end-of-cycle summary notification.
  let succeededCount = 0;
  let failedCount = 0;
  const successOutcomes: { decision: QueueDecision; outcome: Extract<QueueRemovalOutcome, { kind: 'success' }> }[] = [];
  const failureOutcomes: { decision: QueueDecision; errorMessage: string }[] = [];

  if (opts.dryRun) {
    // Dry-run: when triggered by the auto scheduler, persist strikes so
    // counts advance across cycles, then audit. Without persist(), prev.count
    // stays pinned to whatever the last real run left in the DB and the
    // threshold is never reached. Manual dry-runs (triggeredBy='dryRun') come
    // through the run-preview dialog and stay non-mutating.
    if (opts.triggeredBy === 'auto') {
      try {
        await journal.persist();
      } catch (err) {
        logger.error('Strike persistence failed (auto-dryRun)', { err: String(err) }, { scope: LOG });
      }

      await writeStrikeAddedHistory(pendingStrikes, opts.triggeredBy);

      for (const d of decisions) {
        const hashLc = d.torrent.hash.toLowerCase();
        await prisma.cleanupHistory.create({
          data: {
            cleaner: 'queue',
            strikeType: d.strikeType,
            ruleId: d.ruleId,
            ruleName: d.ruleName,
            hash: hashLc,
            shortHash: shortHash(hashLc),
            torrentName: d.torrent.name,
            reason: d.reason,
            action: 'dryRunPreview',
            filesDeleted: false,
            reSearched: false,
            linkedArrSource: d.linked?.source ?? null,
            linkedArrTitle: d.linked?.title ?? null,
            linkedArrItemId: d.linked?.queueItem.id ?? null,
            torrentSize: BigInt(Math.max(0, Math.floor(d.torrent.size))),
            torrentProgress: d.torrent.progress,
            torrentRatio: d.torrent.ratio,
            triggeredBy: 'auto',
          },
        });
        // Mirror the real-run flow's strike-clear after a successful removal
        // (see Phase 2 in executeQueueCleanerRemoval). Without this, every
        // subsequent dryRun cycle would re-fire the same decision and emit
        // duplicate dryRunPreview rows.
        await prisma.cleanupStrike.deleteMany({ where: { hash: hashLc } });
      }

      try {
        await pruneOrphanStrikes(torrents.map((t) => t.hash));
        await pruneStrikesForMissingRules();
      } catch (err) {
        logger.warn('Prune in auto-dryRun failed', { err: String(err) }, { scope: LOG });
      }
    }
  } else {
    try {
      await journal.persist();
    } catch (err) {
      logger.error('Strike persistence failed', { err: String(err) }, { scope: LOG });
    }

    await writeStrikeAddedHistory(pendingStrikes, opts.triggeredBy);

    await processWithLimit(decisions, CLEANUP_CONCURRENCY, async (d) => {
      try {
        const outcome = await executeQueueCleanerRemoval(d, opts.triggeredBy);
        if (outcome.kind === 'success') {
          succeededCount++;
          successOutcomes.push({ decision: d, outcome });
        } else {
          failedCount++;
          failureOutcomes.push({ decision: d, errorMessage: outcome.errorMessage });
        }
      } catch (err) {
        // Defensive: executeQueueCleanerRemoval is designed never to throw,
        // but if it does, treat as failure.
        const errorMessage = formatError(err);
        logger.error('Removal threw unexpectedly', { hash: d.torrent.hash, err: errorMessage }, { scope: LOG });
        failedCount++;
        failureOutcomes.push({ decision: d, errorMessage });
      }
    });
  }

  // ─── Notifications (only on a real run, not dry-run) ─────────────────────
  if (!opts.dryRun) {
    // First-time strikes (count === 1): batch into one notification if many,
    // otherwise notify per-torrent.
    const firstTimeStrikes = journal.list().filter((ch) => ch.kind === 'upsert' && ch.newCount === 1);
    if (firstTimeStrikes.length === 1) {
      const ch = firstTimeStrikes[0];
      try {
        await notifyEvent({
          eventType: 'cleanupStrike',
          title: 'Cleanup: torrent struck',
          body: `${ch.torrentName} (${ch.strikeType})`,
          metadata: { hash: ch.hash, cleaner: 'queue', cleanupStrikeType: ch.strikeType },
          url: '/cleanup',
        });
      } catch (err) {
        logger.warn('cleanupStrike notify failed', { err: String(err) }, { scope: LOG });
      }
    } else if (firstTimeStrikes.length > 1) {
      try {
        await notifyEvent({
          eventType: 'cleanupStrike',
          title: 'Cleanup cycle: strikes recorded',
          body: `${firstTimeStrikes.length} torrent${firstTimeStrikes.length === 1 ? '' : 's'} received their first strike.`,
          metadata: { cleaner: 'queue', count: firstTimeStrikes.length },
          url: '/cleanup',
        });
      } catch (err) {
        logger.warn('cleanupStrike summary notify failed', { err: String(err) }, { scope: LOG });
      }
    }

    // Removals (success): one-per if just one, otherwise summary.
    if (succeededCount === 1) {
      const { decision: d, outcome } = successOutcomes[0];
      try {
        await notifyEvent({
          eventType: 'cleanupRemoved',
          title: 'Cleanup: torrent removed',
          body: `${d.torrent.name} — ${d.reason}`,
          metadata: {
            hash: d.torrent.hash.toLowerCase(),
            cleaner: 'queue',
            cleanupRuleName: d.ruleName ?? d.strikeType,
            cleanupReason: d.reason,
            cleanupAction: outcome.action,
            cleanupStrikeType: d.strikeType,
          },
          url: '/cleanup',
        });
      } catch (err) {
        logger.warn('cleanupRemoved notify failed', { err: String(err) }, { scope: LOG });
      }
    } else if (succeededCount > 1) {
      try {
        await notifyEvent({
          eventType: 'cleanupRemoved',
          title: 'Cleanup cycle: torrents removed',
          body: `${succeededCount} torrent${succeededCount === 1 ? '' : 's'} removed by Queue Cleaner${failedCount > 0 ? ` (${failedCount} failed)` : ''}.`,
          metadata: { cleaner: 'queue', succeeded: succeededCount, failed: failedCount },
          url: '/cleanup',
        });
      } catch (err) {
        logger.warn('cleanupRemoved summary notify failed', { err: String(err) }, { scope: LOG });
      }
    }

    // Failures: one summary if any occurred.
    if (failedCount > 0) {
      try {
        const firstError = failureOutcomes[0]?.errorMessage ?? 'unknown error';
        await notifyEvent({
          eventType: 'cleanupFailed',
          title: 'Cleanup: action failed',
          body: failedCount === 1
            ? `${failureOutcomes[0].decision.torrent.name} — ${firstError}`
            : `${failedCount} cleanup actions failed. See History → Failed.`,
          metadata: { cleaner: 'queue', failed: failedCount, firstError },
          url: '/cleanup',
        });
      } catch (err) {
        logger.warn('cleanupFailed notify failed', { err: String(err) }, { scope: LOG });
      }
    }

    await pruneOrphanStrikes(torrents.map((t) => t.hash));
    await pruneStrikesForMissingRules();
  }

  const durationMs = Date.now() - t0;
  logger.info('Queue cleaner cycle done', {
    triggeredBy: opts.triggeredBy,
    dryRun: opts.dryRun,
    durationMs,
    decisions: decisions.length,
    pendingStrikes: pendingStrikes.length,
    skippedFailedImport,
  }, { scope: LOG });

  return {
    triggeredBy: opts.triggeredBy,
    dryRun: opts.dryRun,
    decisions,
    pendingStrikes,
    skippedFailedImport,
    durationMs,
    succeeded: succeededCount,
    failed: failedCount,
  };
}

function emptyResult(opts: RunOptions): QueueEvaluationResult {
  return {
    triggeredBy: opts.triggeredBy,
    dryRun: opts.dryRun,
    decisions: [],
    pendingStrikes: [],
    skippedFailedImport: 0,
    durationMs: 0,
    succeeded: 0,
    failed: 0,
  };
}

function shouldSkipFailedImport(
  cfg: QueueCleanerConfigShape,
  linked: LinkedArr,
  t: QBittorrentTorrent,
  inClientHashes: Set<string>,
): 'contentId' | 'private' | 'notInClient' | null {
  if (!cfg.processNoContentId && linked.contentId == null) return 'contentId';
  if (cfg.failedImport.skipIfNotFoundInClient) {
    const dlId = (linked.queueItem.downloadId ?? '').toLowerCase();
    if (!dlId || !inClientHashes.has(dlId)) return 'notInClient';
  }
  if (cfg.failedImport.ignorePrivate && t.private) return 'private';
  return null;
}

interface EvaluateRuleCallback<R> {
  (rule: R): 'strike' | 'clear' | null;
}

function evaluateRules<R extends { id: string; enabled: boolean; priority: number; maxStrikes: number; name: string }>(
  t: QBittorrentTorrent,
  rules: R[],
  strikeType: 'stall' | 'slow',
  prevStrikes: Map<string, { count: number; lastDownloadedBytes: bigint | null }>,
  journal: StrikeJournal,
  pendingStrikes: PendingStrike[],
  classify: EvaluateRuleCallback<R>,
  buildDecision: (rule: R, count: number) => QueueDecision,
): QueueDecision | null {
  for (const rule of rules) {
    if (!rule.enabled) continue;
    const verdict = classify(rule);

    if (verdict === null) continue; // not in scope, try next rule

    const key = strikeKey(t.hash, strikeType, rule.id);
    if (verdict === 'clear') {
      if (prevStrikes.has(key)) {
        journal.clear({ hash: t.hash.toLowerCase(), torrentName: t.name, strikeType, ruleId: rule.id });
      }
      return null; // first matching rule claimed the torrent
    }

    const prev = prevStrikes.get(key);
    const newCount = (prev?.count ?? 0) + 1;
    journal.upsert({
      hash: t.hash.toLowerCase(),
      torrentName: t.name,
      strikeType,
      ruleId: rule.id,
      newCount,
      lastDownloadedBytes: BigInt(Math.max(0, Math.floor(t.downloaded))),
    });
    pendingStrikes.push(toPending(t, strikeType, rule.id, rule.name, newCount, rule.maxStrikes));
    if (newCount >= rule.maxStrikes) {
      return buildDecision(rule, newCount);
    }
    return null; // first matching rule wins
  }
  return null;
}

async function writeStrikeAddedHistory(
  pendingStrikes: PendingStrike[],
  triggeredBy: TriggeredBy,
): Promise<void> {
  for (const ps of pendingStrikes) {
    try {
      await prisma.cleanupHistory.create({
        data: {
          cleaner: 'queue',
          strikeType: ps.strikeType,
          ruleId: ps.ruleId,
          ruleName: ps.ruleName,
          hash: ps.hash,
          shortHash: shortHash(ps.hash),
          torrentName: ps.torrentName,
          reason: `Strike ${ps.count}/${ps.maxStrikes}`,
          action: 'strikeAdded',
          filesDeleted: false,
          reSearched: false,
          triggeredBy,
        },
      });
    } catch (err) {
      logger.warn('strikeAdded history write failed', { hash: ps.hash, err: String(err) }, { scope: LOG });
    }
  }
}

function toPending(
  t: QBittorrentTorrent,
  strikeType: 'stall' | 'slow' | 'failedImport' | 'downloadingMetadata',
  ruleId: string | null,
  ruleName: string | null,
  count: number,
  maxStrikes: number,
): PendingStrike {
  return {
    hash: t.hash.toLowerCase(),
    torrentName: t.name,
    strikeType,
    ruleId,
    ruleName,
    count,
    maxStrikes,
    lastSeenAt: new Date(),
  };
}

export type QueueRemovalOutcome =
  | { kind: 'success'; action: 'removedFromClient' | 'removedFromQueue' | 'categoryChanged' | 'skipped'; filesDeleted: boolean; reSearched: boolean }
  | { kind: 'failure'; errorMessage: string };

async function executeQueueCleanerRemoval(d: QueueDecision, triggeredBy: TriggeredBy): Promise<QueueRemovalOutcome> {
  // NOT idempotent on partial failure: Sonarr/Radarr's deleteQueueItem with
  // removeFromClient=true already removes the download from qBittorrent. If a
  // subsequent step throws, the Arr-side state may not reflect what landed in
  // qBit. Recovery is operator-driven via the `action: 'failed'` history row
  // plus structured logs below — there is no automatic retry.
  const hashLc = d.torrent.hash.toLowerCase();
  const isPrivate = Boolean(d.torrent.private);
  const shouldDeleteFromClient = !isPrivate || d.options.deletePrivate;
  let action: 'removedFromClient' | 'removedFromQueue' | 'categoryChanged' | 'skipped';
  let reason = d.reason;
  let filesDeleted = false;
  let reSearched = false;

  // ─── Phase 1: attempt the destructive action ────────────────────────────
  try {
    const links = d.linkedAll ?? (d.linked ? [d.linked] : []);
    if (d.options.changeCategory && links.length > 0) {
      // changeCategory mode: NEVER fall back to delete. Apply to every linked
      // instance. The user explicitly chose "change category instead of delete"
      // and would not want a silent deletion if an arr is unreachable.
      for (const link of links) {
        const c = link.source === 'sonarr' ? await getSonarrClient(link.instanceId) : await getRadarrClient(link.instanceId);
        await c.deleteQueueItem(link.queueItem.id, { removeFromClient: false, blocklist: false, changeCategory: true });
      }
      action = 'categoryChanged';
    } else if (links.length > 0) {
      // Linked to arr: each instance removes its own queue ref; the qBit torrent
      // is removed once (the first call that deletes from the client).
      const blocklist = d.options.reSearch;
      let removedFromClientOnce = false;
      for (const link of links) {
        const removeFromClient = shouldDeleteFromClient && !removedFromClientOnce;
        const c = link.source === 'sonarr' ? await getSonarrClient(link.instanceId) : await getRadarrClient(link.instanceId);
        await c.deleteQueueItem(link.queueItem.id, { removeFromClient, blocklist });
        if (removeFromClient) removedFromClientOnce = true;
      }
      action = shouldDeleteFromClient ? 'removedFromClient' : 'removedFromQueue';
      filesDeleted = shouldDeleteFromClient;
    } else if (shouldDeleteFromClient) {
      // Unlinked: direct qBit delete.
      const qbit = await getQBittorrentClient();
      await qbit.deleteTorrent(d.torrent.hash, true);
      action = 'removedFromClient';
      filesDeleted = true;
    } else {
      // Unlinked + private + deletePrivate off → nothing to do. Emit a
      // 'skipped' audit row so operators see the deliberate no-op, rather
      // than a misleading 'removedFromQueue' claim.
      action = 'skipped';
      reason = 'Private torrent skipped (deletePrivate disabled)';
    }
  } catch (err) {
    const errorMessage = formatError(err);
    logger.error('Queue cleaner action failed', { err: errorMessage, hash: hashLc, intendedAction: d.options.changeCategory ? 'categoryChanged' : (shouldDeleteFromClient ? 'removedFromClient' : 'removedFromQueue') }, { scope: LOG });

    // ─── Phase 1 failure: keep strikes, write failure history, no re-search ─
    await prisma.cleanupHistory.create({
      data: {
        cleaner: 'queue',
        strikeType: d.strikeType,
        ruleId: d.ruleId,
        ruleName: d.ruleName,
        hash: hashLc,
        shortHash: shortHash(hashLc),
        torrentName: d.torrent.name,
        reason: d.reason,
        action: 'failed',
        filesDeleted: false,
        reSearched: false,
        linkedArrSource: d.linked?.source ?? null,
        linkedArrTitle: d.linked?.title ?? null,
        linkedArrItemId: d.linked?.queueItem.id ?? null,
        torrentSize: BigInt(Math.max(0, Math.floor(d.torrent.size))),
        torrentProgress: d.torrent.progress,
        torrentRatio: d.torrent.ratio,
        triggeredBy: triggeredBy === 'dryRun' ? 'manual' : triggeredBy,
        errorMessage,
      },
    });

    return { kind: 'failure', errorMessage };
  }

  // ─── Phase 2: destructive action succeeded — clear strikes, then audit ──
  // Skipped actions are deliberate no-ops; keep strikes so the next cycle can
  // re-evaluate if the situation changes (e.g. user toggles deletePrivate on).
  if (action !== 'skipped') {
    await prisma.cleanupStrike.deleteMany({ where: { hash: hashLc } });
  }

  // ─── Phase 3: trigger re-search if appropriate ───────────────────────────
  if (action !== 'categoryChanged' && d.options.reSearch && d.linked?.contentId) {
    try {
      if (d.linked.source === 'sonarr') {
        const c = await getSonarrClient(d.linked.instanceId);
        await c.searchSeries(d.linked.contentId);
        reSearched = true;
      } else if (d.linked.source === 'radarr') {
        const c = await getRadarrClient(d.linked.instanceId);
        await c.searchMovie([d.linked.contentId]);
        reSearched = true;
      }
    } catch (err) {
      logger.warn('Re-search trigger failed (deletion still succeeded)', { err: formatError(err), hash: hashLc }, { scope: LOG });
    }
  }

  // ─── Phase 4: audit log ──────────────────────────────────────────────────
  await prisma.cleanupHistory.create({
    data: {
      cleaner: 'queue',
      strikeType: d.strikeType,
      ruleId: d.ruleId,
      ruleName: d.ruleName,
      hash: hashLc,
      shortHash: shortHash(hashLc),
      torrentName: d.torrent.name,
      reason,
      action,
      filesDeleted,
      reSearched,
      linkedArrSource: d.linked?.source ?? null,
      linkedArrTitle: d.linked?.title ?? null,
      linkedArrItemId: d.linked?.queueItem.id ?? null,
      torrentSize: BigInt(Math.max(0, Math.floor(d.torrent.size))),
      torrentProgress: d.torrent.progress,
      torrentRatio: d.torrent.ratio,
      triggeredBy: triggeredBy === 'dryRun' ? 'manual' : triggeredBy,
    },
  });

  return { kind: 'success', action, filesDeleted, reSearched };
}
