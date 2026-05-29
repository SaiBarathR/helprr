import { NextResponse } from 'next/server';
import { getSonarrClient, getRadarrClient } from '@/lib/service-helpers';
import { requireAuth } from '@/lib/auth';
import { withApiLogging } from '@/lib/api-logger';
import { toCachedImageSrc, type ImageServiceHint } from '@/lib/image';
import type { SonarrClient } from '@/lib/sonarr-client';
import type { RadarrClient } from '@/lib/radarr-client';
import type {
  MediaImage,
  SonarrSeries,
  LibraryGapItem,
  LibraryGapSection,
  LibraryGapsResponse,
} from '@/types';

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

function emptySection(id: LibraryGapSection['id'], available: boolean): LibraryGapSection {
  return { id, count: 0, items: [], available };
}

function toSection(id: LibraryGapSection['id'], items: LibraryGapItem[], available: boolean): LibraryGapSection {
  return { id, count: items.length, items: items.slice(0, MAX_ITEMS_PER_SECTION), available };
}

/**
 * Classify Sonarr seasons into "fully-missing aired season" and "announced/upcoming newest season".
 * The two are mutually exclusive by construction: missing = aired-but-0-files; upcoming = not-yet-aired.
 * Anime are ordinary Sonarr series, so they're covered with no special-casing.
 */
function classifySeasons(series: SonarrSeries[] | null) {
  const missing: LibraryGapItem[] = [];
  const upcoming: LibraryGapItem[] = [];
  const missingKeys = new Set<string>();

  if (!series) return { missing, upcoming, missingKeys };

  for (const show of series) {
    if (!show.monitored) continue;
    const poster = resolvePoster(show.images, 'sonarr');
    const realSeasons = show.seasons.filter((s) => s.seasonNumber > 0);

    // Missing aired seasons: episodes have aired (episodeCount > 0) but you have none.
    for (const season of realSeasons) {
      const stats = season.statistics;
      if (!stats) continue;
      if (season.monitored && stats.episodeCount > 0 && stats.episodeFileCount === 0) {
        missingKeys.add(`${show.id}:${season.seasonNumber}`);
        missing.push({
          key: `season-${show.id}-${season.seasonNumber}`,
          title: show.title,
          subtitle: `Season ${season.seasonNumber} · ${stats.episodeCount} ep${stats.episodeCount === 1 ? '' : 's'}`,
          year: show.year,
          poster,
          href: `/series/${show.id}/season/${season.seasonNumber}`,
          search: { kind: 'season', sonarrSeriesId: show.id, seasonNumber: season.seasonNumber },
        });
      }
    }

    // Announced/upcoming newest season — only for shows you already own.
    if ((show.statistics?.episodeFileCount ?? 0) > 0 && realSeasons.length > 0) {
      const newest = realSeasons.reduce((a, b) => (b.seasonNumber > a.seasonNumber ? b : a));
      const stats = newest.statistics;
      if (
        stats &&
        newest.monitored !== false &&
        stats.episodeFileCount === 0 &&
        stats.episodeCount === 0 &&
        stats.totalEpisodeCount > 0
      ) {
        upcoming.push({
          key: `upcoming-${show.id}-${newest.seasonNumber}`,
          title: show.title,
          subtitle: `Season ${newest.seasonNumber}`,
          date: show.nextAiring,
          year: show.year,
          poster,
          href: `/series/${show.id}`,
          search: { kind: 'none' }, // nothing aired yet → nothing to search
        });
      }
    }
  }

  return { missing, upcoming, missingKeys };
}

