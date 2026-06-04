import { getRedisClient } from '@/lib/redis';
import { logger } from '@/lib/logger';
import type { BadgeArea, BadgeSlice } from '@/types/badges';

// Single Redis hash; one field per (area, source) so the concurrent poll methods
// each write their own field without a read-modify-write race. The endpoint sums
// fields by area at read time. Notifications are NOT stored here — they're a
// per-user DB count computed in the endpoint.
const BADGE_HASH_KEY = 'helprr:badges';

// TTL well past the poll interval (default 30s) so a stopped poller or a removed
// service decays to nothing instead of showing a stale count forever. Refreshed
// on every write.
const BADGE_TTL_SECONDS = 600;

// Areas backed by the server poll (notifications is handled separately).
type ServiceBadgeArea = Extract<BadgeArea, 'activity' | 'downloads' | 'requests'>;
type BadgeSource = 'sonarr' | 'radarr' | 'lidarr' | 'qbittorrent' | 'seerr';

export type ServiceBadgeCounts = Record<ServiceBadgeArea, BadgeSlice>;

function isServiceArea(area: string): area is ServiceBadgeArea {
  return area === 'activity' || area === 'downloads' || area === 'requests';
}

/** Stash one service's slice for an area. Best-effort: Redis hiccups never break a poll. */
export async function writeBadgeSlice(
  area: ServiceBadgeArea,
  source: BadgeSource,
  slice: BadgeSlice,
): Promise<void> {
  try {
    const redis = await getRedisClient();
    await redis.hSet(BADGE_HASH_KEY, `${area}:${source}`, JSON.stringify(slice));
    await redis.expire(BADGE_HASH_KEY, BADGE_TTL_SECONDS);
  } catch (error) {
    logger.debug('Failed to write badge slice', { area, source, error }, { scope: 'badges' });
  }
}

/** Read + aggregate the service-derived badge counts. Returns zeros on any failure. */
export async function readServiceBadgeCounts(): Promise<ServiceBadgeCounts> {
  const acc: ServiceBadgeCounts = {
    activity: { total: 0, attention: 0 },
    downloads: { total: 0, attention: 0 },
    requests: { total: 0, attention: 0 },
  };

  try {
    const redis = await getRedisClient();
    const raw = await redis.hGetAll(BADGE_HASH_KEY);
    for (const [field, value] of Object.entries(raw)) {
      const area = field.split(':')[0];
      if (!isServiceArea(area)) continue;
      try {
        const slice = JSON.parse(value) as Partial<BadgeSlice>;
        acc[area].total += Number(slice.total) || 0;
        acc[area].attention += Number(slice.attention) || 0;
      } catch {
        // Skip a malformed field rather than failing the whole read.
      }
    }
  } catch (error) {
    logger.debug('Failed to read badge counts', { error }, { scope: 'badges' });
  }

  return acc;
}
