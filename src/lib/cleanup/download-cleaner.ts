import { prisma } from '@/lib/db';
import type { Prisma } from '@prisma/client';
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
  matchesTrackerDomain,
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
  CleanupExecutionBinding,
  CleanupItemOutcome,
} from './types';

const VALID_PRIVACY_TYPES: PrivacyType[] = ['public', 'private', 'both'];
import { processWithLimit } from './concurrency';
import { resetFailureNotify, shouldNotifyFailure } from './notify-throttle';
import {
  assertExecutionBinding,
  buildExecutionBinding,
  cleanupScopeFingerprint,
  downloadCandidateBinding,
  downloadConfigFingerprint,
} from './binding';

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
  expectedBinding?: CleanupExecutionBinding;
  previewId?: string;
}

export async function runDownloadCleanerCycle(opts: RunOptions): Promise<DownloadEvaluationResult> {
  const t0 = Date.now();
  const [cfg, scopeFingerprint] = await Promise.all([
    loadDownloadCleanerConfig(),
    cleanupScopeFingerprint(),
  ]);
  // Honor the master enabled flag for both auto and manual runs; the UI keeps
  // the "Run now" button disabled while cfg.enabled is false, but a stale
  // client or curl call could still hit this path.
  if (!cfg.enabled) {
    const rules = await loadSeedingRules();
    const binding = buildExecutionBinding('download', downloadConfigFingerprint(cfg, rules), scopeFingerprint, []);
    if (opts.expectedBinding) assertExecutionBinding(opts.expectedBinding, binding);
    return { triggeredBy: opts.triggeredBy, dryRun: opts.dryRun, decisions: [], durationMs: 0, succeeded: 0, failed: 0, outcomes: [], binding, warnings: ['Download Cleaner is disabled'] };
  }

  await syncSystemSeedingRule(cfg);
  const rules = (await loadSeedingRules()).filter((r) => r.enabled);
  const configFingerprint = downloadConfigFingerprint(cfg, rules);
  const noCandidatesBinding = buildExecutionBinding('download', configFingerprint, scopeFingerprint, []);

  let qbit;
  try {
    qbit = await getQBittorrentClient();
  } catch (err) {
    logger.warn('qBittorrent unavailable', { err: String(err) }, { scope: LOG });
    if (opts.expectedBinding) assertExecutionBinding(opts.expectedBinding, noCandidatesBinding);
    return { triggeredBy: opts.triggeredBy, dryRun: opts.dryRun, decisions: [], durationMs: 0, succeeded: 0, failed: 0, outcomes: [], binding: noCandidatesBinding, warnings: ['qBittorrent is unavailable — nothing was evaluated'] };
  }

  let torrents: QBittorrentTorrent[];
  try {
    torrents = await qbit.getTorrents();
  } catch (err) {
    logger.warn('qBittorrent listing failed', { err: String(err) }, { scope: LOG });
    if (opts.expectedBinding) assertExecutionBinding(opts.expectedBinding, noCandidatesBinding);
    return { triggeredBy: opts.triggeredBy, dryRun: opts.dryRun, decisions: [], durationMs: 0, succeeded: 0, failed: 0, outcomes: [], binding: noCandidatesBinding, warnings: ['qBittorrent torrent listing failed — nothing was evaluated'] };
  }

  const trackerDomains = await batchFetchTrackerDomains(qbit, torrents);
  const decisions: DownloadDecision[] = [];
  const warnings: string[] = [];
  // Tracker data is load-bearing when the ignore list or any enabled rule
  // matches on trackers; a torrent whose lookup failed must then be skipped
  // (fail closed) rather than evaluated against incomplete data.
  const trackerDataRequired = cfg.ignoredDownloads.length > 0
    || rules.some((rule) => rule.trackerPatterns.length > 0);
  let skippedTrackerUnknown = 0;
  // Torrents whose matched rule requires Sonarr/Radarr import confirmation
  // before the predicate runs. Resolved in a concurrent async pass below.
  const pendingConfirmation: { torrent: QBittorrentTorrent; rule: SeedingRuleShape }[] = [];

  for (const t of torrents) {
    try {
      const hashLc = t.hash.toLowerCase();
      const fetchedDomains = trackerDomains.get(hashLc) ?? null;
      if (fetchedDomains === null && trackerDataRequired) {
        skippedTrackerUnknown++;
        continue;
      }
      const domains = fetchedDomains ?? [];
      if (matchesIgnoredPatterns(t, domains, cfg.ignoredDownloads)) continue;
      if (!isSeedingState(t)) continue;

      const matched = matchSeedingRule(t, domains, rules);

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
        const confirmation = await confirmImportedViaHistory(t.hash, arrs, t.added_on);
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
    warnings.push(`${skippedUnreachable} torrent${skippedUnreachable === 1 ? '' : 's'} skipped — Sonarr/Radarr unreachable, import unconfirmed`);
    if (shouldNotifyFailure('download')) {
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
  }
  if (skippedTrackerUnknown > 0) {
    warnings.push(`${skippedTrackerUnknown} torrent${skippedTrackerUnknown === 1 ? '' : 's'} skipped: tracker data could not be read while tracker-based matching is configured`);
  }

  const binding = buildExecutionBinding(
    'download',
    configFingerprint,
    scopeFingerprint,
    decisions.map(downloadCandidateBinding),
  );
  if (opts.expectedBinding) assertExecutionBinding(opts.expectedBinding, binding);

  let succeededCount = 0;
  let failedCount = 0;
  const outcomes: CleanupItemOutcome[] = [];
  const successDecisions: { decision: DownloadDecision; outcome: Extract<DownloadRemovalOutcome, { kind: 'success' }> }[] = [];
  const failureDecisions: { decision: DownloadDecision; errorMessage: string }[] = [];

  if (opts.dryRun) {
    // Auto-scheduler dry-run: persist a preview row per decision so the user
    // can review what would have been removed via the History tab. Unlike the
    // queue cleaner (whose strike-clear naturally spaces preview rows), the
    // same seeding torrent re-qualifies every cycle — dedupe to one row per
    // hash+rule per 24h so dry-run mode doesn't flood history.
    if (opts.triggeredBy === 'auto' && decisions.length > 0) {
      const dedupeSince = new Date(Date.now() - 24 * 60 * 60 * 1000);
      for (const d of decisions) {
        const hashLc = d.torrent.hash.toLowerCase();
        const recent = await prisma.cleanupHistory.findFirst({
          where: {
            cleaner: 'download',
            action: 'dryRunPreview',
            hash: hashLc,
            ruleId: d.rule.id,
            createdAt: { gte: dedupeSince },
          },
          select: { id: true },
        });
        if (recent) continue;
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
        const revalidation = await revalidateDownloadDecision(d, configFingerprint, scopeFingerprint);
        const outcome = revalidation.ok
          ? await executeDownloadCleanerRemoval(revalidation.decision, opts.triggeredBy, opts.previewId)
          : await recordDownloadRevalidationOutcome(d, revalidation, opts.triggeredBy, opts.previewId);
        if (outcome.kind === 'success') {
          succeededCount++;
          successDecisions.push({ decision: d, outcome });
          outcomes.push(toDownloadItemOutcome(d, outcome));
        } else {
          failedCount++;
          failureDecisions.push({ decision: d, errorMessage: outcome.errorMessage });
          outcomes.push(toDownloadItemOutcome(d, outcome));
        }
      } catch (err) {
        const errorMessage = formatError(err);
        logger.error('Download cleaner removal threw unexpectedly', { hash: d.torrent.hash, err: errorMessage }, { scope: LOG });
        failedCount++;
        failureDecisions.push({ decision: d, errorMessage });
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

    if (failedCount === 0 && succeededCount > 0) resetFailureNotify('download');
    if (failedCount > 0 && shouldNotifyFailure('download')) {
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
    outcomes,
    binding,
    warnings,
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
  | {
      kind: 'success';
      status: 'succeeded';
      action: 'removedFromClient';
      filesDeleted: boolean;
      message: string;
      errorMessage: null;
      targets: CleanupItemOutcome['targets'];
    }
  | {
      kind: 'failure';
      status: 'partial' | 'failed' | 'stale';
      action: 'failed' | 'skipped';
      filesDeleted: false;
      message: string;
      errorMessage: string;
      targets: CleanupItemOutcome['targets'];
    };

function toDownloadItemOutcome(d: DownloadDecision, outcome: DownloadRemovalOutcome): CleanupItemOutcome {
  return {
    hash: d.torrent.hash.toLowerCase(),
    torrentName: d.torrent.name,
    status: outcome.status,
    action: outcome.action,
    filesDeleted: outcome.filesDeleted,
    reSearched: false,
    message: outcome.message,
    errorMessage: outcome.errorMessage,
    targets: outcome.targets,
  };
}

function matchSeedingRule(
  torrent: QBittorrentTorrent,
  domains: string[],
  rules: SeedingRuleShape[],
): SeedingRuleShape | null {
  const tags = torrentTags(torrent).map((tag) => tag.toLowerCase());
  const category = (torrent.category || '').toLowerCase();
  return rules.find((rule) => {
    if (rule.categories.length > 0 && !rule.categories.map((value) => value.toLowerCase()).includes(category)) return false;
    if (
      rule.trackerPatterns.length > 0
      && !rule.trackerPatterns.some((pattern) =>
        domains.some((domain) => matchesTrackerDomain(domain, pattern)))
    ) return false;
    if (rule.tagsAny.length > 0 && !rule.tagsAny.some((tag) => tags.includes(tag.toLowerCase()))) return false;
    if (rule.tagsAll.length > 0 && !rule.tagsAll.every((tag) => tags.includes(tag.toLowerCase()))) return false;
    return matchesPrivacy(torrent, rule.privacyType);
  }) ?? null;
}

type DownloadRevalidation =
  | { ok: true; decision: DownloadDecision }
  | { ok: false; status: 'stale' | 'failed'; message: string; errorMessage: string };

async function revalidateDownloadDecision(
  expected: DownloadDecision,
  expectedConfigFingerprint: string,
  expectedScopeFingerprint: string,
): Promise<DownloadRevalidation> {
  try {
    const [config, scopeFingerprint] = await Promise.all([
      loadDownloadCleanerConfig(),
      cleanupScopeFingerprint(),
    ]);
    const rules = (await loadSeedingRules()).filter((rule) => rule.enabled);
    if (
      !config.enabled
      || downloadConfigFingerprint(config, rules) !== expectedConfigFingerprint
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
    const trackerDataRequired = config.ignoredDownloads.length > 0
      || rules.some((candidate) => candidate.trackerPatterns.length > 0);
    if (fetchedDomains === null && trackerDataRequired) {
      return { ok: false, status: 'failed', message: 'Could not read tracker data to re-check tracker-based matching', errorMessage: 'Tracker lookup failed during revalidation' };
    }
    const domains = fetchedDomains ?? [];
    if (matchesIgnoredPatterns(torrent, domains, config.ignoredDownloads) || !isSeedingState(torrent)) {
      return { ok: false, status: 'stale', message: 'Torrent no longer matches cleanup state', errorMessage: 'Torrent state changed after preview' };
    }
    const rule = matchSeedingRule(torrent, domains, rules);
    if (!rule || rule.id !== expected.rule.id) {
      return { ok: false, status: 'stale', message: 'Torrent no longer matches the reviewed rule', errorMessage: 'Rule match changed after preview' };
    }

    let decision = evaluatePredicate(torrent, rule);
    if (!decision) {
      return { ok: false, status: 'stale', message: 'Torrent no longer meets the reviewed threshold', errorMessage: 'Cleanup threshold changed after preview' };
    }
    if (rule.requireImportedConfirmation) {
      const confirmation = await confirmImportedViaHistory(torrent.hash, await loadArrClients(), torrent.added_on);
      if (confirmation.status !== 'imported') {
        return { ok: false, status: 'stale', message: 'Import confirmation is no longer available', errorMessage: 'Import confirmation changed after preview' };
      }
      decision = {
        ...decision,
        reason: `${decision.reason} — imported (${confirmation.source} ${confirmation.eventType})`,
        removalKind: 'imported',
      };
    }
    if (downloadCandidateBinding(decision).removalKind !== downloadCandidateBinding(expected).removalKind) {
      return { ok: false, status: 'stale', message: 'Cleanup action changed after preview', errorMessage: 'Removal mode changed after preview' };
    }
    return { ok: true, decision };
  } catch (error) {
    const errorMessage = formatError(error);
    return { ok: false, status: 'failed', message: 'Could not revalidate the torrent safely', errorMessage };
  }
}

async function recordDownloadRevalidationOutcome(
  decision: DownloadDecision,
  revalidation: Extract<DownloadRevalidation, { ok: false }>,
  triggeredBy: TriggeredBy,
  previewId?: string,
): Promise<DownloadRemovalOutcome> {
  const outcome: DownloadRemovalOutcome = {
    kind: 'failure',
    status: revalidation.status,
    action: revalidation.status === 'stale' ? 'skipped' : 'failed',
    filesDeleted: false,
    message: revalidation.message,
    errorMessage: revalidation.errorMessage,
    targets: [{ target: 'qbittorrent', attempted: false, before: 'unknown', after: 'unknown', errorMessage: revalidation.errorMessage }],
  };
  await writeDownloadHistory(decision, outcome, triggeredBy, previewId);
  return outcome;
}

export async function executeDownloadCleanerRemoval(
  d: DownloadDecision,
  triggeredBy: TriggeredBy,
  previewId?: string,
): Promise<DownloadRemovalOutcome> {
  const hashLc = d.torrent.hash.toLowerCase();
  const intendedFilesDeleted = d.rule.deleteSourceFiles;
  let deleteError: string | null = null;
  let qbit;
  try {
    qbit = await getQBittorrentClient();
    await qbit.deleteTorrent(d.torrent.hash, intendedFilesDeleted);
  } catch (err) {
    deleteError = formatError(err);
    logger.error('qBit delete (download cleaner) returned an error; reconciling state', { err: deleteError, hash: hashLc }, { scope: LOG });
  }

  let after: 'present' | 'absent' | 'unknown' = 'unknown';
  let inspectError: string | undefined;
  try {
    qbit ??= await getQBittorrentClient();
    const remaining = await qbit.getTorrents(undefined, undefined, undefined, undefined, d.torrent.hash);
    after = remaining.length === 0 ? 'absent' : 'present';
  } catch (error) {
    inspectError = formatError(error);
  }

  let outcome: DownloadRemovalOutcome;
  if (after === 'absent') {
    outcome = {
      kind: 'success',
      status: 'succeeded',
      action: 'removedFromClient',
      filesDeleted: intendedFilesDeleted,
      message: deleteError ? 'Torrent removal confirmed after an upstream error' : 'Torrent removal confirmed',
      errorMessage: null,
      targets: [{ target: 'qbittorrent', attempted: true, before: 'present', after, ...(deleteError ? { errorMessage: deleteError } : {}) }],
    };
    await prisma.cleanupStrike.deleteMany({ where: { hash: hashLc } });
  } else if (after === 'present') {
    const errorMessage = deleteError ?? 'qBittorrent still reports the torrent after deletion';
    outcome = {
      kind: 'failure',
      status: 'failed',
      action: 'failed',
      filesDeleted: false,
      message: 'Torrent was not removed',
      errorMessage,
      targets: [{ target: 'qbittorrent', attempted: true, before: 'present', after, errorMessage }],
    };
  } else {
    const errorMessage = [deleteError, inspectError].filter(Boolean).join('; ') || 'Could not verify qBittorrent state';
    outcome = {
      kind: 'failure',
      status: 'partial',
      action: 'failed',
      filesDeleted: false,
      message: 'Deletion result could not be verified',
      errorMessage,
      targets: [{ target: 'qbittorrent', attempted: true, before: 'present', after, errorMessage }],
    };
  }

  await writeDownloadHistory(d, outcome, triggeredBy, previewId);
  return outcome;
}

async function writeDownloadHistory(
  d: DownloadDecision,
  outcome: DownloadRemovalOutcome,
  triggeredBy: TriggeredBy,
  previewId?: string,
): Promise<void> {
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
      action: outcome.action,
      filesDeleted: outcome.filesDeleted,
      reSearched: false,
      linkedArrSource: null,
      linkedArrTitle: null,
      linkedArrItemId: null,
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
