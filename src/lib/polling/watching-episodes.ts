// "New episode" alerts: when Sonarr imports an episode of a series someone
// played in Jellyfin within their window (UserSettings.watchingEpisodeDays,
// default 14, 0 = off), that person gets their own copy. Plays come from
// Jellyfin's own per-user play state (UserData.LastPlayedDate), which every
// server keeps, so the Playback Reporting plugin is not needed. Series match by
// TVDB id, then TMDB id, so it is the same whichever instance imported it. Each
// episode is claimed per person (AnnouncedEpisode) before sending, shared with
// "Now in your library", so it is announced once.
import crypto from 'crypto';
import type { User } from '@prisma/client';
import { prisma } from '@/lib/db';
import { can } from '@/lib/permissions';
import { logger } from '@/lib/logger';
import { noteJobFailure } from '@/lib/polling-job-report';
import { getMediaHrefFromIds } from '@/lib/media-href';
import { GROUP_THRESHOLD } from '@/lib/notification-grouping';
import { WATCHING_EPISODE_DAYS_DEFAULT, WATCHING_EPISODE_DAY_OPTIONS } from '@/lib/notification-events';
import { getJellyfinUserContext, isJellyfinUnavailable } from '@/lib/service-helpers';
import { getWatchStatusJson } from '@/lib/cache/jellyfin-watch-status-cache';
import { stableStringify } from '@/lib/cache/keys';
import type { JellyfinClient } from '@/lib/jellyfin-client';
import { notifyAndLog } from './shared';
import { claimEpisodes, episodeKey, type EpisodeRef, type LibraryArrival } from './watchlist-available';

const DAY_MS = 86_400_000;
// Plays are read newest first, a page at a time, until they are older than the
// longest window anyone can pick.
const PLAYS_PAGE_SIZE = 200;
const PLAYS_MAX_PAGES = 5;
const LONGEST_WINDOW_DAYS = Math.max(...WATCHING_EPISODE_DAY_OPTIONS);
// The whole batch's share of the Sonarr poll: past it, the rest are skipped.
export const WATCHING_BATCH_BUDGET_MS = 20_000;
// Series ids per lookup, keeping the request line well under 8 KB.
const SERIES_IDS_PER_QUERY = 100;
const ITEM_CAP = 50;

export interface PlayedSeries {
  tvdbId?: string;
  tmdbId?: string;
  /** Epoch ms of the person's latest play of any episode. */
  lastPlayed: number;
}

/** The series a Jellyfin user played within the longest window, with their provider ids. */
export async function fetchPlayedSeries(client: JellyfinClient): Promise<PlayedSeries[]> {
  const since = Date.now() - LONGEST_WINDOW_DAYS * DAY_MS;
  const lastPlayedBySeries = new Map<string, number>();
  // Played episodes sort first (newest play first); never-played ones follow
  // with no LastPlayedDate, which ends the read.
  for (let page = 0; page < PLAYS_MAX_PAGES; page++) {
    const plays = await client.queryItems({
      IncludeItemTypes: 'Episode',
      Recursive: true,
      SortBy: 'DatePlayed',
      SortOrder: 'Descending',
      StartIndex: page * PLAYS_PAGE_SIZE,
      Limit: PLAYS_PAGE_SIZE,
      EnableUserData: true,
      EnableImages: false,
      // Jellyfin would otherwise count the whole episode library on every page.
      EnableTotalRecordCount: false,
    });
    const items = plays.Items ?? [];
    let reachedEnd = items.length < PLAYS_PAGE_SIZE;
    for (const item of items) {
      const at = Date.parse(item.UserData?.LastPlayedDate ?? '');
      if (!Number.isFinite(at) || at < since) {
        reachedEnd = true;
        break;
      }
      if (item.SeriesId && (lastPlayedBySeries.get(item.SeriesId) ?? 0) < at) lastPlayedBySeries.set(item.SeriesId, at);
    }
    if (reachedEnd) break;
  }
  const ids = [...lastPlayedBySeries.keys()];
  const series = [];
  for (let i = 0; i < ids.length; i += SERIES_IDS_PER_QUERY) {
    const chunk = await client.queryItems({
      Ids: ids.slice(i, i + SERIES_IDS_PER_QUERY).join(','),
      Fields: 'ProviderIds',
      EnableUserData: false,
      EnableImages: false,
    });
    series.push(...(chunk.Items ?? []));
  }
  return series.flatMap((item) => {
    const lastPlayed = lastPlayedBySeries.get(item.Id);
    const tvdbId = item.ProviderIds?.Tvdb;
    const tmdbId = item.ProviderIds?.Tmdb;
    if (!lastPlayed || (!tvdbId && !tmdbId)) return [];
    return [{ ...(tvdbId ? { tvdbId } : {}), ...(tmdbId ? { tmdbId } : {}), lastPlayed }];
  });
}

