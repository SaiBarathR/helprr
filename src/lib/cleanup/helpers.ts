import type { QBittorrentTorrent, QueueItem } from '@/types';
import type { QBittorrentClient } from '@/lib/qbittorrent-client';
import type {
  LinkedArr,
  PatternMode,
  PrivacyType,
  SeedingRuleShape,
  SlowRuleShape,
  StallRuleShape,
} from './types';

export function torrentTags(t: QBittorrentTorrent): string[] {
  return (t.tags || '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export function isTorrentPrivate(t: QBittorrentTorrent): boolean {
  return Boolean(t.private);
}

export function matchesPrivacy(t: QBittorrentTorrent, type: PrivacyType): boolean {
  switch (type) {
    case 'public':
      return !isTorrentPrivate(t);
    case 'private':
      return isTorrentPrivate(t);
    case 'both':
    default:
      return true;
  }
}

export function inCompletionRange(
  percent: number,
  rule: { minCompletionPercentage: number; maxCompletionPercentage: number },
): boolean {
  const lower =
    rule.minCompletionPercentage === 0
      ? percent >= 0
      : percent > rule.minCompletionPercentage;
  const upper = percent <= rule.maxCompletionPercentage;
  return lower && upper;
}

export function matchesIgnoredPatterns(
  t: QBittorrentTorrent,
  trackerDomains: string[],
  patterns: string[],
): boolean {
  if (!patterns || patterns.length === 0) return false;
  const hash = t.hash.toLowerCase();
  const category = (t.category || '').toLowerCase();
  const tags = torrentTags(t).map((s) => s.toLowerCase());
  const trackers = trackerDomains.map((s) => s.toLowerCase());
  for (const raw of patterns) {
    const p = (raw || '').trim().toLowerCase();
    if (!p) continue;
    if (hash === p) return true;
    if (category === p) return true;
    if (tags.includes(p)) return true;
    if (trackers.some((dom) => dom === p || dom.endsWith(p))) return true;
  }
  return false;
}

export function matchesPatterns(
  messages: string[],
  patterns: string[],
  mode: PatternMode,
): boolean {
  const all = messages.map((m) => (m || '').toLowerCase());
  if (mode === 'include') {
    if (patterns.length === 0) return false;
    return patterns.some((p) => {
      const lc = p.toLowerCase();
      return all.some((m) => m.includes(lc));
    });
  }
  // exclude mode: match unless any message contains an excluded pattern
  return !patterns.some((p) => {
    const lc = p.toLowerCase();
    return all.some((m) => m.includes(lc));
  });
}

export function collectStatusMessages(item: QueueItem): string[] {
  const out: string[] = [];
  if (item.errorMessage) out.push(item.errorMessage);
  if (Array.isArray(item.statusMessages)) {
    for (const sm of item.statusMessages) {
      if (sm.title) out.push(sm.title);
      if (Array.isArray(sm.messages)) {
        for (const m of sm.messages) out.push(m);
      }
    }
  }
  return out;
}

export function progressedEnough(
  currentBytes: number,
  lastBytes: number | null | undefined,
  minBytes: number | null,
): boolean {
  const last = lastBytes ?? 0;
  const delta = currentBytes - last;
  if (delta <= 0) return false;
  if (minBytes == null || minBytes <= 0) return delta > 0;
  return delta >= minBytes;
}

export function hoursSinceAdded(t: QBittorrentTorrent): number {
  if (!t.added_on || t.added_on <= 0) return 0;
  return (Date.now() / 1000 - t.added_on) / 3600;
}

/**
 * Hours the torrent has actively been downloading/seeding, ignoring time
 * spent paused. Preferred over hoursSinceAdded for slow-rule age checks so
 * a torrent that was paused for a week doesn't get flagged the moment it
 * resumes. qBit exposes time_active in seconds; fall back to hoursSinceAdded
 * if the field is unavailable.
 */
export function activeHours(t: QBittorrentTorrent): number {
  if (typeof t.time_active === 'number' && t.time_active > 0) {
    return t.time_active / 3600;
  }
  return hoursSinceAdded(t);
}

export function seedingHours(t: QBittorrentTorrent): number {
  if (!t.completion_on || t.completion_on <= 0) return 0;
  return (Date.now() / 1000 - t.completion_on) / 3600;
}

export function shortHash(hash: string): string {
  return hash.slice(0, 8).toLowerCase();
}

export function trackerHostFromUrl(url: string): string | null {
  try {
    const u = new URL(url);
    return u.hostname.toLowerCase();
  } catch {
    return null;
  }
}

export async function batchFetchTrackerDomains(
  qbit: QBittorrentClient,
  torrents: QBittorrentTorrent[],
  concurrency: number = 6,
): Promise<Map<string, string[]>> {
  const map = new Map<string, string[]>();
  const queue = [...torrents];
  async function worker() {
    while (queue.length > 0) {
      const t = queue.shift();
      if (!t) return;
      try {
        const trackers = await qbit.getTorrentTrackers(t.hash);
        const domains: string[] = [];
        for (const tr of trackers) {
          const host = trackerHostFromUrl(tr.url);
          if (host && !domains.includes(host)) domains.push(host);
        }
        map.set(t.hash.toLowerCase(), domains);
      } catch {
        map.set(t.hash.toLowerCase(), []);
      }
    }
  }
  const workers = Array.from({ length: Math.min(concurrency, torrents.length) }, () => worker());
  await Promise.all(workers);
  return map;
}

export interface CorrelationIndex {
  byHash: Map<string, LinkedArr>;
  sonarrPresent: boolean;
  radarrPresent: boolean;
}

export function buildCorrelationIndex(
  sonarrQueue: QueueItem[] | null,
  radarrQueue: QueueItem[] | null,
): CorrelationIndex {
  const byHash = new Map<string, LinkedArr>();
  if (sonarrQueue) {
    for (const item of sonarrQueue) {
      const key = (item.downloadId || '').toLowerCase();
      if (!key) continue;
      byHash.set(key, {
        source: 'sonarr',
        queueItem: { ...item, source: 'sonarr' },
        contentId: item.seriesId ?? null,
        title: item.series?.title ?? item.title ?? '',
      });
    }
  }
  if (radarrQueue) {
    for (const item of radarrQueue) {
      const key = (item.downloadId || '').toLowerCase();
      if (!key) continue;
      if (byHash.has(key)) continue; // Sonarr wins on cross-seed
      byHash.set(key, {
        source: 'radarr',
        queueItem: { ...item, source: 'radarr' },
        contentId: item.movieId ?? null,
        title: item.movie?.title ?? item.title ?? '',
      });
    }
  }
  return {
    byHash,
    sonarrPresent: !!sonarrQueue,
    radarrPresent: !!radarrQueue,
  };
}

export function buildStallReason(
  rule: StallRuleShape,
  count: number,
): string {
  return `Stall rule '${rule.name}' — ${count}/${rule.maxStrikes} strikes`;
}

export function buildSlowReason(
  rule: SlowRuleShape,
  t: QBittorrentTorrent,
  count: number,
): string {
  const parts: string[] = [];
  if (rule.minSpeedKbps != null && t.dlspeed < rule.minSpeedKbps * 1024) {
    const kbps = Math.round(t.dlspeed / 1024);
    parts.push(`speed ${kbps}KB/s < ${rule.minSpeedKbps}KB/s`);
  }
  if (rule.maxTimeHours != null && rule.maxTimeHours > 0 && activeHours(t) > rule.maxTimeHours) {
    parts.push(`active ${activeHours(t).toFixed(1)}h > ${rule.maxTimeHours}h`);
  }
  const detail = parts.length > 0 ? ` (${parts.join('; ')})` : '';
  return `Slow rule '${rule.name}' — ${count}/${rule.maxStrikes} strikes${detail}`;
}

export function buildSeedingReason(
  rule: SeedingRuleShape,
  t: QBittorrentTorrent,
  seedingH: number,
): string {
  const parts: string[] = [];
  if (rule.maxRatio >= 0 && t.ratio >= rule.maxRatio) {
    parts.push(`ratio ${t.ratio.toFixed(2)} ≥ ${rule.maxRatio}`);
  }
  if (rule.maxSeedTimeHours >= 0 && seedingH >= rule.maxSeedTimeHours) {
    parts.push(`seeded ${seedingH.toFixed(1)}h ≥ ${rule.maxSeedTimeHours}h`);
  }
  if (rule.minSeedTimeHours > 0 && seedingH >= rule.minSeedTimeHours) {
    parts.push(`min seed ${seedingH.toFixed(1)}h ≥ ${rule.minSeedTimeHours}h`);
  }
  const detail = parts.length > 0 ? ` (${parts.join('; ')})` : '';
  return `Seeding rule '${rule.name}'${detail}`;
}

export function buildMetadataReason(count: number, max: number): string {
  return `Downloading-metadata strike — ${count}/${max}`;
}

export function buildFailedImportReason(count: number, max: number): string {
  return `Failed-import strike — ${count}/${max}`;
}

