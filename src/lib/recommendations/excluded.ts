import { prisma } from '@/lib/db';
import { getTMDBClient } from '@/lib/service-helpers';
import { loadCachedArrLibrary } from '@/lib/cache/arr-library';
import { getAnimeSummaries } from '@/lib/anilist-client';
import { invalidateRecommendations } from './engine';
import { anilistItemKey, arrItemKey, isItemKey, parseItemKey, type RecMediaType } from './item-keys';
import { forgetExcludedItems } from './profile-store';

// Titles the user hid with "Not interested" or a dislike. Both are permanent
// excludes (retention never prunes them), so this is the only way back: list
// them with enough to recognise each one, and let the user restore any.

const EXCLUDE_EVENT_TYPES = ['not_interested', 'dislike'] as const;
type ExcludeReason = (typeof EXCLUDE_EVENT_TYPES)[number];

/** Titles per page; each page costs up to this many TMDB lookups (cached). */
export const EXCLUDED_PAGE_SIZE = 50;
const TMDB_POSTER_BASE = 'https://image.tmdb.org/t/p/w342';
const TMDB_CONCURRENCY = 6;
const ANILIST_BATCH = 50;

export interface ExcludedTitle {
  itemKey: string;
  /** The most recent way the user hid it. */
  reason: ExcludeReason;
  excludedAt: string;
  mediaType: RecMediaType | null;
  /** null when the source no longer knows the title (or isn't reachable). */
  title: string | null;
  year: number | null;
  posterUrl: string | null;
  href: string | null;
}

interface ExcludedKey {
  itemKey: string;
  reason: ExcludeReason;
  excludedAt: Date;
}

/** One entry per excluded title, newest first. */
async function loadExcludedKeys(userId: string): Promise<ExcludedKey[]> {
  const rows = await prisma.recommendationEvent.groupBy({
    by: ['itemKey', 'eventType'],
    where: { userId, eventType: { in: [...EXCLUDE_EVENT_TYPES] } },
    _max: { createdAt: true },
  });
  const latest = new Map<string, ExcludedKey>();
  for (const row of rows) {
    const at = row._max.createdAt;
    if (!at) continue;
    const current = latest.get(row.itemKey);
    if (!current || at > current.excludedAt) {
      latest.set(row.itemKey, { itemKey: row.itemKey, reason: row.eventType as ExcludeReason, excludedAt: at });
    }
  }
  // Newest first; the key breaks ties so the order (and the cursor) is stable.
  return [...latest.values()].sort((a, b) =>
    b.excludedAt.getTime() - a.excludedAt.getTime() || (a.itemKey < b.itemKey ? -1 : a.itemKey > b.itemKey ? 1 : 0));
}

/** A page cursor names the last row shown, so restoring rows never shifts the next page. */
function cursorOf(key: ExcludedKey): string {
  return `${key.excludedAt.getTime()}:${key.itemKey}`;
}

export function parseExcludedCursor(cursor: string): { at: number; itemKey: string } | null {
  const split = cursor.indexOf(':');
  const at = Number(cursor.slice(0, split));
  const itemKey = cursor.slice(split + 1);
  if (split <= 0 || !Number.isSafeInteger(at) || !isItemKey(itemKey)) return null;
  return { at, itemKey };
}

export async function countExcludedTitles(userId: string): Promise<number> {
  const rows = await prisma.recommendationEvent.groupBy({
    by: ['itemKey'],
    where: { userId, eventType: { in: [...EXCLUDE_EVENT_TYPES] } },
  });
  return rows.length;
}

type Resolved = Pick<ExcludedTitle, 'title' | 'year' | 'posterUrl' | 'href'>;

function yearOf(date: string | null | undefined): number | null {
  const year = date ? Number(date.slice(0, 4)) : NaN;
  return Number.isFinite(year) && year > 0 ? year : null;
}

async function resolveTmdb(keys: string[]): Promise<Map<string, Resolved>> {
  const out = new Map<string, Resolved>();
  if (keys.length === 0) return out;
  let tmdb;
  try {
    tmdb = await getTMDBClient();
  } catch {
    return out;
  }
  let next = 0;
  const worker = async () => {
    while (next < keys.length) {
      const key = keys[next++];
      const parsed = parseItemKey(key);
      if (!parsed?.tmdbId) continue;
      try {
        if (parsed.mediaType === 'movie') {
          const movie = await tmdb.movieDetails(parsed.tmdbId);
          out.set(key, {
            title: movie.title ?? null,
            year: yearOf(movie.release_date),
            posterUrl: movie.poster_path ? `${TMDB_POSTER_BASE}${movie.poster_path}` : null,
            href: `/discover/movie/${parsed.tmdbId}`,
          });
        } else {
          const show = await tmdb.tvDetails(parsed.tmdbId);
          out.set(key, {
            title: show.name ?? null,
            year: yearOf(show.first_air_date),
            posterUrl: show.poster_path ? `${TMDB_POSTER_BASE}${show.poster_path}` : null,
            href: `/discover/tv/${parsed.tmdbId}`,
          });
        }
      } catch {
        // Unknown to TMDB now, or TMDB unreachable: the row shows without a title.
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(TMDB_CONCURRENCY, keys.length) }, worker));
  return out;
}

