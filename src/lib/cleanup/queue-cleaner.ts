import { prisma } from '@/lib/db';
import { logger } from '@/lib/logger';
import type { QBittorrentTorrent, QueueItem } from '@/types';
import { getQBittorrentClient, getSonarrClient, getRadarrClient } from '@/lib/service-helpers';
import { notifyEvent } from '@/lib/notification-service';
import {
  batchFetchTrackerDomains,
  buildCorrelationIndex,
  buildFailedImportReason,
  buildMetadataReason,
  buildSlowReason,
  buildStallReason,
  collectStatusMessages,
  hoursSinceAdded,
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
import {
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
    },
    update: {
      enabled: input.enabled,
      intervalMinutes: input.intervalMinutes,
      ignoredDownloads: input.ignoredDownloads,
      processNoContentId: input.processNoContentId,
      downloadingMetadataMaxStrikes: input.downloadingMetadataMaxStrikes,
      failedImport: input.failedImport as unknown as object,
      reSearchAfterRemoval: input.reSearchAfterRemoval,
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
  sonarrQueue: QueueItem[] | null;
  radarrQueue: QueueItem[] | null;
}> {
  let sonarrQueue: QueueItem[] | null = null;
  let radarrQueue: QueueItem[] | null = null;
  try {
    const c = await getSonarrClient();
    const r = await c.getQueue(1, 1000);
    sonarrQueue = (r.records || []).map((i) => ({ ...i, source: 'sonarr' as const }));
  } catch (err) {
    if (!isMissingConfigError(err)) logger.warn('Sonarr queue fetch failed', { err: String(err) }, { scope: LOG });
  }
  try {
    const c = await getRadarrClient();
    const r = await c.getQueue(1, 1000);
    radarrQueue = (r.records || []).map((i) => ({ ...i, source: 'radarr' as const }));
  } catch (err) {
    if (!isMissingConfigError(err)) logger.warn('Radarr queue fetch failed', { err: String(err) }, { scope: LOG });
  }
  return { sonarrQueue, radarrQueue };
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

  const [{ sonarrQueue, radarrQueue }, stallRules, slowRules, prevStrikes] = await Promise.all([
    loadArrQueues(),
    loadStallRules(),
    loadSlowRules(),
    loadActiveStrikes(),
  ]);

  const trackerDomains = await batchFetchTrackerDomains(qbit, torrents);
  const correlation = buildCorrelationIndex(sonarrQueue, radarrQueue);

  const journal = new StrikeJournal();
  const decisions: QueueDecision[] = [];
  const pendingStrikes: PendingStrike[] = [];
  let skippedFailedImport = 0;

  for (const t of torrents) {
    try {
      const hashLc = t.hash.toLowerCase();
      const domains = trackerDomains.get(hashLc) ?? [];

      if (matchesIgnoredPatterns(t, domains, cfg.ignoredDownloads)) continue;

      const linked = correlation.byHash.get(hashLc) ?? null;

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
        const skip = shouldSkipFailedImport(cfg, linked, t);
        if (skip === 'contentId') {
          // ignored — never strikes when content ID missing & processNoContentId off
        } else if (skip === 'private') {
          skippedFailedImport++;
        } else if (skip === 'notInClient') {
          skippedFailedImport++;
        } else {
          const tds = linked.queueItem.trackedDownloadState;
          const isFailed = tds === 'importFailed' || tds === 'downloadFailed';
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
          const tooLong = rule.maxTimeHours != null && rule.maxTimeHours > 0 && hoursSinceAdded(t) > rule.maxTimeHours;
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

  if (!opts.dryRun) {
    try {
      await journal.persist();
    } catch (err) {
      logger.error('Strike persistence failed', { err: String(err) }, { scope: LOG });
    }

    for (const d of decisions) {
      try {
        await executeQueueCleanerRemoval(d, opts.triggeredBy);
      } catch (err) {
        logger.error('Removal failed', { hash: d.torrent.hash, err: String(err) }, { scope: LOG });
      }
    }
  }

  // Side-effect notifications for first-time strikes (only when not dry-running)
  if (!opts.dryRun) {
    for (const ch of journal.list()) {
      if (ch.kind === 'upsert' && ch.newCount === 1) {
        try {
          await notifyEvent({
            eventType: 'cleanupStrike',
            title: 'Cleanup: torrent struck',
            body: `${ch.torrentName} (${ch.strikeType})`,
            metadata: {
              hash: ch.hash,
              cleaner: 'queue',
              cleanupStrikeType: ch.strikeType,
            },
            url: '/cleanup',
          });
        } catch (err) {
          logger.warn('cleanupStrike notify failed', { err: String(err) }, { scope: LOG });
        }
      }
    }
  }

  if (!opts.dryRun) {
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
  };
}

function shouldSkipFailedImport(
  cfg: QueueCleanerConfigShape,
  linked: LinkedArr,
  t: QBittorrentTorrent,
): 'contentId' | 'private' | 'notInClient' | null {
  if (!cfg.processNoContentId && linked.contentId == null) return 'contentId';
  if (cfg.failedImport.ignorePrivate && t.private) return 'private';
  // skipIfNotFoundInClient is informational here — if we have the torrent, we have it in qBit
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

async function executeQueueCleanerRemoval(d: QueueDecision, triggeredBy: TriggeredBy): Promise<void> {
  const hashLc = d.torrent.hash.toLowerCase();
  const isPrivate = Boolean(d.torrent.private);
  const shouldDeleteFromClient = !isPrivate || d.options.deletePrivate;
  let action: 'removedFromClient' | 'removedFromQueue' | 'categoryChanged' = 'removedFromClient';
  let reSearched = false;

  // Path A: changeCategory mode (only meaningful when linked to arr)
  if (d.options.changeCategory && d.linked?.queueItem) {
    try {
      if (d.linked.source === 'sonarr') {
        const c = await getSonarrClient();
        await c.deleteQueueItem(d.linked.queueItem.id, { removeFromClient: false, blocklist: false, changeCategory: true });
      } else {
        const c = await getRadarrClient();
        await c.deleteQueueItem(d.linked.queueItem.id, { removeFromClient: false, blocklist: false, changeCategory: true });
      }
      action = 'categoryChanged';
    } catch (err) {
      logger.warn('changeCategory failed; falling back to delete', { err: String(err), hash: hashLc }, { scope: LOG });
      action = 'removedFromClient';
    }
  }

  if (action !== 'categoryChanged') {
    // Path B: standard delete; optionally with arr blocklist + re-search
    if (d.options.reSearch && d.linked?.queueItem) {
      try {
        if (d.linked.source === 'sonarr') {
          const c = await getSonarrClient();
          await c.deleteQueueItem(d.linked.queueItem.id, {
            removeFromClient: shouldDeleteFromClient,
            blocklist: true,
          });
        } else {
          const c = await getRadarrClient();
          await c.deleteQueueItem(d.linked.queueItem.id, {
            removeFromClient: shouldDeleteFromClient,
            blocklist: true,
          });
        }
      } catch (err) {
        logger.warn('arr deleteQueueItem failed; deleting via qBit directly', { err: String(err), hash: hashLc }, { scope: LOG });
        if (shouldDeleteFromClient) {
          try {
            const qbit = await getQBittorrentClient();
            await qbit.deleteTorrent(d.torrent.hash, true);
          } catch (err2) {
            logger.warn('qBit delete fallback failed', { err: String(err2), hash: hashLc }, { scope: LOG });
          }
        }
      }
    } else if (shouldDeleteFromClient) {
      const qbit = await getQBittorrentClient();
      await qbit.deleteTorrent(d.torrent.hash, true);
    }

    action = shouldDeleteFromClient ? 'removedFromClient' : 'removedFromQueue';
  }

  // Clean strike rows for this hash
  await prisma.cleanupStrike.deleteMany({ where: { hash: hashLc } });

  // Audit log
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
      action,
      filesDeleted: shouldDeleteFromClient && action !== 'categoryChanged',
      reSearched: false,
      linkedArrSource: d.linked?.source ?? null,
      linkedArrTitle: d.linked?.title ?? null,
      linkedArrItemId: d.linked?.queueItem.id ?? null,
      torrentSize: BigInt(Math.max(0, Math.floor(d.torrent.size))),
      torrentProgress: d.torrent.progress,
      torrentRatio: d.torrent.ratio,
      triggeredBy: triggeredBy === 'dryRun' ? 'manual' : triggeredBy,
    },
  });

  // Trigger re-search
  if (action !== 'categoryChanged' && d.options.reSearch && d.linked) {
    try {
      if (d.linked.source === 'sonarr' && d.linked.contentId) {
        const c = await getSonarrClient();
        await c.searchSeries(d.linked.contentId);
        reSearched = true;
      } else if (d.linked.source === 'radarr' && d.linked.contentId) {
        const c = await getRadarrClient();
        await c.searchMovie([d.linked.contentId]);
        reSearched = true;
      }
    } catch (err) {
      logger.warn('Re-search trigger failed', { err: String(err), hash: hashLc }, { scope: LOG });
    }
  }

  if (reSearched) {
    await prisma.cleanupHistory.updateMany({
      where: { hash: hashLc, createdAt: { gte: new Date(Date.now() - 60_000) } },
      data: { reSearched: true },
    });
  }

  try {
    await notifyEvent({
      eventType: 'cleanupRemoved',
      title: 'Cleanup: torrent removed',
      body: `${d.torrent.name} — ${d.reason}`,
      metadata: {
        hash: hashLc,
        cleaner: 'queue',
        cleanupRuleName: d.ruleName ?? d.strikeType,
        cleanupReason: d.reason,
        cleanupAction: action,
        cleanupStrikeType: d.strikeType,
      },
      url: '/cleanup',
    });
  } catch (err) {
    logger.warn('cleanupRemoved notify failed', { err: String(err) }, { scope: LOG });
  }
}
