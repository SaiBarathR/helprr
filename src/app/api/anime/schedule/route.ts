import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { loadTaggedLibrary } from '@/lib/service-helpers';
import { getAnimeAiringSchedule } from '@/lib/anilist-client';
import { getPreferredTitle, isMovieFormat } from '@/lib/anilist-helpers';
import {
  buildLibraryLookups,
  matchMovieInLibrary,
  matchSeriesInLibrary,
  seriesLibraryStatusFromMatches,
  type Tagged,
} from '@/lib/discover';
import { loadLibraryLinksForAnilistIds } from '@/lib/anilist-series-mapping';
import type { RadarrMovie, SonarrSeries, DiscoverLibraryStatus } from '@/types';
import type {
  AniListAiringSchedule,
  AniListScheduleEntry,
} from '@/types/anilist';
import { withApiLogging } from '@/lib/api-logger';

const MAX_WINDOW_SECONDS = 14 * 24 * 60 * 60; // 2 weeks safety cap
const INT32_MAX = 2_147_483_647; // AniList GraphQL Int is 32-bit signed

async function getLibraries() {
  const { movies, series } = await loadTaggedLibrary();
  return { movies, series };
}

function normalizeScheduleEntry(s: AniListAiringSchedule): AniListScheduleEntry {
  const m = s.media;
  return {
    scheduleId: s.id,
    episode: s.episode,
    airingAt: s.airingAt,
    media: {
      id: m.id,
      title: getPreferredTitle(m.title),
      titleRomaji: m.title.romaji,
      titleNative: m.title.native,
      coverImage: m.coverImage.extraLarge || m.coverImage.large || null,
      coverImageColor: m.coverImage.color,
      format: m.format,
      status: m.status,
      season: m.season,
      seasonYear: m.seasonYear,
      episodes: m.episodes,
      duration: m.duration,
      averageScore: m.averageScore,
      meanScore: m.meanScore,
      genres: m.genres || [],
      studios: (m.studios?.nodes || []).map((n) => n.name),
      year: m.seasonYear,
    },
  };
}

function dedupe(entries: AniListScheduleEntry[]): AniListScheduleEntry[] {
  const seen = new Set<string>();
  const out: AniListScheduleEntry[] = [];
  for (const entry of entries) {
    const key = `${entry.media.id}:${entry.episode}:${entry.airingAt}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(entry);
  }
  return out;
}

async function annotate(
  entries: AniListScheduleEntry[],
  movies: Tagged<RadarrMovie>[],
  series: Tagged<SonarrSeries>[]
): Promise<(AniListScheduleEntry & { library?: DiscoverLibraryStatus })[]> {
  if (!movies.length && !series.length) return entries;

  const lookups = buildLibraryLookups(movies, series);
  const mappingLinks = await loadLibraryLinksForAnilistIds(entries.map((entry) => entry.media.id));
  const seriesByKey = new Map<string, Tagged<SonarrSeries>>();
  for (const show of series) seriesByKey.set(`${show.instanceId}:${show.id}`, show);

  return entries.map((entry) => {
    const m = entry.media;
    if (isMovieFormat(m.format)) {
      return { ...entry, library: matchMovieInLibrary(lookups, { title: m.title, year: m.year }) };
    }

    // Reverse mapping (AniList entry → Sonarr series) catches season splits that
    // title matching misses; intersect with the live library to drop stale links.
    const mapped = (mappingLinks.get(m.id) ?? [])
      .map((link) => seriesByKey.get(`${link.sonarrInstanceId}:${link.sonarrSeriesId}`))
      .filter((show): show is Tagged<SonarrSeries> => !!show);

    return {
      ...entry,
      library: mapped.length
        ? seriesLibraryStatusFromMatches(mapped)
        : matchSeriesInLibrary(lookups, {
            title: m.title,
            titleRomaji: m.titleRomaji,
            titleNative: m.titleNative,
            year: m.year,
          }),
    };
  });
}

function parseTimestamp(value: string | null): number | null {
  if (!value) return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  const seconds = Math.floor(n);
  if (seconds <= 0 || seconds > INT32_MAX) return null;
  return seconds;
}

async function getHandler(request: NextRequest) {
  const authError = await requireAuth();
  if (authError) return authError;

  try {
    const { searchParams } = new URL(request.url);
    const weekStart = parseTimestamp(searchParams.get('weekStart'));
    const weekEnd = parseTimestamp(searchParams.get('weekEnd'));

    if (!weekStart || !weekEnd) {
      return NextResponse.json(
        { error: 'weekStart and weekEnd query params are required (Unix seconds)' },
        { status: 400 }
      );
    }
    if (weekEnd <= weekStart) {
      return NextResponse.json(
        { error: 'weekEnd must be greater than weekStart' },
        { status: 400 }
      );
    }
    if (weekEnd - weekStart > MAX_WINDOW_SECONDS) {
      return NextResponse.json(
        { error: 'Requested window is too large (max 14 days)' },
        { status: 400 }
      );
    }

    const [schedules, { movies, series }] = await Promise.all([
      getAnimeAiringSchedule({ weekStart, weekEnd }),
      getLibraries(),
    ]);

    const entries = schedules
      .filter((s) => s.media && !s.media.isAdult)
      .map(normalizeScheduleEntry);
    const deduped = dedupe(entries);
    const annotated = await annotate(deduped, movies, series);

    return NextResponse.json(
      {
        weekStart,
        weekEnd,
        entries: annotated,
      },
      {
        headers: {
          'Cache-Control': 'private, max-age=300, stale-while-revalidate=600',
        },
      }
    );
  } catch (error) {
    console.error('[Anime Schedule API]', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export const GET = withApiLogging(getHandler, 'api/anime/schedule');
