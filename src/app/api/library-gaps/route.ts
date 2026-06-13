import { NextResponse } from 'next/server';
import { getSonarrClients, getRadarrClients } from '@/lib/service-helpers';
import { requireAuth, requireCapability } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';
import { setImageCacheGeneration, toCachedImageSrc, type ImageServiceHint } from '@/lib/image';
import { getCacheGeneration } from '@/lib/cache/state';
import { getCachedLibraryGaps, setCachedLibraryGaps } from '@/lib/cache/library-gaps-cache';
import { searchUnits } from '@/lib/library-gaps';
import type {
  MediaImage,
  SonarrSeries,
  LibraryGapItem,
  LibraryGapSection,
  LibraryGapsResponse,
} from '@/types';

// Mirrors the 30s server-side cache TTL so the browser also collapses repeat loads.
const LIBRARY_GAPS_CACHE_HEADERS = {
  'Cache-Control': 'private, max-age=30, stale-while-revalidate=60',
} as const;

// Tagged client pairs as returned by the multi-instance getters. connection.id is
// the instance id we thread into every href + search target so a gap card opens
// (and its Search button commands) the instance the gap actually lives on.
type SonarrInstance = Awaited<ReturnType<typeof getSonarrClients>>[number];
type RadarrInstance = Awaited<ReturnType<typeof getRadarrClients>>[number];

const MAX_ITEMS_PER_SECTION = 50;

function resolvePoster(images: MediaImage[] | undefined, hint: ImageServiceHint): string | null {
  if (!images?.length) return null;
  const img = images.find((i) => i.coverType === 'poster') ?? images[0];
  const raw = img?.remoteUrl || img?.url || null;
  return toCachedImageSrc(raw, hint);
}

function pad(n: number | undefined): string {
  return String(n ?? 0).padStart(2, '0');
}

function emptySection(id: LibraryGapSection['id'], available: boolean, error = false): LibraryGapSection {
  return { id, count: 0, items: [], available, error };
}

function toSection(
  id: LibraryGapSection['id'],
  items: LibraryGapItem[],
  available: boolean,
  opts: { count?: number; error?: boolean } = {}
): LibraryGapSection {
  return {
    id,
    // count is a UNIT total (episodes/seasons/movies), not a card count — so a section
    // that later groups multiple units per card stays truthful without a caller change.
    count: opts.count ?? items.reduce((n, item) => n + searchUnits(item), 0),
    items: items.slice(0, MAX_ITEMS_PER_SECTION),
    available,
    error: opts.error ?? false,
  };
}

/**
 * Classify one Sonarr instance's seasons into "fully-missing aired season" and
 * "announced/upcoming newest season". The two are mutually exclusive by construction:
 * missing = aired-but-0-files; upcoming = not-yet-aired. Anime are ordinary Sonarr
 * series, so they're covered with no special-casing. Keys/hrefs/search are namespaced
 * by instanceId so the same series id on two instances never collides.
 */
