import type { User } from '@prisma/client';
import { prisma } from '@/lib/db';
import { getJellyfinUserContext, isJellyfinUnavailable } from '@/lib/service-helpers';
import { escapeSqlLiteral } from '@/lib/jellyfin-playback-query';
import { loadAniListConnection } from '@/lib/anilist-oauth';
import { fetchMediaListCollection, type AniListMediaListEntry } from '@/lib/anilist-mutations';
import { getAnilistJsonWithCache } from '@/lib/cache/anilist-api-cache';
import type { JellyfinItem } from '@/types/jellyfin';
import { anilistItemKey, tmdbItemKey } from './item-keys';
import type {
  EngagedTitleSignal,
  EventSignals,
  PlaySignal,
  WatchlistSignal,
} from './build-profile';

// Signal collectors: everything the profile builder learns from, gathered
// per-user with the same fail-soft posture as the rest of the app — a missing
// power (no Jellyfin link, no Playback Reporting plugin, no AniList account)
// yields empty signals and a sources flag, never an error.

const RECENT_PLAYS_LIMIT = 300;
const PLAYBACK_REPORTING_DAYS = 90;
const PLAYBACK_REPORTING_ROW_LIMIT = 5000;
const EVENT_LOOKBACK_DAYS = 90;
const NEGATIVE_EVENT_LOOKBACK_DAYS = 180;

const ticksToMinutes = (ticks: number | undefined): number | null =>
  ticks && ticks > 0 ? Math.round(ticks / 600_000_000) : null;

// ─── Jellyfin: per-title engagement + recent plays ───────────────────────────

export interface JellyfinSignals {
  available: boolean;
  engagedTitles: EngagedTitleSignal[];
  /** Fallback play stream from LastPlayedDate (used when Playback Reporting is absent). */
  recentPlays: PlaySignal[];
  /** Per-user Playback Reporting rows, when the plugin is installed. */
  playbackReportingPlays: PlaySignal[];
  playbackReportingAvailable: boolean;
  /** Watch minutes by lowercase title (movies) / series name (episodes). */
  watchTimeMinByTitle: Map<string, number>;
}

function emptyJellyfinSignals(): JellyfinSignals {
  return {
    available: false,
    engagedTitles: [],
    recentPlays: [],
    playbackReportingPlays: [],
    playbackReportingAvailable: false,
    watchTimeMinByTitle: new Map(),
  };
}

function movieEngagement(item: JellyfinItem): EngagedTitleSignal | null {
  const ud = item.UserData;
  if (!ud) return null;
  const engaged = ud.Played || ud.PlayCount > 0 || ud.IsFavorite || (ud.PlayedPercentage ?? 0) > 5;
  if (!engaged) return null;
  const tmdbId = item.ProviderIds?.Tmdb ? Number(item.ProviderIds.Tmdb) : null;
  return {
    itemKey: tmdbId ? tmdbItemKey('movie', tmdbId) : `jf:${item.Id}`,
    mediaType: 'movie',
    tmdbId: tmdbId ?? undefined,
    title: item.Name,
    genres: item.Genres ?? [],
    year: item.ProductionYear ?? null,
    runtimeMin: ticksToMinutes(item.RunTimeTicks),
    playCount: ud.PlayCount ?? 0,
    lastPlayedAt: ud.LastPlayedDate ?? null,
    fullyWatched: ud.Played,
    favorite: ud.IsFavorite,
    ratingNorm: null,
  };
}

