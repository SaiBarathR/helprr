import { prisma } from '@/lib/db';
import type { Prisma } from '@prisma/client';
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
  isTorrentPrivate,
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
import { resetFailureNotify, shouldNotifyFailure } from './notify-throttle';
import { processWithLimit } from './concurrency';
import { fetchFullQueue, QUEUE_PAGE_SIZE, MAX_QUEUE_PAGES } from './queue-pagination';
import {
  assertExecutionBinding,
  buildExecutionBinding,
  candidateFingerprint,
  cleanupScopeFingerprint,
  queueCandidateBinding,
  queueConfigFingerprint,
} from './binding';
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
  CleanupExecutionBinding,
  CleanupItemOutcome,
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
  complete: boolean;
}> {
  const sonarr: Array<{ instanceId: string; instanceLabel: string; queue: QueueItem[] }> = [];
  const radarr: Array<{ instanceId: string; instanceLabel: string; queue: QueueItem[] }> = [];
  let complete = true;
  for (const { connection, client } of await getSonarrClients()) {
    try {
      const records = await fetchFullQueue((page, pageSize) => client.getQueue(page, pageSize));
      if (records === null) {
        logger.error('Sonarr queue exceeds pagination bound; skipping instance this cycle (fail-safe)', { instanceId: connection.id, maxItems: QUEUE_PAGE_SIZE * MAX_QUEUE_PAGES }, { scope: LOG });
        complete = false;
        continue;
      }
      sonarr.push({
        instanceId: connection.id,
        instanceLabel: connection.label,
        queue: records.map((i) => ({ ...i, source: 'sonarr' as const })),
      });
    } catch (err) {
      complete = false;
      if (!isMissingConfigError(err)) logger.warn('Sonarr queue fetch failed', { instanceId: connection.id, err: String(err) }, { scope: LOG });
    }
  }
  for (const { connection, client } of await getRadarrClients()) {
    try {
      const records = await fetchFullQueue((page, pageSize) => client.getQueue(page, pageSize));
      if (records === null) {
        logger.error('Radarr queue exceeds pagination bound; skipping instance this cycle (fail-safe)', { instanceId: connection.id, maxItems: QUEUE_PAGE_SIZE * MAX_QUEUE_PAGES }, { scope: LOG });
        complete = false;
        continue;
      }
      radarr.push({
        instanceId: connection.id,
        instanceLabel: connection.label,
        queue: records.map((i) => ({ ...i, source: 'radarr' as const })),
      });
    } catch (err) {
      complete = false;
      if (!isMissingConfigError(err)) logger.warn('Radarr queue fetch failed', { instanceId: connection.id, err: String(err) }, { scope: LOG });
    }
  }
  return { sonarr, radarr, complete };
}

function isMissingConfigError(err: unknown): boolean {
  return err instanceof Error && err.message.includes('is not configured');
}

// qBittorrent metadata-download states: metaDL plus its force-started variant.
function isMetadataState(state: string): boolean {
  return state === 'metaDL' || state === 'forcedMetaDL';
}

// States in which a torrent is actively trying to download. Slow-rule
// triggers (speed AND max-active-hours) only make sense here.
function isActiveDownloadState(state: string): boolean {
  return state === 'downloading' || state === 'stalledDL' || state === 'forcedDL';
}

export interface RunOptions {
  dryRun: boolean;
  triggeredBy: TriggeredBy;
  expectedBinding?: CleanupExecutionBinding;
  previewId?: string;
}