function classifySeasons(series: SonarrSeries[] | null, instanceId: string) {
  const missing: LibraryGapItem[] = [];
  const upcoming: LibraryGapItem[] = [];
  const missingKeys = new Set<string>();
  let missingSeasonTotal = 0;

  if (!series) return { missing, upcoming, missingKeys, missingSeasonTotal };

  for (const show of series) {
    if (!show.monitored) continue;
    const poster = resolvePoster(show.images, 'sonarr');
    const realSeasons = show.seasons.filter((s) => s.seasonNumber > 0);

    // Missing aired seasons: episodes have aired (episodeCount > 0) but you have
    // none. One card per show — a show with several fully-missing seasons groups
    // into a single item instead of flooding the section with identical posters.
    const missingSeasons: { seasonNumber: number; episodeCount: number }[] = [];
    for (const season of realSeasons) {
      const stats = season.statistics;
      if (!stats) continue;
      if (season.monitored && stats.episodeCount > 0 && stats.episodeFileCount === 0) {
        missingKeys.add(`${instanceId}:${show.id}:${season.seasonNumber}`);
        missingSeasons.push({ seasonNumber: season.seasonNumber, episodeCount: stats.episodeCount });
      }
    }
    if (missingSeasons.length > 0) {
      missingSeasonTotal += missingSeasons.length;
      const episodeTotal = missingSeasons.reduce((sum, s) => sum + s.episodeCount, 0);
      const single = missingSeasons.length === 1 ? missingSeasons[0] : null;
      missing.push({
        key: `seasons-${instanceId}-${show.id}`,
        title: show.title,
        subtitle: single
          ? `Season ${single.seasonNumber} · ${episodeTotal} ep${episodeTotal === 1 ? '' : 's'}`
          : `${missingSeasons.length} seasons · ${episodeTotal} eps`,
        year: show.year,
        poster,
        href: single
          ? `/series/${show.id}/season/${single.seasonNumber}?instance=${instanceId}`
          : `/series/${show.id}?instance=${instanceId}`,
        search: {
          kind: 'seasons',
          sonarrSeriesId: show.id,
          seasonNumbers: missingSeasons.map((s) => s.seasonNumber),
          instanceId,
        },
      });
    }

    // Announced/upcoming newest season — only for shows you already own.
    if ((show.statistics?.episodeFileCount ?? 0) > 0 && realSeasons.length > 0) {
      const newest = realSeasons.reduce((a, b) => (b.seasonNumber > a.seasonNumber ? b : a));
      const stats = newest.statistics;
      if (
        stats &&
        newest.monitored &&
        stats.episodeFileCount === 0 &&
        stats.episodeCount === 0 &&
        stats.totalEpisodeCount > 0
      ) {
        upcoming.push({
          key: `upcoming-${instanceId}-${show.id}-${newest.seasonNumber}`,
          title: show.title,
          subtitle: `Season ${newest.seasonNumber}`,
          date: show.nextAiring,
          year: show.year,
          poster,
          href: `/series/${show.id}?instance=${instanceId}`,
          search: { kind: 'none' }, // nothing aired yet → nothing to search
        });
      }
    }
  }

  return { missing, upcoming, missingKeys, missingSeasonTotal };
}

async function buildCollectionGaps(radarrInstances: RadarrInstance[]): Promise<LibraryGapSection> {
  if (radarrInstances.length === 0) return emptySection('collectionGaps', false); // Radarr not connected

  // Pull collections + movies from every instance. "In library" is the union of all
  // reachable instances' movies, so a film owned in any instance isn't a gap. One bad
  // instance just contributes nothing rather than blanking the whole section.
  const perInstance = await Promise.all(
    radarrInstances.map(async ({ client }) => {
      const [collections, movies] = await Promise.all([
        client.getCollections().catch(() => null),
        client.getMovies().catch(() => null),
      ]);
      return { collections, movies };
    })
  );

  // Every configured instance failed both fetches → surface an error state.
  if (perInstance.every((p) => p.collections === null && p.movies === null)) {
    return emptySection('collectionGaps', false, true);
  }

  const librarySet = new Set<number>();
  for (const p of perInstance) {
    if (p.movies) for (const m of p.movies) if (m.tmdbId) librarySet.add(m.tmdbId);
  }

  const seen = new Set<number>();
  const items: LibraryGapItem[] = [];

  for (const p of perInstance) {
    // Need this instance's own movie list to trust its gaps — without it we can't tell
    // which of its collection films are already owned, which would surface false gaps.
    if (!p.collections || !p.movies) continue;
    for (const collection of p.collections) {
      if (!collection.monitored) continue; // only surface gaps from collections you actually track
      for (const part of collection.movies ?? []) {
        if (!part.tmdbId || librarySet.has(part.tmdbId) || seen.has(part.tmdbId)) continue;
        seen.add(part.tmdbId);
        items.push({
          key: `collgap-${part.tmdbId}`,
          title: part.title,
          subtitle: collection.title,
          year: part.year,
          poster: resolvePoster(part.images, 'radarr'),
          href: `/discover/movie/${part.tmdbId}`, // TMDB detail (add via Discover) — instance-agnostic
          search: { kind: 'none' }, // not in Radarr → add via Discover
          collectionTitle: collection.title,
          tmdbId: part.tmdbId,
        });
      }
    }
  }

  return toSection('collectionGaps', items, true);
}