function seriesEngagement(item: JellyfinItem): EngagedTitleSignal | null {
  const ud = item.UserData;
  if (!ud) return null;
  const total = item.RecursiveItemCount ?? 0;
  const watchedEpisodes = Math.max(0, total - (ud.UnplayedItemCount ?? total));
  if (!ud.Played && watchedEpisodes === 0 && !ud.IsFavorite) return null;
  const tmdbId = item.ProviderIds?.Tmdb ? Number(item.ProviderIds.Tmdb) : null;
  return {
    itemKey: tmdbId ? tmdbItemKey('tv', tmdbId) : `jf:${item.Id}`,
    mediaType: 'tv',
    tmdbId: tmdbId ?? undefined,
    title: item.Name,
    genres: item.Genres ?? [],
    year: item.ProductionYear ?? null,
    runtimeMin: ticksToMinutes(item.RunTimeTicks),
    // Episodes watched is the closest "plays" analog for a series; the
    // builder's log2 cap keeps a 200-episode series from dominating.
    playCount: watchedEpisodes,
    lastPlayedAt: ud.LastPlayedDate ?? null,
    fullyWatched: ud.Played || (total > 0 && watchedEpisodes >= total),
    favorite: ud.IsFavorite,
    ratingNorm: null,
  };
}

async function collectPlaybackReporting(
  client: { submitCustomQuery: (sql: string) => Promise<{ columns: string[]; results: string[][] } | null> },
  jellyfinUserId: string,
  titleGenres: Map<string, string[]>
): Promise<Pick<JellyfinSignals, 'playbackReportingPlays' | 'playbackReportingAvailable' | 'watchTimeMinByTitle'>> {
  const since = new Date(Date.now() - PLAYBACK_REPORTING_DAYS * 86_400_000);
  const sinceStr = `${since.getFullYear()}-${String(since.getMonth() + 1).padStart(2, '0')}-${String(since.getDate()).padStart(2, '0')}`;
  const query = `
    SELECT DateCreated, ItemType, ItemName, COALESCE(PlayDuration, 0)
    FROM PlaybackActivity
    WHERE UserId = '${escapeSqlLiteral(jellyfinUserId)}'
      AND date(DateCreated) >= date('${escapeSqlLiteral(sinceStr)}')
    ORDER BY DateCreated DESC
    LIMIT ${PLAYBACK_REPORTING_ROW_LIMIT}
  `;
  const result = await client.submitCustomQuery(query).catch(() => null);
  if (!result || !Array.isArray(result.results)) {
    return { playbackReportingPlays: [], playbackReportingAvailable: false, watchTimeMinByTitle: new Map() };
  }

  const plays: PlaySignal[] = [];
  const watchTime = new Map<string, number>();
  for (const row of result.results) {
    if (!Array.isArray(row)) continue;
    const [dateCreated, itemType, itemName, playDuration] = row.map((v) => String(v ?? ''));
    if (!dateCreated) continue;
    // Episode rows are "Series Name - Episode Name"; the prefix matches the
    // series title we hold genres for. Movies match on the full name.
    const matchTitle = (itemType === 'Episode' ? itemName.split(' - ')[0] : itemName).trim().toLowerCase();
    const genres = titleGenres.get(matchTitle) ?? [];
    plays.push({ at: dateCreated, genres });
    const seconds = Number.parseFloat(playDuration) || 0;
    if (matchTitle && seconds > 0) {
      watchTime.set(matchTitle, (watchTime.get(matchTitle) ?? 0) + seconds / 60);
    }
  }
  return { playbackReportingPlays: plays, playbackReportingAvailable: true, watchTimeMinByTitle: watchTime };
}

