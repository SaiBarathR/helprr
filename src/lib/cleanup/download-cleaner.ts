import { prisma } from '@/lib/db';
import { logger } from '@/lib/logger';
import type { QBittorrentTorrent } from '@/types';
import type { SonarrClient } from '@/lib/sonarr-client';
import type { RadarrClient } from '@/lib/radarr-client';
import {
  getQBittorrentClient,
  getSonarrClients,
  getRadarrClients,
} from '@/lib/service-helpers';
import { notifyEvent } from '@/lib/notification-service';
import {
  batchFetchTrackerDomains,
  buildSeedingReason,
  confirmImportedViaHistory,
  formatError,
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
    // The system row is just a regular rule with requireImportedConfirmation
    // pre-set. maxRatio:0 + minSeedTimeHours:0 means the ratio/seedtime
    // predicate is trivially true, so once arr confirms the import the
    // torrent is removed immediately — historical behaviour.
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
      requireImportedConfirmation: true,
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
    requireImportedConfirmation: r.requireImportedConfirmation,
    isSystem: r.isSystem,
  }));
}

async function loadArrClients(): Promise<{ sonarr: SonarrClient[]; radarr: RadarrClient[] }> {
  const sonarr = (await getSonarrClients()).map((x) => x.client);
  const radarr = (await getRadarrClients()).map((x) => x.client);
  return { sonarr, radarr };
}

/**
 * Apply a seeding rule's ratio/seedtime predicate. Returns the decision and
 * audit reason when the torrent qualifies for removal, or null when the
 * predicate is not satisfied.
 *
 * Predicate: `(ratio met AND min seed time met) OR max seed time met`. The
 * system rule's defaults (maxRatio:0, minSeedTimeHours:0, maxSeedTimeHours:-1)
 * make the left clause trivially true once `requireImportedConfirmation`
 * confirms the import, preserving historical "delete on import" behaviour.
 */
function evaluatePredicate(t: QBittorrentTorrent, rule: SeedingRuleShape): DownloadDecision | null {
  const seedH = seedingHours(t);
  const ratioMet = rule.maxRatio >= 0 && t.ratio >= rule.maxRatio;
  const minTimeMet = rule.minSeedTimeHours <= 0 || seedH >= rule.minSeedTimeHours;
  const maxTimeMet = rule.maxSeedTimeHours >= 0 && seedH >= rule.maxSeedTimeHours;
  if (!((ratioMet && minTimeMet) || maxTimeMet)) return null;
  return {
    torrent: t,
    rule,
    reason: buildSeedingReason(rule, t, seedH),
    seedingHours: seedH,
    removalKind: 'seeding',
  };
}

export interface RunOptions {
  dryRun: boolean;
  triggeredBy: TriggeredBy;
}

