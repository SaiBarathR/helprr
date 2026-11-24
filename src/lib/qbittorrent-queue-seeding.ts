// QBT-25: qBittorrent's torrent queueing and global seeding limits, the only
// preferences Helprr reads and writes besides the speed limits. Shared by the
// client, the route and the settings page; no server imports.
//
// app/setPreferences also changes the Web UI password, the program run on
// completion (code execution on the qBittorrent host) and everything else, so
// these keys are an allow-list: a write names only them, and the route refuses
// a body with any other key rather than dropping it.

export const QUEUEING_KEYS = [
  'queueing_enabled',
  'max_active_downloads',
  'max_active_uploads',
  'max_active_torrents',
  'dont_count_slow_torrents',
] as const;

export const SEEDING_KEYS = [
  'max_ratio_enabled',
  'max_ratio',
  'max_seeding_time_enabled',
  'max_seeding_time',
  'max_inactive_seeding_time_enabled',
  'max_inactive_seeding_time',
  'max_ratio_act',
] as const;

export const QUEUE_SEEDING_KEYS = [...QUEUEING_KEYS, ...SEEDING_KEYS] as const;
export type QueueSeedingKey = (typeof QUEUE_SEEDING_KEYS)[number];

export interface QueueSeedingPreferences {
  queueing_enabled: boolean;
  /** -1 is no limit. */
  max_active_downloads: number;
  max_active_uploads: number;
  max_active_torrents: number;
  dont_count_slow_torrents: boolean;
  max_ratio_enabled: boolean;
  /** qBittorrent reports -1 while the limit is off. */
  max_ratio: number;
  max_seeding_time_enabled: boolean;
  /** Minutes; -1 while off. */
  max_seeding_time: number;
  max_inactive_seeding_time_enabled: boolean;
  /** Minutes; -1 while off. */
  max_inactive_seeding_time: number;
  max_ratio_act: ShareLimitAction;
}

export type QueueSeedingPatch = Partial<QueueSeedingPreferences>;

/** What qBittorrent does to a torrent that reaches a global seeding limit (its ShareLimitAction). */
export type ShareLimitAction = 0 | 1 | 2 | 3;
export const SHARE_LIMIT_ACTIONS: { value: ShareLimitAction; label: string }[] = [
  { value: 0, label: 'Stop torrent' },
  { value: 1, label: 'Remove torrent' },
  { value: 3, label: 'Remove torrent and its files' },
  { value: 2, label: 'Enable super seeding' },
];

const BOOLEAN_KEYS = new Set<QueueSeedingKey>([
  'queueing_enabled', 'dont_count_slow_torrents',
  'max_ratio_enabled', 'max_seeding_time_enabled', 'max_inactive_seeding_time_enabled',
]);

// Upper bounds as qBittorrent's own Web UI has them (ratio 9998, a year of
// minutes); the active counts have none there, so a generous one.
export const MAX_ACTIVE_LIMIT = 100_000;
export const MAX_SEEDING_RATIO = 9998;
export const MAX_SEEDING_MINUTES = 525_600;

const INT_RANGES: Partial<Record<QueueSeedingKey, [number, number]>> = {
  max_active_downloads: [-1, MAX_ACTIVE_LIMIT],
  max_active_uploads: [-1, MAX_ACTIVE_LIMIT],
  max_active_torrents: [-1, MAX_ACTIVE_LIMIT],
  max_seeding_time: [0, MAX_SEEDING_MINUTES],
  max_inactive_seeding_time: [0, MAX_SEEDING_MINUTES],
};

// qBittorrent reads each limit's value only under its switch, and a value left
// out reads as 0: turning a limit on without its value would set it to 0, which
// (with "remove torrent and its files") acts on every seeding torrent at once.
// So a value goes only with its switch turned on, and turning one on needs it.
const LIMIT_PAIRS: [QueueSeedingKey, QueueSeedingKey][] = [
  ['max_ratio_enabled', 'max_ratio'],
  ['max_seeding_time_enabled', 'max_seeding_time'],
  ['max_inactive_seeding_time_enabled', 'max_inactive_seeding_time'],
];

const KEY_SET: ReadonlySet<string> = new Set(QUEUE_SEEDING_KEYS);

/**
 * A request body checked against the allow-list: every key known, every value
 * of its type and range, limits paired with their switches. Any other key is
 * an error, never forwarded.
 */
export function parseQueueSeedingPatch(body: unknown): { ok: true; patch: QueueSeedingPatch } | { ok: false; error: string } {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { ok: false, error: 'Expected a JSON object' };
  const entries = Object.entries(body as Record<string, unknown>);
  if (entries.length === 0) return { ok: false, error: 'Nothing to change' };
  const patch: Record<string, unknown> = {};
  for (const [key, value] of entries) {
    if (!KEY_SET.has(key)) return { ok: false, error: `${key} cannot be changed here` };
    const name = key as QueueSeedingKey;
    if (BOOLEAN_KEYS.has(name)) {
      if (typeof value !== 'boolean') return { ok: false, error: `${key} must be true or false` };
    } else if (name === 'max_ratio') {
      if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > MAX_SEEDING_RATIO) {
        return { ok: false, error: `max_ratio must be a number from 0 to ${MAX_SEEDING_RATIO}` };
      }
    } else if (name === 'max_ratio_act') {
      if (!SHARE_LIMIT_ACTIONS.some((action) => action.value === value)) {
        return { ok: false, error: 'max_ratio_act must be 0, 1, 2 or 3' };
      }
    } else {
      const [min, max] = INT_RANGES[name]!;
      if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
        return { ok: false, error: `${key} must be a whole number from ${min} to ${max}` };
      }
    }
    patch[key] = name === 'max_ratio' ? Math.round((value as number) * 100) / 100 : value;
  }
  for (const [toggle, limit] of LIMIT_PAIRS) {
    if (patch[toggle] === true && patch[limit] === undefined) return { ok: false, error: `${toggle} needs ${limit}` };
    if (patch[limit] !== undefined && patch[toggle] !== true) return { ok: false, error: `${limit} goes with ${toggle}: true` };
  }
  return { ok: true, patch: patch as QueueSeedingPatch };
}

/**
 * The allow-listed keys copied out of qBittorrent's preferences one by one
 * (the rest carries the Web UI and proxy passwords), or null when one is
 * missing or of the wrong type.
 */
export function pickQueueSeeding(preferences: Record<string, unknown>): QueueSeedingPreferences | null {
  const out: Record<string, unknown> = {};
  for (const key of QUEUE_SEEDING_KEYS) {
    const value = preferences[key];
    const valid = BOOLEAN_KEYS.has(key) ? typeof value === 'boolean' : typeof value === 'number' && Number.isFinite(value);
    if (!valid) return null;
    out[key] = value;
  }
  return out as unknown as QueueSeedingPreferences;
}