/** TVDB id when both sides have one, otherwise TMDB id. */
export function isSameSeries(arrival: Pick<LibraryArrival, 'tvdbId' | 'tmdbId'>, played: PlayedSeries): boolean {
  if (arrival.tvdbId && played.tvdbId) return played.tvdbId === String(arrival.tvdbId);
  return Boolean(arrival.tmdbId && played.tmdbId === String(arrival.tmdbId));
}

export function playedWithin(
  arrival: Pick<LibraryArrival, 'tvdbId' | 'tmdbId'>,
  played: PlayedSeries[],
  days: number,
  now: number,
): boolean {
  const since = now - days * DAY_MS;
  return played.some((series) => series.lastPlayed >= since && isSameSeries(arrival, series));
}

// Cached per person for the watch-status TTL (10 min), so a season pack or two
// instances importing in one cycle read Jellyfin once.
async function loadPlayedSeries(user: Pick<User, 'role' | 'jellyfinUserId'>): Promise<PlayedSeries[]> {
  const { client, connectionFingerprint, jellyfinUserId } = await getJellyfinUserContext(user);
  const seed = stableStringify({ scope: 'played-series', connectionFingerprint, jellyfinUserId });
  return getWatchStatusJson(seed, () => fetchPlayedSeries(client));
}

function findWatchers() {
  return prisma.user.findMany({
    where: {
      status: 'active',
      jellyfinUserId: { not: null },
      OR: [{ settings: { is: null } }, { settings: { is: { watchingEpisodeDays: { gt: 0 } } } }],
    },
    select: {
      id: true,
      role: true,
      status: true,
      template: true,
      permissions: true,
      jellyfinUserId: true,
      settings: { select: { watchingEpisodeDays: true } },
    },
  });
}

interface NewEpisode {
  arrival: LibraryArrival;
  ep: EpisodeRef;
}

function episodeName(ep: EpisodeRef): string {
  return ep.title ? `${ep.label} · ${ep.title}` : ep.label;
}

function episodeHref({ arrival, ep }: NewEpisode): string {
  return getMediaHrefFromIds({
    seriesId: arrival.arrId,
    seasonNumber: ep.seasonNumber,
    episodeId: ep.episodeId,
    instanceId: arrival.instanceId,
  }) ?? `/series/${arrival.arrId}`;
}

async function sendOne(userId: string, episode: NewEpisode) {
  const { arrival, ep } = episode;
  const url = episodeHref(episode);
  await notifyAndLog({
    eventType: 'watchingNewEpisode',
    title: `New episode: ${arrival.title} ${episodeName(ep)}`.slice(0, 200),
    body: "From a show you're watching: ready to watch.",
    url,
    userIds: [userId],
    ownerUserId: userId,
    metadata: {
      source: 'sonarr',
      instanceId: arrival.instanceId,
      seriesId: arrival.arrId,
      seasonNumber: ep.seasonNumber,
      episodeId: ep.episodeId,
      mediaType: 'series',
      redirect: url,
    },
  }, { service: 'sonarr', instanceId: arrival.instanceId, reason: 'watching-new-episode' });
}

// Many new episodes in one poll (a season pack, or several shows at once) → one
// push, listing them the way grouped notifications do.
async function sendGroup(userId: string, episodes: NewEpisode[]) {
  const first = episodes[0].arrival;
  const oneSeries = episodes.every((e) => e.arrival.arrId === first.arrId);
  const seasons = new Set(episodes.map((e) => e.ep.seasonNumber));
  const url = oneSeries
    ? getMediaHrefFromIds({
        seriesId: first.arrId,
        seasonNumber: seasons.size === 1 ? episodes[0].ep.seasonNumber : undefined,
        instanceId: first.instanceId,
      }) ?? `/series/${first.arrId}`
    : '/notifications';
  const label = (e: NewEpisode) => (oneSeries ? e.ep.label : `${e.arrival.title} ${e.ep.label}`);
  const shown = episodes.slice(0, 3).map(label).join(' · ');
  const more = episodes.length > 3 ? ` · …and ${episodes.length - 3} more` : '';
  // Tags the push so it doesn't replace another group on the device.
  const tagId = crypto.createHash('sha256')
    .update(episodes.map((e) => episodeKey(e.arrival, e.ep.label)).join(','))
    .digest('hex').slice(0, 16);
  await notifyAndLog({
    eventType: 'watchingNewEpisode',
    title: (oneSeries ? `${episodes.length} new episodes: ${first.title}` : `${episodes.length} new episodes`).slice(0, 200),
    body: `${shown}${more}`,
    url,
    userIds: [userId],
    ownerUserId: userId,
    metadata: {
      source: 'sonarr',
      instanceId: first.instanceId,
      ...(oneSeries ? { seriesId: first.arrId } : {}),
      mediaType: 'series',
      id: tagId,
      grouped: true,
      groupCount: episodes.length,
      items: episodes.slice(0, ITEM_CAP).map((e) => ({
        body: oneSeries ? episodeName(e.ep) : `${e.arrival.title} ${episodeName(e.ep)}`,
        redirect: episodeHref(e),
        seasonNumber: e.ep.seasonNumber,
        episodeId: e.ep.episodeId,
      })),
      redirect: url,
    },
  }, { service: 'sonarr', instanceId: first.instanceId, reason: 'watching-new-episode-grouped', groupCount: episodes.length });
}

