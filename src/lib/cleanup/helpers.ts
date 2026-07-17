import type { QBittorrentTorrent, QueueItem } from '@/types';
import type { QBittorrentClient } from '@/lib/qbittorrent-client';
import type { SonarrClient } from '@/lib/sonarr-client';
import type { RadarrClient } from '@/lib/radarr-client';
import type {
  LinkedArr,
  PatternMode,
  PrivacyType,
  SeedingRuleShape,
  SlowRuleShape,
  StallRuleShape,
} from './types';

// Sonarr/Radarr v3 history eventType strings that represent a *successful*
// import. We require one of these (matched by downloadId == torrent hash) before
// the "Auto-remove imported" system rule will delete a torrent.
export const IMPORTED_HISTORY_EVENT_TYPES = new Set<string>([
  'downloadFolderImported',
  'episodeFileImported',
  'movieFileImported',
]);

// trackedDownloadState values that mean arr has finalized the import and the
// torrent files are safe to remove from the client. Anything else (importing,
// importPending, importBlocked, downloadFailed, importFailed, etc.) means arr
// is still working on it or has flagged a problem — do NOT delete from those
// states.
const IMPORTED_QUEUE_STATES = new Set<string>(['imported']);

export function isImportedQueueState(state: string | undefined | null): boolean {
  if (!state) return false;
  return IMPORTED_QUEUE_STATES.has(state);
}

export function torrentTags(t: QBittorrentTorrent): string[] {
  return (t.tags || '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/**
 * Tri-state privacy: qBittorrent only exposes `private` on 5.0+; on older
 * versions the field is absent. Destructive decisions must fail closed on
 * `null` (unknown), never assume public.
 */
export function isTorrentPrivate(t: QBittorrentTorrent): boolean | null {
  return typeof t.private === 'boolean' ? t.private : null;
}

export function matchesPrivacy(t: QBittorrentTorrent, type: PrivacyType): boolean {
  const priv = isTorrentPrivate(t);
  switch (type) {
    case 'public':
      return priv === false;
    case 'private':
      return priv === true;
    case 'both':
    default:
      return true;
  }
}

export function inCompletionRange(
  percent: number,
  rule: { minCompletionPercentage: number; maxCompletionPercentage: number },
): boolean {
  // Lower bound is asymmetric on purpose: when min=0 we include zero-progress
  // torrents (`>= 0`), but a non-zero min is strictly-greater so the boundary
  // value itself doesn't match. Upper bound is inclusive.
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
    if (trackers.some((dom) => matchesTrackerDomain(dom, p))) return true;
  }
  return false;
}

/**
 * Suffix-match a tracker hostname against a user pattern with a dot boundary:
 * "example.org" matches "example.org" and "tracker.example.org" but NOT
 * "notexample.org". A leading dot on the pattern is tolerated.
 */
export function matchesTrackerDomain(domain: string, pattern: string): boolean {
  const p = pattern.toLowerCase().replace(/^\.+/, '');
  if (!p) return false;
  const dom = domain.toLowerCase();
  return dom === p || dom.endsWith(`.${p}`);
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
  // A present numeric value is authoritative — 0 means "not active yet", not
  // "unknown". Falling back on 0 would count paused wall-clock age as active
  // time, contradicting the UI's "pause time is excluded".
  if (typeof t.time_active === 'number') {
    return Math.max(0, t.time_active) / 3600;
  }
  return hoursSinceAdded(t);
}

export function seedingHours(t: QBittorrentTorrent): number {
  // Prefer qBittorrent's actual seeding_time (seconds spent seeding); a
  // torrent stopped right after completion has seeding_time 0 and must not
  // satisfy "seeded ≥ N hours" just because it completed long ago.
  if (typeof t.seeding_time === 'number') {
    return Math.max(0, t.seeding_time) / 3600;
  }
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

/**
 * Fetch tracker hostnames per torrent. A failed lookup stores `null` (NOT an
 * empty list): tracker domains feed ignore-list and tracker-pattern matching,
 * and substituting [] would silently disable a protection the user configured.
 * Callers must fail closed (skip the torrent) when domains are null and any
 * tracker-based pattern is in play.
 */
export async function batchFetchTrackerDomains(
  qbit: QBittorrentClient,
  torrents: QBittorrentTorrent[],
  concurrency: number = 6,
): Promise<Map<string, string[] | null>> {
  const map = new Map<string, string[] | null>();
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
        map.set(t.hash.toLowerCase(), null);
      }
    }
  }
  const workers = Array.from({ length: Math.min(concurrency, torrents.length) }, () => worker());
  await Promise.all(workers);
  return map;
}

export interface CorrelationIndex {
  // A hash can appear in multiple instances (cross-seed, or an HD + a 4K instance
  // both grabbing the same release), so each maps to a list of links.
  byHash: Map<string, LinkedArr[]>;
  sonarrPresent: boolean;
  radarrPresent: boolean;
}

