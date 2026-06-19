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
  LibraryCompleteness,
} from '@/types';

// Mirrors the 30s server-side cache TTL so the browser also collapses repeat loads.
const LIBRARY_GAPS_CACHE_HEADERS = {
  'Cache-Control': 'private, max-age=30, stale-while-revalidate=60',
  // Partition the private cache by session cookie so a capability-gated response can't be
  // replayed from the browser cache to a different (or logged-out) user within the TTL.
  'Vary': 'Cookie',
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

// Interleave two ordered lists so neither source is starved by the MAX_ITEMS_PER_SECTION
// slice in toSection — a full page of Sonarr items would otherwise push every Radarr item out.
function interleave(a: LibraryGapItem[], b: LibraryGapItem[]): LibraryGapItem[] {
  const out: LibraryGapItem[] = [];
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if (i < a.length) out.push(a[i]);
    if (i < b.length) out.push(b[i]);
  }
  return out;
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

// Returns the collection-gaps section plus a monitored-movie owned/total tally (deduped by
// tmdbId across instances) — reused for the Insights completeness gauge, since this is the one
// place the route already pulls every instance's full movie list.
async function buildCollectionGaps(
  radarrInstances: RadarrInstance[]
): Promise<{ section: LibraryGapSection; movieStats: { owned: number; total: number } }> {
  const noMovies = { owned: 0, total: 0 };
  if (radarrInstances.length === 0) return { section: emptySection('collectionGaps', false), movieStats: noMovies }; // Radarr not connected

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
    return { section: emptySection('collectionGaps', false, true), movieStats: noMovies };
  }

  // librarySet: every owned tmdbId (monitored or not) so an owned film is never a "gap".
  // monitoredMovies: monitored films deduped by tmdbId for the completeness tally — owned
  // when any reachable instance has the file.
  const librarySet = new Set<number>();
  const monitoredMovies = new Map<number, boolean>();
  for (const p of perInstance) {
    if (!p.movies) continue;
    for (const m of p.movies) {
      if (m.tmdbId) librarySet.add(m.tmdbId);
      if (m.monitored && m.tmdbId) {
        monitoredMovies.set(m.tmdbId, (monitoredMovies.get(m.tmdbId) ?? false) || m.hasFile);
      }
    }
  }
  const movieStats = {
    owned: [...monitoredMovies.values()].filter(Boolean).length,
    total: monitoredMovies.size,
  };

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

  return { section: toSection('collectionGaps', items, true), movieStats };
}

/**
 * Splits the wanted/missing backlog into two sections:
 *  - overdue: monitored items already released/aired but still missing a file.
 *  - notReleased: monitored items that haven't actually released yet. Radarr's wanted/missing
 *    includes these whenever minimum availability is "Announced", and it sorts the endpoint by
 *    date descending — so future-dated movies otherwise sort to the top and bury real overdue rows.
 * Both fan out over every Sonarr/Radarr instance from the same wanted/missing endpoints Activity uses.
 * A movie counts as released only when a digital/physical date has passed (in-cinemas alone does not)
 * or Radarr's own status is "released". Episodes belonging to a fully-missing season are deduped out
 * (already represented as a single Missing Seasons row), with the dedup key namespaced by instance.
 * notReleased items are non-searchable ("Soon" badge) since searching unreleased media finds nothing.
 */
