import { NextRequest, NextResponse } from 'next/server';
import { getSonarrClient, getTMDBClient } from '@/lib/service-helpers';
import { requireAuth } from '@/lib/auth';
import { tmdbImageUrl } from '@/lib/discover';

const EMPTY = { cast: [], crew: [] };

const CREW_JOBS = new Set([
  'Director',
  'Writer',
  'Creator',
  'Executive Producer',
  'Showrunner',
]);

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authError = await requireAuth();
  if (authError) return authError;

  try {
    const { id } = await params;
    const seriesId = Number(id);
    if (!Number.isFinite(seriesId) || seriesId <= 0) {
      return NextResponse.json({ error: 'Invalid series ID' }, { status: 400 });
    }

    const sonarr = await getSonarrClient();
    const series = await sonarr.getSeriesById(seriesId);
    const tmdbId = series?.tmdbId;
    if (!tmdbId) {
      return NextResponse.json(EMPTY);
    }

    let tmdb;
    try {
      tmdb = await getTMDBClient();
    } catch {
      return NextResponse.json(EMPTY);
    }

    const credits = await tmdb.tvAggregateCredits(tmdbId);

    const cast = credits.cast
      .sort((a, b) => a.order - b.order)
      .slice(0, 20)
      .map((m) => ({
        id: m.id,
        name: m.name,
        profilePath: tmdbImageUrl(m.profile_path, 'w300'),
        character: m.roles?.[0]?.character || '',
        episodeCount: m.total_episode_count,
      }));

    const crew = credits.crew
      .filter((m) => m.jobs?.some((j) => CREW_JOBS.has(j.job)))
      .slice(0, 10)
      .map((m) => ({
        id: m.id,
        name: m.name,
        profilePath: tmdbImageUrl(m.profile_path, 'w300'),
        character: m.jobs?.find((j) => CREW_JOBS.has(j.job))?.job || '',
      }));

    return NextResponse.json({ cast, crew });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to fetch credits';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