/**
 * Overdue = monitored items past air/release date with no file (Sonarr episodes + Radarr movies),
 * fanned out over every Sonarr/Radarr instance and sourced from the same wanted/missing endpoints
 * Activity uses. Episodes belonging to a fully-missing season are deduped out (they're already
 * represented as a single Missing Seasons row), with the dedup key namespaced by instance.
 */
async function buildOverdue(
  sonarrInstances: SonarrInstance[],
  radarrInstances: RadarrInstance[],
  missingSeasonKeys: Set<string>
): Promise<LibraryGapSection> {
  if (sonarrInstances.length === 0 && radarrInstances.length === 0) return emptySection('overdue', false); // neither connected

  const [sonarrResults, radarrResults] = await Promise.all([
    Promise.all(
      sonarrInstances.map(async ({ connection, client }) => ({
        instanceId: connection.id,
        missing: await client.getWantedMissing(1, MAX_ITEMS_PER_SECTION).catch(() => null),
      }))
    ),
    Promise.all(
      radarrInstances.map(async ({ connection, client }) => ({
        instanceId: connection.id,
        missing: await client.getWantedMissing(1, MAX_ITEMS_PER_SECTION).catch(() => null),
      }))
    ),
  ]);

  // Available when at least one configured instance returned data; if every configured
  // instance failed, surface an error state rather than "not connected".
  const anyReturned =
    sonarrResults.some((r) => r.missing !== null) || radarrResults.some((r) => r.missing !== null);
  if (!anyReturned) return emptySection('overdue', false, true);

  const sonarrItems: LibraryGapItem[] = [];
  const radarrItems: LibraryGapItem[] = [];
  let dedupedCount = 0; // Sonarr episodes folded into a Missing Seasons row
  let sonarrTotal = 0;
  let radarrTotal = 0;

  for (const { instanceId, missing } of sonarrResults) {
    if (!missing) continue;
    sonarrTotal += missing.totalRecords ?? 0;
    const records = missing.records ?? [];
    // Group overdue episodes by series — 20 missing episodes of one show become
    // a single card (and a single batched EpisodeSearch) instead of 20 cards.
    const bySeries = new Map<number, typeof records>();
    for (const ep of records) {
      if (missingSeasonKeys.has(`${instanceId}:${ep.seriesId}:${ep.seasonNumber}`)) {
        dedupedCount++;
        continue;
      }
      const list = bySeries.get(ep.seriesId) ?? [];
      list.push(ep);
      bySeries.set(ep.seriesId, list);
    }
    for (const [seriesId, eps] of bySeries) {
      const first = eps[0];
      const single = eps.length === 1 ? first : null;
      const latestDate = eps
        .map((e) => e.airDateUtc)
        .filter((d): d is string => Boolean(d))
        .sort()
        .at(-1);
      sonarrItems.push({
        key: `overdue-series-${instanceId}-${seriesId}`,
        title: single
          ? `${first.series?.title ?? 'Unknown'} — S${pad(single.seasonNumber)}E${pad(single.episodeNumber)}`
          : first.series?.title ?? 'Unknown',
        subtitle: single ? single.title || undefined : `${eps.length} episodes overdue`,
        date: latestDate,
        poster: resolvePoster(first.series?.images, 'sonarr'),
        href: single
          ? `/series/${seriesId}/season/${single.seasonNumber}/episode/${single.id}?instance=${instanceId}`
          : `/series/${seriesId}?instance=${instanceId}`,
        search: { kind: 'episodes', episodeIds: eps.map((e) => e.id), instanceId },
      });
    }
  }

  for (const { instanceId, missing } of radarrResults) {
    if (!missing) continue;
    radarrTotal += missing.totalRecords ?? 0;
    for (const movie of missing.records ?? []) {
      radarrItems.push({
        key: `overdue-movie-${instanceId}-${movie.id}`,
        title: movie.title,
        subtitle: movie.year ? String(movie.year) : undefined,
        date: movie.digitalRelease || movie.physicalRelease || movie.inCinemas || movie.added,
        year: movie.year,
        poster: resolvePoster(movie.images, 'radarr'),
        href: `/movies/${movie.id}?instance=${instanceId}`,
        search: { kind: 'movie', radarrMovieId: movie.id, instanceId },
      });
    }
  }

  // Interleave the two sources so both survive the MAX_ITEMS_PER_SECTION slice in toSection;
  // concatenating would let a full page of Sonarr episodes push every Radarr movie out of view.
  const items: LibraryGapItem[] = [];
  for (let i = 0; i < Math.max(sonarrItems.length, radarrItems.length); i++) {
    if (i < sonarrItems.length) items.push(sonarrItems[i]);
    if (i < radarrItems.length) items.push(radarrItems[i]);
  }

  // True backlog from upstream totals (across all pages and instances), minus the page-1
  // episodes folded into Missing Seasons. May slightly overcount if a deduped season has
  // further missing episodes beyond page 1, but never undercounts the rows actually shown.
  const count = Math.max(0, sonarrTotal - dedupedCount) + radarrTotal;

  return toSection('overdue', items, true, { count });
}