export async function collectJellyfinSignals(
  user: Pick<User, 'role' | 'jellyfinUserId'>
): Promise<JellyfinSignals> {
  let context;
  try {
    context = await getJellyfinUserContext(user);
  } catch (error) {
    if (isJellyfinUnavailable(error)) return emptyJellyfinSignals();
    throw error;
  }
  const { client, jellyfinUserId } = context;

  const [moviesResult, seriesResult] = await Promise.all([
    client.queryItems({
      IncludeItemTypes: 'Movie',
      Recursive: true,
      Fields: 'ProviderIds,Genres',
      EnableUserData: true,
      EnableImages: false,
    }),
    client.queryItems({
      IncludeItemTypes: 'Series',
      Recursive: true,
      Fields: 'ProviderIds,Genres,RecursiveItemCount',
      EnableUserData: true,
      EnableImages: false,
    }),
  ]);
  const movies = moviesResult.Items ?? [];
  const series = seriesResult.Items ?? [];

  const engagedTitles: EngagedTitleSignal[] = [];
  for (const item of movies) {
    const signal = movieEngagement(item);
    if (signal) engagedTitles.push(signal);
  }
  for (const item of series) {
    const signal = seriesEngagement(item);
    if (signal) engagedTitles.push(signal);
  }

  // Genre lookup for Playback Reporting rows + recent-play episodes.
  const titleGenres = new Map<string, string[]>();
  const seriesById = new Map<string, JellyfinItem>();
  for (const item of [...movies, ...series]) {
    if (item.Genres?.length) titleGenres.set(item.Name.trim().toLowerCase(), item.Genres);
    if (item.Type === 'Series') seriesById.set(item.Id, item);
  }

  // Recent plays (LastPlayedDate fallback stream): episodes carry their
  // series' genres; movies their own.
  const recentPlays: PlaySignal[] = [];
  try {
    const recent = await client.queryItems({
      IncludeItemTypes: 'Episode,Movie',
      Recursive: true,
      Filters: 'IsPlayed',
      SortBy: 'DatePlayed',
      SortOrder: 'Descending',
      Limit: RECENT_PLAYS_LIMIT,
      Fields: 'Genres',
      EnableUserData: true,
      EnableImages: false,
    });
    for (const item of recent.Items ?? []) {
      const at = item.UserData?.LastPlayedDate;
      if (!at) continue;
      const genres = item.Genres?.length
        ? item.Genres
        : (item.SeriesId ? seriesById.get(item.SeriesId)?.Genres ?? [] : []);
      recentPlays.push({ at, genres });
    }
  } catch {
    // Fail-soft: moods degrade, engagement still works.
  }

  const reporting = await collectPlaybackReporting(client, jellyfinUserId, titleGenres);

  // Fold Playback Reporting watch time into the engagement signals by title.
  if (reporting.watchTimeMinByTitle.size > 0) {
    for (const signal of engagedTitles) {
      const minutes = reporting.watchTimeMinByTitle.get(signal.title.trim().toLowerCase());
      if (minutes) signal.watchTimeMin = Math.round(minutes);
    }
  }

  return {
    available: true,
    engagedTitles,
    recentPlays,
    ...reporting,
  };
}

// ─── AniList: per-user list scores ───────────────────────────────────────────

export interface AniListSignals {
  available: boolean;
  engagedTitles: EngagedTitleSignal[];
  /** PLANNING entries — intent, joins the watchlist signal. */
  planned: WatchlistSignal[];
  /** AniList media ids on the user's list (any status) — excluded from anime discovery. */
  listedAnilistIds: Set<number>;
}

function normalizeAniListScore(score: number, scoreFormat: string | null): number | null {
  if (!score || score <= 0) return null;
  switch (scoreFormat) {
    case 'POINT_100': return Math.min(1, score / 100);
    case 'POINT_10_DECIMAL':
    case 'POINT_10': return Math.min(1, score / 10);
    case 'POINT_5': return Math.min(1, score / 5);
    case 'POINT_3': return Math.min(1, score / 3);
    default:
      // Unknown format — infer from magnitude.
      if (score > 10) return Math.min(1, score / 100);
      if (score > 5) return Math.min(1, score / 10);
      return Math.min(1, score / 5);
  }
}

function fuzzyDateToIso(date: { year: number | null; month: number | null; day: number | null } | null): string | null {
  if (!date?.year) return null;
  return new Date(date.year, (date.month ?? 1) - 1, date.day ?? 1).toISOString();
}