export async function runQueueCleanerCycle(opts: RunOptions): Promise<QueueEvaluationResult> {
  const t0 = Date.now();
  const [cfg, stallRules, slowRules, scopeFingerprint] = await Promise.all([
    loadQueueCleanerConfig(),
    loadStallRules(),
    loadSlowRules(),
    cleanupScopeFingerprint(),
  ]);
  const configFingerprint = queueConfigFingerprint(cfg, stallRules, slowRules);
  const noCandidatesBinding = buildExecutionBinding('queue', configFingerprint, scopeFingerprint, []);
  if (!cfg.enabled) {
    if (opts.expectedBinding) assertExecutionBinding(opts.expectedBinding, noCandidatesBinding);
    return emptyResult(opts, noCandidatesBinding, ['Queue Cleaner is disabled']);
  }

  let qbit;
  try {
    qbit = await getQBittorrentClient();
  } catch (err) {
    logger.warn('qBittorrent unavailable', { err: String(err) }, { scope: LOG });
    if (opts.expectedBinding) assertExecutionBinding(opts.expectedBinding, noCandidatesBinding);
    return emptyResult(opts, noCandidatesBinding, ['qBittorrent is unavailable — nothing was evaluated']);
  }

  let torrents: QBittorrentTorrent[];
  try {
    torrents = await qbit.getTorrents();
  } catch (err) {
    logger.warn('qBittorrent listing failed', { err: String(err) }, { scope: LOG });
    if (opts.expectedBinding) assertExecutionBinding(opts.expectedBinding, noCandidatesBinding);
    return emptyResult(opts, noCandidatesBinding, ['qBittorrent torrent listing failed — nothing was evaluated']);
  }

  const [{ sonarr: sonarrInstances, radarr: radarrInstances, complete: arrQueuesComplete }, prevStrikes] = await Promise.all([
    loadArrQueues(),
    loadActiveStrikes(),
  ]);
  if (!arrQueuesComplete) {
    logger.error('Queue cleaner aborted because at least one configured Arr queue could not be read completely', {}, { scope: LOG });
    if (opts.expectedBinding) assertExecutionBinding(opts.expectedBinding, noCandidatesBinding);
    return emptyResult(opts, noCandidatesBinding, ['At least one Sonarr/Radarr queue could not be read — cycle aborted as a safety measure']);
  }

  const trackerDomains = await batchFetchTrackerDomains(qbit, torrents);
  const correlation = buildCorrelationIndex(sonarrInstances, radarrInstances);

  const journal = new StrikeJournal();
  const decisions: QueueDecision[] = [];
  const pendingStrikes: PendingStrike[] = [];
  const warnings: string[] = [];
  let skippedFailedImport = 0;
  let skippedTrackerUnknown = 0;

  for (const t of torrents) {
    try {
      const hashLc = t.hash.toLowerCase();
      const fetchedDomains = trackerDomains.get(hashLc) ?? null;
      // Tracker lookup failed: with ignore patterns configured we cannot tell
      // whether this torrent is protected, so fail closed and skip it.
      if (fetchedDomains === null && cfg.ignoredDownloads.length > 0) {
        skippedTrackerUnknown++;
        continue;
      }
      const domains = fetchedDomains ?? [];

      if (matchesIgnoredPatterns(t, domains, cfg.ignoredDownloads)) continue;

      // Cross-seed / dual-grab: a hash can sit in multiple instances' queues.
      // Sonarr wins as the representative for display + the failed-import check
      // (preserves the pre-multi-instance precedence); `linkedAll` (set below)
      // drives the actual removal across every instance.
      const links = correlation.byHash.get(hashLc) ?? [];
      const linked = links.find((l) => l.source === 'sonarr') ?? links[0] ?? null;

      // 1) Downloading Metadata (qBit-only, global)
      if (cfg.downloadingMetadataMaxStrikes >= 3 && isMetadataState(t.state)) {
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
            strikeCount: newCount,
            maxStrikes: cfg.downloadingMetadataMaxStrikes,
            reason: buildMetadataReason(newCount, cfg.downloadingMetadataMaxStrikes),
            linked,
            options: {
              changeCategory: false,
              deletePrivate: false,
              reSearch: cfg.reSearchAfterRemoval,
            },
          });
        }
      } else if (!isMetadataState(t.state)) {
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
                  strikeCount: newCount,
                  maxStrikes: cfg.failedImport.maxStrikes,
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
          strikeCount: count,
          maxStrikes: rule.maxStrikes,
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

          // Slow rules police *downloads*. Both triggers require an active
          // download state — without this gate, "max active hours" would
          // strike completed/seeding torrents (time_active keeps growing
          // while seeding) and delete them with their files.
          const speedThresh = rule.minSpeedKbps != null ? rule.minSpeedKbps * 1024 : null;
          const isSlow = speedThresh != null && t.dlspeed < speedThresh && isActiveDownloadState(t.state);
          const tooLong =
            rule.maxTimeHours != null && rule.maxTimeHours > 0
            && isActiveDownloadState(t.state)
            && activeHours(t) > rule.maxTimeHours;
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
          strikeCount: count,
          maxStrikes: rule.maxStrikes,
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

  // A torrent can satisfy more than one strike rule in the same cycle. Keep the
  // first condition in the documented evaluation order so a single hash never
  // reaches the concurrent deletion pool twice.
  const seenDecisionHashes = new Set<string>();
  for (let index = 0; index < decisions.length;) {
    const hash = decisions[index].torrent.hash.toLowerCase();
    if (seenDecisionHashes.has(hash)) {
      decisions.splice(index, 1);
    } else {
      seenDecisionHashes.add(hash);
      index++;
    }
  }

  // Attach every instance whose queue holds each torrent's hash so removal can act
  // on all of them (cross-seed / HD+4K). `linked` stays the representative for display.
  for (const d of decisions) {
    d.linkedAll = correlation.byHash.get(d.torrent.hash.toLowerCase()) ?? (d.linked ? [d.linked] : []);
  }
  const binding = buildExecutionBinding(
    'queue',
    configFingerprint,
    scopeFingerprint,
    decisions.map(queueCandidateBinding),
  );
  if (opts.expectedBinding) assertExecutionBinding(opts.expectedBinding, binding);

  // Track outcomes for end-of-cycle summary notification.
  let succeededCount = 0;
  let failedCount = 0;
  const outcomes: CleanupItemOutcome[] = [];
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
        const revalidation = await revalidateQueueDecision(d, configFingerprint, scopeFingerprint);
        const outcome = revalidation.ok
          ? await executeQueueCleanerRemoval(revalidation.decision, opts.triggeredBy, opts.previewId)
          : await recordQueueRevalidationOutcome(d, revalidation, opts.triggeredBy, opts.previewId);
        if (outcome.kind === 'success') {
          succeededCount++;
          successOutcomes.push({ decision: d, outcome });
          outcomes.push(toQueueItemOutcome(d, outcome));
        } else {
          failedCount++;
          failureOutcomes.push({ decision: d, errorMessage: outcome.errorMessage });
          outcomes.push(toQueueItemOutcome(d, outcome));
        }
      } catch (err) {
        // Defensive: executeQueueCleanerRemoval is designed never to throw,
        // but if it does, treat as failure.
        const errorMessage = formatError(err);
        logger.error('Removal threw unexpectedly', { hash: d.torrent.hash, err: errorMessage }, { scope: LOG });
        failedCount++;
        failureOutcomes.push({ decision: d, errorMessage });
        outcomes.push({
          hash: d.torrent.hash.toLowerCase(),
          torrentName: d.torrent.name,
          status: 'failed',
          action: 'failed',
          filesDeleted: false,
          reSearched: false,
          message: 'Cleanup removal threw unexpectedly',
          errorMessage,
          targets: [],
        });
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

    // Failures: one summary if any occurred — throttled, because a broken
    // removal retries every cycle and must not notify once per interval.
    if (failedCount === 0 && succeededCount > 0) resetFailureNotify('queue');
    if (failedCount > 0 && shouldNotifyFailure('queue')) {
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

  if (skippedTrackerUnknown > 0) {
    warnings.push(`${skippedTrackerUnknown} torrent${skippedTrackerUnknown === 1 ? '' : 's'} skipped: tracker data could not be read while an ignore list is configured`);
  }

  const durationMs = Date.now() - t0;
  logger.info('Queue cleaner cycle done', {
    triggeredBy: opts.triggeredBy,
    dryRun: opts.dryRun,
    durationMs,
    decisions: decisions.length,
    pendingStrikes: pendingStrikes.length,
    skippedFailedImport,
    skippedTrackerUnknown,
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
    outcomes,
    binding,
    warnings,
  };
}

function emptyResult(opts: RunOptions, binding: CleanupExecutionBinding, warnings: string[] = []): QueueEvaluationResult {
  return {
    triggeredBy: opts.triggeredBy,
    dryRun: opts.dryRun,
    decisions: [],
    pendingStrikes: [],
    skippedFailedImport: 0,
    durationMs: 0,
    succeeded: 0,
    failed: 0,
    outcomes: [],
    binding,
    warnings,
  };
}

// NOTE: evaluation is driven from torrents present in qBittorrent and queue
// items are correlated BY the torrent's own hash, so a queue item whose
// download is missing from the client never reaches this check. The old
// `skipIfNotFoundInClient` toggle was therefore inert (always effectively on)
// and has been removed from the UI; the config field is retained only for
// stored-config/settings-export compatibility.
function shouldSkipFailedImport(
  cfg: QueueCleanerConfigShape,
  linked: LinkedArr,
  t: QBittorrentTorrent,
): 'contentId' | 'private' | null {
  if (!cfg.processNoContentId && linked.contentId == null) return 'contentId';
  if (cfg.failedImport.ignorePrivate && isTorrentPrivate(t) !== false) return 'private';
  return null;
}

type QueueRevalidation =
  | { ok: true; decision: QueueDecision }
  | { ok: false; status: 'stale' | 'failed'; message: string; errorMessage: string };

async function revalidateQueueDecision(
  expected: QueueDecision,
  expectedConfigFingerprint: string,
  expectedScopeFingerprint: string,
): Promise<QueueRevalidation> {
  try {
    const [config, stallRules, slowRules, scopeFingerprint] = await Promise.all([
      loadQueueCleanerConfig(),
      loadStallRules(),
      loadSlowRules(),
      cleanupScopeFingerprint(),
    ]);
    if (
      !config.enabled
      || queueConfigFingerprint(config, stallRules, slowRules) !== expectedConfigFingerprint
      || scopeFingerprint !== expectedScopeFingerprint
    ) {
      return { ok: false, status: 'stale', message: 'Cleaner configuration changed after preview', errorMessage: 'Preview configuration no longer matches' };
    }

    const qbit = await getQBittorrentClient();
    const torrents = await qbit.getTorrents(undefined, undefined, undefined, undefined, expected.torrent.hash);
    if (torrents.length !== 1) {
      return { ok: false, status: 'stale', message: 'Torrent is no longer present', errorMessage: 'Torrent disappeared after preview' };
    }
    const torrent = torrents[0];
    const fetchedDomains = (await batchFetchTrackerDomains(qbit, [torrent])).get(torrent.hash.toLowerCase()) ?? null;
    if (fetchedDomains === null && config.ignoredDownloads.length > 0) {
      return { ok: false, status: 'failed', message: 'Could not read tracker data to re-check the ignore list', errorMessage: 'Tracker lookup failed during revalidation' };
    }
    if (matchesIgnoredPatterns(torrent, fetchedDomains ?? [], config.ignoredDownloads)) {
      return { ok: false, status: 'stale', message: 'Torrent is now ignored by cleanup policy', errorMessage: 'Ignored-download scope changed after preview' };
    }

    const queues = await loadArrQueues();
    if (!queues.complete) {
      return { ok: false, status: 'failed', message: 'Could not revalidate all configured Arr queues', errorMessage: 'At least one Arr queue was unavailable' };
    }
    const correlation = buildCorrelationIndex(queues.sonarr, queues.radarr);
    const links = correlation.byHash.get(torrent.hash.toLowerCase()) ?? [];
    const linked = links.find((link) => link.source === 'sonarr') ?? links[0] ?? null;
    const activeStrikes = await loadActiveStrikes();
    const strike = activeStrikes.get(strikeKey(torrent.hash, expected.strikeType, expected.ruleId));
    const count = strike?.count ?? 0;
    if (count < expected.maxStrikes) {
      return { ok: false, status: 'stale', message: 'Strike threshold is no longer met', errorMessage: 'Strike state changed after preview' };
    }

    let current: QueueDecision | null = null;
    if (expected.strikeType === 'downloadingMetadata') {
      if (config.downloadingMetadataMaxStrikes >= 3 && isMetadataState(torrent.state)) {
        current = {
          torrent,
          strikeType: 'downloadingMetadata',
          ruleId: null,
          ruleName: null,
          strikeCount: count,
          maxStrikes: config.downloadingMetadataMaxStrikes,
          reason: buildMetadataReason(count, config.downloadingMetadataMaxStrikes),
          linked,
          linkedAll: links,
          options: { changeCategory: false, deletePrivate: false, reSearch: config.reSearchAfterRemoval },
        };
      }
    } else if (expected.strikeType === 'failedImport') {
      if (
        config.failedImport.maxStrikes >= 3
        && linked
        && shouldSkipFailedImport(config, linked, torrent) === null
      ) {
        const issue = classifyQueueIssue(linked.queueItem.trackedDownloadState, linked.queueItem.trackedDownloadStatus);
        const messages = collectStatusMessages(linked.queueItem);
        if (issue && matchesPatterns(messages, config.failedImport.patterns, config.failedImport.patternMode)) {
          current = {
            torrent,
            strikeType: 'failedImport',
            ruleId: null,
            ruleName: null,
            strikeCount: count,
            maxStrikes: config.failedImport.maxStrikes,
            reason: buildFailedImportReason(count, config.failedImport.maxStrikes),
            linked,
            linkedAll: links,
            options: {
              changeCategory: config.failedImport.changeCategory,
              deletePrivate: config.failedImport.deletePrivate,
              reSearch: config.reSearchAfterRemoval,
            },
          };
        }
      }
    } else if (expected.strikeType === 'stall') {
      const rule = stallRules.find((candidate) => candidate.id === expected.ruleId && candidate.enabled);
      // Mirror the evaluation-time reset check: if the torrent progressed
      // enough since its last strike, evaluation would have cleared it — a
      // removal in that window must be refused as stale.
      const progressReset =
        rule?.resetStrikesOnProgress
        && strike != null
        && progressedEnough(
          Math.floor(torrent.downloaded),
          strike.lastDownloadedBytes != null ? Number(strike.lastDownloadedBytes) : null,
          rule.minimumProgressBytes,
        );
      if (
        rule
        && !progressReset
        && matchesPrivacy(torrent, rule.privacyType)
        && inCompletionRange(torrent.progress * 100, rule)
        && torrent.state === 'stalledDL'
      ) {
        current = {
          torrent,
          strikeType: 'stall',
          ruleId: rule.id,
          ruleName: rule.name,
          strikeCount: count,
          maxStrikes: rule.maxStrikes,
          reason: buildStallReason(rule, count),
          linked,
          linkedAll: links,
          options: {
            changeCategory: rule.changeCategory,
            deletePrivate: rule.deletePrivate,
            reSearch: rule.reSearchOverride ?? config.reSearchAfterRemoval,
          },
        };
      }
    } else if (expected.strikeType === 'slow') {
      const rule = slowRules.find((candidate) => candidate.id === expected.ruleId && candidate.enabled);
      if (rule && matchesPrivacy(torrent, rule.privacyType) && inCompletionRange(torrent.progress * 100, rule)) {
        const speedThreshold = rule.minSpeedKbps != null ? rule.minSpeedKbps * 1024 : null;
        const isSlow = speedThreshold != null
          && torrent.dlspeed < speedThreshold
          && isActiveDownloadState(torrent.state);
        const tooLong = rule.maxTimeHours != null && rule.maxTimeHours > 0
          && isActiveDownloadState(torrent.state)
          && activeHours(torrent) > rule.maxTimeHours;
        const sizeAllowed = rule.ignoreAboveSizeBytes == null || rule.ignoreAboveSizeBytes <= 0 || torrent.size < rule.ignoreAboveSizeBytes;
        // Mirror the evaluation-time speed-recovery reset.
        const speedRecovered = rule.resetStrikesOnProgress && speedThreshold != null && torrent.dlspeed >= speedThreshold;
        if ((isSlow || tooLong) && sizeAllowed && !speedRecovered) {
          current = {
            torrent,
            strikeType: 'slow',
            ruleId: rule.id,
            ruleName: rule.name,
            strikeCount: count,
            maxStrikes: rule.maxStrikes,
            reason: buildSlowReason(rule, torrent, count),
            linked,
            linkedAll: links,
            options: {
              changeCategory: rule.changeCategory,
              deletePrivate: rule.deletePrivate,
              reSearch: rule.reSearchOverride ?? config.reSearchAfterRemoval,
            },
          };
        }
      }
    }

    if (!current) {
      return { ok: false, status: 'stale', message: 'Torrent no longer meets the reviewed cleanup condition', errorMessage: 'Cleanup condition changed after preview' };
    }
    if (candidateFingerprint([queueCandidateBinding(current)]) !== candidateFingerprint([queueCandidateBinding(expected)])) {
      return { ok: false, status: 'stale', message: 'Cleanup action or linked queue scope changed after preview', errorMessage: 'Candidate binding changed after preview' };
    }
    return { ok: true, decision: current };
  } catch (error) {
    const errorMessage = formatError(error);
    return { ok: false, status: 'failed', message: 'Could not revalidate the torrent safely', errorMessage };
  }
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

    if (verdict === null) {
      // Not in scope. Clear any strikes this rule accumulated earlier —
      // progress only moves forward, so a torrent that left the completion
      // range would otherwise show a frozen "active strike" forever.
      const outOfScopeKey = strikeKey(t.hash, strikeType, rule.id);
      if (prevStrikes.has(outOfScopeKey)) {
        journal.clear({ hash: t.hash.toLowerCase(), torrentName: t.name, strikeType, ruleId: rule.id });
      }
      continue; // try next rule
    }

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
  | {
      kind: 'success';
      status: 'succeeded';
      action: 'removedFromClient' | 'removedFromQueue' | 'categoryChanged';
      filesDeleted: boolean;
      reSearched: boolean;
      message: string;
      errorMessage: null;
      targets: CleanupItemOutcome['targets'];
    }
  | {
      kind: 'failure';
      status: 'partial' | 'failed' | 'stale' | 'skipped';
      action: 'removedFromClient' | 'removedFromQueue' | 'categoryChanged' | 'skipped' | 'failed';
      filesDeleted: boolean;
      reSearched: boolean;
      message: string;
      errorMessage: string;
      targets: CleanupItemOutcome['targets'];
    };

function toQueueItemOutcome(d: QueueDecision, outcome: QueueRemovalOutcome): CleanupItemOutcome {
  return {
    hash: d.torrent.hash.toLowerCase(),
    torrentName: d.torrent.name,
    status: outcome.status,
    action: outcome.action,
    filesDeleted: outcome.filesDeleted,
    reSearched: outcome.reSearched,
    message: outcome.message,
    errorMessage: outcome.errorMessage,
    targets: outcome.targets,
  };
}

async function recordQueueRevalidationOutcome(
  decision: QueueDecision,
  revalidation: Extract<QueueRevalidation, { ok: false }>,
  triggeredBy: TriggeredBy,
  previewId?: string,
): Promise<QueueRemovalOutcome> {
  const outcome: QueueRemovalOutcome = {
    kind: 'failure',
    status: revalidation.status,
    action: revalidation.status === 'stale' ? 'skipped' : 'failed',
    filesDeleted: false,
    reSearched: false,
    message: revalidation.message,
    errorMessage: revalidation.errorMessage,
    targets: [{ target: 'qbittorrent', attempted: false, before: 'unknown', after: 'unknown', errorMessage: revalidation.errorMessage }],
  };
  await writeQueueHistory(decision, outcome, triggeredBy, previewId);
  return outcome;
}

async function inspectQbit(hash: string): Promise<{ state: 'present' | 'absent' | 'unknown'; errorMessage?: string }> {
  try {
    const qbit = await getQBittorrentClient();
    const torrents = await qbit.getTorrents(undefined, undefined, undefined, undefined, hash);
    return { state: torrents.length === 0 ? 'absent' : 'present' };
  } catch (error) {
    return { state: 'unknown', errorMessage: formatError(error) };
  }
}

async function inspectQueueLink(link: LinkedArr): Promise<{ state: 'present' | 'absent' | 'unknown'; errorMessage?: string }> {
  try {
    const client = link.source === 'sonarr'
      ? await getSonarrClient(link.instanceId)
      : await getRadarrClient(link.instanceId);
    const records = await fetchFullQueue((page, pageSize) => client.getQueue(page, pageSize));
    if (records === null) return { state: 'unknown', errorMessage: 'Queue exceeded the safe pagination bound' };
    return { state: records.some((record) => record.id === link.queueItem.id) ? 'present' : 'absent' };
  } catch (error) {
    return { state: 'unknown', errorMessage: formatError(error) };
  }
}

async function triggerQueueResearch(d: QueueDecision): Promise<{ reSearched: boolean; target: CleanupItemOutcome['targets'][number] | null }> {
  if (!d.options.reSearch || !d.linked?.contentId) return { reSearched: false, target: null };
  try {
    if (d.linked.source === 'sonarr') {
      const client = await getSonarrClient(d.linked.instanceId);
      const seriesId = d.linked.contentId;
      const records = (d.linkedAll ?? [d.linked]).filter(
        (link) => link.source === 'sonarr' && link.instanceId === d.linked?.instanceId,
      );
      const bySeason = new Map<number, Set<number>>();
      const episodeIds = new Set<number>();
      for (const record of records) {
        const episodeId = record.queueItem.episodeId;
        const season = record.queueItem.seasonNumber;
        if (typeof season === 'number') {
          const ids = bySeason.get(season) ?? new Set<number>();
          if (typeof episodeId === 'number') ids.add(episodeId);
          bySeason.set(season, ids);
        } else if (typeof episodeId === 'number') {
          episodeIds.add(episodeId);
        }
      }
      let issued = 0;
      for (const [season, ids] of bySeason) {
        if (ids.size === 1) {
          for (const id of ids) episodeIds.add(id);
        } else {
          await client.searchSeason(seriesId, season);
          issued++;
        }
      }
      if (episodeIds.size > 0) {
        await client.searchEpisode([...episodeIds]);
        issued++;
      }
      if (issued === 0) {
        return { reSearched: false, target: null };
      }
    } else {
      const client = await getRadarrClient(d.linked.instanceId);
      await client.searchMovie([d.linked.contentId]);
    }
    return {
      reSearched: true,
      target: { target: 'reSearch', instanceId: d.linked.instanceId, attempted: true, before: 'absent', after: 'present' },
    };
  } catch (error) {
    const errorMessage = formatError(error);
    return {
      reSearched: false,
      target: { target: 'reSearch', instanceId: d.linked.instanceId, attempted: true, before: 'absent', after: 'unknown', errorMessage },
    };
  }
}

export async function executeQueueCleanerRemoval(
  d: QueueDecision,
  triggeredBy: TriggeredBy,
  previewId?: string,
): Promise<QueueRemovalOutcome> {
  const hashLc = d.torrent.hash.toLowerCase();
  const links = d.linkedAll ?? (d.linked ? [d.linked] : []);
  // Fail closed on unknown privacy (older qBittorrent omits the field):
  // only a confirmed-public torrent may be deleted without deletePrivate.
  const shouldDeleteFromClient = isTorrentPrivate(d.torrent) === false || d.options.deletePrivate;
  const targets: CleanupItemOutcome['targets'] = [];

  if (links.length === 0 && !shouldDeleteFromClient) {
    const outcome: QueueRemovalOutcome = {
      kind: 'failure',
      status: 'skipped',
      action: 'skipped',
      filesDeleted: false,
      reSearched: false,
      message: 'Private torrent skipped because deletePrivate is disabled',
      errorMessage: 'No linked Arr queue item could be removed without deleting the private torrent',
      targets: [{ target: 'qbittorrent', attempted: false, before: 'present', after: 'present' }],
    };
    await writeQueueHistory(d, outcome, triggeredBy, previewId);
    return outcome;
  }

  let removedFromClientObserved = false;
  if (links.length > 0) {
    for (const link of links) {
      const removeFromClient = !d.options.changeCategory && shouldDeleteFromClient && !removedFromClientObserved;
      let callError: string | undefined;
      try {
        const client = link.source === 'sonarr'
          ? await getSonarrClient(link.instanceId)
          : await getRadarrClient(link.instanceId);
        await client.deleteQueueItem(link.queueItem.id, {
          removeFromClient,
          blocklist: !d.options.changeCategory && d.options.reSearch,
          changeCategory: d.options.changeCategory,
        });
      } catch (error) {
        callError = formatError(error);
      }

      if (removeFromClient) {
        const qbitState = await inspectQbit(d.torrent.hash);
        if (qbitState.state === 'absent') removedFromClientObserved = true;
        if (qbitState.errorMessage && !callError) callError = qbitState.errorMessage;
      }
      const after = await inspectQueueLink(link);
      targets.push({
        target: link.source,
        instanceId: link.instanceId,
        queueItemId: link.queueItem.id,
        attempted: true,
        before: 'present',
        after: after.state,
        ...((callError || after.errorMessage) ? { errorMessage: [callError, after.errorMessage].filter(Boolean).join('; ') } : {}),
      });
    }
  } else {
    let callError: string | undefined;
    try {
      const qbit = await getQBittorrentClient();
      await qbit.deleteTorrent(d.torrent.hash, true);
    } catch (error) {
      callError = formatError(error);
    }
    const after = await inspectQbit(d.torrent.hash);
    targets.push({
      target: 'qbittorrent',
      attempted: true,
      before: 'present',
      after: after.state,
      ...((callError || after.errorMessage) ? { errorMessage: [callError, after.errorMessage].filter(Boolean).join('; ') } : {}),
    });
  }

  const qbitAfter = await inspectQbit(d.torrent.hash);
  if (!targets.some((target) => target.target === 'qbittorrent')) {
    targets.push({
      target: 'qbittorrent',
      attempted: shouldDeleteFromClient && !d.options.changeCategory,
      before: 'present',
      after: qbitAfter.state,
      ...(qbitAfter.errorMessage ? { errorMessage: qbitAfter.errorMessage } : {}),
    });
  }
  const arrTargets = targets.filter((target) => target.target === 'sonarr' || target.target === 'radarr');
  const allArrAbsent = arrTargets.length > 0 && arrTargets.every((target) => target.after === 'absent');
  const anyArrAbsent = arrTargets.some((target) => target.after === 'absent');
  const anyUnknown = targets.some((target) => target.after === 'unknown');
  const targetErrors = targets.map((target) => target.errorMessage).filter((value): value is string => Boolean(value));

  let action: QueueRemovalOutcome['action'];
  let status: QueueRemovalOutcome['status'];
  if (d.options.changeCategory) {
    action = allArrAbsent ? 'categoryChanged' : anyArrAbsent ? 'categoryChanged' : 'failed';
    status = allArrAbsent && !anyUnknown ? 'succeeded' : anyArrAbsent || anyUnknown ? 'partial' : 'failed';
  } else if (shouldDeleteFromClient) {
    action = qbitAfter.state === 'absent' ? 'removedFromClient' : allArrAbsent ? 'removedFromQueue' : 'failed';
    const desired = qbitAfter.state === 'absent' && (arrTargets.length === 0 || allArrAbsent);
    status = desired && !anyUnknown ? 'succeeded' : qbitAfter.state === 'absent' || anyArrAbsent || anyUnknown ? 'partial' : 'failed';
  } else {
    action = allArrAbsent ? 'removedFromQueue' : anyArrAbsent ? 'removedFromQueue' : 'failed';
    status = allArrAbsent && !anyUnknown ? 'succeeded' : anyArrAbsent || anyUnknown ? 'partial' : 'failed';
  }

  let reSearched = false;
  if (action !== 'failed' && action !== 'categoryChanged') {
    const research = await triggerQueueResearch(d);
    reSearched = research.reSearched;
    if (research.target) {
      targets.push(research.target);
      if (research.target.errorMessage) {
        targetErrors.push(research.target.errorMessage);
        status = 'partial';
      }
    }
  }

  if (action !== 'failed') await prisma.cleanupStrike.deleteMany({ where: { hash: hashLc } });
  const filesDeleted = action === 'removedFromClient' && qbitAfter.state === 'absent' && shouldDeleteFromClient;
  const errorMessage = status === 'succeeded'
    ? null
    : targetErrors.join('; ') || 'Cleanup targets did not reach the intended state';
  const outcome: QueueRemovalOutcome = status === 'succeeded'
    ? {
        kind: 'success',
        status,
        action: action as 'removedFromClient' | 'removedFromQueue' | 'categoryChanged',
        filesDeleted,
        reSearched,
        message: 'Cleanup action reconciled successfully',
        errorMessage: null,
        targets,
      }
    : {
        kind: 'failure',
        status,
        action,
        filesDeleted,
        reSearched,
        message: status === 'partial' ? 'Cleanup action partially completed' : 'Cleanup action failed',
        errorMessage: errorMessage as string,
        targets,
      };
  await writeQueueHistory(d, outcome, triggeredBy, previewId);
  return outcome;
}

async function writeQueueHistory(
  d: QueueDecision,
  outcome: QueueRemovalOutcome,
  triggeredBy: TriggeredBy,
  previewId?: string,
): Promise<void> {
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
      action: outcome.action,
      filesDeleted: outcome.filesDeleted,
      reSearched: outcome.reSearched,
      linkedArrSource: d.linked?.source ?? null,
      linkedArrTitle: d.linked?.title ?? null,
      linkedArrItemId: d.linked?.queueItem.id ?? null,
      torrentSize: BigInt(Math.max(0, Math.floor(d.torrent.size))),
      torrentProgress: d.torrent.progress,
      torrentRatio: d.torrent.ratio,
      triggeredBy: triggeredBy === 'dryRun' ? 'manual' : triggeredBy,
      errorMessage: outcome.errorMessage,
      previewId: previewId ?? null,
      outcomeStatus: outcome.status,
      outcomeDetails: { message: outcome.message, targets: outcome.targets } as unknown as Prisma.InputJsonValue,
    },
  });
}