// No answer at all (timeout, refused). Any answer, even a 500 (say, for a
// Jellyfin user that was deleted), is about this one person.
function noAnswer(error: unknown): boolean {
  return typeof (error as { response?: { status?: unknown } } | null)?.response?.status !== 'number';
}

function reportFailure(error: unknown) {
  noteJobFailure(error);
  logger.warn('New episode alerts failed', {
    reason: error instanceof Error ? error.message : String(error),
  }, { scope: 'polling' });
}

/**
 * Sends each person watching an arrived series one alert per new episode, or
 * one grouped alert for many. Call after notifyWatchlistArrivals: episodes it
 * announced are already claimed. Never throws, like notifyWatchlistArrivals.
 */
export async function notifyWatchingEpisodes(arrivals: LibraryArrival[], opts: { groupingEnabled: boolean }): Promise<void> {
  const candidates = arrivals.filter((a) => a.kind === 'series' && a.episodeRefs?.length && (a.tvdbId || a.tmdbId));
  if (candidates.length === 0) return;

  let users: Awaited<ReturnType<typeof findWatchers>>;
  try {
    users = (await findWatchers()).filter((u) => can(u, 'series.view') && can(u, 'notify.watchlist'));
  } catch (error) {
    reportFailure(error);
    return;
  }

  const now = Date.now();
  // Two people in a row with no answer means Jellyfin is down: stop rather
  // than wait out a timeout per person while the Sonarr poll holds its slot.
  // One slow account alone only skips that person.
  let unanswered = 0;
  const deadline = Date.now() + WATCHING_BATCH_BUDGET_MS;
  for (const user of users) {
    // A slow Jellyfin that still answers (or falls back to stale cache after
    // each timeout) would never trip the "no answer" stop below.
    if (Date.now() > deadline) {
      logger.warn('New episode alerts stopped: Jellyfin is too slow', { skipped: users.length - users.indexOf(user) }, { scope: 'polling' });
      return;
    }
    let played: PlayedSeries[];
    try {
      played = await loadPlayedSeries(user);
      unanswered = 0;
    } catch (error) {
      if (isJellyfinUnavailable(error)) continue;
      // Not a Sonarr failure, so the poll job is not marked failed.
      unanswered = noAnswer(error) ? unanswered + 1 : 0;
      logger.warn('Could not read Jellyfin plays for new episode alerts', {
        userId: user.id,
        reason: error instanceof Error ? error.message : String(error),
      }, { scope: 'polling' });
      if (unanswered >= 2) return;
      continue;
    }
    const days = user.settings?.watchingEpisodeDays ?? WATCHING_EPISODE_DAYS_DEFAULT;
    const watched = candidates
      .filter((arrival) => playedWithin(arrival, played, days, now))
      .flatMap((arrival) => arrival.episodeRefs!.map((ep) => ({ arrival, ep })));
    if (watched.length === 0) continue;

    let fresh: NewEpisode[];
    try {
      const claimed = await claimEpisodes(user.id, watched.map((e) => episodeKey(e.arrival, e.ep.label)));
      fresh = watched.filter((e) => claimed.has(episodeKey(e.arrival, e.ep.label)));
    } catch (error) {
      reportFailure(error);
      continue;
    }
    if (fresh.length === 0) continue;
    if (opts.groupingEnabled && fresh.length >= GROUP_THRESHOLD) {
      await sendGroup(user.id, fresh);
    } else {
      for (const episode of fresh) await sendOne(user.id, episode);
    }
  }
}