function anilistEngagement(entry: AniListMediaListEntry, scoreFormat: string | null): EngagedTitleSignal {
  const title = entry.media.title.english ?? entry.media.title.romaji ?? entry.media.title.native ?? `AniList #${entry.media.id}`;
  const lastTouched = entry.updatedAt
    ? new Date(entry.updatedAt * 1000).toISOString()
    : fuzzyDateToIso(entry.completedAt) ?? fuzzyDateToIso(entry.startedAt);
  return {
    itemKey: anilistItemKey(entry.media.id),
    mediaType: 'anime',
    anilistId: entry.media.id,
    title,
    genres: entry.media.genres ?? [],
    year: entry.media.seasonYear ?? null,
    runtimeMin: null,
    playCount: entry.status === 'REPEATING' ? entry.repeat + 1 : entry.progress > 0 ? 1 : 0,
    lastPlayedAt: lastTouched,
    fullyWatched: entry.status === 'COMPLETED' || entry.status === 'REPEATING',
    favorite: false,
    ratingNorm: normalizeAniListScore(entry.score, scoreFormat),
  };
}

export async function collectAniListSignals(
  user: Pick<User, 'id' | 'role'>
): Promise<AniListSignals> {
  const empty: AniListSignals = { available: false, engagedTitles: [], planned: [], listedAnilistIds: new Set() };
  try {
    const link = await prisma.userAniListLink.findUnique({ where: { userId: user.id } });
    let anilistUserId = link?.anilistUserId ?? null;
    const scoreFormat = link?.scoreFormat ?? null;
    // Admins fall back to the operator account (mirrors the Jellyfin fallback).
    if (!anilistUserId && user.role === 'admin') {
      const conn = await loadAniListConnection();
      anilistUserId = conn?.anilistUserId ?? null;
    }
    if (!anilistUserId) return empty;

    const userId = anilistUserId;
    const collection = await getAnilistJsonWithCache({
      endpoint: 'mediaListCollection',
      params: { userId, type: 'ANIME', status: null },
      policy: { ttlSeconds: 30 * 60, staleSeconds: 2 * 60 * 60 },
      fetcher: () => fetchMediaListCollection({ userId, type: 'ANIME' }),
    });

    const engagedTitles: EngagedTitleSignal[] = [];
    const planned: WatchlistSignal[] = [];
    const listedAnilistIds = new Set<number>();
    for (const list of collection.lists ?? []) {
      for (const entry of list.entries ?? []) {
        listedAnilistIds.add(entry.media.id);
        if (entry.status === 'PLANNING') {
          planned.push({
            itemKey: anilistItemKey(entry.media.id),
            genres: entry.media.genres ?? [],
            addedAt: entry.updatedAt ? new Date(entry.updatedAt * 1000).toISOString() : new Date().toISOString(),
          });
          continue;
        }
        engagedTitles.push(anilistEngagement(entry, scoreFormat));
      }
    }
    return { available: true, engagedTitles, planned, listedAnilistIds };
  } catch {
    // Fail-soft: AniList down/rate-limited/unlinked must not sink the profile.
    return empty;
  }
}

// ─── Watchlist ───────────────────────────────────────────────────────────────

export interface WatchlistSignals {
  available: boolean;
  items: WatchlistSignal[];
  /** `${mediaType}:${tmdbId}`-style item keys for exclusion/boost in rails. */
  itemKeys: Set<string>;
}

export async function collectWatchlistSignals(userId: string): Promise<WatchlistSignals> {
  const rows = await prisma.watchlistItem.findMany({
    where: { userId },
    select: { source: true, externalId: true, mediaType: true, addedAt: true },
  });
  const items: WatchlistSignal[] = [];
  const itemKeys = new Set<string>();
  for (const row of rows) {
    let itemKey: string | null = null;
    const numericId = Number(row.externalId);
    if (row.source === 'TMDB' && Number.isFinite(numericId)) {
      itemKey = tmdbItemKey(row.mediaType === 'series' ? 'tv' : 'movie', numericId);
    } else if (row.source === 'ANILIST' && Number.isFinite(numericId)) {
      itemKey = anilistItemKey(numericId);
    }
    if (!itemKey) continue;
    itemKeys.add(itemKey);
    // Genres aren't stored on watchlist rows; the signal is intent-only.
    items.push({ itemKey, genres: [], addedAt: row.addedAt.toISOString() });
  }
  return { available: rows.length > 0, items, itemKeys };
}