async function buildOverdue(
  sonarrInstances: SonarrInstance[],
  radarrInstances: RadarrInstance[],
  missingSeasonKeys: Set<string>
): Promise<{ overdue: LibraryGapSection; notReleased: LibraryGapSection }> {
  if (sonarrInstances.length === 0 && radarrInstances.length === 0) {
    return { overdue: emptySection('overdue', false), notReleased: emptySection('notReleased', false) }; // neither connected
  }

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
  if (!anyReturned) {
    return { overdue: emptySection('overdue', false, true), notReleased: emptySection('notReleased', false, true) };
  }

  const now = Date.now();
  const overdueSonarr: LibraryGapItem[] = [];
  const notReleasedSonarr: LibraryGapItem[] = [];
  const overdueRadarr: LibraryGapItem[] = [];
  const notReleasedRadarr: LibraryGapItem[] = [];

  for (const { instanceId, missing } of sonarrResults) {
    if (!missing) continue;
    const records = missing.records ?? [];
    // Group episodes by series — 20 missing episodes of one show become a single card
    // (and a single batched EpisodeSearch) instead of 20 cards. Aired and future episodes
    // group separately so a show can have rows in both sections.
    const airedBySeries = new Map<number, typeof records>();
    const futureBySeries = new Map<number, typeof records>();
    for (const ep of records) {
      if (missingSeasonKeys.has(`${instanceId}:${ep.seriesId}:${ep.seasonNumber}`)) continue; // already a Missing Seasons row
      const t = ep.airDateUtc ? new Date(ep.airDateUtc).getTime() : NaN;
      // A null/unknown air date stays in the searchable Overdue bucket (a wanted no-date
      // episode must remain searchable); only a genuinely-future air date splits off.
      const target = !Number.isNaN(t) && t > now ? futureBySeries : airedBySeries;
      const list = target.get(ep.seriesId) ?? [];
      list.push(ep);
      target.set(ep.seriesId, list);
    }
    for (const [seriesId, eps] of airedBySeries) {
      const first = eps[0];
      const single = eps.length === 1 ? first : null;
      const latestDate = eps
        .map((e) => e.airDateUtc)
        .filter((d): d is string => Boolean(d))
        .sort()
        .at(-1);
      overdueSonarr.push({
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
    for (const [seriesId, eps] of futureBySeries) {
      const first = eps[0];
      const single = eps.length === 1 ? first : null;
      const earliestDate = eps
        .map((e) => e.airDateUtc)
        .filter((d): d is string => Boolean(d))
        .sort()
        .at(0); // soonest upcoming air date
      notReleasedSonarr.push({
        key: `notreleased-series-${instanceId}-${seriesId}`,
        title: single
          ? `${first.series?.title ?? 'Unknown'} — S${pad(single.seasonNumber)}E${pad(single.episodeNumber)}`
          : first.series?.title ?? 'Unknown',
        subtitle: single ? single.title || undefined : `${eps.length} episodes`,
        date: earliestDate,
        poster: resolvePoster(first.series?.images, 'sonarr'),
        href: single
          ? `/series/${seriesId}/season/${single.seasonNumber}/episode/${single.id}?instance=${instanceId}`
          : `/series/${seriesId}?instance=${instanceId}`,
        search: { kind: 'none' }, // not aired yet → nothing to search
      });
    }
  }

  for (const { instanceId, missing } of radarrResults) {
    if (!missing) continue;
    for (const movie of missing.records ?? []) {
      const released =
        movie.status === 'released' ||
        (movie.digitalRelease ? new Date(movie.digitalRelease).getTime() <= now : false) ||
        (movie.physicalRelease ? new Date(movie.physicalRelease).getTime() <= now : false);
      if (released) {
        overdueRadarr.push({
          key: `overdue-movie-${instanceId}-${movie.id}`,
          title: movie.title,
          subtitle: movie.year ? String(movie.year) : undefined,
          date: movie.digitalRelease || movie.physicalRelease || movie.inCinemas || movie.added,
          year: movie.year,
          poster: resolvePoster(movie.images, 'radarr'),
          href: `/movies/${movie.id}?instance=${instanceId}`,
          search: { kind: 'movie', radarrMovieId: movie.id, instanceId },
        });
      } else {
        // Soonest upcoming release date; never fall back to `added` so we don't show a
        // misleading past time ("released 2 months ago") on a not-yet-released card.
        const upcomingDate = [movie.digitalRelease, movie.physicalRelease, movie.inCinemas]
          .filter((d): d is string => Boolean(d))
          .filter((d) => new Date(d).getTime() > now)
          .sort()
          .at(0);
        notReleasedRadarr.push({
          key: `notreleased-movie-${instanceId}-${movie.id}`,
          title: movie.title,
          subtitle: movie.year ? String(movie.year) : undefined,
          date: upcomingDate,
          year: movie.year,
          poster: resolvePoster(movie.images, 'radarr'),
          href: `/movies/${movie.id}?instance=${instanceId}`,
          search: { kind: 'none' }, // not released yet → nothing to search
        });
      }
    }
  }

  // Counts default to the unit-sum over the page-1 window (toSection). Upstream totalRecords
  // mixes released + unreleased across all pages, so it can't be cleanly attributed to either bucket.
  return {
    overdue: toSection('overdue', interleave(overdueSonarr, overdueRadarr), true),
    notReleased: toSection('notReleased', interleave(notReleasedSonarr, notReleasedRadarr), true),
  };
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
    // TV completeness tally: owned (have) over aired+monitored episodes across monitored
    // series — the same denominator Sonarr uses for percentOfEpisodes.
    let tvOwned = 0;
    let tvTotal = 0;

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
      for (const show of series) {
        if (!show.monitored) continue;
        tvOwned += show.statistics?.episodeFileCount ?? 0;
        tvTotal += show.statistics?.episodeCount ?? 0;
      }
    }
    // Available when ≥1 Sonarr instance returned data; error only when every configured
    // instance failed (so a partial result still shows the reachable instances' gaps).
    const sonarrAvailable = sonarrInstances.length > 0 && sonarrAnyOk;
    const sonarrError = sonarrInstances.length > 0 && !sonarrAnyOk;

    const [{ section: collectionGaps, movieStats }, { overdue, notReleased }] = await Promise.all([
      buildCollectionGaps(radarrInstances),
      buildOverdue(sonarrInstances, radarrInstances, missingKeys),
    ]);

    const ownedUnits = tvOwned + movieStats.owned;
    const totalUnits = tvTotal + movieStats.total;
    const completeness: LibraryCompleteness | undefined =
      totalUnits > 0
        ? {
            percent: Math.round((ownedUnits / totalUnits) * 100),
            ownedUnits,
            totalUnits,
            tv: { owned: tvOwned, total: tvTotal },
            movies: { owned: movieStats.owned, total: movieStats.total },
          }
        : undefined;

    const response: LibraryGapsResponse = {
      sections: [
        // count = total missing seasons (units), not show-groups — keeps the badge
        // and "showing first N" truncation note meaningful after grouping.
        toSection('missingSeasons', missing, sonarrAvailable, { error: sonarrError, count: missingSeasonTotal }),
        toSection('newUpcoming', upcoming, sonarrAvailable, { error: sonarrError }),
        collectionGaps,
        overdue,
        notReleased,
      ],
      completeness,
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
