import type { SeerrClient, SeerrMediaDetail } from '@/lib/seerr-client';
import type { SeerrRequest } from '@/types/seerr';

const DETAIL_CACHE_TTL_MS = 10 * 60 * 1000;
const DETAIL_CACHE_MAX = 500;
const detailCache = new Map<string, { value: SeerrMediaDetail | null; at: number }>();

export async function getCachedSeerrMediaDetail(
  client: SeerrClient,
  mediaType: 'movie' | 'tv',
  tmdbId: number
): Promise<SeerrMediaDetail | null> {
  const key = `${mediaType}:${tmdbId}`;
  const hit = detailCache.get(key);
  if (hit && Date.now() - hit.at < DETAIL_CACHE_TTL_MS) return hit.value;
  try {
    const detail = await client.getMediaDetail(mediaType, tmdbId);
    detailCache.delete(key);
    detailCache.set(key, { value: detail, at: Date.now() });
    while (detailCache.size > DETAIL_CACHE_MAX) {
      const oldest = detailCache.keys().next().value;
      if (oldest === undefined) break;
      detailCache.delete(oldest);
    }
    return detail;
  } catch {
    detailCache.set(key, { value: null, at: Date.now() });
    return null;
  }
}

const TITLE_MAX = 60;

function truncate(s: string, max = TITLE_MAX): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max - 1)}…`;
}

function formatSeasonList(seasons: SeerrRequest['seasons']): string | null {
  if (!seasons || seasons.length === 0) return null;
  const nums = seasons
    .map((s) => s.seasonNumber)
    .filter((n): n is number => typeof n === 'number')
    .sort((a, b) => a - b);
  if (nums.length === 0) return null;
  return nums.map((n) => `S${String(n).padStart(2, '0')}`).join(', ');
}

/**
 * Produce the human-readable media phrase used in Seerr push notification
 * bodies. Falls back to the legacy generic label when TMDB metadata is
 * unavailable so notifications still fire on outage.
 */
export function formatSeerrMediaLabel(
  req: Pick<SeerrRequest, 'type' | 'seasons'>,
  detail: SeerrMediaDetail | null | undefined
): string {
  const name = detail?.title || detail?.name;
  if (!name) return req.type === 'tv' ? 'TV series' : 'movie';

  if (req.type === 'movie') {
    const year = detail?.releaseDate
      ? Number.parseInt(detail.releaseDate.slice(0, 4), 10) || null
      : null;
    return truncate(year ? `${name} (${year})` : name);
  }

  const seasonsLabel = formatSeasonList(req.seasons);
  return truncate(seasonsLabel ? `${name} · ${seasonsLabel}` : name);
}