// ─── Recommendation events ───────────────────────────────────────────────────

const POSITIVE_EVENT_TYPES = ['click', 'play', 'like', 'watchlist_add', 'request'] as const;
const NEGATIVE_EVENT_TYPES = ['dislike', 'not_interested'] as const;

function contextGenres(context: unknown): string[] | undefined {
  if (!context || typeof context !== 'object') return undefined;
  const genres = (context as { genres?: unknown }).genres;
  if (!Array.isArray(genres)) return undefined;
  const clean = genres.filter((g): g is string => typeof g === 'string').slice(0, 10);
  return clean.length ? clean : undefined;
}

export async function collectEventSignals(userId: string): Promise<EventSignals & { hasEvents: boolean }> {
  const now = Date.now();
  const positiveSince = new Date(now - EVENT_LOOKBACK_DAYS * 86_400_000);
  const negativeSince = new Date(now - NEGATIVE_EVENT_LOOKBACK_DAYS * 86_400_000);

  const [positives, negatives, excludedRows, likedRows, impressions] = await Promise.all([
    prisma.recommendationEvent.findMany({
      where: { userId, eventType: { in: [...POSITIVE_EVENT_TYPES] }, createdAt: { gte: positiveSince } },
      select: { itemKey: true, eventType: true, context: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
      take: 2000,
    }),
    prisma.recommendationEvent.findMany({
      where: { userId, eventType: { in: [...NEGATIVE_EVENT_TYPES] }, createdAt: { gte: negativeSince } },
      select: { itemKey: true, context: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
      take: 1000,
    }),
    // Hard excludes are all-time: "never show me this again" must not expire.
    // Row-capped so a pathological feedback history can't make rebuilds
    // unbounded; most-recent wins when the cap ever bites.
    prisma.recommendationEvent.findMany({
      where: { userId, eventType: { in: [...NEGATIVE_EVENT_TYPES] } },
      select: { itemKey: true },
      distinct: ['itemKey'],
      orderBy: { createdAt: 'desc' },
      take: 5000,
    }),
    prisma.recommendationEvent.findMany({
      where: { userId, eventType: 'like' },
      select: { itemKey: true },
      distinct: ['itemKey'],
      orderBy: { createdAt: 'desc' },
      take: 2000,
    }),
    prisma.recommendationEvent.findMany({
      where: { userId, eventType: 'impression', createdAt: { gte: positiveSince } },
      select: { itemKey: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
      take: 5000,
    }),
  ]);

  const positiveKeys = new Set(positives.map((e) => e.itemKey));
  const impressionsWithoutClick = impressions
    .filter((imp) => !positiveKeys.has(imp.itemKey))
    .map((imp) => ({ itemKey: imp.itemKey, at: imp.createdAt.toISOString() }));

  return {
    hasEvents: positives.length > 0 || negatives.length > 0 || impressions.length > 0,
    positives: positives.map((e) => ({
      itemKey: e.itemKey,
      genres: contextGenres(e.context),
      at: e.createdAt.toISOString(),
    })),
    negatives: negatives.map((e) => ({
      itemKey: e.itemKey,
      genres: contextGenres(e.context),
      at: e.createdAt.toISOString(),
    })),
    excludedItemKeys: excludedRows.map((e) => e.itemKey),
    likedItemKeys: likedRows.map((e) => e.itemKey),
    impressionsWithoutClick,
  };
}