async function buildCollectionGaps(radarr: RadarrClient | null): Promise<LibraryGapSection> {
  if (!radarr) return emptySection('collectionGaps', false);

  const [collections, movies] = await Promise.all([
    radarr.getCollections().catch(() => null),
    radarr.getMovies().catch(() => null),
  ]);

  if (!collections || !movies) return emptySection('collectionGaps', false);

  const librarySet = new Set(movies.map((m) => m.tmdbId));
  const seen = new Set<number>();
  const items: LibraryGapItem[] = [];

  for (const collection of collections) {
    for (const part of collection.movies ?? []) {
      if (!part.tmdbId || librarySet.has(part.tmdbId) || seen.has(part.tmdbId)) continue;
      seen.add(part.tmdbId);
      items.push({
        key: `collgap-${part.tmdbId}`,
        title: part.title,
        subtitle: collection.title,
        year: part.year,
        poster: resolvePoster(part.images, 'radarr'),
        href: `/discover/movie/${part.tmdbId}`,
        search: { kind: 'none' }, // not in Radarr → add via Discover
        collectionTitle: collection.title,
        tmdbId: part.tmdbId,
      });
    }
  }

  return toSection('collectionGaps', items, true);
}

/**
 * Overdue = monitored items past air/release date with no file (Sonarr episodes + Radarr movies),
 * sourced from the same wanted/missing endpoints Activity uses. Episodes belonging to a fully-missing
 * season are deduped out (they're already represented as a single Missing Seasons row).
 */
async function buildOverdue(
  sonarr: SonarrClient | null,
  radarr: RadarrClient | null,
  missingSeasonKeys: Set<string>
): Promise<LibraryGapSection> {
  const [sonarrMissing, radarrMissing] = await Promise.all([
    sonarr ? sonarr.getWantedMissing(1, MAX_ITEMS_PER_SECTION).catch(() => null) : Promise.resolve(null),
    radarr ? radarr.getWantedMissing(1, MAX_ITEMS_PER_SECTION).catch(() => null) : Promise.resolve(null),
  ]);

  const available = sonarrMissing !== null || radarrMissing !== null;
  if (!available) return emptySection('overdue', false);

  const items: LibraryGapItem[] = [];

  for (const ep of sonarrMissing?.records ?? []) {
    if (missingSeasonKeys.has(`${ep.seriesId}:${ep.seasonNumber}`)) continue;
    items.push({
      key: `overdue-ep-${ep.id}`,
      title: `${ep.series?.title ?? 'Unknown'} — S${pad(ep.seasonNumber)}E${pad(ep.episodeNumber)}`,
      subtitle: ep.title || undefined,
      date: ep.airDateUtc,
      poster: resolvePoster(ep.series?.images, 'sonarr'),
      href: `/series/${ep.seriesId}/season/${ep.seasonNumber}/episode/${ep.id}`,
      search: { kind: 'episode', episodeId: ep.id },
    });
  }

  for (const movie of radarrMissing?.records ?? []) {
    items.push({
      key: `overdue-movie-${movie.id}`,
      title: movie.title,
      subtitle: movie.year ? String(movie.year) : undefined,
      date: movie.digitalRelease || movie.physicalRelease || movie.inCinemas || movie.added,
      year: movie.year,
      poster: resolvePoster(movie.images, 'radarr'),
      href: `/movies/${movie.id}`,
      search: { kind: 'movie', radarrMovieId: movie.id },
    });
  }

  return toSection('overdue', items, true);
}

async function getHandler(): Promise<NextResponse> {
  const authError = await requireAuth();
  if (authError) return authError;

  try {
    const [sonarr, radarr] = await Promise.all([
      getSonarrClient().catch(() => null),
      getRadarrClient().catch(() => null),
    ]);

    const series = sonarr ? await sonarr.getSeries().catch(() => null) : null;
    const sonarrSeriesAvailable = series !== null;
    const { missing, upcoming, missingKeys } = classifySeasons(series);

    const [collectionGaps, overdue] = await Promise.all([
      buildCollectionGaps(radarr),
      buildOverdue(sonarr, radarr, missingKeys),
    ]);

    const response: LibraryGapsResponse = {
      sections: [
        toSection('missingSeasons', missing, sonarrSeriesAvailable),
        toSection('newUpcoming', upcoming, sonarrSeriesAvailable),
        collectionGaps,
        overdue,
      ],
    };

    return NextResponse.json(response);
  } catch (error) {
    console.error('Failed to fetch library gaps:', error);
    return NextResponse.json({ error: 'Failed to fetch library gaps' }, { status: 500 });
  }
}

export const GET = withApiLogging(getHandler, 'api/library-gaps');