export async function runDownloadCleanerCycle(opts: RunOptions): Promise<DownloadEvaluationResult> {
  const t0 = Date.now();
  const cfg = await loadDownloadCleanerConfig();
  // Honor the master enabled flag for both auto and manual runs; the UI keeps
  // the "Run now" button disabled while cfg.enabled is false, but a stale
  // client or curl call could still hit this path.
  if (!cfg.enabled) {
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
  // Torrents whose matched rule requires Sonarr/Radarr import confirmation
  // before the predicate runs. Resolved in a concurrent async pass below.
  const pendingConfirmation: { torrent: QBittorrentTorrent; rule: SeedingRuleShape }[] = [];

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

      // Two paths share the same predicate downstream. When the rule opts in
      // to import confirmation (`requireImportedConfirmation: true`, includes
      // the auto-managed system row), defer to the async pass; otherwise
      // evaluate the ratio/seedtime predicate synchronously now.
      if (matched.requireImportedConfirmation) {
        pendingConfirmation.push({ torrent: t, rule: matched });
        continue;
      }

      const decision = evaluatePredicate(t, matched);
      if (decision) decisions.push(decision);
    } catch (err) {
      logger.warn('Download cleaner torrent eval failed', { hash: t.hash, err: String(err) }, { scope: LOG });
    }
  }

  // Async pass: confirm import per torrent, then run the same ratio/seedtime
  // predicate. `unreachable` results are surfaced as `skipped` history rows
  // so an arr outage isn't silent; `unconfirmed` (arr reachable but no
  // imported event yet) is the common case — stay quiet.
  let skippedUnreachable = 0;
  if (pendingConfirmation.length > 0) {
    const arrs = await loadArrClients();
    await processWithLimit(pendingConfirmation, CLEANUP_CONCURRENCY, async ({ torrent: t, rule }) => {
      try {
        const confirmation = await confirmImportedViaHistory(t.hash, arrs);
        if (confirmation.status === 'imported') {
          const decision = evaluatePredicate(t, rule);
          if (decision) {
            decisions.push({
              ...decision,
              reason: `${decision.reason} — imported (${confirmation.source} ${confirmation.eventType})`,
              removalKind: 'imported',
            });
          }
          return;
        }
        if (confirmation.status === 'unreachable') {
          skippedUnreachable++;
          const hashLc = t.hash.toLowerCase();
          await prisma.cleanupHistory.create({
            data: {
              cleaner: 'download',
              strikeType: null,
              ruleId: rule.id,
              ruleName: rule.name,
              hash: hashLc,
              shortHash: shortHash(hashLc),
              torrentName: t.name,
              reason: 'Sonarr/Radarr unreachable — import unconfirmed',
              action: 'skipped',
              filesDeleted: false,
              reSearched: false,
              linkedArrSource: null,
              linkedArrTitle: null,
              linkedArrItemId: null,
              torrentSize: BigInt(Math.max(0, Math.floor(t.size))),
              torrentProgress: t.progress,
              torrentRatio: t.ratio,
              triggeredBy: opts.triggeredBy === 'dryRun' ? 'manual' : opts.triggeredBy,
            },
          });
        }
        // status === 'unconfirmed' → silent skip; common case
      } catch (err) {
        logger.warn(
          'Import confirmation failed',
          { hash: t.hash, err: String(err) },
          { scope: LOG },
        );
      }
    });
  }

  if (skippedUnreachable > 0) {
    try {
      await notifyEvent({
        eventType: 'cleanupFailed',
        title: 'Cleanup: arr unreachable',
        body: `${skippedUnreachable} torrent${skippedUnreachable === 1 ? '' : 's'} skipped — could not reach Sonarr/Radarr to confirm import. See History → Skipped.`,
        metadata: { cleaner: 'download', skippedUnreachable },
        url: '/cleanup',
      });
    } catch (err) {
      logger.warn('cleanupFailed (unreachable) notify failed', { err: String(err) }, { scope: LOG });
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
    if (succeededCount >= 1) {
      const successes = successDecisions.map((s) => s.decision);
      const importedCount = successes.filter((d) => d.removalKind === 'imported').length;
      const { title, body } = buildRemovalNotification(successes, failedCount);
      try {
        await notifyEvent({
          eventType: 'cleanupRemoved',
          title,
          body,
          metadata: succeededCount === 1
            ? {
                hash: successes[0].torrent.hash.toLowerCase(),
                cleaner: 'download',
                cleanupRuleName: successes[0].rule.name,
                cleanupReason: successes[0].reason,
                cleanupAction: 'removedFromClient',
                removalKind: successes[0].removalKind,
              }
            : {
                cleaner: 'download',
                succeeded: succeededCount,
                failed: failedCount,
                imported: importedCount,
                seeding: succeededCount - importedCount,
              },
          url: '/cleanup',
        });
      } catch (err) {
        logger.warn('cleanupRemoved (download) notify failed', { err: String(err) }, { scope: LOG });
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

function namesPreview(names: string[], max = 3): string {
  return names.length <= max
    ? names.join(', ')
    : `${names.slice(0, max).join(', ')} +${names.length - max} more`;
}

// Build the cleanupRemoved notification title/body from the torrents that were
// actually removed this cycle. The title states the dominant reason (imported
// vs seeding-limit) so the user isn't told "seeding torrents removed" when the
// real reason was a confirmed Sonarr/Radarr import; the body lists names.
function buildRemovalNotification(
  successes: DownloadDecision[],
  failedCount: number,
): { title: string; body: string } {
  const imported = successes.filter((d) => d.removalKind === 'imported');
  const seeding = successes.filter((d) => d.removalKind === 'seeding');
  const n = successes.length;
  const failTail = failedCount > 0 ? ` (${failedCount} failed)` : '';

  if (n === 1) {
    const d = successes[0];
    return d.removalKind === 'imported'
      ? { title: 'Cleanup: download removed after import', body: d.torrent.name }
      : { title: 'Cleanup: seeding torrent removed', body: `${d.torrent.name} — ${d.reason}` };
  }
  if (seeding.length === 0) {
    return {
      title: `Cleanup: ${n} downloads removed after import`,
      body: `${namesPreview(imported.map((d) => d.torrent.name))}${failTail}`,
    };
  }
  if (imported.length === 0) {
    return {
      title: `Cleanup: ${n} seeding torrents removed`,
      body: `${namesPreview(seeding.map((d) => d.torrent.name))}${failTail}`,
    };
  }
  return {
    title: `Cleanup: ${n} torrents removed`,
    body: `${imported.length} after import, ${seeding.length} seeding — ${namesPreview(successes.map((d) => d.torrent.name))}${failTail}`,
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