async function getHandler(): Promise<NextResponse> {
  const authError = await requireAuth();
  if (authError) return authError;
  // Surfaces both libraries' gaps, so require read access to both.
  const seriesCapError = await requireCapability('series.view');
  if (seriesCapError) return seriesCapError;
  const moviesCapError = await requireCapability('movies.view');
  if (moviesCapError) return moviesCapError;

  // This route builds proxied image URLs via toCachedImageSrc outside the (app)
  // layout tree, so seed the cache-busting token explicitly for this worker.
  setImageCacheGeneration(await getCacheGeneration());

  const cached = await getCachedLibraryGaps();
  if (cached) return NextResponse.json(cached, { headers: LIBRARY_GAPS_CACHE_HEADERS });

  try {
    const [sonarrInstances, radarrInstances] = await Promise.all([
      getSonarrClients().catch(() => [] as SonarrInstance[]),
      getRadarrClients().catch(() => [] as RadarrInstance[]),
    ]);

    // Missing-seasons + upcoming, unioned across every Sonarr instance. Per-instance
    // try/catch so one unreachable instance doesn't blank the whole section.
    const missing: LibraryGapItem[] = [];
    const upcoming: LibraryGapItem[] = [];
    const missingKeys = new Set<string>();
    let missingSeasonTotal = 0;
    let sonarrAnyOk = false;

    const sonarrSeries = await Promise.all(
      sonarrInstances.map(async ({ connection, client }) => ({
        instanceId: connection.id,
        series: await client.getSeries().catch(() => null),
      }))
    );
    for (const { instanceId, series } of sonarrSeries) {
      if (series === null) continue; // this instance failed; others still contribute
      sonarrAnyOk = true;
      const r = classifySeasons(series, instanceId);
      missing.push(...r.missing);
      upcoming.push(...r.upcoming);
      missingSeasonTotal += r.missingSeasonTotal;
      for (const k of r.missingKeys) missingKeys.add(k);
    }
    // Available when ≥1 Sonarr instance returned data; error only when every configured
    // instance failed (so a partial result still shows the reachable instances' gaps).
    const sonarrAvailable = sonarrInstances.length > 0 && sonarrAnyOk;
    const sonarrError = sonarrInstances.length > 0 && !sonarrAnyOk;

    const [collectionGaps, overdue] = await Promise.all([
      buildCollectionGaps(radarrInstances),
      buildOverdue(sonarrInstances, radarrInstances, missingKeys),
    ]);

    const response: LibraryGapsResponse = {
      sections: [
        // count = total missing seasons (units), not show-groups — keeps the badge
        // and "showing first N" truncation note meaningful after grouping.
        toSection('missingSeasons', missing, sonarrAvailable, { error: sonarrError, count: missingSeasonTotal }),
        toSection('newUpcoming', upcoming, sonarrAvailable, { error: sonarrError }),
        collectionGaps,
        overdue,
      ],
    };

    // Cache only fully-healthy responses so transient failures self-heal on the next load.
    if (response.sections.every((s) => !s.error)) {
      await setCachedLibraryGaps(response);
    }

    return NextResponse.json(response, { headers: LIBRARY_GAPS_CACHE_HEADERS });
  } catch (error) {
    console.error('Failed to fetch library gaps:', error);
    return NextResponse.json({ error: 'Failed to fetch library gaps' }, { status: 500 });
  }
}

export const GET = withApiLogging(getHandler, 'api/library-gaps');
