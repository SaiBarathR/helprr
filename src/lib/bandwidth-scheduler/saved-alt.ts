import { getRedisClient } from '@/lib/redis';

/** A qBittorrent's own alternative limits (bytes per second), as they were before a rule replaced them. */
export interface SavedAltLimits {
  alt_dl_limit: number;
  alt_up_limit: number;
}

// One hash, a field per qBittorrent instance. Kept in Redis, not just in
// memory: a restart while a rule holds the alternative limits would otherwise
// lose the only copy of the user's values. Outside helprr:cache:*, so a cache
// purge leaves it, and with no expiry: a field lives until it is put back.
const SAVED_ALT_KEY = 'helprr:qbt:bandwidth-saved-alt';

/** What a rule changed on one qBittorrent while it holds the alternative limits. */
export interface SavedBandwidth {
  savedAlt: SavedAltLimits;
  /** Whether the rule also wrote the regular limits (set back to unlimited on release). */
  wroteGlobal: boolean;
}

function parseSaved(raw: string): SavedBandwidth | null {
  try {
    const value = JSON.parse(raw) as Partial<SavedAltLimits> & { wroteGlobal?: unknown };
    if (Number.isFinite(value.alt_dl_limit) && Number.isFinite(value.alt_up_limit)) {
      return {
        savedAlt: { alt_dl_limit: value.alt_dl_limit!, alt_up_limit: value.alt_up_limit! },
        wroteGlobal: value.wroteGlobal === true,
      };
    }
  } catch {
    // Dropped below.
  }
  return null;
}

/** Every saved copy, by instance id. Throws when Redis can't answer. */
export async function loadSavedAltLimits(): Promise<Map<string, SavedBandwidth>> {
  const redis = await getRedisClient();
  const saved = new Map<string, SavedBandwidth>();
  for (const [instanceId, raw] of Object.entries(await redis.hGetAll(SAVED_ALT_KEY))) {
    const limits = parseSaved(raw);
    if (limits) saved.set(instanceId, limits);
  }
  return saved;
}

/** Throws when Redis can't keep it, so the caller leaves the limits alone. */
export async function saveAltLimits(instanceId: string, { savedAlt, wroteGlobal }: SavedBandwidth): Promise<void> {
  const redis = await getRedisClient();
  await redis.hSet(SAVED_ALT_KEY, instanceId, JSON.stringify({ ...savedAlt, wroteGlobal }));
}

export async function forgetAltLimits(instanceId: string): Promise<void> {
  const redis = await getRedisClient();
  await redis.hDel(SAVED_ALT_KEY, instanceId);
}