async function resolveAnilist(keys: string[]): Promise<Map<string, Resolved>> {
  const out = new Map<string, Resolved>();
  const ids = keys.map((key) => parseItemKey(key)?.anilistId).filter((id): id is number => Boolean(id));
  // One request per 50 ids, each failing on its own: a rate-limited batch
  // leaves only its own rows untitled.
  for (let start = 0; start < ids.length; start += ANILIST_BATCH) {
    try {
      for (const media of await getAnimeSummaries(ids.slice(start, start + ANILIST_BATCH))) {
        out.set(anilistItemKey(media.id), {
          title: media.title.english ?? media.title.romaji ?? media.title.native ?? null,
          year: media.seasonYear ?? null,
          posterUrl: media.coverImage?.extraLarge ?? media.coverImage?.large ?? null,
          href: `/anime/${media.id}`,
        });
      }
    } catch {
      // AniList unreachable or rate limited: this batch's rows show without a title.
    }
  }
  return out;
}

async function resolveArr(keys: string[]): Promise<Map<string, Resolved>> {
  const out = new Map<string, Resolved>();
  if (keys.length === 0) return out;
  const wanted = new Set(keys);
  try {
    const library = await loadCachedArrLibrary();
    const poster = (images: { coverType: string; remoteUrl?: string; url?: string }[] | undefined) => {
      const image = images?.find((i) => i.coverType === 'poster');
      return image?.remoteUrl || image?.url || null;
    };
    for (const movie of library.movies) {
      const key = arrItemKey('radarr', movie.instanceId, movie.id);
      if (wanted.has(key)) {
        out.set(key, { title: movie.title, year: movie.year || null, posterUrl: poster(movie.images), href: `/movies/${movie.id}?instance=${movie.instanceId}` });
      }
    }
    for (const series of library.series) {
      const key = arrItemKey('sonarr', series.instanceId, series.id);
      if (wanted.has(key)) {
        out.set(key, { title: series.title, year: series.year || null, posterUrl: poster(series.images), href: `/series/${series.id}?instance=${series.instanceId}` });
      }
    }
  } catch {
    // Library unavailable: these rows show without a title.
  }
  return out;
}

export interface ExcludedPage {
  total: number;
  items: ExcludedTitle[];
  /** Pass back as `cursor` for the next page; null on the last one. */
  nextCursor: string | null;
}

/**
 * One page of the user's excluded titles, newest first, with what each source
 * knows of them. `after` is a parsed cursor from the previous page.
 */
export async function listExcludedTitles(
  userId: string,
  after: { at: number; itemKey: string } | null = null,
): Promise<ExcludedPage> {
  const keys = await loadExcludedKeys(userId);
  let start = 0;
  if (after) {
    const next = keys.findIndex(({ excludedAt, itemKey }) =>
      excludedAt.getTime() < after.at || (excludedAt.getTime() === after.at && itemKey > after.itemKey));
    start = next === -1 ? keys.length : next;
  }
  const listed = keys.slice(start, start + EXCLUDED_PAGE_SIZE);
  const byPrefix = (prefix: string) => listed.map((k) => k.itemKey).filter((key) => key.startsWith(prefix));
  const [tmdb, anilist, arr] = await Promise.all([
    resolveTmdb(byPrefix('tmdb:')),
    resolveAnilist(byPrefix('anilist:')),
    resolveArr(byPrefix('arr:')),
  ]);

  const items = listed.map(({ itemKey, reason, excludedAt }): ExcludedTitle => {
    const resolved = tmdb.get(itemKey) ?? anilist.get(itemKey) ?? arr.get(itemKey);
    return {
      itemKey,
      reason,
      excludedAt: excludedAt.toISOString(),
      mediaType: parseItemKey(itemKey)?.mediaType ?? null,
      title: resolved?.title ?? null,
      year: resolved?.year ?? null,
      posterUrl: resolved?.posterUrl ?? null,
      href: resolved?.href ?? null,
    };
  });
  const last = listed.at(-1);
  const nextCursor = last && start + listed.length < keys.length ? cursorOf(last) : null;
  return { total: keys.length, items, nextCursor };
}

/**
 * Let a title back into recommendations: delete this user's own exclude
 * events for it and drop it from the stored profile's excludes in one
 * transaction (so a failure can't leave it hidden yet off the list), then
 * bust the rails cache so the next read recomposes. Returns how many events went.
 */
export async function restoreExcludedTitle(userId: string, itemKey: string): Promise<number> {
  const [{ count }] = await prisma.$transaction([
    prisma.recommendationEvent.deleteMany({
      where: { userId, itemKey, eventType: { in: [...EXCLUDE_EVENT_TYPES] } },
    }),
    forgetExcludedItems(userId, [itemKey]),
  ]);
  await invalidateRecommendations(userId);
  return count;
}
