import { prisma } from '@/lib/db';
import { logger } from '@/lib/logger';
import type { QBittorrentTorrent } from '@/types';
import { getQBittorrentClient } from '@/lib/service-helpers';
import { notifyEvent } from '@/lib/notification-service';
import {
  batchFetchTrackerDomains,
  buildSeedingReason,
  matchesIgnoredPatterns,
  matchesPrivacy,
  seedingHours,
  shortHash,
  torrentTags,
} from './helpers';
import {
  DownloadCleanerConfigShape,
  DownloadDecision,
  DownloadEvaluationResult,
  SeedingRuleShape,
  TriggeredBy,
} from './types';

const LOG = 'download-cleaner';
const SYSTEM_RULE_NAME = 'Auto-remove imported (system)';

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
      : ['sonarr', 'radarr'],
    autoRemoveImportedDeleteFiles: row.autoRemoveImportedDeleteFiles,
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
    },
    update: {
      enabled: input.enabled,
      intervalMinutes: input.intervalMinutes,
      ignoredDownloads: input.ignoredDownloads,
      autoRemoveImportedEnabled: input.autoRemoveImportedEnabled,
      autoRemoveImportedCategories: input.autoRemoveImportedCategories,
      autoRemoveImportedDeleteFiles: input.autoRemoveImportedDeleteFiles,
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
      privacyType: 'public',
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

export interface RunOptions {
  dryRun: boolean;
  triggeredBy: TriggeredBy;
}

export async function runDownloadCleanerCycle(opts: RunOptions): Promise<DownloadEvaluationResult> {
  const t0 = Date.now();
  const cfg = await loadDownloadCleanerConfig();
  if (!cfg.enabled && opts.triggeredBy === 'auto') {
    return { triggeredBy: opts.triggeredBy, dryRun: opts.dryRun, decisions: [], durationMs: 0 };
  }

  await syncSystemSeedingRule(cfg);

  let qbit;
  try {
    qbit = await getQBittorrentClient();
  } catch (err) {
    logger.warn('qBittorrent unavailable', { err: String(err) }, { scope: LOG });
    return { triggeredBy: opts.triggeredBy, dryRun: opts.dryRun, decisions: [], durationMs: 0 };
  }

  let torrents: QBittorrentTorrent[];
  try {
    torrents = await qbit.getTorrents();
  } catch (err) {
    logger.warn('qBittorrent listing failed', { err: String(err) }, { scope: LOG });
    return { triggeredBy: opts.triggeredBy, dryRun: opts.dryRun, decisions: [], durationMs: 0 };
  }

  const trackerDomains = await batchFetchTrackerDomains(qbit, torrents);
  const rules = (await loadSeedingRules()).filter((r) => r.enabled);

  const decisions: DownloadDecision[] = [];

  for (const t of torrents) {
    try {
      const hashLc = t.hash.toLowerCase();
      const domains = trackerDomains.get(hashLc) ?? [];
      if (matchesIgnoredPatterns(t, domains, cfg.ignoredDownloads)) continue;
      if (!isSeedingState(t)) continue;

      const tagsArr = torrentTags(t).map((s) => s.toLowerCase());
      const cat = (t.category || '').toLowerCase();
      const matched = rules.find((rule) => {
        if (rule.categories.length === 0) return false;
        if (!rule.categories.map((c) => c.toLowerCase()).includes(cat)) return false;
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

  if (!opts.dryRun) {
    for (const d of decisions) {
      try {
        await executeDownloadCleanerRemoval(d, opts.triggeredBy);
      } catch (err) {
        logger.error('Download cleaner removal failed', { hash: d.torrent.hash, err: String(err) }, { scope: LOG });
      }
    }
  }

  const durationMs = Date.now() - t0;
  logger.info('Download cleaner cycle done', {
    triggeredBy: opts.triggeredBy,
    dryRun: opts.dryRun,
    durationMs,
    decisions: decisions.length,
  }, { scope: LOG });

  return {
    triggeredBy: opts.triggeredBy,
    dryRun: opts.dryRun,
    decisions,
    durationMs,
  };
}

function isSeedingState(t: QBittorrentTorrent): boolean {
  if (t.progress < 1) return false;
  return (
    t.state === 'uploading' ||
    t.state === 'stalledUP' ||
    t.state === 'queuedUP' ||
    t.state === 'forcedUP' ||
    t.state === 'pausedUP' ||
    t.state === 'checkingUP'
  );
}

async function executeDownloadCleanerRemoval(d: DownloadDecision, triggeredBy: TriggeredBy): Promise<void> {
  const hashLc = d.torrent.hash.toLowerCase();
  try {
    const qbit = await getQBittorrentClient();
    await qbit.deleteTorrent(d.torrent.hash, d.rule.deleteSourceFiles);
  } catch (err) {
    logger.warn('qBit delete (download cleaner) failed', { err: String(err), hash: hashLc }, { scope: LOG });
  }

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
      filesDeleted: d.rule.deleteSourceFiles,
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

  try {
    await notifyEvent({
      eventType: 'cleanupRemoved',
      title: 'Cleanup: seeding torrent removed',
      body: `${d.torrent.name} — ${d.reason}`,
      metadata: {
        hash: hashLc,
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
}