export function buildCorrelationIndex(
  sonarr: Array<{ instanceId: string; instanceLabel: string; queue: QueueItem[] }>,
  radarr: Array<{ instanceId: string; instanceLabel: string; queue: QueueItem[] }>,
): CorrelationIndex {
  const byHash = new Map<string, LinkedArr[]>();
  const add = (link: LinkedArr) => {
    const key = (link.queueItem.downloadId || '').toLowerCase();
    if (!key) return;
    const arr = byHash.get(key) ?? [];
    arr.push(link);
    byHash.set(key, arr);
  };
  for (const inst of sonarr) {
    for (const item of inst.queue) {
      add({
        source: 'sonarr',
        instanceId: inst.instanceId,
        instanceLabel: inst.instanceLabel,
        queueItem: { ...item, source: 'sonarr' },
        contentId: item.seriesId ?? null,
        title: item.series?.title ?? item.title ?? '',
      });
    }
  }
  for (const inst of radarr) {
    for (const item of inst.queue) {
      add({
        source: 'radarr',
        instanceId: inst.instanceId,
        instanceLabel: inst.instanceLabel,
        queueItem: { ...item, source: 'radarr' },
        contentId: item.movieId ?? null,
        title: item.movie?.title ?? item.title ?? '',
      });
    }
  }
  return {
    byHash,
    sonarrPresent: sonarr.length > 0,
    radarrPresent: radarr.length > 0,
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

export function formatError(err: unknown): string {
  if (err instanceof Error) return err.message || err.name;
  if (typeof err === 'string') return err;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

export type ImportConfirmationSource = 'sonarr' | 'radarr';

// Clock-skew allowance between qBittorrent (added_on) and arr history dates.
const IMPORT_EVENT_SKEW_SECONDS = 300;

export type ImportConfirmation =
  | { status: 'imported'; source: ImportConfirmationSource; eventType: string }
  | { status: 'unconfirmed' } // at least one arr was reachable and reported no import
  | { status: 'unreachable' }; // no arrs configured, or every configured arr threw

/**
 * Query Sonarr+Radarr history for any successful-import event whose
 * downloadId matches the given torrent hash.
 *
 * Sonarr/Radarr's qBittorrent download client persists History.DownloadId as
 * torrent.Hash.ToUpper(); the /api/v3/history filter is a case-sensitive SQL
 * equality, so we must send uppercase even though qBit returns lowercase.
 *
 * Returns:
 *  - `imported` if any arr's history shows a successful-import event.
 *  - `unconfirmed` if at least one arr was reachable and returned no hit
 *    (common case — torrent just hasn't been imported yet).
 *  - `unreachable` if no arr is configured, or every configured arr threw.
 *
 * Callers distinguish the latter two so an arr outage can be surfaced
 * (`unreachable`) while routine "not imported yet" silence stays quiet.
 *
 * `addedOnEpochSeconds` (torrent added_on) guards against stale history: a
 * re-grab of the same infohash still has the months-old import event under
 * this downloadId, and treating it as confirmation would delete the torrent
 * while the CURRENT grab is mid-import. Only events dated at/after the
 * torrent was added count (5-minute skew allowance between qBit and arr).
 */
export async function confirmImportedViaHistory(
  hash: string,
  arrs: { sonarr: SonarrClient[]; radarr: RadarrClient[] },
  addedOnEpochSeconds?: number,
): Promise<ImportConfirmation> {
  const downloadId = hash.toUpperCase();
  const minEventEpochMs =
    typeof addedOnEpochSeconds === 'number' && addedOnEpochSeconds > 0
      ? (addedOnEpochSeconds - IMPORT_EVENT_SKEW_SECONDS) * 1000
      : null;
  let anyReachable = false;
  let anyConfigured = false;

  // Imported if ANY instance of either type confirms it. Tag each client with
  // its source up front so we don't have to recover it from the client object.
  const tagged: Array<{ source: ImportConfirmationSource; client: SonarrClient | RadarrClient }> = [
    ...arrs.sonarr.map((client) => ({ source: 'sonarr' as const, client })),
    ...arrs.radarr.map((client) => ({ source: 'radarr' as const, client })),
  ];
  for (const { source, client } of tagged) {
    anyConfigured = true;
    try {
      const res = await client.getHistory(1, 50, 'date', 'descending', { downloadId });
      anyReachable = true;
      const hit = (res.records || []).find((r) => {
        if (!IMPORTED_HISTORY_EVENT_TYPES.has(r.eventType)) return false;
        if (minEventEpochMs === null) return true;
        const eventMs = Date.parse(r.date);
        // Unparseable dates fail closed — better to wait a cycle than to
        // delete on a confirmation we cannot time-order.
        return Number.isFinite(eventMs) && eventMs >= minEventEpochMs;
      });
      if (hit) {
        return { status: 'imported', source, eventType: hit.eventType };
      }
    } catch {
      // unreachable for this instance
    }
  }
  if (!anyConfigured || !anyReachable) return { status: 'unreachable' };
  return { status: 'unconfirmed' };
}

